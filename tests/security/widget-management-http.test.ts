import { describe, expect, it, vi } from "vitest";

import { createApi, type StaffAuthDependencies } from "../../apps/api/src/app.js";
import type { WidgetManagementUseCases } from "../../packages/application/src/index.js";
import { createStaffWebAuthConfig } from "../../packages/config/src/index.js";
import {
  SessionAuthenticationRequiredError,
  createBrowserAuthEnvelopeProtector,
  createOidcIdentityVerifier,
  type MembershipRole,
} from "../../packages/security/src/index.js";
import { IDS, NOW, staffSession } from "../telegram/fixtures.js";

const PUBLISHABLE_KEY = "w".repeat(43);
const WEBSITE_ORIGIN = "https://clinic.example";

const fixture = (role: MembershipRole = "owner") => {
  const origin = "https://staff.example.test";
  const csrf = "c".repeat(43);
  const sessionToken = "t".repeat(43);
  const config = createStaffWebAuthConfig({
    browserEnvelopeKey: Buffer.alloc(32, 31).toString("base64url"),
    callbackUri: "https://staff.example.test/v1/staff/auth/callback",
    clientId: "staff-widget-test-client",
    clientSecret: "synthetic-test-only",
    environment: "production",
    invitationTargetEncryptionKey: Buffer.alloc(32, 32).toString("base64url"),
    invitationTargetLookupKey: Buffer.alloc(32, 33).toString("base64url"),
    issuer: "https://tenant.auth0.example/",
    requireMfa: true,
    staffAllowedOrigins: [origin],
    staffApplicationOrigin: origin,
  });
  const envelopeProtector = createBrowserAuthEnvelopeProtector(config.browserEnvelopeKey);
  const sealedSession = envelopeProtector.sealSession({
    csrfSecret: csrf,
    expiresAt: staffSession.absoluteExpiresAt,
    sessionToken,
  });
  const staffAuth: StaffAuthDependencies = {
    authorizationResolver: {
      resolveCurrentMembership: (userId, organizationId) =>
        Promise.resolve(
          userId === IDS.user && organizationId === IDS.organization
            ? {
                allowedLocationIds: [],
                locationScope: "all",
                membershipId: IDS.membership,
                organizationId: IDS.organization,
                role,
                status: "active",
                userId: IDS.user,
              }
            : null,
        ),
    },
    clock: () => NOW,
    config,
    envelopeProtector,
    identityResolver: { resolve: () => Promise.reject(new Error("not used")) },
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
      resolveSession: (token) =>
        token === sessionToken
          ? Promise.resolve(staffSession)
          : Promise.reject(new SessionAuthenticationRequiredError()),
      revokeSession: () => Promise.resolve(),
      revokeUserSessions: () => Promise.resolve(0),
      rotateSession: () => Promise.reject(new Error("not used")),
    },
  };
  const configured = Object.freeze({
    channelConnectionId: IDS.channel,
    publishableKey: PUBLISHABLE_KEY,
    websiteOrigin: WEBSITE_ORIGIN,
  });
  const configure = vi.fn<WidgetManagementUseCases["configure"]>(() => Promise.resolve(configured));
  const useCases: WidgetManagementUseCases = {
    configure,
    get: vi.fn(() => Promise.resolve(configured)),
  };
  const api = createApi({ staffAuth, staffWidgetManagement: { useCases } });
  const headers: Record<string, string> = {
    cookie: `__Host-lead-session=${sealedSession}; __Host-lead-csrf=${csrf}`,
    origin,
    "sec-fetch-site": "same-origin",
    "x-csrf-token": csrf,
    "x-organization-context": IDS.organization,
  };
  return { api, configure, headers };
};

describe("S22 Widget management HTTP boundary", () => {
  it("returns only tenant configuration and configures through authenticated owner context", async () => {
    const { api, configure, headers } = fixture();
    try {
      const current = await api.inject({
        headers,
        method: "GET",
        url: "/v1/staff/integrations/widget",
      });
      expect(current.statusCode).toBe(200);
      expect(JSON.parse(current.body) as unknown).toEqual({
        publishable_key: PUBLISHABLE_KEY,
        status: "active",
        website_origin: WEBSITE_ORIGIN,
      });
      const configured = await api.inject({
        headers,
        method: "POST",
        payload: { website_origin: WEBSITE_ORIGIN },
        url: "/v1/staff/integrations/widget/setup",
      });
      expect(configured.statusCode).toBe(201);
      expect(configured.body).not.toMatch(/bearer|exchange|organization_id|secret|token/iu);
      expect(configure).toHaveBeenCalledOnce();
      const input = configure.mock.calls[0]?.[0];
      expect(input?.authorization.organizationId).toBe(IDS.organization);
      expect(input?.authorization.role).toBe("owner");
      expect(input?.websiteOrigin).toBe(WEBSITE_ORIGIN);
    } finally {
      await api.close();
    }
  });

  it("denies unauthorized roles, missing tenant context, and cross-tenant context", async () => {
    const { api, configure, headers } = fixture("staff");
    try {
      for (const candidate of [
        headers,
        { ...headers, "x-organization-context": IDS.otherOrganization },
        Object.fromEntries(
          Object.entries(headers).filter(([name]) => name !== "x-organization-context"),
        ),
      ]) {
        const response = await api.inject({
          headers: candidate,
          method: "POST",
          payload: { website_origin: WEBSITE_ORIGIN },
          url: "/v1/staff/integrations/widget/setup",
        });
        expect(response.statusCode).toBe(403);
      }
      expect(configure).not.toHaveBeenCalled();
    } finally {
      await api.close();
    }
  });

  it("preserves the session, CSRF, Origin, and Fetch Metadata boundary", async () => {
    const { api, configure, headers } = fixture();
    const missingCsrf = { ...headers };
    delete missingCsrf["x-csrf-token"];
    try {
      for (const candidate of [
        {},
        missingCsrf,
        { ...headers, "x-csrf-token": "wrong" },
        { ...headers, origin: "https://attacker.example" },
        { ...headers, "sec-fetch-site": "cross-site" },
      ]) {
        const response = await api.inject({
          headers: candidate,
          method: "POST",
          payload: { website_origin: WEBSITE_ORIGIN },
          url: "/v1/staff/integrations/widget/setup",
        });
        expect([401, 403]).toContain(response.statusCode);
      }
      expect(configure).not.toHaveBeenCalled();
    } finally {
      await api.close();
    }
  });
});
