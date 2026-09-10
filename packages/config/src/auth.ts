import { URL } from "node:url";

import { ConfigurationValidationError } from "./database.js";

const auth0OidcVerifierConfigBrand: unique symbol = Symbol("Auth0OidcVerifierConfig");

export type Auth0OidcVerifierConfigInput = Readonly<{
  audience: unknown;
  clockToleranceSeconds?: unknown;
  issuer: unknown;
  jwksCacheMaxAgeMilliseconds?: unknown;
  jwksCooldownMilliseconds?: unknown;
  jwksRequestTimeoutMilliseconds?: unknown;
}>;

export type Auth0OidcVerifierConfig = Readonly<{
  allowedAlgorithms: readonly ["RS256"];
  audience: string;
  clockToleranceSeconds: number;
  issuer: string;
  jwksCacheMaxAgeMilliseconds: number;
  jwksCooldownMilliseconds: number;
  jwksRequestTimeoutMilliseconds: number;
  jwksUri: string;
  maximumIdTokenLength: number;
  [auth0OidcVerifierConfigBrand]: true;
}>;

const requireBoundedInteger = (
  value: unknown,
  key: string,
  defaultValue: number,
  minimum: number,
  maximum: number,
): number => {
  const candidate = value ?? defaultValue;
  if (
    typeof candidate !== "number" ||
    !Number.isSafeInteger(candidate) ||
    candidate < minimum ||
    candidate > maximum
  ) {
    throw new ConfigurationValidationError(key);
  }
  return candidate;
};

const requireAudience = (value: unknown): string => {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > 512 ||
    value !== value.trim()
  ) {
    throw new ConfigurationValidationError("audience");
  }
  return value;
};

const requireExactHttpsIssuer = (value: unknown): Readonly<{ issuer: string; jwksUri: string }> => {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > 2048 ||
    value !== value.trim()
  ) {
    throw new ConfigurationValidationError("issuer");
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new ConfigurationValidationError("issuer");
  }

  if (
    parsed.protocol !== "https:" ||
    parsed.hostname.length === 0 ||
    parsed.username.length > 0 ||
    parsed.password.length > 0 ||
    parsed.search.length > 0 ||
    parsed.hash.length > 0 ||
    !parsed.pathname.endsWith("/") ||
    parsed.toString() !== value
  ) {
    throw new ConfigurationValidationError("issuer");
  }

  return Object.freeze({
    issuer: value,
    jwksUri: new URL(".well-known/jwks.json", parsed).toString(),
  });
};

export const createAuth0OidcVerifierConfig = (
  input: Auth0OidcVerifierConfigInput,
): Auth0OidcVerifierConfig => {
  const endpoint = requireExactHttpsIssuer(input.issuer);
  return Object.freeze({
    allowedAlgorithms: Object.freeze(["RS256"] as const),
    audience: requireAudience(input.audience),
    clockToleranceSeconds: requireBoundedInteger(
      input.clockToleranceSeconds,
      "clockToleranceSeconds",
      5,
      0,
      60,
    ),
    issuer: endpoint.issuer,
    jwksCacheMaxAgeMilliseconds: requireBoundedInteger(
      input.jwksCacheMaxAgeMilliseconds,
      "jwksCacheMaxAgeMilliseconds",
      600_000,
      60_000,
      86_400_000,
    ),
    jwksCooldownMilliseconds: requireBoundedInteger(
      input.jwksCooldownMilliseconds,
      "jwksCooldownMilliseconds",
      30_000,
      1_000,
      300_000,
    ),
    jwksRequestTimeoutMilliseconds: requireBoundedInteger(
      input.jwksRequestTimeoutMilliseconds,
      "jwksRequestTimeoutMilliseconds",
      5_000,
      250,
      10_000,
    ),
    jwksUri: endpoint.jwksUri,
    maximumIdTokenLength: 65_536,
    [auth0OidcVerifierConfigBrand]: true as const,
  });
};
