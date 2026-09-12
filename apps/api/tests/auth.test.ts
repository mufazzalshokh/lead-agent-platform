import {
  MembershipIdSchema,
  OrganizationIdSchema,
  UserIdSchema,
  isSchemaValue,
  type MembershipId,
  type OrganizationId,
  type UserId,
} from "@lead-agent/contracts";
import { createStaffWebAuthConfig } from "@lead-agent/config";
import {
  SESSION_POLICY,
  ExternalIdentityUnmappedError,
  SessionAuthenticationRequiredError,
  createBrowserAuthEnvelopeProtector,
  createOidcIdentityVerifier,
  type ApplicationSessionLifecycle,
  type AuthenticatedApplicationSession,
  type InvitationAcceptanceResult,
} from "@lead-agent/security";
import { describe, expect, it } from "vitest";

import { createApi, type StaffAuthDependencies } from "../src/app.js";
import { authorizeOrganizationOperation } from "../src/auth/authorization.js";

const NOW = new Date("2026-09-12T08:00:00.000Z");
const USER_VALUE = "0193f1a8-7f65-7c28-a434-a10796c46701";
const OTHER_USER_VALUE = "0193f1a8-7f65-7c28-a434-a10796c46702";
const ORGANIZATION_A_VALUE = "0193f1a8-7f65-7c28-a434-a10796c46703";
const ORGANIZATION_B_VALUE = "0193f1a8-7f65-7c28-a434-a10796c46704";
const MEMBERSHIP_VALUE = "0193f1a8-7f65-7c28-a434-a10796c46705";
if (
  !isSchemaValue(UserIdSchema, USER_VALUE) ||
  !isSchemaValue(UserIdSchema, OTHER_USER_VALUE) ||
  !isSchemaValue(OrganizationIdSchema, ORGANIZATION_A_VALUE) ||
  !isSchemaValue(OrganizationIdSchema, ORGANIZATION_B_VALUE) ||
  !isSchemaValue(MembershipIdSchema, MEMBERSHIP_VALUE)
) {
  throw new TypeError("Invalid S6.6 API synthetic identifiers");
}
const USER_ID: UserId = USER_VALUE;
const OTHER_USER_ID: UserId = OTHER_USER_VALUE;
const ORGANIZATION_A: OrganizationId = ORGANIZATION_A_VALUE;
const ORGANIZATION_B: OrganizationId = ORGANIZATION_B_VALUE;
const MEMBERSHIP_ID: MembershipId = MEMBERSHIP_VALUE;
const SESSION_ID = "0193f1a8-7f65-7c28-a434-a10796c46706";
const ROTATED_SESSION_ID = "0193f1a8-7f65-7c28-a434-a10796c46707";
const NONCE = "n".repeat(43);
const VERIFIER = "v".repeat(43);
const SESSION_TOKEN = "t".repeat(43);
const ROTATED_TOKEN = "r".repeat(43);
const CSRF = "c".repeat(43);
const ROTATED_CSRF = "d".repeat(43);
const INVITATION_TOKEN = Buffer.alloc(32, 21).toString("base64url");
const STAFF_ORIGIN = "https://staff.example.test";

const session = (
  overrides: Partial<AuthenticatedApplicationSession> = {},
): AuthenticatedApplicationSession =>
  Object.freeze({
    absoluteExpiresAt: new Date(NOW.getTime() + SESSION_POLICY.absoluteLifetimeMilliseconds),
    authenticationLevel: "mfa",
    authenticationTime: NOW,
    createdAt: NOW,
    idleExpiresAt: new Date(NOW.getTime() + SESSION_POLICY.idleTimeoutMilliseconds),
    lastSeenAt: NOW,
    rotatedAt: NOW,
    rotationDue: false,
    sessionId: SESSION_ID,
    userId: USER_ID,
    ...overrides,
  });

const setCookieLines = (headers: Readonly<Record<string, unknown>>): readonly string[] => {
  const value = headers["set-cookie"];
  if (typeof value === "string") return [value];
  return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : [];
};

