import { ConfigurationValidationError } from "./database.js";

const BASE64URL_KEY_PATTERN = /^[A-Za-z0-9_-]{43}$/u;

const requireHttpsOrigin = (value: unknown, name: string): string => {
  if (typeof value !== "string") throw new ConfigurationValidationError(name);
  try {
    const parsed = new URL(value);
    if (
      parsed.protocol !== "https:" ||
      parsed.username !== "" ||
      parsed.password !== "" ||
      parsed.pathname !== "/" ||
      parsed.search !== "" ||
      parsed.hash !== ""
    )
      throw new ConfigurationValidationError(name);
    return parsed.origin;
  } catch (error) {
    if (error instanceof ConfigurationValidationError) throw error;
    throw new ConfigurationValidationError(name);
  }
};

export type WidgetSecurityConfig = Readonly<{
  audience: "lead-agent-widget";
  issuer: "lead-agent-widget";
  signingKey: Uint8Array;
}>;

export type WidgetEmbedConfig = Readonly<{
  exchangeEncryptionKey: Uint8Array;
  platformOrigin: string;
  publicApiOrigin: string;
}>;

const requireKey = (value: unknown, name: string): Uint8Array => {
  if (typeof value !== "string" || !BASE64URL_KEY_PATTERN.test(value)) {
    throw new ConfigurationValidationError(name);
  }
  const decoded = Buffer.from(value, "base64url");
  if (decoded.byteLength !== 32 || decoded.toString("base64url") !== value) {
    throw new ConfigurationValidationError(name);
  }
  return decoded;
};

export const createWidgetSecurityConfig = (
  signingKey: unknown,
  purposeSeparatedKeys: readonly unknown[] = [],
): WidgetSecurityConfig => {
  const key = requireKey(signingKey, "WIDGET_SIGNING_KEY");
  if (
    purposeSeparatedKeys.some(
      (candidate) =>
        typeof candidate === "string" &&
        BASE64URL_KEY_PATTERN.test(candidate) &&
        Buffer.from(candidate, "base64url").equals(Buffer.from(key)),
    )
  ) {
    throw new ConfigurationValidationError("WIDGET_SIGNING_KEY_PURPOSE_SEPARATION");
  }
  return Object.freeze({
    audience: "lead-agent-widget" as const,
    issuer: "lead-agent-widget" as const,
    signingKey: new Uint8Array(key),
  });
};

export const loadWidgetSecurityConfig = (environment: NodeJS.ProcessEnv): WidgetSecurityConfig =>
  createWidgetSecurityConfig(environment["WIDGET_SIGNING_KEY"], [
    environment["AUTH_BROWSER_ENVELOPE_KEY"],
    environment["INVITATION_TARGET_ENCRYPTION_KEY"],
    environment["INVITATION_TARGET_LOOKUP_KEY"],
    environment["CUSTOMER_DATA_ENCRYPTION_KEY"],
    environment["CUSTOMER_DATA_LOOKUP_KEY"],
  ]);

export const createWidgetEmbedConfig = (
  exchangeEncryptionKey: unknown,
  platformOrigin: unknown,
  publicApiOrigin: unknown,
  purposeSeparatedKeys: readonly unknown[] = [],
): WidgetEmbedConfig => {
  const key = requireKey(exchangeEncryptionKey, "WIDGET_EXCHANGE_ENCRYPTION_KEY");
  if (
    purposeSeparatedKeys.some(
      (candidate) =>
        typeof candidate === "string" &&
        BASE64URL_KEY_PATTERN.test(candidate) &&
        Buffer.from(candidate, "base64url").equals(Buffer.from(key)),
    )
  )
    throw new ConfigurationValidationError("WIDGET_EXCHANGE_KEY_PURPOSE_SEPARATION");
  return Object.freeze({
    exchangeEncryptionKey: new Uint8Array(key),
    platformOrigin: requireHttpsOrigin(platformOrigin, "WIDGET_PLATFORM_ORIGIN"),
    publicApiOrigin: requireHttpsOrigin(publicApiOrigin, "WIDGET_PUBLIC_API_ORIGIN"),
  });
};

export const loadWidgetEmbedConfig = (environment: NodeJS.ProcessEnv): WidgetEmbedConfig =>
  createWidgetEmbedConfig(
    environment["WIDGET_EXCHANGE_ENCRYPTION_KEY"],
    environment["WIDGET_PLATFORM_ORIGIN"],
    environment["WIDGET_PUBLIC_API_ORIGIN"],
    [
      environment["WIDGET_SIGNING_KEY"],
      environment["AUTH_BROWSER_ENVELOPE_KEY"],
      environment["INVITATION_TARGET_ENCRYPTION_KEY"],
      environment["INVITATION_TARGET_LOOKUP_KEY"],
      environment["CUSTOMER_DATA_ENCRYPTION_KEY"],
      environment["CUSTOMER_DATA_LOOKUP_KEY"],
    ],
  );
