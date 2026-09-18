import type { StaffConversationDependencies, StaffAuthDependencies } from "../src/app.js";
import { createApi } from "../src/app.js";
import { createStaffWebAuthConfig } from "@lead-agent/config";
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
  type StaffContact,
  type StaffConversation,
  type StaffLead,
  type StaffMessage,
  type UserId,
  type UtcTimestamp,
} from "@lead-agent/contracts";
import {
  SessionAuthenticationRequiredError,
  createBrowserAuthEnvelopeProtector,
  createOidcIdentityVerifier,
  type AuthenticatedApplicationSession,
  type MembershipRole,
} from "@lead-agent/security";
import { describe, expect, it } from "vitest";
import {
  createStaffOperations,
  createStaffQueryCursorCodec,
  type StaffOperationsStore,
} from "@lead-agent/application";
import { staffWorkFixture } from "../../../tests/application/staff-operations-fixtures.js";

const NOW_TEXT_VALUE = "2026-09-15T08:00:00.000Z";
const NOW = new Date(NOW_TEXT_VALUE);
const STAFF_ORIGIN = "https://staff.example.test";
const ids = {
  channel: "0199f1a8-7f65-7c28-a434-a10796c47701",
  contact: "0199f1a8-7f65-7c28-a434-a10796c47702",
  conversation: "0199f1a8-7f65-7c28-a434-a10796c47703",
  identity: "0199f1a8-7f65-7c28-a434-a10796c47704",
  lead: "0199f1a8-7f65-7c28-a434-a10796c47705",
  location: "0199f1a8-7f65-7c28-a434-a10796c47706",
  membership: "0199f1a8-7f65-7c28-a434-a10796c47707",
  message: "0199f1a8-7f65-7c28-a434-a10796c47708",
  organization: "0199f1a8-7f65-7c28-a434-a10796c47709",
  otherOrganization: "0199f1a8-7f65-7c28-a434-a10796c4770a",
  session: "0199f1a8-7f65-7c28-a434-a10796c4770b",
  user: "0199f1a8-7f65-7c28-a434-a10796c4770c",
} as const;
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
  !isSchemaValue(OrganizationIdSchema, ids.otherOrganization) ||
  !isSchemaValue(ResourceIdSchema, ids.session) ||
  !isSchemaValue(UserIdSchema, ids.user) ||
  !isSchemaValue(UtcTimestampSchema, NOW_TEXT_VALUE)
)
  throw new TypeError("Invalid S9.B API fixture");

const CHANNEL_ID: ChannelConnectionId = ids.channel;
const CONTACT_ID: ContactId = ids.contact;
const CONVERSATION_ID: ConversationId = ids.conversation;
const LEAD_ID: LeadId = ids.lead;
const LOCATION_ID: LocationId = ids.location;
const MEMBERSHIP_ID: MembershipId = ids.membership;
const MESSAGE_ID: MessageId = ids.message;
const ORGANIZATION_ID: OrganizationId = ids.organization;
const OTHER_ORGANIZATION_ID: OrganizationId = ids.otherOrganization;
const USER_ID: UserId = ids.user;
const NOW_TEXT: UtcTimestamp = NOW_TEXT_VALUE;

const contact: StaffContact = {
  anonymized_at: null,
  created_at: NOW_TEXT,
  display_name: "Aziza",
  first_seen_at: NOW_TEXT,
  id: CONTACT_ID,
  identities: [
    {
      channel_connection_id: CHANNEL_ID,
      display_redacted: "@a***",
      id: ids.identity,
      identity_type: "telegram_user",
      status: "active",
      validation_status: "verified",
      value: "telegram-user",
      verified_at: NOW_TEXT,
    },
  ],
  last_seen_at: NOW_TEXT,
  preferred_locale: "uz",
  sensitive_fields_visible: true,
  status: "active",
  updated_at: NOW_TEXT,
  version: 1,
};
const lead: StaffLead = {
  assigned_membership_id: null,
  booking_requested_at: null,
  campaign_key: null,
  closed_at: null,
  closed_reason: null,
  contact_id: CONTACT_ID,
  converted_at: null,
  created_at: NOW_TEXT,
  engaged_at: null,
  id: LEAD_ID,
  location_id: LOCATION_ID,
  qualification_policy_id: null,
  qualification_reason_codes: [],
  qualified_at: null,
  service_id: null,
  source_channel_connection_id: CHANNEL_ID,
  status: "new",
  updated_at: NOW_TEXT,
  version: 1,
};
const conversation: StaffConversation = {
  active_handoff_id: null,
  automation_mode: "ai",
  channel_connection_id: CHANNEL_ID,
  closed_at: null,
  contact_id: CONTACT_ID,
  created_at: NOW_TEXT,
  id: CONVERSATION_ID,
  last_activity_at: NOW_TEXT,
  lead_id: LEAD_ID,
  participant: {
    contact_id: CONTACT_ID,
    display_redacted: "@a***",
    identity_type: "telegram_user",
  },
  preferred_locale: "uz",
  resolved_at: null,
  started_at: NOW_TEXT,
  status: "open",
  updated_at: NOW_TEXT,
  version: 1,
};
const message: StaffMessage = {
  body_text: "Salom",
  channel_connection_id: CHANNEL_ID,
  content_type: "text",
  conversation_id: CONVERSATION_ID,
  created_at: NOW_TEXT,
  delivery_status: "not_applicable",
  direction: "inbound",
  id: MESSAGE_ID,
  locale: "uz",
  processing_status: "accepted",
  redacted_at: null,
  reply_to_message_id: null,
  sender_membership_id: null,
  sender_type: "customer",
  sequence_no: 1,
};

