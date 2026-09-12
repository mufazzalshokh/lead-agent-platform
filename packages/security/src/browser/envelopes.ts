import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

import {
  OrganizationIdSchema,
  UserIdSchema,
  UuidV7Schema,
  isSchemaValue,
  type OrganizationId,
  type UserId,
} from "@lead-agent/contracts";

import { restoreValidatedOidcIdentity, type ValidatedOidcIdentity } from "../identity/contracts.js";
import { canonicalizeInvitationEmailTarget } from "../membership/target.js";
import { BrowserAuthenticationTokenInvalidError } from "./errors.js";
import { BROWSER_AUTH_POLICY, resolveSafeReturnPath } from "./policy.js";

const VERSION = 1;
const KEY_BYTES = 32;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const OPAQUE_PATTERN = /^[A-Za-z0-9_-]{43,128}$/u;
const OPAQUE_SECRET_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const AUTHENTICATION_LEVEL_PATTERN = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/u;

export type BrowserAuthTransactionPurpose = "invitation" | "login" | "step_up";

export type BrowserAuthTransaction = Readonly<{
  codeVerifier: string;
  expiresAt: Date;
  expectedSessionId?: string;
  expectedUserId?: UserId;
  invitationOrganizationId?: OrganizationId;
  invitationTokenHash?: string;
  issuedAt: Date;
  maximumAgeSeconds: number;
  nonce: string;
  purpose: BrowserAuthTransactionPurpose;
  returnPath: string;
  state: string;
}>;

export type BrowserSessionCredential = Readonly<{
  csrfSecret: string;
  expiresAt: Date;
  sessionToken: string;
}>;

export type BrowserInvitationProof = Readonly<{
  authenticationLevel: string;
  authenticationTime: Date;
  expiresAt: Date;
  identity: ValidatedOidcIdentity;
  invitationOrganizationId: OrganizationId;
  invitationTokenHash: string;
  issuedAt: Date;
  verifiedEmailTarget: string;
}>;

export interface BrowserAuthEnvelopeProtector {
  openInvitationProof(value: string, now: Date): BrowserInvitationProof;
  openSession(value: string, now: Date): BrowserSessionCredential;
  openTransaction(value: string, now: Date): BrowserAuthTransaction;
  sealInvitationProof(value: BrowserInvitationProof): string;
  sealSession(value: BrowserSessionCredential): string;
  sealTransaction(value: BrowserAuthTransaction): string;
}

type RandomSource = (size: number) => Uint8Array;
type JsonRecord = Readonly<Record<string, unknown>>;

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const requireDate = (value: unknown): Date => {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new BrowserAuthenticationTokenInvalidError();
  }
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new BrowserAuthenticationTokenInvalidError();
  return date;
};

const requireOpaque = (value: unknown, secret = false): string => {
  const pattern = secret ? OPAQUE_SECRET_PATTERN : OPAQUE_PATTERN;
  if (typeof value !== "string" || !pattern.test(value)) {
    throw new BrowserAuthenticationTokenInvalidError();
  }
  return value;
};

const requireFutureExpiry = (expiresAt: Date, issuedAt: Date, now: Date, maximum: number): void => {
  const lifetime = expiresAt.getTime() - issuedAt.getTime();
  if (
    lifetime < 1 ||
    lifetime > maximum ||
    now.getTime() < issuedAt.getTime() - 60_000 ||
    now.getTime() >= expiresAt.getTime()
  ) {
    throw new BrowserAuthenticationTokenInvalidError();
  }
};

const encodeTransaction = (value: BrowserAuthTransaction): JsonRecord => ({
  codeVerifier: value.codeVerifier,
  expiresAt: value.expiresAt.getTime(),
  ...(value.expectedSessionId === undefined ? {} : { expectedSessionId: value.expectedSessionId }),
  ...(value.expectedUserId === undefined ? {} : { expectedUserId: value.expectedUserId }),
  ...(value.invitationTokenHash === undefined
    ? {}
    : { invitationTokenHash: value.invitationTokenHash }),
  ...(value.invitationOrganizationId === undefined
    ? {}
    : { invitationOrganizationId: value.invitationOrganizationId }),
  issuedAt: value.issuedAt.getTime(),
  maximumAgeSeconds: value.maximumAgeSeconds,
  nonce: value.nonce,
  purpose: value.purpose,
  returnPath: value.returnPath,
  state: value.state,
});

