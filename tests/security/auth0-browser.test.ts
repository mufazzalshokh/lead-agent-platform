import { createHash } from "node:crypto";

import { createStaffWebAuthConfig } from "../../packages/config/src/index.js";
import { createAuth0BrowserOidcClientForTests } from "../../packages/integrations/src/identity/auth0-browser.js";
import {
  OidcCredentialInvalidError,
  OidcProviderUnavailableError,
} from "../../packages/security/src/index.js";
import { SignJWT, exportJWK, generateKeyPair } from "jose";
import { describe, expect, it } from "vitest";

const ISSUER = "https://tenant.auth0.example/";
const CLIENT_ID = "staff-client";
const CALLBACK = "https://api.example.test/v1/staff/auth/callback";

const configuration = createStaffWebAuthConfig({
  browserEnvelopeKey: Buffer.alloc(32, 1).toString("base64url"),
  callbackUri: CALLBACK,
  clientId: CLIENT_ID,
  clientSecret: "server-only-test-value",
  environment: "test",
  invitationTargetEncryptionKey: Buffer.alloc(32, 2).toString("base64url"),
  invitationTargetLookupKey: Buffer.alloc(32, 3).toString("base64url"),
  issuer: ISSUER,
  requireMfa: true,
  staffAllowedOrigins: ["https://staff.example.test"],
  staffApplicationOrigin: "https://staff.example.test",
});

