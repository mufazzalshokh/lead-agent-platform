import { createHash, timingSafeEqual } from "node:crypto";
import {
  InstagramApplicationError,
  isCredentialSecretReference,
  type InstagramConnection,
  type InstagramPersistenceStore,
  type TrustedInboundRoute,
} from "@lead-agent/application";
import {
  ChannelConnectionIdSchema,
  MessageIdSchema,
  OrganizationIdSchema,
  isSchemaValue,
  type ChannelConnectionId,
  type MessageId,
  type OrganizationId,
} from "@lead-agent/contracts";
import {
  createSecurityIdentifierFactory,
  type AuthorizationContext,
  type SecurityIdentifierFactory,
} from "@lead-agent/security";
import type { QueryResultRow } from "pg";
import {
  executeTenantQuery,
  type TenantDatabaseRuntime,
  type TenantDbSession,
} from "../runtime/tenant.js";

type InstagramConfiguration = Readonly<{
  schema_version: 1;
  account_id: string | null;
  onboarding_expires_at: string | null;
  onboarding_state_hash: string | null;
  token_expires_at: string | null;
  token_issued_at: string | null;
}>;
type ConnectionRow = QueryResultRow & {
  configuration_jsonb: unknown;
  credential_secret_ref: unknown;
  credential_version: unknown;
  provider_account_id_hash: Buffer | null;
  status: unknown;
};
const validInstant = (value: unknown): value is string =>
  typeof value === "string" &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value) &&
  Number.isFinite(Date.parse(value)) &&
  new Date(value).toISOString() === value;
const parseConfiguration = (value: unknown): InstagramConfiguration | null => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const object = value as Record<string, unknown>;
  const account = object["account_id"],
    expires = object["onboarding_expires_at"],
    state = object["onboarding_state_hash"],
    tokenExpires = object["token_expires_at"],
    issued = object["token_issued_at"];
  if (
    Object.keys(object).length !== 6 ||
    object["schema_version"] !== 1 ||
    !(account === null || (typeof account === "string" && /^[1-9][0-9]{0,31}$/u.test(account))) ||
    !(expires === null || validInstant(expires)) ||
    !(state === null || (typeof state === "string" && /^[A-Za-z0-9_-]{43}$/u.test(state))) ||
    !(tokenExpires === null || validInstant(tokenExpires)) ||
    !(issued === null || validInstant(issued))
  )
    return null;
  return Object.freeze({
    schema_version: 1,
    account_id: account,
    onboarding_expires_at: expires,
    onboarding_state_hash: state,
    token_expires_at: tokenExpires,
    token_issued_at: issued,
  });
};
const ownHash = (value: Uint8Array): Buffer => {
  if (!(value instanceof Uint8Array) || value.byteLength !== 32)
    throw new InstagramApplicationError("validation_failed");
  return Buffer.from(value);
};
const selectConnection = async (
  session: TenantDbSession,
  channelConnectionId: ChannelConnectionId,
  lock = false,
): Promise<ConnectionRow | null> => {
  const result = await executeTenantQuery<ConnectionRow>(session, (organizationId) => ({
    text: `select cc.status, cc.configuration_jsonb, cc.credential_secret_ref, cc.credential_version, cc.provider_account_id_hash
      from channel_connections cc where cc.organization_id=$1 and cc.id=$2 and cc.channel_type='instagram' ${lock ? "for update of cc" : ""}`,
    values: [organizationId, channelConnectionId],
  }));
  return result.rows[0] ?? null;
};
const appendAudit = async (
  session: TenantDbSession,
  identifiers: SecurityIdentifierFactory,
  channel: ChannelConnectionId,
  action: string,
  now: Date,
  actor?: AuthorizationContext,
): Promise<void> => {
  const id = identifiers.issueResourceId(now);
  await executeTenantQuery(session, (organizationId) => ({
    text: `insert into audit_events (id,organization_id,event_type,actor_type,actor_id,actor_membership_id,target_type,target_id,action,result,request_id,correlation_id,metadata_redacted_jsonb,occurred_at)
      values ($1,$2,$3,$4,$5,$6,'channel_connection',$7,$3,'succeeded',$8,$9,'{"source":"instagram_business"}'::jsonb,$10)`,
    values: [
      id,
      organizationId,
      action,
      actor === undefined ? "system" : "member",
      actor?.userId ?? null,
      actor?.membershipId ?? null,
      channel,
      `instagram:${id}`,
      identifiers.issueResourceId(now),
      now,
    ],
  }));
};
const mappedConnection = (row: ConnectionRow | null): InstagramConnection | null => {
  const config = parseConfiguration(row?.configuration_jsonb);
  if (
    row === null ||
    config === null ||
    !["pending", "active", "disabled", "revoked"].includes(String(row.status)) ||
    typeof row.credential_version !== "number" ||
    !Number.isSafeInteger(row.credential_version) ||
    row.credential_version < 1 ||
    !(row.credential_secret_ref === null || isCredentialSecretReference(row.credential_secret_ref))
  )
    return null;
  const status = row.status;
  if (status !== "pending" && status !== "active" && status !== "disabled" && status !== "revoked")
    return null;
  if (
    status === "active" &&
    (config.account_id === null ||
      config.token_expires_at === null ||
      row.credential_secret_ref === null ||
      row.provider_account_id_hash === null)
  )
    return null;
  if (
    status === "active" &&
    config.account_id !== null &&
    (row.provider_account_id_hash?.byteLength !== 32 ||
      !timingSafeEqual(
        row.provider_account_id_hash,
        createHash("sha256").update(config.account_id).digest(),
      ))
  )
    return null;
  return Object.freeze({
    accountId: config.account_id,
    credentialReference: row.credential_secret_ref,
    credentialVersion: row.credential_version,
    credentialIssuedAt: config.token_issued_at,
    expiresAt: config.token_expires_at,
    onboardingExpiresAt: config.onboarding_expires_at,
    stateHash:
      config.onboarding_state_hash === null
        ? null
        : Buffer.from(config.onboarding_state_hash, "base64url"),
    status,
  });
};

