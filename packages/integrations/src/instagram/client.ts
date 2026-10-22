import {
  InstagramProviderError,
  type InstagramAccountCredential,
  type InstagramOAuthClient,
} from "@lead-agent/application";
import type { InstagramPlatformConfig } from "@lead-agent/config";
import type { ChannelCapabilities, ChannelFailureCategory } from "@lead-agent/contracts";

export const INSTAGRAM_BUSINESS_CAPABILITIES: ChannelCapabilities =
  Object.freeze<ChannelCapabilities>({
    max_quick_replies: 0,
    max_text_length: 1000,
    supported_attachment_media_kinds: ["image", "document", "audio", "other"],
    supported_text_formats: ["plain_text"],
    supports_delivery_status: false,
    supports_message_edit: false,
  });
const record = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
const one = (value: unknown): Record<string, unknown> | null => {
  const object = record(value);
  const data = object?.["data"];
  if (Array.isArray(data) && object?.["access_token"] !== undefined) return null;
  return Array.isArray(data) ? (data.length === 1 ? record(data[0]) : null) : object;
};
const validId = (value: unknown): value is string =>
  typeof value === "string" && /^[1-9][0-9]{0,31}$/u.test(value);
const tokenValue = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Za-z0-9_.|-]{16,4096}$/u.test(value);
const expires = (value: unknown): value is number =>
  typeof value === "number" &&
  Number.isSafeInteger(value) &&
  value > 0 &&
  value <= 90 * 24 * 60 * 60;

export interface InstagramPlatformClient extends InstagramOAuthClient {
  sendMessage(
    input: Readonly<{ accountId: string; recipientId: string; text: string; token: string }>,
  ): Promise<Readonly<{ messageId: string }>>;
}

