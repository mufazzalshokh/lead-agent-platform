import {
  type InternalOperationalAnalytics,
  type InternalTenantEconomics,
  type InternalTenantEconomicsStore,
  type TenantAnalyticsStore,
} from "@lead-agent/application";
import {
  StaffAnalyticsSchema,
  UtcTimestampSchema,
  isSchemaValue,
  type AnalyticsLatencySummary,
  type StaffAnalytics,
  type UtcTimestamp,
} from "@lead-agent/contracts";
import { summarizeLatencies, type OperationalMetrics } from "@lead-agent/observability";

import type { TenantDatabaseRuntime, TenantDbSession } from "../runtime/tenant.js";
import { executeTenantRead, RepositoryDataIntegrityError } from "./shared.js";
import { requireStaffActor } from "./staff-work.js";

type AnalyticsRow = Record<string, unknown>;

const safeNumber = (value: unknown): number => {
  let number: number;
  if (typeof value === "bigint") number = Number(value);
  else if (typeof value === "number") number = value;
  else if (typeof value === "string" && /^-?(?:0|[1-9]\d*)$/u.test(value)) number = Number(value);
  else throw new RepositoryDataIntegrityError();
  if (!Number.isSafeInteger(number)) throw new RepositoryDataIntegrityError();
  return number;
};
const safeBigInt = (value: unknown): bigint => {
  if (typeof value === "bigint" && value >= 0n) return value;
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return BigInt(value);
  if (typeof value === "string" && /^(?:0|[1-9]\d*)$/u.test(value)) return BigInt(value);
  throw new RepositoryDataIntegrityError();
};
const safeString = (value: unknown): string => {
  if (typeof value !== "string") throw new RepositoryDataIntegrityError();
  return value;
};
const safeChannel = (value: unknown): "widget" | "telegram" | "instagram" => {
  if (value !== "widget" && value !== "telegram" && value !== "instagram")
    throw new RepositoryDataIntegrityError();
  return value;
};
const timestamp = (value: string): UtcTimestamp => {
  const result: unknown = new Date(value).toISOString();
  if (!isSchemaValue(UtcTimestampSchema, result)) throw new RepositoryDataIntegrityError();
  return result;
};
const basisPoints = (numerator: number, denominator: number): number | null =>
  denominator === 0 ? null : Math.round((numerator * 10_000) / denominator);
const latency = (row: Readonly<Record<string, unknown>> | undefined): AnalyticsLatencySummary => {
  const value = (name: string): number | null =>
    row?.[name] === null || row?.[name] === undefined ? null : safeNumber(row[name]);
  return {
    count: value("count") ?? 0,
    p50_ms: value("p50_ms"),
    p75_ms: value("p75_ms"),
    p90_ms: value("p90_ms"),
    p95_ms: value("p95_ms"),
    p99_ms: value("p99_ms"),
    max_ms: value("max_ms"),
    within_3_seconds: value("within_3_seconds") ?? 0,
    within_5_seconds: value("within_5_seconds") ?? 0,
    within_10_seconds: value("within_10_seconds") ?? 0,
    within_30_seconds: value("within_30_seconds") ?? 0,
    within_60_seconds: value("within_60_seconds") ?? 0,
    over_60_seconds: value("over_60_seconds") ?? 0,
  };
};
const latencySql = (source: string) => `select count(*)::bigint as count,
  percentile_disc(0.50) within group(order by duration_ms)::bigint as p50_ms,
  percentile_disc(0.75) within group(order by duration_ms)::bigint as p75_ms,
  percentile_disc(0.90) within group(order by duration_ms)::bigint as p90_ms,
  percentile_disc(0.95) within group(order by duration_ms)::bigint as p95_ms,
  percentile_disc(0.99) within group(order by duration_ms)::bigint as p99_ms,
  max(duration_ms)::bigint as max_ms,
  count(*) filter(where duration_ms <= 3000)::bigint as within_3_seconds,
  count(*) filter(where duration_ms <= 5000)::bigint as within_5_seconds,
  count(*) filter(where duration_ms <= 10000)::bigint as within_10_seconds,
  count(*) filter(where duration_ms <= 30000)::bigint as within_30_seconds,
  count(*) filter(where duration_ms <= 60000)::bigint as within_60_seconds,
  count(*) filter(where duration_ms > 60000)::bigint as over_60_seconds from (${source}) observations`;