export const createInstagramPersistenceStore = (
  runtime: TenantDatabaseRuntime,
  options: Readonly<{ identifierFactory?: SecurityIdentifierFactory }> = {},
): InstagramPersistenceStore => {
  const identifiers = options.identifierFactory ?? createSecurityIdentifierFactory();
  const loadConnection = async (
    context: TrustedInboundRoute,
  ): Promise<InstagramConnection | null> =>
    runtime.withTenantTransaction(context.organizationId, async (session) =>
      mappedConnection(await selectConnection(session, context.channelConnectionId)),
    );
  return Object.freeze<InstagramPersistenceStore>({
    loadConnection,
    beginOnboarding: async (input) =>
      runtime.withTenantTransaction(input.actor.organizationId, async (session) => {
        const channel = identifiers.issueResourceId(input.now);
        if (!isSchemaValue(ChannelConnectionIdSchema, channel))
          throw new InstagramApplicationError("business_rule_failed");
        const config: InstagramConfiguration = {
          schema_version: 1,
          account_id: null,
          onboarding_expires_at: input.expiresAt.toISOString(),
          onboarding_state_hash: ownHash(input.stateHash).toString("base64url"),
          token_expires_at: null,
          token_issued_at: null,
        };
        await executeTenantQuery(session, (organizationId) => ({
          text: `insert into channel_connections (id,organization_id,channel_type,status,display_name,provider_account_id_hash,credential_secret_ref,webhook_secret_hash,configuration_jsonb,verified_at,credential_version,version,created_at,updated_at)
          values ($2,$1,'instagram','pending',$3,null,null,null,$4::jsonb,null,1,1,$5,$5)`,
          values: [organizationId, channel, input.displayName, JSON.stringify(config), input.now],
        }));
        const result = await executeTenantQuery<{ changed: boolean }>(session, () => ({
          text: "select app.create_instagram_inbound_route($1,$2,$3::bytea) as changed",
          values: [identifiers.issueResourceId(input.now), channel, ownHash(input.stateHash)],
        }));
        if (result.rows[0]?.changed !== true)
          throw new InstagramApplicationError("business_rule_failed");
        await appendAudit(
          session,
          identifiers,
          channel,
          "instagram.onboarding_started",
          input.now,
          input.actor,
        );
        return channel;
      }),
    activate: async (input) =>
      runtime.withTenantTransaction(input.context.organizationId, async (session) => {
        const row = await selectConnection(session, input.context.channelConnectionId, true);
        const current = mappedConnection(row);
        if (
          current?.status !== "pending" ||
          current.stateHash === null ||
          !timingSafeEqual(ownHash(current.stateHash), ownHash(input.stateHash)) ||
          current.onboardingExpiresAt === null ||
          Date.parse(current.onboardingExpiresAt) <= input.now.getTime()
        )
          return false;
        if (
          !/^[1-9][0-9]{0,31}$/u.test(input.accountId) ||
          !isCredentialSecretReference(input.credentialReference) ||
          !timingSafeEqual(
            ownHash(input.accountHash),
            createHash("sha256").update(input.accountId).digest(),
          ) ||
          input.expiresAt.getTime() <= input.now.getTime()
        )
          throw new InstagramApplicationError("validation_failed");
        const rotated = await executeTenantQuery<{ changed: boolean }>(session, () => ({
          text: "select app.rotate_instagram_inbound_route($1,$2::bytea,$3::bytea) as changed",
          values: [
            input.context.channelConnectionId,
            ownHash(input.stateHash),
            ownHash(input.accountHash),
          ],
        }));
        if (rotated.rows[0]?.changed !== true) return false;
        const config: InstagramConfiguration = {
          schema_version: 1,
          account_id: input.accountId,
          onboarding_expires_at: null,
          onboarding_state_hash: null,
          token_expires_at: input.expiresAt.toISOString(),
          token_issued_at: input.now.toISOString(),
        };
        await executeTenantQuery(session, (organizationId) => ({
          text: `update channel_connections set status='active',provider_account_id_hash=$3,credential_secret_ref=$4,configuration_jsonb=$5::jsonb,verified_at=$6,credential_version=credential_version+1,version=version+1,updated_at=$6 where organization_id=$1 and id=$2 and channel_type='instagram' and status='pending'`,
          values: [
            organizationId,
            input.context.channelConnectionId,
            ownHash(input.accountHash),
            input.credentialReference,
            JSON.stringify(config),
            input.now,
          ],
        }));
        await appendAudit(
          session,
          identifiers,
          input.context.channelConnectionId,
          "instagram.connected",
          input.now,
        );
        return true;
      }),
    replaceCredential: async (input) =>
      runtime.withTenantTransaction(input.context.organizationId, async (session) => {
        const row = await selectConnection(session, input.context.channelConnectionId, true);
        const current = mappedConnection(row);
        const config = parseConfiguration(row?.configuration_jsonb);
        if (
          config === null ||
          current?.status !== "active" ||
          current.credentialReference !== input.expectedReference ||
          current.credentialVersion !== input.expectedVersion
        )
          return false;
        if (!isCredentialSecretReference(input.credentialReference))
          throw new InstagramApplicationError("validation_failed");
        await executeTenantQuery(session, (organizationId) => ({
          text: `update channel_connections set credential_secret_ref=$3,configuration_jsonb=$4::jsonb,credential_version=credential_version+1,version=version+1,updated_at=$5 where organization_id=$1 and id=$2 and channel_type='instagram'`,
          values: [
            organizationId,
            input.context.channelConnectionId,
            input.credentialReference,
            JSON.stringify({
              ...config,
              token_expires_at: input.expiresAt.toISOString(),
              token_issued_at: input.now.toISOString(),
            }),
            input.now,
          ],
        }));
        await appendAudit(
          session,
          identifiers,
          input.context.channelConnectionId,
          "instagram.credential_refreshed",
          input.now,
        );
        return true;
      }),
    disconnect: async (input) =>
      runtime.withTenantTransaction(input.context.organizationId, async (session) => {
        const row = await selectConnection(session, input.context.channelConnectionId, true);
        const current = mappedConnection(row);
        const config = parseConfiguration(row?.configuration_jsonb);
        if (
          current === null ||
          config === null ||
          (input.expectedVersion !== undefined &&
            current.credentialVersion !== input.expectedVersion)
        )
          return null;
        const disabled = await executeTenantQuery<{ changed: boolean }>(session, () => ({
          text: "select app.disable_instagram_inbound_route($1) as changed",
          values: [input.context.channelConnectionId],
        }));
        if (disabled.rows[0]?.changed !== true)
          throw new InstagramApplicationError("business_rule_failed");
        await executeTenantQuery(session, (organizationId) => ({
          text: `update channel_connections set status=$3,credential_secret_ref=null,configuration_jsonb=$4::jsonb,credential_version=credential_version+1,version=version+1,updated_at=$5 where organization_id=$1 and id=$2 and channel_type='instagram'`,
          values: [
            organizationId,
            input.context.channelConnectionId,
            input.revoked ? "revoked" : "disabled",
            JSON.stringify({ ...config, onboarding_expires_at: null, onboarding_state_hash: null }),
            input.now,
          ],
        }));
        await appendAudit(
          session,
          identifiers,
          input.context.channelConnectionId,
          input.revoked ? "instagram.credentials_revoked" : "instagram.disconnected",
          input.now,
          input.actor,
        );
        return current.credentialReference;
      }),
  });
};

