import { randomBytes } from "node:crypto";

import type { Pool } from "pg";
import { beforeEach, describe, expect, it } from "vitest";

import {
  createStaffConversationQueryUseCases,
  createStaffQueryCursorCodec,
  type StaffConversationQueryUseCases,
} from "../../packages/application/src/index.js";
import {
  ChannelConnectionIdSchema,
  ContactIdSchema,
  ConversationIdSchema,
  LeadIdSchema,
  LocationIdSchema,
  MembershipIdSchema,
  OrganizationIdSchema,
  UserIdSchema,
  isSchemaValue,
  type ChannelConnectionId,
  type ContactId,
  type ConversationId,
  type LeadId,
  type LocationId,
  type MembershipId,
  type OrganizationId,
  type UserId,
} from "../../packages/contracts/src/index.js";
import {
  createStaffConversationQueryStore,
  type TenantDatabaseRuntime,
} from "../../packages/database/src/index.js";
import {
  createCustomerDataProtection,
  resolveAuthorizationContext,
  type AuthenticatedApplicationSession,
  type AuthorizationContext,
  type CurrentMembershipAuthorization,
} from "../../packages/security/src/index.js";

const values = {
  channelA: "0199f1a8-7f65-7c28-a434-a10796c47801",
  channelB: "0199f1a8-7f65-7c28-a434-a10796c47802",
  contactA: "0199f1a8-7f65-7c28-a434-a10796c47803",
  contactB: "0199f1a8-7f65-7c28-a434-a10796c47804",
  conversationA: "0199f1a8-7f65-7c28-a434-a10796c47805",
  conversationB: "0199f1a8-7f65-7c28-a434-a10796c47806",
  identityA: "0199f1a8-7f65-7c28-a434-a10796c47807",
  identityB: "0199f1a8-7f65-7c28-a434-a10796c47808",
  leadA: "0199f1a8-7f65-7c28-a434-a10796c47809",
  leadB: "0199f1a8-7f65-7c28-a434-a10796c4780a",
  locationA: "0199f1a8-7f65-7c28-a434-a10796c4780b",
  locationB: "0199f1a8-7f65-7c28-a434-a10796c4780c",
  membership: "0199f1a8-7f65-7c28-a434-a10796c4780d",
  messageA: "0199f1a8-7f65-7c28-a434-a10796c4780e",
  messageRedacted: "0199f1a8-7f65-7c28-a434-a10796c4780f",
  organizationA: "0199f1a8-7f65-7c28-a434-a10796c47810",
  organizationB: "0199f1a8-7f65-7c28-a434-a10796c47811",
  user: "0199f1a8-7f65-7c28-a434-a10796c47812",
} as const;
if (
  !isSchemaValue(ChannelConnectionIdSchema, values.channelA) ||
  !isSchemaValue(ChannelConnectionIdSchema, values.channelB) ||
  !isSchemaValue(ContactIdSchema, values.contactA) ||
  !isSchemaValue(ContactIdSchema, values.contactB) ||
  !isSchemaValue(ConversationIdSchema, values.conversationA) ||
  !isSchemaValue(ConversationIdSchema, values.conversationB) ||
  !isSchemaValue(LeadIdSchema, values.leadA) ||
  !isSchemaValue(LeadIdSchema, values.leadB) ||
  !isSchemaValue(LocationIdSchema, values.locationA) ||
  !isSchemaValue(LocationIdSchema, values.locationB) ||
  !isSchemaValue(MembershipIdSchema, values.membership) ||
  !isSchemaValue(OrganizationIdSchema, values.organizationA) ||
  !isSchemaValue(OrganizationIdSchema, values.organizationB) ||
  !isSchemaValue(UserIdSchema, values.user)
)
  throw new TypeError("Invalid S9.B database fixture");

const CHANNEL_A: ChannelConnectionId = values.channelA;
const CHANNEL_B: ChannelConnectionId = values.channelB;
const CONTACT_A: ContactId = values.contactA;
const CONVERSATION_A: ConversationId = values.conversationA;
const CONVERSATION_B: ConversationId = values.conversationB;
const LEAD_A: LeadId = values.leadA;
const LEAD_B: LeadId = values.leadB;
const LOCATION_A: LocationId = values.locationA;
const MEMBERSHIP: MembershipId = values.membership;
const ORGANIZATION_A: OrganizationId = values.organizationA;
const ORGANIZATION_B: OrganizationId = values.organizationB;
const USER: UserId = values.user;

export type StaffConversationQueryTestOptions = Readonly<{
  privilegedPool: () => Pool;
  runtime: () => TenantDatabaseRuntime;
}>;

