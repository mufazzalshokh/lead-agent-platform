import { describe, expect, it } from "vitest";

import {
  WidgetConversationCreateInputSchema,
  WidgetConversationCreateResponseSchema,
  WidgetMessageCollectionResponseSchema,
  WidgetMessageCreateInputSchema,
  WidgetSessionCreateInputSchema,
  isSchemaValue,
} from "../../packages/contracts/src/index.js";

const CONVERSATION_ID = "0193f1a8-7f65-7c28-a434-a10796c41c2b";
const MESSAGE_ID = "0193f1a8-7f65-7c28-a434-a10796c41c2c";
const REQUEST_ID = "request:s10-contract";
const NOW = "2026-09-15T10:00:00.000Z";

describe("S10 Widget public contracts", () => {
  it("accepts bounded bootstrap and text inputs without authority selectors", () => {
    expect(
      isSchemaValue(WidgetSessionCreateInputSchema, {
        page_url: "https://clinic.example/services",
        requested_locale: "uz",
        widget_key: "A".repeat(32),
      }),
    ).toBe(true);
    expect(
      isSchemaValue(WidgetConversationCreateInputSchema, {
        client_message_id: "browser.message-1",
        kind: "text",
        locale_hint: null,
        text: "Salom",
      }),
    ).toBe(true);
    expect(
      isSchemaValue(WidgetMessageCreateInputSchema, {
        client_message_id: "browser.message-2",
        kind: "text",
        locale_hint: "ru",
        text: "<script>alert(1)</script>",
      }),
    ).toBe(true);
    expect(
      isSchemaValue(WidgetMessageCreateInputSchema, {
        client_message_id: "browser.message-3",
        kind: "text",
        locale_hint: "en",
        text: "x",
      }),
    ).toBe(true);
    expect(
      isSchemaValue(WidgetMessageCreateInputSchema, {
        client_message_id: "browser.message-4",
        kind: "text",
        locale_hint: "ru",
        text: "x".repeat(4_000),
      }),
    ).toBe(true);
  });

  it.each([
    { client_message_id: "short", kind: "text", locale_hint: null, text: "ok" },
    { client_message_id: "browser.message-1", kind: "text", locale_hint: "de", text: "ok" },
    { client_message_id: "browser.message-1", kind: "text", locale_hint: null, text: "" },
    {
      client_message_id: "browser.message-1",
      kind: "text",
      locale_hint: null,
      text: "x".repeat(4_001),
    },
    {
      client_message_id: "browser.message-1",
      kind: "text",
      locale_hint: null,
      text: "ok",
      organization_id: CONVERSATION_ID,
    },
  ])("rejects invalid text or authority-smuggling input %#", (candidate) => {
    expect(isSchemaValue(WidgetMessageCreateInputSchema, candidate)).toBe(false);
  });

  it("accepts only customer-safe conversation and message response projections", () => {
    const conversation = {
      closed_at: null,
      id: CONVERSATION_ID,
      last_activity_at: NOW,
      preferred_locale: "uz",
      resolved_at: null,
      started_at: NOW,
      status: "open",
    };
    expect(
      isSchemaValue(WidgetConversationCreateResponseSchema, {
        data: {
          bearer_token: "x".repeat(80),
          conversation,
          expires_at: NOW,
          message: { id: MESSAGE_ID, processing_status: "accepted", sequence_no: 1 },
        },
        meta: { request_id: REQUEST_ID },
      }),
    ).toBe(true);
    expect(
      isSchemaValue(WidgetMessageCollectionResponseSchema, {
        data: [
          {
            body_text: null,
            conversation_id: CONVERSATION_ID,
            created_at: NOW,
            direction: "inbound",
            id: MESSAGE_ID,
            locale: "uz",
            redacted_at: NOW,
            sequence_no: 1,
          },
        ],
        meta: { has_more: false, next_after: null, request_id: REQUEST_ID },
      }),
    ).toBe(true);
    expect(
      isSchemaValue(WidgetMessageCollectionResponseSchema, {
        data: [{ body_ciphertext: "leak", conversation_id: CONVERSATION_ID, id: MESSAGE_ID }],
        meta: { has_more: false, next_after: null, request_id: REQUEST_ID },
      }),
    ).toBe(false);
  });
});
