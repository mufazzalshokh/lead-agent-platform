import type { ChannelCapabilities, ChannelFailureCategory } from "@lead-agent/contracts";
import type { TelegramPlatformConfig } from "@lead-agent/config";

const MAXIMUM_RESPONSE_BYTES = 65_536;
const MAXIMUM_RETRY_AFTER_SECONDS = 300;
const ALLOWED_UPDATES = Object.freeze([
  "message",
  "business_connection",
  "business_message",
  "callback_query",
] as const);

export const TELEGRAM_BUSINESS_CAPABILITIES: ChannelCapabilities =
  Object.freeze<ChannelCapabilities>({
    max_quick_replies: 5,
    max_text_length: 4_000,
    supported_attachment_media_kinds: ["image", "document", "audio", "other"],
    supported_text_formats: ["plain_text"],
    supports_delivery_status: false,
    supports_message_edit: false,
  });

export class TelegramProviderError extends Error {
  constructor(
    public readonly category: ChannelFailureCategory,
    public readonly ambiguousExternalEffect: boolean,
    public readonly retryAfterMilliseconds?: number,
  ) {
    super("Telegram provider request failed");
    this.name = "TelegramProviderError";
  }
}

export type TelegramBusinessConnection = Readonly<{
  canReply: boolean;
  id: string;
  isEnabled: boolean;
  ownerUserId: string;
}>;

export type TelegramPlatformClient = Readonly<{
  answerCallbackQuery(callbackQueryId: string): Promise<void>;
  getBusinessConnection(businessConnectionId: string): Promise<TelegramBusinessConnection>;
  getMe(): Promise<Readonly<{ id: string; username: string }>>;
  getWebhookInfo(): Promise<Readonly<{ allowedUpdates: readonly string[]; url: string }>>;
  sendMessage(
    input: Readonly<{
      businessConnectionId: string;
      chatId: string;
      quickReplies?: readonly Readonly<{ actionToken: string; label: string }>[];
      text: string;
    }>,
  ): Promise<Readonly<{ messageId: string }>>;
  setWebhook(): Promise<void>;
}>;

export const createTelegramPlatformProvisioner = (
  client: TelegramPlatformClient,
  config: TelegramPlatformConfig,
): Readonly<{ ensureWebhook(): Promise<void> }> =>
  Object.freeze({
    ensureWebhook: async () => {
      await client.getMe();
      await client.setWebhook();
      const info = await client.getWebhookInfo();
      if (
        info.url !== config.webhookUrl ||
        info.allowedUpdates.length !== ALLOWED_UPDATES.length ||
        !ALLOWED_UPDATES.every((update) => info.allowedUpdates.includes(update))
      ) {
        throw new TelegramProviderError("provider_unavailable", false);
      }
    },
  });

const record = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const categoryFor = (status: number): ChannelFailureCategory => {
  if (status === 401) return "authentication_failed";
  if (status === 403) return "permanent_rejection";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "provider_unavailable";
  return "unsupported_content";
};

