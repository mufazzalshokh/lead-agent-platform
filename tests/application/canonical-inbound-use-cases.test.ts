import { describe, expect, it, vi } from "vitest";

import {
  createCanonicalInboundUseCases,
  type CanonicalInboundDataProtector,
  type CanonicalInboundPersistenceStore,
  type PreparedCanonicalInbound,
} from "../../packages/application/src/index.js";
import {
  CanonicalInboundEventSchema,
  ChannelConnectionIdSchema,
  ContactIdSchema,
  ConversationIdSchema,
  LeadIdSchema,
  MessageIdSchema,
  OrganizationIdSchema,
  ResourceIdSchema,
  isSchemaValue,
  type CanonicalInboundEvent,
  type ChannelConnectionId,
  type ContactId,
  type ConversationId,
  type LeadId,
  type MessageId,
  type OrganizationId,
  type ResourceId,
} from "../../packages/contracts/src/index.js";

const ORGANIZATION_VALUE = "0199f1a8-7f65-7c28-a434-a10796c47501";
const OTHER_ORGANIZATION_VALUE = "0199f1a8-7f65-7c28-a434-a10796c47502";
const CHANNEL_VALUE = "0199f1a8-7f65-7c28-a434-a10796c47503";
const OTHER_CHANNEL_VALUE = "0199f1a8-7f65-7c28-a434-a10796c47504";
const CONTACT_VALUE = "0199f1a8-7f65-7c28-a434-a10796c47505";
const LEAD_VALUE = "0199f1a8-7f65-7c28-a434-a10796c47506";
const CONVERSATION_VALUE = "0199f1a8-7f65-7c28-a434-a10796c47507";
const MESSAGE_VALUE = "0199f1a8-7f65-7c28-a434-a10796c47508";
const CONSENT_VALUE = "0199f1a8-7f65-7c28-a434-a10796c47509";

if (
  !isSchemaValue(OrganizationIdSchema, ORGANIZATION_VALUE) ||
  !isSchemaValue(OrganizationIdSchema, OTHER_ORGANIZATION_VALUE) ||
  !isSchemaValue(ChannelConnectionIdSchema, CHANNEL_VALUE) ||
  !isSchemaValue(ChannelConnectionIdSchema, OTHER_CHANNEL_VALUE) ||
  !isSchemaValue(ContactIdSchema, CONTACT_VALUE) ||
  !isSchemaValue(LeadIdSchema, LEAD_VALUE) ||
  !isSchemaValue(ConversationIdSchema, CONVERSATION_VALUE) ||
  !isSchemaValue(MessageIdSchema, MESSAGE_VALUE) ||
  !isSchemaValue(ResourceIdSchema, CONSENT_VALUE)
) {
  throw new TypeError("Invalid S9.A application fixture");
}

const ORGANIZATION_ID: OrganizationId = ORGANIZATION_VALUE;
const OTHER_ORGANIZATION_ID: OrganizationId = OTHER_ORGANIZATION_VALUE;
const CHANNEL_ID: ChannelConnectionId = CHANNEL_VALUE;
const OTHER_CHANNEL_ID: ChannelConnectionId = OTHER_CHANNEL_VALUE;
const CONTACT_ID: ContactId = CONTACT_VALUE;
const LEAD_ID: LeadId = LEAD_VALUE;
const CONVERSATION_ID: ConversationId = CONVERSATION_VALUE;
const MESSAGE_ID: MessageId = MESSAGE_VALUE;
const CONSENT_ID: ResourceId = CONSENT_VALUE;

const bytes = (fill: number, length = 32): Uint8Array => Uint8Array.from({ length }, () => fill);

const event = (overrides: Readonly<Record<string, unknown>> = {}): CanonicalInboundEvent => {
  const candidate: unknown = {
    channel: "widget",
    channel_connection_id: CHANNEL_ID,
    content: { locale_hint: "uz", text: "Salom", type: "text" },
    event_id: "event:s9:1",
    external_account_id: null,
    external_conversation_id: "thread:s9:1",
    external_message_id: "message:s9:1",
    external_sender_id: "participant:s9:1",
    kind: "text",
    occurred_at: "2026-09-15T08:00:00.000Z",
    received_at: "2026-09-15T08:00:01.000Z",
    ...overrides,
  };
  if (!isSchemaValue(CanonicalInboundEventSchema, candidate)) {
    throw new TypeError("Invalid canonical inbound fixture");
  }
  return candidate;
};

const createHarness = () => {
  const accepted: PreparedCanonicalInbound[] = [];
  const store: CanonicalInboundPersistenceStore = {
    acceptInbound: vi.fn((input: PreparedCanonicalInbound) => {
      accepted.push(input);
      return Promise.resolve({
        ok: true as const,
        value: {
          contactId: CONTACT_ID,
          contactWasCreated: true,
          conversationId: CONVERSATION_ID,
          conversationWasCreated: true,
          leadId: LEAD_ID,
          leadWasCreated: true,
          messageId: MESSAGE_ID,
          messageSequenceNo: 1,
          processingStatus: input.message.processingStatus,
          status: "accepted" as const,
        },
      });
    }),
  };
  const protectContent = vi.fn(() => ({ bodyCiphertext: bytes(1), bodyHash: bytes(2) }));
  const protectParticipant = vi.fn(() => ({
    hashKeyVersion: 3,
    lookupHash: bytes(4),
    valueCiphertext: bytes(5),
  }));
  const threadHash = vi.fn(() => bytes(6));
  const protector: CanonicalInboundDataProtector = {
    protectContent,
    protectParticipant,
    threadHash,
  };
  return {
    accepted,
    protectContent,
    protectParticipant,
    protector,
    threadHash,
    useCases: createCanonicalInboundUseCases(store, protector),
  };
};

