import { createHash, createHmac, randomBytes } from "node:crypto";

import {
  ChannelConnectionIdSchema,
  ConversationIdSchema,
  OrganizationIdSchema,
  ResourceIdSchema,
  isSchemaValue,
  type ChannelConnectionId,
  type ConversationId,
  type OrganizationId,
  type ResourceId,
} from "@lead-agent/contracts";
import type { WidgetSecurityConfig } from "@lead-agent/config";
import { SignJWT, jwtVerify } from "jose";

import { WidgetTokenInvalidError } from "./errors.js";
import { normalizeWidgetOrigin } from "./origin.js";

const TOKEN_VERSION = 1;
const TOKEN_SCOPE = "widget:conversation";
const JTI_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const MAXIMUM_TOKEN_LIFETIME_SECONDS = 2 * 60 * 60;

export type WidgetTokenClaims = Readonly<{
  channelConnectionId: ChannelConnectionId;
  conversationId: ConversationId | null;
  embeddingOrigin?: string;
  expiresAt: Date;
  issuedAt: Date;
  jti: string;
  organizationId: OrganizationId;
  origin: string;
  sessionId: ResourceId;
}>;

export type WidgetTokenService = Readonly<{
  createJti(): string;
  deriveBoundJti(sessionId: ResourceId, idempotencyKey: string): string;
  hashJti(jti: string): Uint8Array;
  issue(claims: WidgetTokenClaims): Promise<string>;
  verify(token: string, now: Date): Promise<WidgetTokenClaims>;
}>;

const isString = (value: unknown, minimum: number, maximum: number): value is string =>
  typeof value === "string" && value.length >= minimum && value.length <= maximum;

export const createWidgetTokenService = (config: WidgetSecurityConfig): WidgetTokenService => {
  const key = new Uint8Array(config.signingKey);
  return Object.freeze({
    createJti: () => randomBytes(32).toString("base64url"),
    deriveBoundJti: (sessionId, idempotencyKey) =>
      createHmac("sha256", key)
        .update("lead-agent:widget:bound-jti:v1\0" + sessionId + "\0" + idempotencyKey)
        .digest("base64url"),
    hashJti: (jti) => {
      if (!JTI_PATTERN.test(jti)) throw new WidgetTokenInvalidError();
      return createHash("sha256").update(jti, "utf8").digest();
    },
    issue: async (claims) =>
      await new SignJWT({
        channel_connection_id: claims.channelConnectionId,
        conversation_id: claims.conversationId,
        ...(claims.embeddingOrigin === undefined
          ? {}
          : { embedding_origin: claims.embeddingOrigin }),
        organization_id: claims.organizationId,
        origin: claims.origin,
        scope: TOKEN_SCOPE,
        version: TOKEN_VERSION,
      })
        .setProtectedHeader({ alg: "HS256", typ: "JWT" })
        .setIssuer(config.issuer)
        .setAudience(config.audience)
        .setSubject(claims.sessionId)
        .setJti(claims.jti)
        .setIssuedAt(Math.floor(claims.issuedAt.getTime() / 1_000))
        .setExpirationTime(Math.floor(claims.expiresAt.getTime() / 1_000))
        .sign(key),
    verify: async (token, now) => {
      try {
        if (!isString(token, 80, 4_096)) throw new WidgetTokenInvalidError();
        const verified = await jwtVerify(token, key, {
          algorithms: ["HS256"],
          audience: config.audience,
          currentDate: now,
          issuer: config.issuer,
          typ: "JWT",
        });
        const payload = verified.payload;
        const protectedHeader = verified.protectedHeader;
        const issuedAt = payload.iat;
        const expiresAt = payload.exp;
        const allowed = new Set([
          "aud",
          "channel_connection_id",
          "conversation_id",
          "embedding_origin",
          "exp",
          "iat",
          "iss",
          "jti",
          "organization_id",
          "origin",
          "scope",
          "sub",
          "version",
        ]);
        if (
          Object.keys(payload).some((name) => !allowed.has(name)) ||
          Object.keys(protectedHeader).some((name) => name !== "alg" && name !== "typ")
        )
          throw new WidgetTokenInvalidError();
        if (
          !isSchemaValue(ResourceIdSchema, payload.sub) ||
          !isString(payload.jti, 43, 43) ||
          !JTI_PATTERN.test(payload.jti) ||
          !isSchemaValue(OrganizationIdSchema, payload["organization_id"]) ||
          !isSchemaValue(ChannelConnectionIdSchema, payload["channel_connection_id"]) ||
          !isString(payload["origin"], 9, 2_048) ||
          normalizeWidgetOrigin(payload["origin"]) !== payload["origin"] ||
          (payload["embedding_origin"] !== undefined &&
            (!isString(payload["embedding_origin"], 9, 2_048) ||
              normalizeWidgetOrigin(payload["embedding_origin"]) !==
                payload["embedding_origin"])) ||
          (payload["conversation_id"] !== null &&
            !isSchemaValue(ConversationIdSchema, payload["conversation_id"])) ||
          payload.iss !== config.issuer ||
          payload.aud !== config.audience ||
          payload["scope"] !== TOKEN_SCOPE ||
          payload["version"] !== TOKEN_VERSION ||
          typeof issuedAt !== "number" ||
          !Number.isSafeInteger(issuedAt) ||
          typeof expiresAt !== "number" ||
          !Number.isSafeInteger(expiresAt) ||
          issuedAt > Math.floor(now.getTime() / 1_000) ||
          expiresAt <= issuedAt ||
          expiresAt - issuedAt > MAXIMUM_TOKEN_LIFETIME_SECONDS ||
          now.getTime() >= expiresAt * 1_000
        )
          throw new WidgetTokenInvalidError();
        return Object.freeze({
          channelConnectionId: payload["channel_connection_id"],
          conversationId: payload["conversation_id"],
          ...(payload["embedding_origin"] === undefined
            ? {}
            : { embeddingOrigin: payload["embedding_origin"] }),
          expiresAt: new Date(expiresAt * 1_000),
          issuedAt: new Date(issuedAt * 1_000),
          jti: payload.jti,
          organizationId: payload["organization_id"],
          origin: payload["origin"],
          sessionId: payload.sub,
        });
      } catch (error) {
        if (error instanceof WidgetTokenInvalidError) throw error;
        throw new WidgetTokenInvalidError();
      }
    },
  });
};