const decodeTransaction = (value: unknown, now: Date): BrowserAuthTransaction => {
  if (!isRecord(value)) throw new BrowserAuthenticationTokenInvalidError();
  const purpose = value["purpose"];
  if (purpose !== "login" && purpose !== "step_up" && purpose !== "invitation") {
    throw new BrowserAuthenticationTokenInvalidError();
  }
  const issuedAt = requireDate(value["issuedAt"]);
  const expiresAt = requireDate(value["expiresAt"]);
  requireFutureExpiry(
    expiresAt,
    issuedAt,
    now,
    BROWSER_AUTH_POLICY.loginTransactionLifetimeMilliseconds,
  );
  const maximumAgeSeconds = value["maximumAgeSeconds"];
  if (
    typeof maximumAgeSeconds !== "number" ||
    !Number.isSafeInteger(maximumAgeSeconds) ||
    maximumAgeSeconds < 0 ||
    maximumAgeSeconds > BROWSER_AUTH_POLICY.normalLoginMaximumAgeSeconds
  ) {
    throw new BrowserAuthenticationTokenInvalidError();
  }
  const expectedUserId = value["expectedUserId"];
  const expectedSessionId = value["expectedSessionId"];
  const invitationTokenHash = value["invitationTokenHash"];
  const invitationOrganizationId = value["invitationOrganizationId"];
  const validStepUp =
    purpose === "step_up" &&
    isSchemaValue(UserIdSchema, expectedUserId) &&
    isSchemaValue(UuidV7Schema, expectedSessionId) &&
    maximumAgeSeconds === BROWSER_AUTH_POLICY.stepUpMaximumAgeSeconds;
  const validInvitation =
    purpose === "invitation" &&
    isSchemaValue(OrganizationIdSchema, invitationOrganizationId) &&
    typeof invitationTokenHash === "string" &&
    OPAQUE_SECRET_PATTERN.test(invitationTokenHash);
  if (
    (purpose === "step_up" && !validStepUp) ||
    (purpose !== "step_up" && (expectedUserId !== undefined || expectedSessionId !== undefined)) ||
    (purpose === "invitation" && !validInvitation) ||
    (purpose !== "invitation" &&
      (invitationTokenHash !== undefined || invitationOrganizationId !== undefined))
  ) {
    throw new BrowserAuthenticationTokenInvalidError();
  }
  const base: Readonly<{
    codeVerifier: string;
    expiresAt: Date;
    issuedAt: Date;
    maximumAgeSeconds: number;
    nonce: string;
    purpose: BrowserAuthTransactionPurpose;
    returnPath: string;
    state: string;
  }> = {
    codeVerifier: requireOpaque(value["codeVerifier"]),
    expiresAt,
    issuedAt,
    maximumAgeSeconds,
    nonce: requireOpaque(value["nonce"]),
    purpose,
    returnPath: resolveSafeReturnPath(value["returnPath"]),
    state: requireOpaque(value["state"]),
  };
  if (validStepUp) {
    return Object.freeze({ ...base, expectedSessionId, expectedUserId });
  }
  if (validInvitation) {
    return Object.freeze({ ...base, invitationOrganizationId, invitationTokenHash });
  }
  return Object.freeze(base);
};

const encodeSession = (value: BrowserSessionCredential): JsonRecord => ({
  csrfSecret: value.csrfSecret,
  expiresAt: value.expiresAt.getTime(),
  sessionToken: value.sessionToken,
});

const decodeSession = (value: unknown, now: Date): BrowserSessionCredential => {
  if (!isRecord(value)) throw new BrowserAuthenticationTokenInvalidError();
  const expiresAt = requireDate(value["expiresAt"]);
  if (now.getTime() >= expiresAt.getTime()) throw new BrowserAuthenticationTokenInvalidError();
  return Object.freeze({
    csrfSecret: requireOpaque(value["csrfSecret"], true),
    expiresAt,
    sessionToken: requireOpaque(value["sessionToken"], true),
  });
};

const encodeInvitationProof = (value: BrowserInvitationProof): JsonRecord => ({
  authenticationLevel: value.authenticationLevel,
  authenticationTime: value.authenticationTime.getTime(),
  expiresAt: value.expiresAt.getTime(),
  issuer: value.identity.issuer,
  invitationOrganizationId: value.invitationOrganizationId,
  invitationTokenHash: value.invitationTokenHash,
  issuedAt: value.issuedAt.getTime(),
  subject: value.identity.subject,
  verifiedEmailTarget: value.verifiedEmailTarget,
});

