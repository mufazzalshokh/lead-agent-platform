import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { AIUsage } from "@lead-agent/application";
import { createOpenAIProvider } from "../../packages/ai/src/providers/openai.js";
import { buildGeminiRequest } from "../../packages/ai/src/providers/gemini.js";
import { CORPUS } from "./corpus.js";
import { SLICES } from "./cases.js";
import { createBudgetLedger, parseUSDMicros, type BudgetCheckpoint } from "./budget.js";
import { attemptKey, type EvalAttempt } from "./eval-retry.js";
import {
  ACCEPTED_SCREEN_SHA256,
  readAcceptedScreen,
  remainingFinalistCases,
  type AcceptedCoreRow,
} from "./finalist-prep.js";
import { buildLiveReport, latency } from "./live-report.js";
import type { LiveObservation } from "./live-runner.js";
import { decodeResumeEvidence } from "./resume.js";
import {
  EVAL_INSTRUCTIONS,
  INPUT_RESERVE,
  inputForCase,
  openAIScreenFetch,
  SCREEN_MODELS,
  type PlannedDecision,
} from "./screen.js";
import { usd } from "./cost.js";

const record = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const nullableText = (v: unknown): v is string | null =>
  v === null || (typeof v === "string" && v.length <= 100);
const count = (v: unknown): v is number =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= 0 && v <= 10000000;
const bool = (v: unknown) => v === null || typeof v === "boolean";
const money = (v: unknown) =>
  v === null || (typeof v === "string" && /^\$\d{1,2}\.\d{6}$/u.test(v));
const usage = (v: unknown): v is AIUsage =>
  record(v) &&
  ["input", "output", "total", "cachedInput", "reasoning"].every(
    (key) => v[key] === null || count(v[key]),
  );
// This reader is deliberately limited to the SHA-pinned B artifact, whose transport
// diagnostics are null (legacy unknown interruptions must remain unknown).
export const acceptedAttempt = (v: unknown): v is EvalAttempt =>
  record(v) &&
  SCREEN_MODELS.some((m) => m === v["model"]) &&
  typeof v["caseId"] === "string" &&
  v["caseId"].length <= 100 &&
  ["smoke", "core", "normalization"].some((p) => p === v["phase"]) &&
  typeof v["hint"] === "boolean" &&
  (v["attemptNumber"] === 1 || v["attemptNumber"] === 2) &&
  ["initial", "schema_repair", "transient_retry", "owner_resume"].some((p) => p === v["purpose"]) &&
  ["completed", "refusal", "incomplete", "timeout", "invalid_output", "provider_error"].some(
    (k) => k === v["resultKind"],
  ) &&
  nullableText(v["category"]) &&
  v["transport"] === null &&
  (v["http"] === null ||
    (record(v["http"]) &&
      v["http"]["status"] === 429 &&
      v["http"]["code"] === null &&
      v["http"]["category"] === null)) &&
  bool(v["aborted"]) &&
  (v["elapsedMs"] === null || count(v["elapsedMs"])) &&
  (v["backoffMs"] === null || count(v["backoffMs"])) &&
  bool(v["retrySucceeded"]) &&
  usage(v["usage"]) &&
  money(v["billableCostUSD"]) &&
  money(v["unresolvedReservationUSD"]) &&
  (v["source"] === "historical" || v["source"] === "current");

