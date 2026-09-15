import { createHash } from "node:crypto";

import type { Pool } from "pg";
import { describe, expect, it } from "vitest";

import {
  createCanonicalInboundUseCases,
  type CanonicalInboundDataProtector,
  type InboundConsentEvidence,
} from "../../packages/application/src/index.js";
import {
  CanonicalInboundEventSchema,
  ResourceIdSchema,
  isSchemaValue,
  type CanonicalInboundEvent,
  type ChannelConnectionId,
  type OrganizationId,
  type ResourceId,
} from "../../packages/contracts/src/index.js";
import {
  createCanonicalInboundPersistenceStore,
  type TenantDatabaseRuntime,
} from "../../packages/database/src/index.js";

type SuiteOptions = Readonly<{
  channelA: ChannelConnectionId;
  channelB: ChannelConnectionId;
  organizationA: OrganizationId;
  organizationB: OrganizationId;
  privilegedPool: () => Pool;
  runtime: () => TenantDatabaseRuntime;
}>;

type InboundOverrides = Readonly<{
  eventId?: string;
  externalMessageId?: string | null;
  externalSenderId?: string;
  receivedAt?: string;
  text?: string;
  threadId?: string;
}>;

const UNKNOWN_CONSENT_VALUE = "0199f1a8-7f65-7c28-a434-a10796c47999";
if (!isSchemaValue(ResourceIdSchema, UNKNOWN_CONSENT_VALUE)) {
  throw new TypeError("Invalid S9.A database fixture");
}
const UNKNOWN_CONSENT_ID: ResourceId = UNKNOWN_CONSENT_VALUE;

const digest = (...parts: readonly string[]): Uint8Array =>
  createHash("sha256").update(parts.join("\u0000")).digest();

const protectContent: CanonicalInboundDataProtector["protectContent"] = ({
  channelConnectionId,
  content,
  organizationId,
}) => ({
  bodyCiphertext: Buffer.from(`synthetic-ciphertext:${JSON.stringify(content)}`, "utf8"),
  bodyHash: digest(organizationId, channelConnectionId, JSON.stringify(content)),
});
const protectParticipant: CanonicalInboundDataProtector["protectParticipant"] = ({
  channelConnectionId,
  externalParticipantId,
  identityType,
  organizationId,
}) => ({
  hashKeyVersion: 1,
  lookupHash: digest(organizationId, channelConnectionId, identityType, externalParticipantId),
  valueCiphertext: Buffer.from(`synthetic-identity:${externalParticipantId}`, "utf8"),
});
const threadHash: CanonicalInboundDataProtector["threadHash"] = ({
  channelConnectionId,
  externalConversationId,
  organizationId,
}) => digest(organizationId, channelConnectionId, externalConversationId);
const protector: CanonicalInboundDataProtector = Object.freeze({
  protectContent,
  protectParticipant,
  threadHash,
});

const inboundEvent = (
  channelConnectionId: ChannelConnectionId,
  overrides: InboundOverrides = {},
): CanonicalInboundEvent => {
  const candidate: unknown = {
    channel: "widget",
    channel_connection_id: channelConnectionId,
    content: { locale_hint: "uz", text: overrides.text ?? "Salom", type: "text" },
    event_id: overrides.eventId ?? "event:s9:1",
    external_account_id: null,
    external_conversation_id: overrides.threadId ?? "thread:s9:1",
    external_message_id:
      overrides.externalMessageId === undefined ? "message:s9:1" : overrides.externalMessageId,
    external_sender_id: overrides.externalSenderId ?? "participant:s9:1",
    kind: "text",
    occurred_at: overrides.receivedAt ?? "2026-09-15T08:00:00.000Z",
    received_at: overrides.receivedAt ?? "2026-09-15T08:00:00.000Z",
  };
  if (!isSchemaValue(CanonicalInboundEventSchema, candidate)) {
    throw new TypeError("Invalid S9.A canonical inbound fixture");
  }
  return candidate;
};