type Controls = {
  calls: { authorization: unknown; operation: string }[];
  role: MembershipRole;
  sessionValid: boolean;
};

const createFixture = (withOperations = false) => {
  const controls: Controls = { calls: [], role: "staff", sessionValid: true };
  const record = <Value>(operation: string, authorization: unknown, value: Value) => {
    controls.calls.push({ authorization, operation });
    return Promise.resolve({ ok: true as const, value });
  };
  const staffConversations: StaffConversationDependencies = {
    queries: {
      getContact: ({ authorization }) => record("getContact", authorization, contact),
      getConversation: ({ authorization }) =>
        record("getConversation", authorization, conversation),
      getLead: ({ authorization }) => record("getLead", authorization, lead),
      listConversations: ({ authorization }) =>
        record("listConversations", authorization, { items: [conversation], nextCursor: null }),
      listLeads: ({ authorization }) =>
        record("listLeads", authorization, { items: [lead], nextCursor: null }),
      listMessages: ({ authorization }) =>
        record("listMessages", authorization, { items: [message], nextCursor: null }),
    },
  };
  const web = createStaffWebAuthConfig({
    browserEnvelopeKey: Buffer.alloc(32, 41).toString("base64url"),
    callbackUri: "https://api.example.test/v1/staff/auth/callback",
    clientId: "staff-client",
    clientSecret: "synthetic-test-value",
    environment: "production",
    invitationTargetEncryptionKey: Buffer.alloc(32, 42).toString("base64url"),
    invitationTargetLookupKey: Buffer.alloc(32, 43).toString("base64url"),
    issuer: "https://tenant.auth0.example/",
    requireMfa: true,
    staffAllowedOrigins: [STAFF_ORIGIN],
    staffApplicationOrigin: STAFF_ORIGIN,
  });
  const envelope = createBrowserAuthEnvelopeProtector(web.browserEnvelopeKey);
  const session: AuthenticatedApplicationSession = {
    absoluteExpiresAt: new Date("2026-09-16T08:00:00.000Z"),
    authenticationLevel: "mfa",
    authenticationTime: NOW,
    createdAt: NOW,
    idleExpiresAt: new Date("2026-09-15T09:00:00.000Z"),
    lastSeenAt: NOW,
    rotatedAt: NOW,
    rotationDue: false,
    sessionId: ids.session,
    userId: USER_ID,
  };
  const csrf = "c".repeat(43);
  const sealed = envelope.sealSession({
    csrfSecret: csrf,
    expiresAt: session.absoluteExpiresAt,
    sessionToken: "s".repeat(43),
  });
  const auth: StaffAuthDependencies = {
    authorizationResolver: {
      resolveCurrentMembership: (userId, organizationId) =>
        organizationId === ORGANIZATION_ID
          ? Promise.resolve({
              allowedLocationIds: [LOCATION_ID],
              locationScope: "restricted",
              membershipId: MEMBERSHIP_ID,
              organizationId,
              role: controls.role,
              status: "active",
              userId,
            })
          : Promise.resolve(null),
    },
    clock: () => NOW,
    config: web,
    envelopeProtector: envelope,
    identityResolver: { resolve: () => Promise.resolve(USER_ID) },
    invitationAcceptance: { accept: () => Promise.reject(new Error("not used")) },
    oidcClient: {
      begin: () => Promise.reject(new Error("not used")),
      complete: () => Promise.reject(new Error("not used")),
    },
    oidcVerifier: createOidcIdentityVerifier({
      verifyEvidence: () => Promise.reject(new Error("not used")),
    }),
    sessions: {
      createSession: () => Promise.reject(new Error("not used")),
      resolveSession: () =>
        controls.sessionValid
          ? Promise.resolve(session)
          : Promise.reject(new SessionAuthenticationRequiredError()),
      revokeSession: () => Promise.resolve(),
      revokeUserSessions: () => Promise.resolve(0),
      rotateSession: () => Promise.reject(new Error("not used")),
    },
  };
  const staffStore: StaffOperationsStore = {
    list: ({ authorization }) => {
      controls.calls.push({ authorization, operation: "inbox" });
      return Promise.resolve({ items: [staffWorkFixture], next: null });
    },
    get: () => Promise.resolve(staffWorkFixture),
    outcomes: () => Promise.resolve({ items: [], next: null }),
    mutate: (input) => {
      controls.calls.push({
        authorization: input.authorization,
        operation: input.operation.action,
      });
      return Promise.resolve({
        resource: {
          ...staffWorkFixture,
          status: "staff_accepted",
          appointment_status: "staff_accepted",
          version: 2,
        },
        outcome_id: null,
      });
    },
  };
  const api = createApi({
    staffAuth: auth,
    staffConversations,
    ...(withOperations
      ? {
          staffOperations: {
            operations: createStaffOperations(
              staffStore,
              createStaffQueryCursorCodec(new Uint8Array(32).fill(17)),
              () => NOW,
            ),
          },
        }
      : {}),
  });
  const headers = (organizationId: OrganizationId = ORGANIZATION_ID) => ({
    cookie: `__Host-lead-session=${sealed}; __Host-lead-csrf=${csrf}`,
    "x-organization-context": organizationId,
  });
  return { api, controls, headers, staffConversations, csrf };
};

