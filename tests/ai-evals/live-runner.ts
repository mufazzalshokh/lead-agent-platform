import {
  evaluateAIDecision,
  validateAgentDecision,
  type AIProvider,
  type AIProviderResult,
} from "@lead-agent/application";
import { createBudgetLedger, type BudgetCheckpoint, type BudgetPhase } from "./budget.js";
import type { EvalCase } from "./cases.js";
import { usd } from "./cost.js";
import { HARD_CAP_MICROS, parseUSDMicros, reservePerCall } from "./budget.js";
import {
  attemptKey,
  jitterDelay,
  recurringTransportFailure,
  retryDelay,
  waitForRecovery,
  type EvalAttempt,
  type RetryHooks,
} from "./eval-retry.js";
import { policyForCase, scoreCase, type CaseScore } from "./scorer.js";
import {
  inputForCase,
  LOGICAL_DEADLINE_MS,
  planScreen,
  SCREEN_MODELS,
  type PlannedDecision,
  type ScreenModel,
  type ScreenPhase,
} from "./screen.js";

export interface LiveObservation {
  readonly model: ScreenModel;
  readonly caseId: string;
  readonly phase: ScreenPhase;
  readonly hint: boolean;
  readonly first: CaseScore;
  readonly final: CaseScore;
  readonly firstCostUSD: string;
  readonly repairCostUSD: string | null;
  readonly repair: CaseScore | null;
  readonly logicalLatencyMs: number;
  readonly rawForbiddenAction: boolean | null;
  readonly latinDraft: boolean | null;
  readonly system: Readonly<{
    invalidAccepted: boolean;
    protectedMutationBypass: boolean;
    policyApplied: boolean;
    referenceAuthorityBypass: boolean;
  }>;
  // Only canonical synthetic drafts, for human review. No HTTP envelopes/hidden reasoning/response IDs.
  readonly review: Readonly<{
    intent: string;
    action: string;
    language: string;
    flags: readonly string[];
    draft: string | null;
  }> | null;
}
export class ScreenStop extends Error {
  constructor(
    readonly reason:
      | "usage_unknown_or_overrun"
      | "provider_model_mismatch"
      | "technical_failure"
      | "retry_exhausted"
      | "recurring_transport_pattern"
      | "secret_disclosure",
    readonly details?: Readonly<{
      model: ScreenModel;
      caseId: string;
      phase: ScreenPhase;
      resultKind: AIProviderResult["kind"];
      category: string | null;
      responseModelMissing?: boolean;
    }>,
  ) {
    super(`Screen stopped: ${reason}`);
  }
}
const schema = (result: AIProviderResult) =>
  result.kind === "completed" && validateAgentDecision(result.value);
const repairable = (result: AIProviderResult) =>
  result.kind === "completed" ||
  (result.kind === "invalid_output" && result.outputHash !== undefined);

