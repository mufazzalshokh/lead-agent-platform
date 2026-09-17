import { readFileSync, statSync } from "node:fs";
import type { AIUsage, AIProviderMetadata } from "@lead-agent/application";
import { SLICES } from "./cases.js";
import type { CaseScore } from "./scorer.js";
import type { LiveObservation } from "./live-runner.js";
import {
  createBudgetLedger,
  HARD_CAP_MICROS,
  parseUSDMicros,
  reservePerCall,
  type BudgetCheckpoint,
} from "./budget.js";
import { planScreen, SCREEN_HASH, SCREEN_MODELS } from "./screen.js";

const record = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const text = (v: unknown, max = 32000): v is string => typeof v === "string" && v.length <= max;
const count = (v: unknown): v is number =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= 0 && v <= 10000000;
const nullableBool = (v: unknown) => v === null || typeof v === "boolean";
const money = (v: unknown): v is string => text(v, 20) && /^\$\d{1,2}\.\d{6}$/u.test(v);
const usage = (v: unknown): v is AIUsage =>
  record(v) &&
  ["input", "output", "total", "cachedInput", "reasoning"].every(
    (k) => v[k] === null || count(v[k]),
  );
const metadata = (v: unknown): v is AIProviderMetadata =>
  record(v) &&
  SCREEN_MODELS.some((m) => m === v["model"]) &&
  v["responseId"] === null &&
  count(v["latencyMs"]) &&
  usage(v["usage"]);
const system = (v: unknown): v is LiveObservation["system"] =>
  record(v) &&
  ["invalidAccepted", "protectedMutationBypass", "policyApplied", "referenceAuthorityBypass"].every(
    (k) => typeof v[k] === "boolean",
  );
const modelCosts = (v: unknown): v is Readonly<Record<(typeof SCREEN_MODELS)[number], string>> =>
  record(v) && SCREEN_MODELS.every((m) => money(v[m]));
const score = (v: unknown): v is CaseScore =>
  record(v) &&
  text(v["caseId"], 100) &&
  SLICES.some((s) => s === v["slice"]) &&
  ["completed", "refusal", "incomplete", "timeout", "invalid_output", "provider_error"].some(
    (k) => k === v["resultKind"],
  ) &&
  typeof v["schema"] === "boolean" &&
  typeof v["refusal"] === "boolean" &&
  typeof v["deterministicPass"] === "boolean" &&
  ["intent", "action", "language", "script", "safety"].every((k) => nullableBool(v[k])) &&
  v["semanticReview"] === "pending" &&
  ["proposal", "fallback", "not_evaluated"].some((k) => k === v["policyDisposition"]) &&
  metadata(v["providerMetadata"]);
const observation = (v: unknown): v is LiveObservation =>
  record(v) &&
  SCREEN_MODELS.some((m) => m === v["model"]) &&
  text(v["caseId"], 100) &&
  ["smoke", "core", "normalization", "repeat"].some((p) => p === v["phase"]) &&
  typeof v["hint"] === "boolean" &&
  score(v["first"]) &&
  score(v["final"]) &&
  money(v["firstCostUSD"]) &&
  (v["repairCostUSD"] === null || money(v["repairCostUSD"])) &&
  (v["repair"] === null || score(v["repair"])) &&
  count(v["logicalLatencyMs"]) &&
  nullableBool(v["rawForbiddenAction"]) &&
  nullableBool(v["latinDraft"]) &&
  system(v["system"]) &&
  (v["review"] === null ||
    (record(v["review"]) &&
      text(v["review"]["intent"], 40) &&
      text(v["review"]["action"], 40) &&
      text(v["review"]["language"], 10) &&
      Array.isArray(v["review"]["flags"]) &&
      v["review"]["flags"].length <= 8 &&
      v["review"]["flags"].every((f: unknown) => text(f, 80)) &&
      (v["review"]["draft"] === null || text(v["review"]["draft"])))) &&
  (v["repair"] === null) === (v["repairCostUSD"] === null) &&
  v["first"].providerMetadata.model === v["model"] &&
  v["final"].providerMetadata.model === v["model"];
const budget = (v: unknown): v is BudgetCheckpoint =>
  record(v) &&
  count(v["calls"]) &&
  money(v["estimatedSpendUSD"]) &&
  money(v["targetUSD"]) &&
  money(v["hardCapUSD"]) &&
  money(v["preflightReservedUSD"]) &&
  modelCosts(v["perModelUSD"]);

export const decodeResumeEvidence = (value: unknown) => {
  if (
    !record(value) ||
    value["status"] !== "STOPPED" ||
    !text(value["startedAt"], 40) ||
    !Number.isFinite(Date.parse(value["startedAt"])) ||
    !budget(value["budget"]) ||
    !Array.isArray(value["observations"]) ||
    value["observations"].length > 310 ||
    !value["observations"].every(observation) ||
    !record(value["report"]) ||
    value["report"]["corpusHash"] !== SCREEN_HASH ||
    !record(value["preflight"]) ||
    !count(value["preflight"]["openai"]) ||
    !count(value["preflight"]["gemini"]) ||
    value["preflight"]["inputReserve"] !== 9000 ||
    !count(value["preflight"]["largestSerializedBytes"]) ||
    !text(value["preflight"]["caseId"], 100)
  )
    throw new TypeError("Invalid preserved evaluation evidence");
  createBudgetLedger(0n, value["budget"]); // Validate integer accounting before any generation.
  const observations: LiveObservation[] = value["observations"];
  const paired = planScreen().flatMap((row) => SCREEN_MODELS.map((model) => ({ row, model })));
  if (
    observations.some((o, index) => {
      const expected = paired[index];
      return (
        expected === undefined ||
        o.model !== expected.model ||
        o.caseId !== expected.row.item.case_id ||
        o.phase !== expected.row.phase ||
        o.hint !== expected.row.hint
      );
    })
  )
    throw new TypeError("Preserved evidence is not the frozen plan prefix");
  const remaining = paired.slice(observations.length);
  const reserved =
    parseUSDMicros(value["budget"].estimatedSpendUSD) +
    remaining.reduce((sum, pair) => sum + reservePerCall(pair.model) * 2n, 0n);
  if (reserved >= HARD_CAP_MICROS || value["budget"].calls + remaining.length * 2 > 640)
    throw new TypeError("Resume exceeds approved bounds");
  return {
    startedAt: value["startedAt"],
    budget: value["budget"],
    observations,
    preflight: {
      openai: value["preflight"]["openai"],
      gemini: value["preflight"]["gemini"],
      inputReserve: 9000,
      largestSerializedBytes: value["preflight"]["largestSerializedBytes"],
      caseId: value["preflight"]["caseId"],
    },
    remainingDecisions: remaining.length,
    worstTotalMicros: reserved,
  };
};
export const readResumeEvidence = (path: string) => {
  if (statSync(path).size > 10000000) throw new TypeError("Evaluation evidence oversized");
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new TypeError("Evaluation evidence unreadable");
  }
  return decodeResumeEvidence(value);
};
