import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

const OPAQUE_SECRET_BYTES = 32;
const OPAQUE_SECRET_PATTERN = /^[A-Za-z0-9_-]{43}$/u;

export type SessionCredentialMaterial = Readonly<{
  csrfSecret: string;
  csrfSecretHash: Uint8Array;
  sessionId: string;
  sessionToken: string;
  sessionTokenHash: Uint8Array;
}>;

export interface SessionCredentialFactory {
  issue(now: Date): SessionCredentialMaterial;
}

type RandomBytesSource = (size: number) => Uint8Array;

const encodeOpaqueSecret = (bytes: Uint8Array): string => Buffer.from(bytes).toString("base64url");

const decodeOpaqueSecret = (value: string): Uint8Array | undefined => {
  if (!OPAQUE_SECRET_PATTERN.test(value)) {
    return undefined;
  }
  const decoded = Buffer.from(value, "base64url");
  return decoded.length === OPAQUE_SECRET_BYTES && decoded.toString("base64url") === value
    ? decoded
    : undefined;
};

const digestBytes = (value: Uint8Array): Uint8Array => createHash("sha256").update(value).digest();

const createUuidV7 = (now: Date, random: Uint8Array): string => {
  if (!Number.isSafeInteger(now.getTime()) || now.getTime() < 0 || random.length !== 10) {
    throw new TypeError("Cannot create session identifier");
  }

  const bytes = new Uint8Array(16);
  let timestamp = BigInt(now.getTime());
  for (let index = 5; index >= 0; index -= 1) {
    bytes[index] = Number(timestamp & 0xffn);
    timestamp >>= 8n;
  }
  bytes[6] = 0x70 | (random[0]! & 0x0f);
  bytes[7] = random[1]!;
  bytes[8] = 0x80 | (random[2]! & 0x3f);
  bytes.set(random.subarray(3), 9);

  const hex = Buffer.from(bytes).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

export const hashSessionToken = (sessionToken: string): Uint8Array | undefined => {
  const decoded = decodeOpaqueSecret(sessionToken);
  return decoded === undefined ? undefined : digestBytes(decoded);
};

export const verifyCsrfSecret = (csrfSecret: string, expectedHash: Uint8Array): boolean => {
  const decoded = decodeOpaqueSecret(csrfSecret);
  if (decoded === undefined) {
    return false;
  }
  const actualHash = digestBytes(decoded);
  return (
    actualHash.length === expectedHash.length &&
    timingSafeEqual(Buffer.from(actualHash), Buffer.from(expectedHash))
  );
};

export const createSessionCredentialFactory = (): SessionCredentialFactory =>
  createSessionCredentialFactoryWithRandomness((size) => randomBytes(size));

/** Test seam. Production callers must use createSessionCredentialFactory. */
export const createSessionCredentialFactoryWithRandomness = (
  random: RandomBytesSource,
): SessionCredentialFactory =>
  Object.freeze({
    issue: (now: Date): SessionCredentialMaterial => {
      const sessionTokenBytes = random(OPAQUE_SECRET_BYTES);
      const csrfSecretBytes = random(OPAQUE_SECRET_BYTES);
      const identifierBytes = random(10);
      if (
        sessionTokenBytes.length !== OPAQUE_SECRET_BYTES ||
        csrfSecretBytes.length !== OPAQUE_SECRET_BYTES ||
        identifierBytes.length !== 10
      ) {
        throw new TypeError("Randomness source returned an invalid byte count");
      }
      const sessionToken = encodeOpaqueSecret(sessionTokenBytes);
      const csrfSecret = encodeOpaqueSecret(csrfSecretBytes);
      return Object.freeze({
        csrfSecret,
        csrfSecretHash: digestBytes(csrfSecretBytes),
        sessionId: createUuidV7(now, identifierBytes),
        sessionToken,
        sessionTokenHash: digestBytes(sessionTokenBytes),
      });
    },
  });
