import { createTenantAnalytics } from "@lead-agent/application";
import { createStaffWebAuthConfig } from "@lead-agent/config";
import {
  MembershipIdSchema,
  OrganizationIdSchema,
  ResourceIdSchema,
  UserIdSchema,
  UtcTimestampSchema,
  isSchemaValue,
  type OrganizationId,
  type MembershipId,
  type ResourceId,
  type StaffAnalytics,
  type UserId,
} from "@lead-agent/contracts";
import {
  SessionAuthenticationRequiredError,
  createBrowserAuthEnvelopeProtector,
  createOidcIdentityVerifier,
  type AuthenticatedApplicationSession,
  type MembershipRole,
} from "@lead-agent/security";
import { describe, expect, it, vi } from "vitest";

import { createApi, type StaffAuthDependencies } from "../src/app.js";

const ids = {
  membership: "0199f1a8-7f65-7c28-a434-a10796c49a01",
  organization: "0199f1a8-7f65-7c28-a434-a10796c49a02",
  otherOrganization: "0199f1a8-7f65-7c28-a434-a10796c49a03",
  session: "0199f1a8-7f65-7c28-a434-a10796c49a04",
  user: "0199f1a8-7f65-7c28-a434-a10796c49a05",
} as const;
const from = "2026-09-12T10:00:00.000Z",
  to = "2026-09-19T10:00:00.000Z";
if (
  !isSchemaValue(MembershipIdSchema, ids.membership) ||
  !isSchemaValue(OrganizationIdSchema, ids.organization) ||
  !isSchemaValue(OrganizationIdSchema, ids.otherOrganization) ||
  !isSchemaValue(ResourceIdSchema, ids.session) ||
  !isSchemaValue(UserIdSchema, ids.user) ||
  !isSchemaValue(UtcTimestampSchema, from) ||
  !isSchemaValue(UtcTimestampSchema, to)
)
  throw new TypeError("Invalid S20 API fixture");
const MEMBERSHIP_ID: MembershipId = ids.membership;
const ORGANIZATION_ID: OrganizationId = ids.organization;
const OTHER_ORGANIZATION_ID: OrganizationId = ids.otherOrganization;
const SESSION_ID: ResourceId = ids.session;
const USER_ID: UserId = ids.user;

const emptyLatency = {
  count: 0,
  max_ms: null,
  over_60_seconds: 0,
  p50_ms: null,
  p75_ms: null,
  p90_ms: null,
  p95_ms: null,
  p99_ms: null,
  within_10_seconds: 0,
  within_30_seconds: 0,
  within_3_seconds: 0,
  within_5_seconds: 0,
  within_60_seconds: 0,
} as const;
const report: StaffAnalytics = {
  channels: [],
  conversion_basis_points: {
    appointment_request_to_staff_accepted: 7_778,
    appointment_request_to_confirmed: 5_000,
    confirmed_to_attended: 7_273,
    lead_to_appointment_request: 4_286,
    lead_to_attended: 1_905,
    lead_to_confirmed: 2_619,
    staff_accepted_to_confirmed: 7_857,
  },
  daily: [],
  funnel: {
    appointment_requests: 18,
    attended: 8,
    awaiting_customer_confirmation: 12,
    confirmed_appointments: 11,
    conversations: 39,
    handoffs: 7,
    inbound_meaningful_messages: 91,
    leads: 42,
    qualified_leads: 24,
    staff_accepted: 14,
    unique_contacts: 40,
  },
  latency: {
    acknowledgement: emptyLatency,
    external_message_to_submit_normal_availability: emptyLatency,
    external_message_to_submit_raw: emptyLatency,
    platform_meaningful_normal_availability: emptyLatency,
    platform_meaningful_raw: emptyLatency,
    widget_customer_render: emptyLatency,
  },
  range: { boundary: "from_inclusive_to_exclusive", from, time_zone: "Asia/Tashkent", to },
  recorded_attributed_revenue: { amounts: [], available: false },
  usage: {
    automated_messages: 48,
    automation_rate_basis_points: 5_275,
  },
};

