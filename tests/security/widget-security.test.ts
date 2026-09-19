import { describe, expect, it } from "vitest";
import { SignJWT } from "jose";

import {
  createWidgetEmbedConfig,
  createWidgetSecurityConfig,
} from "../../packages/config/src/index.js";
import {
  WidgetOriginInvalidError,
  WidgetRateLimitError,
  WidgetTokenInvalidError,
  createWidgetExchangeGrantService,
  createWidgetRateLimiter,
  createWidgetTokenService,
  normalizeWidgetOrigin,
  widgetOriginMatches,
} from "../../packages/security/src/index.js";

const ORGANIZATION_ID = "0193f1a8-7f65-7c28-a434-a10796c41c2b" as never;
const CHANNEL_ID = "0193f1a8-7f65-7c28-a434-a10796c41c2c" as never;
const SESSION_ID = "0193f1a8-7f65-7c28-a434-a10796c41c2d" as never;
const KEY = Buffer.alloc(32, 7).toString("base64url");
const TOKEN_NOW = new Date("2026-09-15T10:00:00.000Z");
const EXCHANGE_KEY = Buffer.alloc(32, 17).toString("base64url");

const signCandidate = async (
  overrides: Readonly<Record<string, unknown>> = {},
  issuer = "lead-agent-widget",
  audience = "lead-agent-widget",
  timing: Readonly<{ expiresAt?: number; issuedAt?: number }> = {},
  subject: string = SESSION_ID,
): Promise<string> =>
  await new SignJWT({
    channel_connection_id: CHANNEL_ID,
    conversation_id: null,
    organization_id: ORGANIZATION_ID,
    origin: "https://clinic.example",
    scope: "widget:conversation",
    version: 1,
    ...overrides,
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer(issuer)
    .setAudience(audience)
    .setSubject(subject)
    .setJti(Buffer.alloc(32, 9).toString("base64url"))
    .setIssuedAt(timing.issuedAt ?? Math.floor(TOKEN_NOW.getTime() / 1_000))
    .setExpirationTime(timing.expiresAt ?? Math.floor(TOKEN_NOW.getTime() / 1_000) + 7_200)
    .sign(Buffer.from(KEY, "base64url"));

describe("S10 Widget Origin trust", () => {
  it("normalizes exact HTTPS Origins and freezes one-label wildcard matching", () => {
    expect(normalizeWidgetOrigin("https://CLINIC.example:8443")).toBe(
      "https://clinic.example:8443",
    );
    const wildcard = {
      matchType: "subdomain_wildcard",
      normalizedHost: "clinic.example",
      port: null,
      scheme: "https",
    } as const;
    expect(widgetOriginMatches("https://booking.clinic.example", wildcard)).toBe(true);
    expect(widgetOriginMatches("https://deeper.booking.clinic.example", wildcard)).toBe(false);
    expect(widgetOriginMatches("https://clinic.example", wildcard)).toBe(false);
    expect(widgetOriginMatches("https://evilclinic.example", wildcard)).toBe(false);
    expect(widgetOriginMatches("https://clinic.example.evil.com", wildcard)).toBe(false);
  });

  it.each([
    undefined,
    "null",
    "http://clinic.example",
    "https://user@clinic.example",
    "https://clinic.example/path",
    "not an origin",
  ])("rejects untrusted Origin %#", (value) => {
    expect(() => normalizeWidgetOrigin(value)).toThrow(WidgetOriginInvalidError);
  });
});

describe("S10 Widget bearer tokens", () => {
  it("signs and validates exact purpose-bound claims and equality expiry", async () => {
    const tokens = createWidgetTokenService(createWidgetSecurityConfig(KEY));
    const now = TOKEN_NOW;
    const claims = {
      channelConnectionId: CHANNEL_ID,
      conversationId: null,
      expiresAt: new Date("2026-09-15T12:00:00.000Z"),
      issuedAt: now,
      jti: tokens.createJti(),
      organizationId: ORGANIZATION_ID,
      origin: "https://clinic.example",
      sessionId: SESSION_ID,
    };
    const token = await tokens.issue(claims);
    await expect(tokens.verify(token, now)).resolves.toMatchObject({
      origin: claims.origin,
      sessionId: SESSION_ID,
    });
    await expect(tokens.verify(token, claims.expiresAt)).rejects.toBeInstanceOf(
      WidgetTokenInvalidError,
    );
    const wrong = createWidgetTokenService(
      createWidgetSecurityConfig(Buffer.alloc(32, 8).toString("base64url")),
    );
    await expect(wrong.verify(token, now)).rejects.toBeInstanceOf(WidgetTokenInvalidError);
  });

  it("rejects malformed and wrong-purpose tokens without accepting extension claims", async () => {
    const tokens = createWidgetTokenService(createWidgetSecurityConfig(KEY));
    await expect(tokens.verify("not-a-jwt", TOKEN_NOW)).rejects.toBeInstanceOf(
      WidgetTokenInvalidError,
    );
    await expect(
      tokens.verify(await signCandidate({}, "wrong-issuer"), TOKEN_NOW),
    ).rejects.toBeInstanceOf(WidgetTokenInvalidError);
    await expect(
      tokens.verify(await signCandidate({}, undefined, "wrong-audience"), TOKEN_NOW),
    ).rejects.toBeInstanceOf(WidgetTokenInvalidError);
    await expect(
      tokens.verify(await signCandidate({ version: 2 }), TOKEN_NOW),
    ).rejects.toBeInstanceOf(WidgetTokenInvalidError);
    await expect(
      tokens.verify(await signCandidate({ extension: "forbidden" }), TOKEN_NOW),
    ).rejects.toBeInstanceOf(WidgetTokenInvalidError);
    await expect(
      tokens.verify(await signCandidate({}, undefined, undefined, {}, "not-a-session"), TOKEN_NOW),
    ).rejects.toBeInstanceOf(WidgetTokenInvalidError);
  });

  it("rejects non-canonical trust bindings and future or overlong lifetimes", async () => {
    const tokens = createWidgetTokenService(createWidgetSecurityConfig(KEY));
    await expect(
      tokens.verify(await signCandidate({ organization_id: "x".repeat(36) }), TOKEN_NOW),
    ).rejects.toBeInstanceOf(WidgetTokenInvalidError);
    await expect(
      tokens.verify(await signCandidate({ origin: "https://CLINIC.example" }), TOKEN_NOW),
    ).rejects.toBeInstanceOf(WidgetTokenInvalidError);

    const nowSeconds = Math.floor(TOKEN_NOW.getTime() / 1_000);
    const future = await signCandidate({}, undefined, undefined, {
      expiresAt: nowSeconds + 7_200,
      issuedAt: nowSeconds + 1,
    });
    await expect(tokens.verify(future, TOKEN_NOW)).rejects.toBeInstanceOf(WidgetTokenInvalidError);
    const overlong = await signCandidate({}, undefined, undefined, {
      expiresAt: nowSeconds + 7_201,
      issuedAt: nowSeconds,
    });
    await expect(tokens.verify(overlong, TOKEN_NOW)).rejects.toBeInstanceOf(
      WidgetTokenInvalidError,
    );
  });

  it("rejects key reuse and derives stable rotation JTI material", () => {
    expect(() => createWidgetSecurityConfig(KEY, [KEY])).toThrow(
      "WIDGET_SIGNING_KEY_PURPOSE_SEPARATION",
    );
    const tokens = createWidgetTokenService(createWidgetSecurityConfig(KEY));
    expect(tokens.deriveBoundJti(SESSION_ID, "request-key")).toBe(
      tokens.deriveBoundJti(SESSION_ID, "request-key"),
    );
  });

  it("preserves the validated embedding Origin on iframe-bound tokens", async () => {
    const tokens = createWidgetTokenService(createWidgetSecurityConfig(KEY));
    const token = await tokens.issue({
      channelConnectionId: CHANNEL_ID,
      conversationId: null,
      embeddingOrigin: "https://clinic.example",
      expiresAt: new Date("2026-09-15T12:00:00.000Z"),
      issuedAt: TOKEN_NOW,
      jti: tokens.createJti(),
      organizationId: ORGANIZATION_ID,
      origin: "https://widget.example",
      sessionId: SESSION_ID,
    });
    await expect(tokens.verify(token, TOKEN_NOW)).resolves.toMatchObject({
      embeddingOrigin: "https://clinic.example",
      origin: "https://widget.example",
    });
    await expect(
      tokens.verify(await signCandidate({ embedding_origin: "https://CLINIC.example" }), TOKEN_NOW),
    ).rejects.toBeInstanceOf(WidgetTokenInvalidError);
  });
});

describe("S19 one-time Widget exchange grants", () => {
  const config = () =>
    createWidgetEmbedConfig(EXCHANGE_KEY, "https://widget.example", "https://api.example", [KEY]);

  it("encrypts exact host/session authority and expires at the 60-second boundary", () => {
    const exchanges = createWidgetExchangeGrantService(config());
    const expiresAt = new Date(TOKEN_NOW.getTime() + 60_000);
    const grant = exchanges.issue({
      channelConnectionId: CHANNEL_ID,
      embeddingOrigin: "https://clinic.example",
      expiresAt,
      issuedAt: TOKEN_NOW,
      jti: exchanges.createJti(),
      organizationId: ORGANIZATION_ID,
      sessionId: SESSION_ID,
    });
    expect(grant).toMatch(/^wex1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u);
    expect(grant).not.toContain(ORGANIZATION_ID);
    expect(grant).not.toContain("clinic.example");
    expect(exchanges.open(grant, TOKEN_NOW)).toMatchObject({
      embeddingOrigin: "https://clinic.example",
      organizationId: ORGANIZATION_ID,
      sessionId: SESSION_ID,
    });
    expect(() => exchanges.open(grant, expiresAt)).toThrow(WidgetTokenInvalidError);
  });

  it("fails closed for tampering, wrong keys, invalid origins, and key reuse", () => {
    const exchanges = createWidgetExchangeGrantService(config());
    const grant = exchanges.issue({
      channelConnectionId: CHANNEL_ID,
      embeddingOrigin: "https://clinic.example",
      expiresAt: new Date(TOKEN_NOW.getTime() + 60_000),
      issuedAt: TOKEN_NOW,
      jti: exchanges.createJti(),
      organizationId: ORGANIZATION_ID,
      sessionId: SESSION_ID,
    });
    expect(() => exchanges.open(grant.slice(0, -1) + "x", TOKEN_NOW)).toThrow(
      WidgetTokenInvalidError,
    );
    const wrong = createWidgetExchangeGrantService(
      createWidgetEmbedConfig(
        Buffer.alloc(32, 18).toString("base64url"),
        "https://widget.example",
        "https://api.example",
      ),
    );
    expect(() => wrong.open(grant, TOKEN_NOW)).toThrow(WidgetTokenInvalidError);
    expect(() =>
      createWidgetEmbedConfig(EXCHANGE_KEY, "http://widget.example", "https://api.example"),
    ).toThrow("WIDGET_PLATFORM_ORIGIN");
    expect(() =>
      createWidgetEmbedConfig(EXCHANGE_KEY, "https://widget.example", "https://api.example", [
        EXCHANGE_KEY,
      ]),
    ).toThrow("WIDGET_EXCHANGE_KEY_PURPOSE_SEPARATION");
  });
});

describe("S10 bounded process-local rate limiter", () => {
  it("enforces the threshold, deterministic Retry-After, bucket isolation, and cleanup", () => {
    let now = new Date("2026-09-15T10:00:00.000Z");
    const limiter = createWidgetRateLimiter({
      clock: () => now,
      maximumBuckets: 2,
      salt: Buffer.alloc(32, 1),
    });
    limiter.consume(["session-a"], 2);
    limiter.consume(["session-a"], 2);
    expect(() => limiter.consume(["session-a"], 2)).toThrow(WidgetRateLimitError);
    expect(() => limiter.consume(["session-b"], 1)).not.toThrow();
    now = new Date("2026-09-15T10:01:00.000Z");
    expect(() => limiter.consume(["session-a"], 2)).not.toThrow();
    expect(limiter.size()).toBeLessThanOrEqual(2);
  });

  it("does not evict an active bucket merely because the map is at capacity", () => {
    const limiter = createWidgetRateLimiter({
      clock: () => TOKEN_NOW,
      maximumBuckets: 2,
      salt: Buffer.alloc(32, 1),
    });
    limiter.consume(["session-a"], 1);
    limiter.consume(["session-b"], 1);
    expect(() => limiter.consume(["session-a"], 1)).toThrow(WidgetRateLimitError);
  });
});
