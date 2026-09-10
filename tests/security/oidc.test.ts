import {
  ConfigurationValidationError,
  createAuth0OidcVerifierConfig,
  createIdentityDatabaseRuntimeConfig,
  type Auth0OidcVerifierConfig,
} from "../../packages/config/src/index.js";
import { UserIdSchema, isSchemaValue } from "../../packages/contracts/src/index.js";
import { createAuth0OidcIdentityVerifierForTests } from "../../packages/integrations/src/identity/auth0-oidc.js";
import {
  ExternalIdentityUnmappedError,
  OidcCredentialInvalidError,
  OidcProviderUnavailableError,
  authenticateExternalIdentity,
  type ExternalIdentityResolver,
  type OidcIdentityVerifier,
} from "../../packages/security/src/index.js";
import {
  SignJWT,
  exportJWK,
  generateKeyPair,
  type CryptoKey,
  type FetchImplementation,
  type JWK,
} from "jose";
import { beforeAll, describe, expect, it, vi } from "vitest";

const ISSUER = "https://synthetic-tenant.auth0.example/";
const AUDIENCE = "synthetic-s6-client";
const NONCE = "synthetic-s6-nonce";
const SUBJECT = "auth0|synthetic-user";
const USER_ID = "0193f1a8-7f65-7c28-a434-a10796c46201";

type SigningKey = Readonly<{
  kid: string;
  privateKey: CryptoKey;
  publicJwk: JWK;
}>;

type TokenOptions = Readonly<{
  audience?: string | string[];
  authorizedParty?: string;
  expiresAt?: number;
  includeExpiration?: boolean;
  includeNonce?: boolean;
  includeSubject?: boolean;
  issuedAt?: number;
  issuer?: string;
  key?: SigningKey;
  nonce?: string;
  notBefore?: number;
  subject?: string;
}>;

let signingKeyA: SigningKey;
let signingKeyB: SigningKey;

const createSigningKey = async (kid: string): Promise<SigningKey> => {
  const pair = await generateKeyPair("RS256", { extractable: true });
  const publicJwk = await exportJWK(pair.publicKey);
  return Object.freeze({
    kid,
    privateKey: pair.privateKey,
    publicJwk: Object.freeze({ ...publicJwk, alg: "RS256", kid, use: "sig" }),
  });
};

beforeAll(async () => {
  signingKeyA = await createSigningKey("synthetic-key-a");
  signingKeyB = await createSigningKey("synthetic-key-b");
});

const createConfig = (
  overrides: Partial<Parameters<typeof createAuth0OidcVerifierConfig>[0]> = {},
): Auth0OidcVerifierConfig =>
  createAuth0OidcVerifierConfig({
    audience: AUDIENCE,
    issuer: ISSUER,
    ...overrides,
  });

const createToken = async (options: TokenOptions = {}): Promise<string> => {
  const now = options.issuedAt ?? Math.floor(Date.now() / 1000);
  const key = options.key ?? signingKeyA;
  let token = new SignJWT({
    ...(options.authorizedParty === undefined ? {} : { azp: options.authorizedParty }),
    ...(options.includeNonce === false ? {} : { nonce: options.nonce ?? NONCE }),
  })
    .setProtectedHeader({ alg: "RS256", kid: key.kid })
    .setIssuer(options.issuer ?? ISSUER)
    .setAudience(options.audience ?? AUDIENCE)
    .setIssuedAt(now);
  if (options.includeSubject !== false) {
    token = token.setSubject(options.subject ?? SUBJECT);
  }
  if (options.includeExpiration !== false) {
    token = token.setExpirationTime(options.expiresAt ?? now + 300);
  }
  if (options.notBefore !== undefined) {
    token = token.setNotBefore(options.notBefore);
  }
  return await token.sign(key.privateKey);
};

const createJwksFetch =
  (getKeys: () => readonly JWK[], requests: string[]): FetchImplementation =>
  (url, options) => {
    requests.push(url);
    if (options.signal.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }
    return Promise.resolve(
      new Response(JSON.stringify({ keys: getKeys() }), {
        headers: { "content-type": "application/json" },
        status: 200,
      }),
    );
  };

const createVerifier = (
  getKeys: () => readonly JWK[] = () => [signingKeyA.publicJwk],
  requests: string[] = [],
  config = createConfig(),
): OidcIdentityVerifier =>
  createAuth0OidcIdentityVerifierForTests(config, createJwksFetch(getKeys, requests));

