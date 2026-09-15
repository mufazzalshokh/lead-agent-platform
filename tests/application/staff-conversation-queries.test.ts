import { describe, expect, it, vi } from "vitest";

import {
  createStaffConversationQueryUseCases,
  createStaffQueryCursorCodec,
  type StaffConversationQueryStore,
  type StaffCustomerDataRevealer,
  type StoredContact,
  type StoredMessage,
} from "../../packages/application/src/index.js";
import {
  ContactIdSchema,
  ChannelConnectionIdSchema,
  ConversationIdSchema,
  LeadIdSchema,
  LocationIdSchema,
  MembershipIdSchema,
  MessageIdSchema,
  OrganizationIdSchema,
  ResourceIdSchema,
  UtcTimestampSchema,
  UserIdSchema,
  isSchemaValue,
  type ContactId,
  type ChannelConnectionId,
  type ConversationId,
  type LeadId,
  type LocationId,
  type MembershipId,
  type MessageId,
  type OrganizationId,
  type ResourceId,
  type StaffConversation,
  type StaffLead,
  type UtcTimestamp,
  type UserId,
} from "../../packages/contracts/src/index.js";
import {
  resolveAuthorizationContext,
  type AuthenticatedApplicationSession,
  type AuthorizationContext,
  type CurrentMembershipAuthorization,
  type LocationScope,
  type MembershipRole,
} from "../../packages/security/src/index.js";

const ids = {
  channel: "0199f1a8-7f65-7c28-a434-a10796c47601",
  contact: "0199f1a8-7f65-7c28-a434-a10796c47602",
  conversation: "0199f1a8-7f65-7c28-a434-a10796c47603",
  identity: "0199f1a8-7f65-7c28-a434-a10796c47604",
  lead: "0199f1a8-7f65-7c28-a434-a10796c47605",
  location: "0199f1a8-7f65-7c28-a434-a10796c47606",
  membership: "0199f1a8-7f65-7c28-a434-a10796c47607",
  message: "0199f1a8-7f65-7c28-a434-a10796c47608",
  organization: "0199f1a8-7f65-7c28-a434-a10796c47609",
  otherLocation: "0199f1a8-7f65-7c28-a434-a10796c4760b",
  otherMembership: "0199f1a8-7f65-7c28-a434-a10796c4760c",
  otherOrganization: "0199f1a8-7f65-7c28-a434-a10796c4760d",
  otherUser: "0199f1a8-7f65-7c28-a434-a10796c4760e",
  user: "0199f1a8-7f65-7c28-a434-a10796c4760a",
} as const;
const NOW_VALUE = "2026-09-15T08:00:00.000Z";
if (
  !isSchemaValue(ChannelConnectionIdSchema, ids.channel) ||
  !isSchemaValue(ContactIdSchema, ids.contact) ||
  !isSchemaValue(ConversationIdSchema, ids.conversation) ||
  !isSchemaValue(ResourceIdSchema, ids.identity) ||
  !isSchemaValue(LeadIdSchema, ids.lead) ||
  !isSchemaValue(LocationIdSchema, ids.location) ||
  !isSchemaValue(MembershipIdSchema, ids.membership) ||
  !isSchemaValue(MessageIdSchema, ids.message) ||
  !isSchemaValue(OrganizationIdSchema, ids.organization) ||
  !isSchemaValue(LocationIdSchema, ids.otherLocation) ||
  !isSchemaValue(MembershipIdSchema, ids.otherMembership) ||
  !isSchemaValue(OrganizationIdSchema, ids.otherOrganization) ||
  !isSchemaValue(UserIdSchema, ids.otherUser) ||
  !isSchemaValue(UserIdSchema, ids.user) ||
  !isSchemaValue(UtcTimestampSchema, NOW_VALUE)
)
  throw new TypeError("Invalid S9.B application fixture");

const CONTACT_ID: ContactId = ids.contact;
const CHANNEL_ID: ChannelConnectionId = ids.channel;
const CONVERSATION_ID: ConversationId = ids.conversation;
const LEAD_ID: LeadId = ids.lead;
const LOCATION_ID: LocationId = ids.location;
const MEMBERSHIP_ID: MembershipId = ids.membership;
const MESSAGE_ID: MessageId = ids.message;
const ORGANIZATION_ID: OrganizationId = ids.organization;
const USER_ID: UserId = ids.user;
const NOW: UtcTimestamp = NOW_VALUE;

