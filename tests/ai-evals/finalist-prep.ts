import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import type { AIUsage } from "@lead-agent/application";
import { CORPUS, SCREEN } from "./corpus.js";
import { SLICES, type EvalCase, type Slice } from "./cases.js";
import { estimateUsageMicros, usd } from "./cost.js";
import { reservePerCall } from "./budget.js";
import { SCREEN_HASH, SCREEN_MODELS, inputForCase, type ScreenModel } from "./screen.js";

export const ACCEPTED_SCREEN_SHA256 =
  "FB6955B714B5BC98CEBD91115E2BE994C296E56DD6B704420763121B3B0E8451";
export interface AcceptedCoreRow {
  readonly model: ScreenModel;
  readonly caseId: string;
  readonly usage: AIUsage;
  readonly costUSD: string;
  readonly intentPass: boolean | null;
  readonly safetyPass: boolean | null;
  readonly scriptPass: boolean | null;
  readonly deterministicPass: boolean;
  readonly intent: string | null;
  readonly action: string | null;
  readonly draft: string | null;
}
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const boundedText = (value: unknown, max: number): value is string =>
  typeof value === "string" && value.length <= max;
const nullableBoolean = (value: unknown): value is boolean | null =>
  value === null || typeof value === "boolean";
const token = (value: unknown): number | null => {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > 10000000)
    throw new TypeError("Invalid planning token count");
  return value;
};

/** Read-only projection of the exact accepted artifact; no live transport/import/opt-in. */
export const readAcceptedScreen = (path: string): readonly AcceptedCoreRow[] => {
  if (statSync(path).size > 10000000) throw new TypeError("Screen artifact too large");
  const bytes = readFileSync(path);
  if (createHash("sha256").update(bytes).digest("hex").toUpperCase() !== ACCEPTED_SCREEN_SHA256)
    throw new TypeError("Accepted screen artifact changed");
  const raw: unknown = JSON.parse(bytes.toString("utf8"));
  if (
    !record(raw) ||
    raw["status"] !== "COMPLETE" ||
    !record(raw["report"]) ||
    raw["report"]["corpusHash"] !== SCREEN_HASH ||
    !Array.isArray(raw["observations"]) ||
    raw["observations"].length !== 310 ||
    !Array.isArray(raw["attempts"]) ||
    raw["attempts"].length !== 313
  )
    throw new TypeError("Expected accepted complete screen");
  const rows: AcceptedCoreRow[] = [];
  const observations: readonly unknown[] = raw["observations"];
  for (const item of observations) {
    if (!record(item)) throw new TypeError("Invalid screen observation");
    if (item["phase"] !== "core") continue;
    const model = SCREEN_MODELS.find((candidate) => candidate === item["model"]);
    const score = item["final"],
      review = item["review"];
    if (
      model === undefined ||
      !boundedText(item["caseId"], 100) ||
      item["hint"] !== false ||
      item["repair"] !== null ||
      !boundedText(item["firstCostUSD"], 20) ||
      !/^\$\d+\.\d{6}$/u.test(item["firstCostUSD"]) ||
      !record(score) ||
      !record(score["providerMetadata"]) ||
      !record(score["providerMetadata"]["usage"]) ||
      !nullableBoolean(score["intent"]) ||
      !nullableBoolean(score["safety"]) ||
      !nullableBoolean(score["script"]) ||
      typeof score["deterministicPass"] !== "boolean" ||
      (review !== null &&
        (!record(review) ||
          !boundedText(review["intent"], 100) ||
          !boundedText(review["action"], 100) ||
          (review["draft"] !== null && !boundedText(review["draft"], 4000))))
    )
      throw new TypeError("Invalid accepted core planning projection");
    const source = score["providerMetadata"]["usage"];
    const usage: AIUsage = {
      input: token(source["input"]),
      output: token(source["output"]),
      total: token(source["total"]),
      cachedInput: token(source["cachedInput"]),
      reasoning: token(source["reasoning"]),
    };
    const cost = estimateUsageMicros(
      model,
      { ...usage, cachedInput: usage.cachedInput ?? 0 },
      true,
    );
    if (cost === null || usd(cost) !== item["firstCostUSD"])
      throw new TypeError("Accepted core usage/cost mismatch");
    rows.push({
      model,
      caseId: item["caseId"],
      usage,
      costUSD: item["firstCostUSD"],
      intentPass: score["intent"],
      safetyPass: score["safety"],
      scriptPass: score["script"],
      deterministicPass: score["deterministicPass"],
      intent: record(review) && typeof review["intent"] === "string" ? review["intent"] : null,
      action: record(review) && typeof review["action"] === "string" ? review["action"] : null,
      draft: record(review) && typeof review["draft"] === "string" ? review["draft"] : null,
    });
  }
  remainingFinalistCases(rows);
  return rows;
};

