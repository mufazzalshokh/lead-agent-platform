import type { TelegramInboundContent, TelegramNormalizedUpdate } from "@lead-agent/application";
import { TelegramApplicationError } from "@lead-agent/application";

const MAX_SAFE_TELEGRAM_ID = 9_007_199_254_740_991;
const START_PATTERN = /^\/start ([A-Za-z0-9_-]{43})$/u;

const record = (value: unknown): Readonly<Record<string, unknown>> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : null;
const integerId = (value: unknown): string | null =>
  typeof value === "number" &&
  Number.isSafeInteger(value) &&
  value >= 0 &&
  value <= MAX_SAFE_TELEGRAM_ID
    ? String(value)
    : null;
const bounded = (value: unknown, maximum: number): string | null =>
  typeof value === "string" &&
  value === value.trim() &&
  value.length >= 1 &&
  value.length <= maximum
    ? value
    : null;
const providerInstant = (value: unknown, now: Date, recent = true): string | null => {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) return null;
  const instant = new Date(value * 1_000);
  if (
    !Number.isFinite(instant.getTime()) ||
    instant.getTime() > now.getTime() + 5 * 60 * 1_000 ||
    instant.getTime() < (recent ? now.getTime() - 7 * 24 * 60 * 60 * 1_000 : Date.UTC(2013, 0, 1))
  ) {
    return null;
  }
  return instant.toISOString();
};

const user = (value: unknown): Readonly<{ id: string; isBot: boolean }> | null => {
  const candidate = record(value);
  const id = integerId(candidate?.["id"]);
  if (candidate === null || id === null || id === "0" || typeof candidate["is_bot"] !== "boolean")
    return null;
  return Object.freeze({ id, isBot: candidate["is_bot"] });
};

const privateChatId = (value: unknown): string | null => {
  const chat = record(value);
  return chat?.["type"] === "private" ? integerId(chat["id"]) : null;
};

const fileId = (value: unknown): string | null => bounded(record(value)?.["file_id"], 1_000);

const attachment = (message: Readonly<Record<string, unknown>>): TelegramInboundContent | null => {
  let mediaKind: "audio" | "document" | "image" | "other" | null = null;
  let providerMediaRef: string | null = null;
  const photos = message["photo"];
  if (Array.isArray(photos) && photos.length > 0) {
    mediaKind = "image";
    providerMediaRef = fileId(photos.at(-1));
  } else if (record(message["document"]) !== null) {
    mediaKind = "document";
    providerMediaRef = fileId(message["document"]);
  } else if (record(message["audio"]) !== null || record(message["voice"]) !== null) {
    mediaKind = "audio";
    providerMediaRef = fileId(message["audio"] ?? message["voice"]);
  } else {
    for (const key of ["animation", "sticker", "video", "video_note"] as const) {
      const candidate = fileId(message[key]);
      if (candidate !== null) {
        mediaKind = "other";
        providerMediaRef = candidate;
        break;
      }
    }
  }
  if (mediaKind === null || providerMediaRef === null) return null;
  const rawCaption = message["caption"];
  const caption =
    rawCaption === undefined
      ? null
      : typeof rawCaption === "string" && rawCaption.length <= 1_000
        ? rawCaption
        : undefined;
  if (caption === undefined) return null;
  return Object.freeze({
    caption,
    media_kind: mediaKind,
    provider_media_ref: providerMediaRef,
    type: "attachment" as const,
  });
};

const content = (message: Readonly<Record<string, unknown>>): TelegramInboundContent | null => {
  if (typeof message["text"] === "string") {
    const text = message["text"];
    return text.length >= 1 && text.length <= 4_000
      ? Object.freeze({ locale_hint: null, text, type: "text" as const })
      : null;
  }
  return attachment(message);
};

const ignored = (updateId: string | null): TelegramNormalizedUpdate =>
  Object.freeze({ kind: "ignored", updateId });

