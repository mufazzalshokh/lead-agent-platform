import { describe, expect, expectTypeOf, it } from "vitest";

import {
  StaffContactIdentitySchema,
  StaffContactReadParamsSchema,
  StaffContactResponseSchema,
  StaffContactSchema,
  StaffConversationCollectionResponseSchema,
  StaffConversationListQuerySchema,
  StaffConversationReadParamsSchema,
  StaffConversationResponseSchema,
  StaffConversationSchema,
  StaffLeadCollectionResponseSchema,
  StaffLeadListQuerySchema,
  StaffLeadReadParamsSchema,
  StaffLeadResponseSchema,
  StaffLeadSchema,
  StaffMessageCollectionResponseSchema,
  StaffMessageListQuerySchema,
  StaffMessageSchema,
  isSchemaValue,
  type StaffContact,
  type StaffConversation,
  type StaffLead,
  type StaffMessage,
} from "../../packages/contracts/src/index.js";

const CONTACT_ID = "0193f1a8-7f65-7c28-a434-a10796c41c2b";
const LEAD_ID = "0193f1a8-7f65-7c28-a434-a10796c41c2c";
const CONVERSATION_ID = "0193f1a8-7f65-7c28-a434-a10796c41c2d";
const MESSAGE_ID = "0193f1a8-7f65-7c28-a434-a10796c41c2e";
const REPLY_ID = "0193f1a8-7f65-7c28-a434-a10796c41c2f";
const CHANNEL_ID = "0193f1a8-7f65-7c28-a434-a10796c41c30";
const LOCATION_ID = "0193f1a8-7f65-7c28-a434-a10796c41c31";
const SERVICE_ID = "0193f1a8-7f65-7c28-a434-a10796c41c32";
const MEMBERSHIP_ID = "0193f1a8-7f65-7c28-a434-a10796c41c33";
const POLICY_ID = "0193f1a8-7f65-7c28-a434-a10796c41c34";
const IDENTITY_ID = "0193f1a8-7f65-7c28-a434-a10796c41c35";
const HANDOFF_ID = "0193f1a8-7f65-7c28-a434-a10796c41c36";
const REQUEST_ID = "req_s9b_contracts";
const NOW = "2026-09-15T10:00:00Z";
const LATER = "2026-09-15T11:00:00Z";
const CURSOR = "YWJj";

const maskedIdentity = {
  channel_connection_id: CHANNEL_ID,
  display_redacted: "Telegram user •42",
  id: IDENTITY_ID,
  identity_type: "telegram_user",
  status: "active",
  validation_status: "verified",
  value: null,
  verified_at: NOW,
} as const;

const maskedContact = {
  anonymized_at: null,
  created_at: NOW,
  display_name: null,
  first_seen_at: NOW,
  id: CONTACT_ID,
  identities: [maskedIdentity],
  last_seen_at: LATER,
  preferred_locale: "uz",
  sensitive_fields_visible: false,
  status: "active",
  updated_at: LATER,
  version: 2,
} as const;

const lead = {
  assigned_membership_id: MEMBERSHIP_ID,
  booking_requested_at: null,
  campaign_key: "telegram.autumn",
  closed_at: null,
  closed_reason: null,
  contact_id: CONTACT_ID,
  converted_at: null,
  created_at: NOW,
  engaged_at: LATER,
  id: LEAD_ID,
  location_id: LOCATION_ID,
  qualification_policy_id: POLICY_ID,
  qualification_reason_codes: [],
  qualified_at: null,
  service_id: SERVICE_ID,
  source_channel_connection_id: CHANNEL_ID,
  status: "engaged",
  updated_at: LATER,
  version: 2,
} as const;

const conversation = {
  active_handoff_id: HANDOFF_ID,
  automation_mode: "staff",
  channel_connection_id: CHANNEL_ID,
  closed_at: null,
  contact_id: CONTACT_ID,
  created_at: NOW,
  id: CONVERSATION_ID,
  last_activity_at: LATER,
  lead_id: LEAD_ID,
  participant: {
    contact_id: CONTACT_ID,
    display_redacted: "Telegram user •42",
    identity_type: "telegram_user",
  },
  preferred_locale: "uz",
  resolved_at: null,
  started_at: NOW,
  status: "awaiting_staff",
  updated_at: LATER,
  version: 2,
} as const;

