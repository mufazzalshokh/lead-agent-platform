import {
  S22WidgetCohortError,
  StaffOperationError,
  type AIWorkReference,
  type AIRunReservation,
  type S22WidgetCohortStore,
} from "@lead-agent/application";
import {
  COMMERCIAL_V1_AI_PROFILE,
  S22_WIDGET_ALLOWANCE,
  S22_BOOKING_COHORT,
  S22_WIDGET_SELECTION_ENVELOPE,
  type AIJourneyCohortConfig,
} from "@lead-agent/config";
import {
  ConversationIdSchema,
  MessageIdSchema,
  OrganizationIdSchema,
  ResourceIdSchema,
  S22WidgetCohortCandidateSchema,
  S22WidgetCohortSelectInputSchema,
  S22WidgetCohortStatusSchema,
  S22WidgetCohortSelectionReceiptSchema,
  isSchemaValue,
  type OrganizationId,
} from "@lead-agent/contracts";
import { resolveAIPrice } from "@lead-agent/observability";
import {
  createSecurityIdentifierFactory,
  isAuthorizationContext,
  type AuthorizationContext,
} from "@lead-agent/security";
import type { TenantDatabaseRuntime, TenantDbSession } from "../runtime/tenant.js";
import {
  executeTenantRead,
  executeTenantWrite,
  mapSafeBigInt,
  mapString,
  mapUtcTimestamp,
  RepositoryDataIntegrityError,
} from "./shared.js";
import { requireStaffActor } from "./staff-work.js";

const RESERVED = "ai_run.dispatch_reserved";
const STARTED = "ai_run.journey_started";
const WIDGET_BOUND = "ai_run.widget_journey_bound";
const OWNER_SELECTED = "ai_run.widget_cohort_selected";
type OwnerSelection = Readonly<{
  sessionId: string;
  version: number;
  predecessor: number;
  actorId: string;
  membershipId: string;
}>;
type WidgetBinding = Readonly<{
  conversationId: string | null;
  contactId: string | null;
  inboundMessageIds: readonly string[];
}>;

export type AIJourneyBudgetSnapshot = Readonly<{
  profile: string;
  mode: AIJourneyCohortConfig["mode"];
  physicalCalls: number;
  logicalMessages: number;
  knownCostMicros: string;
  unresolvedReserveMicros: string;
  historicalReserveMicros: string;
  combinedExposureMicros: string;
  perCallReserveMicros: string | null;
  accountingComplete: false;
  /** Blocks a new logical message. A current message's separately reserved
   * repair is decided by authorizeDispatch, never by this read-only snapshot. */
  blocked: boolean;
  reason: string | null;
  widget?: Readonly<{
    sessionId: string;
    conversationId: string | null;
    physicalCalls: number;
    logicalMessages: number;
    /** All persisted customer inbounds, including confirmations that need no provider. */
    customerMessages: number;
    knownCostMicros: string;
    unresolvedReserveMicros: string;
  }>;
}>;

/** No new billing table or permission. Immutable tenant audit markers are the
 * durable dispatch ledger; original provider usage/cost columns are never edited. */