describe("S17 private API session/origin/CSRF boundary", { timeout: 30000 }, () => {
  it("lists only through authenticated membership and a bounded explicit response", async () => {
    const f = createFixture(true);
    try {
      expect((await f.api.inject({ method: "GET", url: "/v1/staff/inbox" })).statusCode).toBe(401);
      expect(
        (
          await f.api.inject({
            method: "GET",
            url: "/v1/staff/inbox",
            headers: f.headers(OTHER_ORGANIZATION_ID),
          })
        ).statusCode,
      ).toBe(403);
      const response = await f.api.inject({
        method: "GET",
        url: "/v1/staff/inbox",
        headers: f.headers(),
      });
      expect(response.statusCode).toBe(200);
      expect(response.headers["cache-control"]).toBe("no-store");
      expect(response.body).not.toMatch(
        /ciphertext|provider_payload|confirmation_token|reasoning/u,
      );
      f.controls.role = "analyst";
      expect(
        (await f.api.inject({ method: "GET", url: "/v1/staff/inbox", headers: f.headers() }))
          .statusCode,
      ).toBe(403);
    } finally {
      await f.api.close();
    }
  });
  it.each(["missing_origin", "bad_origin", "missing_csrf", "wrong_csrf", "no_session"])(
    "denies protected staff acceptance: %s",
    async (scenario) => {
      const f = createFixture(true);
      try {
        const headers: Record<string, string> = {
          ...f.headers(),
          origin: STAFF_ORIGIN,
          "x-csrf-token": f.csrf,
          "idempotency-key": "s17-accept",
          "if-match": `"${staffWorkFixture.id}:1"`,
        };
        if (scenario === "missing_origin") delete headers["origin"];
        if (scenario === "bad_origin") headers["origin"] = "https://attacker.example";
        if (scenario === "missing_csrf") delete headers["x-csrf-token"];
        if (scenario === "wrong_csrf") headers["x-csrf-token"] = "wrong";
        if (scenario === "no_session") delete headers["cookie"];
        const response = await f.api.inject({
          method: "POST",
          url: `/v1/staff/appointment-requests/${staffWorkFixture.id}/accept`,
          headers,
          payload: { start_at: "2026-09-19T12:00:00.000Z", end_at: "2026-09-19T12:30:00.000Z" },
        });
        expect([401, 403]).toContain(response.statusCode);
        expect(f.controls.calls).toHaveLength(0);
      } finally {
        await f.api.close();
      }
    },
  );
  it("returns 202 staff_accepted, never confirmed or confirmation sent", async () => {
    const f = createFixture(true);
    try {
      const response = await f.api.inject({
        method: "POST",
        url: `/v1/staff/appointment-requests/${staffWorkFixture.id}/accept`,
        headers: {
          ...f.headers(),
          origin: STAFF_ORIGIN,
          "x-csrf-token": f.csrf,
          "idempotency-key": "s17-accept",
          "if-match": `"${staffWorkFixture.id}:1"`,
        },
        payload: { start_at: "2026-09-19T12:00:00.000Z", end_at: "2026-09-19T12:30:00.000Z" },
      });
      expect(response.statusCode).toBe(202);
      expect(response.json()).toMatchObject({ data: { resource: { status: "staff_accepted" } } });
      expect(response.body).not.toMatch(
        /awaiting_customer_confirmation|"confirmed"|confirmation_sent/u,
      );
      expect(f.controls.calls[0]?.operation).toBe("accept");
    } finally {
      await f.api.close();
    }
  });
});

