import {
  ChannelConnectionIdSchema,
  isSchemaValue,
  type ChannelConnectionId,
} from "@lead-agent/contracts";
import {
  WidgetManagementError,
  type WidgetManagementConfiguration,
  type WidgetManagementStore,
} from "@lead-agent/application";
import {
  createSecurityIdentifierFactory,
  type AuthorizationContext,
  type SecurityIdentifierFactory,
} from "@lead-agent/security";
import type { QueryResultRow } from "pg";

import type { TenantDatabaseRuntime, TenantDbSession } from "../runtime/tenant.js";
import { executeTenantQuery } from "../runtime/tenant.js";

const DISPLAY_NAME = "Website Chat";
const CONFIGURATION_SCHEMA_VERSION = 1;

type WidgetConfiguration = Readonly<{
  publishable_key: string;
  schema_version: 1;
  website_origin: string;
}>;

type WidgetRow = QueryResultRow & {
  configuration_jsonb: unknown;
  id: unknown;
};

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const parseConfiguration = (
  channelConnectionId: unknown,
  value: unknown,
): WidgetManagementConfiguration | null => {
  if (!isSchemaValue(ChannelConnectionIdSchema, channelConnectionId) || !isRecord(value))
    return null;
  const publishableKey = value["publishable_key"];
  const websiteOrigin = value["website_origin"];
  if (
    value["schema_version"] !== CONFIGURATION_SCHEMA_VERSION ||
    typeof publishableKey !== "string" ||
    !/^[A-Za-z0-9_-]{43}$/u.test(publishableKey) ||
    typeof websiteOrigin !== "string"
  ) {
    return null;
  }
  return Object.freeze({ channelConnectionId, publishableKey, websiteOrigin });
};

const issueChannelConnectionId = (
  identifiers: SecurityIdentifierFactory,
  now: Date,
): ChannelConnectionId => {
  const value: unknown = identifiers.issueResourceId(now);
  if (!isSchemaValue(ChannelConnectionIdSchema, value)) {
    throw new WidgetManagementError("validation_failed");
  }
  return value;
};

const appendAudit = async (
  session: TenantDbSession,
  identifiers: SecurityIdentifierFactory,
  actor: AuthorizationContext,
  channelConnectionId: ChannelConnectionId,
  now: Date,
): Promise<void> => {
  const auditId = identifiers.issueResourceId(now);
  const correlationId = identifiers.issueResourceId(now);
  await executeTenantQuery(session, (organizationId) => ({
    text: `insert into audit_events
      (id,organization_id,event_type,actor_type,actor_id,actor_membership_id,
       target_type,target_id,action,result,request_id,correlation_id,
       metadata_redacted_jsonb,occurred_at)
      values ($1,$2,'widget.configuration_updated','member',$3,$4,
              'channel_connection',$5,'widget.configuration_updated','succeeded',$6,$7,
              '{"source":"staff_integrations"}'::jsonb,$8)`,
    values: [
      auditId,
      organizationId,
      actor.userId,
      actor.membershipId,
      channelConnectionId,
      `widget:${auditId}`,
      correlationId,
      now,
    ],
  }));
};

const findConnection = async (session: TenantDbSession): Promise<WidgetRow | null> => {
  const result = await executeTenantQuery<WidgetRow>(session, (organizationId) => ({
    text: `select id, configuration_jsonb
             from channel_connections
            where organization_id = $1 and channel_type = 'widget'
              and lower(display_name) = lower($2)
            for update`,
    values: [organizationId, DISPLAY_NAME],
  }));
  return result.rows[0] ?? null;
};

