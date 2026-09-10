import { createHash } from "node:crypto";

import { UserIdSchema, isSchemaValue, type UserId } from "../../packages/contracts/src/index.js";
import {
  SESSION_POLICY,
  SessionAuthenticationRequiredError,
  authenticateExternalIdentity,
  createApplicationSessionLifecycle,
  createOidcIdentityVerifier,
  createSessionAuthenticationEvidence,
  hashSessionToken,
  isFreshStepUp,
  isRotationDue,
  sessionMetadataRetentionEligibleAt,
  verifyCsrfSecret,
  type ApplicationSessionStore,
  type AuthenticatedApplicationSession,
  type SessionCreationPersistence,
  type SessionRotationPersistence,
} from "../../packages/security/src/index.js";
import { createSessionCredentialFactoryWithRandomness } from "../../packages/security/src/session/credentials.js";
import { describe, expect, it } from "vitest";

const USER_ID_VALUE = "0193f1a8-7f65-7c28-a434-a10796c46301";
if (!isSchemaValue(UserIdSchema, USER_ID_VALUE)) {
  throw new TypeError("Invalid synthetic User ID");
}
const USER_ID: UserId = USER_ID_VALUE;
const NOW = new Date("2026-09-10T08:00:00.000Z");

const createAuthentication = async () => {
  const verifier = createOidcIdentityVerifier({
    verifyEvidence: () =>
      Promise.resolve({ issuer: "https://synthetic.auth0.example/", subject: "auth0|user" }),
  });
  return authenticateExternalIdentity(
    verifier,
    { resolve: () => Promise.resolve(USER_ID) },
    {
      expectedNonce: "synthetic-nonce",
      idToken: "synthetic-verified-only",
    },
  );
};

const session = (overrides: Partial<AuthenticatedApplicationSession> = {}) =>
  Object.freeze({
    absoluteExpiresAt: new Date(NOW.getTime() + SESSION_POLICY.absoluteLifetimeMilliseconds),
    authenticationLevel: "mfa",
    authenticationTime: NOW,
    createdAt: NOW,
    idleExpiresAt: new Date(NOW.getTime() + SESSION_POLICY.idleTimeoutMilliseconds),
    lastSeenAt: NOW,
    rotatedAt: NOW,
    rotationDue: false,
    sessionId: "0193f1a8-7f65-7c28-a434-a10796c46302",
    userId: USER_ID,
    ...overrides,
  });

const deterministicCredentialFactory = () => {
  let call = 0;
  return createSessionCredentialFactoryWithRandomness((size) => {
    call += 1;
    return new Uint8Array(size).fill(call);
  });
};

