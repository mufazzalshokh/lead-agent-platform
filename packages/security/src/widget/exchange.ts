import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

import type { WidgetEmbedConfig } from "@lead-agent/config";
import {
  ChannelConnectionIdSchema,
  OrganizationIdSchema,
  ResourceIdSchema,
  isSchemaValue,
  type ChannelConnectionId,
  type OrganizationId,
  type ResourceId,
} from "@lead-agent/contracts";

import { WidgetTokenInvalidError } from "./errors.js";
import { normalizeWidgetOrigin } from "./origin.js";

const GRANT_PREFIX = "wex1";
const JTI_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const MAXIMUM_GRANT_LIFETIME_MS = 60_000;
const ADDITIONAL_DATA = Buffer.from("lead-agent:widget-exchange:v1", "utf8");

export type WidgetExchangeGrantClaims = Readonly<{
  channelConnectionId: ChannelConnectionId;
  embeddingOrigin: string;
  expiresAt: Date;
  issuedAt: Date;
  jti: string;
  organizationId: OrganizationId;
  sessionId: ResourceId;
}>;

export type WidgetExchangeGrantService = Readonly<{
  createJti(): string;
  issue(claims: WidgetExchangeGrantClaims): string;
  open(grant: string, now: Date): WidgetExchangeGrantClaims;
}>;

type SerializedGrant = Readonly<{
  channel_connection_id: unknown;
  embedding_origin: unknown;
  expires_at: unknown;
  issued_at: unknown;
  jti: unknown;
  organization_id: unknown;
  session_id: unknown;
  version: unknown;
}>;

const serialize = (claims: WidgetExchangeGrantClaims): Buffer =>
  Buffer.from(
    JSON.stringify({
      channel_connection_id: claims.channelConnectionId,
      embedding_origin: claims.embeddingOrigin,
      expires_at: claims.expiresAt.getTime(),
      issued_at: claims.issuedAt.getTime(),
      jti: claims.jti,
      organization_id: claims.organizationId,
      session_id: claims.sessionId,
      version: 1,
    }),
    "utf8",
  );

const deserialize = (value: Buffer, now: Date): WidgetExchangeGrantClaims => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value.toString("utf8"));
  } catch {
    throw new WidgetTokenInvalidError();
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new WidgetTokenInvalidError();
  }
  const record = parsed as SerializedGrant;
  const keys = Object.keys(record).sort();
  const expected = [
    "channel_connection_id",
    "embedding_origin",
    "expires_at",
    "issued_at",
    "jti",
    "organization_id",
    "session_id",
    "version",
  ];
  if (
    keys.length !== expected.length ||
    keys.some((key, index) => key !== expected[index]) ||
    record.version !== 1 ||
    !isSchemaValue(ChannelConnectionIdSchema, record.channel_connection_id) ||
    !isSchemaValue(OrganizationIdSchema, record.organization_id) ||
    !isSchemaValue(ResourceIdSchema, record.session_id) ||
    typeof record.jti !== "string" ||
    !JTI_PATTERN.test(record.jti) ||
    typeof record.embedding_origin !== "string" ||
    normalizeWidgetOrigin(record.embedding_origin) !== record.embedding_origin ||
    typeof record.issued_at !== "number" ||
    !Number.isSafeInteger(record.issued_at) ||
    typeof record.expires_at !== "number" ||
    !Number.isSafeInteger(record.expires_at) ||
    record.issued_at > now.getTime() ||
    record.expires_at <= record.issued_at ||
    record.expires_at - record.issued_at > MAXIMUM_GRANT_LIFETIME_MS ||
    now.getTime() >= record.expires_at
  ) {
    throw new WidgetTokenInvalidError();
  }
  return Object.freeze({
    channelConnectionId: record.channel_connection_id,
    embeddingOrigin: record.embedding_origin,
    expiresAt: new Date(record.expires_at),
    issuedAt: new Date(record.issued_at),
    jti: record.jti,
    organizationId: record.organization_id,
    sessionId: record.session_id,
  });
};

export const createWidgetExchangeGrantService = (
  config: WidgetEmbedConfig,
): WidgetExchangeGrantService => {
  const key = new Uint8Array(config.exchangeEncryptionKey);
  return Object.freeze({
    createJti: () => randomBytes(32).toString("base64url"),
    issue: (claims) => {
      if (
        claims.expiresAt.getTime() - claims.issuedAt.getTime() > MAXIMUM_GRANT_LIFETIME_MS ||
        claims.expiresAt <= claims.issuedAt ||
        !JTI_PATTERN.test(claims.jti) ||
        normalizeWidgetOrigin(claims.embeddingOrigin) !== claims.embeddingOrigin
      ) {
        throw new WidgetTokenInvalidError();
      }
      const nonce = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", key, nonce);
      cipher.setAAD(ADDITIONAL_DATA);
      const ciphertext = Buffer.concat([cipher.update(serialize(claims)), cipher.final()]);
      return [
        GRANT_PREFIX,
        nonce.toString("base64url"),
        ciphertext.toString("base64url"),
        cipher.getAuthTag().toString("base64url"),
      ].join(".");
    },
    open: (grant, now) => {
      try {
        if (typeof grant !== "string" || grant.length < 100 || grant.length > 2_048) {
          throw new WidgetTokenInvalidError();
        }
        const parts = grant.split(".");
        if (parts.length !== 4 || parts[0] !== GRANT_PREFIX) {
          throw new WidgetTokenInvalidError();
        }
        const nonce = Buffer.from(parts[1]!, "base64url");
        const ciphertext = Buffer.from(parts[2]!, "base64url");
        const tag = Buffer.from(parts[3]!, "base64url");
        if (nonce.length !== 12 || tag.length !== 16 || ciphertext.length === 0) {
          throw new WidgetTokenInvalidError();
        }
        const decipher = createDecipheriv("aes-256-gcm", key, nonce);
        decipher.setAAD(ADDITIONAL_DATA);
        decipher.setAuthTag(tag);
        return deserialize(Buffer.concat([decipher.update(ciphertext), decipher.final()]), now);
      } catch (error) {
        if (error instanceof WidgetTokenInvalidError) throw error;
        throw new WidgetTokenInvalidError();
      }
    },
  });
};