describe("S6.2 Auth0 OIDC configuration", () => {
  it("requires an exact canonical HTTPS issuer and derives only its fixed JWKS endpoint", () => {
    const config = createConfig();
    expect(config).toMatchObject({
      allowedAlgorithms: ["RS256"],
      audience: AUDIENCE,
      clockToleranceSeconds: 5,
      issuer: ISSUER,
      jwksCacheMaxAgeMilliseconds: 600_000,
      jwksCooldownMilliseconds: 30_000,
      jwksRequestTimeoutMilliseconds: 5_000,
      jwksUri: `${ISSUER}.well-known/jwks.json`,
      maximumIdTokenLength: 65_536,
    });
    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.isFrozen(config.allowedAlgorithms)).toBe(true);
  });

  it.each([
    "",
    " http://synthetic.auth0.example/",
    "ftp://synthetic.auth0.example/",
    "https://user:password@synthetic.auth0.example/",
    "https://synthetic.auth0.example/?tenant=attacker",
    "https://synthetic.auth0.example/#fragment",
    "https://synthetic.auth0.example",
    "https://SYNTHETIC.auth0.example/",
  ])("rejects unsafe or normalized issuer configuration: %s", (issuer) => {
    expect(() => createConfig({ issuer })).toThrow(ConfigurationValidationError);
  });

  it("rejects missing audience and out-of-policy network/cache/clock settings", () => {
    for (const overrides of [
      { audience: "" },
      { audience: " padded " },
      { clockToleranceSeconds: 61 },
      { jwksCacheMaxAgeMilliseconds: 59_999 },
      { jwksCooldownMilliseconds: 999 },
      { jwksRequestTimeoutMilliseconds: 10_001 },
    ]) {
      expect(() => createConfig(overrides)).toThrow(ConfigurationValidationError);
    }
  });

  it("keeps the global identity connection configuration separately branded and bounded", () => {
    const config = createIdentityDatabaseRuntimeConfig({
      connectionString:
        "postgresql://lead_agent_auth:synthetic@localhost:5432/lead_agent_identity_test",
      maxConnections: 2,
    });
    expect(config.maxConnections).toBe(2);
    expect(config.statementTimeoutMilliseconds).toBe(10_000);
    expect(() =>
      createIdentityDatabaseRuntimeConfig({
        connectionString: "postgresql://localhost/postgres",
      }),
    ).toThrow(ConfigurationValidationError);
  });
});