const inboundMessage = {
  body_text: "Salom",
  channel_connection_id: CHANNEL_ID,
  content_type: "text",
  conversation_id: CONVERSATION_ID,
  created_at: NOW,
  delivery_status: "not_applicable",
  direction: "inbound",
  id: MESSAGE_ID,
  locale: "uz",
  processing_status: "processed",
  redacted_at: null,
  reply_to_message_id: null,
  sender_membership_id: null,
  sender_type: "customer",
  sequence_no: 1,
} as const;

describe("S9 staff Contact read contracts", () => {
  it("accepts masked, sensitive, and anonymized representations", () => {
    const sensitive = {
      ...maskedContact,
      display_name: "Aziza",
      identities: [{ ...maskedIdentity, value: "123456789" }],
      sensitive_fields_visible: true,
    } as const;
    const anonymized = {
      ...maskedContact,
      anonymized_at: LATER,
      identities: [
        {
          ...maskedIdentity,
          display_redacted: null,
          status: "anonymized",
          value: null,
          verified_at: null,
        },
      ],
      last_seen_at: NOW,
      preferred_locale: null,
      status: "anonymized",
      updated_at: LATER,
    } as const;

    expect(isSchemaValue(StaffContactSchema, maskedContact)).toBe(true);
    expect(isSchemaValue(StaffContactSchema, sensitive)).toBe(true);
    expect(isSchemaValue(StaffContactSchema, anonymized)).toBe(true);
    expect(isSchemaValue(StaffContactIdentitySchema, sensitive.identities[0])).toBe(true);
  });

  it.each([
    { ...maskedContact, display_name: "Must not leak" },
    {
      ...maskedContact,
      identities: [{ ...maskedIdentity, value: "raw-telegram-id" }],
    },
    { ...maskedContact, organization_id: CONTACT_ID },
    {
      ...maskedContact,
      identities: [{ ...maskedIdentity, lookup_hash: "internal" }],
    },
    {
      ...maskedContact,
      anonymized_at: LATER,
      display_name: "Must remain erased",
      status: "anonymized",
    },
  ])("rejects masked, internal, or anonymized data leakage %#", (candidate) => {
    expect(isSchemaValue(StaffContactSchema, candidate)).toBe(false);
  });

  it("publishes canonical params and response envelope", () => {
    expect(isSchemaValue(StaffContactReadParamsSchema, { id: CONTACT_ID })).toBe(true);
    expect(
      isSchemaValue(StaffContactResponseSchema, {
        data: maskedContact,
        meta: { request_id: REQUEST_ID },
      }),
    ).toBe(true);
    expectTypeOf<StaffContact>().toMatchTypeOf<{ id: string; sensitive_fields_visible: boolean }>();
  });
});

describe("S9 staff Lead read contracts", () => {
  it("accepts the exact projection, params, and response envelopes", () => {
    expect(isSchemaValue(StaffLeadSchema, lead)).toBe(true);
    expect(isSchemaValue(StaffLeadReadParamsSchema, { id: LEAD_ID })).toBe(true);
    expect(
      isSchemaValue(StaffLeadResponseSchema, {
        data: lead,
        meta: { request_id: REQUEST_ID },
      }),
    ).toBe(true);
    expect(
      isSchemaValue(StaffLeadCollectionResponseSchema, {
        data: [lead],
        meta: { has_more: false, next_cursor: null, request_id: REQUEST_ID },
      }),
    ).toBe(true);
    expectTypeOf<StaffLead>().toMatchTypeOf<{ id: string; status: string }>();
  });

  it.each([
    {},
    { limit: 50 },
    { cursor: CURSOR, limit: 100, status: "engaged" },
    { assigned_membership_id: MEMBERSHIP_ID, location_id: LOCATION_ID },
    { created_from: NOW },
    { created_to: LATER },
    { created_from: NOW, created_to: LATER },
  ])("accepts finite list query %#", (candidate) => {
    expect(isSchemaValue(StaffLeadListQuerySchema, candidate)).toBe(true);
  });

  it.each([
    { created_from: LATER, created_to: NOW },
    { created_from: NOW, created_to: NOW },
    { limit: 101 },
    { offset: 10 },
    { organization_id: CONTACT_ID },
    { sort: "created_at asc" },
    { status: "deleted" },
  ])("rejects invalid or authority-smuggling list query %#", (candidate) => {
    expect(isSchemaValue(StaffLeadListQuerySchema, candidate)).toBe(false);
  });

  it("rejects raw database and unknown projection fields", () => {
    expect(isSchemaValue(StaffLeadSchema, { ...lead, organization_id: CONTACT_ID })).toBe(false);
    expect(isSchemaValue(StaffLeadSchema, { ...lead, external_thread_hash: "hidden" })).toBe(false);
  });
});