describe("S9.B private staff conversation query API", { timeout: 30_000 }, () => {
  it.each([
    ["getContact", `/v1/staff/contacts/${CONTACT_ID}`, CONTACT_ID],
    ["listLeads", "/v1/staff/leads?status=new&limit=50", LEAD_ID],
    ["getLead", `/v1/staff/leads/${LEAD_ID}`, LEAD_ID],
    ["listConversations", "/v1/staff/conversations?status=open&limit=50", CONVERSATION_ID],
    ["getConversation", `/v1/staff/conversations/${CONVERSATION_ID}`, CONVERSATION_ID],
    ["listMessages", `/v1/staff/conversations/${CONVERSATION_ID}/messages?limit=50`, MESSAGE_ID],
  ] as const)(
    "serves %s through the authenticated read-only route",
    async (operation, url, expectedId) => {
      const fixture = createFixture();
      try {
        const response = await fixture.api.inject({
          headers: fixture.headers(),
          method: "GET",
          url,
        });
        expect(response.statusCode).toBe(200);
        expect(response.body).toContain('"data"');
        expect(response.body).toContain('"request_id"');
        expect(response.body).toContain(expectedId);
        for (const forbiddenField of [
          "body_ciphertext",
          "body_hash",
          "external_message_id",
          "external_thread_hash",
          "organization_id",
          "provider_event_id",
          "provider_payload",
        ]) {
          expect(response.body).not.toContain(forbiddenField);
        }
        expect(fixture.controls.calls.at(-1)?.operation).toBe(operation);
        expect(fixture.controls.calls.at(-1)?.authorization).toMatchObject({
          allowedLocationIds: [LOCATION_ID],
          locationScope: "restricted",
          organizationId: ORGANIZATION_ID,
        });
      } finally {
        await fixture.api.close();
      }
    },
  );

  it("requires an authenticated current membership and does not enumerate tenants", async () => {
    const fixture = createFixture();
    try {
      fixture.controls.sessionValid = false;
      expect(
        (
          await fixture.api.inject({
            headers: fixture.headers(),
            method: "GET",
            url: `/v1/staff/leads/${LEAD_ID}`,
          })
        ).statusCode,
      ).toBe(401);
      fixture.controls.sessionValid = true;
      expect(
        (
          await fixture.api.inject({
            headers: fixture.headers(OTHER_ORGANIZATION_ID),
            method: "GET",
            url: `/v1/staff/leads/${LEAD_ID}`,
          })
        ).statusCode,
      ).toBe(403);
      expect(fixture.controls.calls).toHaveLength(0);
    } finally {
      await fixture.api.close();
    }
  });

  it("maps use-case denials and internal failures to bounded problem details", async () => {
    const fixture = createFixture();
    try {
      fixture.staffConversations.queries.getLead = () =>
        Promise.resolve({ error: { code: "resource_not_found" }, ok: false });
      const missing = await fixture.api.inject({
        headers: fixture.headers(),
        method: "GET",
        url: `/v1/staff/leads/${LEAD_ID}`,
      });
      expect(missing.statusCode).toBe(404);
      fixture.staffConversations.queries.getLead = () =>
        Promise.resolve({ error: { code: "internal_error" }, ok: false });
      const failed = await fixture.api.inject({
        headers: fixture.headers(),
        method: "GET",
        url: `/v1/staff/leads/${LEAD_ID}`,
      });
      expect(failed.statusCode).toBe(500);
      expect(failed.body).not.toContain("cipher");
    } finally {
      await fixture.api.close();
    }
  });

  it("rejects malformed finite filters before the use case", async () => {
    const fixture = createFixture();
    try {
      const response = await fixture.api.inject({
        headers: fixture.headers(),
        method: "GET",
        url: "/v1/staff/leads?status=unknown",
      });
      expect(response.statusCode).toBe(400);
      expect(fixture.controls.calls).toHaveLength(0);
    } finally {
      await fixture.api.close();
    }
  });

  it("rejects standalone staff query dependencies without the auth boundary", async () => {
    const fixture = createFixture();
    try {
      expect(() => createApi({ staffConversations: fixture.staffConversations })).toThrow(
        /authentication boundary/u,
      );
    } finally {
      await fixture.api.close();
    }
  });
});
