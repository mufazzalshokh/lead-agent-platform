import type { AIWorkReference, AIRunReservation } from "@lead-agent/application";
import { COMMERCIAL_V1_AI_PROFILE, type AIJourneyCohortConfig } from "@lead-agent/config";
import {
  ConversationIdSchema,
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
  blocked: boolean;
  reason: string | null;
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
    !["paused", "booking"].includes(config.mode) ||
    config.profile !== "s22-synthetic-booking.v1" ||
    !isSchemaValue(OrganizationIdSchema, config.organizationId) ||
    !isSchemaValue(ConversationIdSchema, config.conversationId) ||
    config.historicalRunIds.some((id) => !isSchemaValue(ResourceIdSchema, id)) ||
    new Set(config.historicalRunIds).size !== config.historicalRunIds.length ||
    config.historicalRunIds.length > 2 ||
    config.historicalReserveMicros < 0n ||
    config.hardCeilingMicros > 10_000_000n ||
    config.hardCeilingMicros <= config.historicalReserveMicros ||
    config.maximumCalls !== 6 ||
    config.maximumMessages !== 3 ||
    config.maximumCallsPerMessage !== 2 ||
    config.inputTokenLimit !== 1_048_576 ||
    config.outputTokenLimit !== COMMERCIAL_V1_AI_PROFILE.maxOutputTokens ||
    config.validUntil !== "2027-01-01T00:00:00Z"
  )
    throw new TypeError("Invalid internal AI journey profile");
  const organizationId = config.organizationId;
  // Copy trusted configuration so mutation by a caller cannot reset/widen a cohort.
  const baseline = Object.freeze([...config.historicalRunIds]);
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
  const inspect = async (session: TenantDbSession) => {
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
    const messages = new Map<string, number>();
    const baselineSeen = new Set<string>();
    if (reserve === null) reason = "pricing_unavailable";
    if (rows.length === 65) reason = "ledger_overflow";
    if (markerCount !== runMarkerCount) reason = "dispatch_marker_integrity";
    for (const row of rows) {
      const id = mapString(row["id"]);
      if (baseline.includes(id)) {
        if (row["conversation_id"] !== config.conversationId) reason = "historical_scope_mismatch";
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
      if (row["conversation_id"] !== config.conversationId) reason = "scope_mismatch";
      if (row["finished_at"] === null) {
        pending += retained;
        reason = "dispatch_in_flight";
      } else if (row["estimated_cost_micros"] === null) {
        pending += retained;
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
      }
    }
    if (baselineSeen.size !== baseline.length) reason = "historical_baseline_missing";
    if (
      calls > config.maximumCalls ||
      messages.size > config.maximumMessages ||
      [...messages.values()].some((count) => count > config.maximumCallsPerMessage)
    )
      reason = "attempt_limit";
    const exposure = config.historicalReserveMicros + known + pending;
    if (exposure >= config.hardCeilingMicros) reason = "hard_ceiling";
    return { reserve, known, pending, calls, messages, reason, exposure, rows };
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
        config.mode !== "booking" ||
        input.reference.organizationId !== organizationId ||
        input.reference.conversationId !== config.conversationId
      )
        return false;
      return runtime.withTenantTransaction(input.reference.organizationId, async (session) => {
        // Same lock for every Worker/process. No lock is held during provider I/O.
        const locked = await executeTenantRead(
          session,
          `select id,status,automation_mode,version from conversations where organization_id=$1 and id=$2 for update`,
          [config.conversationId],
        );
        if (
          locked.length !== 1 ||
          locked[0]?.["status"] !== "open" ||
          locked[0]["automation_mode"] !== "ai"
        )
          return false;
        const state = await inspect(session);
        const current = state.rows.find((row) => row["id"] === input.reservation.runId);
        if (
          current === undefined ||
          current["status"] !== "started" ||
          mapSafeBigInt(current["attempt_no"]) !== input.reservation.attemptNo ||
          current["expected_conversation_version"] !== locked[0]?.["version"] ||
          current["provider_id"] !== "gemini" ||
          current["requested_model_id"] !== "gemini-3.8-flash" ||
          current["trigger_message_id"] !== input.reference.messageId ||
          mapSafeBigInt(current["reservations"]) !== 0 ||
          state.reason !== null ||
          state.reserve === null ||
          state.calls >= config.maximumCalls ||
          (state.messages.get(input.reference.messageId) ?? 0) >= config.maximumCallsPerMessage ||
          (!state.messages.has(input.reference.messageId) &&
            state.messages.size >= config.maximumMessages) ||
          state.exposure + state.reserve >= config.hardCeilingMicros
        )
          return false;
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
        const state = await inspect(session);
        const reason =
          config.mode === "paused"
            ? "paused"
            : (state.reason ??
              (state.calls >= config.maximumCalls
                ? "attempt_limit"
                : state.reserve !== null &&
                    state.exposure + state.reserve >= config.hardCeilingMicros
                  ? "hard_ceiling"
                  : null));
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
        });
      });
    },
  });
};
