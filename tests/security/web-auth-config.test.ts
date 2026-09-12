import { createStaffWebAuthConfig } from "../../packages/config/src/index.js";
import { describe, expect, it } from "vitest";

const key = (value: number): string => Buffer.alloc(32, value).toString("base64url");
const valid = (environment: "development" | "production" | "test" = "production") => ({
  browserEnvelopeKey: key(1),
  callbackUri:
    environment === "development"
      ? "http://localhost:3001/v1/staff/auth/callback"
      : "https://api.example.test/v1/staff/auth/callback",
  clientId: "staff-client",
  clientSecret: "server-only-secret",
  environment,
  invitationTargetEncryptionKey: key(2),
  invitationTargetLookupKey: key(3),
  issuer: "https://tenant.auth0.example/",
  requireMfa: true,
  staffAllowedOrigins: [
    environment === "development" ? "http://localhost:3000" : "https://staff.example.test",
  ],
  staffApplicationOrigin:
    environment === "development" ? "http://localhost:3000" : "https://staff.example.test",
});

describe("S6.6 web authentication configuration", () => {
  it("accepts exact hardened production settings", () => {
    const configuration = createStaffWebAuthConfig(valid());
    expect(configuration.authorizationEndpoint).toBe("https://tenant.auth0.example/authorize");
    expect(configuration.tokenEndpoint).toBe("https://tenant.auth0.example/oauth/token");
    expect(configuration.requireMfa).toBe(true);
  });

  it("fails closed when production MFA is disabled", () => {
    expect(() => createStaffWebAuthConfig({ ...valid(), requireMfa: false })).toThrow();
  });

  it("rejects wildcard, malformed, or untrusted staff origins", () => {
    expect(() => createStaffWebAuthConfig({ ...valid(), staffAllowedOrigins: ["*"] })).toThrow();
    expect(() =>
      createStaffWebAuthConfig({
        ...valid(),
        staffAllowedOrigins: ["https://other.example.test"],
      }),
    ).toThrow();
  });

  it("rejects insecure production callbacks but permits explicit loopback development", () => {
    expect(() =>
      createStaffWebAuthConfig({
        ...valid(),
        callbackUri: "http://api.example.test/v1/staff/auth/callback",
      }),
    ).toThrow();
    expect(() => createStaffWebAuthConfig(valid("development"))).not.toThrow();
  });

  it("requires purpose-separated 256-bit keys", () => {
    expect(() =>
      createStaffWebAuthConfig({
        ...valid(),
        invitationTargetLookupKey: key(1),
      }),
    ).toThrow();
  });
});