/** No generation: hash-pin, validate and preserve all accepted observations/attempts. */
export const readFinalistBase = (path: string) => {
  const rows = readAcceptedScreen(path);
  const raw: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (!record(raw) || !Array.isArray(raw["attempts"]) || !raw["attempts"].every(acceptedAttempt))
    throw new TypeError("Accepted operational evidence invalid");
  // Reuse the existing observation/accounting validator without modifying stored bytes.
  const decoded = decodeResumeEvidence({ ...raw, status: "STOPPED" });
  const attempts: EvalAttempt[] = raw["attempts"];
  if (attempts.length !== decoded.budget.calls) throw new TypeError("Accepted ledger mismatch");
  return { rows, observations: decoded.observations, attempts, budget: decoded.budget };
};
export const finalistPlan = (rows: readonly AcceptedCoreRow[]): readonly PlannedDecision[] => {
  const remaining = remainingFinalistCases(rows);
  const first = remaining[0],
    second = remaining[1];
  if (
    first === undefined ||
    second === undefined ||
    first.cases.some((item, index) => item !== second.cases[index])
  )
    throw new TypeError("Finalist plans differ");
  return first.cases.map((item) => ({ item, phase: "core", hint: false }));
};
export const FULL_CORPUS_HASH = createHash("sha256").update(JSON.stringify(CORPUS)).digest("hex");

/** Fake-fetch proof for every new original and potential repair; zero authenticated calls. */
export const verifyFinalistWireBounds = async (plan: readonly PlannedDecision[]) => {
  let largestSerializedBytes = 0;
  for (const row of plan) {
    for (const repair of [false, true]) {
      const input = inputForCase(row.item, new AbortController().signal, false, repair);
      let captured = false;
      await createOpenAIProvider(
        { apiKey: "synthetic-offline-placeholder", model: "gpt-5.6-luna", requestTimeoutMs: 1000 },
        {
          fetch: openAIScreenFetch((_url, options) => {
            if (typeof options?.body !== "string") throw new TypeError("No serialized request");
            largestSerializedBytes = Math.max(
              largestSerializedBytes,
              Buffer.byteLength(options.body),
            );
            captured = true;
            return Promise.resolve(Response.json({}));
          }),
        },
      ).decide(input);
      if (!captured) throw new TypeError("OpenAI fixture exceeded request bound");
      largestSerializedBytes = Math.max(
        largestSerializedBytes,
        Buffer.byteLength(JSON.stringify(buildGeminiRequest(input, EVAL_INSTRUCTIONS, "low"))),
      );
      if (largestSerializedBytes + 512 > INPUT_RESERVE)
        throw new TypeError("Fixture reserve exceeded");
    }
  }
  return {
    fixtures: plan.length,
    originalAndRepair: plan.length * 2,
    largestSerializedBytes,
    inputReserve: INPUT_RESERVE,
    authenticatedCalls: 0,
  };
};

export const mergeFinalist = (
  accepted: readonly LiveObservation[],
  additional: readonly LiveObservation[],
) => {
  const merged = [...accepted, ...additional];
  const core = merged.filter((row) => row.phase === "core");
  if (
    additional.length !== 840 ||
    additional.some((row) => row.phase !== "core" || row.hint) ||
    core.length !== 1120 ||
    new Set(core.map(attemptKey)).size !== 1120 ||
    SCREEN_MODELS.some((model) =>
      CORPUS.some(
        (item) => !core.some((row) => row.model === model && row.caseId === item.case_id),
      ),
    )
  )
    throw new TypeError("Incomplete, duplicate or conflicting full-corpus evidence");
  return merged;
};
export const reviewRows = (observations: readonly LiveObservation[]): readonly AcceptedCoreRow[] =>
  observations
    .filter((row) => row.phase === "core")
    .map((row) => ({
      model: row.model,
      caseId: row.caseId,
      usage: row.final.providerMetadata.usage,
      costUSD: row.firstCostUSD,
      intentPass: row.final.intent,
      safetyPass: row.final.safety,
      scriptPass: row.final.script,
      deterministicPass: row.final.deterministicPass,
      intent: row.review?.intent ?? null,
      action: row.review?.action ?? null,
      draft: row.review?.draft ?? null,
    }));

