import { SLICES } from "./cases.js";
import { estimateUsageMicros, type Model, usd } from "./cost.js";
import type { CaseScore } from "./scorer.js";

const percent = (passed: number, denominator: number): number | null =>
  denominator === 0 ? null : passed / denominator;
const percentile = (values: readonly number[], fraction: number): number | null => {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.ceil(sorted.length * fraction) - 1] ?? null;
};

/** Contains IDs/aggregate metrics only: no customer text, drafts or response IDs. */
export const buildReport = (model: Model, scores: readonly CaseScore[]) => {
  if (new Set(scores.map((score) => score.caseId)).size !== scores.length)
    throw new TypeError("Duplicate case score: report repeats separately");
  const perSlice = SLICES.map((slice) => {
    const rows = scores.filter((score) => score.slice === slice);
    return {
      slice,
      cases: rows.length,
      deterministicPassRate: percent(
        rows.filter((row) => row.deterministicPass).length,
        rows.length,
      ),
      metrics: ["schema", "intent", "action", "language", "script", "safety", "refusal"].map(
        (name) => {
          const values = rows.map((row) => {
            switch (name) {
              case "schema":
                return row.schema;
              case "intent":
                return row.intent;
              case "action":
                return row.action;
              case "language":
                return row.language;
              case "script":
                return row.script;
              case "safety":
                return row.safety;
              default:
                return row.refusal;
            }
          });
          return {
            name,
            measured: values.filter((value) => value !== null).length,
            passRateAllCases: percent(values.filter((value) => value === true).length, rows.length),
          };
        },
      ),
    };
  });
  const latencies = scores.map((row) => row.providerMetadata.latencyMs);
  if (latencies.some((value) => !Number.isFinite(value) || value < 0))
    throw new TypeError("Invalid latency");
  let knownCost = 0n;
  let knownUsageRows = 0;
  let input = 0n;
  let output = 0n;
  for (const row of scores) {
    if (row.providerMetadata.model !== null && row.providerMetadata.model !== model)
      throw new TypeError("Provider model differs from report model");
    const cost = estimateUsageMicros(model, row.providerMetadata.usage);
    if (cost !== null) {
      knownCost += cost;
      knownUsageRows++;
      input += BigInt(row.providerMetadata.usage.input ?? 0);
      output += BigInt(row.providerMetadata.usage.output ?? 0);
    }
  }
  return {
    version: "s13-offline-report.v1",
    model,
    cases: scores.length,
    perSlice,
    latencyMs: { p50: percentile(latencies, 0.5), p95: percentile(latencies, 0.95) },
    usage: {
      knownRows: knownUsageRows,
      unknownRows: scores.length - knownUsageRows,
      input: input.toString(),
      output: output.toString(),
    },
    cost: {
      knownSubtotalUSD: usd(knownCost),
      completeEstimateUSD: knownUsageRows === scores.length ? usd(knownCost) : null,
    },
    semanticReviewPending: scores.length,
    modelAcceptance: "NOT_EVALUATED",
  };
};