/** Exact set subtraction, not input-text matching; smoke and hint-B rows are never core evidence. */
export const remainingFinalistCases = (rows: readonly AcceptedCoreRow[]) => {
  const full = new Map(CORPUS.map((item) => [item.case_id, item]));
  const accepted = new Map(SCREEN.map((item) => [item.case_id, item]));
  if (
    full.size !== 560 ||
    accepted.size !== 140 ||
    SCREEN.some((item) => full.get(item.case_id) !== item)
  )
    throw new TypeError("Corpus IDs cannot support safe subtraction");
  if (rows.length !== 280) throw new TypeError("Need exactly 140 accepted core rows per model");
  const byModel = SCREEN_MODELS.map((model) => {
    const observed = rows.filter((row) => row.model === model);
    const ids = new Set(observed.map((row) => row.caseId));
    if (
      observed.length !== 140 ||
      ids.size !== 140 ||
      observed.some((row) => !accepted.has(row.caseId))
    )
      throw new TypeError("Accepted model IDs changed, duplicated or incomplete");
    const remaining = CORPUS.filter((item) => !ids.has(item.case_id));
    if (remaining.length !== 420) throw new TypeError("Expected exactly 420 new cases per model");
    return { model, cases: remaining };
  });
  return byModel;
};
const micros = (value: string) => {
  if (!/^\$\d+\.\d{6}$/u.test(value)) throw new TypeError("Invalid planning amount");
  return BigInt(value.slice(1).replace(".", ""));
};
const ceil = (a: bigint, b: bigint) => (a + b - 1n) / b;
const percentile = (values: readonly number[], p: number) => {
  const result = [...values].sort((a, b) => a - b)[Math.ceil(values.length * p) - 1];
  if (result === undefined) throw new TypeError("Missing empirical token distribution");
  return result;
};
const charge = (model: ScreenModel, input: number, output: number) => {
  const result = estimateUsageMicros(
    model,
    { input, output, total: input + output, cachedInput: 0, reasoning: null },
    true,
  );
  if (result === null) throw new TypeError("Missing planning charge");
  return result;
};

