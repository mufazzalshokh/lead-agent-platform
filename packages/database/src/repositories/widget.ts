import { createHash } from "node:crypto";

import {
  WidgetConversationSchema,
  isSchemaValue,
  type ConversationId,
  type MessageId,
  type ResourceId,
  type WidgetConversation,
} from "@lead-agent/contracts";
import {
  WidgetApplicationError,
  type CanonicalInboundResult,
  type WidgetPersistenceStore,
  type WidgetProtectedMessageRecord,
  type WidgetSessionAuthority,
} from "@lead-agent/application";
import {
  WidgetOriginInvalidError,
  WidgetTokenInvalidError,
  createSecurityIdentifierFactory,
  widgetOriginMatches,
  type SecurityIdentifierFactory,
  type WidgetTokenClaims,
} from "@lead-agent/security";
import type { QueryResultRow } from "pg";

import type { TenantDatabaseRuntime, TenantDbSession } from "../runtime/tenant.js";
import { executeTenantQuery } from "../runtime/tenant.js";
import { createCanonicalInboundTenantSessionStore } from "./inbound-conversations.js";

const IDLE_LIFETIME_MS = 30 * 60 * 1_000;
const IDEMPOTENCY_LIFETIME_MS = 24 * 60 * 60 * 1_000;

type OriginRow = QueryResultRow & {
  id: string;
  match_type: "exact" | "subdomain_wildcard";
  normalized_host: string;
  port: number | null;
};
type SessionRow = QueryResultRow & {
  channel_connection_id: string;
  contact_id: string | null;
  conversation_id: string | null;
  expires_at: Date;
  issued_at: Date;
  last_seen_at: Date;
  organization_id: string;
  requested_locale: "en" | "ru" | "uz";
  session_token_jti_hash: Buffer;
  status: "active" | "expired" | "revoked";
  widget_allowed_origin_id: string;
};
type IdempotencyRow = QueryResultRow & { request_hash: Buffer; status: string };
type ConversationRow = QueryResultRow & {
  closed_at: Date | null;
  id: string;
  last_activity_at: Date;
  preferred_locale: "en" | "ru" | "uz";
  resolved_at: Date | null;
  started_at: Date;
  status: "open" | "awaiting_lead" | "awaiting_staff" | "resolved" | "closed";
};
type MessageRow = QueryResultRow & {
  body_ciphertext: Buffer | null;
  channel_connection_id: string;
  content_type: "attachment" | "quick_reply" | "text";
  conversation_id: string;
  created_at: Date;
  direction: "inbound" | "outbound";
  id: string;
  locale: "en" | "ru" | "uz" | null;
  redacted_at: Date | null;
  sequence_no: string;
};

const equal = (left: Uint8Array, right: Uint8Array): boolean =>
  Buffer.from(left).equals(Buffer.from(right));
const principalHash = (sessionId: ResourceId): Uint8Array =>
  createHash("sha256").update(sessionId, "utf8").digest();

const selectSession = async (
  session: TenantDbSession,
  sessionId: ResourceId,
  forUpdate = false,
): Promise<SessionRow | null> => {
  const result = await executeTenantQuery<SessionRow>(session, (organizationId) => ({
    text: `select organization_id::text, channel_connection_id::text,
                  widget_allowed_origin_id::text, session_token_jti_hash, status,
                  requested_locale, contact_id::text, conversation_id::text,
                  issued_at, last_seen_at, expires_at
             from widget_sessions
            where organization_id = $1 and id = $2${forUpdate ? " for update" : ""}`,
    values: [organizationId, sessionId],
  }));
  return result.rows[0] ?? null;
};