const consentEvidence = (
  overrides: Partial<InboundConsentEvidence> = {},
): InboundConsentEvidence => ({
  evidenceCiphertext: Buffer.from("synthetic-consent-evidence", "utf8"),
  evidenceHash: digest("synthetic-consent-evidence"),
  lawfulBasisCode: "customer_request",
  locale: "uz",
  noticeKey: "service.notice",
  noticeVersion: 1,
  policyUrl: null,
  purpose: "service_messages",
  status: "granted",
  supersedesConsentId: null,
  ...overrides,
});

const seedTenant = async (
  pool: Pool,
  organizationId: OrganizationId,
  channelConnectionId: ChannelConnectionId,
  suffix: string,
): Promise<void> => {
  await pool.query(
    `insert into organizations
      (id,slug,display_name,status,default_locale,default_time_zone)
     values ($1,$2,$3,'active','en','Asia/Tashkent')`,
    [organizationId, `s9-${suffix}`, `S9 ${suffix} Clinic`],
  );
  await pool.query(
    `insert into channel_connections
      (id,organization_id,channel_type,status,display_name,configuration_jsonb,verified_at)
     values ($1,$2,'widget','active',$3,'{}'::jsonb,now())`,
    [channelConnectionId, organizationId, `S9 ${suffix} Widget`],
  );
};

const countsFor = async (pool: Pool, organizationId: OrganizationId) => {
  const result = await pool.query<{
    audits: number;
    consents: number;
    contacts: number;
    conversations: number;
    identities: number;
    leads: number;
    messages: number;
    outbox: number;
  }>(
    `select
       (select count(*)::int from audit_events where organization_id = $1) as audits,
       (select count(*)::int from consent_records where organization_id = $1) as consents,
       (select count(*)::int from contacts where organization_id = $1) as contacts,
       (select count(*)::int from conversations where organization_id = $1) as conversations,
       (select count(*)::int from contact_identities where organization_id = $1) as identities,
       (select count(*)::int from leads where organization_id = $1) as leads,
       (select count(*)::int from messages where organization_id = $1) as messages,
       (select count(*)::int from outbox_events where organization_id = $1) as outbox`,
    [organizationId],
  );
  const row = result.rows[0];
  if (row === undefined) throw new Error("S9.A count query returned no row");
  return row;
};