describe("S9.A canonical inbound application boundary", () => {
  it("accepts a bound Widget identity without requiring a phone number", async () => {
    const harness = createHarness();
    const result = await harness.useCases.acceptInbound({
      context: { channelConnectionId: CHANNEL_ID, organizationId: ORGANIZATION_ID },
      event: event(),
    });

    expect(result).toMatchObject({ ok: true, value: { status: "accepted" } });
    expect(harness.accepted).toHaveLength(1);
    expect(harness.accepted[0]).toMatchObject({
      identity: { identityType: "widget_participant", validationStatus: "valid" },
      message: { localeHint: "uz", processingStatus: "accepted" },
      organizationId: ORGANIZATION_ID,
    });
    expect(Object.keys(harness.accepted[0]?.identity ?? {})).not.toContain("phone");
  });

  it("marks a bound Telegram identity verified without changing grouping inputs", async () => {
    const harness = createHarness();
    await harness.useCases.acceptInbound({
      context: { channelConnectionId: CHANNEL_ID, organizationId: ORGANIZATION_ID },
      event: event({ channel: "telegram" }),
    });

    expect(harness.accepted[0]?.identity).toMatchObject({
      identityType: "telegram_user",
      validationStatus: "verified",
    });
    expect(harness.threadHash).toHaveBeenCalledWith({
      channelConnectionId: CHANNEL_ID,
      externalConversationId: "thread:s9:1",
      organizationId: ORGANIZATION_ID,
    });
    expect(harness.protectParticipant).toHaveBeenCalledWith({
      channelConnectionId: CHANNEL_ID,
      externalParticipantId: "participant:s9:1",
      identityType: "telegram_user",
      organizationId: ORGANIZATION_ID,
    });
  });

  it.each([
    ["attachment", { media_kind: "image", provider_media_ref: "media:s9", type: "attachment" }],
    ["unsupported", { provider_status: "unknown_type", type: "unsupported" }],
  ] as const)(
    "stores %s input as suppressed instead of treating it as text",
    async (kind, content) => {
      const harness = createHarness();
      await harness.useCases.acceptInbound({
        context: { channelConnectionId: CHANNEL_ID, organizationId: ORGANIZATION_ID },
        event: event({ content, kind }),
      });

      expect(harness.accepted[0]?.message.processingStatus).toBe("suppressed");
    },
  );

  it("rejects delivery-status input from the customer-message use case before protection", async () => {
    const harness = createHarness();
    const result = await harness.useCases.acceptInbound({
      context: { channelConnectionId: CHANNEL_ID, organizationId: ORGANIZATION_ID },
      event: event({
        content: { provider_status: "delivered", type: "delivery_status" },
        kind: "delivery_status",
      }),
    });

    expect(result).toEqual({ error: { code: "unsupported_event_kind" }, ok: false });
    expect(harness.protectContent).not.toHaveBeenCalled();
    expect(harness.accepted).toHaveLength(0);
  });

  it("fails closed when trusted routing and the canonical connection disagree", async () => {
    const harness = createHarness();
    const result = await harness.useCases.acceptInbound({
      context: { channelConnectionId: OTHER_CHANNEL_ID, organizationId: ORGANIZATION_ID },
      event: event(),
    });

    expect(result).toEqual({ error: { code: "channel_unavailable" }, ok: false });
    expect(harness.protectParticipant).not.toHaveBeenCalled();
    expect(harness.accepted).toHaveLength(0);
  });

  it.each(["instagram", "whatsapp"] as const)(
    "rejects the unimplemented %s channel without invoking persistence",
    async (channel) => {
      const harness = createHarness();
      const result = await harness.useCases.acceptInbound({
        context: { channelConnectionId: CHANNEL_ID, organizationId: OTHER_ORGANIZATION_ID },
        event: event({ channel }),
      });

      expect(result).toEqual({ error: { code: "unsupported_channel" }, ok: false });
      expect(harness.accepted).toHaveLength(0);
    },
  );

  it("rejects malformed protected material instead of passing it to persistence", async () => {
    const harness = createHarness();
    harness.protector.threadHash = vi.fn(() => bytes(7, 8));
    const useCases = createCanonicalInboundUseCases({ acceptInbound: vi.fn() }, harness.protector);

    await expect(
      useCases.acceptInbound({
        context: { channelConnectionId: CHANNEL_ID, organizationId: ORGANIZATION_ID },
        event: event(),
      }),
    ).resolves.toEqual({ error: { code: "validation_failed" }, ok: false });
  });

  it("validates and forwards bounded consent evidence without making phone mandatory", async () => {
    const harness = createHarness();
    const result = await harness.useCases.acceptInbound({
      consentEvidence: {
        evidenceCiphertext: bytes(8),
        evidenceHash: bytes(9),
        lawfulBasisCode: "customer_request",
        locale: "uz",
        noticeKey: "service.notice",
        noticeVersion: 1,
        policyUrl: null,
        purpose: "service_messages",
        status: "granted",
        supersedesConsentId: null,
      },
      context: { channelConnectionId: CHANNEL_ID, organizationId: ORGANIZATION_ID },
      event: event(),
    });

    expect(result.ok).toBe(true);
    expect(harness.accepted[0]?.consentEvidence).toMatchObject({
      purpose: "service_messages",
      status: "granted",
    });
    expect(harness.accepted[0]?.consentEvidence?.supersedesConsentId).not.toBe(CONSENT_ID);
  });
});