export const createTelegramPlatformClient = (
  config: TelegramPlatformConfig,
  fetchImplementation: typeof fetch = fetch,
): TelegramPlatformClient => {
  const invoke = async (
    method: string,
    body: Readonly<Record<string, unknown>>,
    sideEffecting: boolean,
  ): Promise<unknown> => {
    const abort = new AbortController();
    const timeout = setTimeout(() => abort.abort(), config.requestTimeoutMilliseconds);
    try {
      const response = await fetchImplementation(
        `${config.apiBaseUrl}/bot${config.botToken}/${method}`,
        {
          body: JSON.stringify(body),
          headers: { "content-type": "application/json" },
          method: "POST",
          redirect: "error",
          signal: abort.signal,
        },
      );
      const declaredLength = Number(response.headers.get("content-length") ?? "0");
      if (Number.isFinite(declaredLength) && declaredLength > MAXIMUM_RESPONSE_BYTES) {
        throw new TelegramProviderError("provider_unavailable", sideEffecting);
      }
      const reader = response.body?.getReader();
      const chunks: Uint8Array[] = [];
      let bytes = 0;
      if (reader !== undefined) {
        try {
          while (true) {
            const part = await reader.read();
            if (part.done) break;
            const chunk: unknown = part.value;
            if (!(chunk instanceof Uint8Array)) {
              throw new TelegramProviderError("provider_unavailable", sideEffecting);
            }
            bytes += chunk.byteLength;
            if (bytes > MAXIMUM_RESPONSE_BYTES) {
              await reader.cancel();
              throw new TelegramProviderError("provider_unavailable", sideEffecting);
            }
            chunks.push(chunk);
          }
        } finally {
          reader.releaseLock();
        }
      }
      const text = Buffer.concat(chunks).toString("utf8");
      let payload: unknown;
      try {
        payload = JSON.parse(text);
      } catch {
        throw new TelegramProviderError("provider_unavailable", sideEffecting);
      }
      const object = record(payload);
      if (!response.ok || object?.["ok"] !== true) {
        const parameters = record(object?.["parameters"]);
        const providerCode = object?.["error_code"];
        const status =
          typeof providerCode === "number" &&
          Number.isInteger(providerCode) &&
          providerCode >= 400 &&
          providerCode <= 599
            ? providerCode
            : response.status;
        const retryAfter = parameters?.["retry_after"];
        const boundedRetryAfter =
          typeof retryAfter === "number" &&
          Number.isSafeInteger(retryAfter) &&
          retryAfter >= 0 &&
          retryAfter <= MAXIMUM_RETRY_AFTER_SECONDS
            ? retryAfter * 1_000
            : undefined;
        throw new TelegramProviderError(
          categoryFor(status),
          sideEffecting && status >= 500,
          boundedRetryAfter,
        );
      }
      return object["result"];
    } catch (error) {
      if (error instanceof TelegramProviderError) throw error;
      throw new TelegramProviderError("provider_unavailable", sideEffecting);
    } finally {
      clearTimeout(timeout);
    }
  };

  return Object.freeze({
    answerCallbackQuery: async (callbackQueryId) => {
      await invoke("answerCallbackQuery", { callback_query_id: callbackQueryId }, true);
    },
    getBusinessConnection: async (businessConnectionId) => {
      const result = record(
        await invoke(
          "getBusinessConnection",
          { business_connection_id: businessConnectionId },
          false,
        ),
      );
      const owner = record(result?.["user"]);
      const ownerId = owner?.["id"];
      const rights = record(result?.["rights"]);
      if (
        result === null ||
        result["id"] !== businessConnectionId ||
        typeof ownerId !== "number" ||
        !Number.isSafeInteger(ownerId) ||
        ownerId <= 0 ||
        owner?.["is_bot"] !== false ||
        typeof result["is_enabled"] !== "boolean"
      ) {
        throw new TelegramProviderError("provider_unavailable", false);
      }
      return Object.freeze({
        canReply: rights?.["can_reply"] === true,
        id: businessConnectionId,
        isEnabled: result["is_enabled"],
        ownerUserId: String(ownerId),
      });
    },
    getMe: async () => {
      const result = record(await invoke("getMe", {}, false));
      const id = result?.["id"];
      const username = result?.["username"];
      if (
        typeof id !== "number" ||
        !Number.isSafeInteger(id) ||
        typeof username !== "string" ||
        result?.["is_bot"] !== true ||
        result?.["can_connect_to_business"] !== true ||
        username !== config.botUsername
      ) {
        throw new TelegramProviderError("authentication_failed", false);
      }
      return Object.freeze({ id: String(id), username });
    },
    getWebhookInfo: async () => {
      const result = record(await invoke("getWebhookInfo", {}, false));
      const url = result?.["url"];
      const allowedUpdates = result?.["allowed_updates"];
      if (
        typeof url !== "string" ||
        !Array.isArray(allowedUpdates) ||
        !allowedUpdates.every((value) => typeof value === "string")
      ) {
        throw new TelegramProviderError("provider_unavailable", false);
      }
      return Object.freeze({ allowedUpdates: Object.freeze([...allowedUpdates]), url });
    },
    sendMessage: async ({ businessConnectionId, chatId, quickReplies, text }) => {
      if (
        !/^[1-9][0-9]{0,15}$/u.test(chatId) ||
        businessConnectionId.length < 1 ||
        businessConnectionId.length > 255 ||
        text.length < 1 ||
        text.length > 4_000 ||
        (quickReplies !== undefined &&
          (quickReplies.length > 5 ||
            quickReplies.some(
              (reply) =>
                Buffer.byteLength(reply.actionToken, "utf8") < 1 ||
                Buffer.byteLength(reply.actionToken, "utf8") > 64 ||
                reply.label.length < 1 ||
                reply.label.length > 64,
            )))
      ) {
        throw new TelegramProviderError("unsupported_content", false);
      }
      const replyMarkup =
        quickReplies === undefined || quickReplies.length === 0
          ? {}
          : {
              reply_markup: {
                inline_keyboard: quickReplies.map(({ actionToken, label }) => [
                  { callback_data: actionToken, text: label },
                ]),
              },
            };
      const result = record(
        await invoke(
          "sendMessage",
          {
            business_connection_id: businessConnectionId,
            chat_id: chatId,
            ...replyMarkup,
            text,
          },
          true,
        ),
      );
      const messageId = result?.["message_id"];
      const returnedChat = record(result?.["chat"]);
      if (
        typeof messageId !== "number" ||
        !Number.isSafeInteger(messageId) ||
        messageId <= 0 ||
        result?.["business_connection_id"] !== businessConnectionId ||
        String(returnedChat?.["id"]) !== chatId ||
        returnedChat?.["type"] !== "private"
      ) {
        throw new TelegramProviderError("provider_unavailable", true);
      }
      return Object.freeze({ messageId: String(messageId) });
    },
    setWebhook: async () => {
      await invoke(
        "setWebhook",
        {
          allowed_updates: ALLOWED_UPDATES,
          secret_token: config.webhookSecret,
          url: config.webhookUrl,
        },
        true,
      );
    },
  });
};
