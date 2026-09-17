import { describe, expect, it, vi } from "vitest";
import type { AIProvider, AIProviderResult } from "@lead-agent/application";
import { validDecision } from "../ai/fixtures.js";
import { createBudgetLedger } from "./budget.js";
import { observeDecision, runLiveScreen } from "./live-runner.js";
import { decodeResumeEvidence } from "./resume.js";
import { planScreen, SCREEN_HASH } from "./screen.js";

const first = planScreen()[0];
if (first === undefined) throw new TypeError("Missing frozen case");
const result = (model: string): AIProviderResult => ({
  kind: "completed",
  model,
  responseId: null,
  latencyMs: 2235,
  usage: { input: 368, output: 122, total: 490, cachedInput: null, reasoning: null },
  value: validDecision({
    language: "uz",
    message: { mode: "send_candidate", draft_text: "Salom!" },
  }),
});
const seed = async () => {
  const ledger = createBudgetLedger(10000n);
  const completed = await observeDecision(
    "gemini-3.8-flash",
    { decide: () => Promise.resolve(result("gemini-3.8-flash")) },
    first,
    ledger,
  );
  ledger.before("gpt-5.6-luna");
  try {
    ledger.after({ input: null, output: null, total: null, cachedInput: null, reasoning: null });
  } catch {
    /* preserved failed-call reservation */
  }
  return {
    status: "STOPPED",
    startedAt: "2026-09-17T09:21:31.403Z",
    budget: ledger.snapshot(),
    observations: [completed],
    preflight: {
      openai: 1537,
      gemini: 453,
      inputReserve: 9000,
      largestSerializedBytes: 8453,
      caseId: "s13-uz-cyrillic-13-0",
    },
    report: { corpusHash: SCREEN_HASH },
  };
};
describe("S13 owner-authorized preserved-state resume", () => {
  it("retains paid evidence, failed reservation, token preflight and exact remaining projection", async () => {
    const decoded = decodeResumeEvidence(await seed());
    expect(decoded.observations).toHaveLength(1);
    expect(decoded.budget.estimatedSpendUSD).toBe("$0.017784");
    expect(decoded.budget.calls).toBe(2);
    expect(decoded.remainingDecisions).toBe(309);
    expect(decoded.worstTotalMicros).toBe(8902284n);
  });
  it("starts with failed Luna smoke, never repeats completed Gemini", async () => {
    const decoded = decodeResumeEvidence(await seed());
    const gemini = vi.fn<AIProvider["decide"]>(),
      luna = vi.fn<AIProvider["decide"]>(() => Promise.resolve(result("gpt-5.6-luna")));
    const resumed = await runLiveScreen(
      { "gemini-3.8-flash": { decide: gemini }, "gpt-5.6-luna": { decide: luna } },
      () => {},
      { plan: [first], initialObservations: decoded.observations, carryBudget: decoded.budget },
    );
    expect(gemini).not.toHaveBeenCalled();
    expect(luna).toHaveBeenCalledTimes(1);
    expect(resumed.observations[0]).toEqual(decoded.observations[0]);
    expect(resumed.budget.calls).toBe(3);
    expect(resumed.budget.perModelUSD["gpt-5.6-luna"]).not.toBe("$0.007050");
    expect(resumed.budget.preflightReservedUSD).toBe("$0.010000");
  });
  it("stops on second unknown-bill rejection and preserves both failed reservations", async () => {
    const decoded = decodeResumeEvidence(await seed());
    const failed: AIProviderResult = {
      ...result("gpt-5.6-luna"),
      kind: "provider_error",
      category: "rate_limit",
      retryable: true,
      retryAfterMs: 1000,
      usage: { input: null, output: null, total: null, cachedInput: null, reasoning: null },
    };
    const luna = vi.fn<AIProvider["decide"]>(() => Promise.resolve(failed)),
      gemini = vi.fn<AIProvider["decide"]>();
    let snapshot: unknown;
    await expect(
      runLiveScreen(
        { "gemini-3.8-flash": { decide: gemini }, "gpt-5.6-luna": { decide: luna } },
        () => {},
        {
          initialObservations: decoded.observations,
          carryBudget: decoded.budget,
          onStop: (_error, budget) => {
            snapshot = budget;
          },
        },
      ),
    ).rejects.toThrow("usage_unknown_or_overrun");
    expect(gemini).not.toHaveBeenCalled();
    expect(luna).toHaveBeenCalledTimes(1);
    expect(snapshot).toMatchObject({ calls: 3, estimatedSpendUSD: "$0.024834" });
  });
  it("rejects wrong corpus, reset ledger and reordered evidence before any call", async () => {
    const value = await seed();
    expect(() => decodeResumeEvidence({ ...value, report: { corpusHash: "wrong" } })).toThrow();
    expect(() =>
      decodeResumeEvidence({
        ...value,
        budget: { ...value.budget, estimatedSpendUSD: "$0.000000" },
      }),
    ).toThrow();
    expect(() =>
      decodeResumeEvidence({
        ...value,
        observations: value.observations.map((o) => ({ ...o, caseId: "wrong" })),
      }),
    ).toThrow();
  });
});
