import type { AIWorkReference, AIRunReservation } from "@lead-agent/application";
import {
  COMMERCIAL_V1_AI_PROFILE,
  S22_WIDGET_ALLOWANCE,
  type AIJourneyCohortConfig,
} from "@lead-agent/config";
import {
  ConversationIdSchema,
  MessageIdSchema,
  OrganizationIdSchema,
  ResourceIdSchema,
  isSchemaValue,
  type OrganizationId,
} from "@lead-agent/contracts";
import { resolveAIPrice } from "@lead-agent/observability";
import { createSecurityIdentifierFactory } from "@lead-agent/security";
import type { TenantDatabaseRuntime, TenantDbSession } from "../runtime/tenant.js";
import {
  executeTenantRead,
  executeTenantWrite,
  mapSafeBigInt,
  mapString,
  RepositoryDataIntegrityError,
} from "./shared.js";

const RESERVED = "ai_run.dispatch_reserved";
const STARTED = "ai_run.journey_started";
const WIDGET_BOUND = "ai_run.widget_journey_bound";
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
  ): Promise<WidgetBinding | null> => {
    if (widgetSessionId === undefined) return null;
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
       ${lock ? "for update of ws" : ""}`,
      [widgetSessionId, at, new Date(at.getTime() - 1_800_000)],
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
  const inspect = async (session: TenantDbSession, binding: WidgetBinding | null = null) => {
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
  return Object.freeze({
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
        const locked = await executeTenantRead(
          session,
          `select id,status,automation_mode,version from conversations where organization_id=$1 and id=$2 for update`,
          [config.conversationId],
        );
        if (locked.length !== 1) return false;
        // The original conversation remains the shared mutex across old/new Workers.
        // Widget intake and this gate both lock its session before its conversation.
        const binding = await widgetBinding(session, true);
        let currentConversation = locked[0];
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
        const state = await inspect(session, binding);
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
        const binding = await widgetBinding(session);
        const state = await inspect(session, binding);
        let reason = config.mode === "paused" ? "paused" : state.reason;
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