export const createInstagramPlatformClient = (
  config: InstagramPlatformConfig,
  fetchImplementation: typeof fetch = fetch,
): InstagramPlatformClient => {
  const graph = `https://graph.instagram.com/${config.graphApiVersion}`;
  const invoke = async (
    url: string,
    init: RequestInit,
    operation: NonNullable<InstagramProviderError["diagnostic"]>["operation"],
    sideEffecting = false,
  ): Promise<unknown> => {
    const abort = new AbortController();
    const timeout = setTimeout(() => abort.abort(), config.requestTimeoutMilliseconds);
    try {
      const response = await fetchImplementation(url, {
        ...init,
        redirect: "error",
        signal: abort.signal,
      });
      const reader = response.body?.getReader();
      const chunks: Uint8Array[] = [];
      let length = 0;
      if (Number(response.headers.get("content-length") ?? "0") > 65_536)
        throw new InstagramProviderError("provider_unavailable", sideEffecting, undefined, {
          operation,
          reason: "oversized_response",
          httpStatus: response.status,
        });
      if (reader !== undefined) {
        try {
          while (true) {
            const part = await reader.read();
            if (part.done) break;
            const chunk: unknown = part.value;
            if (!(chunk instanceof Uint8Array))
              throw new InstagramProviderError("provider_unavailable", sideEffecting, undefined, {
                operation,
                reason: "invalid_response",
                httpStatus: response.status,
              });
            length += chunk.byteLength;
            if (length > 65_536) {
              await reader.cancel();
              throw new InstagramProviderError("provider_unavailable", sideEffecting, undefined, {
                operation,
                reason: "oversized_response",
                httpStatus: response.status,
              });
            }
            chunks.push(chunk);
          }
        } finally {
          reader.releaseLock();
        }
      }
      let payload: unknown;
      try {
        payload = JSON.parse(
          Buffer.concat(chunks).toString("utf8"),
          (key: string, value: unknown, context?: unknown): unknown => {
            // Node 24 exposes the original numeric lexeme. Do not stringify a rounded
            // Number: Instagram IDs can exceed Number.MAX_SAFE_INTEGER.
            if (key !== "user_id" || typeof value !== "number") return value;
            const source = record(context)?.["source"];
            return validId(source) ? source : value;
          },
        );
      } catch {
        throw new InstagramProviderError("provider_unavailable", sideEffecting, undefined, {
          operation,
          reason: "invalid_json",
          httpStatus: response.status,
        });
      }
      const error = record(record(payload)?.["error"]);
      const flatError = record(payload)?.["error_type"];
      if (!response.ok || error !== null || flatError !== undefined) {
        const rawCode = error?.["code"] ?? record(payload)?.["code"];
        const code =
          typeof rawCode === "number" && Number.isSafeInteger(rawCode) && rawCode >= 0
            ? rawCode
            : undefined;
        const rawSubcode = error?.["error_subcode"];
        const subcode =
          typeof rawSubcode === "number" && Number.isSafeInteger(rawSubcode) && rawSubcode >= 0
            ? rawSubcode
            : undefined;
        const category: ChannelFailureCategory =
          code === 190 || response.status === 401
            ? "authentication_failed"
            : response.status === 429 || (code !== undefined && [4, 17, 32, 613].includes(code))
              ? "rate_limited"
              : response.status >= 500
                ? "provider_unavailable"
                : "permanent_rejection";
        const retry = Number(response.headers.get("retry-after"));
        throw new InstagramProviderError(
          category,
          sideEffecting && category === "provider_unavailable",
          category === "rate_limited" && Number.isFinite(retry) && retry > 0
            ? Math.min(retry, 300) * 1000
            : undefined,
          {
            operation,
            reason: "http_rejection",
            httpStatus: response.status,
            ...(code === undefined ? {} : { providerCode: code }),
            ...(subcode === undefined ? {} : { providerSubcode: subcode }),
          },
        );
      }
      return payload;
    } catch (error) {
      if (error instanceof InstagramProviderError) throw error;
      throw new InstagramProviderError("provider_unavailable", sideEffecting, undefined, {
        operation,
        reason: "network",
      });
    } finally {
      clearTimeout(timeout);
    }
  };
  const bearer = (token: string): Record<string, string> => {
    if (!tokenValue(token)) throw new InstagramProviderError("authentication_failed", false);
    return { authorization: `Bearer ${token}` };
  };
  const longCredential = (
    payload: unknown,
    operation: "long_token" | "refresh",
  ): Readonly<{ expiresInSeconds: number; token: string }> => {
    const result = record(payload);
    if (
      !tokenValue(result?.["access_token"]) ||
      !expires(result?.["expires_in"]) ||
      result["token_type"] !== "bearer"
    )
      throw new InstagramProviderError("authentication_failed", false, undefined, {
        operation,
        reason: "invalid_response",
        invalidField: !tokenValue(result?.["access_token"])
          ? "access_token"
          : !expires(result["expires_in"])
            ? "expires_in"
            : "token_type",
      });
    return Object.freeze({ expiresInSeconds: result["expires_in"], token: result["access_token"] });
  };
  return Object.freeze<InstagramPlatformClient>({
    exchangeCode: async (code): Promise<InstagramAccountCredential> => {
      const form = new FormData();
      for (const [key, value] of Object.entries({
        client_id: config.appId,
        client_secret: config.appSecret,
        grant_type: "authorization_code",
        redirect_uri: config.oauthRedirectUri,
        code,
      }))
        form.set(key, value);
      const short = one(
        await invoke(
          "https://api.instagram.com/oauth/access_token",
          {
            method: "POST",
            body: form,
          },
          "short_token",
        ),
      );
      if (!tokenValue(short?.["access_token"]) || !validId(short["user_id"]))
        throw new InstagramProviderError("authentication_failed", false, undefined, {
          operation: "short_token",
          reason: "invalid_response",
          invalidField:
            short === null
              ? "response_shape"
              : !tokenValue(short["access_token"])
                ? "access_token"
                : "user_id",
        });
      // Meta's token exchange requires server-side query parameters. This URL is never logged or returned.
      const query = new URLSearchParams({
        grant_type: "ig_exchange_token",
        client_secret: config.appSecret,
        access_token: short["access_token"],
      });
      const long = longCredential(
        await invoke(
          `https://graph.instagram.com/access_token?${query.toString()}`,
          {
            method: "GET",
          },
          "long_token",
        ),
        "long_token",
      );
      const profile = one(
        await invoke(
          `${graph}/me?fields=user_id,account_type`,
          {
            method: "GET",
            headers: bearer(long.token),
          },
          "profile",
        ),
      );
      if (
        !validId(profile?.["user_id"]) ||
        !["Business", "Media_Creator", "BUSINESS", "MEDIA_CREATOR"].includes(
          String(profile["account_type"]),
        )
      )
        throw new InstagramProviderError("authentication_failed", false, undefined, {
          operation: "profile",
          reason: "invalid_response",
          invalidField:
            profile === null
              ? "response_shape"
              : !validId(profile["user_id"])
                ? "user_id"
                : "account_type",
        });
      // user_id is the canonical professional ID used in webhook entry.id; id is app scoped.
      return Object.freeze({ ...long, accountId: profile["user_id"] });
    },
    refreshToken: async (token) =>
      longCredential(
        await invoke(
          `https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token`,
          { method: "GET", headers: bearer(token) },
          "refresh",
        ),
        "refresh",
      ),
    subscribeMessages: async (accountId, token) => {
      if (!validId(accountId)) throw new InstagramProviderError("authentication_failed", false);
      const result = record(
        await invoke(
          `${graph}/${accountId}/subscribed_apps`,
          {
            method: "POST",
            headers: { ...bearer(token), "content-type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({ subscribed_fields: "messages" }),
          },
          "subscription",
        ),
      );
      if (result?.["success"] !== true)
        throw new InstagramProviderError("permanent_rejection", false, undefined, {
          operation: "subscription",
          reason: "invalid_response",
          invalidField: "success",
        });
    },
    sendMessage: async ({ accountId, recipientId, text, token }) => {
      if (
        !validId(accountId) ||
        !validId(recipientId) ||
        text.length < 1 ||
        Buffer.byteLength(text, "utf8") > 1000
      )
        throw new InstagramProviderError("unsupported_content", false);
      const result = record(
        await invoke(
          `${graph}/${accountId}/messages`,
          {
            method: "POST",
            headers: { ...bearer(token), "content-type": "application/json" },
            body: JSON.stringify({ recipient: { id: recipientId }, message: { text } }),
          },
          "send",
          true,
        ),
      );
      if (
        result?.["recipient_id"] !== recipientId ||
        typeof result["message_id"] !== "string" ||
        result["message_id"].length < 1 ||
        result["message_id"].length > 1024
      )
        throw new InstagramProviderError("provider_unavailable", true);
      return Object.freeze({ messageId: result["message_id"] });
    },
  });
};