export const normalizeTelegramUpdate = (
  raw: unknown,
  now: Date = new Date(),
): TelegramNormalizedUpdate => {
  const update = record(raw);
  const updateId = integerId(update?.["update_id"]);
  if (update === null || updateId === null || !Number.isFinite(now.getTime())) {
    throw new TelegramApplicationError("validation_failed");
  }

  const startMessage = record(update["message"]);
  if (startMessage !== null) {
    const sender = user(startMessage["from"]);
    const chatId = privateChatId(startMessage["chat"]);
    const match =
      typeof startMessage["text"] === "string" ? START_PATTERN.exec(startMessage["text"]) : null;
    if (
      sender === null ||
      sender.isBot ||
      chatId === null ||
      sender.id !== chatId ||
      match?.[1] === undefined
    ) {
      return ignored(updateId);
    }
    return Object.freeze({
      kind: "onboarding_start",
      nonce: match[1],
      ownerUserId: sender.id,
      updateId,
    });
  }

  const connection = record(update["business_connection"]);
  if (connection !== null) {
    const id = bounded(connection["id"], 255);
    const owner = user(connection["user"]);
    const establishedAt = providerInstant(connection["date"], now, false);
    const rights = record(connection["rights"]);
    if (
      id === null ||
      owner === null ||
      owner.isBot ||
      establishedAt === null ||
      typeof connection["is_enabled"] !== "boolean"
    ) {
      return ignored(updateId);
    }
    return Object.freeze({
      businessConnectionId: id,
      canReply: rights?.["can_reply"] === true,
      establishedAt,
      isEnabled: connection["is_enabled"],
      kind: "business_connection",
      ownerUserId: owner.id,
      updateId,
    });
  }

  const message = record(update["business_message"]);
  if (message !== null) {
    const businessConnectionId = bounded(message["business_connection_id"], 255);
    const chatId = privateChatId(message["chat"]);
    const sender = user(message["from"]);
    const messageId = integerId(message["message_id"]);
    const occurredAt = providerInstant(message["date"], now);
    const normalizedContent = content(message);
    if (
      businessConnectionId === null ||
      chatId === null ||
      sender === null ||
      sender.id !== chatId ||
      messageId === null ||
      occurredAt === null ||
      normalizedContent === null
    ) {
      return ignored(updateId);
    }
    return Object.freeze({
      businessConnectionId,
      chatId,
      content: normalizedContent,
      kind: "business_message",
      messageId,
      occurredAt,
      senderIsBot: sender.isBot || record(message["sender_business_bot"]) !== null,
      senderUserId: sender.id,
      updateId,
    });
  }

  const callback = record(update["callback_query"]);
  if (callback !== null) {
    const sender = user(callback["from"]);
    const message = record(callback["message"]);
    const callbackQueryId = bounded(callback["id"], 255);
    const actionToken = typeof callback["data"] === "string" ? callback["data"] : null;
    const bytes = actionToken === null ? 0 : Buffer.byteLength(actionToken, "utf8");
    const businessConnectionId = bounded(message?.["business_connection_id"], 255);
    const chatId = privateChatId(message?.["chat"]);
    const occurredAt = providerInstant(message?.["date"], now);
    if (
      sender === null ||
      sender.isBot ||
      callbackQueryId === null ||
      actionToken === null ||
      bytes < 1 ||
      bytes > 64 ||
      businessConnectionId === null ||
      chatId === null ||
      sender.id !== chatId ||
      occurredAt === null
    ) {
      return ignored(updateId);
    }
    return Object.freeze({
      businessConnectionId,
      callbackQueryId,
      chatId,
      content: Object.freeze({
        action_token: actionToken,
        display_text: null,
        type: "quick_reply",
      }),
      kind: "callback_query",
      occurredAt: now.toISOString(),
      senderIsBot: false,
      senderUserId: sender.id,
      updateId,
    });
  }

  return ignored(updateId);
};
