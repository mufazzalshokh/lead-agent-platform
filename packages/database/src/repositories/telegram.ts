import {
  ChannelConnectionIdSchema,
  MessageIdSchema,
  OrganizationIdSchema,
  isSchemaValue,
  type ChannelConnectionId,
  type MessageId,
  type OrganizationId,
} from "@lead-agent/contracts";
import type {
  TelegramConnectionAuthority,
  TelegramPersistenceStore,
} from "@lead-agent/application";
import { TelegramApplicationError } from "@lead-agent/application";
import {
  createSecurityIdentifierFactory,
  type AuthorizationContext,
  type SecurityIdentifierFactory,
} from "@lead-agent/security";
import type { QueryResultRow } from "pg";

import type { TenantDatabaseRuntime, TenantDbSession } from "../runtime/tenant.js";
import { executeTenantQuery } from "../runtime/tenant.js";

const HASH_BYTES = 32;
const CONFIGURATION_SCHEMA_VERSION = 1;

type TelegramConfiguration = Readonly<{
  business_connection_id: string | null;
  can_reply: boolean;
  established_at: string | null;
  is_enabled: boolean;
  onboarding_expires_at: string | null;
  owner_user_id_hash: string | null;
  phase: "active" | "awaiting_connection" | "awaiting_owner";
  schema_version: 1;
}>;

type ConnectionRow = QueryResultRow & {
  configuration_jsonb: unknown;
  provider_account_id_hash: Buffer | null;
  status: "active" | "disabled" | "pending" | "revoked";
};

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const ownHash = (value: Uint8Array): Buffer => {
  if (!(value instanceof Uint8Array) || value.byteLength !== HASH_BYTES) {
    throw new TypeError("Telegram identity hash is invalid");
  }
  return Buffer.from(value);
};
const parseConfiguration = (value: unknown): TelegramConfiguration | null => {
  if (!isRecord(value) || Object.keys(value).length !== 8) return null;
  const phase = value["phase"];
  const businessConnectionId = value["business_connection_id"];
  const establishedAt = value["established_at"];
  const expiresAt = value["onboarding_expires_at"];
  const ownerHash = value["owner_user_id_hash"];
  if (
    value["schema_version"] !== CONFIGURATION_SCHEMA_VERSION ||
    !(phase === "active" || phase === "awaiting_connection" || phase === "awaiting_owner") ||
    typeof value["can_reply"] !== "boolean" ||
    typeof value["is_enabled"] !== "boolean" ||
    !(
      businessConnectionId === null ||
      (typeof businessConnectionId === "string" &&
        businessConnectionId.length > 0 &&
        businessConnectionId.length <= 255)
    ) ||
    !(establishedAt === null || validInstant(establishedAt)) ||
    !(expiresAt === null || validInstant(expiresAt)) ||
    !(
      ownerHash === null ||
      (typeof ownerHash === "string" && /^[A-Za-z0-9_-]{43}$/u.test(ownerHash))
    )
  ) {
    return null;
  }
  if (
    (phase === "awaiting_owner" && expiresAt === null) ||
    (phase !== "awaiting_owner" && ownerHash === null) ||
    (phase === "active" && (businessConnectionId === null || establishedAt === null))
  )
    return null;
  return Object.freeze({
    business_connection_id: businessConnectionId,
    can_reply: value["can_reply"],
    established_at: establishedAt,
    is_enabled: value["is_enabled"],
    onboarding_expires_at: expiresAt,
    owner_user_id_hash: ownerHash,
    phase,
    schema_version: 1,
  });
};
const validInstant = (value: unknown): value is string =>
  typeof value === "string" &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value) &&
  Number.isFinite(Date.parse(value)) &&
  new Date(value).toISOString() === value;
const configuration = (value: TelegramConfiguration): string => JSON.stringify(value);

