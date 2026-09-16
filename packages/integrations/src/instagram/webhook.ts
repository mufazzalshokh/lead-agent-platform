import { createHmac, timingSafeEqual } from "node:crypto";
import {
  InboundAttachmentContentSchema,
  InboundQuickReplyContentSchema,
  InboundTextContentSchema,
  isSchemaValue,
} from "@lead-agent/contracts";
import type { InstagramInboundMessage } from "@lead-agent/application";

export const INSTAGRAM_WEBHOOK_MAXIMUM_BYTES = 512 * 1024;
export const verifyInstagramWebhookSignature = (
  body: unknown,
  signature: unknown,
  appSecret: string,
): body is Buffer => {
  if (
    !Buffer.isBuffer(body) ||
    body.byteLength > INSTAGRAM_WEBHOOK_MAXIMUM_BYTES ||
    typeof signature !== "string" ||
    !/^sha256=[A-Fa-f0-9]{64}$/u.test(signature)
  )
    return false;
  const received = Buffer.from(signature.slice(7), "hex");
  return timingSafeEqual(createHmac("sha256", appSecret).update(body).digest(), received);
};
export const verifyInstagramWebhookChallenge = (
  query: unknown,
  verifyToken: string,
): string | null => {
  const object = record(query);
  const token = object?.["hub.verify_token"],
    challenge = object?.["hub.challenge"];
  if (
    object?.["hub.mode"] !== "subscribe" ||
    typeof token !== "string" ||
    token.length > 256 ||
    typeof challenge !== "string" ||
    !/^[0-9]{1,64}$/u.test(challenge)
  )
    return null;
  const left = Buffer.from(token),
    right = Buffer.from(verifyToken);
  return left.byteLength === right.byteLength && timingSafeEqual(left, right) ? challenge : null;
};
const record = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
const id = (value: unknown): value is string =>
  typeof value === "string" && /^[1-9][0-9]{0,31}$/u.test(value);
const boundedStructure = (value: unknown, depth = 0, budget = { remaining: 20_000 }): boolean => {
  if (depth > 12 || --budget.remaining < 0) return false;
  if (typeof value === "string") return value.length <= 8192;
  if (Array.isArray(value))
    return (
      value.length <= 100 &&
      value.every((item: unknown) => boundedStructure(item, depth + 1, budget))
    );
  const object = record(value);
  return (
    object === null ||
    (Object.keys(object).length <= 64 &&
      Object.values(object).every((item) => boundedStructure(item, depth + 1, budget)))
  );
};
const contentFor = (
  message: Record<string, unknown>,
): InstagramInboundMessage["content"] | null => {
  const quick = record(message["quick_reply"]);
  if (quick !== null) {
    const content: unknown = {
      type: "quick_reply",
      action_token: quick["payload"],
      display_text: message["text"],
    };
    return isSchemaValue(InboundQuickReplyContentSchema, content) ? content : null;
  }
  const attachments = message["attachments"];
  if (attachments !== undefined) {
    if (!Array.isArray(attachments) || attachments.length !== 1) return null;
    const attachment = record(attachments[0]);
    const payload = record(attachment?.["payload"]);
    const ref = payload?.["url"];
    if (typeof ref !== "string" || ref.length < 1 || ref.length > 2048) return null;
    const media = attachment?.["type"];
    const content: unknown = {
      type: "attachment",
      media_kind:
        media === "image"
          ? "image"
          : media === "audio"
            ? "audio"
            : media === "file"
              ? "document"
              : "other",
      provider_media_ref: ref,
      caption: typeof message["text"] === "string" ? message["text"] : null,
    };
    // Attachment URLs remain encrypted untrusted metadata: never fetched, downloaded or rendered here.
    return isSchemaValue(InboundAttachmentContentSchema, content) ? content : null;
  }
  const content: unknown = { type: "text", text: message["text"] };
  return isSchemaValue(InboundTextContentSchema, content) ? content : null;
};

/** Call only after authenticating the exact raw body. Unknown event kinds cannot mutate business state. */
export const normalizeInstagramWebhook = (
  body: Buffer,
  receivedAt: Date,
): readonly InstagramInboundMessage[] => {
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body));
  } catch {
    return Object.freeze([]);
  }
  if (!boundedStructure(value)) return Object.freeze([]);
  const root = record(value);
  if (
    root?.["object"] !== "instagram" ||
    !Array.isArray(root["entry"]) ||
    root["entry"].length > 50
  )
    return Object.freeze([]);
  const accepted: InstagramInboundMessage[] = [];
  for (const rawEntry of root["entry"]) {
    const entry = record(rawEntry);
    if (!id(entry?.["id"]) || !Array.isArray(entry["messaging"]) || entry["messaging"].length > 100)
      continue;
    for (const rawEvent of entry["messaging"]) {
      const event = record(rawEvent),
        sender = record(event?.["sender"]),
        recipient = record(event?.["recipient"]),
        message = record(event?.["message"]);
      if (
        message === null ||
        event?.["is_self"] === true ||
        message["is_self"] === true ||
        message["is_echo"] === true ||
        message["is_deleted"] === true ||
        message["is_unsupported"] === true ||
        event?.["postback"] !== undefined ||
        event?.["read"] !== undefined ||
        event?.["delivery"] !== undefined
      )
        continue;
      if (
        !id(sender?.["id"]) ||
        recipient?.["id"] !== entry["id"] ||
        sender["id"] === entry["id"] ||
        typeof message["mid"] !== "string" ||
        message["mid"].length < 1 ||
        message["mid"].length > 1024
      )
        continue;
      const timestamp = event?.["timestamp"];
      if (
        typeof timestamp !== "number" ||
        !Number.isSafeInteger(timestamp) ||
        timestamp < Date.UTC(2000, 0, 1) ||
        timestamp > receivedAt.getTime() + 5 * 60 * 1000
      )
        continue;
      const content = contentFor(message);
      if (content === null) continue;
      accepted.push(
        Object.freeze({
          accountId: entry["id"],
          customerId: sender["id"],
          messageId: message["mid"],
          occurredAt: new Date(timestamp).toISOString(),
          content,
        }),
      );
    }
  }
  return Object.freeze(accepted);
};