export const registerStaffConversationQueryTests = (
  options: StaffConversationQueryTestOptions,
): void => {
  const protection = createCustomerDataProtection({
    currentEncryptionKey: randomBytes(32),
    currentKeyId: "s9b-test-v1",
    lookupKey: randomBytes(32),
  });
  let useCases: StaffConversationQueryUseCases;

  const authorizationFor = async (
    organizationId: OrganizationId,
    allowedLocationIds: readonly LocationId[],
    locationScope: "all" | "restricted" = "restricted",
  ): Promise<AuthorizationContext> => {
    const now = new Date("2026-09-15T08:00:00.000Z");
    const session: AuthenticatedApplicationSession = {
      absoluteExpiresAt: new Date("2026-09-16T08:00:00.000Z"),
      authenticationLevel: "mfa",
      authenticationTime: now,
      createdAt: now,
      idleExpiresAt: new Date("2026-09-15T09:00:00.000Z"),
      lastSeenAt: now,
      rotatedAt: now,
      rotationDue: false,
      sessionId: values.identityA,
      userId: USER,
    };
    const current: CurrentMembershipAuthorization = {
      allowedLocationIds,
      locationScope,
      membershipId: MEMBERSHIP,
      organizationId,
      role: "staff",
      status: "active",
      userId: USER,
    };
    return resolveAuthorizationContext(session, organizationId, {
      resolveCurrentMembership: () => Promise.resolve(current),
    });
  };

  const seed = async (): Promise<void> => {
    const pool = options.privilegedPool();
    await pool.query(
      `insert into organizations (id, slug, display_name, status, default_locale, default_time_zone)
       values ($1, 's9b-a', 'S9B A', 'active', 'en', 'Asia/Tashkent'),
              ($2, 's9b-b', 'S9B B', 'active', 'en', 'Asia/Tashkent')`,
      [ORGANIZATION_A, ORGANIZATION_B],
    );
    await pool.query(
      `insert into locations (id, organization_id, code, status)
       values ($1, $2, 's9b-a', 'active'), ($3, $4, 's9b-b', 'active')`,
      [values.locationA, ORGANIZATION_A, values.locationB, ORGANIZATION_B],
    );
    await pool.query(
      `insert into channel_connections
        (id, organization_id, channel_type, status, display_name, configuration_jsonb, verified_at)
       values ($1, $2, 'widget', 'active', 'S9B A', '{}'::jsonb, now()),
              ($3, $4, 'widget', 'active', 'S9B B', '{}'::jsonb, now())`,
      [values.channelA, ORGANIZATION_A, values.channelB, ORGANIZATION_B],
    );
    const displayA = protection.protectContactDisplayName({
      organizationId: ORGANIZATION_A,
      value: "Aziza",
    });
    const displayB = protection.protectContactDisplayName({
      organizationId: ORGANIZATION_B,
      value: "Tenant B",
    });
    await pool.query(
      `insert into contacts
        (id, organization_id, display_name_ciphertext, preferred_locale, status, first_seen_at, last_seen_at)
       values ($1, $2, $3, 'uz', 'active', now(), now()),
              ($4, $5, $6, 'en', 'active', now(), now())`,
      [values.contactA, ORGANIZATION_A, displayA, values.contactB, ORGANIZATION_B, displayB],
    );
    const identityA = protection.protectContactIdentity({
      channelConnectionId: CHANNEL_A,
      identityType: "widget_participant",
      organizationId: ORGANIZATION_A,
      value: "participant-a",
    });
    const identityB = protection.protectContactIdentity({
      channelConnectionId: CHANNEL_B,
      identityType: "widget_participant",
      organizationId: ORGANIZATION_B,
      value: "participant-b",
    });
    await pool.query(
      `insert into contact_identities
        (id, organization_id, contact_id, identity_type, channel_connection_id,
         value_ciphertext, lookup_hash, display_redacted, validation_status, status)
       values ($1, $2, $3, 'widget_participant', $4, $5, $6, 'part***a', 'valid', 'active'),
              ($7, $8, $9, 'widget_participant', $10, $11, $12, 'part***b', 'valid', 'active')`,
      [
        values.identityA,
        ORGANIZATION_A,
        values.contactA,
        values.channelA,
        identityA,
        protection.deriveContactIdentityLookup({
          channelConnectionId: CHANNEL_A,
          identityType: "widget_participant",
          organizationId: ORGANIZATION_A,
          value: "participant-a",
        }),
        values.identityB,
        ORGANIZATION_B,
        values.contactB,
        values.channelB,
        identityB,
        protection.deriveContactIdentityLookup({
          channelConnectionId: CHANNEL_B,
          identityType: "widget_participant",
          organizationId: ORGANIZATION_B,
          value: "participant-b",
        }),
      ],
    );
    await pool.query(
      `insert into leads
        (id, organization_id, contact_id, status, source_channel_connection_id, location_id, created_at, updated_at)
       values ($1, $2, $3, 'new', $4, $5, timestamptz '2026-09-15 08:00:00+00', timestamptz '2026-09-15 08:00:00+00'),
              ($6, $7, $8, 'new', $9, $10, timestamptz '2026-09-15 08:00:01+00', timestamptz '2026-09-15 08:00:01+00')`,
      [
        values.leadA,
        ORGANIZATION_A,
        values.contactA,
        values.channelA,
        values.locationA,
        values.leadB,
        ORGANIZATION_B,
        values.contactB,
        values.channelB,
        values.locationB,
      ],
    );
    await pool.query(
      `insert into conversations
        (id, organization_id, contact_id, lead_id, channel_connection_id, external_thread_hash,
         status, preferred_locale, automation_mode, next_sequence_no, started_at, last_activity_at)
       values ($1, $2, $3, $4, $5, $6, 'open', 'uz', 'ai', 3, now(), now()),
              ($7, $8, $9, $10, $11, $12, 'open', 'en', 'ai', 1, now(), now())`,
      [
        values.conversationA,
        ORGANIZATION_A,
        values.contactA,
        values.leadA,
        values.channelA,
        randomBytes(32),
        values.conversationB,
        ORGANIZATION_B,
        values.contactB,
        values.leadB,
        values.channelB,
        randomBytes(32),
      ],
    );
    const body = protection.protectMessageBody({
      channelConnectionId: CHANNEL_A,
      content: { locale_hint: "uz", text: "Salom", type: "text" },
      contentType: "text",
      organizationId: ORGANIZATION_A,
    });
    await pool.query(
      `insert into messages
        (id, organization_id, conversation_id, channel_connection_id, direction, sender_type,
         sender_contact_id, sequence_no, content_type, body_ciphertext, body_hash, locale,
         processing_status, delivery_status, redacted_at)
       values ($1, $2, $3, $4, 'inbound', 'customer', $5, 1, 'text', $6, $7, 'uz', 'accepted', 'not_applicable', null),
              ($8, $2, $3, $4, 'inbound', 'customer', $5, 2, 'text', null, $9, 'uz', 'processed', 'not_applicable', now())`,
      [
        values.messageA,
        ORGANIZATION_A,
        values.conversationA,
        values.channelA,
        values.contactA,
        body.ciphertext,
        body.hash,
        values.messageRedacted,
        randomBytes(32),
      ],
    );
  };

  beforeEach(async () => {
    await seed();
    useCases = createStaffConversationQueryUseCases(
      createStaffConversationQueryStore(options.runtime()),
      protection,
      createStaffQueryCursorCodec(Uint8Array.from({ length: 32 }, () => 17)),
    );
  });

  describe("S9.B tenant staff query repository", () => {
    it("reads and reveals same-tenant contact data after location authorization", async () => {
      const result = await useCases.getContact({
        authorization: await authorizationFor(ORGANIZATION_A, [LOCATION_A]),
        input: { id: CONTACT_A },
      });
      expect(result).toMatchObject({
        ok: true,
        value: { display_name: "Aziza", identities: [{ value: "participant-a" }] },
      });
    });

    it("fails closed for cross-tenant and inaccessible-location identifiers", async () => {
      const authorization = await authorizationFor(ORGANIZATION_A, [LOCATION_A]);
      expect(await useCases.getLead({ authorization, input: { id: LEAD_B } })).toEqual({
        error: { code: "resource_not_found" },
        ok: false,
      });
      expect(
        await useCases.getConversation({
          authorization: await authorizationFor(ORGANIZATION_A, []),
          input: { id: CONVERSATION_A },
        }),
      ).toEqual({ error: { code: "resource_not_found" }, ok: false });
    });

    it("filters and keyset-paginates Leads and Conversations in tenant scope", async () => {
      const authorization = await authorizationFor(ORGANIZATION_A, [], "all");
      const leads = await useCases.listLeads({ authorization, input: { limit: 1, status: "new" } });
      expect(leads.ok && leads.value.items.map(({ id }) => id)).toEqual([LEAD_A]);
      const conversations = await useCases.listConversations({
        authorization,
        input: { channel_connection_id: CHANNEL_A, limit: 1 },
      });
      expect(conversations.ok && conversations.value.items.map(({ id }) => id)).toEqual([
        CONVERSATION_A,
      ]);
    });

    it("reveals supported messages while preserving redaction", async () => {
      const result = await useCases.listMessages({
        authorization: await authorizationFor(ORGANIZATION_A, [LOCATION_A]),
        conversationId: CONVERSATION_A,
        input: { limit: 10 },
      });
      expect(result.ok && result.value.items.map(({ body_text }) => body_text)).toEqual([
        "Salom",
        null,
      ]);
    });

    it("binds Message cursor use to the authorized Conversation", async () => {
      const authorization = await authorizationFor(ORGANIZATION_A, [LOCATION_A]);
      const first = await useCases.listMessages({
        authorization,
        conversationId: CONVERSATION_A,
        input: { limit: 1 },
      });
      expect(first.ok && first.value.nextCursor).not.toBeNull();
      if (!first.ok || first.value.nextCursor === null)
        throw new TypeError("Expected Message cursor");
      expect(
        await useCases.listMessages({
          authorization,
          conversationId: CONVERSATION_B,
          input: { cursor: first.value.nextCursor, limit: 1 },
        }),
      ).toEqual({ error: { code: "validation_failed" }, ok: false });
    });
  });
};