const appendTelegramAudit = async (
  session: TenantDbSession,
  identifiers: SecurityIdentifierFactory,
  channelConnectionId: ChannelConnectionId,
  action: string,
  now: Date,
  actor?: AuthorizationContext,
): Promise<void> => {
  const auditId = identifiers.issueResourceId(now);
  const correlationId = identifiers.issueResourceId(now);
  await executeTenantQuery(session, (organizationId) => ({
    text: `insert into audit_events
      (id,organization_id,event_type,actor_type,actor_id,actor_membership_id,
       target_type,target_id,action,result,request_id,correlation_id,metadata_redacted_jsonb,occurred_at)
      values ($1,$2,$3,$4,$5,$6,'channel_connection',$7,$3,'succeeded',$8,$9,
              '{"source":"telegram_business"}'::jsonb,$10)`,
    values: [
      auditId,
      organizationId,
      action,
      actor === undefined ? "system" : "member",
      actor?.userId ?? null,
      actor?.membershipId ?? null,
      channelConnectionId,
      `telegram:${auditId}`,
      correlationId,
      now,
    ],
  }));
};

const issueChannelConnectionId = (
  identifiers: SecurityIdentifierFactory,
  now: Date,
): ChannelConnectionId => {
  const value: unknown = identifiers.issueResourceId(now);
  if (!isSchemaValue(ChannelConnectionIdSchema, value)) {
    throw new TypeError("Unable to issue Telegram channel connection identifier");
  }
  return value;
};

const selectConnection = async (
  session: TenantDbSession,
  channelConnectionId: ChannelConnectionId,
): Promise<ConnectionRow | null> => {
  const result = await executeTenantQuery<ConnectionRow>(session, (organizationId) => ({
    text: `select cc.status, cc.provider_account_id_hash, cc.configuration_jsonb
             from channel_connections cc
            where cc.organization_id = $1 and cc.id = $2
              and cc.channel_type = 'telegram'
            for update of cc`,
    values: [organizationId, channelConnectionId],
  }));
  return result.rows[0] ?? null;
};

const rotateRoute = async (
  session: TenantDbSession,
  channelConnectionId: ChannelConnectionId,
  oldHash: Uint8Array,
  newHash: Uint8Array,
): Promise<boolean> => {
  const result = await executeTenantQuery<{ changed: boolean }>(session, () => ({
    text: "select app.rotate_telegram_inbound_route($1, $2::bytea, $3::bytea) as changed",
    values: [channelConnectionId, ownHash(oldHash), ownHash(newHash)],
  }));
  return result.rows[0]?.changed === true;
};

