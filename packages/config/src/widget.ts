import { ConfigurationValidationError } from "./database.js";

const BASE64URL_KEY_PATTERN = /^[A-Za-z0-9_-]{43}$/u;

export type WidgetSecurityConfig = Readonly<{
  audience: "lead-agent-widget";
  issuer: "lead-agent-widget";
  signingKey: Uint8Array;
}>;

const requireKey = (value: unknown): Uint8Array => {
  if (typeof value !== "string" || !BASE64URL_KEY_PATTERN.test(value)) {
    throw new ConfigurationValidationError("WIDGET_SIGNING_KEY");
  }
  const decoded = Buffer.from(value, "base64url");
  if (decoded.byteLength !== 32 || decoded.toString("base64url") !== value) {
    throw new ConfigurationValidationError("WIDGET_SIGNING_KEY");
  }
  return decoded;
};

export const createWidgetSecurityConfig = (
  signingKey: unknown,
  purposeSeparatedKeys: readonly unknown[] = [],
): WidgetSecurityConfig => {
  const key = requireKey(signingKey);
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
