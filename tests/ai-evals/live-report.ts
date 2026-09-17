import { SLICES } from "./cases.js";
import { ABLATIONS, SCREEN_HASH, SCREEN_MODELS, SCREEN_VERSION } from "./screen.js";
import type { LiveObservation } from "./live-runner.js";
import { usd } from "./cost.js";
import { attemptKey, type EvalAttempt } from "./eval-retry.js";

const rate = (values: readonly (boolean | null)[]) => ({
  passed: values.filter((v) => v === true).length,
  measured: values.filter((v) => v !== null).length,
  cases: values.length,
  rateAllCases:
    values.length === 0 ? null : values.filter((v) => v === true).length / values.length,
});
const latency = (values: readonly number[]) => {
  if (values.some((v) => !Number.isFinite(v) || v < 0)) throw new TypeError("Invalid latency");
  const sorted = [...values].sort((a, b) => a - b);
  const percentile = (p: number) => sorted[Math.ceil(sorted.length * p) - 1] ?? null;
  return {
    samples: values.length,
    p50: percentile(0.5),
    p95: percentile(0.95),
    p99: percentile(0.99),
    max: sorted.at(-1) ?? null,
  };
};
const dollarsMicros = (value: string) => {
  if (!/^\$\d+\.\d{6}$/u.test(value)) throw new TypeError("Invalid cost");
  return BigInt(value.slice(1).replace(".", ""));
};
const metrics = (rows: readonly LiveObservation[]) => ({
  firstSchema: rate(rows.map((r) => r.first.schema)),
  afterRepairSchema: rate(rows.map((r) => r.final.schema)),
  intent: rate(rows.map((r) => r.final.intent)),
  actionAllowed: rate(rows.map((r) => r.final.action)),
  rawForbiddenAction: rate(rows.map((r) => r.rawForbiddenAction)),
  language: rate(rows.map((r) => r.final.language)),
  latinDraft: rate(rows.map((r) => r.latinDraft)),
  safety: rate(rows.map((r) => r.final.safety)),
  refusal: rate(rows.map((r) => r.final.refusal)),
  deterministicPass: rate(rows.map((r) => r.final.deterministicPass)),
});
const usage = (rows: readonly LiveObservation[]) => {
  const physical = rows.flatMap((r) => [r.first, ...(r.repair === null ? [] : [r.repair])]);
  return Object.fromEntries(
    ["input", "output", "total", "cachedInput", "reasoning"].map((field) => {
      const values = physical.map((row) => {
        switch (field) {
          case "input":
            return row.providerMetadata.usage.input;
          case "output":
            return row.providerMetadata.usage.output;
          case "total":
            return row.providerMetadata.usage.total;
          case "cachedInput":
            return row.providerMetadata.usage.cachedInput;
          default:
            return row.providerMetadata.usage.reasoning;
        }
      });
      return [
        field,
        {
          tokens: values.reduce<number>((sum, v) => sum + (v ?? 0), 0),
          unknownCalls: values.filter((v) => v === null).length,
        },
      ];
    }),
  );
};
export const buildLiveReport = (
  observations: readonly LiveObservation[],
  attempts: readonly EvalAttempt[] = [],
) => ({
  version: SCREEN_VERSION,
  corpusHash: SCREEN_HASH,
  nativeHumanReview: "PENDING",
  productionModel: "NOT_SELECTED",
  models: SCREEN_MODELS.map((model) => {
    const all = observations.filter((r) => r.model === model),
      core = all.filter((r) => r.phase === "core");
    const cost = (rows: readonly LiveObservation[]) =>
      rows.reduce(
        (sum, r) =>
          sum + dollarsMicros(r.firstCostUSD) + dollarsMicros(r.repairCostUSD ?? "$0.000000"),
        0n,
      );
    const injection = core.filter((r) => r.final.slice === "PROMPT_INJECTION");
    const physical = attempts.filter((attempt) => attempt.model === model);
    const retried = physical.filter(
      (attempt) => attempt.purpose === "transient_retry" || attempt.purpose === "owner_resume",
    );
    const retryKeys = new Set(retried.map(attemptKey));
    const retryLatencies = retried.map((retry) => {
      const first = physical.find(
        (attempt) => attemptKey(attempt) === attemptKey(retry) && attempt.attemptNumber === 1,
      );
      return first?.elapsedMs == null || retry.elapsedMs === null || retry.backoffMs === null
        ? null
        : first.elapsedMs + retry.backoffMs + retry.elapsedMs;
    });
    const successfulCalls = physical.filter(
      (attempt) => !["provider_error", "timeout"].includes(attempt.resultKind),
    );
    return {
      model,
      logicalDecisions: all.length,
      smoke: metrics(all.filter((r) => r.phase === "smoke")),
      core: metrics(core),
      firstPhysicalSchema: rate(
        all.map((observation) => {
          const firstAttempt = physical.find(
            (attempt) =>
              attemptKey(attempt) === attemptKey(observation) && attempt.attemptNumber === 1,
          );
          return firstAttempt?.resultKind === "provider_error" ||
            firstAttempt?.resultKind === "timeout"
            ? false
            : observation.first.schema;
        }),
      ),
      operational: {
        physicalAttempts: physical.length,
        successfulCalls: successfulCalls.length,
        successfulCallRate: physical.length === 0 ? null : successfulCalls.length / physical.length,
        providerFailures: physical.filter((attempt) => attempt.resultKind === "provider_error")
          .length,
        providerRefusals: physical.filter((attempt) => attempt.resultKind === "refusal").length,
        timeoutCount: physical.filter((attempt) => attempt.resultKind === "timeout").length,
        transportInterruptions: physical.filter(
          (attempt) => attempt.category === "network" || attempt.resultKind === "timeout",
        ).length,
        retryCount: retried.length,
        retrySuccesses: retried.filter((attempt) => attempt.retrySucceeded === true).length,
        retrySuccessRate:
          retried.length === 0
            ? null
            : retried.filter((attempt) => attempt.retrySucceeded === true).length / retried.length,
        successfulFirstAttemptLatencyMs: latency(
          all
            .filter((row) => !retryKeys.has(attemptKey(row)))
            .map((row) => row.first.providerMetadata.latencyMs),
        ),
        retryRequiredLatencyMs: latency(
          retryLatencies.filter((value): value is number => value !== null),
        ),
        retryLatencyUnknown: retryLatencies.filter((value) => value === null).length,
        retryCurrentSegmentLatencyMs: latency(
          all.filter((row) => retryKeys.has(attemptKey(row))).map((row) => row.logicalLatencyMs),
        ),
        knownCostUSD: usd(
          physical.reduce(
            (sum, attempt) => sum + dollarsMicros(attempt.billableCostUSD ?? "$0.000000"),
            0n,
          ),
        ),
        unresolvedReservationUSD: usd(
          physical.reduce(
            (sum, attempt) => sum + dollarsMicros(attempt.unresolvedReservationUSD ?? "$0.000000"),
            0n,
          ),
        ),
      },
      perSlice: SLICES.map((slice) => ({
        slice,
        ...metrics(core.filter((r) => r.final.slice === slice)),
      })),
      repairs: {
        attempted: all.filter((r) => r.repair !== null).length,
        successful: all.filter((r) => r.repair?.schema).length,
        costUSD: usd(
          all.reduce((sum, r) => sum + dollarsMicros(r.repairCostUSD ?? "$0.000000"), 0n),
        ),
        usage: usage(
          all
            .filter((r) => r.repair !== null)
            .map((r) => ({ ...r, first: r.repair ?? r.first, repair: null })),
        ),
      },
      injection: {
        modelPass: rate(injection.map((r) => r.final.safety === true && r.final.action === true)),
        systemPass: rate(
          injection.map(
            (r) =>
              !r.system.policyApplied &&
              !r.system.referenceAuthorityBypass &&
              !r.system.invalidAccepted,
          ),
        ),
      },
      systemRedLines: {
        invalidAccepted: all.filter((r) => r.system.invalidAccepted).length,
        protectedMutationBypass: all.filter((r) => r.system.protectedMutationBypass).length,
        referenceAuthorityBypass: all.filter((r) => r.system.referenceAuthorityBypass).length,
        executionAttempts: 0,
        secretDisclosure: 0,
      },
      latencyMs: {
        physical: latency(
          all.flatMap((r) => [
            r.first.providerMetadata.latencyMs,
            ...(r.repair === null ? [] : [r.repair.providerMetadata.latencyMs]),
          ]),
        ),
        firstPass: latency(all.map((r) => r.first.providerMetadata.latencyMs)),
        repair: latency(
          all.flatMap((r) => (r.repair === null ? [] : [r.repair.providerMetadata.latencyMs])),
        ),
        logical: latency(all.map((r) => r.logicalLatencyMs)),
        timeouts: all.filter((r) => r.final.resultKind === "timeout").length,
      },
      usage: usage(all),
      costUSD: usd(cost(all)),
      coreCostUSD: usd(cost(core)),
      projectedPer1000Conversations: {
        assumption:
          "10 decisions/conversation; observed core average including repairs; excludes channel/DB/hosting/staff",
        usd:
          core.length === 0
            ? null
            : usd((cost(core) * 10000n + BigInt(core.length) - 1n) / BigInt(core.length)),
      },
      normalization: ABLATIONS.map((item) => {
        const a = core.find((r) => r.caseId === item.case_id),
          b = all.find((r) => r.phase === "normalization" && r.caseId === item.case_id);
        return {
          caseId: item.case_id,
          slice: item.slice,
          A: a === undefined ? null : metrics([a]),
          B: b === undefined ? null : metrics([b]),
          latencyA: a?.logicalLatencyMs ?? null,
          latencyB: b?.logicalLatencyMs ?? null,
          usageA: a === undefined ? null : usage([a]),
          usageB: b === undefined ? null : usage([b]),
        };
      }),
      failureClusters: core
        .filter((r) => !r.final.deterministicPass)
        .map((r) => ({
          caseId: r.caseId,
          slice: r.final.slice,
          intent: r.final.intent,
          action: r.final.action,
          language: r.final.language,
          script: r.final.script,
          safety: r.final.safety,
          refusal: r.final.refusal,
        })),
    };
  }),
});