export const createTelegramPersistenceStore = (
  runtime: TenantDatabaseRuntime,
  options: Readonly<{ identifierFactory?: SecurityIdentifierFactory }> = {},
): TelegramPersistenceStore => {
  const identifiers = options.identifierFactory ?? createSecurityIdentifierFactory();
  return Object.freeze<TelegramPersistenceStore>({
    beginOnboarding: async (input) =>
      await runtime.withTenantTransaction(input.actor.organizationId, async (session) => {
        const channelConnectionId = issueChannelConnectionId(identifiers, input.now);
        const routeId = identifiers.issueResourceId(input.now);
        const initial: TelegramConfiguration = Object.freeze({
          business_connection_id: null,
          can_reply: false,
          established_at: null,
          is_enabled: false,
          onboarding_expires_at: input.expiresAt.toISOString(),
          owner_user_id_hash: null,
          phase: "awaiting_owner",
          schema_version: 1,
        });
        await executeTenantQuery(session, (organizationId) => ({
          text: `insert into channel_connections
            (id, organization_id, channel_type, status, display_name,
             provider_account_id_hash, credential_secret_ref, webhook_secret_hash,
             configuration_jsonb, verified_at, credential_version, version, created_at, updated_at)
            values ($2, $1, 'telegram', 'pending', $3, null, null, null,
                    $4::jsonb, null, 1, 1, $5, $5)`,
          values: [
            organizationId,
            channelConnectionId,
            input.displayName,
            configuration(initial),
            input.now,
          ],
        }));
        const created = await executeTenantQuery<{ changed: boolean }>(session, () => ({
          text: "select app.create_telegram_inbound_route($1, $2, $3::bytea) as changed",
          values: [routeId, channelConnectionId, ownHash(input.nonceHash)],
        }));
        if (created.rows[0]?.changed !== true) {
          throw new TelegramApplicationError("business_rule_failed");
        }
        await appendTelegramAudit(
          session,
          identifiers,
          channelConnectionId,
          "telegram.onboarding_started",
          input.now,
          input.actor,
        );
        return Object.freeze({ channelConnectionId });
      }),
    bindOwner: async (input) =>
      await runtime.withTenantTransaction(input.context.organizationId, async (session) => {
        const row = await selectConnection(session, input.context.channelConnectionId);
        const current = parseConfiguration(row?.configuration_jsonb);
        if (
          row?.status !== "pending" ||
          current?.phase !== "awaiting_owner" ||
          current.onboarding_expires_at === null ||
          new Date(current.onboarding_expires_at).getTime() <= input.now.getTime()
        ) {
          return false;
        }
        const next: TelegramConfiguration = Object.freeze({
          ...current,
          onboarding_expires_at: null,
          owner_user_id_hash: Buffer.from(input.ownerUserIdHash).toString("base64url"),
          phase: "awaiting_connection",
        });
        if (
          !(await rotateRoute(
            session,
            input.context.channelConnectionId,
            input.nonceHash,
            input.newOwnerRouteHash,
          ))
        ) {
          return false;
        }
        await executeTenantQuery(session, (organizationId) => ({
          text: `update channel_connections
                    set configuration_jsonb = $3::jsonb, version = version + 1,
                        updated_at = $4
                  where organization_id = $1 and id = $2 and status = 'pending'`,
          values: [
            organizationId,
            input.context.channelConnectionId,
            configuration(next),
            input.now,
          ],
        }));
        await appendTelegramAudit(
          session,
          identifiers,
          input.context.channelConnectionId,
          "telegram.owner_bound",
          input.now,
        );
        return true;
      }),
    bindBusinessConnection: async (input) =>
      await runtime.withTenantTransaction(input.context.organizationId, async (session) => {
        const row = await selectConnection(session, input.context.channelConnectionId);
        const current = parseConfiguration(row?.configuration_jsonb);
        const encodedOwner = Buffer.from(input.ownerUserIdHash).toString("base64url");
        if (
          row?.status !== "pending" ||
          current?.phase !== "awaiting_connection" ||
          current.owner_user_id_hash !== encodedOwner ||
          !input.canReply
        ) {
          return false;
        }
        const next: TelegramConfiguration = Object.freeze({
          business_connection_id: input.businessConnectionId,
          can_reply: true,
          established_at: input.establishedAt.toISOString(),
          is_enabled: true,
          onboarding_expires_at: null,
          owner_user_id_hash: encodedOwner,
          phase: "active",
          schema_version: 1,
        });
        if (
          !(await rotateRoute(
            session,
            input.context.channelConnectionId,
            input.ownerRouteHash,
            input.businessConnectionIdHash,
          ))
        ) {
          return false;
        }
        const updated = await executeTenantQuery(session, (organizationId) => ({
          text: `update channel_connections
                    set status = 'active', provider_account_id_hash = $3,
                        configuration_jsonb = $4::jsonb, verified_at = $5,
                        version = version + 1, updated_at = $5
                  where organization_id = $1 and id = $2 and status = 'pending'`,
          values: [
            organizationId,
            input.context.channelConnectionId,
            ownHash(input.businessConnectionIdHash),
            configuration(next),
            input.now,
          ],
        }));
        if (updated.rowCount !== 1) throw new TelegramApplicationError("business_rule_failed");
        await appendTelegramAudit(
          session,
          identifiers,
          input.context.channelConnectionId,
          "telegram.connected",
          input.now,
        );
        return updated.rowCount === 1;
      }),
    applyBusinessConnectionUpdate: async (input) =>
      await runtime.withTenantTransaction(input.context.organizationId, async (session) => {
        const row = await selectConnection(session, input.context.channelConnectionId);
        const current = parseConfiguration(row?.configuration_jsonb);
        const encodedOwner = Buffer.from(input.ownerUserIdHash).toString("base64url");
        if (
          row === null ||
          current?.phase !== "active" ||
          current.business_connection_id !== input.businessConnectionId ||
          current.owner_user_id_hash !== encodedOwner ||
          row.provider_account_id_hash === null ||
          !row.provider_account_id_hash.equals(ownHash(input.businessConnectionIdHash))
        ) {
          return false;
        }
        if (row.status === "disabled") return !input.isEnabled;
        if (row.status !== "active") return false;
        if (!input.isEnabled) {
          const disabled = await executeTenantQuery<{ changed: boolean }>(session, () => ({
            text: "select app.disable_telegram_inbound_route($1) as changed",
            values: [input.context.channelConnectionId],
          }));
          if (disabled.rows[0]?.changed !== true) return false;
        }
        const next: TelegramConfiguration = Object.freeze({
          ...current,
          can_reply: input.canReply,
          is_enabled: input.isEnabled,
        });
        const updated = await executeTenantQuery(session, (organizationId) => ({
          text: `update channel_connections
                    set status = $3, configuration_jsonb = $4::jsonb,
                        version = version + 1, updated_at = $5
                  where organization_id = $1 and id = $2 and status = 'active'`,
          values: [
            organizationId,
            input.context.channelConnectionId,
            input.isEnabled ? "active" : "disabled",
            configuration(next),
            input.now,
          ],
        }));
        if (updated.rowCount !== 1) throw new TelegramApplicationError("business_rule_failed");
        await appendTelegramAudit(
          session,
          identifiers,
          input.context.channelConnectionId,
          input.isEnabled ? "telegram.rights_changed" : "telegram.disconnected",
          input.now,
        );
        return updated.rowCount === 1;
      }),
    loadConnection: async (input) =>
      await runtime.withTenantTransaction(input.context.organizationId, async (session) => {
        const row = await selectConnection(session, input.context.channelConnectionId);
        const current = parseConfiguration(row?.configuration_jsonb);
        if (
          row?.status !== "active" ||
          current?.phase !== "active" ||
          current.business_connection_id === null ||
          current.business_connection_id !== input.businessConnectionId ||
          current.owner_user_id_hash === null ||
          row.provider_account_id_hash === null ||
          !row.provider_account_id_hash.equals(ownHash(input.businessConnectionIdHash))
        ) {
          return null;
        }
        return Object.freeze({
          businessConnectionId: current.business_connection_id,
          canReply: current.can_reply,
          isEnabled: current.is_enabled,
          ownerUserIdHash: Buffer.from(current.owner_user_id_hash, "base64url"),
        }) satisfies TelegramConnectionAuthority;
      }),
  });
};