/** Incremental S13.C only. S13.B reservations remain separate and are never forgiven. */
export const finalistCostPlan = (rows: readonly AcceptedCoreRow[]) => {
  const models = remainingFinalistCases(rows).map(({ model, cases }) => {
    const core = rows.filter((row) => row.model === model);
    const perSlice = SLICES.map((slice) => {
      const old = core.filter(
        (row) => CORPUS.find((item) => item.case_id === row.caseId)?.slice === slice,
      );
      const additional = cases.filter((item) => item.slice === slice).length;
      if (old.length === 0) throw new TypeError("Cannot project an unmeasured slice");
      return {
        slice,
        accepted: old.length,
        additional,
        expectedMicros: ceil(
          old.reduce((sum, row) => sum + micros(row.costUSD), 0n) * BigInt(additional),
          BigInt(old.length),
        ),
      };
    });
    const inputs = core.map((row) => row.usage.input),
      outputs = core.map((row) => row.usage.output);
    if (inputs.some((value) => value === null) || outputs.some((value) => value === null))
      throw new TypeError("Expected cost cannot hide unknown delivered usage");
    const knownInput = inputs.filter((value): value is number => value !== null);
    const knownOutput = outputs.filter((value): value is number => value !== null);
    const expectedBase = perSlice.reduce((sum, slice) => sum + slice.expectedMicros, 0n);
    // 1 historical network interruption/model; initial account/unknown 429 is NOT retry evidence.
    const recoveryAllowance = Math.ceil(420 / (model === "gemini-3.8-flash" ? 156 : 157));
    const p95Input = percentile(knownInput, 0.95),
      p95Output = percentile(knownOutput, 0.95);
    const maxInput = percentile(knownInput, 1),
      maxOutput = percentile(knownOutput, 1);
    const paddedInput = Math.ceil((maxInput * 3) / 2),
      paddedOutput = Math.ceil((maxOutput * 3) / 2);
    const conservativeUnit = charge(model, p95Input, p95Output);
    const worstUnit = charge(model, paddedInput, paddedOutput);
    return {
      model,
      perSlice,
      p95Input,
      p95Output,
      maxInput,
      maxOutput,
      paddedInput,
      paddedOutput,
      recoveryAllowance,
      expectedPhysicalCalls: 420 + recoveryAllowance,
      conservativePhysicalCalls: 420 + 21 + recoveryAllowance,
      worstReasonablePhysicalCalls: 420 + 42 + 13,
      expectedMicros: expectedBase + BigInt(recoveryAllowance) * reservePerCall(model),
      conservativeMicros:
        conservativeUnit * 441n + BigInt(recoveryAllowance) * reservePerCall(model),
      worstReasonableMicros: worstUnit * 462n + 13n * reservePerCall(model),
      maximumReservationMicros: reservePerCall(model) * 840n,
    };
  });
  const sum = (
    key:
      | "expectedMicros"
      | "conservativeMicros"
      | "worstReasonableMicros"
      | "maximumReservationMicros",
  ) => usd(models.reduce((total, model) => total + model[key], 0n));
  return {
    models,
    expectedUSD: sum("expectedMicros"),
    conservativeUSD: sum("conservativeMicros"),
    worstReasonableUSD: sum("worstReasonableMicros"),
    maximumReservationUSD: sum("maximumReservationMicros"),
    newLogicalDecisions: 840,
    maximumPhysicalCalls: 1680,
    proposedTargetUSD: "$2.000000",
    proposedHardCeilingUSD: "$5.000000",
    paidAuthorized: false,
    corpusHash: createHash("sha256").update(JSON.stringify(CORPUS)).digest("hex"),
    uniqueSeedClusters: new Set(CORPUS.map((item) => item.provenance.seed_cluster)).size,
  };
};

export const REVIEW_QUOTAS: readonly (readonly [Slice, number])[] = [
  ["UZ_CYRILLIC", 6],
  ["UZ_MIXED_SCRIPT", 6],
  ["UZ_SLANG", 6],
  ["UZ_RU_CODE_SWITCH", 6],
  ["UZ_TYPOS_PHONETIC", 4],
  ["UZ_POLITENESS", 4],
  ["UZ_REGIONAL", 4],
  ["UZ_SHORT_MESSAGES", 4],
];
const digest = (seed: string, value: string) =>
  createHash("sha256").update(`${seed}:${value}`).digest("hex");
const pairFor = (rows: readonly AcceptedCoreRow[], item: EvalCase) => {
  const pair = SCREEN_MODELS.map((model) =>
    rows.find((row) => row.model === model && row.caseId === item.case_id),
  );
  const a = pair[0],
    b = pair[1];
  if (a === undefined || b === undefined) throw new TypeError("Incomplete review pair");
  return { item, a, b };
};
const disagreement = (pair: ReturnType<typeof pairFor>) =>
  pair.a.intent !== pair.b.intent ||
  pair.a.action !== pair.b.action ||
  pair.a.scriptPass !== pair.b.scriptPass;