const platformObservationSql = (
  normal: boolean,
) => `select extract(epoch from (outbound.created_at-inbound.created_at))*1000 as duration_ms
  from messages inbound
  join lateral (select m.created_at,m.id from messages m
    where m.organization_id=$1 and m.conversation_id=inbound.conversation_id
      and m.direction='outbound' and m.sender_type in ('system','member')
      and m.content_type='text' and m.sequence_no>inbound.sequence_no
    order by m.sequence_no asc limit 1) outbound on true
  where inbound.organization_id=$1 and inbound.direction='inbound'
    and inbound.content_type in ('text','quick_reply') and inbound.created_at >= $2 and inbound.created_at < $3
    and outbound.created_at >= inbound.created_at
    ${normal ? "and not exists(select 1 from ai_runs ar where ar.organization_id=$1 and ar.trigger_message_id=inbound.id and ar.failure_category in ('provider_network','provider_rate_limit','provider_unavailable','timeout'))" : ""}`;

const externalObservationSql = (
  normal: boolean,
) => `select extract(epoch from (delivery.occurred_at-inbound.external_sent_at))*1000 as duration_ms
  from messages inbound
  join channel_connections cc on cc.organization_id=$1 and cc.id=inbound.channel_connection_id
  join lateral (select m.id,m.sequence_no from messages m
    where m.organization_id=$1 and m.conversation_id=inbound.conversation_id
      and m.direction='outbound' and m.content_type='text' and m.sequence_no>inbound.sequence_no
    order by m.sequence_no asc limit 1) outbound on true
  join lateral (select a.occurred_at from audit_events a
    where a.organization_id=$1 and a.target_type='message' and a.target_id=outbound.id
      and a.event_type in ('telegram.delivery_sent','instagram.delivery_sent')
    order by a.occurred_at asc limit 1) delivery on true
  where inbound.organization_id=$1 and inbound.direction='inbound'
    and inbound.content_type in ('text','quick_reply') and inbound.external_sent_at is not null
    and inbound.created_at >= $2 and inbound.created_at < $3
    and cc.channel_type in ('telegram','instagram') and delivery.occurred_at >= inbound.external_sent_at
    ${normal ? "and not exists(select 1 from ai_runs ar where ar.organization_id=$1 and ar.trigger_message_id=inbound.id and ar.failure_category in ('provider_network','provider_rate_limit','provider_unavailable','timeout'))" : ""}`;