const fixture = () => {
  let role: MembershipRole = "analyst";
  let sessionValid = true;
  const now = new Date("2026-09-19T10:00:00.000Z");
  const config = createStaffWebAuthConfig({
    browserEnvelopeKey: Buffer.alloc(32, 71).toString("base64url"),
    callbackUri: "https://api.example.test/v1/staff/auth/callback",
    clientId: "staff-client",
    clientSecret: "synthetic-test-value",
    environment: "production",
    invitationTargetEncryptionKey: Buffer.alloc(32, 72).toString("base64url"),
    invitationTargetLookupKey: Buffer.alloc(32, 73).toString("base64url"),
    issuer: "https://tenant.auth0.example/",
    requireMfa: true,
    staffAllowedOrigins: ["https://staff.example.test"],
    staffApplicationOrigin: "https://staff.example.test",
  });
  const envelope = createBrowserAuthEnvelopeProtector(config.browserEnvelopeKey);
  const session: AuthenticatedApplicationSession = {
    absoluteExpiresAt: new Date("2026-09-20T10:00:00.000Z"),
    authenticationLevel: "mfa",
    authenticationTime: now,
    createdAt: now,
    idleExpiresAt: new Date("2026-09-19T11:00:00.000Z"),
    lastSeenAt: now,
    rotatedAt: now,
    rotationDue: false,
    sessionId: SESSION_ID,
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
      resolveCurrentMembership: (_, organizationId) =>
        organizationId === ORGANIZATION_ID
          ? Promise.resolve({
              allowedLocationIds: [],
              locationScope: "all",
              membershipId: MEMBERSHIP_ID,
              organizationId,
              role,
              status: "active",
              userId: USER_ID,
            })
          : Promise.resolve(null),
    },
    clock: () => now,
    config,
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
        sessionValid
          ? Promise.resolve(session)
          : Promise.reject(new SessionAuthenticationRequiredError()),
      revokeSession: () => Promise.resolve(),
      revokeUserSessions: () => Promise.resolve(0),
      rotateSession: () => Promise.reject(new Error("not used")),
    },
  };
  const read = vi.fn(() => Promise.resolve(report));
  const api = createApi({
    staffAnalytics: { analytics: createTenantAnalytics({ read }) },
    staffAuth: auth,
  });
  const headers = (organization: OrganizationId = ORGANIZATION_ID) => ({
    cookie: `__Host-lead-session=${sealed}; __Host-lead-csrf=${csrf}`,
    "x-organization-context": organization,
  });
  return {
    api,
    headers,
    read,
    setRole: (next: MembershipRole) => (role = next),
    setSessionValid: (next: boolean) => (sessionValid = next),
  };
};

describe("S20 private staff analytics API", { timeout: 30_000 }, () => {
  it("requires authenticated analytics permission and never returns internal COGS", async () => {
    const f = fixture();
    try {
      f.setSessionValid(false);
      expect(
        (
          await f.api.inject({
            method: "GET",
            url: `/v1/staff/analytics?from=${from}&to=${to}`,
            headers: f.headers(),
          })
        ).statusCode,
      ).toBe(401);
      f.setSessionValid(true);
      f.setRole("staff");
      expect(
        (
          await f.api.inject({
            method: "GET",
            url: `/v1/staff/analytics?from=${from}&to=${to}`,
            headers: f.headers(),
          })
        ).statusCode,
      ).toBe(403);
      f.setRole("analyst");
      const response = await f.api.inject({
        method: "GET",
        url: `/v1/staff/analytics?from=${from}&to=${to}&group_by=day`,
        headers: f.headers(),
      });
      expect(response.statusCode).toBe(200);
      expect(response.headers["cache-control"]).toContain("no-store");
      expect(response.json()).toMatchObject({ data: { funnel: { leads: 42 } } });
      expect(response.body).not.toMatch(/provider|model|margin|cost|token|message_text/iu);
      expect(f.read).toHaveBeenCalledOnce();
    } finally {
      await f.api.close();
    }
  });

  it("does not enumerate another organization", async () => {
    const f = fixture();
    try {
      expect(
        (
          await f.api.inject({
            method: "GET",
            url: `/v1/staff/analytics?from=${from}&to=${to}`,
            headers: f.headers(OTHER_ORGANIZATION_ID),
          })
        ).statusCode,
      ).toBe(403);
      expect(f.read).not.toHaveBeenCalled();
    } finally {
      await f.api.close();
    }
  });
});
