import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

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

const JTI_PATTERN = /^[A-Za-z0-9_-]{43}$/u;

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

const deserialize = (
  value: Buffer,
  now: Date,
  maximumLifetime: number,
): WidgetExchangeGrantClaims => {
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
    !Number.isSafeInteger(now.getTime()) ||
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
    record.expires_at - record.issued_at > maximumLifetime ||
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

const createScopedGrantService = (
  config: WidgetEmbedConfig,
  profile: Readonly<{
    prefix: string;
    maximumLifetime: number;
    context: string;
    deriveKey: boolean;
  }>,
): WidgetExchangeGrantService => {
  const additionalData = Buffer.from(profile.context, "utf8");
  const key = profile.deriveKey
    ? new Uint8Array(
        hkdfSync("sha256", config.exchangeEncryptionKey, Buffer.alloc(0), additionalData, 32),
      )
    : new Uint8Array(config.exchangeEncryptionKey);
  return Object.freeze({
    createJti: () => randomBytes(32).toString("base64url"),
    issue: (claims) => {
      if (
        claims.expiresAt.getTime() - claims.issuedAt.getTime() > profile.maximumLifetime ||
        claims.expiresAt <= claims.issuedAt ||
        !JTI_PATTERN.test(claims.jti) ||
        normalizeWidgetOrigin(claims.embeddingOrigin) !== claims.embeddingOrigin
      ) {
        throw new WidgetTokenInvalidError();
      }
      deserialize(serialize(claims), claims.issuedAt, profile.maximumLifetime);
      const nonce = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", key, nonce);
      cipher.setAAD(additionalData);
      const ciphertext = Buffer.concat([cipher.update(serialize(claims)), cipher.final()]);
      return [
        profile.prefix,
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
        if (
          parts.length !== 4 ||
          parts[0] !== profile.prefix ||
          parts.slice(1).some((part) => !/^[A-Za-z0-9_-]+$/u.test(part))
        ) {
          throw new WidgetTokenInvalidError();
        }
        const nonce = Buffer.from(parts[1]!, "base64url");
        const ciphertext = Buffer.from(parts[2]!, "base64url");
        const tag = Buffer.from(parts[3]!, "base64url");
        if (nonce.length !== 12 || tag.length !== 16 || ciphertext.length === 0) {
          throw new WidgetTokenInvalidError();
        }
        const decipher = createDecipheriv("aes-256-gcm", key, nonce);
        decipher.setAAD(additionalData);
        decipher.setAuthTag(tag);
        return deserialize(
          Buffer.concat([decipher.update(ciphertext), decipher.final()]),
          now,
          profile.maximumLifetime,
        );
      } catch (error) {
        if (error instanceof WidgetTokenInvalidError) throw error;
        throw new WidgetTokenInvalidError();
      }
    },
  });
};

export const createWidgetExchangeGrantService = (
  config: WidgetEmbedConfig,
): WidgetExchangeGrantService =>
  createScopedGrantService(config, {
    prefix: "wex1",
    maximumLifetime: 60_000,
    context: "lead-agent:widget-exchange:v1",
    deriveKey: false,
  });

/** Independent key/AAD and finite lifetime; database consumption is mandatory. */
export const createWidgetRecoveryGrantService = (
  config: WidgetEmbedConfig,
): WidgetExchangeGrantService =>
  createScopedGrantService(config, {
    prefix: "wrc1",
    maximumLifetime: 86_400_000,
    context: "lead-agent:widget-recovery:v1",
    deriveKey: true,
  });
