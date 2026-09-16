import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  normalizeInstagramWebhook,
  verifyInstagramWebhookChallenge,
  verifyInstagramWebhookSignature,
} from "../../packages/integrations/src/instagram/webhook.js";
import { ACCOUNT_ID, CUSTOMER_ID, NOW, instagramConfig } from "./fixtures.js";

export const instagramMessageBody = (
  message: Readonly<Record<string, unknown>> = {},
  event: Readonly<Record<string, unknown>> = {},
) =>
  Buffer.from(
    JSON.stringify({
      object: "instagram",
      entry: [
        {
          id: ACCOUNT_ID,
          messaging: [
            {
              sender: { id: CUSTOMER_ID },
              recipient: { id: ACCOUNT_ID },
              timestamp: NOW.getTime(),
              message: {
                mid: "mid.synthetic",
                text: "Salom / Привет / Hello <b>data</b>",
                ...message,
              },
              ...event,
            },
          ],
        },
      ],
    }),
  );
export const signatureFor = (body: Buffer): string =>
  `sha256=${createHmac("sha256", instagramConfig.appSecret).update(body).digest("hex")}`;
describe("Instagram authenticated bounded DM subset", () => {
  it("authenticates exact raw bytes, not a reserialized payload", () => {
    const body = instagramMessageBody();
    expect(
      verifyInstagramWebhookSignature(body, signatureFor(body), instagramConfig.appSecret),
    ).toBe(true);
    expect(
      verifyInstagramWebhookSignature(
        Buffer.concat([body, Buffer.from(" ")]),
        signatureFor(body),
        instagramConfig.appSecret,
      ),
    ).toBe(false);
  });
  it.each([undefined, "sha256=bad", "sha1=" + "0".repeat(40), ["sha256=" + "0".repeat(64)]])(
    "rejects malformed signature %s",
    (signature) => {
      expect(
        verifyInstagramWebhookSignature(
          instagramMessageBody(),
          signature,
          instagramConfig.appSecret,
        ),
      ).toBe(false);
    },
  );
  it("rejects oversize raw bodies and non-buffer input", () => {
    const body = Buffer.alloc(512 * 1024 + 1);
    expect(
      verifyInstagramWebhookSignature(body, signatureFor(body), instagramConfig.appSecret),
    ).toBe(false);
    expect(
      verifyInstagramWebhookSignature(
        {},
        signatureFor(instagramMessageBody()),
        instagramConfig.appSecret,
      ),
    ).toBe(false);
  });
  it("returns only the verified numeric plain-text challenge", () => {
    const query = {
      "hub.mode": "subscribe",
      "hub.verify_token": instagramConfig.webhookVerifyToken,
      "hub.challenge": "12345",
    };
    expect(verifyInstagramWebhookChallenge(query, instagramConfig.webhookVerifyToken)).toBe(
      "12345",
    );
    for (const patch of [
      { "hub.mode": "unsubscribe" },
      { "hub.verify_token": "wrong" },
      { "hub.challenge": "<script>" },
      { "hub.challenge": ["1"] },
    ])
      expect(
        verifyInstagramWebhookChallenge({ ...query, ...patch }, instagramConfig.webhookVerifyToken),
      ).toBeNull();
  });
  it("normalizes stable IDs and UTC time without interpreting HTML or phone requirements", () => {
    expect(normalizeInstagramWebhook(instagramMessageBody(), NOW)).toEqual([
      {
        accountId: ACCOUNT_ID,
        customerId: CUSTOMER_ID,
        messageId: "mid.synthetic",
        occurredAt: NOW.toISOString(),
        content: { type: "text", text: "Salom / Привет / Hello <b>data</b>" },
      },
    ]);
  });
  it.each([
    { is_echo: true },
    { is_self: true },
    { is_deleted: true },
    { is_unsupported: true },
    { text: "" },
    { text: "x".repeat(4001) },
    { mid: "" },
    {
      attachments: [
        { type: "image", payload: { url: "a" } },
        { type: "image", payload: { url: "b" } },
      ],
    },
  ])("ignores unsupported message subset %j", (message) => {
    expect(normalizeInstagramWebhook(instagramMessageBody(message), NOW)).toEqual([]);
  });
  it.each([
    { sender: { id: ACCOUNT_ID } },
    { sender: { id: "username-not-id" } },
    { recipient: { id: CUSTOMER_ID } },
    { timestamp: NOW.getTime() + 300001 },
    { timestamp: 1 },
    { read: {} },
    { delivery: {} },
    { postback: {} },
    { is_self: true },
  ])("ignores wrong recipient/time/control event %j", (event) => {
    expect(normalizeInstagramWebhook(instagramMessageBody({}, event), NOW)).toEqual([]);
  });
  it.each([
    ["image", "image"],
    ["audio", "audio"],
    ["file", "document"],
    ["video", "other"],
  ] as const)("quarantines %s reference as %s metadata only", (type, media) => {
    const url = "http://127.0.0.1/private-never-fetched";
    expect(
      normalizeInstagramWebhook(
        instagramMessageBody({ attachments: [{ type, payload: { url } }] }),
        NOW,
      )[0]?.content,
    ).toEqual({
      type: "attachment",
      media_kind: media,
      provider_media_ref: url,
      caption: "Salom / Привет / Hello <b>data</b>",
    });
  });
  it("preserves quick-reply data without executing its payload", () => {
    expect(
      normalizeInstagramWebhook(
        instagramMessageBody({ quick_reply: { payload: "opaque-action" } }),
        NOW,
      )[0]?.content.type,
    ).toBe("quick_reply");
  });
  it("routes batched entries independently and ignores forged organization fields", () => {
    const original: unknown = JSON.parse(instagramMessageBody().toString());
    if (
      typeof original !== "object" ||
      original === null ||
      !("entry" in original) ||
      !Array.isArray(original.entry)
    )
      throw new Error("Invalid batch fixture");
    const first: unknown = original.entry[0];
    if (typeof first !== "object" || first === null) throw new Error("Invalid entry");
    const batch = Buffer.from(
      JSON.stringify({
        object: "instagram",
        organization_id: "forged",
        entry: [first, { ...first, id: "111" }, { id: "unknown", messaging: [] }],
      }),
    );
    expect(normalizeInstagramWebhook(batch, NOW)).toHaveLength(1);
  });
  it("bounds nested JSON, event count, malformed UTF-8 and invalid JSON", () => {
    let deep: unknown = {};
    for (let i = 0; i < 15; i++) deep = { nested: deep };
    for (const body of [
      Buffer.from("{"),
      Buffer.from([0xff]),
      Buffer.from(JSON.stringify({ object: "instagram", entry: [], deep })),
      Buffer.from(
        JSON.stringify({ object: "instagram", entry: Array.from({ length: 51 }, () => ({})) }),
      ),
    ])
      expect(normalizeInstagramWebhook(body, NOW)).toEqual([]);
  });
});