export const createAIJourneyBudgetGuard = (
  runtime: TenantDatabaseRuntime,
  configuration: AIJourneyCohortConfig,
  clock: () => Date = () => new Date(),
  options: Readonly<{ ownerSelection?: boolean }> = {},
) => {
  const config = Object.freeze({
    ...configuration,
    historicalRunIds: Object.freeze([...configuration.historicalRunIds]),
  });
  if (
    !["paused", "booking", "widget_booking"].includes(config.mode) ||
    (config.mode === "widget_booking"
      ? !isSchemaValue(ResourceIdSchema, config.widgetSessionId)
      : config.widgetSessionId !== undefined) ||
    config.profile !== "s22-synthetic-booking.v1" ||
    !isSchemaValue(OrganizationIdSchema, config.organizationId) ||
    !isSchemaValue(ConversationIdSchema, config.conversationId) ||
    config.historicalRunIds.some((id) => !isSchemaValue(ResourceIdSchema, id)) ||
    new Set(config.historicalRunIds).size !== config.historicalRunIds.length ||
    config.historicalRunIds.length > 2 ||
    config.historicalReserveMicros < 0n ||
    config.hardCeilingMicros > 10_000_000n ||
    config.hardCeilingMicros <= config.historicalReserveMicros ||
    config.maximumCalls !== 5 ||
    config.maximumMessages !== 4 ||
    config.maximumCallsPerMessage !== 2 ||
    config.inputTokenLimit !== 1_048_576 ||
    config.outputTokenLimit !== COMMERCIAL_V1_AI_PROFILE.maxOutputTokens ||
    config.validUntil !== "2027-01-01T00:00:00Z"
  )
    throw new TypeError("Invalid internal AI journey profile");
  const organizationId = config.organizationId;
  // Copy trusted configuration so mutation by a caller cannot reset/widen a cohort.
  const baseline = Object.freeze([...config.historicalRunIds]);
  const widgetSessionId = config.widgetSessionId;
  const ownerSelection = options.ownerSelection === true;
  if (
    ownerSelection &&
    (config.mode !== "widget_booking" ||
      widgetSessionId !== S22_WIDGET_SELECTION_ENVELOPE.anchorSessionId ||
      config.organizationId !== S22_BOOKING_COHORT.organizationId ||
      config.conversationId !== S22_BOOKING_COHORT.conversationId ||
      JSON.stringify(baseline) !== JSON.stringify(S22_BOOKING_COHORT.historicalRunIds) ||
      config.historicalReserveMicros !== S22_BOOKING_COHORT.historicalReserveMicros ||
      config.hardCeilingMicros !== S22_BOOKING_COHORT.hardCeilingMicros)
  )
    throw new TypeError("Invalid internal Widget selection envelope");
  const identifiers = createSecurityIdentifierFactory();
  const reserveAt = (at: Date): bigint | null => {
    const price = resolveAIPrice("gemini", "gemini-3.8-flash", at);
    if (
      at.getTime() >= Date.parse(config.validUntil) ||
      !Number.isFinite(at.getTime()) ||
      price == null ||
      price.inputMicrosPerMillion !== 750_000n ||
      price.cachedInputMicrosPerMillion !== 75_000n ||
      price.outputMicrosPerMillion !== 3_750_000n
    )
      return null;
    return (
      (BigInt(config.inputTokenLimit) * price.inputMicrosPerMillion +
        BigInt(config.outputTokenLimit) * price.outputMicrosPerMillion +
        999_999n) /
      1_000_000n
    );
  };
  const widgetBinding = async (
    session: TenantDbSession,
    lock = false,
    selectedSessionId: string | undefined = ownerSelection ? undefined : widgetSessionId,
  ): Promise<WidgetBinding | null> => {
    if (selectedSessionId === undefined) return null;
    const at = clock();
    const rows = await executeTenantRead(
      session,
      `select ws.conversation_id::text, ws.contact_id::text
       from widget_sessions ws
       join channel_connections cc on cc.organization_id=$1 and cc.id=ws.channel_connection_id
       join widget_allowed_origins wao on wao.organization_id=$1 and wao.id=ws.widget_allowed_origin_id
         and wao.channel_connection_id=ws.channel_connection_id
       where ws.organization_id=$1 and ws.id=$2 and ws.status='active' and ws.revoked_at is null
         and ws.expires_at>$3 and ws.last_seen_at>$4
         and cc.status='active' and cc.channel_type='widget' and wao.status='active'
         ${ownerSelection ? "and ws.channel_connection_id=$5 and ws.widget_allowed_origin_id=$6" : ""}
       ${lock ? "for update of ws" : ""}`,
      [
        selectedSessionId,
        at,
        new Date(at.getTime() - 1_800_000),
        ...(ownerSelection
          ? [
              S22_WIDGET_SELECTION_ENVELOPE.channelConnectionId,
              S22_WIDGET_SELECTION_ENVELOPE.allowedOriginId,
            ]
          : []),
      ],
    );
    if (rows.length !== 1) return null;
    const row = rows[0];
    const conversationId: unknown = row?.["conversation_id"];
    const contactId: unknown = row?.["contact_id"];
    if (
      (conversationId !== null && !isSchemaValue(ConversationIdSchema, conversationId)) ||
      (contactId !== null && !isSchemaValue(ResourceIdSchema, contactId)) ||
      (conversationId === null) !== (contactId === null)
    )
      return null;
    const inboundMessageIds: string[] = [];
    if (conversationId !== null) {
      // One sentinel beyond the approved two messages; never read bodies. With
      // the session locked, Widget intake cannot add an inbound during authorization.
      const messages = await executeTenantRead(
        session,
        `select id::text from messages where organization_id=$1 and conversation_id=$2
           and direction='inbound' order by sequence_no limit 3`,
        [conversationId],
      );
      for (const message of messages) {
        const id: unknown = message["id"];
        if (!isSchemaValue(MessageIdSchema, id)) throw new RepositoryDataIntegrityError();
        inboundMessageIds.push(id);
      }
    }
    return { conversationId, contactId, inboundMessageIds: Object.freeze(inboundMessageIds) };
  };
  const inspect = async (
    session: TenantDbSession,
    binding: WidgetBinding | null = null,
    selectedSessionId: string | undefined = ownerSelection ? undefined : widgetSessionId,
  ) => {
    const widgetSessionId = selectedSessionId;
    const reserve = reserveAt(clock());
    // Bounded metadata only: no bodies, account identifiers, hashes or snapshots.
    const rows = await executeTenantRead(
      session,
      `select r.id,r.conversation_id,r.trigger_message_id,r.attempt_no,r.expected_conversation_version,
        r.provider_id,r.requested_model_id,r.provider_resolved_model_id,
        r.status,r.input_units,r.output_units,r.estimated_cost_micros,r.finished_at,
        (select count(*) from audit_events a where a.organization_id=$1 and a.target_type='ai_run'
          and a.target_id=r.id and a.action=$2) as reservations,
        (select count(*) from audit_events a where a.organization_id=$1 and a.target_type='ai_run'
          and a.target_id=r.id and a.action=$3) as journey_starts,
        (select a.metadata_redacted_jsonb->>'reservation_micros' from audit_events a
          where a.organization_id=$1 and a.target_type='ai_run' and a.target_id=r.id and a.action=$2 limit 1) as reserved_micros,
        (select a.metadata_redacted_jsonb->>'widget_session_id' from audit_events a
          where a.organization_id=$1 and a.target_type='ai_run' and a.target_id=r.id and a.action=$2 limit 1) as widget_session_id,
        (select a.metadata_redacted_jsonb->>'conversation_id' from audit_events a
          where a.organization_id=$1 and a.target_type='ai_run' and a.target_id=r.id and a.action=$2 limit 1) as widget_conversation_id,
        (select a.metadata_redacted_jsonb->>'dispatch_authorized' from audit_events a
          where a.organization_id=$1 and a.target_type='ai_run' and a.target_id=r.id
          and a.action in ('ai_run.completed','ai_run.failed','ai_run.schema_rejected','ai_run.policy_denied')
          order by a.occurred_at desc limit 1) as dispatch_authorized
       from ai_runs r where r.organization_id=$1
       order by r.started_at,r.id limit 65`,
      [RESERVED, STARTED],
    );
    const markers = await executeTenantRead(
      session,
      `select count(*) as count from (select a.id from audit_events a
        where a.organization_id=$1 and a.action=$2 and a.target_type='ai_run'
        and a.metadata_redacted_jsonb->>'profile'=$3 limit 65) as markers`,
      [RESERVED, config.profile],
    );
    const markerCount = mapSafeBigInt(markers[0]?.["count"]);
    const runMarkerCount = rows.reduce(
      (total, row) => total + mapSafeBigInt(row["reservations"]),
      0,
    );
    // A lost run must neither erase its immutable slot nor silently free money.
    const orphanSlots = Math.max(0, markerCount - runMarkerCount);
    let known = 0n,
      pending = BigInt(orphanSlots) * 801_432n,
      calls = orphanSlots,
      reason: string | null = null;
    let originalCalls = 0,
      originalKnown = 0n,
      originalPending = 0n;
    let widgetCalls = 0,
      widgetKnown = 0n,
      widgetPending = 0n;
    const originalMessages = new Set<string>(),
      widgetMessages = new Map<string, number>();
    const messages = new Map<string, number>();
    const baselineSeen = new Set<string>();
    if (reserve === null) reason = "pricing_unavailable";
    if (rows.length === 65) reason = "ledger_overflow";
    if (markerCount !== runMarkerCount) reason = "dispatch_marker_integrity";
    for (const row of rows) {
      const id = mapString(row["id"]);
      if (baseline.includes(id)) {
        if (row["conversation_id"] !== config.conversationId) reason = "historical_scope_mismatch";
        if (row["estimated_cost_micros"] !== null) reason = "historical_cost_mutated";
        baselineSeen.add(id);
        continue;
      }
      const reservations = mapSafeBigInt(row["reservations"]);
      const started = mapSafeBigInt(row["journey_starts"]);
      if (started !== 1 || reservations > 1) reason = "unrecognized_run";
      if (reservations === 0) {
        if (
          row["provider_resolved_model_id"] !== null ||
          row["estimated_cost_micros"] !== null ||
          row["dispatch_authorized"] === "true"
        )
          reason = "missing_dispatch_marker";
        continue;
      }
      const reserved = mapString(row["reserved_micros"]);
      if (!/^[0-9]{1,8}$/u.test(reserved) || BigInt(reserved) !== 801_432n)
        throw new RepositoryDataIntegrityError();
      const retained = BigInt(reserved);
      calls++;
      const messageId = mapString(row["trigger_message_id"]);
      messages.set(messageId, (messages.get(messageId) ?? 0) + 1);
      if (row["provider_id"] !== "gemini" || row["requested_model_id"] !== "gemini-3.8-flash")
        reason = "model_mismatch";
      const original = row["conversation_id"] === config.conversationId;
      const widget =
        widgetSessionId !== undefined &&
        binding?.conversationId !== null &&
        row["conversation_id"] === binding?.conversationId &&
        row["widget_session_id"] === widgetSessionId &&
        row["widget_conversation_id"] === binding?.conversationId;
      if (original) {
        originalCalls++;
        originalMessages.add(messageId);
        if (row["widget_session_id"] != null) reason = "scope_mismatch";
      } else if (widget) {
        widgetCalls++;
        widgetMessages.set(messageId, (widgetMessages.get(messageId) ?? 0) + 1);
      } else reason = "scope_mismatch";
      if (row["finished_at"] === null) {
        pending += retained;
        if (original) originalPending += retained;
        if (widget) widgetPending += retained;
        reason = "dispatch_in_flight";
      } else if (row["estimated_cost_micros"] === null) {
        pending += retained;
        if (original) originalPending += retained;
        if (widget) widgetPending += retained;
        reason = "cost_unknown";
      } else {
        const value = BigInt(mapString(row["estimated_cost_micros"]));
        if (
          value < 0n ||
          reserve === null ||
          value > reserve ||
          row["provider_resolved_model_id"] !== "gemini-3.8-flash"
        )
          reason = "invalid_cost";
        if (
          row["input_units"] === null ||
          row["output_units"] === null ||
          mapSafeBigInt(row["input_units"]) > config.inputTokenLimit ||
          mapSafeBigInt(row["output_units"]) > config.outputTokenLimit
        )
          reason = "usage_limit";
        known += value;
        if (original) originalKnown += value;
        if (widget) widgetKnown += value;
      }
    }
    if (baselineSeen.size !== baseline.length) reason = "historical_baseline_missing";
    if (
      widgetSessionId === undefined &&
      (calls > config.maximumCalls ||
        messages.size > config.maximumMessages ||
        [...messages.values()].some((count) => count > config.maximumCallsPerMessage))
    )
      reason = "attempt_limit";
    const exposure = config.historicalReserveMicros + known + pending;
    if (exposure >= config.hardCeilingMicros) reason = "hard_ceiling";
    let latchCount = 0;
    if (widgetSessionId !== undefined) {
      const latches = await executeTenantRead(
        session,
        `select target_id::text as session_id,
          metadata_redacted_jsonb->>'widget_session_id' as widget_session_id,
          metadata_redacted_jsonb->>'conversation_id' as conversation_id
         from audit_events where organization_id=$1 and action=$2
           and target_type='widget_session' and metadata_redacted_jsonb->>'profile'=$3 limit 2`,
        [WIDGET_BOUND, config.profile],
      );
      latchCount = latches.length;
      if (
        originalCalls !== S22_WIDGET_ALLOWANCE.previousCalls ||
        originalMessages.size !== S22_WIDGET_ALLOWANCE.previousMessages ||
        originalKnown !== S22_WIDGET_ALLOWANCE.previousKnownCostMicros ||
        originalPending !== 0n
      )
        reason = "widget_baseline_mismatch";
      if (binding === null) reason = "widget_session_unavailable";
      if (
        latches.length > 1 ||
        (widgetCalls > 0 && latches.length !== 1) ||
        (latches.length === 1 &&
          (latches[0]?.["session_id"] !== widgetSessionId ||
            latches[0]["widget_session_id"] !== widgetSessionId ||
            latches[0]["conversation_id"] !== binding?.conversationId))
      )
        reason = "widget_binding_integrity";
      if (
        widgetCalls > S22_WIDGET_ALLOWANCE.maximumCalls ||
        widgetMessages.size > S22_WIDGET_ALLOWANCE.maximumMessages ||
        [...widgetMessages.values()].some((count) => count > config.maximumCallsPerMessage)
      )
        reason = "attempt_limit";
      if (
        widgetKnown + widgetPending > S22_WIDGET_ALLOWANCE.additionalReserveMicros ||
        exposure > S22_WIDGET_ALLOWANCE.maximumCombinedExposureMicros
      )
        reason = "widget_allowance";
      if ((binding?.inboundMessageIds.length ?? 0) > S22_WIDGET_ALLOWANCE.maximumMessages)
        reason = "message_limit";
    }
    return {
      reserve,
      known,
      pending,
      calls,
      messages,
      reason,
      exposure,
      rows,
      widgetCalls,
      widgetMessages,
      widgetKnown,
      widgetPending,
      latchCount,
    };
  };
  const lockCohort = async (session: TenantDbSession) => {
    const rows = await executeTenantRead(
      session,
      `select id,status,automation_mode,version from conversations where organization_id=$1 and id=$2 for update`,
      [config.conversationId],
    );
    if (rows.length !== 1) throw new S22WidgetCohortError("unavailable");
    return rows[0];
  };
  const selections = async (session: TenantDbSession): Promise<readonly OwnerSelection[]> => {
    const rows = await executeTenantRead(
      session,
      `select actor_type,actor_id::text,actor_membership_id::text,
        metadata_redacted_jsonb->>'selected_session_id' as selected_session_id,
        metadata_redacted_jsonb->>'selection_version' as selection_version,
        metadata_redacted_jsonb->>'expected_selection_version' as expected_selection_version,
        metadata_redacted_jsonb->>'expected_session_version' as expected_session_version,
        metadata_redacted_jsonb->>'channel_connection_id' as channel_connection_id,
        metadata_redacted_jsonb->>'allowed_origin_id' as allowed_origin_id
       from audit_events where organization_id=$1 and action=$2 and result='succeeded'
        and target_type='widget_session' and target_id=$3
        and metadata_redacted_jsonb->>'profile'=$4
       order by occurred_at,id limit 17`,
      [
        OWNER_SELECTED,
        S22_WIDGET_SELECTION_ENVELOPE.anchorSessionId,
        S22_WIDGET_SELECTION_ENVELOPE.profile,
      ],
    );
    if (rows.length > 16) throw new S22WidgetCohortError("unavailable");
    // Persisted CAS versions define order, not wall-clock/UUID ordering. Equal
    // timestamps or clock correction cannot reverse the selection authority.
    return [...rows]
      .sort(
        (left, right) =>
          mapSafeBigInt(left["selection_version"]) - mapSafeBigInt(right["selection_version"]),
      )
      .map((row, index) => {
        const sessionId: unknown = row["selected_session_id"];
        const actorId: unknown = row["actor_id"];
        const membershipId: unknown = row["actor_membership_id"];
        if (
          !isSchemaValue(ResourceIdSchema, sessionId) ||
          !isSchemaValue(ResourceIdSchema, actorId) ||
          !isSchemaValue(ResourceIdSchema, membershipId) ||
          row["actor_type"] !== "member" ||
          row["selection_version"] !== String(index + 1) ||
          row["expected_selection_version"] !== String(index) ||
          row["expected_session_version"] !== "2" ||
          row["channel_connection_id"] !== S22_WIDGET_SELECTION_ENVELOPE.channelConnectionId ||
          row["allowed_origin_id"] !== S22_WIDGET_SELECTION_ENVELOPE.allowedOriginId
        )
          throw new S22WidgetCohortError("unavailable");
        return { sessionId, version: index + 1, predecessor: index, actorId, membershipId };
      });
  };
  const requireOwner = async (session: TenantDbSession, actor: AuthorizationContext) => {
    if (
      !ownerSelection ||
      !isAuthorizationContext(actor) ||
      actor.organizationId !== organizationId ||
      actor.role !== "owner" ||
      actor.locationScope !== "all"
    )
      throw new S22WidgetCohortError("permission_denied");
    try {
      await requireStaffActor(session, actor, "integrations.manage");
    } catch (error) {
      if (error instanceof StaffOperationError && error.code === "permission_denied")
        throw new S22WidgetCohortError("permission_denied");
      throw error;
    }
  };
  const candidates = async (session: TenantDbSession, id?: string, lock = false) => {
    const at = clock();
    const rows = await executeTenantRead(
      session,
      `select ws.id::text as session_id,ws.version as session_version,ws.issued_at,
        ws.last_seen_at + interval '30 minutes' as idle_deadline,ws.expires_at
       from widget_sessions ws
       join channel_connections cc on cc.organization_id=$1 and cc.id=ws.channel_connection_id
       join widget_allowed_origins wao on wao.organization_id=$1 and wao.id=ws.widget_allowed_origin_id
         and wao.channel_connection_id=ws.channel_connection_id
       where ws.organization_id=$1 and ws.channel_connection_id=$2 and ws.widget_allowed_origin_id=$3
         and ws.status='active' and ws.revoked_at is null and ws.version=2
         and ws.contact_id is null and ws.conversation_id is null
         and ws.issued_at>$4 and ws.issued_at<=$5 and ws.expires_at>$5 and ws.last_seen_at>$6
         and cc.status='active' and cc.channel_type='widget' and wao.status='active'
         ${id === undefined ? "" : "and ws.id=$7"}
       order by ws.issued_at desc,ws.id desc limit 5 ${lock ? "for update of ws" : ""}`,
      [
        S22_WIDGET_SELECTION_ENVELOPE.channelConnectionId,
        S22_WIDGET_SELECTION_ENVELOPE.allowedOriginId,
        new Date(at.getTime() - 300_000),
        at,
        new Date(at.getTime() - 1_800_000),
        ...(id === undefined ? [] : [id]),
      ],
    );
    return rows.map((row) => {
      const sessionId: unknown = row["session_id"];
      const version = mapSafeBigInt(row["session_version"]);
      const candidate = {
        session_id: sessionId,
        session_version: version,
        issued_at: mapUtcTimestamp(row["issued_at"]),
        idle_deadline: mapUtcTimestamp(row["idle_deadline"]),
        expires_at: mapUtcTimestamp(row["expires_at"]),
      };
      if (!isSchemaValue(S22WidgetCohortCandidateSchema, candidate))
        throw new S22WidgetCohortError("unavailable");
      return candidate;
    });
  };
  const selectionReadiness = async (
    session: TenantDbSession,
    selected: OwnerSelection | undefined,
  ) => {
    // This path must not require the previous unused SID to be alive. Replacing
    // it never revives it, and cannot erase any existing Widget binding/spend.
    const state = await inspect(session, null, undefined);
    const latches = await executeTenantRead(
      session,
      `select id from audit_events where organization_id=$1 and action=$2
        and target_type='widget_session' and metadata_redacted_jsonb->>'profile'=$3 limit 2`,
      [WIDGET_BOUND, config.profile],
    );
    let reason = state.reason;
    if (
      state.calls !== S22_WIDGET_ALLOWANCE.previousCalls ||
      state.messages.size !== S22_WIDGET_ALLOWANCE.previousMessages ||
      state.known !== S22_WIDGET_ALLOWANCE.previousKnownCostMicros ||
      state.pending !== 0n
    )
      reason = reason ?? "widget_baseline_mismatch";
    if (latches.length !== 0) reason = "widget_already_bound";
    {
      const previous = await executeTenantRead(
        session,
        `select conversation_id::text,contact_id::text from widget_sessions
         where organization_id=$1 and id=$2 and channel_connection_id=$3 and widget_allowed_origin_id=$4
         limit 1 for update`,
        [
          selected?.sessionId ?? S22_WIDGET_SELECTION_ENVELOPE.anchorSessionId,
          S22_WIDGET_SELECTION_ENVELOPE.channelConnectionId,
          S22_WIDGET_SELECTION_ENVELOPE.allowedOriginId,
        ],
      );
      if (
        previous.length !== 1 ||
        previous[0]?.["conversation_id"] !== null ||
        previous[0]["contact_id"] !== null
      )
        reason = "widget_already_bound";
    }
    if (
      state.reserve === null ||
      state.exposure + (state.reserve ?? 0n) >= config.hardCeilingMicros ||
      state.exposure + (state.reserve ?? 0n) > S22_WIDGET_ALLOWANCE.maximumCombinedExposureMicros
    )
      reason = reason ?? "hard_ceiling";
    return { state, reason };
  };
  const cohortStore: S22WidgetCohortStore = {
    get: async ({ actor }) => {
      if (!isAuthorizationContext(actor) || actor.organizationId !== organizationId)
        throw new S22WidgetCohortError("permission_denied");
      return runtime.withTenantTransaction(actor.organizationId, async (session) => {
        await requireOwner(session, actor);
        await lockCohort(session);
        const selected = (await selections(session)).at(-1);
        const ready = await selectionReadiness(session, selected);
        const binding = await widgetBinding(session, false, selected?.sessionId);
        const state =
          selected === undefined
            ? ready.state
            : await inspect(session, binding, selected.sessionId);
        let reason =
          selected === undefined ? (ready.reason ?? "widget_selection_required") : state.reason;
        if (reason === null) {
          if (state.widgetCalls >= S22_WIDGET_ALLOWANCE.maximumCalls) reason = "attempt_limit";
          else if ((binding?.inboundMessageIds.length ?? 0) >= S22_WIDGET_ALLOWANCE.maximumMessages)
            reason = "message_limit";
          else if (
            state.reserve !== null &&
            state.exposure + state.reserve >= config.hardCeilingMicros
          )
            reason = "hard_ceiling";
          else if (
            state.reserve !== null &&
            (state.widgetKnown + state.widgetPending + state.reserve >
              S22_WIDGET_ALLOWANCE.additionalReserveMicros ||
              state.exposure + state.reserve > S22_WIDGET_ALLOWANCE.maximumCombinedExposureMicros)
          )
            reason = "widget_allowance";
        }
        const result = {
          selection_version: selected?.version ?? 0,
          selected_session_id: selected?.sessionId ?? null,
          candidates: ready.reason === null ? await candidates(session) : [],
          can_select: ready.reason === null && (selected?.version ?? 0) < 16,
          blocked: reason !== null,
          reason,
          known_cost_micros: state.known.toString(),
          combined_exposure_micros: state.exposure.toString(),
          unresolved_reserve_micros: state.pending.toString(),
        };
        if (!isSchemaValue(S22WidgetCohortStatusSchema, result))
          throw new S22WidgetCohortError("unavailable");
        return result;
      });
    },
    select: async ({ actor, body, requestId, correlationId }) => {
      if (!isAuthorizationContext(actor) || actor.organizationId !== organizationId)
        throw new S22WidgetCohortError("permission_denied");
      if (
        !isSchemaValue(S22WidgetCohortSelectInputSchema, body) ||
        !/^[A-Za-z0-9](?:[A-Za-z0-9._:-]{6,126}[A-Za-z0-9])$/u.test(requestId) ||
        !isSchemaValue(ResourceIdSchema, correlationId)
      )
        throw new S22WidgetCohortError("validation_failed");
      return runtime.withTenantTransaction(actor.organizationId, async (session) => {
        await requireOwner(session, actor);
        await lockCohort(session);
        const selected = (await selections(session)).at(-1);
        const version = selected?.version ?? 0;
        const duplicate =
          selected?.sessionId === body.session_id &&
          selected.predecessor === body.expected_selection_version &&
          selected.actorId === actor.userId &&
          selected.membershipId === actor.membershipId;
        if (!duplicate && version !== body.expected_selection_version)
          throw new S22WidgetCohortError("selection_conflict");
        if (!duplicate) {
          if (version >= 16 || selected?.sessionId === body.session_id)
            throw new S22WidgetCohortError("selection_conflict");
          const ready = await selectionReadiness(session, selected);
          if (ready.reason !== null) throw new S22WidgetCohortError("cohort_blocked");
          if ((await candidates(session, body.session_id, true)).length !== 1)
            throw new S22WidgetCohortError("selection_conflict");
          await executeTenantWrite(
            session,
            `insert into audit_events (organization_id,id,event_type,actor_type,actor_id,actor_membership_id,
              target_type,target_id,action,result,request_id,correlation_id,metadata_redacted_jsonb,occurred_at)
             values ($1,$2,$3,'member',$4,$5,'widget_session',$6,$3,'succeeded',$7,$8,$9::jsonb,$10)`,
            [
              identifiers.issueResourceId(clock()),
              OWNER_SELECTED,
              actor.userId,
              actor.membershipId,
              S22_WIDGET_SELECTION_ENVELOPE.anchorSessionId,
              requestId,
              correlationId,
              JSON.stringify({
                profile: S22_WIDGET_SELECTION_ENVELOPE.profile,
                selected_session_id: body.session_id,
                selection_version: version + 1,
                expected_selection_version: version,
                expected_session_version: 2,
                channel_connection_id: S22_WIDGET_SELECTION_ENVELOPE.channelConnectionId,
                allowed_origin_id: S22_WIDGET_SELECTION_ENVELOPE.allowedOriginId,
              }),
              clock(),
            ],
          );
        }
        const receipt = {
          selection_version: duplicate ? version : version + 1,
          selected_session_id: body.session_id,
        };
        if (!isSchemaValue(S22WidgetCohortSelectionReceiptSchema, receipt))
          throw new S22WidgetCohortError("unavailable");
        return receipt;
      });
    },
  };
  return Object.freeze({
    widgetCohortStore: Object.freeze(cohortStore),
    recordStart: async (
      session: TenantDbSession,
      input: Readonly<{ reference: AIWorkReference; runId: string }>,
    ) => {
      await executeTenantWrite(
        session,
        `insert into audit_events (organization_id,id,event_type,actor_type,target_type,target_id,action,result,
          request_id,correlation_id,metadata_redacted_jsonb,occurred_at)
         values ($1,$2,$3,'system','ai_run',$4,$3,'succeeded',$5,$6,$7::jsonb,$8)`,
        [
          identifiers.issueResourceId(clock()),
          STARTED,
          input.runId,
          `ai-journey:${input.runId}`,
          input.reference.correlationId,
          JSON.stringify({ profile: config.profile, dispatch_authorized: false }),
          clock(),
        ],
      );
    },
    authorizeDispatch: async (
      input: Readonly<{ reference: AIWorkReference; reservation: AIRunReservation }>,
    ): Promise<boolean> => {
      if (
        (config.mode !== "booking" && config.mode !== "widget_booking") ||
        input.reference.organizationId !== organizationId ||
        (widgetSessionId === undefined &&
          input.reference.conversationId !== config.conversationId) ||
        (widgetSessionId !== undefined && input.reference.conversationId === config.conversationId)
      )
        return false;
      return runtime.withTenantTransaction(input.reference.organizationId, async (session) => {
        // Same lock for every Worker/process. No lock is held during provider I/O.
        const locked = await lockCohort(session);
        const widgetSessionId = ownerSelection
          ? (await selections(session)).at(-1)?.sessionId
          : config.widgetSessionId;
        if (ownerSelection && widgetSessionId === undefined) return false;
        // The original conversation remains the shared mutex across old/new Workers.
        // Widget intake and this gate both lock its session before its conversation.
        const binding = await widgetBinding(session, true, widgetSessionId);
        let currentConversation = locked;
        if (widgetSessionId !== undefined) {
          if (
            binding?.conversationId !== input.reference.conversationId ||
            binding.contactId === null ||
            !binding.inboundMessageIds
              .slice(0, S22_WIDGET_ALLOWANCE.maximumMessages)
              .includes(input.reference.messageId)
          )
            return false;
          const widgetConversation = await executeTenantRead(
            session,
            `select id,status,automation_mode,version from conversations
             where organization_id=$1 and id=$2 and contact_id=$3
               and exists(select 1 from contacts c where c.organization_id=$1 and c.id=$3 and c.status='active')
             for update`,
            [binding.conversationId, binding.contactId],
          );
          if (widgetConversation.length !== 1) return false;
          currentConversation = widgetConversation[0];
        }
        if (
          currentConversation?.["status"] !== "open" ||
          currentConversation["automation_mode"] !== "ai"
        )
          return false;
        const state = await inspect(session, binding, widgetSessionId);
        const calls = widgetSessionId === undefined ? state.calls : state.widgetCalls;
        const messages = widgetSessionId === undefined ? state.messages : state.widgetMessages;
        const maximumCalls =
          widgetSessionId === undefined ? config.maximumCalls : S22_WIDGET_ALLOWANCE.maximumCalls;
        const maximumMessages =
          widgetSessionId === undefined
            ? config.maximumMessages
            : S22_WIDGET_ALLOWANCE.maximumMessages;
        const current = state.rows.find((row) => row["id"] === input.reservation.runId);
        if (
          current === undefined ||
          current["status"] !== "started" ||
          mapSafeBigInt(current["attempt_no"]) !== input.reservation.attemptNo ||
          current["expected_conversation_version"] !== currentConversation?.["version"] ||
          current["conversation_id"] !== input.reference.conversationId ||
          current["provider_id"] !== "gemini" ||
          current["requested_model_id"] !== "gemini-3.8-flash" ||
          current["trigger_message_id"] !== input.reference.messageId ||
          mapSafeBigInt(current["reservations"]) !== 0 ||
          state.reason !== null ||
          state.reserve === null ||
          calls >= maximumCalls ||
          (messages.get(input.reference.messageId) ?? 0) >= config.maximumCallsPerMessage ||
          (!messages.has(input.reference.messageId) && messages.size >= maximumMessages) ||
          state.exposure + state.reserve >= config.hardCeilingMicros ||
          (widgetSessionId !== undefined &&
            (state.widgetKnown + state.widgetPending + state.reserve >
              S22_WIDGET_ALLOWANCE.additionalReserveMicros ||
              state.exposure + state.reserve > S22_WIDGET_ALLOWANCE.maximumCombinedExposureMicros))
        )
          return false;
        if (widgetSessionId !== undefined && state.latchCount === 0) {
          await executeTenantWrite(
            session,
            `insert into audit_events (organization_id,id,event_type,actor_type,target_type,target_id,action,result,
              request_id,correlation_id,metadata_redacted_jsonb,occurred_at)
             values ($1,$2,$3,'system','widget_session',$4,$3,'succeeded',$5,$6,$7::jsonb,$8)`,
            [
              identifiers.issueResourceId(clock()),
              WIDGET_BOUND,
              widgetSessionId,
              `ai-widget-binding:${widgetSessionId}`,
              input.reference.correlationId,
              JSON.stringify({
                profile: config.profile,
                widget_session_id: widgetSessionId,
                conversation_id: input.reference.conversationId,
              }),
              clock(),
            ],
          );
        }
        await executeTenantWrite(
          session,
          `insert into audit_events (organization_id,id,event_type,actor_type,target_type,target_id,action,result,
            request_id,correlation_id,metadata_redacted_jsonb,occurred_at)
           values ($1,$2,$3,'system','ai_run',$4,$3,'succeeded',$5,$6,$7::jsonb,$8)`,
          [
            identifiers.issueResourceId(clock()),
            RESERVED,
            input.reservation.runId,
            `ai-dispatch:${input.reservation.runId}`,
            input.reference.correlationId,
            JSON.stringify({
              profile: config.profile,
              reservation_micros: state.reserve.toString(),
              historical_reserve_micros: config.historicalReserveMicros.toString(),
              input_token_limit: config.inputTokenLimit,
              output_token_limit: config.outputTokenLimit,
              ...(widgetSessionId === undefined
                ? {}
                : {
                    widget_session_id: widgetSessionId,
                    conversation_id: input.reference.conversationId,
                  }),
            }),
            clock(),
          ],
        );
        return true; // Transaction must COMMIT before this promise resolves.
      });
    },
    read: async (tenant: OrganizationId): Promise<AIJourneyBudgetSnapshot> => {
      if (tenant !== organizationId) throw new RepositoryDataIntegrityError();
      return runtime.withTenantTransaction(tenant, async (session) => {
        if (ownerSelection) await lockCohort(session);
        const widgetSessionId = ownerSelection
          ? (await selections(session)).at(-1)?.sessionId
          : config.widgetSessionId;
        const binding = await widgetBinding(session, false, widgetSessionId);
        const state = await inspect(session, binding, widgetSessionId);
        let reason =
          config.mode === "paused"
            ? "paused"
            : ownerSelection && widgetSessionId === undefined
              ? "widget_selection_required"
              : state.reason;
        if (reason === null) {
          const calls = widgetSessionId === undefined ? state.calls : state.widgetCalls;
          const messages = widgetSessionId === undefined ? state.messages : state.widgetMessages;
          if (
            calls >=
            (widgetSessionId === undefined
              ? config.maximumCalls
              : S22_WIDGET_ALLOWANCE.maximumCalls)
          )
            reason = "attempt_limit";
          else if (
            widgetSessionId === undefined
              ? messages.size >= config.maximumMessages
              : (binding?.inboundMessageIds.length ?? 0) >= S22_WIDGET_ALLOWANCE.maximumMessages
          )
            reason = "message_limit";
          else if (
            state.reserve !== null &&
            state.exposure + state.reserve >= config.hardCeilingMicros
          )
            reason = "hard_ceiling";
          else if (
            widgetSessionId !== undefined &&
            state.reserve !== null &&
            (state.widgetKnown + state.widgetPending + state.reserve >
              S22_WIDGET_ALLOWANCE.additionalReserveMicros ||
              state.exposure + state.reserve > S22_WIDGET_ALLOWANCE.maximumCombinedExposureMicros)
          )
            reason = "widget_allowance";
        }
        return Object.freeze({
          profile: config.profile,
          mode: config.mode,
          physicalCalls: state.calls,
          logicalMessages: state.messages.size,
          knownCostMicros: state.known.toString(),
          unresolvedReserveMicros: state.pending.toString(),
          historicalReserveMicros: config.historicalReserveMicros.toString(),
          combinedExposureMicros: state.exposure.toString(),
          perCallReserveMicros: state.reserve?.toString() ?? null,
          accountingComplete: false,
          blocked: reason !== null,
          reason,
          ...(widgetSessionId === undefined
            ? {}
            : {
                widget: {
                  sessionId: widgetSessionId,
                  conversationId: binding?.conversationId ?? null,
                  physicalCalls: state.widgetCalls,
                  logicalMessages: state.widgetMessages.size,
                  customerMessages: binding?.inboundMessageIds.length ?? 0,
                  knownCostMicros: state.widgetKnown.toString(),
                  unresolvedReserveMicros: state.widgetPending.toString(),
                },
              }),
        });
      });
    },
  });
};

/** Staging-only composition: no arbitrary tenant or money profile can be supplied
 * by an HTTP/browser caller. Selection commits an attributed audit, not a paid
 * dispatch permission, session refresh, migration or provider call. */
export const createS22WidgetCohortStore = (
  runtime: TenantDatabaseRuntime,
  configuration: AIJourneyCohortConfig = {
    ...S22_BOOKING_COHORT,
    mode: "widget_booking",
    widgetSessionId: S22_WIDGET_SELECTION_ENVELOPE.anchorSessionId,
  },
  clock: () => Date = () => new Date(),
): S22WidgetCohortStore =>
  createAIJourneyBudgetGuard(runtime, configuration, clock, { ownerSelection: true })
    .widgetCohortStore;
