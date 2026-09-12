import { createHash } from "node:crypto";

import { verifyCsrfSecret } from "../session/credentials.js";
import { BrowserCsrfInvalidError, BrowserOriginNotAllowedError } from "./errors.js";

export const BROWSER_AUTH_POLICY = Object.freeze({
  invitationProofLifetimeMilliseconds: 10 * 60 * 1_000,
  loginTransactionLifetimeMilliseconds: 10 * 60 * 1_000,
  normalLoginMaximumAgeSeconds: 12 * 60 * 60,
  stepUpMaximumAgeSeconds: 15 * 60,
});

export const BROWSER_AUTH_COOKIE_NAMES = Object.freeze({
  csrf: "__Host-lead-csrf",
  invitationProof: "__Host-lead-invitation-proof",
  loginTransaction: "__Host-lead-auth-transaction",
  session: "__Host-lead-session",
});

const CONTROL_OR_BACKSLASH_PATTERN = /[\u0000-\u001f\u007f\\]/u;
const SCHEME_PATTERN = /^[A-Za-z][A-Za-z0-9+.-]*:/u;

export const resolveSafeReturnPath = (value: unknown, fallback = "/"): string => {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > 2_048 ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("#") ||
    CONTROL_OR_BACKSLASH_PATTERN.test(value) ||
    SCHEME_PATTERN.test(value)
  ) {
    return fallback;
  }
  let decoded = value;
  try {
    for (let index = 0; index < 2; index += 1) decoded = decodeURIComponent(decoded);
  } catch {
    return fallback;
  }
  if (
    !decoded.startsWith("/") ||
    decoded.startsWith("//") ||
    CONTROL_OR_BACKSLASH_PATTERN.test(decoded) ||
    SCHEME_PATTERN.test(decoded)
  ) {
    return fallback;
  }
  try {
    const parsed = new URL(value, "https://staff.invalid");
    const normalized = parsed.pathname + parsed.search;
    return parsed.origin === "https://staff.invalid" &&
      normalized.startsWith("/") &&
      !normalized.startsWith("//") &&
      !CONTROL_OR_BACKSLASH_PATTERN.test(normalized)
      ? normalized
      : fallback;
  } catch {
    return fallback;
  }
};

export const requireTrustedStaffOrigin = (
  origin: unknown,
  allowedOrigins: readonly string[],
): string => {
  if (typeof origin !== "string" || origin.length > 2_048 || origin === "null") {
    throw new BrowserOriginNotAllowedError();
  }
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    throw new BrowserOriginNotAllowedError();
  }
  if (
    parsed.origin !== origin ||
    parsed.pathname !== "/" ||
    parsed.search.length > 0 ||
    parsed.hash.length > 0 ||
    !allowedOrigins.includes(parsed.origin)
  ) {
    throw new BrowserOriginNotAllowedError();
  }
  return parsed.origin;
};

export const requireAcceptableFetchMetadata = (site: unknown): void => {
  if (site !== undefined && site !== "same-origin" && site !== "same-site") {
    throw new BrowserCsrfInvalidError();
  }
};

const hashOpaqueSecret = (secret: string): Uint8Array => {
  if (!/^[A-Za-z0-9_-]{43}$/u.test(secret)) throw new BrowserCsrfInvalidError();
  const bytes = Buffer.from(secret, "base64url");
  if (bytes.length !== 32 || bytes.toString("base64url") !== secret) {
    throw new BrowserCsrfInvalidError();
  }
  return createHash("sha256").update(bytes).digest();
};

export const requireSessionBoundCsrf = (
  headerSecret: unknown,
  cookieSecret: unknown,
  protectedSessionSecret: string,
): void => {
  if (typeof headerSecret !== "string" || typeof cookieSecret !== "string") {
    throw new BrowserCsrfInvalidError();
  }
  const expected = hashOpaqueSecret(protectedSessionSecret);
  if (!verifyCsrfSecret(headerSecret, expected) || !verifyCsrfSecret(cookieSecret, expected)) {
    throw new BrowserCsrfInvalidError();
  }
};

export const hasVerifiedMfaMethod = (authenticationMethods: readonly string[]): boolean =>
  authenticationMethods.includes("mfa");
