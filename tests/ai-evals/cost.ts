import { AI_CONTEXT_LIMITS } from "../../packages/application/src/ai/context.js";
import { AI_INSTRUCTIONS, OPENAI_AGENT_DECISION_SCHEMA } from "../../packages/ai/src/schema.js";
import type { AIUsage } from "@lead-agent/application";

export const PRICE_SNAPSHOT = "2026-09-17";
// USD micro-units per million tokens; no floating-point billing arithmetic.
export const PRICES = Object.freeze({
  "gemini-3.8-flash": {
    input: 750_000n,
    cachedInput: 75_000n,
    output: 3_750_000n,
    inputWrite: 750_000n,
  },
  "gpt-5.6-luna": {
    input: 200_000n,
    cachedInput: 20_000n,
    output: 1_200_000n,
    inputWrite: 250_000n,
  },
  "claude-sonnet-5": {
    input: 2_000_000n,
    cachedInput: 200_000n,
    output: 10_000_000n,
    inputWrite: 4_000_000n,
  },
});
export type Model = keyof typeof PRICES;
export const MODELS = Object.keys(PRICES).filter((key): key is Model => key in PRICES);

const tokenCount = (value: number): bigint => {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError("Invalid token count");
  return BigInt(value);
};
const ceilMillion = (value: bigint): bigint => (value + 999_999n) / 1_000_000n;
export const estimateUsageMicros = (
  model: Model,
  usage: AIUsage,
  cacheWrite = false,
): bigint | null => {
  for (const count of Object.values(usage)) if (count !== null) tokenCount(count);
  if (usage.input === null || usage.output === null || usage.cachedInput === null) return null;
  const input = tokenCount(usage.input),
    output = tokenCount(usage.output),
    cached = tokenCount(usage.cachedInput);
  if (cached > input) throw new TypeError("Cached tokens exceed input");
  // output is total BILLABLE output, including reasoning. Never add reasoning twice.
  if (usage.reasoning !== null && tokenCount(usage.reasoning) > output)
    throw new TypeError("Reasoning tokens exceed total billable output");
  if (usage.total !== null && tokenCount(usage.total) !== input + output)
    throw new TypeError("Inconsistent total tokens");
  const rate = PRICES[model];
  return ceilMillion(
    (input - cached) * (cacheWrite ? rate.inputWrite : rate.input) +
      cached * rate.cachedInput +
      output * rate.output,
  );
};
export const usd = (micros: bigint): string => {
  if (micros < 0n) throw new TypeError("Negative cost");
  return `$${micros / 1_000_000n}.${(micros % 1_000_000n).toString().padStart(6, "0")}`;
};

// Planning INFERENCE: at most six JSON UTF-8 bytes per UTF-16 context unit,
// plus actual instructions/schema and a generous 8 KiB structural/hint allowance.
// One token per serialized byte is intentionally conservative, NOT a provider guarantee.
export const CONSERVATIVE_INPUT =
  AI_CONTEXT_LIMITS.totalCharacters * 6 +
  Buffer.byteLength(AI_INSTRUCTIONS) +
  Buffer.byteLength(JSON.stringify(OPENAI_AGENT_DECISION_SCHEMA)) +
  8_192;
export const TYPICAL_USAGE: AIUsage = {
  input: 3_000,
  output: 500,
  total: 3_500,
  cachedInput: 0,
  reasoning: 200,
};
export const PADDED_USAGE: AIUsage = {
  input: 9_000,
  output: 1_500,
  total: 10_500,
  cachedInput: 0,
  reasoning: 1_000,
};
export const BOUND_USAGE: AIUsage = {
  input: CONSERVATIVE_INPUT,
  output: 4_000,
  total: CONSERVATIVE_INPUT + 4_000,
  cachedInput: 0,
  reasoning: 4_000,
};

const projection = (
  models: readonly Model[],
  logicalPerModel: number,
  usage: AIUsage,
  physicalMultiplier: number,
  writes: boolean,
): bigint =>
  models.reduce((total, model) => {
    const call = estimateUsageMicros(model, usage, writes);
    if (call === null) throw new TypeError("Projection requires known tokens");
    return total + call * tokenCount(logicalPerModel) * tokenCount(physicalMultiplier);
  }, 0n);

export const projectedCosts = () => {
  const pairs = MODELS.flatMap((left, index) =>
    MODELS.slice(index + 1).map((right) => ({
      models: [left, right],
      typicalMicros: projection([left, right], 720, TYPICAL_USAGE, 1, false),
      conservativeMicros: projection([left, right], 720, BOUND_USAGE, 2, true),
    })),
  );
  return {
    screen: {
      cases: 140,
      redlines: 40,
      repeats: 2,
      logicalCalls: 660,
      maximumPhysicalCalls: 1_320,
      typicalMicros: projection(MODELS, 220, TYPICAL_USAGE, 1, false),
      conservativeMicros: projection(MODELS, 220, BOUND_USAGE, 2, true),
    },
    fullPairs: pairs,
    worstTotal: {
      logicalCalls: 2_880,
      maximumPhysicalCalls: 5_760,
      typicalMicros: projection(MODELS, 960, TYPICAL_USAGE, 1, false),
      conservativeMicros: projection(MODELS, 960, BOUND_USAGE, 2, true),
    },
  };
};

export const renderCostPlan = () => {
  const plan = projectedCosts();
  return {
    priceSnapshot: PRICE_SNAPSHOT,
    planningInputTokens: CONSERVATIVE_INPUT,
    screen: {
      typicalUSD: usd(plan.screen.typicalMicros),
      paddedUSD: usd(projection(MODELS, 220, PADDED_USAGE, 2, false)),
      conservativeUSD: usd(plan.screen.conservativeMicros),
      logicalCalls: plan.screen.logicalCalls,
      maximumPhysicalCalls: plan.screen.maximumPhysicalCalls,
    },
    fullTopTwo: plan.fullPairs.map((pair) => ({
      models: pair.models,
      typicalUSD: usd(pair.typicalMicros),
      paddedUSD: usd(projection(pair.models, 720, PADDED_USAGE, 2, false)),
      conservativeUSD: usd(pair.conservativeMicros),
      logicalCalls: 1_440,
      maximumPhysicalCalls: 2_880,
    })),
    worstTotal: {
      typicalUSD: usd(plan.worstTotal.typicalMicros),
      paddedUSD: usd(projection(MODELS, 960, PADDED_USAGE, 2, false)),
      conservativeUSD: usd(plan.worstTotal.conservativeMicros),
      logicalCalls: plan.worstTotal.logicalCalls,
      maximumPhysicalCalls: plan.worstTotal.maximumPhysicalCalls,
    },
  };
};
