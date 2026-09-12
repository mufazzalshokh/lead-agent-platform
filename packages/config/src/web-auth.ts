import { URL } from "node:url";

import { ConfigurationValidationError } from "./database.js";

const webAuthConfigBrand: unique symbol = Symbol("StaffWebAuthConfig");
const BASE64URL_KEY_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const CALLBACK_PATH = "/v1/staff/auth/callback";

export type ApplicationEnvironment = "development" | "production" | "test";

export type StaffWebAuthConfigInput = Readonly<{
  browserEnvelopeKey: unknown;
  callbackUri: unknown;
  clientId: unknown;
  clientSecret: unknown;
  environment: unknown;
  invitationTargetEncryptionKey: unknown;
  invitationTargetLookupKey: unknown;
  requireMfa: unknown;
  staffAllowedOrigins: unknown;
  staffApplicationOrigin: unknown;
  issuer: unknown;
}>;

export type StaffWebAuthConfig = Readonly<{
  authorizationEndpoint: string;
  browserEnvelopeKey: Uint8Array;
  callbackUri: string;
  clientId: string;
  clientSecret: string;
  environment: ApplicationEnvironment;
  invitationTargetEncryptionKey: Uint8Array;
  invitationTargetLookupKey: Uint8Array;
  issuer: string;
  requireMfa: boolean;
  staffAllowedOrigins: readonly string[];
  staffApplicationOrigin: string;
  tokenEndpoint: string;
  [webAuthConfigBrand]: true;
}>;

const requireString = (value: unknown, key: string, maximumLength: number): string => {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > maximumLength ||
    value !== value.trim()
  ) {
    throw new ConfigurationValidationError(key);
  }
  return value;
};

const requireEnvironment = (value: unknown): ApplicationEnvironment => {
  if (value !== "development" && value !== "test" && value !== "production") {
    throw new ConfigurationValidationError("environment");
  }
  return value;
};

const isLoopbackHostname = (hostname: string): boolean =>
  hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";

const requireHttpsOrLocalUrl = (
  value: unknown,
  key: string,
  environment: ApplicationEnvironment,
): URL => {
  const raw = requireString(value, key, 2_048);
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new ConfigurationValidationError(key);
  }
  const localDevelopment =
    environment !== "production" &&
    parsed.protocol === "http:" &&
    isLoopbackHostname(parsed.hostname);
  if (
    (parsed.protocol !== "https:" && !localDevelopment) ||
    parsed.username.length > 0 ||
    parsed.password.length > 0
  ) {
    throw new ConfigurationValidationError(key);
  }
  return parsed;
};

const requireOrigin = (
  value: unknown,
  key: string,
  environment: ApplicationEnvironment,
): string => {
  const parsed = requireHttpsOrLocalUrl(value, key, environment);
  if (
    parsed.pathname !== "/" ||
    parsed.search.length > 0 ||
    parsed.hash.length > 0 ||
    parsed.origin === "null" ||
    parsed.toString() !== `${parsed.origin}/`
  ) {
    throw new ConfigurationValidationError(key);
  }
  return parsed.origin;
};

const requireIssuer = (value: unknown): string => {
  const raw = requireString(value, "issuer", 2_048);
  let parsed: URL;
  try {
    parsed = new URL(raw);
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
    parsed.toString() !== raw
  ) {
    throw new ConfigurationValidationError("issuer");
  }
  return raw;
};

const requireKey = (value: unknown, key: string): Uint8Array => {
  const encoded = requireString(value, key, 43);
  if (!BASE64URL_KEY_PATTERN.test(encoded)) throw new ConfigurationValidationError(key);
  const decoded = Buffer.from(encoded, "base64url");
  if (decoded.length !== 32 || decoded.toString("base64url") !== encoded) {
    throw new ConfigurationValidationError(key);
  }
  return decoded;
};

const requireOrigins = (value: unknown, environment: ApplicationEnvironment): readonly string[] => {
  if (!Array.isArray(value) || value.length < 1 || value.length > 20) {
    throw new ConfigurationValidationError("staffAllowedOrigins");
  }
  const origins = value.map((origin) => requireOrigin(origin, "staffAllowedOrigins", environment));
  if (new Set(origins).size !== origins.length) {
    throw new ConfigurationValidationError("staffAllowedOrigins");
  }
  return Object.freeze([...origins].sort());
};

