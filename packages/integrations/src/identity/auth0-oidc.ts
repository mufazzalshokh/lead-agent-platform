import type { Auth0OidcVerifierConfig } from "@lead-agent/config";
import {
  OidcCredentialInvalidError,
  OidcProviderUnavailableError,
  createOidcIdentityVerifier,
  type OidcIdentityEvidenceVerifier,
  type OidcIdentityVerifier,
  type OidcVerificationInput,
  type VerifiedOidcIdentityEvidence,
} from "@lead-agent/security";
import {
  createRemoteJWKSet,
  customFetch,
  errors as joseErrors,
  jwtVerify,
  type FetchImplementation,
  type RemoteJWKSetOptions,
} from "jose";

type Auth0OidcVerifierDependencies = Readonly<{
  fetch?: FetchImplementation;
}>;

const isValidOpaqueValue = (value: unknown, maximumLength: number): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= maximumLength;

const isProviderAvailabilityFailure = (error: unknown): boolean =>
  error instanceof joseErrors.JWKSTimeout ||
  error instanceof joseErrors.JWKSInvalid ||
  error instanceof joseErrors.JWKInvalid ||
  error instanceof TypeError;

const requireVerificationInput = (
  input: OidcVerificationInput,
  maximumIdTokenLength: number,
): void => {
  if (
    !isValidOpaqueValue(input.idToken, maximumIdTokenLength) ||
    input.idToken.split(".").length !== 3 ||
    !isValidOpaqueValue(input.expectedNonce, 512)
  ) {
    throw new OidcCredentialInvalidError();
  }
};

const requireOidcAuthorizedParty = (
  audience: string,
  tokenAudience: string | string[] | undefined,
  authorizedParty: unknown,
): void => {
  const audiences =
    typeof tokenAudience === "string"
      ? [tokenAudience]
      : Array.isArray(tokenAudience)
        ? tokenAudience
        : [];
  if (
    audiences.length === 0 ||
    audiences.some((candidate) => !isValidOpaqueValue(candidate, 512)) ||
    !audiences.includes(audience) ||
    (audiences.length > 1 && authorizedParty !== audience) ||
    (authorizedParty !== undefined && authorizedParty !== audience)
  ) {
    throw new OidcCredentialInvalidError();
  }
};

class Auth0OidcEvidenceVerifier implements OidcIdentityEvidenceVerifier {
  readonly #configuration: Auth0OidcVerifierConfig;
  readonly #jwks: ReturnType<typeof createRemoteJWKSet>;

  constructor(configuration: Auth0OidcVerifierConfig, dependencies: Auth0OidcVerifierDependencies) {
    this.#configuration = configuration;
    const options: RemoteJWKSetOptions = {
      cacheMaxAge: configuration.jwksCacheMaxAgeMilliseconds,
      cooldownDuration: configuration.jwksCooldownMilliseconds,
      timeoutDuration: configuration.jwksRequestTimeoutMilliseconds,
    };
    if (dependencies.fetch !== undefined) {
      options[customFetch] = dependencies.fetch;
    }
    this.#jwks = createRemoteJWKSet(new URL(configuration.jwksUri), options);
    Object.freeze(this);
  }

  async verifyEvidence(input: OidcVerificationInput): Promise<VerifiedOidcIdentityEvidence> {
    requireVerificationInput(input, this.#configuration.maximumIdTokenLength);

    try {
      const verified = await jwtVerify(input.idToken, this.#jwks, {
        algorithms: [...this.#configuration.allowedAlgorithms],
        audience: this.#configuration.audience,
        clockTolerance: this.#configuration.clockToleranceSeconds,
        issuer: this.#configuration.issuer,
        requiredClaims: ["exp", "iat", "nonce", "sub"],
      });
      if (
        verified.payload["nonce"] !== input.expectedNonce ||
        verified.payload.iss !== this.#configuration.issuer ||
        !isValidOpaqueValue(verified.payload.sub, 512)
      ) {
        throw new OidcCredentialInvalidError();
      }
      requireOidcAuthorizedParty(
        this.#configuration.audience,
        verified.payload.aud,
        verified.payload["azp"],
      );
      return Object.freeze({
        issuer: this.#configuration.issuer,
        subject: verified.payload.sub,
      });
    } catch (error) {
      if (error instanceof OidcCredentialInvalidError || !isProviderAvailabilityFailure(error)) {
        throw new OidcCredentialInvalidError();
      }
      throw new OidcProviderUnavailableError();
    }
  }
}

const createVerifier = (
  configuration: Auth0OidcVerifierConfig,
  dependencies: Auth0OidcVerifierDependencies,
): OidcIdentityVerifier =>
  createOidcIdentityVerifier(new Auth0OidcEvidenceVerifier(configuration, dependencies));

export const createAuth0OidcIdentityVerifier = (
  configuration: Auth0OidcVerifierConfig,
): OidcIdentityVerifier => createVerifier(configuration, Object.freeze({}));

/** @internal Deterministic JWKS transport seam; not exported from the package root. */
export const createAuth0OidcIdentityVerifierForTests = (
  configuration: Auth0OidcVerifierConfig,
  fetch: FetchImplementation,
): OidcIdentityVerifier => createVerifier(configuration, Object.freeze({ fetch }));