export const observeDecision = async (
  model: ScreenModel,
  provider: AIProvider,
  row: PlannedDecision,
  ledger: ReturnType<typeof createBudgetLedger>,
  options: Readonly<{
    clock?: () => number;
    secretValues?: readonly string[];
    deadlineMs?: number;
    retry?: RetryHooks;
    priorAttempt?: EvalAttempt;
    beforePhysical?: () => void;
    onAttempt?: (attempt: EvalAttempt) => void;
    onReserved?: (model: ScreenModel, row: PlannedDecision, attemptNumber: number) => void;
    ownerRecovery?: "s13c-luna-mixed-script-26-0";
  }> = {},
): Promise<LiveObservation> => {
  const clock = options.clock ?? (() => performance.now());
  const started = clock();
  let signal: AbortSignal;
  let physicalCount = options.priorAttempt?.attemptNumber ?? 0;
  let initialBackoff = 0;
  const ownerRecovery =
    options.ownerRecovery === "s13c-luna-mixed-script-26-0" &&
    model === "gpt-5.6-luna" &&
    row.item.case_id === "s13-uz-mixed-script-26-0" &&
    row.phase === "core" &&
    !row.hint &&
    options.priorAttempt?.resultKind === "unknown_interruption" &&
    options.priorAttempt.source === "historical" &&
    options.priorAttempt.category === null &&
    attemptKey(options.priorAttempt) ===
      attemptKey({ model, caseId: row.item.case_id, phase: row.phase, hint: row.hint });
  if (options.priorAttempt !== undefined) {
    if (
      options.retry === undefined ||
      physicalCount !== 1 ||
      (!ownerRecovery &&
        (options.priorAttempt.resultKind !== "provider_error" ||
          options.priorAttempt.category !== "network"))
    )
      throw new ScreenStop("retry_exhausted");
    // The owner's explicit preserved-state resume authorizes this already-reviewed interruption.
    initialBackoff = jitterDelay(options.retry.random);
    await waitForRecovery(initialBackoff, options.retry);
  }
  signal = AbortSignal.timeout(options.deadlineMs ?? LOGICAL_DEADLINE_MS);
  const physical = async (
    repair: boolean,
    backoffMs = 0,
  ): Promise<{ result: AIProviderResult; cost: string }> => {
    if (physicalCount >= 2) throw new ScreenStop("retry_exhausted");
    options.beforePhysical?.();
    try {
      ledger.before(model, row.phase === "repeat");
    } catch {
      throw new ScreenStop("usage_unknown_or_overrun");
    }
    physicalCount++;
    options.onReserved?.(model, row, physicalCount);
    options.retry?.resetDiagnostics(model);
    const attemptStarted = clock();
    const result = await provider.decide(inputForCase(row.item, signal, row.hint, repair));
    const diagnostic = options.retry?.diagnostics(model);
    const delay =
      options.retry === undefined || physicalCount !== 1 || repair
        ? null
        : retryDelay(
            result,
            diagnostic?.transport ?? null,
            diagnostic?.http ?? null,
            options.retry.random,
          );
    const unknownBill = result.usage.input === null || result.usage.output === null;
    const recordAttempt = (cost: string | null) =>
      options.onAttempt?.({
        model,
        caseId: row.item.case_id,
        phase: row.phase,
        hint: row.hint,
        attemptNumber: physicalCount === 1 ? 1 : 2,
        purpose: ownerRecovery
          ? "owner_resume"
          : repair
            ? "schema_repair"
            : physicalCount === 1
              ? "initial"
              : "transient_retry",
        resultKind: result.kind,
        category: result.kind === "provider_error" ? result.category : null,
        transport: diagnostic?.transport ?? null,
        http: diagnostic?.http ?? null,
        aborted: diagnostic?.transport?.signalAborted ?? signal.aborted,
        elapsedMs: Math.max(0, Math.floor(clock() - attemptStarted)),
        backoffMs,
        retrySucceeded:
          physicalCount === 2 && !repair
            ? ownerRecovery
              ? schema(result)
              : result.kind !== "provider_error" && result.kind !== "timeout"
            : null,
        usage: result.usage,
        billableCostUSD: unknownBill ? null : cost,
        unresolvedReservationUSD: unknownBill || cost === null ? usd(reservePerCall(model)) : null,
        source: "current",
      });
    let cost: string;
    try {
      cost = ledger.after(result.usage, delay !== null);
    } catch {
      recordAttempt(null);
      throw new ScreenStop("usage_unknown_or_overrun", {
        model,
        caseId: row.item.case_id,
        phase: row.phase,
        resultKind: result.kind,
        category: result.kind === "provider_error" ? result.category : null,
      });
    }
    if (
      result.kind === "completed" &&
      (options.secretValues ?? []).some(
        (key) => key.length > 0 && JSON.stringify(result.value).includes(key),
      )
    )
      throw new ScreenStop("secret_disclosure");
    recordAttempt(cost);
    // Transport/HTTP failures have no response body and the accepted OpenAI adapter
    // correctly reports null model metadata. That is NOT a different model response.
    // Never grant this exception to a completed/invalid/refused/incomplete response,
    // or to any non-null unexpected model. Save operational evidence before stopping.
    const missingTransportModel =
      result.model === null && (result.kind === "provider_error" || result.kind === "timeout");
    if (result.model !== model && !missingTransportModel)
      throw new ScreenStop("provider_model_mismatch", {
        model,
        caseId: row.item.case_id,
        phase: row.phase,
        resultKind: result.kind,
        category: result.kind === "provider_error" ? result.category : null,
        responseModelMissing: result.model === null,
      });
    if (
      options.retry !== undefined &&
      (result.kind === "provider_error" || result.kind === "timeout")
    ) {
      if (delay === null)
        throw new ScreenStop(physicalCount === 2 ? "retry_exhausted" : "technical_failure", {
          model,
          caseId: row.item.case_id,
          phase: row.phase,
          resultKind: result.kind,
          category: result.kind === "provider_error" ? result.category : null,
        });
      await waitForRecovery(delay, options.retry);
      // Recovery has its own existing 60-second attempt deadline; repair never resets a deadline.
      signal = AbortSignal.timeout(options.deadlineMs ?? LOGICAL_DEADLINE_MS);
      return physical(false, delay);
    }
    return { result, cost };
  };
  const first = await physical(false, initialBackoff);
  if (ownerRecovery && !schema(first.result))
    throw new ScreenStop("retry_exhausted", {
      model,
      caseId: row.item.case_id,
      phase: row.phase,
      resultKind: first.result.kind,
      category: first.result.kind === "provider_error" ? first.result.category : null,
    });
  const repaired =
    physicalCount < 2 && !schema(first.result) && repairable(first.result) && !signal.aborted
      ? await physical(true)
      : null;
  const final = repaired?.result ?? first.result;
  const firstScore = scoreCase(row.item, first.result),
    finalScore = scoreCase(row.item, final);
  const decision =
    final.kind === "completed" && validateAgentDecision(final.value) ? final.value : null;
  const policy = decision === null ? null : evaluateAIDecision(decision, policyForCase(row.item));
  const rawForbiddenAction =
    decision === null ? null : row.item.forbidden_actions.includes(decision.action.type);
  const references =
    decision !== null &&
    (decision.factual_claims.length > 0 ||
      decision.extracted_facts.service_id !== null ||
      decision.extracted_facts.location_id !== null);
  return Object.freeze({
    model,
    caseId: row.item.case_id,
    phase: row.phase,
    hint: row.hint,
    first: firstScore,
    final: finalScore,
    firstCostUSD: first.cost,
    repairCostUSD: repaired?.cost ?? null,
    repair: repaired === null ? null : scoreCase(row.item, repaired.result),
    logicalLatencyMs: Math.max(0, Math.floor(clock() - started)),
    rawForbiddenAction,
    latinDraft:
      row.item.expected_language === "uz" && decision?.message.draft_text != null
        ? finalScore.script
        : null,
    system: {
      invalidAccepted: decision === null && policy !== null,
      protectedMutationBypass: Boolean(policy?.applied),
      policyApplied: Boolean(policy?.applied),
      referenceAuthorityBypass: references && policy?.kind === "decision",
    },
    review:
      decision === null
        ? null
        : {
            intent: decision.intent,
            action: decision.action.type,
            language: decision.language,
            flags: decision.safety.risk_flags,
            draft: decision.message.draft_text,
          },
  });
};

