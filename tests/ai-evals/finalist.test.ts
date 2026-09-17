import { describe, expect, it, vi } from "vitest";
import type { AIProvider, AIProviderResult } from "@lead-agent/application";
import { validDecision } from "../ai/fixtures.js";
import { createOpenAIProvider } from "../../packages/ai/src/providers/openai.js";
import {
  transportDiagnosticFetch,
  classifyTransportFailure,
  type TransportDiagnostic,
} from "./network-diagnostic.js";
import type { EvalAttempt } from "./eval-retry.js";
import { CORPUS, SCREEN } from "./corpus.js";
import { createBudgetLedger, reservePerCall, type BudgetCheckpoint } from "./budget.js";
import { usd } from "./cost.js";
import { observeDecision, runLiveScreen, type LiveObservation } from "./live-runner.js";
import { blindedReviewPacket, type AcceptedCoreRow } from "./finalist-prep.js";
import {
  finalistPlan,
  mergeFinalist,
  verifyFinalistWireBounds,
  readFinalistBase,
} from "./finalist.js";
import { latency } from "./live-report.js";
import { SCREEN_MODELS } from "./screen.js";

const rows: readonly AcceptedCoreRow[] = SCREEN.flatMap((item) =>
  SCREEN_MODELS.map((model) => ({
    model,
    caseId: item.case_id,
    usage: { input: 100, output: 100, total: 200, cachedInput: 0, reasoning: 20 },
    costUSD: "$0.000450",
    intentPass: true,
    safetyPass: true,
    scriptPass: true,
    deterministicPass: true,
    intent: "greeting",
    action: "none",
    draft: "Salom!",
  })),
);
const result = (
  model: (typeof SCREEN_MODELS)[number],
  value: unknown = validDecision(),
): Extract<AIProviderResult, { kind: "completed" }> => ({
  kind: "completed",
  model,
  value,
  responseId: null,
  latencyMs: 7,
  usage: { input: 100, output: 100, total: 200, cachedInput: 0, reasoning: 20 },
});
const carry = (spend: bigint, calls = 0): BudgetCheckpoint => ({
  calls,
  estimatedSpendUSD: usd(spend),
  targetUSD: "$2.000000",
  hardCapUSD: "$5.000000",
  preflightReservedUSD: "$0.000000",
  perModelUSD: { "gemini-3.8-flash": usd(spend), "gpt-5.6-luna": "$0.000000" },
});
describe("S13.C approved dynamic accounting and immutable merge", () => {
  it.skipIf(process.env["S13_FINALIST_READONLY_BASE"] === undefined)(
    "validates the immutable accepted B artifact before any paid dispatch",
    () => {
      const path = process.env["S13_FINALIST_READONLY_BASE"];
      if (path === undefined) throw new TypeError("Missing read-only artifact");
      const base = readFinalistBase(path);
      expect(base.observations).toHaveLength(310);
      expect(base.attempts).toHaveLength(313);
      expect(base.budget.estimatedSpendUSD).toBe("$0.293921");
      expect(finalistPlan(base.rows)).toHaveLength(420);
      console.log(
        JSON.stringify({
          event: "s13c_base_validated",
          acceptedCore: base.rows.length,
          preservedPhysicalCalls: base.attempts.length,
          newPerModel: 420,
          paidCalls: 0,
        }),
      );
    },
  );
  it("keeps B defaults separate and rejects mixed phase checkpoints", () => {
    expect(createBudgetLedger().snapshot()).toMatchObject({
      targetUSD: "$5.000000",
      hardCapUSD: "$10.000000",
    });
    expect(createBudgetLedger(0n, undefined, "finalist").snapshot()).toMatchObject({
      targetUSD: "$2.000000",
      hardCapUSD: "$5.000000",
    });
    expect(() => createBudgetLedger(0n, carry(0n))).toThrow();
  });
  it("recovers a real adapter's null-model transport failure once, preserving the failed bill", async () => {
    const item = finalistPlan(rows)[0];
    if (item === undefined) throw new TypeError("Missing fixture");
    let count = 0;
    let transport: TransportDiagnostic | null = null;
    const mockFetch: typeof fetch = (url) => {
      if (url !== "https://api.openai.com/v1/responses")
        throw new TypeError("Unexpected destination");
      count++;
      if (count === 1)
        return Promise.reject(
          new TypeError("synthetic transport", { cause: { code: "ECONNRESET" } }),
        );
      return Promise.resolve(
        Response.json({
          model: "gpt-5.6-luna",
          status: "completed",
          id: "synthetic-response",
          usage: {
            input_tokens: 100,
            output_tokens: 100,
            total_tokens: 200,
            input_tokens_details: { cached_tokens: 0 },
            output_tokens_details: { reasoning_tokens: 20 },
          },
          output: [
            {
              type: "message",
              role: "assistant",
              status: "completed",
              content: [{ type: "output_text", text: JSON.stringify(validDecision()) }],
            },
          ],
        }),
      );
    };
    const provider = createOpenAIProvider(
      {
        apiKey: "synthetic-placeholder-no-credential",
        model: "gpt-5.6-luna",
        requestTimeoutMs: 1000,
      },
      {
        fetch: transportDiagnosticFetch(mockFetch, (value) => {
          transport = value;
        }),
      },
    );
    const ledger = createBudgetLedger(0n, undefined, "finalist"),
      attempts: EvalAttempt[] = [];
    const observation = await observeDecision("gpt-5.6-luna", provider, item, ledger, {
      retry: {
        resetDiagnostics: () => {
          transport = null;
        },
        diagnostics: () => ({ transport, http: null }),
        sleep: () => Promise.resolve(),
        random: () => 0,
      },
      onAttempt: (attempt) => attempts.push(attempt),
    });
    expect(count).toBe(2);
    expect(attempts[0]).toMatchObject({
      attemptNumber: 1,
      resultKind: "provider_error",
      category: "network",
      unresolvedReservationUSD: "$0.007050",
      billableCostUSD: null,
    });
    expect(attempts[1]).toMatchObject({
      attemptNumber: 2,
      purpose: "transient_retry",
      retrySucceeded: true,
      billableCostUSD: "$0.000145",
    });
    expect(ledger.snapshot().estimatedSpendUSD).toBe("$0.007195");
    expect(observation.final.schema).toBe(true);
  });
  it.each(["completed", "refusal", "incomplete", "invalid_output"] as const)(
    "never treats missing model identity on %s as a transport exception",
    async (kind) => {
      const item = finalistPlan(rows)[0];
      if (item === undefined) throw new TypeError("Missing fixture");
      const provider = {
        decide: vi.fn<AIProvider["decide"]>(() =>
          Promise.resolve({ ...result("gpt-5.6-luna"), model: null, kind, reason: "unknown" }),
        ),
      };
      await expect(
        observeDecision(
          "gpt-5.6-luna",
          provider,
          item,
          createBudgetLedger(0n, undefined, "finalist"),
        ),
      ).rejects.toThrow("provider_model_mismatch");
      expect(provider.decide).toHaveBeenCalledTimes(1);
    },
  );
  it("still rejects non-null unexpected model metadata on a retry-eligible error", async () => {
    const item = finalistPlan(rows)[0];
    if (item === undefined) throw new TypeError("Missing fixture");
    const provider = {
      decide: vi.fn<AIProvider["decide"]>(() =>
        Promise.resolve({
          ...result("gemini-3.8-flash"),
          kind: "provider_error",
          category: "network",
          retryable: false,
          retryAfterMs: null,
        }),
      ),
    };
    const attempts: EvalAttempt[] = [];
    await expect(
      observeDecision(
        "gpt-5.6-luna",
        provider,
        item,
        createBudgetLedger(0n, undefined, "finalist"),
        {
          retry: {
            resetDiagnostics: () => {},
            diagnostics: () => ({
              transport: classifyTransportFailure(
                new TypeError("synthetic", { cause: { code: "ECONNRESET" } }),
                null,
                7,
              ),
              http: null,
            }),
            sleep: () => Promise.resolve(),
            random: () => 0,
          },
          onAttempt: (attempt) => attempts.push(attempt),
        },
      ),
    ).rejects.toThrow("provider_model_mismatch");
    expect(provider.decide).toHaveBeenCalledTimes(1);
    expect(attempts).toHaveLength(1);
  });
  it("reserves only the next call, then replaces it with integer known usage", () => {
    const ledger = createBudgetLedger(0n, carry(4_000_000n), "finalist");
    ledger.before("gemini-3.8-flash");
    expect(ledger.snapshot().estimatedSpendUSD).toBe("$4.021750");
    ledger.after(result("gemini-3.8-flash").usage);
    expect(ledger.snapshot().estimatedSpendUSD).toBe("$4.000450");
  });
  it("never releases unknown reservations and refuses at/beyond the hard cap before dispatch", () => {
    const ledger = createBudgetLedger(0n, carry(4_980_000n), "finalist");
    expect(() => ledger.before("gemini-3.8-flash")).toThrow();
    expect(ledger.snapshot().calls).toBe(0);
    const second = createBudgetLedger(0n, carry(4_990_000n), "finalist");
    second.before("gpt-5.6-luna");
    second.after(
      { input: null, output: null, total: null, cachedInput: null, reasoning: null },
      true,
    );
    expect(second.snapshot().estimatedSpendUSD).toBe("$4.997050");
    expect(() => second.before("gpt-5.6-luna")).toThrow();
    const exact = createBudgetLedger(
      0n,
      carry(5_000_000n - reservePerCall("gemini-3.8-flash")),
      "finalist",
    );
    expect(() => exact.before("gemini-3.8-flash")).toThrow();
  });
  it("bounds physical attempts and does not spend optional calls above target", () => {
    expect(() =>
      createBudgetLedger(0n, carry(0n, 1680), "finalist").before("gpt-5.6-luna"),
    ).toThrow();
    expect(() =>
      createBudgetLedger(0n, carry(2_000_000n), "finalist").before("gpt-5.6-luna", true),
    ).toThrow();
  });
  it("checkpoints the next call's reservation BEFORE provider invocation", async () => {
    const events: string[] = [];
    const item = finalistPlan(rows)[0];
    if (item === undefined) throw new TypeError("Missing fixture");
    await observeDecision(
      "gpt-5.6-luna",
      {
        decide: () => {
          events.push("provider");
          return Promise.resolve(result("gpt-5.6-luna"));
        },
      },
      item,
      createBudgetLedger(0n, undefined, "finalist"),
      { onReserved: () => events.push("reserved") },
    );
    expect(events).toEqual(["reserved", "provider"]);
  });
  it("executes all 840 sequential mock decisions without reserving hypothetical future calls", async () => {
    let active = 0,
      maximum = 0;
    const mock = (model: (typeof SCREEN_MODELS)[number]) => ({
      decide: vi.fn<AIProvider["decide"]>(async () => {
        active++;
        maximum = Math.max(maximum, active);
        await Promise.resolve();
        active--;
        return result(model);
      }),
    });
    const providers = {
      "gemini-3.8-flash": mock("gemini-3.8-flash"),
      "gpt-5.6-luna": mock("gpt-5.6-luna"),
    };
    const observations: LiveObservation[] = [];
    const run = await runLiveScreen(providers, (row) => observations.push(row), {
      plan: finalistPlan(rows),
      budgetPhase: "finalist",
      retry: { resetDiagnostics: () => {}, diagnostics: () => ({ transport: null, http: null }) },
    });
    expect(maximum).toBe(1);
    expect(providers["gemini-3.8-flash"].decide).toHaveBeenCalledTimes(420);
    expect(providers["gpt-5.6-luna"].decide).toHaveBeenCalledTimes(420);
    expect(run.budget.calls).toBe(840);
    const exemplar = observations[0];
    if (exemplar === undefined) throw new TypeError("No observations");
    const accepted = SCREEN.flatMap((item) =>
      SCREEN_MODELS.map((model) => ({ ...exemplar, model, caseId: item.case_id })),
    );
    expect(
      mergeFinalist(accepted, observations).filter((row) => row.phase === "core"),
    ).toHaveLength(1120);
    expect(() => mergeFinalist(accepted, observations.slice(1))).toThrow();
    expect(() =>
      mergeFinalist(
        [...accepted.slice(1), accepted[0] ?? exemplar],
        [...observations.slice(1), observations[1] ?? exemplar],
      ),
    ).toThrow();
    expect(() =>
      mergeFinalist(
        accepted,
        observations.map((row) => ({ ...row, hint: true })),
      ),
    ).toThrow();
  });
  it("checks every new original AND repair serialization without any authenticated request", async () => {
    const proof = await verifyFinalistWireBounds(finalistPlan(rows));
    expect(proof).toMatchObject({
      fixtures: 420,
      originalAndRepair: 840,
      inputReserve: 9000,
      authenticatedCalls: 0,
    });
    expect(proof.largestSerializedBytes + 512).toBeLessThanOrEqual(9000);
  }, 30000);
  it("computes all six nearest-rank percentiles with empty timings remaining unknown", () => {
    expect(latency([1, 2, 3, 4])).toEqual({
      samples: 4,
      p50: 2,
      p75: 3,
      p90: 4,
      p95: 4,
      p99: 4,
      max: 4,
    });
    expect(latency([]).p99).toBeNull();
  });
  it("regenerates 40 private-seed-blinded full-corpus comparisons, without unblinding", () => {
    const template = rows[0];
    if (template === undefined) throw new TypeError("No review fixture");
    const full = CORPUS.flatMap((item) =>
      SCREEN_MODELS.map((model) => ({ ...template, model, caseId: item.case_id })),
    );
    const seed = "a".repeat(64);
    const review = blindedReviewPacket(full, seed, "full");
    expect(review.curator).toHaveLength(40);
    expect(review.packet).not.toMatch(/gemini|gpt-5|luna|seed_cluster/i);
    expect(blindedReviewPacket(full, seed, "full")).toEqual(review);
    expect(() => blindedReviewPacket(full.slice(1), seed, "full")).toThrow();
  });
});