describe("S9 staff Conversation read contracts", () => {
  it("accepts safe participant summaries, params, and response envelopes", () => {
    expect(isSchemaValue(StaffConversationSchema, conversation)).toBe(true);
    expect(isSchemaValue(StaffConversationReadParamsSchema, { id: CONVERSATION_ID })).toBe(true);
    expect(
      isSchemaValue(StaffConversationResponseSchema, {
        data: conversation,
        meta: { request_id: REQUEST_ID },
      }),
    ).toBe(true);
    expect(
      isSchemaValue(StaffConversationCollectionResponseSchema, {
        data: [conversation],
        meta: { has_more: true, next_cursor: CURSOR, request_id: REQUEST_ID },
      }),
    ).toBe(true);
    expectTypeOf<StaffConversation>().toMatchTypeOf<{ id: string; participant: object }>();
  });

  it.each([
    {},
    { limit: 1 },
    { channel_connection_id: CHANNEL_ID, status: "open" },
    { assigned_membership_id: MEMBERSHIP_ID, cursor: CURSOR },
  ])("accepts finite Conversation list query %#", (candidate) => {
    expect(isSchemaValue(StaffConversationListQuerySchema, candidate)).toBe(true);
  });

  it.each([
    { offset: 5 },
    { organization_id: CONTACT_ID },
    { status: "archived" },
    { sort: "last_activity_at asc" },
  ])("rejects invalid Conversation list query %#", (candidate) => {
    expect(isSchemaValue(StaffConversationListQuerySchema, candidate)).toBe(false);
  });

  it.each([
    { ...conversation, organization_id: CONTACT_ID },
    { ...conversation, external_thread_hash: "hidden" },
    {
      ...conversation,
      participant: { ...conversation.participant, value: "raw-identity" },
    },
  ])("rejects hidden tenant, grouping, or participant data %#", (candidate) => {
    expect(isSchemaValue(StaffConversationSchema, candidate)).toBe(false);
  });
});

describe("S9 staff Message read contracts", () => {
  it("accepts chronological query and redaction-safe messages", () => {
    const redacted = {
      ...inboundMessage,
      body_text: null,
      created_at: LATER,
      id: REPLY_ID,
      redacted_at: LATER,
      sequence_no: 2,
    } as const;

    expect(isSchemaValue(StaffMessageSchema, inboundMessage)).toBe(true);
    expect(isSchemaValue(StaffMessageSchema, redacted)).toBe(true);
    expect(isSchemaValue(StaffMessageListQuerySchema, {})).toBe(true);
    expect(isSchemaValue(StaffMessageListQuerySchema, { cursor: CURSOR, limit: 50 })).toBe(true);
    expect(
      isSchemaValue(StaffMessageCollectionResponseSchema, {
        data: [inboundMessage, redacted],
        meta: { has_more: false, request_id: REQUEST_ID },
      }),
    ).toBe(true);
    expectTypeOf<StaffMessage["body_text"]>().toEqualTypeOf<string | null>();
    expectTypeOf<StaffMessage["id"]>().toMatchTypeOf<string>();
    expectTypeOf<StaffMessage["sequence_no"]>().toEqualTypeOf<number>();
  });

  it.each([
    { ...inboundMessage, body_ciphertext: "hidden" },
    { ...inboundMessage, body_hash: "hidden" },
    { ...inboundMessage, external_message_id: "provider-id" },
    { ...inboundMessage, organization_id: CONTACT_ID },
    { ...inboundMessage, sender_membership_id: MEMBERSHIP_ID },
    { ...inboundMessage, delivery_status: "delivered" },
    { ...inboundMessage, body_text: "must be erased", redacted_at: LATER },
  ])("rejects hidden fields or impossible sender/redaction shape %#", (candidate) => {
    expect(isSchemaValue(StaffMessageSchema, candidate)).toBe(false);
  });

  it.each([{ offset: 1 }, { sort: "created_at desc" }, { organization_id: CONTACT_ID }])(
    "rejects non-keyset or authority-smuggling Message query %#",
    (candidate) => {
      expect(isSchemaValue(StaffMessageListQuerySchema, candidate)).toBe(false);
    },
  );
});