/** Sequential, bounded calls. Recovery is opt-in, inference-only and at most one extra attempt. */
export const runLiveScreen = async (
  providers: Readonly<Record<ScreenModel, AIProvider>>,
  onObservation: (
    row: LiveObservation,
    budget: ReturnType<ReturnType<typeof createBudgetLedger>["snapshot"]>,
  ) => void,
  options: Readonly<{
    plan?: readonly PlannedDecision[];
    secretValues?: readonly string[];
    preflightReserveMicros?: bigint;
    initialObservations?: readonly LiveObservation[];
    carryBudget?: BudgetCheckpoint;
    retry?: RetryHooks;
    initialAttempts?: readonly EvalAttempt[];
    onAttempt?: (attempt: EvalAttempt, budget: BudgetCheckpoint) => void;
    budgetPhase?: BudgetPhase;
    ownerRecovery?: "s13c-luna-mixed-script-26-0";
    onReserved?: (
      model: ScreenModel,
      row: PlannedDecision,
      attemptNumber: number,
      budget: BudgetCheckpoint,
    ) => void;
    onStop?: (
      error: unknown,
      budget: ReturnType<ReturnType<typeof createBudgetLedger>["snapshot"]>,
    ) => void;
  }> = {},
) => {
  const ledger = createBudgetLedger(
      options.preflightReserveMicros,
      options.carryBudget,
      options.budgetPhase,
    ),
    observations: LiveObservation[] = [...(options.initialObservations ?? [])];
  const attempts: EvalAttempt[] = [...(options.initialAttempts ?? [])];
  const plan = options.plan ?? planScreen();
  const paired = plan.flatMap((row) => SCREEN_MODELS.map((model) => ({ row, model })));
  if (
    observations.length > paired.length ||
    observations.some((observation, index) => {
      const expected = paired[index];
      return (
        expected === undefined ||
        observation.model !== expected.model ||
        observation.caseId !== expected.row.item.case_id ||
        observation.phase !== expected.row.phase ||
        observation.hint !== expected.row.hint
      );
    })
  )
    throw new TypeError("Resume observations are not the frozen plan prefix");
  if (observations.length > 0 && options.carryBudget === undefined)
    throw new TypeError("Resume requires preserved budget");
  const completedCalls = observations.reduce(
    (sum, observation) => sum + 1 + (observation.repair === null ? 0 : 1),
    0,
  );
  if (completedCalls > ledger.snapshot().calls)
    throw new TypeError("Resume budget omits completed calls");
  if (options.retry !== undefined && attempts.length !== ledger.snapshot().calls)
    throw new TypeError("Operational attempts must match the preserved physical-call ledger");
  const matchingAttempts = (row: PlannedDecision, model: ScreenModel) =>
    attempts.filter(
      (attempt) =>
        attemptKey(attempt) ===
        attemptKey({ model, caseId: row.item.case_id, phase: row.phase, hint: row.hint }),
    );
  const assertRemainingBudget = () => {
    const slots = paired.slice(observations.length).map(({ row, model }) => {
      const used = matchingAttempts(row, model).length;
      if (used >= 2) throw new ScreenStop("retry_exhausted");
      return { model, count: 2 - used };
    });
    const bound =
      parseUSDMicros(ledger.snapshot().estimatedSpendUSD) +
      slots.reduce((sum, slot) => sum + reservePerCall(slot.model) * BigInt(slot.count), 0n);
    if (
      bound >= HARD_CAP_MICROS ||
      ledger.snapshot().calls + slots.reduce((sum, slot) => sum + slot.count, 0) > 640
    )
      throw new ScreenStop("usage_unknown_or_overrun");
  };
  try {
    for (const { row, model } of paired.slice(observations.length)) {
      const prior = matchingAttempts(row, model);
      const priorAttempt = prior.at(-1);
      const observation = await observeDecision(model, providers[model], row, ledger, {
        ...(options.secretValues === undefined ? {} : { secretValues: options.secretValues }),
        ...(options.retry === undefined
          ? {}
          : {
              retry: options.retry,
              ...(priorAttempt === undefined ? {} : { priorAttempt }),
              ...(options.ownerRecovery === undefined
                ? {}
                : { ownerRecovery: options.ownerRecovery }),
              // Owner-approved C: reserve ONLY the next physical call in ledger.before.
              // B's accepted full-remaining guard is unchanged by default.
              ...(options.budgetPhase === "finalist"
                ? {}
                : { beforePhysical: assertRemainingBudget }),
              onAttempt: (attempt: EvalAttempt) => {
                attempts.push(attempt);
                options.onAttempt?.(attempt, ledger.snapshot());
                if (recurringTransportFailure(attempts))
                  throw new ScreenStop("recurring_transport_pattern");
              },
            }),
        ...(options.onReserved === undefined
          ? {}
          : {
              onReserved: (m: ScreenModel, r: PlannedDecision, n: number) =>
                options.onReserved?.(m, r, n, ledger.snapshot()),
            }),
      });
      observations.push(observation);
      onObservation(observation, ledger.snapshot());
      if (
        row.phase === "smoke" &&
        !observation.final.schema &&
        observation.final.resultKind !== "refusal"
      )
        throw new ScreenStop("technical_failure");
    }
  } catch (error) {
    options.onStop?.(error, ledger.snapshot());
    throw error;
  }
  return { observations, attempts, budget: ledger.snapshot() };
};

export const itemForObservation = (
  observation: LiveObservation,
  cases: readonly EvalCase[],
): EvalCase => {
  const item = cases.find((row) => row.case_id === observation.caseId);
  if (item === undefined) throw new TypeError("Unknown live case");
  return item;
};