const cookieValue = (headers: Readonly<Record<string, unknown>>, name: string): string => {
  const prefix = name + "=";
  const line = setCookieLines(headers).find((candidate) => candidate.startsWith(prefix));
  if (line === undefined) throw new TypeError("Expected cookie " + name);
  return line.slice(prefix.length).split(";", 1)[0]!;
};

const cookieHeader = (...values: readonly (readonly [string, string])[]): string =>
  values.map(([name, value]) => name + "=" + value).join("; ");

const authorizationState = (headers: Readonly<Record<string, unknown>>): string => {
  const location = headers["location"];
  if (typeof location !== "string") throw new TypeError("Expected authorization redirect");
  const state = new URL(location).searchParams.get("state");
  if (state === null) throw new TypeError("Expected OIDC state");
  return state;
};

type FixtureControls = {
  acceptedOrganizations: OrganizationId[];
  authenticationLevel: "mfa" | "single_factor";
  identityUser: UserId | null;
  revokedTokens: string[];
  rotationDue: boolean;
  rotationCount: number;
};

const createFixture = () => {
  const controls: FixtureControls = {
    acceptedOrganizations: [],
    authenticationLevel: "mfa",
    identityUser: USER_ID,
    revokedTokens: [],
    rotationDue: false,
    rotationCount: 0,
  };
  let activeToken: string | null = null;
  let activeSession = session();
  let authorizationCount = 0;
  const sessions: ApplicationSessionLifecycle = {
    createSession: () => {
      activeToken = SESSION_TOKEN;
      activeSession = session();
      return Promise.resolve({
        csrfSecret: CSRF,
        evictedSessionCount: 0,
        session: activeSession,
        sessionToken: SESSION_TOKEN,
      });
    },
    resolveSession: (token) => {
      if (token !== activeToken) return Promise.reject(new SessionAuthenticationRequiredError());
      return Promise.resolve(session({ ...activeSession, rotationDue: controls.rotationDue }));
    },
    revokeSession: (token) => {
      controls.revokedTokens.push(token);
      if (token === activeToken) activeToken = null;
      return Promise.resolve();
    },
    revokeUserSessions: () => Promise.resolve(0),
    rotateSession: (token, evidence) => {
      if (token !== activeToken) return Promise.reject(new SessionAuthenticationRequiredError());
      controls.rotationCount += 1;
      activeToken = ROTATED_TOKEN;
      activeSession = session({
        authenticationLevel: evidence?.authenticationLevel ?? activeSession.authenticationLevel,
        authenticationTime: evidence?.authenticationTime ?? activeSession.authenticationTime,
        rotatedAt: NOW,
        sessionId: ROTATED_SESSION_ID,
      });
      return Promise.resolve({
        csrfSecret: ROTATED_CSRF,
        evictedSessionCount: 0,
        session: activeSession,
        sessionToken: ROTATED_TOKEN,
      });
    },
  };
  const configuration = createStaffWebAuthConfig({
    browserEnvelopeKey: Buffer.alloc(32, 1).toString("base64url"),
    callbackUri: "https://api.example.test/v1/staff/auth/callback",
    clientId: "staff-client",
    clientSecret: "server-only-test-value",
    environment: "production",
    invitationTargetEncryptionKey: Buffer.alloc(32, 2).toString("base64url"),
    invitationTargetLookupKey: Buffer.alloc(32, 3).toString("base64url"),
    issuer: "https://tenant.auth0.example/",
    requireMfa: true,
    staffAllowedOrigins: [STAFF_ORIGIN],
    staffApplicationOrigin: STAFF_ORIGIN,
  });
  const oidcVerifier = createOidcIdentityVerifier({
    verifyEvidence: () =>
      Promise.resolve({ issuer: configuration.issuer, subject: "auth0|verified-subject" }),
  });
  const dependencies: StaffAuthDependencies = {
    authorizationResolver: {
      resolveCurrentMembership: (userId, organizationId) =>
        organizationId === ORGANIZATION_A
          ? Promise.resolve({
              allowedLocationIds: [],
              locationScope: "all",
              membershipId: MEMBERSHIP_ID,
              organizationId,
              role: "owner",
              status: "active",
              userId,
            })
          : Promise.resolve(null),
    },
    clock: () => NOW,
    config: configuration,
    envelopeProtector: createBrowserAuthEnvelopeProtector(configuration.browserEnvelopeKey),
    identityResolver: {
      resolve: () =>
        controls.identityUser === null
          ? Promise.reject(new ExternalIdentityUnmappedError())
          : Promise.resolve(controls.identityUser),
    },
    invitationAcceptance: {
      accept: (input): Promise<InvitationAcceptanceResult> => {
        controls.acceptedOrganizations.push(input.organizationId);
        return Promise.resolve({
          externalIdentityCreated: true,
          membershipActivated: true,
          membershipId: MEMBERSHIP_ID,
          outcome: "activated",
          userCreated: true,
          userId: USER_ID,
        });
      },
    },
    oidcClient: {
      begin: () => {
        authorizationCount += 1;
        const state = String(authorizationCount).padStart(43, "s");
        return Promise.resolve({
          authorizationUrl:
            "https://tenant.auth0.example/authorize?client_id=staff-client&state=" + state,
          codeVerifier: VERIFIER,
          nonce: NONCE,
          state,
        });
      },
      complete: () =>
        Promise.resolve({
          authenticationLevel: controls.authenticationLevel,
          authenticationTime: NOW,
          idToken: "header.payload.signature",
          verifiedEmailTarget: "person@example.test",
        }),
    },
    oidcVerifier,
    sessions,
  };
  const api = createApi({ staffAuth: dependencies });
  return { api, controls, dependencies };
};

