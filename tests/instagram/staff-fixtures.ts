import { vi } from "vitest";
import type { StaffAuthDependencies } from "../../apps/api/src/app.js";
import { createStaffWebAuthConfig } from "../../packages/config/src/index.js";
import {
  createBrowserAuthEnvelopeProtector,
  createOidcIdentityVerifier,
  SessionAuthenticationRequiredError,
  type MembershipRole,
} from "../../packages/security/src/index.js";
import { IDS, NOW, staffSession } from "../telegram/fixtures.js";
export const staffFixture = (role: MembershipRole = "owner") => {
  const origin = "https://staff.example.test";
  const csrf = "c".repeat(43);
  const sessionToken = "t".repeat(43);
  const config = createStaffWebAuthConfig({
    browserEnvelopeKey: Buffer.alloc(32, 21).toString("base64url"),
    callbackUri: "https://api.example.test/v1/staff/auth/callback",
    clientId: "staff-test-client",
    clientSecret: "synthetic-test-only",
    environment: "production",
    invitationTargetEncryptionKey: Buffer.alloc(32, 22).toString("base64url"),
    invitationTargetLookupKey: Buffer.alloc(32, 23).toString("base64url"),
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
  const resolveSession = vi.fn((token: string) =>
    token === sessionToken
      ? Promise.resolve(staffSession)
      : Promise.reject(new SessionAuthenticationRequiredError()),
  );
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
      resolveSession,
      revokeSession: () => Promise.resolve(),
      revokeUserSessions: () => Promise.resolve(0),
      rotateSession: () => Promise.reject(new Error("not used")),
    },
  };
  const headers: Record<string, string> = {
    cookie: `__Host-lead-session=${sealedSession}; __Host-lead-csrf=${csrf}`,
    origin,
    "sec-fetch-site": "same-site",
    "x-csrf-token": csrf,
    "x-organization-context": IDS.organization,
  };
  return { staffAuth, headers, resolveSession };
};