export const createWidgetManagementStore = (
  runtime: TenantDatabaseRuntime,
  options: Readonly<{ identifierFactory?: SecurityIdentifierFactory }> = {},
): WidgetManagementStore => {
  const identifiers = options.identifierFactory ?? createSecurityIdentifierFactory();
  return Object.freeze<WidgetManagementStore>({
    configure: async (input) =>
      await runtime.withTenantTransaction(input.actor.organizationId, async (session) => {
        const existing = await findConnection(session);
        const channelConnectionId =
          existing === null
            ? issueChannelConnectionId(identifiers, input.now)
            : (parseConfiguration(existing.id, existing.configuration_jsonb)?.channelConnectionId ??
              (isSchemaValue(ChannelConnectionIdSchema, existing.id) ? existing.id : null));
        if (channelConnectionId === null) throw new WidgetManagementError("validation_failed");
        const configuration: WidgetConfiguration = Object.freeze({
          publishable_key: input.publishableKey,
          schema_version: 1,
          website_origin: input.websiteOrigin,
        });
        if (existing === null) {
          await executeTenantQuery(session, (organizationId) => ({
            text: `insert into channel_connections
              (id,organization_id,channel_type,status,display_name,configuration_jsonb,
               verified_at,credential_version,version,created_at,updated_at)
              values ($2,$1,'widget','active',$3,$4::jsonb,$5,1,1,$5,$5)`,
            values: [
              organizationId,
              channelConnectionId,
              DISPLAY_NAME,
              JSON.stringify(configuration),
              input.now,
            ],
          }));
        } else {
          await executeTenantQuery(session, (organizationId) => ({
            text: `update channel_connections
                      set status='active', configuration_jsonb=$3::jsonb, verified_at=$4,
                          version=version+1, updated_at=$4
                    where organization_id=$1 and id=$2 and channel_type='widget'`,
            values: [organizationId, channelConnectionId, JSON.stringify(configuration), input.now],
          }));
          await executeTenantQuery(session, (organizationId) => ({
            text: `update inbound_routes
                      set status='disabled', rotated_at=$3
                    where organization_id=$1 and channel_connection_id=$2
                      and route_type='widget_key' and status='active'`,
            values: [organizationId, channelConnectionId, input.now],
          }));
          await executeTenantQuery(session, (organizationId) => ({
            text: `update widget_allowed_origins
                      set status='disabled'
                    where organization_id=$1 and channel_connection_id=$2 and status='active'`,
            values: [organizationId, channelConnectionId],
          }));
        }
        const origin = new URL(input.websiteOrigin);
        const port = origin.port === "" ? null : Number(origin.port);
        const routeId = identifiers.issueResourceId(input.now);
        const allowedOriginId = identifiers.issueResourceId(input.now);
        await executeTenantQuery(session, (organizationId) => ({
          text: `insert into inbound_routes
            (id,route_type,route_key_hash,organization_id,channel_connection_id,status,created_at)
            values ($2,'widget_key',$3::bytea,$1,$4,'active',$5)`,
          values: [
            organizationId,
            routeId,
            Buffer.from(input.publishableKeyHash),
            channelConnectionId,
            input.now,
          ],
        }));
        await executeTenantQuery(session, (organizationId) => ({
          text: `insert into widget_allowed_origins
            (id,organization_id,channel_connection_id,match_type,scheme,normalized_host,
             port,status,created_by_user_id,created_at)
            values ($2,$1,$3,'exact','https',$4,$5,'active',$6,$7)
            on conflict (organization_id,channel_connection_id,match_type,scheme,
                         normalized_host,(coalesce(port,0)))
            do update set status='active'`,
          values: [
            organizationId,
            allowedOriginId,
            channelConnectionId,
            origin.hostname,
            port,
            input.actor.userId,
            input.now,
          ],
        }));
        await appendAudit(session, identifiers, input.actor, channelConnectionId, input.now);
        return Object.freeze({
          channelConnectionId,
          publishableKey: input.publishableKey,
          websiteOrigin: input.websiteOrigin,
        });
      }),
    get: async (actor) =>
      await runtime.withTenantTransaction(actor.organizationId, async (session) => {
        const result = await executeTenantQuery<WidgetRow>(session, (organizationId) => ({
          text: `select cc.id, cc.configuration_jsonb
                   from channel_connections cc
                  where cc.organization_id=$1 and cc.channel_type='widget'
                    and lower(cc.display_name)=lower($2) and cc.status='active'
                    and exists (
                      select 1 from inbound_routes ir
                       where ir.organization_id=cc.organization_id
                         and ir.channel_connection_id=cc.id
                         and ir.route_type='widget_key' and ir.status='active'
                    )
                    and exists (
                      select 1 from widget_allowed_origins wao
                       where wao.organization_id=cc.organization_id
                         and wao.channel_connection_id=cc.id and wao.status='active'
                    )`,
          values: [organizationId, DISPLAY_NAME],
        }));
        const row = result.rows[0];
        return row === undefined ? null : parseConfiguration(row.id, row.configuration_jsonb);
      }),
  });
};