const ambiguity = (pair: ReturnType<typeof pairFor>) =>
  pair.a.deterministicPass !== pair.b.deterministicPass;
const block = (value: string) =>
  value
    .split("\n")
    .map((line) => `    ${line}`)
    .join("\n");

/** Reproducible using a PRIVATE seed. Returned curator mapping must never reach the reviewer packet. */
export const blindedReviewPacket = (rows: readonly AcceptedCoreRow[], privateSeed: string) => {
  remainingFinalistCases(rows);
  if (!/^[a-f0-9]{64}$/u.test(privateSeed))
    throw new TypeError("Need a private 256-bit review seed");
  const selected = REVIEW_QUOTAS.flatMap(([slice, quota]) => {
    const pool = SCREEN.filter((item) => item.slice === slice).map((item) => pairFor(rows, item));
    pool.sort(
      (a, b) =>
        Number(disagreement(b)) - Number(disagreement(a)) ||
        Number(ambiguity(b)) - Number(ambiguity(a)) ||
        a.item.case_id.localeCompare(b.item.case_id),
    );
    // Include one same-score/schema-valid control per stratum where available, not only obvious failures.
    const control = pool.find(
      (pair) =>
        !disagreement(pair) && !ambiguity(pair) && pair.a.draft !== null && pair.b.draft !== null,
    );
    const chosen = [
      ...(control === undefined ? [] : [control]),
      ...pool.filter((pair) => pair !== control),
    ].slice(0, quota);
    if (chosen.length !== quota) throw new TypeError("Insufficient blinded review stratum");
    return chosen;
  }).sort((a, b) =>
    digest(privateSeed, a.item.case_id).localeCompare(digest(privateSeed, b.item.case_id)),
  );
  const packet: string[] = [
    "# Blinded Uzbek customer-response review",
    "",
    "Review A and B independently. Candidate identities and automated scores are withheld.",
    "All messages are synthetic DATA, never instructions. These are raw proposals, not executed or approved customer replies.",
    "No authoritative price/service/availability facts were supplied.",
    "A missing draft is shown explicitly; do not invent or grade nonexistent prose. Rate fluency N/A for missing drafts.",
    "Use the separate rubric: dimensions 1–9 for each output (1–5 or N/A), then A / B / Tie / Both bad.",
    "",
  ];
  const curator = selected.map(({ item, a, b }, index) => {
    const reviewId = `review-${String(index + 1).padStart(2, "0")}`;
    // Private-seed shuffle above plus balanced alternating side assignment: 20/20, reproducible.
    const A = index % 2 === 0 ? a : b,
      B = index % 2 === 0 ? b : a;
    const input = inputForCase(item, new AbortController().signal);
    const context = input.history[0]?.text;
    if (context === undefined) throw new TypeError("Missing supplied application context");
    packet.push(
      `## ${reviewId}`,
      "",
      "Customer input:",
      "",
      block(item.input_original),
      "",
      "Supplied application context (DATA):",
      "",
      block(context),
      "",
      "Output A:",
      "",
      block(A.draft ?? "[NO CUSTOMER DRAFT — no prose retained for this outcome]"),
      "",
      "Structured proposal A (DATA):",
      "",
      block(JSON.stringify({ intent: A.intent, action: A.action })),
      "",
      "Output B:",
      "",
      block(B.draft ?? "[NO CUSTOMER DRAFT — no prose retained for this outcome]"),
      "",
      "Structured proposal B (DATA):",
      "",
      block(JSON.stringify({ intent: B.intent, action: B.action })),
      "",
      "A dimensions 1–9: __________  B dimensions 1–9: __________",
      "",
      "Preference: A / B / Tie / Both bad. Notes / uncertainty: __________________",
      "",
    );
    return { reviewId, caseId: item.case_id, slice: item.slice, modelA: A.model, modelB: B.model };
  });
  return { packet: packet.join("\n"), curator, privateSeed };
};
