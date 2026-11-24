import { describe, expect, it, vi } from "vitest";

import {
  S22WidgetCohortError,
  createS22WidgetCohortUseCases,
  type S22WidgetCohortStore,
} from "@lead-agent/application";
import { createStaffWebAuthConfig } from "@lead-agent/config";
import {
  CorrelationIdSchema,
  ProblemSchema,
  S22WidgetCohortSelectionResponseSchema,
  S22WidgetCohortStatusResponseSchema,
  isSchemaValue,
  type OrganizationId,
} from "@lead-agent/contracts";
import {
  SessionAuthenticationRequiredError,
  createBrowserAuthEnvelopeProtector,
  createOidcIdentityVerifier,
  type MembershipRole,
} from "@lead-agent/security";

import {
  COHORT_STATUS,
  S22_ORGANIZATION,
  SELECTION_BODY,
  SELECTION_RECEIPT,
} from "../../../tests/application/s22-widget-cohort-fixtures.js";
import { IDS, NOW, staffSession } from "../../../tests/telegram/fixtures.js";
import { createApi, type StaffAuthDependencies } from "../src/app.js";

const URL = "/v1/staff/s22/widget-cohort";
const fixture = (
  role: MembershipRole = "owner",
  membershipOrganization: OrganizationId = S22_ORGANIZATION,
) => {
  const origin = "https://staff.example.test";
  const csrf = "c".repeat(43);
  const sessionToken = "t".repeat(43);
  const config = createStaffWebAuthConfig({
    browserEnvelopeKey: Buffer.alloc(32, 31).toString("base64url"),
    callbackUri: `${origin}/v1/staff/auth/callback`,
    clientId: "s22-cohort-test-client",
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
          userId === IDS.user && organizationId === membershipOrganization
            ? {
                allowedLocationIds: [],
                locationScope: "all",
                membershipId: IDS.membership,
                organizationId: membershipOrganization,
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
  const get = vi.fn<S22WidgetCohortStore["get"]>(() => Promise.resolve(COHORT_STATUS));
  const select = vi.fn<S22WidgetCohortStore["select"]>(() => Promise.resolve(SELECTION_RECEIPT));
  const useCases = createS22WidgetCohortUseCases({
    organizationId: S22_ORGANIZATION,
    store: { get, select },
  });
  const api = createApi({ staffAuth, staffS22WidgetCohort: { useCases } });
  const headers: Record<string, string> = {
    cookie: `__Host-lead-session=${sealedSession}; __Host-lead-csrf=${csrf}`,
    origin,
    "sec-fetch-site": "same-origin",
    "x-csrf-token": csrf,
    "x-organization-context": membershipOrganization,
  };
  return { api, get, select, headers, useCases };
};

describe("S22 staging owner Widget cohort HTTP boundary", () => {
  it("returns bounded private metadata and selects through the real owner use case", async () => {
    const { api, get, select, headers } = fixture();
    try {
      const status = await api.inject({ method: "GET", url: URL, headers });
      expect(status.statusCode).toBe(200);
      expect(status.headers["cache-control"]).toBe("no-store");
      const statusBody: unknown = status.json();
      expect(isSchemaValue(S22WidgetCohortStatusResponseSchema, statusBody)).toBe(true);
      const selected = await api.inject({
        method: "POST",
        url: `${URL}/selection`,
        headers: { ...headers, "x-request-id": "spoofed-header", "x-correlation-id": IDS.message },
        payload: SELECTION_BODY,
      });
      expect(selected.statusCode).toBe(200);
      expect(selected.headers["cache-control"]).toBe("no-store");
      const selectedBody: unknown = selected.json();
      if (!isSchemaValue(S22WidgetCohortSelectionResponseSchema, selectedBody)) {
        throw new Error("Invalid S22 selection response");
      }
      expect(selectedBody.data).toEqual(SELECTION_RECEIPT);
      expect(selected.body).not.toMatch(/bearer|credential|cookie|secret|message_body/iu);
      expect(get).toHaveBeenCalledOnce();
      expect(select).toHaveBeenCalledOnce();
      const input = select.mock.calls[0]?.[0];
      expect(input?.actor.organizationId).toBe(S22_ORGANIZATION);
      expect(input?.actor.role).toBe("owner");
      expect(input?.body).toEqual(SELECTION_BODY);
      expect(input?.requestId).toBe(selectedBody.meta.request_id);
      expect(input?.requestId).not.toBe("spoofed-header");
      expect(isSchemaValue(CorrelationIdSchema, input?.correlationId)).toBe(true);
      expect(input?.correlationId).not.toBe(IDS.message);
    } finally {
      await api.close();
    }
  });

  it.each(["admin", "staff"] as const)("denies %s on both reads and mutation", async (role) => {
    const { api, get, select, headers } = fixture(role);
    try {
      for (const method of ["GET", "POST"] as const) {
        const response = await api.inject({
          method,
          url: method === "GET" ? URL : `${URL}/selection`,
          headers,
          ...(method === "POST" ? { payload: SELECTION_BODY } : {}),
        });
        expect(response.statusCode).toBe(403);
        expect(response.body).toContain("permission_denied");
        expect(isSchemaValue(ProblemSchema, response.json())).toBe(true);
      }
      expect(get).not.toHaveBeenCalled();
      expect(select).not.toHaveBeenCalled();
    } finally {
      await api.close();
    }
  });

  it("denies another tenant's authorized owner, missing context and spoofed context", async () => {
    const { api, get, select, headers } = fixture("owner", IDS.otherOrganization);
    const missingContext = { ...headers };
    delete missingContext["x-organization-context"];
    try {
      for (const candidate of [
        headers,
        missingContext,
        { ...headers, "x-organization-context": S22_ORGANIZATION },
      ]) {
        for (const method of ["GET", "POST"] as const) {
          const response = await api.inject({
            method,
            url: method === "GET" ? URL : `${URL}/selection`,
            headers: candidate,
            ...(method === "POST" ? { payload: SELECTION_BODY } : {}),
          });
          expect(response.statusCode).toBe(403);
          expect(isSchemaValue(ProblemSchema, response.json())).toBe(true);
        }
      }
      expect(get).not.toHaveBeenCalled();
      expect(select).not.toHaveBeenCalled();
    } finally {
      await api.close();
    }
  });

  it("requires a real authenticated session, CSRF, trusted Origin and Fetch Metadata", async () => {
    const { api, select, headers } = fixture();
    const missingCsrf = { ...headers };
    delete missingCsrf["x-csrf-token"];
    const missingOrigin = { ...headers };
    delete missingOrigin["origin"];
    try {
      for (const candidate of [
        {},
        missingCsrf,
        missingOrigin,
        { ...headers, cookie: "" },
        { ...headers, "x-csrf-token": "wrong" },
        { ...headers, origin: "https://attacker.example" },
        { ...headers, "sec-fetch-site": "cross-site" },
      ]) {
        const response = await api.inject({
          method: "POST",
          url: `${URL}/selection`,
          headers: candidate,
          payload: SELECTION_BODY,
        });
        expect([401, 403]).toContain(response.statusCode);
        expect(isSchemaValue(ProblemSchema, response.json())).toBe(true);
      }
      const unauthenticated = await api.inject({ method: "GET", url: URL });
      expect(unauthenticated.statusCode).toBe(401);
      expect(isSchemaValue(ProblemSchema, unauthenticated.json())).toBe(true);
      expect(select).not.toHaveBeenCalled();
    } finally {
      await api.close();
    }
  });

  it.each([
    { ...SELECTION_BODY, organization_id: S22_ORGANIZATION },
    { ...SELECTION_BODY, expected_session_version: 3 },
    { ...SELECTION_BODY, expected_selection_version: -1 },
    { ...SELECTION_BODY, expected_selection_version: 0.5 },
    { ...SELECTION_BODY, session_id: IDS.message.toUpperCase() },
    { ...SELECTION_BODY, allow_paid_calls: true },
    { ...SELECTION_BODY, reserve_micros: "0" },
  ])("strictly rejects authority/version smuggling %#", async (payload) => {
    const { api, select, headers } = fixture();
    try {
      const response = await api.inject({
        method: "POST",
        url: `${URL}/selection`,
        headers,
        payload,
      });
      expect(response.statusCode).toBe(400);
      expect(isSchemaValue(ProblemSchema, response.json())).toBe(true);
      expect(select).not.toHaveBeenCalled();
    } finally {
      await api.close();
    }
  });

  it.each([
    ["permission_denied", "permission_denied", 403],
    ["validation_failed", "validation_failed", 400],
    ["selection_conflict", "version_conflict", 409],
    ["cohort_blocked", "version_conflict", 409],
    ["unavailable", "dependency_unavailable", 503],
  ] as const)("maps internal %s to shared %s with status %i", async (code, publicCode, status) => {
    const { api, select, headers } = fixture();
    select.mockRejectedValueOnce(new S22WidgetCohortError(code));
    try {
      const response = await api.inject({
        method: "POST",
        url: `${URL}/selection`,
        headers,
        payload: SELECTION_BODY,
      });
      expect(response.statusCode).toBe(status);
      expect(response.json()).toMatchObject({ code: publicCode });
      expect(isSchemaValue(ProblemSchema, response.json())).toBe(true);
      expect(response.body).not.toMatch(/database|password|stack|Bearer/iu);
    } finally {
      await api.close();
    }
  });

  it("does not register the optional routes without the explicit dependency", async () => {
    const api = createApi();
    try {
      expect((await api.inject({ method: "GET", url: URL })).statusCode).toBe(404);
    } finally {
      await api.close();
    }
    const useCases = createS22WidgetCohortUseCases({
      organizationId: S22_ORGANIZATION,
      store: {
        get: () => Promise.resolve(COHORT_STATUS),
        select: () => Promise.resolve(SELECTION_RECEIPT),
      },
    });
    expect(() => createApi({ staffS22WidgetCohort: { useCases } })).toThrow(
      "S22 Widget cohort routes require the staff authentication boundary",
    );
  });
});