export const buildFinalistReport = (
  base: ReturnType<typeof readFinalistBase>,
  additional: readonly LiveObservation[],
  attempts: readonly EvalAttempt[],
  budget: BudgetCheckpoint,
) => {
  const merged = mergeFinalist(base.observations, additional);
  createBudgetLedger(0n, budget, "finalist");
  if (attempts.length !== budget.calls) throw new TypeError("Finalist operational ledger mismatch");
  const known = attempts.reduce(
    (sum, row) => sum + parseUSDMicros(row.billableCostUSD ?? "$0.000000"),
    0n,
  );
  const unresolved = attempts.reduce(
    (sum, row) => sum + parseUSDMicros(row.unresolvedReservationUSD ?? "$0.000000"),
    0n,
  );
  if (known + unresolved !== parseUSDMicros(budget.estimatedSpendUSD))
    throw new TypeError("Finalist cost mismatch");
  const report = buildLiveReport(merged, [...base.attempts, ...attempts]);
  return {
    ...report,
    version: "s13-finalist.v1",
    corpusHash: FULL_CORPUS_HASH,
    acceptedScreenSha256: ACCEPTED_SCREEN_SHA256,
    correlatedSeedClusters: 60,
    independentConversations: false,
    knownUsageS13CUSD: usd(known),
    unresolvedS13CUSD: usd(unresolved),
    s13CBudget: budget,
    acceptedS13BBudget: base.budget,
    cumulativeConservativeUSD: usd(
      parseUSDMicros(base.budget.estimatedSpendUSD) + known + unresolved,
    ),
    productionModel: "NOT_SELECTED",
    fineTuning: "NOT_PERFORMED",
    nativeHumanReview: "PENDING",
    models: report.models.map((model) => {
      const core = merged.filter((row) => row.model === model.model && row.phase === "core");
      const physical = [...base.attempts, ...attempts].filter(
        (row) => row.model === model.model && row.phase === "core",
      );
      const retried = new Set(
        physical
          .filter((row) => row.purpose === "transient_retry" || row.purpose === "owner_resume")
          .map(attemptKey),
      );
      return {
        ...model,
        mergedCoreCases: core.length,
        preservedCoreCases: 140,
        newCoreCases: 420,
        coreFirstPhysicalSchemaPassed: core.filter((row) => {
          const first = physical.find(
            (p) => attemptKey(p) === attemptKey(row) && p.attemptNumber === 1,
          );
          return (
            first?.resultKind !== "provider_error" &&
            first?.resultKind !== "timeout" &&
            first?.resultKind !== "unknown_interruption" &&
            row.first.schema
          );
        }).length,
        coreLatencyMs: {
          receivedFirst: latency(core.map((row) => row.first.providerMetadata.latencyMs)),
          successfulFirstAttempt: latency(
            core
              .filter((row) => !retried.has(attemptKey(row)))
              .map((row) => row.first.providerMetadata.latencyMs),
          ),
          repair: latency(
            core.flatMap((row) =>
              row.repair === null ? [] : [row.repair.providerMetadata.latencyMs],
            ),
          ),
          perSlice: SLICES.map((slice) => ({
            slice,
            ...latency(
              core
                .filter((row) => row.final.slice === slice)
                .map((row) => row.first.providerMetadata.latencyMs),
            ),
          })),
          outputTokenBands: [
            [0, 199],
            [200, 399],
            [400, 799],
            [800, 4000],
          ].map(([min, max]) => ({
            minimumOutputTokens: min,
            maximumOutputTokens: max,
            ...latency(
              core
                .filter((row) => {
                  const output = row.first.providerMetadata.usage.output;
                  return (
                    output !== null &&
                    min !== undefined &&
                    max !== undefined &&
                    output >= min &&
                    output <= max
                  );
                })
                .map((row) => row.first.providerMetadata.latencyMs),
            ),
          })),
        },
        failureSeeds: [...new Set(CORPUS.map((item) => item.provenance.seed_cluster))].map(
          (seed) => {
            const rows = core.filter(
              (row) =>
                CORPUS.find((item) => item.case_id === row.caseId)?.provenance.seed_cluster ===
                seed,
            );
            return {
              seed,
              cases: rows.length,
              failed: rows.filter((row) => !row.final.deterministicPass).length,
            };
          },
        ),
      };
    }),
  };
};