const session = (userId: UserId = USER_ID): AuthenticatedApplicationSession => ({
  absoluteExpiresAt: new Date("2026-09-16T08:00:00.000Z"),
  authenticationLevel: "mfa",
  authenticationTime: new Date(NOW),
  createdAt: new Date(NOW),
  idleExpiresAt: new Date("2026-09-15T09:00:00.000Z"),
  lastSeenAt: new Date(NOW),
  rotatedAt: new Date(NOW),
  rotationDue: false,
  sessionId: ids.identity,
  userId,
});

const authorizationFor = async (
  role: MembershipRole = "staff",
  locationScope: LocationScope = "all",
  allowedLocationIds: readonly LocationId[] = [],
  actor: Readonly<{
    membershipId: MembershipId;
    organizationId: OrganizationId;
    userId: UserId;
  }> = {
    membershipId: MEMBERSHIP_ID,
    organizationId: ORGANIZATION_ID,
    userId: USER_ID,
  },
): Promise<AuthorizationContext> => {
  const current: CurrentMembershipAuthorization = {
    allowedLocationIds,
    locationScope,
    membershipId: actor.membershipId,
    organizationId: actor.organizationId,
    role,
    status: "active",
    userId: actor.userId,
  };
  return resolveAuthorizationContext(session(actor.userId), actor.organizationId, {
    resolveCurrentMembership: () => Promise.resolve(current),
  });
};

const storedContact = (status: "active" | "anonymized" = "active"): StoredContact => ({
  anonymized_at: status === "anonymized" ? NOW : null,
  created_at: NOW,
  displayNameCiphertext: status === "anonymized" ? null : Uint8Array.of(1),
  first_seen_at: NOW,
  id: CONTACT_ID,
  identities: [
    {
      channel_connection_id: CHANNEL_ID,
      display_redacted: status === "anonymized" ? null : "@a***",
      id: ids.identity as ResourceId,
      identity_type: "telegram_user",
      status: status === "anonymized" ? "anonymized" : "active",
      validation_status: "verified",
      valueCiphertext: status === "anonymized" ? null : Uint8Array.of(2),
      verified_at: NOW,
    },
  ],
  last_seen_at: NOW,
  preferred_locale: "uz",
  status,
  updated_at: NOW,
  version: 1,
});

const lead: StaffLead = {
  assigned_membership_id: null,
  booking_requested_at: null,
  campaign_key: null,
  closed_at: null,
  closed_reason: null,
  contact_id: CONTACT_ID,
  converted_at: null,
  created_at: NOW,
  engaged_at: null,
  id: LEAD_ID,
  location_id: LOCATION_ID,
  qualification_policy_id: null,
  qualification_reason_codes: [],
  qualified_at: null,
  service_id: null,
  source_channel_connection_id: CHANNEL_ID,
  status: "new",
  updated_at: NOW,
  version: 1,
};

const conversation: StaffConversation = {
  active_handoff_id: null,
  automation_mode: "ai",
  channel_connection_id: CHANNEL_ID,
  closed_at: null,
  contact_id: CONTACT_ID,
  created_at: NOW,
  id: CONVERSATION_ID,
  last_activity_at: NOW,
  lead_id: LEAD_ID,
  participant: {
    contact_id: CONTACT_ID,
    display_redacted: "@a***",
    identity_type: "telegram_user",
  },
  preferred_locale: "uz",
  resolved_at: null,
  started_at: NOW,
  status: "open",
  updated_at: NOW,
  version: 1,
};

const storedMessage = (redacted = false): StoredMessage => ({
  bodyCiphertext: redacted ? null : Uint8Array.of(3),
  channel_connection_id: CHANNEL_ID,
  content_type: "text",
  conversation_id: CONVERSATION_ID,
  created_at: NOW,
  delivery_status: "not_applicable",
  direction: "inbound",
  id: MESSAGE_ID,
  locale: "uz",
  processing_status: "accepted",
  redacted_at: redacted ? NOW : null,
  reply_to_message_id: null,
  sender_membership_id: null,
  sender_type: "customer",
  sequence_no: 1,
});