export type InstagramOutboundRecord = Readonly<{
  accountId: string;
  bodyCiphertext: Uint8Array;
  channelConnectionId: ChannelConnectionId;
  credentialReference: string;
  credentialVersion: number;
  credentialExpiresAt: Date;
  deliveryStatus: "queued" | "sent" | "failed";
  externalThreadHash: Uint8Array;
  lastInboundAt: Date | null;
  messageId: MessageId;
  recipientCiphertext: Uint8Array;
}>;
export interface InstagramOutboundPersistenceStore {
  load(
    organizationId: OrganizationId,
    messageId: MessageId,
  ): Promise<InstagramOutboundRecord | Readonly<{ kind: "not_instagram" }> | null>;
  markFailed(organizationId: OrganizationId, messageId: MessageId): Promise<boolean>;
  markSent(
    organizationId: OrganizationId,
    messageId: MessageId,
    providerMessageId: string,
  ): Promise<boolean>;
}
type OutboundRow = ConnectionRow & {
  body_ciphertext: Buffer | null;
  channel_connection_id: unknown;
  channel_type: unknown;
  content_type: unknown;
  delivery_status: unknown;
  external_thread_hash: Buffer | null;
  last_inbound_at: Date | null;
  recipient_ciphertext: Buffer | null;
};
export const createInstagramOutboundPersistenceStore = (
  runtime: TenantDatabaseRuntime,
): InstagramOutboundPersistenceStore => {
  const identifiers = createSecurityIdentifierFactory();
  const mark = async (
    organizationId: OrganizationId,
    messageId: MessageId,
    externalMessageId: string | null,
  ): Promise<boolean> =>
    runtime.withTenantTransaction(organizationId, async (session) => {
      const result = await executeTenantQuery<{ channel_connection_id: unknown }>(
        session,
        (tenantId) => ({
          text: `update messages set delivery_status=$3,external_message_id=coalesce($4,external_message_id)
          where organization_id=$1 and id=$2 and direction='outbound' and delivery_status='queued'
          and exists(select 1 from channel_connections cc where cc.organization_id=$1 and cc.id=messages.channel_connection_id and cc.channel_type='instagram')
          returning channel_connection_id::text`,
          values: [
            tenantId,
            messageId,
            externalMessageId === null ? "failed" : "sent",
            externalMessageId,
          ],
        }),
      );
      const channel = result.rows[0]?.channel_connection_id;
      if (result.rowCount === 1 && isSchemaValue(ChannelConnectionIdSchema, channel))
        await appendAudit(
          session,
          identifiers,
          channel,
          externalMessageId === null ? "instagram.delivery_failed" : "instagram.delivery_sent",
          new Date(),
        );
      return result.rowCount === 1;
    });
  return Object.freeze<InstagramOutboundPersistenceStore>({
    load: async (organizationId, messageId) => {
      if (
        !isSchemaValue(OrganizationIdSchema, organizationId) ||
        !isSchemaValue(MessageIdSchema, messageId)
      )
        return null;
      return runtime.withTenantTransaction(organizationId, async (session) => {
        const result = await executeTenantQuery<OutboundRow>(session, (tenantId) => ({
          text: `select m.channel_connection_id::text,m.body_ciphertext,m.content_type,m.delivery_status,
            cc.channel_type,cc.status,cc.configuration_jsonb,cc.credential_secret_ref,cc.credential_version,cc.provider_account_id_hash,
            c.external_thread_hash,ci.value_ciphertext as recipient_ciphertext,
            (select max(mi.external_sent_at) from messages mi where mi.organization_id=$1 and mi.conversation_id=m.conversation_id and mi.direction='inbound') as last_inbound_at
            from messages m join conversations c on c.organization_id=m.organization_id and c.id=m.conversation_id
            join channel_connections cc on cc.organization_id=m.organization_id and cc.id=m.channel_connection_id
            left join lateral (select value_ciphertext from contact_identities where organization_id=$1 and contact_id=c.contact_id
              and channel_connection_id=m.channel_connection_id and identity_type='instagram_user' and status='active'
              order by created_at asc,id asc limit 1) ci on true
            where m.organization_id=$1 and m.id=$2 and m.direction='outbound'`,
          values: [tenantId, messageId],
        }));
        const row = result.rows[0];
        if (row !== undefined && row.channel_type !== "instagram")
          return Object.freeze({ kind: "not_instagram" as const });
        const connection = mappedConnection(row ?? null);
        if (
          row === undefined ||
          connection?.status !== "active" ||
          connection.accountId === null ||
          connection.credentialReference === null ||
          connection.expiresAt === null ||
          !isSchemaValue(ChannelConnectionIdSchema, row.channel_connection_id) ||
          row.content_type !== "text" ||
          row.body_ciphertext === null ||
          row.recipient_ciphertext === null ||
          row.external_thread_hash === null ||
          !(
            row.delivery_status === "queued" ||
            row.delivery_status === "sent" ||
            row.delivery_status === "failed"
          )
        )
          return null;
        return Object.freeze({
          accountId: connection.accountId,
          bodyCiphertext: new Uint8Array(row.body_ciphertext),
          channelConnectionId: row.channel_connection_id,
          credentialReference: connection.credentialReference,
          credentialVersion: connection.credentialVersion,
          credentialExpiresAt: new Date(connection.expiresAt),
          deliveryStatus: row.delivery_status,
          externalThreadHash: new Uint8Array(row.external_thread_hash),
          lastInboundAt: row.last_inbound_at,
          messageId,
          recipientCiphertext: new Uint8Array(row.recipient_ciphertext),
        });
      });
    },
    markFailed: (organizationId, messageId) => mark(organizationId, messageId, null),
    markSent: (organizationId, messageId, providerMessageId) => {
      if (providerMessageId.length < 1 || providerMessageId.length > 1024)
        throw new InstagramApplicationError("validation_failed");
      return mark(
        organizationId,
        messageId,
        `instagram:sent:${messageId}:${createHash("sha256").update(providerMessageId).digest("base64url")}`,
      );
    },
  });
};
