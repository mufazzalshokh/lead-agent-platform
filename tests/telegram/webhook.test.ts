import { describe, expect, it, vi } from "vitest";
import { createApi, type StaffAuthDependencies } from "../../apps/api/src/app.js";
import { createStaffWebAuthConfig } from "../../packages/config/src/index.js";
import {
  createBrowserAuthEnvelopeProtector,
  createOidcIdentityVerifier,
  SessionAuthenticationRequiredError,
  type MembershipRole,
} from "../../packages/security/src/index.js";
import { normalizeTelegramUpdate } from "../../packages/integrations/src/telegram/normalizer.js";
import { businessMessage, IDS, NONCE, NOW, platformConfig, staffSession } from "./fixtures.js";

describe("Telegram webhook HTTP security", () => {
  const fixture = (status: "accepted" | "duplicate" | "ignored" = "accepted") => {
    const processUpdate = vi.fn(() => Promise.resolve({ status }));
    const api = createApi({
      telegramWebhook: {
        normalizeUpdate: (raw) => normalizeTelegramUpdate(raw, NOW),
        processUpdate,
        webhookSecret: platformConfig.webhookSecret,
      },
    });
    return { api, processUpdate };
  };
  it.each([undefined, "wrong", "s".repeat(44)])(
    "fails closed for invalid secret %s",
    async (secret) => {
      const { api, processUpdate } = fixture();
      try {
        const result = await api.inject({
          method: "POST",
          url: "/v1/webhooks/telegram",
          payload: businessMessage(),
          headers: secret === undefined ? {} : { "x-telegram-bot-api-secret-token": secret },
        });
        expect(result.statusCode).toBe(401);
        expect(processUpdate).not.toHaveBeenCalled();
      } finally {
        await api.close();
      }
    },
  );
  it.each([
    ["accepted", 202],
    ["duplicate", 200],
    ["ignored", 200],
  ] as const)("acknowledges %s only after processing", async (status, code) => {
    const { api, processUpdate } = fixture(status);
    try {
      const result = await api.inject({
        method: "POST",
        url: "/v1/webhooks/telegram?organization_id=forged",
        payload: businessMessage(),
        headers: {
          "x-telegram-bot-api-secret-token": platformConfig.webhookSecret,
          "x-organization-context": "forged",
        },
      });
      expect(result.statusCode).toBe(code);
      expect(result.json()).toEqual({ status });
      expect(processUpdate.mock.calls[0]).toHaveLength(1);
    } finally {
      await api.close();
    }
  });
  it("returns 400 for malformed JSON/root and 413 for oversized bodies", async () => {
    const { api } = fixture();
    try {
      for (const payload of ["{", "[]", "{}"]) {
        const result = await api.inject({
          method: "POST",
          url: "/v1/webhooks/telegram",
          payload,
          headers: {
            "content-type": "application/json",
            "x-telegram-bot-api-secret-token": platformConfig.webhookSecret,
          },
        });
        expect(result.statusCode).toBe(400);
      }
      const result = await api.inject({
        method: "POST",
        url: "/v1/webhooks/telegram",
        payload: { update_id: 1, padding: "x".repeat(300000) },
        headers: { "x-telegram-bot-api-secret-token": platformConfig.webhookSecret },
      });
      expect(result.statusCode).toBe(413);
    } finally {
      await api.close();
    }
  });
  it("returns sanitized retryable 503 before durable DB acceptance", async () => {
    const { api, processUpdate } = fixture();
    processUpdate.mockRejectedValue(new Error("sensitive SQL / tenant / token"));
    try {
      const result = await api.inject({
        method: "POST",
        url: "/v1/webhooks/telegram",
        payload: businessMessage(),
        headers: { "x-telegram-bot-api-secret-token": platformConfig.webhookSecret },
      });
      expect(result.statusCode).toBe(503);
      expect(result.body).not.toMatch(/sensitive|SQL|token|stack/u);
    } finally {
      await api.close();
    }
  });
});

describe("Telegram staff management authorization boundary", () => {
  const fixture = (role: MembershipRole = "owner") => {
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
    const beginOnboarding = vi.fn(() =>
      Promise.resolve({
        channelConnectionId: IDS.channel,
        onboardingUrl: `https://t.me/SyntheticBusinessBot?start=${NONCE}`,
      }),
    );
    const api = createApi({
      staffAuth,
      staffTelegram: { useCases: { beginOnboarding } },
    });
    const headers: Record<string, string> = {
      cookie: `__Host-lead-session=${sealedSession}; __Host-lead-csrf=${csrf}`,
      origin,
      "sec-fetch-site": "same-site",
      "x-csrf-token": csrf,
      "x-organization-context": IDS.organization,
    };
    return { api, beginOnboarding, headers, resolveSession };
  };
  it.each(["owner", "staff"] as const)("requires integration permission for %s", async (role) => {
    const { api, beginOnboarding, headers, resolveSession } = fixture(role);
    try {
      const result = await api.inject({
        method: "POST",
        url: "/v1/staff/integrations/telegram/onboarding",
        payload: { display_name: "Business DM" },
        headers,
      });
      expect(resolveSession).toHaveBeenCalledOnce();
      expect(result.statusCode).toBe(role === "owner" ? 201 : 403);
      expect(beginOnboarding.mock.calls).toHaveLength(role === "owner" ? 1 : 0);
      const forged = await api.inject({
        method: "POST",
        url: "/v1/staff/integrations/telegram/onboarding",
        payload: { display_name: "Business DM" },
        headers: { ...headers, "x-organization-context": IDS.otherOrganization },
      });
      expect(forged.statusCode).toBe(403);
    } finally {
      await api.close();
    }
  });
  it("cannot bypass the existing authenticated mutation/CSRF/origin/fetch-metadata boundary", async () => {
    const { api, beginOnboarding, headers } = fixture();
    const missingCsrf = { ...headers };
    delete missingCsrf["x-csrf-token"];
    try {
      for (const invalid of [
        missingCsrf,
        { ...headers, "x-csrf-token": "wrong" },
        { ...headers, origin: "https://attacker.example.test" },
        { ...headers, "sec-fetch-site": "cross-site" },
      ]) {
        expect(
          (
            await api.inject({
              method: "POST",
              url: "/v1/staff/integrations/telegram/onboarding",
              payload: { display_name: "Business DM" },
              headers: invalid,
            })
          ).statusCode,
        ).toBe(403);
      }
      expect(beginOnboarding).not.toHaveBeenCalled();
    } finally {
      await api.close();
    }
  });
  it("rejects unauthenticated onboarding and registration without staff authentication", async () => {
    const { api, beginOnboarding } = fixture();
    try {
      expect(
        (
          await api.inject({
            method: "POST",
            url: "/v1/staff/integrations/telegram/onboarding",
            payload: { display_name: "Business DM" },
          })
        ).statusCode,
      ).toBe(401);
      expect(beginOnboarding).not.toHaveBeenCalled();
      expect(() => createApi({ staffTelegram: { useCases: { beginOnboarding } } })).toThrow(
        "Staff Telegram routes require the staff authentication boundary",
      );
    } finally {
      await api.close();
    }
  });
});