describe("S6.2 Auth0 OIDC verification", () => {
  it("returns only a frozen, provider-neutral exact issuer and subject", async () => {
    const requests: string[] = [];
    const identity = await createVerifier(() => [signingKeyA.publicJwk], requests).verify({
      expectedNonce: NONCE,
      idToken: await createToken(),
    });
    expect(identity).toEqual({ issuer: ISSUER, subject: SUBJECT });
    expect(Object.keys(identity).sort()).toEqual(["issuer", "subject"]);
    expect(Object.isFrozen(identity)).toBe(true);
    expect(requests).toEqual([`${ISSUER}.well-known/jwks.json`]);
  });

  it("ignores auxiliary provider claims as application authority", async () => {
    const elevatedToken = await new SignJWT({
      email: "synthetic@example.test",
      nonce: NONCE,
      organization_id: "attacker-organization",
      permissions: ["platform:admin"],
      roles: ["owner"],
    })
      .setProtectedHeader({ alg: "RS256", kid: signingKeyA.kid })
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setSubject(SUBJECT)
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(signingKeyA.privateKey);
    const identity = await createVerifier().verify({
      expectedNonce: NONCE,
      idToken: elevatedToken,
    });
    expect(identity).toEqual({ issuer: ISSUER, subject: SUBJECT });
  });

  it("accepts OIDC multi-audience tokens only with the exact authorized party", async () => {
    const verifier = createVerifier();
    await expect(
      verifier.verify({
        expectedNonce: NONCE,
        idToken: await createToken({
          audience: [AUDIENCE, "synthetic-secondary-api"],
          authorizedParty: AUDIENCE,
        }),
      }),
    ).resolves.toEqual({ issuer: ISSUER, subject: SUBJECT });
    await expect(
      verifier.verify({
        expectedNonce: NONCE,
        idToken: await createToken({ audience: [AUDIENCE, "synthetic-secondary-api"] }),
      }),
    ).rejects.toBeInstanceOf(OidcCredentialInvalidError);
    await expect(
      verifier.verify({
        expectedNonce: NONCE,
        idToken: await createToken({
          audience: [AUDIENCE, "synthetic-secondary-api"],
          authorizedParty: "attacker-client",
        }),
      }),
    ).rejects.toBeInstanceOf(OidcCredentialInvalidError);
  });

  it("fails closed for forged, malformed, stale, premature, or mismatched credentials", async () => {
    const now = Math.floor(Date.now() / 1000);
    const verifier = createVerifier();
    const invalidTokens = [
      "not-a-jwt",
      await createToken({ issuer: "https://attacker.auth0.example/" }),
      await createToken({ audience: "attacker-client" }),
      await createToken({ expiresAt: now - 60 }),
      await createToken({ notBefore: now + 3600 }),
      await createToken({ includeExpiration: false }),
      await createToken({ includeNonce: false }),
      await createToken({ includeSubject: false }),
      await createToken({ key: signingKeyB }),
    ];
    for (const idToken of invalidTokens) {
      await expect(verifier.verify({ expectedNonce: NONCE, idToken })).rejects.toBeInstanceOf(
        OidcCredentialInvalidError,
      );
    }
    await expect(
      verifier.verify({
        expectedNonce: "wrong-nonce",
        idToken: await createToken(),
      }),
    ).rejects.toBeInstanceOf(OidcCredentialInvalidError);
  });

  it("caches known keys, fails unknown kids during cooldown, and reloads after rotation", async () => {
    const requests: string[] = [];
    let keys: readonly JWK[] = [signingKeyA.publicJwk];
    const clock = vi.spyOn(Date, "now");
    const initialTime = Date.now();
    clock.mockReturnValue(initialTime);
    try {
      const verifier = createVerifier(
        () => keys,
        requests,
        createConfig({ jwksCooldownMilliseconds: 1_000 }),
      );
      await verifier.verify({ expectedNonce: NONCE, idToken: await createToken() });
      await verifier.verify({ expectedNonce: NONCE, idToken: await createToken() });
      expect(requests).toHaveLength(1);

      keys = [signingKeyA.publicJwk, signingKeyB.publicJwk];
      await expect(
        verifier.verify({
          expectedNonce: NONCE,
          idToken: await createToken({ key: signingKeyB }),
        }),
      ).rejects.toBeInstanceOf(OidcCredentialInvalidError);
      expect(requests).toHaveLength(1);

      clock.mockReturnValue(initialTime + 1_001);
      await expect(
        verifier.verify({
          expectedNonce: NONCE,
          idToken: await createToken({ key: signingKeyB }),
        }),
      ).resolves.toEqual({ issuer: ISSUER, subject: SUBJECT });
      expect(requests).toHaveLength(2);
    } finally {
      clock.mockRestore();
    }
  });

  it("distinguishes provider/JWKS unavailability from invalid credentials", async () => {
    const unavailable = createAuth0OidcIdentityVerifierForTests(createConfig(), () =>
      Promise.reject(new TypeError("Synthetic provider outage")),
    );
    await expect(
      unavailable.verify({ expectedNonce: NONCE, idToken: await createToken() }),
    ).rejects.toBeInstanceOf(OidcProviderUnavailableError);

    const malformedJwks = createAuth0OidcIdentityVerifierForTests(createConfig(), () =>
      Promise.resolve(
        new Response(JSON.stringify({ keys: "invalid" }), {
          headers: { "content-type": "application/json" },
          status: 200,
        }),
      ),
    );
    await expect(
      malformedJwks.verify({ expectedNonce: NONCE, idToken: await createToken() }),
    ).rejects.toBeInstanceOf(OidcProviderUnavailableError);
  });

  it("maps validated identity to a User without introducing tenant or role authority", async () => {
    if (!isSchemaValue(UserIdSchema, USER_ID)) {
      throw new Error("Invalid synthetic UserId");
    }
    const resolve: ExternalIdentityResolver["resolve"] = vi.fn((identity) => {
      expect(identity).toEqual({ issuer: ISSUER, subject: SUBJECT });
      return Promise.resolve(USER_ID);
    });
    const resolver: ExternalIdentityResolver = { resolve };
    await expect(
      authenticateExternalIdentity(createVerifier(), resolver, {
        expectedNonce: NONCE,
        idToken: await createToken(),
      }),
    ).resolves.toEqual({ userId: USER_ID });
    expect(resolve).toHaveBeenCalledOnce();

    const unmapped: ExternalIdentityResolver = {
      resolve: () => Promise.reject(new ExternalIdentityUnmappedError()),
    };
    await expect(
      authenticateExternalIdentity(createVerifier(), unmapped, {
        expectedNonce: NONCE,
        idToken: await createToken(),
      }),
    ).rejects.toBeInstanceOf(ExternalIdentityUnmappedError);
  });
});
