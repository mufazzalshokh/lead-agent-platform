import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";

const TARGET_VERSION = 1;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;
const TARGET_CONTEXT = Buffer.from("lead-agent:membership-invitation-target:v1", "utf8");

export type ProtectedInvitationTarget = Readonly<{
  canonicalTarget: string;
  ciphertext: Uint8Array;
  lookupHash: Uint8Array;
}>;

export interface InvitationTargetProtector {
  lookupHash(canonicalTarget: string): Uint8Array;
  protect(target: string): ProtectedInvitationTarget;
  reveal(ciphertext: Uint8Array): string;
}

export type InvitationTargetProtectionKeys = Readonly<{
  encryptionKey: Uint8Array;
  lookupKey: Uint8Array;
}>;

const requireKey = (value: Uint8Array, name: string): Buffer => {
  if (value.length !== KEY_BYTES) {
    throw new TypeError(`${name} must contain 32 bytes`);
  }
  return Buffer.from(value);
};

/**
 * Conservative email canonicalization: syntax is bounded, surrounding whitespace
 * is rejected, and only the DNS domain is case-folded. The local part is preserved
 * exactly; aliases, dots, Unicode forms, and provider-specific rules are never merged.
 */
export const canonicalizeInvitationEmailTarget = (value: string): string => {
  if (
    value !== value.trim() ||
    value.length < 3 ||
    value.length > 254 ||
    /[^\x21-\x7e]/u.test(value)
  ) {
    throw new TypeError("Invitation target is invalid");
  }
  const separator = value.lastIndexOf("@");
  if (separator < 1 || separator !== value.indexOf("@")) {
    throw new TypeError("Invitation target is invalid");
  }
  const local = value.slice(0, separator);
  const domain = value.slice(separator + 1);
  if (
    local.length > 64 ||
    domain.length > 253 ||
    local.startsWith(".") ||
    local.endsWith(".") ||
    local.includes("..") ||
    !/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+$/u.test(local)
  ) {
    throw new TypeError("Invitation target is invalid");
  }
  const labels = domain.split(".");
  if (
    labels.length < 2 ||
    labels.some(
      (label) =>
        label.length < 1 ||
        label.length > 63 ||
        label.startsWith("-") ||
        label.endsWith("-") ||
        !/^[A-Za-z0-9-]+$/u.test(label),
    )
  ) {
    throw new TypeError("Invitation target is invalid");
  }
  return `${local}@${domain.toLowerCase()}`;
};

export const createInvitationEmailTargetProtector = (
  keys: InvitationTargetProtectionKeys,
): InvitationTargetProtector => {
  const encryptionKey = requireKey(keys.encryptionKey, "encryptionKey");
  const lookupKey = requireKey(keys.lookupKey, "lookupKey");
  if (encryptionKey.equals(lookupKey)) {
    throw new TypeError("Invitation target keys must be purpose-separated");
  }

  const lookupHash = (canonicalTarget: string): Uint8Array =>
    createHmac("sha256", lookupKey).update(TARGET_CONTEXT).update(canonicalTarget, "utf8").digest();

  return Object.freeze({
    lookupHash,
    protect: (target: string): ProtectedInvitationTarget => {
      const canonicalTarget = canonicalizeInvitationEmailTarget(target);
      const nonce = randomBytes(NONCE_BYTES);
      const cipher = createCipheriv("aes-256-gcm", encryptionKey, nonce);
      cipher.setAAD(TARGET_CONTEXT);
      const encrypted = Buffer.concat([cipher.update(canonicalTarget, "utf8"), cipher.final()]);
      const ciphertext = Buffer.concat([
        Buffer.from([TARGET_VERSION]),
        nonce,
        cipher.getAuthTag(),
        encrypted,
      ]);
      return Object.freeze({
        canonicalTarget,
        ciphertext,
        lookupHash: lookupHash(canonicalTarget),
      });
    },
    reveal: (ciphertext: Uint8Array): string => {
      if (ciphertext.length <= 1 + NONCE_BYTES + TAG_BYTES || ciphertext[0] !== TARGET_VERSION) {
        throw new TypeError("Protected invitation target is invalid");
      }
      const bytes = Buffer.from(ciphertext);
      const nonce = bytes.subarray(1, 1 + NONCE_BYTES);
      const tag = bytes.subarray(1 + NONCE_BYTES, 1 + NONCE_BYTES + TAG_BYTES);
      const encrypted = bytes.subarray(1 + NONCE_BYTES + TAG_BYTES);
      try {
        const decipher = createDecipheriv("aes-256-gcm", encryptionKey, nonce);
        decipher.setAAD(TARGET_CONTEXT);
        decipher.setAuthTag(tag);
        const target = Buffer.concat([decipher.update(encrypted), decipher.final()]).toString(
          "utf8",
        );
        if (canonicalizeInvitationEmailTarget(target) !== target) {
          throw new TypeError("Protected invitation target is invalid");
        }
        return target;
      } catch (error) {
        if (
          error instanceof TypeError &&
          error.message === "Protected invitation target is invalid"
        ) {
          throw error;
        }
        throw new TypeError("Protected invitation target is invalid");
      }
    },
  });
};