const harness = (contact: StoredContact = storedContact()) => {
  const getContact = vi.fn(() => Promise.resolve(contact));
  const listLeads = vi.fn(({ limit }: { readonly limit: number }) =>
    Promise.resolve({
      items: [lead],
      next: limit === 1 ? { createdAt: NOW, id: LEAD_ID } : null,
    }),
  );
  const store: StaffConversationQueryStore = {
    getContact,
    getConversation: vi.fn(() => Promise.resolve(conversation)),
    getLead: vi.fn(() => Promise.resolve(lead)),
    listConversations: vi.fn(({ limit }) =>
      Promise.resolve({
        items: [conversation],
        next: limit === 1 ? { id: CONVERSATION_ID, lastActivityAt: NOW } : null,
      }),
    ),
    listLeads,
    listMessages: vi.fn(() => Promise.resolve({ items: [storedMessage()], next: null })),
  };
  const revealContactDisplayName = vi.fn(() => "Aziza");
  const revealContactIdentity = vi.fn(() => "telegram-user");
  const revealMessageBody = vi.fn(() => "Salom");
  const revealer: StaffCustomerDataRevealer = {
    revealContactDisplayName,
    revealContactIdentity,
    revealMessageBody,
  };
  return {
    mocks: {
      getContact,
      listLeads,
      revealContactDisplayName,
      revealContactIdentity,
      revealMessageBody,
    },
    revealer,
    store,
    useCases: createStaffConversationQueryUseCases(
      store,
      revealer,
      createStaffQueryCursorCodec(Uint8Array.from({ length: 32 }, () => 7)),
    ),
  };
};