const originAllowed = async (
  session: TenantDbSession,
  channelConnectionId: string,
  origin: string,
  originId?: string,
): Promise<OriginRow | null> => {
  const result = await executeTenantQuery<OriginRow>(session, (organizationId) => ({
    text: `select wao.id::text, wao.match_type, wao.normalized_host, wao.port
             from widget_allowed_origins wao
             join channel_connections cc
               on cc.organization_id = $1 and cc.id = wao.channel_connection_id
            where wao.organization_id = $1 and wao.channel_connection_id = $2
              and wao.status = 'active' and cc.status = 'active' and cc.channel_type = 'widget'
              ${originId === undefined ? "" : "and wao.id = $3"}`,
    values:
      originId === undefined
        ? [organizationId, channelConnectionId]
        : [organizationId, channelConnectionId, originId],
  }));
  return (
    result.rows.find((row) =>
      widgetOriginMatches(origin, {
        matchType: row.match_type,
        normalizedHost: row.normalized_host,
        port: row.port,
        scheme: "https",
      }),
    ) ?? null
  );
};

const authorizeInSession = async (
  session: TenantDbSession,
  claims: WidgetTokenClaims,
  origin: string,
  now: Date,
  forUpdate = false,
): Promise<WidgetSessionAuthority | null> => {
  const row = await selectSession(session, claims.sessionId, forUpdate);
  if (
    row === null ||
    row.organization_id !== claims.organizationId ||
    row.channel_connection_id !== claims.channelConnectionId ||
    row.status !== "active" ||
    !equal(row.session_token_jti_hash, createHash("sha256").update(claims.jti).digest()) ||
    row.conversation_id !== claims.conversationId ||
    (await originAllowed(
      session,
      row.channel_connection_id,
      claims.embeddingOrigin ?? origin,
      row.widget_allowed_origin_id,
    )) === null
  )
    return null;
  if (
    now.getTime() >= row.expires_at.getTime() ||
    now.getTime() - row.last_seen_at.getTime() >= IDLE_LIFETIME_MS
  ) {
    await executeTenantQuery(session, (organizationId) => ({
      text: "update widget_sessions set status = 'expired', version = version + 1, updated_at = $3 where organization_id = $1 and id = $2 and status = 'active'",
      values: [organizationId, claims.sessionId, now],
    }));
    return null;
  }
  await executeTenantQuery(session, (organizationId) => ({
    text: "update widget_sessions set last_seen_at = greatest(last_seen_at, $3), version = version + 1, updated_at = greatest(updated_at, $3) where organization_id = $1 and id = $2",
    values: [organizationId, claims.sessionId, now],
  }));
  return Object.freeze({
    channelConnectionId: claims.channelConnectionId,
    contactId: row.contact_id,
    conversationId: row.conversation_id as ConversationId | null,
    expiresAt: row.expires_at,
    issuedAt: row.issued_at,
    lastSeenAt: now > row.last_seen_at ? now : row.last_seen_at,
    organizationId: claims.organizationId,
    requestedLocale: row.requested_locale,
    sessionId: claims.sessionId,
  });
};

const inspectIdempotency = async (
  session: TenantDbSession,
  scope: string,
  claims: WidgetTokenClaims,
  keyHash: Uint8Array,
  requestHash: Uint8Array,
): Promise<boolean> => {
  const key = Buffer.from(keyHash).toString("hex");
  await executeTenantQuery(session, () => ({
    text: "select pg_advisory_xact_lock(hashtextextended($1, 0))",
    values: [`widget:${claims.sessionId}:${scope}:${key}`],
  }));
  const existing = await executeTenantQuery<IdempotencyRow>(session, (organizationId) => ({
    text: `select request_hash, status from idempotency_keys
            where organization_id = $1 and principal_type = 'widget_session'
              and principal_id_hash = $2 and scope = $3 and key_hash = $4`,
    values: [
      organizationId,
      Buffer.from(principalHash(claims.sessionId)),
      scope,
      Buffer.from(keyHash),
    ],
  }));
  const row = existing.rows[0];
  if (row !== undefined) {
    if (!equal(row.request_hash, requestHash))
      throw new WidgetApplicationError("idempotency_conflict");
    return true;
  }
  return false;
};

