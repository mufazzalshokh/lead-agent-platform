import type { AIUsage } from "@lead-agent/application";
import { estimateUsageMicros, usd } from "./cost.js";
import { INPUT_RESERVE, OUTPUT_LIMIT, type ScreenModel } from "./screen.js";

export const HARD_CAP_MICROS = 10_000_000n;
export const TARGET_MICROS = 5_000_000n;
export type BudgetPhase = "screen" | "finalist";
export const phaseLimits = (phase: BudgetPhase) =>
  phase === "finalist"
    ? { hardCap: 5_000_000n, target: 2_000_000n, maximumCalls: 1680 }
    : { hardCap: HARD_CAP_MICROS, target: TARGET_MICROS, maximumCalls: 640 };
export interface BudgetCheckpoint {
  readonly calls: number;
  readonly estimatedSpendUSD: string;
  readonly targetUSD: string;
  readonly hardCapUSD: string;
  readonly preflightReservedUSD: string;
  readonly perModelUSD: Readonly<Record<ScreenModel, string>>;
}
export const parseUSDMicros = (value: string): bigint => {
  if (!/^\$\d{1,2}\.\d{6}$/u.test(value)) throw new TypeError("Invalid budget checkpoint amount");
  return BigInt(value.slice(1).replace(".", ""));
};
export const reservePerCall = (model: ScreenModel) => {
  const cost = estimateUsageMicros(
    model,
    {
      input: INPUT_RESERVE,
      output: OUTPUT_LIMIT,
      total: INPUT_RESERVE + OUTPUT_LIMIT,
      cachedInput: 0,
      reasoning: OUTPUT_LIMIT,
    },
    true,
  );
  if (cost === null) throw new TypeError("Missing reservation");
  return cost;
};
export const screenProjection = (logicalPerModel: number) => {
  if (!Number.isSafeInteger(logicalPerModel) || logicalPerModel < 1 || logicalPerModel > 160)
    throw new TypeError("Unapproved call allocation");
  const perModel = ["gemini-3.8-flash", "gpt-5.6-luna"].map((id) => {
    const model: ScreenModel = id === "gemini-3.8-flash" ? id : "gpt-5.6-luna";
    const normal = estimateUsageMicros(
      model,
      { input: 3000, output: 500, total: 3500, cachedInput: 0, reasoning: 200 },
      true,
    );
    if (normal === null) throw new TypeError("Missing projection");
    return {
      model,
      normal: normal * BigInt(logicalPerModel),
      reserved: reservePerCall(model) * BigInt(logicalPerModel) * 2n,
    };
  });
  const reserved = perModel.reduce((sum, row) => sum + row.reserved, 0n);
  if (reserved >= HARD_CAP_MICROS) throw new TypeError("Screen exceeds hard cap");
  return {
    logicalDecisions: logicalPerModel * 2,
    maximumPhysicalCalls: logicalPerModel * 4,
    normalUSD: usd(perModel.reduce((sum, row) => sum + row.normal, 0n)),
    reservedUSD: usd(reserved),
    perModel: perModel.map((row) => ({
      model: row.model,
      normalUSD: usd(row.normal),
      reservedUSD: usd(row.reserved),
    })),
  };
};

/** Reserve before dispatch. Unknown bills keep the full reservation and halt. */
export const createBudgetLedger = (
  preflightReserveMicros = 0n,
  carry?: BudgetCheckpoint,
  phase: BudgetPhase = "screen",
) => {
  const limits = phaseLimits(phase);
  if (preflightReserveMicros < 0n || preflightReserveMicros > 10_000n)
    throw new TypeError("Unapproved preflight reserve");
  let spend = preflightReserveMicros,
    calls = 0,
    halted = false,
    pending: { model: ScreenModel; reserved: bigint } | null = null;
  const models = { "gemini-3.8-flash": 0n, "gpt-5.6-luna": 0n };
  if (carry !== undefined) {
    if (
      !Number.isSafeInteger(carry.calls) ||
      carry.calls < 0 ||
      carry.calls > limits.maximumCalls ||
      carry.targetUSD !== usd(limits.target) ||
      carry.hardCapUSD !== usd(limits.hardCap)
    )
      throw new TypeError("Invalid budget checkpoint");
    spend = parseUSDMicros(carry.estimatedSpendUSD);
    calls = carry.calls;
    preflightReserveMicros = parseUSDMicros(carry.preflightReservedUSD);
    models["gemini-3.8-flash"] = parseUSDMicros(carry.perModelUSD["gemini-3.8-flash"]);
    models["gpt-5.6-luna"] = parseUSDMicros(carry.perModelUSD["gpt-5.6-luna"]);
    if (
      preflightReserveMicros > 10000n ||
      spend >= limits.hardCap ||
      spend !== preflightReserveMicros + models["gemini-3.8-flash"] + models["gpt-5.6-luna"]
    )
      throw new TypeError("Inconsistent budget checkpoint");
  }
  return {
    before(model: ScreenModel, optional = false) {
      const reserved = reservePerCall(model);
      if (
        halted ||
        pending !== null ||
        calls >= limits.maximumCalls ||
        spend + reserved >= limits.hardCap ||
        (optional && spend + reserved >= limits.target)
      )
        throw new Error("Evaluation budget stop");
      pending = { model, reserved };
      spend += reserved;
      models[model] += reserved;
      calls++;
    },
    after(usage: AIUsage, retainUnknownTransient = false) {
      const current = pending;
      if (current === null) throw new Error("No reserved call");
      pending = null;
      // An unknown cache count cannot undercharge: charge all input at full/write rate.
      let charged: bigint | null;
      try {
        charged = estimateUsageMicros(
          current.model,
          { ...usage, cachedInput: usage.cachedInput ?? 0 },
          true,
        );
      } catch {
        halted = true;
        throw new Error("Usage invalid; full reservation retained; stop");
      }
      if (charged === null) {
        // Evaluation-only recovery: retain the entire unknown bill. Never forgive it.
        if (retainUnknownTransient) return usd(current.reserved);
        halted = true;
        throw new Error("Usage unknown; full reservation retained; stop");
      }
      spend += charged - current.reserved;
      models[current.model] += charged - current.reserved;
      if (
        (usage.input ?? 0) > INPUT_RESERVE ||
        (usage.output ?? 0) > OUTPUT_LIMIT ||
        spend >= limits.hardCap
      ) {
        halted = true;
        throw new Error("Provider usage exceeded reservation; stop");
      }
      return usd(charged);
    },
    snapshot: () => ({
      calls,
      estimatedSpendUSD: usd(spend),
      targetUSD: usd(limits.target),
      hardCapUSD: usd(limits.hardCap),
      preflightReservedUSD: usd(preflightReserveMicros),
      perModelUSD: {
        "gemini-3.8-flash": usd(models["gemini-3.8-flash"]),
        "gpt-5.6-luna": usd(models["gpt-5.6-luna"]),
      },
    }),
  };
};