export type TelegramOutboundRecord = Readonly<{
  bodyCiphertext: Uint8Array;
  businessConnectionId: string;
  canReply: boolean;
  channelConnectionId: ChannelConnectionId;
  contentType: "text";
  deliveryStatus: "failed" | "queued" | "sent";
  externalThreadHash: Uint8Array;
  lastInboundAt: Date | null;
  messageId: MessageId;
  recipientCiphertext: Uint8Array;
}>;

export type TelegramOutboundPersistenceStore = Readonly<{
  load(
    organizationId: OrganizationId,
    messageId: MessageId,
  ): Promise<TelegramOutboundRecord | Readonly<{ kind: "not_telegram" }> | null>;
  markFailed(organizationId: OrganizationId, messageId: MessageId): Promise<boolean>;
  markSent(
    organizationId: OrganizationId,
    messageId: MessageId,
    providerMessageId: string,
  ): Promise<boolean>;
}>;

type OutboundRow = QueryResultRow & {
  body_ciphertext: Buffer | null;
  channel_connection_id: string;
  channel_type: string;
  channel_status: string;
  configuration_jsonb: unknown;
  content_type: string;
  delivery_status: string;
  external_thread_hash: Buffer | null;
  last_inbound_at: Date | null;
  message_id: string;
  recipient_ciphertext: Buffer | null;
};

