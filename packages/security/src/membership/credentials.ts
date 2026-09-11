import { createHash, randomBytes } from "node:crypto";

import {
  MembershipIdSchema,
  ResourceIdSchema,
  UserIdSchema,
  isSchemaValue,
  type MembershipId,
  type ResourceId,
  type UserId,
} from "@lead-agent/contracts";

const INVITATION_SECRET_BYTES = 32;
const INVITATION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/u;

type RandomBytesSource = (size: number) => Uint8Array;

export type InvitationCredential = Readonly<{
  invitationId: ResourceId;
  token: string;
  tokenHash: Uint8Array;
}>;

export interface InvitationCredentialFactory {
  issue(now: Date): InvitationCredential;
}

export interface SecurityIdentifierFactory {
  issueMembershipId(now: Date): MembershipId;
  issueResourceId(now: Date): ResourceId;
  issueUserId(now: Date): UserId;
}

const createUuidV7 = (now: Date, random: Uint8Array): string => {
  if (!Number.isSafeInteger(now.getTime()) || now.getTime() < 0 || random.length !== 10) {
    throw new TypeError("Cannot create security identifier");
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
  const value = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  return value;
};

const digest = (bytes: Uint8Array): Uint8Array => createHash("sha256").update(bytes).digest();

export const hashInvitationToken = (token: string): Uint8Array | undefined => {
  if (!INVITATION_TOKEN_PATTERN.test(token)) {
    return undefined;
  }
  const decoded = Buffer.from(token, "base64url");
  return decoded.length === INVITATION_SECRET_BYTES && decoded.toString("base64url") === token
    ? digest(decoded)
    : undefined;
};

const createIdentifierFactory = (random: RandomBytesSource): SecurityIdentifierFactory => {
  const issue = (now: Date): string => createUuidV7(now, random(10));
  return Object.freeze({
    issueMembershipId: (now: Date): MembershipId => {
      const value = issue(now);
      if (!isSchemaValue(MembershipIdSchema, value))
        throw new TypeError("Cannot create membership identifier");
      return value;
    },
    issueResourceId: (now: Date): ResourceId => {
      const value = issue(now);
      if (!isSchemaValue(ResourceIdSchema, value))
        throw new TypeError("Cannot create resource identifier");
      return value;
    },
    issueUserId: (now: Date): UserId => {
      const value = issue(now);
      if (!isSchemaValue(UserIdSchema, value)) throw new TypeError("Cannot create user identifier");
      return value;
    },
  });
};

export const createSecurityIdentifierFactory = (): SecurityIdentifierFactory =>
  createIdentifierFactory((size) => randomBytes(size));

export const createInvitationCredentialFactory = (): InvitationCredentialFactory =>
  createInvitationCredentialFactoryWithRandomness((size) => randomBytes(size));

/** Test seam. Production callers must use createInvitationCredentialFactory. */
export const createInvitationCredentialFactoryWithRandomness = (
  random: RandomBytesSource,
): InvitationCredentialFactory => {
  const identifiers = createIdentifierFactory(random);
  return Object.freeze({
    issue: (now: Date): InvitationCredential => {
      const secret = random(INVITATION_SECRET_BYTES);
      if (secret.length !== INVITATION_SECRET_BYTES) {
        throw new TypeError("Randomness source returned an invalid byte count");
      }
      return Object.freeze({
        invitationId: identifiers.issueResourceId(now),
        token: Buffer.from(secret).toString("base64url"),
        tokenHash: digest(secret),
      });
    },
  });
};