const readReport = async (
  session: TenantDbSession,
  input: Parameters<TenantAnalyticsStore["read"]>[0],
  metrics?: OperationalMetrics,
): Promise<StaffAnalytics> => {
  await requireStaffActor(session, input.authorization, "analytics.read");
  const from = new Date(input.query.from),
    to = new Date(input.query.to),
    range = [from, to] as const;
  const organization = await executeTenantRead<AnalyticsRow>(
    session,
    "select default_time_zone from organizations where id=$1",
    [],
  );
  const timeZone = organization[0]?.["default_time_zone"];
  if (typeof timeZone !== "string") throw new RepositoryDataIntegrityError();
  const [funnelRow] = await executeTenantRead<AnalyticsRow>(
    session,
    `select
      (select count(*) from leads where organization_id=$1 and created_at >= $2 and created_at < $3)::bigint leads,
      (select count(distinct contact_id) from leads where organization_id=$1 and created_at >= $2 and created_at < $3)::bigint unique_contacts,
      (select count(*) from leads where organization_id=$1 and qualified_at >= $2 and qualified_at < $3)::bigint qualified_leads,
      (select count(*) from conversations where organization_id=$1 and started_at >= $2 and started_at < $3)::bigint conversations,
      (select count(*) from messages where organization_id=$1 and direction='inbound' and content_type in ('text','quick_reply') and created_at >= $2 and created_at < $3)::bigint inbound_meaningful_messages,
      (select count(*) from handoffs where organization_id=$1 and requested_at >= $2 and requested_at < $3)::bigint handoffs,
      (select count(*) from appointment_requests where organization_id=$1 and created_at >= $2 and created_at < $3)::bigint appointment_requests,
      (select count(distinct appointment_request_id) from appointment_request_transitions where organization_id=$1 and to_status='staff_accepted' and occurred_at >= $2 and occurred_at < $3)::bigint staff_accepted,
      (select count(distinct appointment_request_id) from appointment_request_transitions where organization_id=$1 and to_status='awaiting_customer_confirmation' and occurred_at >= $2 and occurred_at < $3)::bigint awaiting_customer_confirmation,
      (select count(*) from appointment_requests where organization_id=$1 and confirmed_at >= $2 and confirmed_at < $3)::bigint confirmed_appointments,
      (select count(*) from appointment_request_attendance where organization_id=$1 and is_current=true and outcome='attended' and coalesce(occurred_at,recorded_at) >= $2 and coalesce(occurred_at,recorded_at) < $3)::bigint attended`,
    range,
  );
  if (funnelRow === undefined) throw new RepositoryDataIntegrityError();
  const funnel = {
    appointment_requests: safeNumber(funnelRow["appointment_requests"]),
    attended: safeNumber(funnelRow["attended"]),
    awaiting_customer_confirmation: safeNumber(funnelRow["awaiting_customer_confirmation"]),
    confirmed_appointments: safeNumber(funnelRow["confirmed_appointments"]),
    conversations: safeNumber(funnelRow["conversations"]),
    handoffs: safeNumber(funnelRow["handoffs"]),
    inbound_meaningful_messages: safeNumber(funnelRow["inbound_meaningful_messages"]),
    leads: safeNumber(funnelRow["leads"]),
    qualified_leads: safeNumber(funnelRow["qualified_leads"]),
    staff_accepted: safeNumber(funnelRow["staff_accepted"]),
    unique_contacts: safeNumber(funnelRow["unique_contacts"]),
  };
  const [conversionRow] = await executeTenantRead<AnalyticsRow>(
    session,
    `select
      (select count(*) from leads where organization_id=$1 and created_at >= $2 and created_at < $3)::bigint lead_cohort,
      (select count(distinct l.id) from leads l join appointment_requests a on a.organization_id=$1 and a.lead_id=l.id where l.organization_id=$1 and l.created_at >= $2 and l.created_at < $3 and a.created_at < $3)::bigint lead_with_request,
      (select count(distinct l.id) from leads l join appointment_requests a on a.organization_id=$1 and a.lead_id=l.id where l.organization_id=$1 and l.created_at >= $2 and l.created_at < $3 and a.confirmed_at < $3)::bigint lead_with_confirmation,
      (select count(distinct l.id) from leads l join appointment_requests a on a.organization_id=$1 and a.lead_id=l.id join appointment_request_attendance aa on aa.organization_id=$1 and aa.appointment_request_id=a.id and aa.is_current=true and aa.outcome='attended' where l.organization_id=$1 and l.created_at >= $2 and l.created_at < $3 and coalesce(aa.occurred_at,aa.recorded_at) < $3)::bigint lead_with_attendance,
      (select count(*) from appointment_requests where organization_id=$1 and created_at >= $2 and created_at < $3)::bigint appointment_cohort,
      (select count(distinct a.id) from appointment_requests a join appointment_request_transitions t on t.organization_id=$1 and t.appointment_request_id=a.id and t.to_status='staff_accepted' and t.occurred_at < $3 where a.organization_id=$1 and a.created_at >= $2 and a.created_at < $3)::bigint appointment_staff_accepted,
      (select count(*) from appointment_requests where organization_id=$1 and created_at >= $2 and created_at < $3 and confirmed_at < $3)::bigint appointment_confirmed,
      (select count(distinct appointment_request_id) from appointment_request_transitions where organization_id=$1 and to_status='staff_accepted' and occurred_at >= $2 and occurred_at < $3)::bigint accepted_cohort,
      (select count(distinct t.appointment_request_id) from appointment_request_transitions t join appointment_requests a on a.organization_id=$1 and a.id=t.appointment_request_id where t.organization_id=$1 and t.to_status='staff_accepted' and t.occurred_at >= $2 and t.occurred_at < $3 and a.confirmed_at < $3)::bigint accepted_confirmed,
      (select count(*) from appointment_requests where organization_id=$1 and confirmed_at >= $2 and confirmed_at < $3)::bigint confirmed_cohort,
      (select count(distinct a.id) from appointment_requests a join appointment_request_attendance aa on aa.organization_id=$1 and aa.appointment_request_id=a.id and aa.is_current=true and aa.outcome='attended' where a.organization_id=$1 and a.confirmed_at >= $2 and a.confirmed_at < $3 and coalesce(aa.occurred_at,aa.recorded_at) < $3)::bigint confirmed_attended`,
    range,
  );
  if (conversionRow === undefined) throw new RepositoryDataIntegrityError();
  const conversion = {
    accepted_cohort: safeNumber(conversionRow["accepted_cohort"]),
    accepted_confirmed: safeNumber(conversionRow["accepted_confirmed"]),
    appointment_cohort: safeNumber(conversionRow["appointment_cohort"]),
    appointment_confirmed: safeNumber(conversionRow["appointment_confirmed"]),
    appointment_staff_accepted: safeNumber(conversionRow["appointment_staff_accepted"]),
    confirmed_attended: safeNumber(conversionRow["confirmed_attended"]),
    confirmed_cohort: safeNumber(conversionRow["confirmed_cohort"]),
    lead_cohort: safeNumber(conversionRow["lead_cohort"]),
    lead_with_attendance: safeNumber(conversionRow["lead_with_attendance"]),
    lead_with_confirmation: safeNumber(conversionRow["lead_with_confirmation"]),
    lead_with_request: safeNumber(conversionRow["lead_with_request"]),
  };
  const channelRows = await executeTenantRead<AnalyticsRow>(
    session,
    `with channels(channel) as (values ('widget'),('telegram'),('instagram'))
     select channel,
      (select count(*) from leads l join channel_connections cc on cc.organization_id=$1 and cc.id=l.source_channel_connection_id where l.organization_id=$1 and cc.channel_type=channel and l.created_at >= $2 and l.created_at < $3)::bigint leads,
      (select count(*) from conversations c join channel_connections cc on cc.organization_id=$1 and cc.id=c.channel_connection_id where c.organization_id=$1 and cc.channel_type=channel and c.started_at >= $2 and c.started_at < $3)::bigint conversations,
      (select count(*) from messages m join channel_connections cc on cc.organization_id=$1 and cc.id=m.channel_connection_id where m.organization_id=$1 and cc.channel_type=channel and m.direction='inbound' and m.content_type in ('text','quick_reply') and m.created_at >= $2 and m.created_at < $3)::bigint inbound_meaningful_messages,
      (select count(*) from appointment_requests a join conversations c on c.organization_id=$1 and c.id=a.conversation_id join channel_connections cc on cc.organization_id=$1 and cc.id=c.channel_connection_id where a.organization_id=$1 and cc.channel_type=channel and a.created_at >= $2 and a.created_at < $3)::bigint appointment_requests,
      (select count(*) from appointment_requests a join conversations c on c.organization_id=$1 and c.id=a.conversation_id join channel_connections cc on cc.organization_id=$1 and cc.id=c.channel_connection_id where a.organization_id=$1 and cc.channel_type=channel and a.confirmed_at >= $2 and a.confirmed_at < $3)::bigint confirmed_appointments
     from channels order by channel`,
    range,
  );
  const dailyRows = await executeTenantRead<AnalyticsRow>(
    session,
    `select local_date,
      count(*) filter(where kind='lead')::bigint leads,
      count(*) filter(where kind='appointment')::bigint appointment_requests,
      count(*) filter(where kind='confirmed')::bigint confirmed_appointments
     from (
      select to_char(created_at at time zone $4,'YYYY-MM-DD') local_date,'lead' kind from leads where organization_id=$1 and created_at >= $2 and created_at < $3
      union all select to_char(created_at at time zone $4,'YYYY-MM-DD'),'appointment' from appointment_requests where organization_id=$1 and created_at >= $2 and created_at < $3
      union all select to_char(confirmed_at at time zone $4,'YYYY-MM-DD'),'confirmed' from appointment_requests where organization_id=$1 and confirmed_at >= $2 and confirmed_at < $3
     ) activity group by local_date order by local_date`,
    [from, to, timeZone],
  );
  const revenueRows = await executeTenantRead<AnalyticsRow>(
    session,
    `select currency,sum(case when entry_type='reversal' then -amount_minor else amount_minor end)::bigint amount_minor
     from appointment_revenue_attributions where organization_id=$1 and recognized_at >= $2 and recognized_at < $3 group by currency order by currency`,
    range,
  );
  const [usageRow] = await executeTenantRead<AnalyticsRow>(
    session,
    `select count(distinct trigger_message_id) filter(where status='succeeded')::bigint automated_messages
     from ai_runs where organization_id=$1 and started_at >= $2 and started_at < $3`,
    range,
  );
  const [platformRaw, platformNormal, externalRaw, externalNormal] = await Promise.all([
    executeTenantRead<AnalyticsRow>(session, latencySql(platformObservationSql(false)), range),
    executeTenantRead<AnalyticsRow>(session, latencySql(platformObservationSql(true)), range),
    executeTenantRead<AnalyticsRow>(session, latencySql(externalObservationSql(false)), range),
    executeTenantRead<AnalyticsRow>(session, latencySql(externalObservationSql(true)), range),
  ]);
  const widget = metrics?.widgetMeaningfulLatency(session.organizationId) ?? summarizeLatencies([]);
  const widgetLatency: AnalyticsLatencySummary = {
    count: widget.count,
    p50_ms: widget.p50Ms,
    p75_ms: widget.p75Ms,
    p90_ms: widget.p90Ms,
    p95_ms: widget.p95Ms,
    p99_ms: widget.p99Ms,
    max_ms: widget.maximumMs,
    within_3_seconds: widget.within3Seconds,
    within_5_seconds: widget.within5Seconds,
    within_10_seconds: widget.within10Seconds,
    within_30_seconds: widget.within30Seconds,
    within_60_seconds: widget.within60Seconds,
    over_60_seconds: widget.over60Seconds,
  };
  const automatedMessages = safeNumber(usageRow?.["automated_messages"] ?? 0);
  const report: StaffAnalytics = {
    range: {
      from: timestamp(input.query.from),
      to: timestamp(input.query.to),
      time_zone: timeZone,
      boundary: "from_inclusive_to_exclusive",
    },
    funnel,
    conversion_basis_points: {
      appointment_request_to_staff_accepted: basisPoints(
        conversion.appointment_staff_accepted,
        conversion.appointment_cohort,
      ),
      appointment_request_to_confirmed: basisPoints(
        conversion.appointment_confirmed,
        conversion.appointment_cohort,
      ),
      confirmed_to_attended: basisPoints(
        conversion.confirmed_attended,
        conversion.confirmed_cohort,
      ),
      lead_to_appointment_request: basisPoints(
        conversion.lead_with_request,
        conversion.lead_cohort,
      ),
      lead_to_attended: basisPoints(conversion.lead_with_attendance, conversion.lead_cohort),
      lead_to_confirmed: basisPoints(conversion.lead_with_confirmation, conversion.lead_cohort),
      staff_accepted_to_confirmed: basisPoints(
        conversion.accepted_confirmed,
        conversion.accepted_cohort,
      ),
    },
    channels: channelRows.map((row) => ({
      channel: safeChannel(row["channel"]),
      appointment_requests: safeNumber(row["appointment_requests"]),
      confirmed_appointments: safeNumber(row["confirmed_appointments"]),
      conversations: safeNumber(row["conversations"]),
      inbound_meaningful_messages: safeNumber(row["inbound_meaningful_messages"]),
      leads: safeNumber(row["leads"]),
    })),
    daily: dailyRows.map((row) => ({
      local_date: safeString(row["local_date"]),
      appointment_requests: safeNumber(row["appointment_requests"]),
      confirmed_appointments: safeNumber(row["confirmed_appointments"]),
      leads: safeNumber(row["leads"]),
    })),
    latency: {
      acknowledgement: latency(undefined),
      external_message_to_submit_raw: latency(externalRaw[0]),
      external_message_to_submit_normal_availability: latency(externalNormal[0]),
      platform_meaningful_raw: latency(platformRaw[0]),
      platform_meaningful_normal_availability: latency(platformNormal[0]),
      widget_customer_render: widgetLatency,
    },
    usage: {
      automated_messages: automatedMessages,
      automation_rate_basis_points: basisPoints(
        automatedMessages,
        funnel.inbound_meaningful_messages,
      ),
    },
    recorded_attributed_revenue: {
      available: revenueRows.length > 0,
      amounts: revenueRows.map((row) => ({
        amount_minor: safeNumber(row["amount_minor"]),
        currency: safeString(row["currency"]),
      })),
    },
  };
  if (!isSchemaValue(StaffAnalyticsSchema, report)) throw new RepositoryDataIntegrityError();
  return report;
};