export const createStaffWebAuthConfig = (input: StaffWebAuthConfigInput): StaffWebAuthConfig => {
  const environment = requireEnvironment(input.environment);
  const issuer = requireIssuer(input.issuer);
  const callback = requireHttpsOrLocalUrl(input.callbackUri, "callbackUri", environment);
  if (
    callback.pathname !== CALLBACK_PATH ||
    callback.search.length > 0 ||
    callback.hash.length > 0
  ) {
    throw new ConfigurationValidationError("callbackUri");
  }
  const staffApplicationOrigin = requireOrigin(
    input.staffApplicationOrigin,
    "staffApplicationOrigin",
    environment,
  );
  const staffAllowedOrigins = requireOrigins(input.staffAllowedOrigins, environment);
  if (!staffAllowedOrigins.includes(staffApplicationOrigin)) {
    throw new ConfigurationValidationError("staffAllowedOrigins");
  }
  if (
    typeof input.requireMfa !== "boolean" ||
    (environment === "production" && !input.requireMfa)
  ) {
    throw new ConfigurationValidationError("requireMfa");
  }
  const browserEnvelopeKey = requireKey(input.browserEnvelopeKey, "browserEnvelopeKey");
  const invitationTargetEncryptionKey = requireKey(
    input.invitationTargetEncryptionKey,
    "invitationTargetEncryptionKey",
  );
  const invitationTargetLookupKey = requireKey(
    input.invitationTargetLookupKey,
    "invitationTargetLookupKey",
  );
  if (
    Buffer.from(browserEnvelopeKey).equals(Buffer.from(invitationTargetEncryptionKey)) ||
    Buffer.from(browserEnvelopeKey).equals(Buffer.from(invitationTargetLookupKey)) ||
    Buffer.from(invitationTargetEncryptionKey).equals(Buffer.from(invitationTargetLookupKey))
  ) {
    throw new ConfigurationValidationError("purposeSeparatedKeys");
  }
  return Object.freeze({
    authorizationEndpoint: new URL("authorize", issuer).toString(),
    browserEnvelopeKey,
    callbackUri: callback.toString(),
    clientId: requireString(input.clientId, "clientId", 512),
    clientSecret: requireString(input.clientSecret, "clientSecret", 512),
    environment,
    invitationTargetEncryptionKey,
    invitationTargetLookupKey,
    issuer,
    requireMfa: input.requireMfa,
    staffAllowedOrigins,
    staffApplicationOrigin,
    tokenEndpoint: new URL("oauth/token", issuer).toString(),
    [webAuthConfigBrand]: true as const,
  });
};

const requiredEnvironmentValue = (
  environment: NodeJS.ProcessEnv,
  name: string,
): string | undefined => environment[name];

export const loadStaffWebAuthConfig = (environment: NodeJS.ProcessEnv): StaffWebAuthConfig =>
  createStaffWebAuthConfig({
    browserEnvelopeKey: requiredEnvironmentValue(environment, "AUTH_BROWSER_ENVELOPE_KEY"),
    callbackUri: requiredEnvironmentValue(environment, "AUTH0_CALLBACK_URI"),
    clientId: requiredEnvironmentValue(environment, "AUTH0_CLIENT_ID"),
    clientSecret: requiredEnvironmentValue(environment, "AUTH0_CLIENT_SECRET"),
    environment: requiredEnvironmentValue(environment, "APP_ENV"),
    invitationTargetEncryptionKey: requiredEnvironmentValue(
      environment,
      "INVITATION_TARGET_ENCRYPTION_KEY",
    ),
    invitationTargetLookupKey: requiredEnvironmentValue(
      environment,
      "INVITATION_TARGET_LOOKUP_KEY",
    ),
    issuer: requiredEnvironmentValue(environment, "AUTH0_ISSUER"),
    requireMfa: requiredEnvironmentValue(environment, "AUTH_PRODUCTION_MFA_REQUIRED") === "true",
    staffAllowedOrigins:
      requiredEnvironmentValue(environment, "STAFF_ALLOWED_ORIGINS")?.split(",") ?? [],
    staffApplicationOrigin: requiredEnvironmentValue(environment, "STAFF_APPLICATION_ORIGIN"),
  });
