import {
  OrganizationIdSchema,
  UserIdSchema,
  isSchemaValue,
  type OrganizationId,
  type UserId,
} from "../../packages/contracts/src/index.js";
import {
  BrowserAuthenticationTokenInvalidError,
  BrowserCsrfInvalidError,
  BrowserOriginNotAllowedError,
  createBrowserAuthEnvelopeProtector,
  createOidcIdentityVerifier,
  requireAcceptableFetchMetadata,
  requireSessionBoundCsrf,
  requireTrustedStaffOrigin,
  resolveSafeReturnPath,
} from "../../packages/security/src/index.js";
import { describe, expect, it } from "vitest";

const NOW = new Date("2026-09-12T08:00:00.000Z");
const USER_VALUE = "0193f1a8-7f65-7c28-a434-a10796c46601";
const ORGANIZATION_VALUE = "0193f1a8-7f65-7c28-a434-a10796c46602";
if (
  !isSchemaValue(UserIdSchema, USER_VALUE) ||
  !isSchemaValue(OrganizationIdSchema, ORGANIZATION_VALUE)
) {
  throw new TypeError("Invalid browser-auth synthetic identifiers");
}
const USER_ID: UserId = USER_VALUE;
const ORGANIZATION_ID: OrganizationId = ORGANIZATION_VALUE;
const opaque = (character: string): string => character.repeat(43);

const protector = createBrowserAuthEnvelopeProtector(new Uint8Array(32).fill(7), {
  random: (size) => new Uint8Array(size).fill(11),
});

const identity = async () =>
  createOidcIdentityVerifier({
    verifyEvidence: () =>
      Promise.resolve({ issuer: "https://tenant.auth0.example/", subject: "auth0|subject" }),
  }).verify({ expectedNonce: "nonce", idToken: "test" });

describe("S6.6 browser authentication security primitives", () => {
  it("round-trips a purpose-bound login transaction and rejects tampering or expiry", () => {
    const sealed = protector.sealTransaction({
      codeVerifier: opaque("v"),
      expiresAt: new Date(NOW.getTime() + 600_000),
      issuedAt: NOW,
      maximumAgeSeconds: 43_200,
      nonce: opaque("n"),
      purpose: "login",
      returnPath: "/dashboard?tab=leads",
      state: opaque("s"),
    });
    expect(protector.openTransaction(sealed, NOW)).toMatchObject({
      purpose: "login",
      returnPath: "/dashboard?tab=leads",
    });
    expect(() => protector.openTransaction(sealed.slice(0, -1) + "A", NOW)).toThrow(
      BrowserAuthenticationTokenInvalidError,
    );
    expect(() => protector.openTransaction(sealed, new Date(NOW.getTime() + 600_000))).toThrow(
      BrowserAuthenticationTokenInvalidError,
    );
  });

  it("requires same-user/session binding for step-up transactions", () => {
    const valid = protector.sealTransaction({
      codeVerifier: opaque("v"),
      expectedSessionId: "0193f1a8-7f65-7c28-a434-a10796c46603",
      expectedUserId: USER_ID,
      expiresAt: new Date(NOW.getTime() + 600_000),
      issuedAt: NOW,
      maximumAgeSeconds: 900,
      nonce: opaque("n"),
      purpose: "step_up",
      returnPath: "/settings/security",
      state: opaque("s"),
    });
    expect(protector.openTransaction(valid, NOW)).toMatchObject({ expectedUserId: USER_ID });
    const invalid = protector.sealTransaction({
      codeVerifier: opaque("v"),
      expiresAt: new Date(NOW.getTime() + 600_000),
      issuedAt: NOW,
      maximumAgeSeconds: 900,
      nonce: opaque("n"),
      purpose: "step_up",
      returnPath: "/",
      state: opaque("s"),
    });
    expect(() => protector.openTransaction(invalid, NOW)).toThrow(
      BrowserAuthenticationTokenInvalidError,
    );
  });

  it("binds invitation proof to verified identity, target, organization, and token digest", async () => {
    const sealed = protector.sealInvitationProof({
      authenticationLevel: "mfa",
      authenticationTime: NOW,
      expiresAt: new Date(NOW.getTime() + 600_000),
      identity: await identity(),
      invitationOrganizationId: ORGANIZATION_ID,
      invitationTokenHash: opaque("h"),
      issuedAt: NOW,
      verifiedEmailTarget: "person@example.test",
    });
    expect(protector.openInvitationProof(sealed, NOW)).toMatchObject({
      invitationOrganizationId: ORGANIZATION_ID,
      invitationTokenHash: opaque("h"),
      verifiedEmailTarget: "person@example.test",
    });
  });

  it("keeps session and CSRF secrets independent and session-bound", () => {
    const sealed = protector.sealSession({
      csrfSecret: opaque("c"),
      expiresAt: new Date(NOW.getTime() + 43_200_000),
      sessionToken: opaque("t"),
    });
    const credential = protector.openSession(sealed, NOW);
    expect(() =>
      requireSessionBoundCsrf(opaque("c"), opaque("c"), credential.csrfSecret),
    ).not.toThrow();
    expect(() => requireSessionBoundCsrf(opaque("x"), opaque("x"), credential.csrfSecret)).toThrow(
      BrowserCsrfInvalidError,
    );
    expect(() => protector.openSession(sealed, new Date(NOW.getTime() + 43_200_000))).toThrow(
      BrowserAuthenticationTokenInvalidError,
    );
  });

  it("accepts only exact trusted staff origins and safe Fetch Metadata", () => {
    const allowed = ["https://staff.example.test"];
    expect(requireTrustedStaffOrigin(allowed[0], allowed)).toBe(allowed[0]);
    for (const origin of [
      "null",
      "https://staff.example.test.attacker.test",
      "http://staff.example.test",
      "https://staff.example.test:444",
    ]) {
      expect(() => requireTrustedStaffOrigin(origin, allowed)).toThrow(
        BrowserOriginNotAllowedError,
      );
    }
    expect(() => requireAcceptableFetchMetadata("same-origin")).not.toThrow();
    expect(() => requireAcceptableFetchMetadata(undefined)).not.toThrow();
    expect(() => requireAcceptableFetchMetadata("cross-site")).toThrow(BrowserCsrfInvalidError);
  });

  it("blocks external, encoded, protocol-relative, and backslash redirect targets", () => {
    expect(resolveSafeReturnPath("/dashboard?tab=1")).toBe("/dashboard?tab=1");
    for (const target of [
      "https://attacker.test/",
      "//attacker.test/",
      "/..//attacker.test/",
      "/%2e%2e//attacker.test/",
      "/%2f%2fattacker.test",
      "/%252f%252fattacker.test",
      "/%0d%0aLocation:%20https://attacker.test/",
      "/\\attacker.test",
      "/%5c%5cattacker.test",
      "javascript:alert(1)",
      "data:text/html,attacker",
      "/safe#fragment",
    ]) {
      expect(resolveSafeReturnPath(target, "/safe")).toBe("/safe");
    }
  });
});
