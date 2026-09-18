import {
  staffReadPermission,
  StaffOperationError,
  type StaffOperationsStore,
  type StaffPosition,
  type StaffWorkKind,
} from "@lead-agent/application";
import {
  StaffWorkItemSchema,
  StaffOutcomeSchema,
  isSchemaValue,
  type StaffWorkItem,
  type StaffOutcome,
  type ResourceId,
  type StaffWorkListQuery,
} from "@lead-agent/contracts";
import {
  hasPermission,
  isAuthorizationContext,
  type AuthorizationContext,
  type TenantPermission,
} from "@lead-agent/security";
import type { TenantDbSession } from "../runtime/tenant.js";
import { executeTenantRead, mapLocationId, mapUtcTimestamp } from "./shared.js";

/** Recheck the trusted membership inside the same transaction as each read/write. */
export const requireStaffActor = async (
  session: TenantDbSession,
  authorization: AuthorizationContext,
  permission: TenantPermission,
): Promise<void> => {
  if (
    !isAuthorizationContext(authorization) ||
    session.organizationId !== authorization.organizationId ||
    !hasPermission(authorization.role, permission)
  )
    throw new StaffOperationError("permission_denied");
  const rows = await executeTenantRead(
    session,
    `select user_id::text,status,role,location_scope from memberships where organization_id=$1 and id=$2 for share`,
    [authorization.membershipId],
  );
  const actor = rows[0];
  if (
    actor === undefined ||
    actor["user_id"] !== authorization.userId ||
    actor["status"] !== "active" ||
    actor["role"] !== authorization.role ||
    actor["location_scope"] !== authorization.locationScope
  )
    throw new StaffOperationError("permission_denied");
  if (authorization.locationScope === "restricted") {
    const scopes = await executeTenantRead(
      session,
      `select location_id from membership_location_scopes where organization_id=$1 and membership_id=$2 order by location_id`,
      [authorization.membershipId],
    );
    if (
      JSON.stringify(scopes.map((row) => mapLocationId(row["location_id"]))) !==
      JSON.stringify([...authorization.allowedLocationIds].sort())
    )
      throw new StaffOperationError("permission_denied");
  }
};

const currentRequest = `left join lateral (select request.* from appointment_requests request where request.organization_id=$1 and request.conversation_id=c.id order by request.created_at desc,request.id desc limit 1) a on true`;
const joins = {
  conversation: `from conversations c join leads l on l.organization_id=c.organization_id and l.id=c.lead_id left join handoffs h on h.organization_id=c.organization_id and h.id=c.active_handoff_id ${currentRequest}`,
  handoff: `from handoffs h join conversations c on c.organization_id=h.organization_id and c.id=h.conversation_id join leads l on l.organization_id=c.organization_id and l.id=c.lead_id ${currentRequest}`,
  appointment_request: `from appointment_requests a join conversations c on c.organization_id=a.organization_id and c.id=a.conversation_id join leads l on l.organization_id=c.organization_id and l.id=c.lead_id left join handoffs h on h.organization_id=c.organization_id and h.id=c.active_handoff_id`,
  notification: `from notifications n
    left join handoffs nh on nh.organization_id=n.organization_id and n.related_resource_type='handoff' and nh.id=n.related_resource_id
    left join appointment_requests a on a.organization_id=n.organization_id and n.related_resource_type='appointment_request' and a.id=n.related_resource_id
    left join conversations c on c.organization_id=n.organization_id and c.id=case when n.related_resource_type='conversation' then n.related_resource_id else coalesce(nh.conversation_id,a.conversation_id) end
    left join leads l on l.organization_id=n.organization_id and l.id=case when n.related_resource_type='lead' then n.related_resource_id else c.lead_id end
    left join handoffs h on h.organization_id=n.organization_id and h.id=coalesce(nh.id,c.active_handoff_id)`,
} as const;
const aliases = {
  conversation: "c",
  handoff: "h",
  appointment_request: "a",
  notification: "n",
} as const;
const times = {
  conversation: "c.last_activity_at",
  handoff: "h.requested_at",
  appointment_request: "a.created_at",
  notification: "n.created_at",
} as const;
const activeHandoff = "h.status in ('requested','assigned','in_progress')";
const actionable = (kind: StaffWorkKind): string =>
  kind === "appointment_request"
    ? "a.status='requested'"
    : kind === "handoff"
      ? activeHandoff
      : `coalesce(c.status='awaiting_staff' or ${activeHandoff} or a.status='requested',false)`;