const decodeInvitationProof = (value: unknown, now: Date): BrowserInvitationProof => {
  if (!isRecord(value)) throw new BrowserAuthenticationTokenInvalidError();
  const issuedAt = requireDate(value["issuedAt"]);
  const expiresAt = requireDate(value["expiresAt"]);
  const authenticationTime = requireDate(value["authenticationTime"]);
  requireFutureExpiry(
    expiresAt,
    issuedAt,
    now,
    BROWSER_AUTH_POLICY.invitationProofLifetimeMilliseconds,
  );
  if (
    authenticationTime.getTime() > now.getTime() ||
    typeof value["authenticationLevel"] !== "string" ||
    !AUTHENTICATION_LEVEL_PATTERN.test(value["authenticationLevel"]) ||
    value["authenticationLevel"].length > 32 ||
    typeof value["issuer"] !== "string" ||
    typeof value["subject"] !== "string" ||
    typeof value["verifiedEmailTarget"] !== "string"
  ) {
    throw new BrowserAuthenticationTokenInvalidError();
  }
  let verifiedEmailTarget: string;
  try {
    verifiedEmailTarget = canonicalizeInvitationEmailTarget(value["verifiedEmailTarget"]);
  } catch {
    throw new BrowserAuthenticationTokenInvalidError();
  }
  if (verifiedEmailTarget !== value["verifiedEmailTarget"]) {
    throw new BrowserAuthenticationTokenInvalidError();
  }
  const invitationOrganizationId = value["invitationOrganizationId"];
  if (!isSchemaValue(OrganizationIdSchema, invitationOrganizationId)) {
    throw new BrowserAuthenticationTokenInvalidError();
  }
  return Object.freeze({
    authenticationLevel: value["authenticationLevel"],
    authenticationTime,
    expiresAt,
    identity: restoreValidatedOidcIdentity({
      issuer: value["issuer"],
      subject: value["subject"],
    }),
    invitationOrganizationId,
    invitationTokenHash: requireOpaque(value["invitationTokenHash"], true),
    issuedAt,
    verifiedEmailTarget,
  });
};

const requireKey = (value: Uint8Array): Buffer => {
  if (value.length !== KEY_BYTES) throw new TypeError("Browser envelope key must contain 32 bytes");
  return Buffer.from(value);
};

export const createBrowserAuthEnvelopeProtector = (
  keyValue: Uint8Array,
  options: Readonly<{ random?: RandomSource }> = {},
): BrowserAuthEnvelopeProtector => {
  const key = requireKey(keyValue);
  const random = options.random ?? ((size: number) => randomBytes(size));
  const seal = (purpose: string, value: JsonRecord): string => {
    const nonce = Buffer.from(random(NONCE_BYTES));
    if (nonce.length !== NONCE_BYTES) {
      throw new TypeError("Randomness source returned invalid data");
    }
    const cipher = createCipheriv("aes-256-gcm", key, nonce);
    cipher.setAAD(Buffer.from("lead-agent:browser:" + purpose + ":v1", "utf8"));
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(value), "utf8"),
      cipher.final(),
    ]);
    return Buffer.concat([Buffer.from([VERSION]), nonce, cipher.getAuthTag(), ciphertext]).toString(
      "base64url",
    );
  };
  const open = (purpose: string, value: string): unknown => {
    if (typeof value !== "string" || value.length < 40 || value.length > 8_192) {
      throw new BrowserAuthenticationTokenInvalidError();
    }
    const bytes = Buffer.from(value, "base64url");
    if (
      bytes.toString("base64url") !== value ||
      bytes.length <= 1 + NONCE_BYTES + TAG_BYTES ||
      bytes[0] !== VERSION
    ) {
      throw new BrowserAuthenticationTokenInvalidError();
    }
    try {
      const nonce = bytes.subarray(1, 1 + NONCE_BYTES);
      const tag = bytes.subarray(1 + NONCE_BYTES, 1 + NONCE_BYTES + TAG_BYTES);
      const ciphertext = bytes.subarray(1 + NONCE_BYTES + TAG_BYTES);
      const decipher = createDecipheriv("aes-256-gcm", key, nonce);
      decipher.setAAD(Buffer.from("lead-agent:browser:" + purpose + ":v1", "utf8"));
      decipher.setAuthTag(tag);
      const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString(
        "utf8",
      );
      return JSON.parse(plaintext) as unknown;
    } catch {
      throw new BrowserAuthenticationTokenInvalidError();
    }
  };
  const protector: BrowserAuthEnvelopeProtector = {
    openInvitationProof: (value, now) => decodeInvitationProof(open("invitation", value), now),
    openSession: (value, now) => decodeSession(open("session", value), now),
    openTransaction: (value, now) => decodeTransaction(open("transaction", value), now),
    sealInvitationProof: (value) => seal("invitation", encodeInvitationProof(value)),
    sealSession: (value) => seal("session", encodeSession(value)),
    sealTransaction: (value) => seal("transaction", encodeTransaction(value)),
  };
  return Object.freeze(protector);
};