export const createTenantAnalyticsStore = (
  runtime: TenantDatabaseRuntime,
  metrics?: OperationalMetrics,
): TenantAnalyticsStore =>
  Object.freeze({
    read: (input: Parameters<TenantAnalyticsStore["read"]>[0]) =>
      runtime.withTenantTransaction(input.authorization.organizationId, (session) =>
        readReport(session, input, metrics),
      ),
  });

const unitCost = (cost: bigint, denominator: bigint): bigint | null =>
  denominator === 0n ? null : (cost + denominator - 1n) / denominator;

const nullableSafeNumber = (value: unknown): number | null =>
  value === null || value === undefined ? null : safeNumber(value);

export const createInternalTenantEconomicsStore = (
  runtime: TenantDatabaseRuntime,
): InternalTenantEconomicsStore =>
  Object.freeze({
    readInternalEconomics: (
      input: Parameters<InternalTenantEconomicsStore["readInternalEconomics"]>[0],
    ) =>
      runtime.withTenantTransaction(
        input.organizationId,
        async (session): Promise<InternalTenantEconomics> => {
          const [row] = await executeTenantRead<AnalyticsRow>(
            session,
            `select coalesce(sum(estimated_cost_micros),0)::bigint known_cost,
            count(*) filter(where estimated_cost_micros is null)::bigint unknown_runs,
            (select count(*) from conversations where organization_id=$1 and started_at >= $2 and started_at < $3)::bigint conversations,
            (select count(*) from leads where organization_id=$1 and created_at >= $2 and created_at < $3)::bigint leads,
            (select count(*) from appointment_requests where organization_id=$1 and created_at >= $2 and created_at < $3)::bigint appointments,
            (select count(*) from appointment_requests where organization_id=$1 and confirmed_at >= $2 and confirmed_at < $3)::bigint confirmed
           from ai_runs where organization_id=$1 and started_at >= $2 and started_at < $3`,
            [input.from, input.to],
          );
          if (row === undefined) throw new RepositoryDataIntegrityError();
          const knownCost = safeBigInt(row["known_cost"]),
            unknown = safeNumber(row["unknown_runs"]),
            complete = unknown === 0;
          return Object.freeze({
            attributableInfrastructureCostMicros: null,
            contributionMarginBasisPoints: null,
            contributionMicros: null,
            costPerAppointmentRequestMicros: complete
              ? unitCost(knownCost, safeBigInt(row["appointments"]))
              : null,
            costPerConfirmedAppointmentMicros: complete
              ? unitCost(knownCost, safeBigInt(row["confirmed"]))
              : null,
            costPerConversationMicros: complete
              ? unitCost(knownCost, safeBigInt(row["conversations"]))
              : null,
            costPerLeadMicros: complete ? unitCost(knownCost, safeBigInt(row["leads"])) : null,
            knownProviderCostMicros: knownCost,
            providerCostComplete: complete,
            projectedCostPerThousandConversationsMicros: complete
              ? unitCost(knownCost * 1_000n, safeBigInt(row["conversations"]))
              : null,
            subscriptionRevenueMicros: null,
            unknownCostRunCount: unknown,
          });
        },
      ),
    readInternalOperations: (
      input: Parameters<InternalTenantEconomicsStore["readInternalOperations"]>[0],
    ) =>
      runtime.withTenantTransaction(
        input.organizationId,
        async (session): Promise<InternalOperationalAnalytics> => {
          const providerRows = await executeTenantRead<AnalyticsRow>(
            session,
            `select provider_id,coalesce(provider_resolved_model_id,requested_model_id) model,
            count(*)::bigint calls,
            count(*) filter(where status='succeeded')::bigint successes,
            count(*) filter(where status not in ('started','succeeded'))::bigint failures,
            count(*) filter(where attempt_no > 1)::bigint repairs_or_retries,
            case when count(*) filter(where input_units is null) = 0 then coalesce(sum(input_units),0)::bigint else null end input_tokens,
            case when count(*) filter(where output_units is null) = 0 then coalesce(sum(output_units),0)::bigint else null end output_tokens,
            (percentile_disc(0.50) within group(order by latency_ms) filter(where latency_ms is not null))::bigint latency_p50_ms,
            (percentile_disc(0.95) within group(order by latency_ms) filter(where latency_ms is not null))::bigint latency_p95_ms,
            (percentile_disc(0.99) within group(order by latency_ms) filter(where latency_ms is not null))::bigint latency_p99_ms
           from ai_runs where organization_id=$1 and started_at >= $2 and started_at < $3
           group by provider_id,coalesce(provider_resolved_model_id,requested_model_id)
           order by provider_id,model`,
            [input.from, input.to],
          );
          const [queueRow] = await executeTenantRead<AnalyticsRow>(
            session,
            `select count(*) filter(where status='pending')::bigint pending,
            count(*) filter(where status='processing')::bigint processing,
            count(*) filter(where status='dead_lettered')::bigint dead_lettered,
            count(*) filter(where attempt_count > 0)::bigint retried,
            case when min(available_at) filter(where status='pending' and available_at <= $2) is null then null
              else greatest(0,extract(epoch from ($2-min(available_at) filter(where status='pending' and available_at <= $2)))*1000)::bigint end oldest_ready_lag_ms
           from outbox_events where organization_id=$1`,
            [input.now],
          );
          const [outboundRow] = await executeTenantRead<AnalyticsRow>(
            session,
            `select
            count(*) filter(where event_type='telegram.delivery_sent')::bigint telegram_submissions,
            count(*) filter(where event_type='telegram.delivery_failed')::bigint telegram_failures,
            count(*) filter(where event_type='instagram.delivery_sent')::bigint instagram_submissions,
            count(*) filter(where event_type='instagram.delivery_failed')::bigint instagram_failures
           from audit_events where organization_id=$1 and occurred_at >= $2 and occurred_at < $3`,
            [input.from, input.to],
          );
          if (queueRow === undefined || outboundRow === undefined)
            throw new RepositoryDataIntegrityError();
          return Object.freeze({
            outbound: Object.freeze({
              instagramFailures: safeNumber(outboundRow["instagram_failures"]),
              instagramSubmissions: safeNumber(outboundRow["instagram_submissions"]),
              telegramFailures: safeNumber(outboundRow["telegram_failures"]),
              telegramSubmissions: safeNumber(outboundRow["telegram_submissions"]),
            }),
            providers: Object.freeze(
              providerRows.map((row) =>
                Object.freeze({
                  calls: safeNumber(row["calls"]),
                  failures: safeNumber(row["failures"]),
                  inputTokens:
                    row["input_tokens"] === null ? null : safeBigInt(row["input_tokens"]),
                  latencyP50Ms: nullableSafeNumber(row["latency_p50_ms"]),
                  latencyP95Ms: nullableSafeNumber(row["latency_p95_ms"]),
                  latencyP99Ms: nullableSafeNumber(row["latency_p99_ms"]),
                  model: safeString(row["model"]),
                  outputTokens:
                    row["output_tokens"] === null ? null : safeBigInt(row["output_tokens"]),
                  provider: safeString(row["provider_id"]),
                  repairsOrRetries: safeNumber(row["repairs_or_retries"]),
                  successes: safeNumber(row["successes"]),
                }),
              ),
            ),
            queue: Object.freeze({
              deadLettered: safeNumber(queueRow["dead_lettered"]),
              oldestReadyLagMs: nullableSafeNumber(queueRow["oldest_ready_lag_ms"]),
              pending: safeNumber(queueRow["pending"]),
              processing: safeNumber(queueRow["processing"]),
              retried: safeNumber(queueRow["retried"]),
            }),
          });
        },
      ),
  });