describe("S9.B staff conversation query application", () => {
  it("authorizes before revealing sensitive contact fields", async () => {
    const fixture = harness();
    const result = await fixture.useCases.getContact({
      authorization: await authorizationFor(),
      input: { id: CONTACT_ID },
    });
    expect(result.ok && result.value.display_name).toBe("Aziza");
    expect(result).toMatchObject({
      ok: true,
      value: { identities: [{ value: "telegram-user" }] },
    });
    expect(fixture.mocks.revealContactDisplayName).toHaveBeenCalledOnce();
  });

  it("never reveals anonymized values even to sensitive readers", async () => {
    const fixture = harness(storedContact("anonymized"));
    const result = await fixture.useCases.getContact({
      authorization: await authorizationFor(),
      input: { id: CONTACT_ID },
    });
    expect(result.ok && result.value.display_name).toBeNull();
    expect(fixture.mocks.revealContactDisplayName).not.toHaveBeenCalled();
    expect(fixture.mocks.revealContactIdentity).not.toHaveBeenCalled();
  });

  it("never invokes reveal for absent protected Contact values", async () => {
    const contact = storedContact();
    const fixture = harness({
      ...contact,
      displayNameCiphertext: null,
      identities: contact.identities.map((identity) => ({
        ...identity,
        valueCiphertext: null,
      })),
    });
    const result = await fixture.useCases.getContact({
      authorization: await authorizationFor(),
      input: { id: CONTACT_ID },
    });
    expect(result).toMatchObject({
      ok: true,
      value: { display_name: null, identities: [{ value: null }] },
    });
    expect(fixture.mocks.revealContactDisplayName).not.toHaveBeenCalled();
    expect(fixture.mocks.revealContactIdentity).not.toHaveBeenCalled();
  });

  it("returns masked Contact fields without invoking reveal when sensitive permission is absent", async () => {
    const fixture = harness();
    const useCases = createStaffConversationQueryUseCases(
      fixture.store,
      fixture.revealer,
      createStaffQueryCursorCodec(Uint8Array.from({ length: 32 }, () => 7)),
      (_role, permission) => permission === "contacts.read",
    );
    const result = await useCases.getContact({
      authorization: await authorizationFor(),
      input: { id: CONTACT_ID },
    });
    expect(result).toMatchObject({
      ok: true,
      value: {
        display_name: null,
        identities: [{ value: null }],
        sensitive_fields_visible: false,
      },
    });
    expect(fixture.mocks.revealContactDisplayName).not.toHaveBeenCalled();
    expect(fixture.mocks.revealContactIdentity).not.toHaveBeenCalled();
  });

  it("denies roles without customer permissions before repository access", async () => {
    const fixture = harness();
    expect(
      await fixture.useCases.getContact({
        authorization: await authorizationFor("analyst"),
        input: { id: CONTACT_ID },
      }),
    ).toEqual({ error: { code: "permission_denied" }, ok: false });
    expect(fixture.mocks.getContact).not.toHaveBeenCalled();
  });

  it("binds Lead cursors to exact filters and Location scope", async () => {
    const fixture = harness();
    const authorization = await authorizationFor("staff", "restricted", [LOCATION_ID]);
    const first = await fixture.useCases.listLeads({
      authorization,
      input: { limit: 1, status: "new" },
    });
    expect(first.ok && first.value.nextCursor).not.toBeNull();
    if (!first.ok || first.value.nextCursor === null) throw new TypeError("Expected cursor");
    expect(
      await fixture.useCases.listLeads({
        authorization,
        input: { cursor: first.value.nextCursor, limit: 1, status: "qualified" },
      }),
    ).toEqual({ error: { code: "validation_failed" }, ok: false });
    expect(fixture.mocks.listLeads.mock.calls).toHaveLength(1);
  });

  it("accepts a valid cursor only for the same tenant, actor, and Location scope", async () => {
    const fixture = harness();
    const authorization = await authorizationFor("staff", "restricted", [LOCATION_ID]);
    const first = await fixture.useCases.listLeads({ authorization, input: { limit: 1 } });
    if (!first.ok || first.value.nextCursor === null) throw new TypeError("Expected cursor");
    const cursor = first.value.nextCursor;

    expect(
      await fixture.useCases.listLeads({ authorization, input: { cursor, limit: 1 } }),
    ).toMatchObject({ ok: true });

    const forged = `${cursor.slice(0, -1)}${cursor.endsWith("A") ? "B" : "A"}`;
    const otherActor = await authorizationFor("staff", "restricted", [LOCATION_ID], {
      membershipId: ids.otherMembership as MembershipId,
      organizationId: ORGANIZATION_ID,
      userId: ids.otherUser as UserId,
    });
    const otherTenant = await authorizationFor("staff", "restricted", [LOCATION_ID], {
      membershipId: ids.otherMembership as MembershipId,
      organizationId: ids.otherOrganization as OrganizationId,
      userId: ids.otherUser as UserId,
    });
    const otherLocationScope = await authorizationFor("staff", "restricted", [
      ids.otherLocation as LocationId,
    ]);
    for (const [candidateAuthorization, candidateCursor] of [
      [authorization, forged],
      [otherActor, cursor],
      [otherTenant, cursor],
      [otherLocationScope, cursor],
    ] as const) {
      expect(
        await fixture.useCases.listLeads({
          authorization: candidateAuthorization,
          input: { cursor: candidateCursor, limit: 1 },
        }),
      ).toEqual({ error: { code: "validation_failed" }, ok: false });
    }
    expect(fixture.mocks.listLeads.mock.calls).toHaveLength(2);
  });

  it("returns only safe conversation summaries and supports keyset continuation", async () => {
    const fixture = harness();
    const result = await fixture.useCases.listConversations({
      authorization: await authorizationFor(),
      input: { limit: 1 },
    });
    expect(result.ok && result.value.items[0]).toEqual(conversation);
    expect(result.ok && result.value.nextCursor).not.toBeNull();
    expect(JSON.stringify(result)).not.toContain("external_thread_hash");
  });

  it("reveals unredacted messages and never invokes reveal for redacted rows", async () => {
    const fixture = harness();
    const authorization = await authorizationFor();
    const visible = await fixture.useCases.listMessages({
      authorization,
      conversationId: CONVERSATION_ID,
      input: {},
    });
    expect(visible.ok && visible.value.items[0]?.body_text).toBe("Salom");
    fixture.store.listMessages = vi.fn(() =>
      Promise.resolve({ items: [storedMessage(true)], next: null }),
    );
    const redacted = await fixture.useCases.listMessages({
      authorization,
      conversationId: CONVERSATION_ID,
      input: {},
    });
    expect(redacted.ok && redacted.value.items[0]?.body_text).toBeNull();
    expect(fixture.mocks.revealMessageBody).toHaveBeenCalledTimes(1);
  });

  it("maps corrupt protected message data to a safe internal failure", async () => {
    const fixture = harness();
    fixture.revealer.revealMessageBody = vi.fn(() => {
      throw new Error("cipher details");
    });
    expect(
      await fixture.useCases.listMessages({
        authorization: await authorizationFor(),
        conversationId: CONVERSATION_ID,
        input: {},
      }),
    ).toEqual({ error: { code: "internal_error" }, ok: false });
  });

  it("maps inaccessible resources to tenant-local not found", async () => {
    const fixture = harness();
    fixture.store.getLead = vi.fn(() => Promise.resolve(null));
    expect(
      await fixture.useCases.getLead({
        authorization: await authorizationFor("staff", "restricted", [LOCATION_ID]),
        input: { id: LEAD_ID },
      }),
    ).toEqual({ error: { code: "resource_not_found" }, ok: false });
  });
});