const establishSession = async (fixture: ReturnType<typeof createFixture>) => {
  const started = await fixture.api.inject({
    method: "GET",
    url: "/v1/staff/auth/login?return_to=%2Fdashboard",
  });
  const transaction = cookieValue(started.headers, "__Host-lead-auth-transaction");
  const state = authorizationState(started.headers);
  const callback = await fixture.api.inject({
    headers: { cookie: cookieHeader(["__Host-lead-auth-transaction", transaction]) },
    method: "GET",
    url: "/v1/staff/auth/callback?code=synthetic&state=" + state,
  });
  return {
    callback,
    csrf: cookieValue(callback.headers, "__Host-lead-csrf"),
    session: cookieValue(callback.headers, "__Host-lead-session"),
  };
};

describe("S6.6 Fastify staff browser authentication", { timeout: 30_000 }, () => {
  it("initiates login at the trusted issuer with a hardened, short-lived transaction cookie", async () => {
    const fixture = createFixture();
    try {
      const response = await fixture.api.inject({
        method: "GET",
        url: "/v1/staff/auth/login?return_to=https%3A%2F%2Fattacker.test",
      });
      expect(response.statusCode).toBe(302);
      expect(response.headers.location).toMatch(/^https:\/\/tenant\.auth0\.example\/authorize\?/u);
      const cookie = setCookieLines(response.headers).find((line) =>
        line.startsWith("__Host-lead-auth-transaction="),
      );
      expect(cookie).toContain("HttpOnly");
      expect(cookie).toContain("Secure");
      expect(cookie).toContain("SameSite=Lax");
      expect(cookie).toContain("Path=/");
      expect(cookie).toContain("Max-Age=600");
      expect(cookie).not.toContain("Domain=");
    } finally {
      await fixture.api.close();
    }
  });

  it("validates callback state, creates an application session, and emits hardened cookies", async () => {
    const fixture = createFixture();
    try {
      const established = await establishSession(fixture);
      expect(established.callback.statusCode).toBe(303);
      expect(established.callback.headers.location).toBe("/dashboard");
      const lines = setCookieLines(established.callback.headers);
      const sessionCookie = lines.find((line) => line.startsWith("__Host-lead-session="));
      const csrfCookie = lines.find((line) => line.startsWith("__Host-lead-csrf="));
      expect(sessionCookie).toContain("HttpOnly");
      expect(sessionCookie).toContain("Secure");
      expect(sessionCookie).toContain("SameSite=Lax");
      expect(sessionCookie).not.toContain("Domain=");
      expect(csrfCookie).not.toContain("HttpOnly");
      expect(lines.join("\n")).not.toContain("header.payload.signature");
      expect(lines.join("\n")).not.toContain(VERIFIER);
    } finally {
      await fixture.api.close();
    }
  });

  it("prevents session fixation by revoking and replacing an existing application session", async () => {
    const fixture = createFixture();
    try {
      const existing = await establishSession(fixture);
      const started = await fixture.api.inject({
        headers: { cookie: cookieHeader(["__Host-lead-session", existing.session]) },
        method: "GET",
        url: "/v1/staff/auth/login",
      });
      const transaction = cookieValue(started.headers, "__Host-lead-auth-transaction");
      const callback = await fixture.api.inject({
        headers: {
          cookie: cookieHeader(
            ["__Host-lead-auth-transaction", transaction],
            ["__Host-lead-session", existing.session],
          ),
        },
        method: "GET",
        url: "/v1/staff/auth/callback?code=x&state=" + authorizationState(started.headers),
      });
      expect(callback.statusCode).toBe(303);
      expect(fixture.controls.revokedTokens).toContain(SESSION_TOKEN);
      expect(cookieValue(callback.headers, "__Host-lead-session")).not.toBe(existing.session);
    } finally {
      await fixture.api.close();
    }
  });

  it("rejects callback state mismatch, replay, duplicate cookies, and insufficient MFA", async () => {
    const fixture = createFixture();
    try {
      const started = await fixture.api.inject({ method: "GET", url: "/v1/staff/auth/login" });
      const transaction = cookieValue(started.headers, "__Host-lead-auth-transaction");
      const state = authorizationState(started.headers);
      const mismatch = await fixture.api.inject({
        headers: { cookie: cookieHeader(["__Host-lead-auth-transaction", transaction]) },
        method: "GET",
        url: "/v1/staff/auth/callback?code=x&state=" + "x".repeat(43),
      });
      expect(mismatch.statusCode).toBe(401);
      const duplicate = await fixture.api.inject({
        headers: {
          cookie:
            "__Host-lead-auth-transaction=" +
            transaction +
            "; __Host-lead-auth-transaction=" +
            transaction,
        },
        method: "GET",
        url: "/v1/staff/auth/callback?code=x&state=" + state,
      });
      expect(duplicate.statusCode).toBe(401);
    } finally {
      await fixture.api.close();
    }
    const noMfa = createFixture();
    noMfa.controls.authenticationLevel = "single_factor";
    try {
      const started = await noMfa.api.inject({ method: "GET", url: "/v1/staff/auth/login" });
      const transaction = cookieValue(started.headers, "__Host-lead-auth-transaction");
      const state = authorizationState(started.headers);
      const response = await noMfa.api.inject({
        headers: { cookie: cookieHeader(["__Host-lead-auth-transaction", transaction]) },
        method: "GET",
        url: "/v1/staff/auth/callback?code=x&state=" + state,
      });
      expect(response.statusCode).toBe(401);
      expect(
        setCookieLines(response.headers).some((line) => line.startsWith("__Host-lead-session=")),
      ).toBe(false);
    } finally {
      await noMfa.api.close();
    }
    const replayed = createFixture();
    try {
      const started = await replayed.api.inject({ method: "GET", url: "/v1/staff/auth/login" });
      const transaction = cookieValue(started.headers, "__Host-lead-auth-transaction");
      const state = authorizationState(started.headers);
      const request = {
        headers: { cookie: cookieHeader(["__Host-lead-auth-transaction", transaction]) },
        method: "GET" as const,
        url: "/v1/staff/auth/callback?code=x&state=" + state,
      };
      expect((await replayed.api.inject(request)).statusCode).toBe(303);
      expect((await replayed.api.inject(request)).statusCode).toBe(401);
    } finally {
      await replayed.api.close();
    }
  });

  it("does not email-auto-link an unknown issuer+subject during ordinary login", async () => {
    const fixture = createFixture();
    fixture.controls.identityUser = null;
    try {
      const started = await fixture.api.inject({ method: "GET", url: "/v1/staff/auth/login" });
      const transaction = cookieValue(started.headers, "__Host-lead-auth-transaction");
      const response = await fixture.api.inject({
        headers: { cookie: cookieHeader(["__Host-lead-auth-transaction", transaction]) },
        method: "GET",
        url: "/v1/staff/auth/callback?code=x&state=" + authorizationState(started.headers),
      });
      expect(response.statusCode).toBe(401);
      expect(
        setCookieLines(response.headers).some((line) => line.startsWith("__Host-lead-session=")),
      ).toBe(false);
    } finally {
      await fixture.api.close();
    }
  });

  it("returns principal-only session status without tenant or permission authority", async () => {
    const fixture = createFixture();
    try {
      const established = await establishSession(fixture);
      const response = await fixture.api.inject({
        headers: { cookie: cookieHeader(["__Host-lead-session", established.session]) },
        method: "GET",
        url: "/v1/staff/auth/session",
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ authenticated: true, user_id: USER_ID });
      expect(response.body).not.toContain("organization_id");
      expect(response.body).not.toContain("permissions");
      expect(response.body).not.toContain("csrf");
    } finally {
      await fixture.api.close();
    }
  });

  it("delivers S6.3 periodic rotation by replacing both browser credentials", async () => {
    const fixture = createFixture();
    try {
      const established = await establishSession(fixture);
      fixture.controls.rotationDue = true;
      const response = await fixture.api.inject({
        headers: { cookie: cookieHeader(["__Host-lead-session", established.session]) },
        method: "GET",
        url: "/v1/staff/auth/session",
      });
      expect(response.statusCode).toBe(200);
      expect(fixture.controls.rotationCount).toBe(1);
      expect(cookieValue(response.headers, "__Host-lead-csrf")).toBe(ROTATED_CSRF);
      expect(cookieValue(response.headers, "__Host-lead-session")).not.toBe(established.session);
    } finally {
      await fixture.api.close();
    }
  });

  it("validates the current CSRF proof before rotating a due mutation session", async () => {
    const fixture = createFixture();
    try {
      const established = await establishSession(fixture);
      fixture.controls.rotationDue = true;
      const baseHeaders = {
        cookie: cookieHeader(
          ["__Host-lead-session", established.session],
          ["__Host-lead-csrf", established.csrf],
        ),
        origin: STAFF_ORIGIN,
        "sec-fetch-site": "same-origin",
      };
      const denied = await fixture.api.inject({
        body: {},
        headers: { ...baseHeaders, "x-csrf-token": "x".repeat(43) },
        method: "POST",
        url: "/v1/staff/auth/step-up",
      });
      expect(denied.statusCode).toBe(403);
      expect(fixture.controls.rotationCount).toBe(0);

      const allowed = await fixture.api.inject({
        body: {},
        headers: { ...baseHeaders, "x-csrf-token": established.csrf },
        method: "POST",
        url: "/v1/staff/auth/step-up",
      });
      expect(allowed.statusCode).toBe(302);
      expect(fixture.controls.rotationCount).toBe(1);
      expect(cookieValue(allowed.headers, "__Host-lead-csrf")).toBe(ROTATED_CSRF);
    } finally {
      await fixture.api.close();
    }
  });

  it("enforces session-bound CSRF, exact Origin, Fetch Metadata, and local revocation on logout", async () => {
    const fixture = createFixture();
    try {
      const established = await establishSession(fixture);
      const baseHeaders = {
        cookie: cookieHeader(
          ["__Host-lead-session", established.session],
          ["__Host-lead-csrf", established.csrf],
        ),
        origin: STAFF_ORIGIN,
        "sec-fetch-site": "same-origin",
      };
      const missingOriginHeaders = {
        cookie: baseHeaders.cookie,
        "sec-fetch-site": "same-origin",
        "x-csrf-token": established.csrf,
      };
      for (const headers of [
        baseHeaders,
        missingOriginHeaders,
        {
          ...baseHeaders,
          origin: "https://staff.example.test.attacker.test",
          "x-csrf-token": established.csrf,
        },
        { ...baseHeaders, "sec-fetch-site": "cross-site", "x-csrf-token": established.csrf },
        { ...baseHeaders, "x-csrf-token": "x".repeat(43) },
      ]) {
        const response = await fixture.api.inject({
          headers,
          method: "POST",
          url: "/v1/staff/auth/logout",
        });
        expect(response.statusCode).toBe(403);
      }
      const response = await fixture.api.inject({
        headers: { ...baseHeaders, "x-csrf-token": established.csrf },
        method: "POST",
        url: "/v1/staff/auth/logout",
      });
      expect(response.statusCode).toBe(204);
      expect(fixture.controls.revokedTokens).toContain(SESSION_TOKEN);
      const stale = await fixture.api.inject({
        headers: { cookie: cookieHeader(["__Host-lead-session", established.session]) },
        method: "GET",
        url: "/v1/staff/auth/session",
      });
      expect(stale.statusCode).toBe(401);
    } finally {
      await fixture.api.close();
    }
  });

  it("uses deny-by-default staff CORS without reflecting widget or confused origins", async () => {
    const fixture = createFixture();
    try {
      const allowed = await fixture.api.inject({
        headers: { origin: STAFF_ORIGIN },
        method: "GET",
        url: "/v1/staff/auth/login",
      });
      expect(allowed.headers["access-control-allow-origin"]).toBe(STAFF_ORIGIN);
      expect(allowed.headers["access-control-allow-credentials"]).toBe("true");
      for (const origin of [
        "https://widget.example.test",
        "https://staff.example.test.attacker.test",
        "http://staff.example.test",
        "null",
      ]) {
        const denied = await fixture.api.inject({
          headers: { origin },
          method: "GET",
          url: "/v1/staff/auth/login",
        });
        expect(denied.statusCode).toBe(403);
        expect(denied.headers["access-control-allow-origin"]).toBeUndefined();
      }
    } finally {
      await fixture.api.close();
    }
  });

  it("revalidates Membership on organization selection and rotates session plus CSRF", async () => {
    const fixture = createFixture();
    try {
      const established = await establishSession(fixture);
      const headers = {
        cookie: cookieHeader(
          ["__Host-lead-session", established.session],
          ["__Host-lead-csrf", established.csrf],
        ),
        origin: STAFF_ORIGIN,
        "sec-fetch-site": "same-origin",
        "x-csrf-token": established.csrf,
      };
      const denied = await fixture.api.inject({
        body: { organization_id: ORGANIZATION_B, role: "owner" },
        headers,
        method: "POST",
        url: "/v1/staff/auth/organization",
      });
      expect(denied.statusCode).toBe(403);
      const allowed = await fixture.api.inject({
        body: { organization_id: ORGANIZATION_A, role: "analyst" },
        headers,
        method: "POST",
        url: "/v1/staff/auth/organization",
      });
      expect(allowed.statusCode).toBe(200);
      expect(allowed.json()).toMatchObject({ organization_id: ORGANIZATION_A, role: "owner" });
      expect(fixture.controls.rotationCount).toBe(1);
      expect(cookieValue(allowed.headers, "__Host-lead-csrf")).toBe(ROTATED_CSRF);
    } finally {
      await fixture.api.close();
    }
  });

  it("binds fresh step-up to the same session and User and rotates both credentials", async () => {
    const fixture = createFixture();
    try {
      const established = await establishSession(fixture);
      const initiated = await fixture.api.inject({
        body: { return_to: "/settings/security" },
        headers: {
          cookie: cookieHeader(
            ["__Host-lead-session", established.session],
            ["__Host-lead-csrf", established.csrf],
          ),
          origin: STAFF_ORIGIN,
          "sec-fetch-site": "same-origin",
          "x-csrf-token": established.csrf,
        },
        method: "POST",
        url: "/v1/staff/auth/step-up",
      });
      expect(initiated.statusCode).toBe(302);
      const transaction = cookieValue(initiated.headers, "__Host-lead-auth-transaction");
      const state = authorizationState(initiated.headers);
      const callback = await fixture.api.inject({
        headers: {
          cookie: cookieHeader(
            ["__Host-lead-auth-transaction", transaction],
            ["__Host-lead-session", established.session],
          ),
        },
        method: "GET",
        url: "/v1/staff/auth/callback?code=x&state=" + state,
      });
      expect(callback.statusCode).toBe(303);
      expect(callback.headers.location).toBe("/settings/security");
      expect(fixture.controls.rotationCount).toBe(1);
      expect(cookieValue(callback.headers, "__Host-lead-csrf")).toBe(ROTATED_CSRF);
    } finally {
      await fixture.api.close();
    }
  });

  it("denies a step-up User swap", async () => {
    const fixture = createFixture();
    try {
      const established = await establishSession(fixture);
      const initiated = await fixture.api.inject({
        body: {},
        headers: {
          cookie: cookieHeader(
            ["__Host-lead-session", established.session],
            ["__Host-lead-csrf", established.csrf],
          ),
          origin: STAFF_ORIGIN,
          "sec-fetch-site": "same-origin",
          "x-csrf-token": established.csrf,
        },
        method: "POST",
        url: "/v1/staff/auth/step-up",
      });
      fixture.controls.identityUser = OTHER_USER_ID;
      const transaction = cookieValue(initiated.headers, "__Host-lead-auth-transaction");
      const state = authorizationState(initiated.headers);
      const callback = await fixture.api.inject({
        headers: {
          cookie: cookieHeader(
            ["__Host-lead-auth-transaction", transaction],
            ["__Host-lead-session", established.session],
          ),
        },
        method: "GET",
        url: "/v1/staff/auth/callback?code=x&state=" + state,
      });
      expect(callback.statusCode).toBe(403);
      expect(fixture.controls.rotationCount).toBe(0);
    } finally {
      await fixture.api.close();
    }
  });

  it("onboards only through the explicit invitation proof and binds the authoritative organization", async () => {
    const fixture = createFixture();
    try {
      const initiated = await fixture.api.inject({
        body: {
          invitation_token: INVITATION_TOKEN,
          organization_id: ORGANIZATION_A,
          role: "owner",
        },
        headers: { origin: STAFF_ORIGIN, "sec-fetch-site": "same-origin" },
        method: "POST",
        url: "/v1/staff/auth/invitation",
      });
      const transaction = cookieValue(initiated.headers, "__Host-lead-auth-transaction");
      const state = authorizationState(initiated.headers);
      const callback = await fixture.api.inject({
        headers: { cookie: cookieHeader(["__Host-lead-auth-transaction", transaction]) },
        method: "GET",
        url: "/v1/staff/auth/callback?code=x&state=" + state,
      });
      const proof = cookieValue(callback.headers, "__Host-lead-invitation-proof");
      const accepted = await fixture.api.inject({
        body: {
          invitation_token: INVITATION_TOKEN,
          organization_id: ORGANIZATION_B,
          role: "analyst",
        },
        headers: {
          cookie: cookieHeader(["__Host-lead-invitation-proof", proof]),
          origin: STAFF_ORIGIN,
          "sec-fetch-site": "same-origin",
        },
        method: "POST",
        url: "/v1/staff/auth/invitation/accept",
      });
      expect(accepted.statusCode).toBe(200);
      expect(fixture.controls.acceptedOrganizations).toEqual([ORGANIZATION_A]);
      expect(
        setCookieLines(accepted.headers).some((line) => line.startsWith("__Host-lead-session=")),
      ).toBe(true);
    } finally {
      await fixture.api.close();
    }
  });

  it("provides a finite-permission framework authorization seam that reloads Membership", async () => {
    const fixture = createFixture();
    const authenticated = session();
    await expect(
      authorizeOrganizationOperation(
        authenticated,
        ORGANIZATION_A,
        "organization.read",
        fixture.dependencies.authorizationResolver,
      ),
    ).resolves.toMatchObject({ organizationId: ORGANIZATION_A, role: "owner" });
    await expect(
      authorizeOrganizationOperation(
        authenticated,
        ORGANIZATION_B,
        "organization.read",
        fixture.dependencies.authorizationResolver,
      ),
    ).rejects.toThrow();
    await fixture.api.close();
  });
});