const persistIdempotency = async (
  session: TenantDbSession,
  scope: string,
  claims: WidgetTokenClaims,
  keyHash: Uint8Array,
  requestHash: Uint8Array,
  now: Date,
  identifiers: SecurityIdentifierFactory,
): Promise<void> => {
  await executeTenantQuery(session, (organizationId) => ({
    text: `insert into idempotency_keys
      (id, organization_id, scope, key_hash, principal_type, principal_id_hash,
       request_hash, status, response_status, locked_until, expires_at, created_at, completed_at)
      values ($2, $1, $3, $4, 'widget_session', $5, $6, 'succeeded', 202, null, $7, $8, $8)`,
    values: [
      organizationId,
      identifiers.issueResourceId(now),
      scope,
      Buffer.from(keyHash),
      Buffer.from(principalHash(claims.sessionId)),
      Buffer.from(requestHash),
      new Date(now.getTime() + IDEMPOTENCY_LIFETIME_MS),
      now,
    ],
  }));
};

const mapConversation = (row: ConversationRow): WidgetConversation => {
  const value: unknown = {
    closed_at: row.closed_at?.toISOString() ?? null,
    id: row.id,
    last_activity_at: row.last_activity_at.toISOString(),
    preferred_locale: row.preferred_locale,
    resolved_at: row.resolved_at?.toISOString() ?? null,
    started_at: row.started_at.toISOString(),
    status: row.status,
  };
  if (!isSchemaValue(WidgetConversationSchema, value))
    throw new WidgetApplicationError("business_rule_failed");
  return value;
};