const location = (kind: StaffWorkKind): string =>
  kind === "appointment_request"
    ? "a.location_id"
    : kind === "notification"
      ? "case when n.related_resource_type='appointment_request' then a.location_id when n.related_resource_type='handoff' then nh.location_id else l.location_id end"
      : kind === "handoff"
        ? "h.location_id"
        : "l.location_id";
const projection = (kind: StaffWorkKind) => {
  const alias = aliases[kind];
  return `select ${alias}.id,${alias}.status,${alias}.version,${times[kind]} as activity_at,${actionable(kind)} as actionable,
    c.id as conversation_id,c.contact_id,c.lead_id,c.channel_connection_id,c.version as conversation_version,
    ${location(kind)} as location_id,coalesce(a.service_id,l.service_id) as service_id,
    h.id as handoff_id,h.status as handoff_status,h.assigned_membership_id,
    a.id as appointment_request_id,a.status as appointment_status,a.start_at,a.end_at,
    ${kind === "notification" ? "case when n.audience_type='membership' then n.read_at else null end as recipient_read_at,n.audience_type='membership' as acknowledgment_supported" : "null::timestamptz as recipient_read_at,false as acknowledgment_supported"},
    coalesce(p.preferences,'[]'::jsonb) as preferences ${joins[kind]}
    left join lateral (select jsonb_agg(jsonb_build_object('start_at',to_char(pref.start_at at time zone 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"'),'end_at',to_char(pref.end_at at time zone 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"'),'time_zone',pref.time_zone,'local_start',pref.local_start,'precision',pref.precision) order by pref.preference_order) as preferences
      from (select * from appointment_request_preferences where organization_id=$1 and appointment_request_id=a.id order by preference_order,id limit 20) pref) p on true`;
};
const item = (kind: StaffWorkKind, row: Readonly<Record<string, unknown>>): StaffWorkItem => {
  const nullableTime = (value: unknown) => (value === null ? null : mapUtcTimestamp(value));
  const value = {
    id: row["id"],
    kind,
    status: row["status"],
    version: Number(row["version"]),
    actionable: row["actionable"],
    activity_at: mapUtcTimestamp(row["activity_at"]),
    conversation_id: row["conversation_id"],
    contact_id: row["contact_id"],
    lead_id: row["lead_id"],
    channel_connection_id: row["channel_connection_id"],
    location_id: row["location_id"],
    service_id: row["service_id"],
    assigned_membership_id: row["assigned_membership_id"],
    conversation_version:
      row["conversation_version"] === null ? null : Number(row["conversation_version"]),
    handoff_id: row["handoff_id"],
    handoff_status: row["handoff_status"],
    appointment_request_id: row["appointment_request_id"],
    appointment_status: row["appointment_status"],
    preferences: row["preferences"],
    start_at: nullableTime(row["start_at"]),
    end_at: nullableTime(row["end_at"]),
    recipient_read_at: nullableTime(row["recipient_read_at"]),
    acknowledgment_supported: row["acknowledgment_supported"],
  };
  if (!isSchemaValue(StaffWorkItemSchema, value))
    throw new TypeError("Invalid private staff work projection");
  return value;
};
export const readStaffWork = async (
  session: TenantDbSession,
  authorization: AuthorizationContext,
  kind: StaffWorkKind,
  input: Readonly<{
    id?: ResourceId;
    query?: StaffWorkListQuery;
    after?: StaffPosition | null;
    limit: number;
  }>,
): Promise<Readonly<{ items: readonly StaffWorkItem[]; next: StaffPosition | null }>> => {
  await requireStaffActor(session, authorization, staffReadPermission(kind));
  const alias = aliases[kind],
    values: unknown[] = [],
    conditions = [`${alias}.organization_id=$1`];
  const add = (sql: string, value: unknown) => {
    values.push(value);
    conditions.push(sql.replace("?", `$${values.length + 1}`));
  };
  if (authorization.locationScope === "restricted")
    add(`${location(kind)}=any(?::uuid[])`, authorization.allowedLocationIds);
  if (kind === "notification") {
    add(
      "(n.audience_type='membership' and n.recipient_membership_id=? or n.audience_type='queue')",
      authorization.membershipId,
    );
    // The private inbox projects staff audiences/types, not delivery-attempt adapters.
    conditions.push("n.notification_type in ('staff_task','staff_alert')");
  }
  if (input.id !== undefined) add(`${alias}.id=?`, input.id);
  if (input.query !== undefined) {
    conditions.push(
      input.query.view === "history" ? `not (${actionable(kind)})` : actionable(kind),
    );
    if (input.query.location_id !== undefined) add(`${location(kind)}=?`, input.query.location_id);
  }
  if (input.after != null) {
    values.push(input.after.at, input.after.id);
    conditions.push(
      `(${times[kind]},${alias}.id)<($${values.length}::timestamptz,$${values.length + 1}::uuid)`,
    );
  }
  values.push(input.limit + 1);
  const rows = await executeTenantRead(
    session,
    `${projection(kind)} where ${conditions.join(" and ")} order by ${times[kind]} desc,${alias}.id desc limit $${values.length + 1}`,
    values,
  );
  const items = rows.slice(0, input.limit).map((row) => item(kind, row)),
    last = items.at(-1);
  return {
    items,
    next:
      rows.length > input.limit && last !== undefined
        ? { at: last.activity_at, id: last.id }
        : null,
  };
};
export const getStaffWork = async (
  session: TenantDbSession,
  authorization: AuthorizationContext,
  kind: StaffWorkKind,
  id: ResourceId,
): Promise<StaffWorkItem> => {
  const value = (await readStaffWork(session, authorization, kind, { id, limit: 1 })).items[0];
  if (value === undefined) throw new StaffOperationError("resource_not_found");
  return value;
};
export const readStaffOutcomes = async (
  session: TenantDbSession,
  input: Parameters<StaffOperationsStore["outcomes"]>[0],
) => {
  await getStaffWork(session, input.authorization, "appointment_request", input.id);
  const attendance = input.kind === "attendance",
    table = attendance ? "appointment_request_attendance" : "appointment_revenue_attributions";
  const values: unknown[] = [input.id];
  let after = "";
  if (input.after !== null) {
    values.push(input.after.at, input.after.id);
    after = "and (recorded_at,id)<($3::timestamptz,$4::uuid)";
  }
  values.push(input.limit + 1);
  const rows = await executeTenantRead(
    session,
    `select id,appointment_request_id,recorded_at,recorded_by_membership_id,reason_code,
    ${attendance ? "outcome,is_current,supersedes_id,null::bigint as amount_minor,null::text as currency,null::text as entry_type" : "null::text as outcome,null::boolean as is_current,reverses_attribution_id as supersedes_id,amount_minor,currency,entry_type"}
    from ${table} where organization_id=$1 and appointment_request_id=$2 ${after} order by recorded_at desc,id desc limit $${values.length + 1}`,
    values,
  );
  const items: StaffOutcome[] = rows.slice(0, input.limit).map((row) => {
    const value = {
      ...row,
      kind: input.kind,
      recorded_at: mapUtcTimestamp(row["recorded_at"]),
      amount_minor: row["amount_minor"] === null ? null : Number(row["amount_minor"]),
    };
    if (!isSchemaValue(StaffOutcomeSchema, value))
      throw new TypeError("Invalid staff outcome projection");
    return value;
  });
  const last = items.at(-1);
  return {
    items,
    next:
      rows.length > input.limit && last !== undefined
        ? { at: last.recorded_at, id: last.id }
        : null,
  };
};