export const registerInboundConversationPersistenceTests = (options: SuiteOptions): void => {
  const useCases = () =>
    createCanonicalInboundUseCases(
      createCanonicalInboundPersistenceStore(options.runtime()),
      protector,
    );
  const accept = (
    organizationId: OrganizationId,
    channelConnectionId: ChannelConnectionId,
    event: CanonicalInboundEvent,
    evidence?: InboundConsentEvidence,
  ) =>
    useCases().acceptInbound({
      ...(evidence === undefined ? {} : { consentEvidence: evidence }),
      context: { channelConnectionId, organizationId },
      event,
    });

  describe("S9.A deterministic inbound conversation persistence", () => {
    it("atomically creates a contact, bound identity, engaged lead, conversation, message, audit, and Outbox facts without phone", async () => {
      const pool = options.privilegedPool();
      await seedTenant(pool, options.organizationA, options.channelA, "create");

      const result = await accept(
        options.organizationA,
        options.channelA,
        inboundEvent(options.channelA),
      );

      expect(result).toMatchObject({
        ok: true,
        value: {
          contactWasCreated: true,
          conversationWasCreated: true,
          leadWasCreated: true,
          messageSequenceNo: 1,
          processingStatus: "accepted",
          status: "accepted",
        },
      });
      const counts = await countsFor(pool, options.organizationA);
      expect(counts).toEqual({
        audits: 3,
        consents: 0,
        contacts: 1,
        conversations: 1,
        identities: 1,
        leads: 1,
        messages: 1,
        outbox: 6,
      });
      expect(
        (
          await pool.query(
            `select c.preferred_locale, ci.identity_type, ci.validation_status,
                    l.status as lead_status, l.version as lead_version,
                    v.status as conversation_status, v.version as conversation_version,
                    m.sequence_no, m.processing_status,
                    encode(m.body_hash, 'hex') as body_hash
               from contacts c
               join contact_identities ci on ci.organization_id = c.organization_id and ci.contact_id = c.id
               join leads l on l.organization_id = c.organization_id and l.contact_id = c.id
               join conversations v on v.organization_id = c.organization_id and v.contact_id = c.id
               join messages m on m.organization_id = v.organization_id and m.conversation_id = v.id
              where c.organization_id = $1`,
            [options.organizationA],
          )
        ).rows[0],
      ).toMatchObject({
        body_hash: Buffer.from(
          digest(
            options.organizationA,
            options.channelA,
            JSON.stringify({ locale_hint: "uz", text: "Salom", type: "text" }),
          ),
        ).toString("hex"),
        conversation_status: "open",
        conversation_version: "1",
        identity_type: "widget_participant",
        lead_status: "engaged",
        lead_version: "2",
        preferred_locale: "uz",
        processing_status: "accepted",
        sequence_no: "1",
        validation_status: "valid",
      });
      expect(
        (
          await pool.query<{ event_type: string }>(
            `select event_type from outbox_events
              where organization_id = $1 order by event_type`,
            [options.organizationA],
          )
        ).rows.map(({ event_type }) => event_type),
      ).toEqual([
        "contact.created",
        "contact.identity_added",
        "conversation.started",
        "lead.created",
        "lead.engaged",
        "message.received",
      ]);
    });

    it("returns a stable receipt for duplicate provider events and external message identifiers", async () => {
      const pool = options.privilegedPool();
      await seedTenant(pool, options.organizationA, options.channelA, "duplicate");
      const first = await accept(
        options.organizationA,
        options.channelA,
        inboundEvent(options.channelA),
      );
      const repeatedEvent = await accept(
        options.organizationA,
        options.channelA,
        inboundEvent(options.channelA),
      );
      const repeatedMessage = await accept(
        options.organizationA,
        options.channelA,
        inboundEvent(options.channelA, { eventId: "event:s9:second-delivery" }),
      );

      expect(first.ok).toBe(true);
      expect(repeatedEvent).toMatchObject({ ok: true, value: { status: "duplicate" } });
      expect(repeatedMessage).toMatchObject({ ok: true, value: { status: "duplicate" } });
      if (!first.ok || !repeatedEvent.ok || !repeatedMessage.ok) {
        throw new Error("Expected accepted S9.A receipts");
      }
      expect(repeatedEvent.value.messageId).toBe(first.value.messageId);
      expect(repeatedMessage.value.messageId).toBe(first.value.messageId);
      expect(await countsFor(pool, options.organizationA)).toMatchObject({
        contacts: 1,
        conversations: 1,
        leads: 1,
        messages: 1,
      });
    });

    it("serializes concurrent duplicate delivery into one logical inbound", async () => {
      const pool = options.privilegedPool();
      await seedTenant(pool, options.organizationA, options.channelA, "concurrent-duplicate");
      const incoming = inboundEvent(options.channelA);

      const results = await Promise.all([
        accept(options.organizationA, options.channelA, incoming),
        accept(options.organizationA, options.channelA, incoming),
      ]);

      expect(results.every(({ ok }) => ok)).toBe(true);
      expect(results.map((result) => (result.ok ? result.value.status : "failed")).sort()).toEqual([
        "accepted",
        "duplicate",
      ]);
      expect(await countsFor(pool, options.organizationA)).toMatchObject({
        contacts: 1,
        conversations: 1,
        leads: 1,
        messages: 1,
      });
    });

    it("serializes distinct concurrent messages while reusing the frozen active groupings", async () => {
      const pool = options.privilegedPool();
      await seedTenant(pool, options.organizationA, options.channelA, "concurrent-distinct");

      const results = await Promise.all([
        accept(
          options.organizationA,
          options.channelA,
          inboundEvent(options.channelA, {
            eventId: "event:s9:concurrent-a",
            externalMessageId: "message:s9:concurrent-a",
          }),
        ),
        accept(
          options.organizationA,
          options.channelA,
          inboundEvent(options.channelA, {
            eventId: "event:s9:concurrent-b",
            externalMessageId: "message:s9:concurrent-b",
          }),
        ),
      ]);

      expect(results.every(({ ok }) => ok)).toBe(true);
      expect(await countsFor(pool, options.organizationA)).toMatchObject({
        contacts: 1,
        conversations: 1,
        leads: 1,
        messages: 2,
      });
      expect(
        (
          await pool.query<{ sequence_no: string }>(
            `select sequence_no from messages where organization_id = $1 order by sequence_no`,
            [options.organizationA],
          )
        ).rows.map(({ sequence_no }) => sequence_no),
      ).toEqual(["1", "2"]);
    });

    it("retains reordered inbound facts without regressing activity timestamps or aggregate state", async () => {
      const pool = options.privilegedPool();
      await seedTenant(pool, options.organizationA, options.channelA, "reordered");
      await accept(
        options.organizationA,
        options.channelA,
        inboundEvent(options.channelA, {
          eventId: "event:s9:newer",
          externalMessageId: "message:s9:newer",
          receivedAt: "2026-09-15T10:00:00.000Z",
        }),
      );
      const late = await accept(
        options.organizationA,
        options.channelA,
        inboundEvent(options.channelA, {
          eventId: "event:s9:older",
          externalMessageId: "message:s9:older",
          receivedAt: "2026-09-15T09:00:00.000Z",
        }),
      );

      expect(late).toMatchObject({
        ok: true,
        value: { conversationWasCreated: false, leadWasCreated: false, messageSequenceNo: 2 },
      });
      expect(
        (
          await pool.query(
            `select c.last_seen_at, l.status as lead_status,
                    v.status as conversation_status, v.last_activity_at, v.version
               from contacts c
               join leads l on l.organization_id = c.organization_id and l.contact_id = c.id
               join conversations v on v.organization_id = c.organization_id and v.contact_id = c.id
              where c.organization_id = $1`,
            [options.organizationA],
          )
        ).rows[0],
      ).toMatchObject({
        conversation_status: "open",
        last_activity_at: new Date("2026-09-15T10:00:00.000Z"),
        last_seen_at: new Date("2026-09-15T10:00:00.000Z"),
        lead_status: "engaged",
        version: "2",
      });
      expect(
        (
          await pool.query<{ count: number }>(
            `select count(*)::int as count from outbox_events
              where organization_id = $1 and event_type = 'conversation.status_changed'`,
            [options.organizationA],
          )
        ).rows[0]?.count,
      ).toBe(0);
    });

    it("uses participant identity for Contact reuse but never as Conversation grouping identity", async () => {
      const pool = options.privilegedPool();
      await seedTenant(pool, options.organizationA, options.channelA, "grouping");
      const first = await accept(
        options.organizationA,
        options.channelA,
        inboundEvent(options.channelA, { threadId: "thread:s9:first" }),
      );
      const second = await accept(
        options.organizationA,
        options.channelA,
        inboundEvent(options.channelA, {
          eventId: "event:s9:second-thread",
          externalMessageId: "message:s9:second-thread",
          threadId: "thread:s9:second",
        }),
      );

      if (!first.ok || !second.ok) throw new Error("Expected accepted S9.A receipts");
      expect(second.value.contactId).toBe(first.value.contactId);
      expect(second.value.leadId).toBe(first.value.leadId);
      expect(second.value.conversationId).not.toBe(first.value.conversationId);
      expect(second.value.conversationWasCreated).toBe(true);
      expect(await countsFor(pool, options.organizationA)).toMatchObject({
        contacts: 1,
        conversations: 2,
        leads: 1,
        messages: 2,
      });
    });

    it("fails closed for a different participant attempting to reuse an active thread", async () => {
      const pool = options.privilegedPool();
      await seedTenant(pool, options.organizationA, options.channelA, "identity-conflict");
      await accept(options.organizationA, options.channelA, inboundEvent(options.channelA));
      const conflicting = await accept(
        options.organizationA,
        options.channelA,
        inboundEvent(options.channelA, {
          eventId: "event:s9:other-participant",
          externalMessageId: "message:s9:other-participant",
          externalSenderId: "participant:s9:other",
        }),
      );

      expect(conflicting).toEqual({ error: { code: "identity_conflict" }, ok: false });
      expect(await countsFor(pool, options.organizationA)).toMatchObject({
        contacts: 1,
        conversations: 1,
        leads: 1,
        messages: 1,
      });
    });

    it("keeps identical provider identifiers tenant-local and denies cross-tenant channel references", async () => {
      const pool = options.privilegedPool();
      await seedTenant(pool, options.organizationA, options.channelA, "tenant-a");
      await seedTenant(pool, options.organizationB, options.channelB, "tenant-b");
      const [tenantA, tenantB] = await Promise.all([
        accept(options.organizationA, options.channelA, inboundEvent(options.channelA)),
        accept(options.organizationB, options.channelB, inboundEvent(options.channelB)),
      ]);

      if (!tenantA.ok || !tenantB.ok) throw new Error("Expected tenant-local S9.A receipts");
      expect(tenantA.value.contactId).not.toBe(tenantB.value.contactId);
      expect(tenantA.value.leadId).not.toBe(tenantB.value.leadId);
      expect(tenantA.value.conversationId).not.toBe(tenantB.value.conversationId);
      expect(await countsFor(pool, options.organizationA)).toMatchObject({ messages: 1 });
      expect(await countsFor(pool, options.organizationB)).toMatchObject({ messages: 1 });

      const hostile = await accept(
        options.organizationA,
        options.channelB,
        inboundEvent(options.channelB, {
          eventId: "event:s9:hostile",
          externalMessageId: "message:s9:hostile",
          externalSenderId: "participant:s9:hostile",
          threadId: "thread:s9:hostile",
        }),
      );
      expect(hostile).toEqual({ error: { code: "channel_unavailable" }, ok: false });
      expect(await countsFor(pool, options.organizationA)).toMatchObject({ messages: 1 });
      expect(await countsFor(pool, options.organizationB)).toMatchObject({ messages: 1 });
    });

    it("persists consent evidence with the exact source message and rolls every write back on a late ownership failure", async () => {
      const pool = options.privilegedPool();
      await seedTenant(pool, options.organizationA, options.channelA, "consent");
      const accepted = await accept(
        options.organizationA,
        options.channelA,
        inboundEvent(options.channelA),
        consentEvidence(),
      );

      expect(accepted.ok).toBe(true);
      expect(await countsFor(pool, options.organizationA)).toMatchObject({
        audits: 4,
        consents: 1,
        messages: 1,
        outbox: 7,
      });
      expect(
        (
          await pool.query(
            `select cr.status, cr.purpose, cr.source_message_id = m.id as source_matches,
                    cr.contact_id = m.sender_contact_id as contact_matches
               from consent_records cr
               join messages m on m.organization_id = cr.organization_id and m.id = cr.source_message_id
              where cr.organization_id = $1`,
            [options.organizationA],
          )
        ).rows[0],
      ).toEqual({
        contact_matches: true,
        purpose: "service_messages",
        source_matches: true,
        status: "granted",
      });

      await seedTenant(pool, options.organizationB, options.channelB, "consent-rollback");
      const rejected = await accept(
        options.organizationB,
        options.channelB,
        inboundEvent(options.channelB, {
          eventId: "event:s9:consent-rollback",
          externalMessageId: "message:s9:consent-rollback",
        }),
        consentEvidence({
          status: "withdrawn",
          supersedesConsentId: UNKNOWN_CONSENT_ID,
        }),
      );
      expect(rejected).toEqual({ error: { code: "persistence_conflict" }, ok: false });
      expect(await countsFor(pool, options.organizationB)).toEqual({
        audits: 0,
        consents: 0,
        contacts: 0,
        conversations: 0,
        identities: 0,
        leads: 0,
        messages: 0,
        outbox: 0,
      });
    });
  });
};