export const createWidgetPersistenceStore = (
  runtime: TenantDatabaseRuntime,
  options: Readonly<{ clock?: () => Date; identifierFactory?: SecurityIdentifierFactory }> = {},
): WidgetPersistenceStore => {
  const identifiers = options.identifierFactory ?? createSecurityIdentifierFactory();
  const clock = options.clock ?? (() => new Date());
  const accept = async (
    input:
      | Parameters<WidgetPersistenceStore["acceptInitialInbound"]>[0]
      | Parameters<WidgetPersistenceStore["acceptBoundInbound"]>[0],
    initial: boolean,
  ): Promise<CanonicalInboundResult> =>
    await runtime.withTenantTransaction(input.claims.organizationId, async (session) => {
      const scope = initial ? "widget.conversation.create.v1" : "widget.message.create.v1";
      const replay = await inspectIdempotency(
        session,
        scope,
        input.claims,
        input.idempotencyKeyHash,
        input.requestHash,
      );
      const row = await selectSession(session, input.claims.sessionId, true);
      if (
        row === null ||
        row.status !== "active" ||
        row.channel_connection_id !== input.claims.channelConnectionId
      )
        throw new WidgetTokenInvalidError();
      if (
        (await originAllowed(
          session,
          row.channel_connection_id,
          input.claims.embeddingOrigin ?? input.origin,
          row.widget_allowed_origin_id,
        )) === null
      )
        throw new WidgetOriginInvalidError();
      if (
        input.now >= row.expires_at ||
        input.now.getTime() - row.last_seen_at.getTime() >= IDLE_LIFETIME_MS
      )
        throw new WidgetTokenInvalidError();
      const presentedHash = createHash("sha256").update(input.claims.jti).digest();
      if (initial) {
        const newHash = (input as Parameters<WidgetPersistenceStore["acceptInitialInbound"]>[0])
          .newJtiHash;
        const first =
          row.conversation_id === null && equal(row.session_token_jti_hash, presentedHash);
        const validReplay =
          replay && row.conversation_id !== null && equal(row.session_token_jti_hash, newHash);
        if (!first && !validReplay) throw new WidgetTokenInvalidError();
      } else if (
        row.conversation_id === null ||
        row.conversation_id !== input.claims.conversationId ||
        !equal(row.session_token_jti_hash, presentedHash)
      )
        throw new WidgetApplicationError("resource_not_found");
      if (row.conversation_id !== null) {
        const state = await executeTenantQuery<QueryResultRow & { status: string }>(
          session,
          (organizationId) => ({
            text: "select status from conversations where organization_id = $1 and id = $2",
            values: [organizationId, row.conversation_id],
          }),
        );
        if (!["open", "awaiting_lead", "awaiting_staff"].includes(state.rows[0]?.status ?? "")) {
          throw new WidgetApplicationError("business_rule_failed");
        }
      }
      const result = await createCanonicalInboundTenantSessionStore(session, {
        clock,
        identifierFactory: identifiers,
      }).acceptInbound(input.prepared);
      if (result.ok) {
        const receipt = result.value;
        if (receipt.status === "suppressed") {
          throw new WidgetApplicationError("business_rule_failed");
        }
        if (initial) {
          if (row.conversation_id !== null && row.conversation_id !== receipt.conversationId)
            throw new WidgetApplicationError("business_rule_failed");
          await executeTenantQuery(session, (organizationId) => ({
            text: `update widget_sessions set contact_id = $3, conversation_id = $4,
                      session_token_jti_hash = $5, last_seen_at = greatest(last_seen_at, $6),
                      version = version + 1, updated_at = greatest(updated_at, $6)
                    where organization_id = $1 and id = $2`,
            values: [
              organizationId,
              input.claims.sessionId,
              receipt.contactId,
              receipt.conversationId,
              Buffer.from(
                (input as Parameters<WidgetPersistenceStore["acceptInitialInbound"]>[0]).newJtiHash,
              ),
              input.now,
            ],
          }));
        }
        if (!replay) {
          await persistIdempotency(
            session,
            scope,
            input.claims,
            input.idempotencyKeyHash,
            input.requestHash,
            input.now,
            identifiers,
          );
        }
      }
      return result;
    });
  return Object.freeze({
    createSession: async (input: Parameters<WidgetPersistenceStore["createSession"]>[0]) =>
      await runtime.withTenantTransaction(input.organizationId, async (session) => {
        const origin = await originAllowed(session, input.channelConnectionId, input.origin);
        if (origin === null) return false;
        await executeTenantQuery(session, (organizationId) => ({
          text: `insert into widget_sessions
            (id, organization_id, channel_connection_id, widget_allowed_origin_id,
             session_token_jti_hash, participant_lookup_hash, status, requested_locale,
             contact_id, conversation_id, issued_at, last_seen_at, expires_at,
             revoked_at, revocation_reason, version, created_at, updated_at)
            values ($2, $1, $3, $4, $5, $6, 'active', $7, null, null, $8, $8, $9,
                    null, null, 1, $8, $8)`,
          values: [
            organizationId,
            input.sessionId,
            input.channelConnectionId,
            origin.id,
            Buffer.from(input.jtiHash),
            Buffer.from(input.participantLookupHash),
            input.requestedLocale,
            input.now,
            input.expiresAt,
          ],
        }));
        return true;
      }),
    acceptInitialInbound: (input: Parameters<WidgetPersistenceStore["acceptInitialInbound"]>[0]) =>
      accept(input, true),
    acceptBoundInbound: (input: Parameters<WidgetPersistenceStore["acceptBoundInbound"]>[0]) =>
      accept(input, false),
    authorize: async (input: Parameters<WidgetPersistenceStore["authorize"]>[0]) =>
      await runtime.withTenantTransaction(input.claims.organizationId, (session) =>
        authorizeInSession(session, input.claims, input.origin, input.now, true),
      ),
    getConversation: async ({
      claims,
      conversationId,
      now,
      origin,
    }: Parameters<WidgetPersistenceStore["getConversation"]>[0]) =>
      await runtime.withTenantTransaction(claims.organizationId, async (session) => {
        const authority = await authorizeInSession(session, claims, origin, now, true);
        if (authority === null) throw new WidgetTokenInvalidError();
        if (authority.conversationId !== conversationId) return null;
        const result = await executeTenantQuery<ConversationRow>(session, (organizationId) => ({
          text: `select id::text, status, preferred_locale, started_at, last_activity_at, resolved_at, closed_at
                   from conversations where organization_id = $1 and id = $2`,
          values: [organizationId, conversationId],
        }));
        return result.rows[0] === undefined ? null : mapConversation(result.rows[0]);
      }),
    listMessages: async ({
      after,
      claims,
      conversationId,
      limit,
      now,
      origin,
    }: Parameters<WidgetPersistenceStore["listMessages"]>[0]) =>
      await runtime.withTenantTransaction(claims.organizationId, async (session) => {
        const authority = await authorizeInSession(session, claims, origin, now, true);
        if (authority === null) throw new WidgetTokenInvalidError();
        if (authority.conversationId !== conversationId) return null;
        const result = await executeTenantQuery<MessageRow>(session, (organizationId) => ({
          text: `select id::text, conversation_id::text, channel_connection_id::text, direction,
                        sequence_no::text, content_type, body_ciphertext, locale, redacted_at, created_at
                   from messages
                  where organization_id = $1 and conversation_id = $2 and sequence_no > $3
                    and direction in ('inbound', 'outbound')
                    and content_type in ('text', 'quick_reply', 'attachment')
                  order by sequence_no asc, id asc limit $4`,
          values: [organizationId, conversationId, after, limit + 1],
        }));
        const items: WidgetProtectedMessageRecord[] = result.rows.slice(0, limit).map((row) => ({
          bodyCiphertext: row.body_ciphertext === null ? null : new Uint8Array(row.body_ciphertext),
          channelConnectionId:
            row.channel_connection_id as WidgetProtectedMessageRecord["channelConnectionId"],
          contentType: row.content_type,
          conversationId: row.conversation_id as ConversationId,
          createdAt: row.created_at,
          direction: row.direction,
          id: row.id as MessageId,
          locale: row.locale,
          redactedAt: row.redacted_at,
          sequenceNo: Number(row.sequence_no),
        }));
        return Object.freeze({ hasMore: result.rows.length > limit, items: Object.freeze(items) });
      }),
    redeemExchange: async ({
      claims,
      exchangeJtiHash,
      newJtiHash,
      now,
    }: Parameters<WidgetPersistenceStore["redeemExchange"]>[0]) =>
      await runtime.withTenantTransaction(claims.organizationId, async (session) => {
        const row = await selectSession(session, claims.sessionId, true);
        if (
          row === null ||
          row.organization_id !== claims.organizationId ||
          row.channel_connection_id !== claims.channelConnectionId ||
          row.status !== "active" ||
          row.contact_id !== null ||
          row.conversation_id !== null ||
          !equal(row.session_token_jti_hash, exchangeJtiHash) ||
          now >= row.expires_at ||
          now.getTime() - row.last_seen_at.getTime() >= IDLE_LIFETIME_MS ||
          (await originAllowed(
            session,
            row.channel_connection_id,
            claims.embeddingOrigin,
            row.widget_allowed_origin_id,
          )) === null
        ) {
          return null;
        }
        const updated = await executeTenantQuery(session, (organizationId) => ({
          text: `update widget_sessions
                    set session_token_jti_hash = $3,
                        last_seen_at = greatest(last_seen_at, $4),
                        version = version + 1,
                        updated_at = greatest(updated_at, $4)
                  where organization_id = $1 and id = $2
                    and session_token_jti_hash = $5
                returning id`,
          values: [
            organizationId,
            claims.sessionId,
            Buffer.from(newJtiHash),
            now,
            Buffer.from(exchangeJtiHash),
          ],
        }));
        if (updated.rowCount !== 1) return null;
        return Object.freeze({
          channelConnectionId: claims.channelConnectionId,
          contactId: null,
          conversationId: null,
          expiresAt: row.expires_at,
          issuedAt: row.issued_at,
          lastSeenAt: now > row.last_seen_at ? now : row.last_seen_at,
          organizationId: claims.organizationId,
          requestedLocale: row.requested_locale,
          sessionId: claims.sessionId,
        });
      }),
  });
};