describe("S6.6 Auth0 Authorization Code + PKCE client", () => {
  it("generates independent state, nonce, and S256 PKCE authorization requests", async () => {
    const unavailableFetch: Parameters<typeof createAuth0BrowserOidcClientForTests>[1] = () =>
      Promise.reject(new TypeError("network disabled"));
    const client = createAuth0BrowserOidcClientForTests(configuration, unavailableFetch);
    const first = await client.begin("login");
    const second = await client.begin("login");
    const url = new URL(first.authorizationUrl);
    expect(url.origin + url.pathname).toBe("https://tenant.auth0.example/authorize");
    expect(url.searchParams.get("client_id")).toBe(CLIENT_ID);
    expect(url.searchParams.get("redirect_uri")).toBe(CALLBACK);
    expect(url.searchParams.get("scope")).toBe("openid profile email");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toBe(
      createHash("sha256").update(first.codeVerifier, "ascii").digest("base64url"),
    );
    expect(first.state).not.toBe(second.state);
    expect(first.nonce).not.toBe(second.nonce);
    expect(first.codeVerifier).not.toBe(second.codeVerifier);
  });

  it("validates the callback and returns only bounded authentication evidence", async () => {
    const keys = await generateKeyPair("RS256");
    const jwk = await exportJWK(keys.publicKey);
    const nowSeconds = Math.floor(Date.now() / 1_000);
    let observedVerifier: string | null = null;
    let expectedVerifier = "";
    let signedIdToken = "";
    const callbackFetch: Parameters<typeof createAuth0BrowserOidcClientForTests>[1] = (
      input,
      init,
    ) => {
      const url = input;
      if (url.endsWith("/.well-known/jwks.json")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({ keys: [{ ...jwk, alg: "RS256", kid: "test-key", use: "sig" }] }),
            { headers: { "content-type": "application/json" }, status: 200 },
          ),
        );
      }
      if (url !== "https://tenant.auth0.example/oauth/token") {
        return Promise.reject(new TypeError("unexpected network target"));
      }
      const requestBody = init?.body;
      if (typeof requestBody !== "string" && !(requestBody instanceof URLSearchParams)) {
        return Promise.reject(new TypeError("unexpected token request body"));
      }
      const body = new URLSearchParams(requestBody);
      observedVerifier = body.get("code_verifier");
      if (observedVerifier !== expectedVerifier) {
        return Promise.resolve(
          new Response(JSON.stringify({ error: "invalid_grant" }), {
            headers: { "content-type": "application/json" },
            status: 400,
          }),
        );
      }
      return Promise.resolve(
        new Response(
          JSON.stringify({
            access_token: "discarded-access-token",
            expires_in: 600,
            id_token: signedIdToken,
            token_type: "Bearer",
          }),
          { headers: { "content-type": "application/json" }, status: 200 },
        ),
      );
    };
    const callbackClient = createAuth0BrowserOidcClientForTests(configuration, callbackFetch);
    const authorization = await callbackClient.begin("login");
    expectedVerifier = authorization.codeVerifier;
    signedIdToken = await new SignJWT({
      amr: ["pwd", "mfa"],
      auth_time: nowSeconds,
      email: "person@example.test",
      email_verified: true,
      nonce: authorization.nonce,
    })
      .setProtectedHeader({ alg: "RS256", kid: "test-key", typ: "JWT" })
      .setIssuer(ISSUER)
      .setAudience(CLIENT_ID)
      .setSubject("auth0|verified-subject")
      .setIssuedAt(nowSeconds)
      .setExpirationTime(nowSeconds + 600)
      .sign(keys.privateKey);
    const evidence = await callbackClient.complete({
      callbackUrl: new URL(CALLBACK + "?code=synthetic&state=" + authorization.state),
      codeVerifier: authorization.codeVerifier,
      expectedNonce: authorization.nonce,
      expectedState: authorization.state,
      maximumAgeSeconds: 43_200,
    });
    expect(observedVerifier).toBe(authorization.codeVerifier);
    expect(evidence).toMatchObject({
      authenticationLevel: "mfa",
      verifiedEmailTarget: "person@example.test",
    });
    expect(evidence).not.toHaveProperty("accessToken");
    expect(evidence).not.toHaveProperty("refreshToken");
    await expect(
      callbackClient.complete({
        callbackUrl: new URL(CALLBACK + "?code=synthetic&state=" + authorization.state),
        codeVerifier: "x".repeat(43),
        expectedNonce: authorization.nonce,
        expectedState: authorization.state,
        maximumAgeSeconds: 43_200,
      }),
    ).rejects.toBeInstanceOf(OidcCredentialInvalidError);
    await expect(
      callbackClient.complete({
        callbackUrl: new URL(CALLBACK + "?code=synthetic&state=" + authorization.state),
        codeVerifier: authorization.codeVerifier,
        expectedNonce: "x".repeat(43),
        expectedState: authorization.state,
        maximumAgeSeconds: 43_200,
      }),
    ).rejects.toBeInstanceOf(OidcCredentialInvalidError);
  });

  it("fails closed before exchange when callback state is substituted", async () => {
    let calls = 0;
    const fetchImplementation: Parameters<typeof createAuth0BrowserOidcClientForTests>[1] = () => {
      calls += 1;
      return Promise.reject(new TypeError("network should not be reached"));
    };
    const client = createAuth0BrowserOidcClientForTests(configuration, fetchImplementation);
    const authorization = await client.begin("login");
    await expect(
      client.complete({
        callbackUrl: new URL(CALLBACK + "?code=synthetic&state=" + "x".repeat(43)),
        codeVerifier: authorization.codeVerifier,
        expectedNonce: authorization.nonce,
        expectedState: authorization.state,
        maximumAgeSeconds: 43_200,
      }),
    ).rejects.toBeInstanceOf(OidcCredentialInvalidError);
    expect(calls).toBe(0);
  });

  it("maps unavailable token transport to a safe provider-unavailable error", async () => {
    const client = createAuth0BrowserOidcClientForTests(configuration, () =>
      Promise.reject(new TypeError("fetch failed")),
    );
    const authorization = await client.begin("login");
    await expect(
      client.complete({
        callbackUrl: new URL(CALLBACK + "?code=synthetic&state=" + authorization.state),
        codeVerifier: authorization.codeVerifier,
        expectedNonce: authorization.nonce,
        expectedState: authorization.state,
        maximumAgeSeconds: 43_200,
      }),
    ).rejects.toBeInstanceOf(OidcProviderUnavailableError);
  });
});