describe("S6.3 application session security primitives", () => {
  it("issues independent 256-bit cookie-safe credentials and a UUIDv7 identifier", () => {
    const material = deterministicCredentialFactory().issue(NOW);
    expect(material.sessionToken).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(material.csrfSecret).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(material.sessionToken).not.toBe(material.csrfSecret);
    expect(material.sessionId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
    );
    expect(material.sessionTokenHash).toHaveLength(32);
    expect(material.csrfSecretHash).toHaveLength(32);
    expect(Buffer.from(material.sessionTokenHash)).not.toEqual(
      Buffer.from(material.csrfSecretHash),
    );
  });

  it("hashes canonical tokens and verifies CSRF digests in constant-time code paths", () => {
    const material = deterministicCredentialFactory().issue(NOW);
    expect(hashSessionToken(material.sessionToken)).toEqual(material.sessionTokenHash);
    expect(hashSessionToken("malformed")).toBeUndefined();
    expect(verifyCsrfSecret(material.csrfSecret, material.csrfSecretHash)).toBe(true);
    expect(verifyCsrfSecret(material.sessionToken, material.csrfSecretHash)).toBe(false);
    expect(verifyCsrfSecret("malformed", material.csrfSecretHash)).toBe(false);
  });

  it("creates only from trusted identity evidence and sends hashes—not raw secrets—to storage", async () => {
    let captured: SessionCreationPersistence | undefined;
    const store: ApplicationSessionStore = {
      createSession: (input) => {
        captured = input;
        return Promise.resolve({ evictedSessionCount: 0, session: session() });
      },
      resolveSession: () => Promise.resolve(null),
      revokeSession: () => Promise.resolve(),
      revokeUserSessions: () => Promise.resolve(0),
      rotateSession: () => Promise.resolve(null),
    };
    const evidence = createSessionAuthenticationEvidence(await createAuthentication(), {
      authenticationLevel: "mfa",
      authenticationTime: NOW,
    });
    const issued = await createApplicationSessionLifecycle(store, {
      clock: () => NOW,
      credentialFactory: deterministicCredentialFactory(),
    }).createSession(evidence);

    expect(issued.sessionToken).toHaveLength(43);
    expect(issued.csrfSecret).toHaveLength(43);
    expect(captured?.sessionTokenHash).toEqual(hashSessionToken(issued.sessionToken));
    expect(captured?.csrfSecretHash).toEqual(
      createHash("sha256").update(Buffer.from(issued.csrfSecret, "base64url")).digest(),
    );
    expect(captured).not.toHaveProperty("sessionToken");
    expect(captured).not.toHaveProperty("csrfSecret");
    expect(issued.session).not.toHaveProperty("organizationId");
    expect(issued.session).not.toHaveProperty("membershipId");
    expect(issued.session).not.toHaveProperty("role");
    expect(issued.session).not.toHaveProperty("permissions");
    expect(issued.session).not.toHaveProperty("locationScope");
  });

  it("collapses malformed, unknown, revoked, and expired credentials to one safe error", async () => {
    const store: ApplicationSessionStore = {
      createSession: () => Promise.resolve(null),
      resolveSession: () => Promise.resolve(null),
      revokeSession: () => Promise.resolve(),
      revokeUserSessions: () => Promise.resolve(0),
      rotateSession: () => Promise.resolve(null),
    };
    const lifecycle = createApplicationSessionLifecycle(store);
    await expect(lifecycle.resolveSession("malformed")).rejects.toBeInstanceOf(
      SessionAuthenticationRequiredError,
    );
    const unknown = deterministicCredentialFactory().issue(NOW).sessionToken;
    await expect(lifecycle.resolveSession(unknown)).rejects.toBeInstanceOf(
      SessionAuthenticationRequiredError,
    );
  });

  it("rotates to newly generated token and CSRF material without exposing persistence hashes", async () => {
    let captured: SessionRotationPersistence | undefined;
    const store: ApplicationSessionStore = {
      createSession: () => Promise.resolve(null),
      resolveSession: () => Promise.resolve(null),
      revokeSession: () => Promise.resolve(),
      revokeUserSessions: () => Promise.resolve(0),
      rotateSession: (input) => {
        captured = input;
        return Promise.resolve(session({ rotatedAt: new Date(NOW.getTime() + 1) }));
      },
    };
    const factory = deterministicCredentialFactory();
    const original = factory.issue(NOW).sessionToken;
    const rotated = await createApplicationSessionLifecycle(store, {
      clock: () => NOW,
      credentialFactory: factory,
    }).rotateSession(original);
    expect(rotated.sessionToken).not.toBe(original);
    expect(captured?.currentSessionTokenHash).toEqual(hashSessionToken(original));
    expect(captured?.replacementSessionTokenHash).toEqual(hashSessionToken(rotated.sessionToken));
    expect(captured).not.toHaveProperty("sessionToken");
    expect(captured).not.toHaveProperty("csrfSecret");
  });

  it("silently handles malformed sign-out tokens without a credential oracle", async () => {
    let calls = 0;
    const store: ApplicationSessionStore = {
      createSession: () => Promise.resolve(null),
      resolveSession: () => Promise.resolve(null),
      revokeSession: () => {
        calls += 1;
        return Promise.resolve();
      },
      revokeUserSessions: () => Promise.resolve(0),
      rotateSession: () => Promise.resolve(null),
    };
    await expect(createApplicationSessionLifecycle(store).revokeSession("malformed")).resolves.toBe(
      undefined,
    );
    expect(calls).toBe(0);
  });

  it("freezes rotation, step-up, and retention boundary semantics", () => {
    expect(isRotationDue(NOW, new Date(NOW.getTime() + 4 * 60 * 60 * 1_000 - 1))).toBe(false);
    expect(isRotationDue(NOW, new Date(NOW.getTime() + 4 * 60 * 60 * 1_000))).toBe(true);
    expect(isFreshStepUp(session(), new Date(NOW.getTime() + 15 * 60 * 1_000 - 1))).toBe(true);
    expect(isFreshStepUp(session(), new Date(NOW.getTime() + 15 * 60 * 1_000))).toBe(false);
    expect(isFreshStepUp(session({ authenticationLevel: "primary" }), NOW)).toBe(false);
    expect(isFreshStepUp(session(), new Date(NOW.getTime() - 1))).toBe(false);
    expect(sessionMetadataRetentionEligibleAt(NOW)).toEqual(
      new Date(NOW.getTime() + 30 * 24 * 60 * 60 * 1_000),
    );
  });

  it("rejects malformed trusted assurance instead of accepting caller-shaped policy", async () => {
    const authentication = await createAuthentication();
    expect(() =>
      createSessionAuthenticationEvidence(authentication, {
        authenticationLevel: "MFA ADMIN",
        authenticationTime: NOW,
      }),
    ).toThrow(TypeError);
    expect(() =>
      createSessionAuthenticationEvidence(authentication, {
        authenticationLevel: "mfa",
        authenticationTime: new Date(Number.NaN),
      }),
    ).toThrow(TypeError);
  });
});