const loadOutboundInSession = async (
  session: TenantDbSession,
  messageId: MessageId,
): Promise<TelegramOutboundRecord | Readonly<{ kind: "not_telegram" }> | null> => {
  const result = await executeTenantQuery<OutboundRow>(session, (organizationId) => ({
    text: `select m.id::text as message_id, m.channel_connection_id::text,
                  m.content_type, m.body_ciphertext, m.delivery_status,
                  cc.channel_type, cc.status as channel_status, c.external_thread_hash,
                  cc.configuration_jsonb, ci.value_ciphertext as recipient_ciphertext,
                  (select max(mi.external_sent_at) from messages mi
                    where mi.organization_id = $1 and mi.conversation_id = m.conversation_id
                      and mi.direction = 'inbound') as last_inbound_at
             from messages m
             join conversations c
               on c.organization_id = m.organization_id and c.id = m.conversation_id
             join channel_connections cc
               on cc.organization_id = m.organization_id and cc.id = m.channel_connection_id
             left join lateral (
               select value_ciphertext from contact_identities
                where organization_id = $1 and contact_id = c.contact_id
                  and channel_connection_id = m.channel_connection_id
                  and identity_type = 'telegram_user' and status = 'active'
                order by is_primary desc, created_at asc limit 1
             ) ci on true
            where m.organization_id = $1 and m.id = $2
              and m.direction = 'outbound'`,
    values: [organizationId, messageId],
  }));
  const row = result.rows[0];
  if (row !== undefined && row.channel_type !== "telegram")
    return Object.freeze({ kind: "not_telegram" });
  const config = parseConfiguration(row?.configuration_jsonb);
  if (
    row === undefined ||
    row.channel_status !== "active" ||
    row.external_thread_hash === null ||
    config?.phase !== "active" ||
    config.business_connection_id === null ||
    row.body_ciphertext === null ||
    row.recipient_ciphertext === null ||
    row.content_type !== "text" ||
    !["failed", "queued", "sent"].includes(row.delivery_status) ||
    !isSchemaValue(MessageIdSchema, row.message_id) ||
    !isSchemaValue(ChannelConnectionIdSchema, row.channel_connection_id)
  ) {
    return null;
  }
  return Object.freeze({
    bodyCiphertext: new Uint8Array(row.body_ciphertext),
    businessConnectionId: config.business_connection_id,
    canReply: config.can_reply && config.is_enabled,
    channelConnectionId: row.channel_connection_id,
    contentType: "text",
    deliveryStatus: row.delivery_status as TelegramOutboundRecord["deliveryStatus"],
    externalThreadHash: new Uint8Array(row.external_thread_hash),
    lastInboundAt: row.last_inbound_at,
    messageId: row.message_id,
    recipientCiphertext: new Uint8Array(row.recipient_ciphertext),
  });
};

export const createTelegramOutboundPersistenceStore = (
  runtime: TenantDatabaseRuntime,
): TelegramOutboundPersistenceStore => {
  const identifiers = createSecurityIdentifierFactory();
  return Object.freeze<TelegramOutboundPersistenceStore>({
    load: async (organizationId, messageId) => {
      if (
        !isSchemaValue(OrganizationIdSchema, organizationId) ||
        !isSchemaValue(MessageIdSchema, messageId)
      ) {
        return null;
      }
      return await runtime.withTenantTransaction(organizationId, (session) =>
        loadOutboundInSession(session, messageId),
      );
    },
    markFailed: async (organizationId, messageId) =>
      await runtime.withTenantTransaction(organizationId, async (session) => {
        const result = await executeTenantQuery<{ channel_connection_id: string }>(
          session,
          (tenantId) => ({
            text: `update messages set delivery_status = 'failed'
                  where organization_id = $1 and id = $2 and direction = 'outbound'
                    and delivery_status = 'queued'
                    and exists(select 1 from channel_connections cc where cc.organization_id=$1
                      and cc.id=messages.channel_connection_id and cc.channel_type='telegram')
                  returning channel_connection_id::text`,
            values: [tenantId, messageId],
          }),
        );
        const channel = result.rows[0]?.channel_connection_id;
        if (result.rowCount === 1 && isSchemaValue(ChannelConnectionIdSchema, channel)) {
          await appendTelegramAudit(
            session,
            identifiers,
            channel,
            "telegram.delivery_failed",
            new Date(),
          );
        }
        return result.rowCount === 1;
      }),
    markSent: async (organizationId, messageId, providerMessageId) =>
      await runtime.withTenantTransaction(organizationId, async (session) => {
        const externalMessageId = `telegram:sent:${messageId}:${providerMessageId}`;
        const result = await executeTenantQuery<{ channel_connection_id: string }>(
          session,
          (tenantId) => ({
            text: `update messages
                    set delivery_status = 'sent', external_message_id = $3
                  where organization_id = $1 and id = $2 and direction = 'outbound'
                    and delivery_status = 'queued'
                    and exists(select 1 from channel_connections cc where cc.organization_id=$1
                      and cc.id=messages.channel_connection_id and cc.channel_type='telegram')
                  returning channel_connection_id::text`,
            values: [tenantId, messageId, externalMessageId],
          }),
        );
        const channel = result.rows[0]?.channel_connection_id;
        if (result.rowCount === 1 && isSchemaValue(ChannelConnectionIdSchema, channel)) {
          await appendTelegramAudit(
            session,
            identifiers,
            channel,
            "telegram.delivery_sent",
            new Date(),
          );
        }
        return result.rowCount === 1;
      }),
  });
};
