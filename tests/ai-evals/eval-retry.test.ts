import { describe, expect, it, vi } from "vitest";
import type { AIProvider, AIProviderResult } from "@lead-agent/application";
import { validDecision } from "../ai/fixtures.js";
import { createBudgetLedger, reservePerCall } from "./budget.js";
import { usd } from "./cost.js";
import { classifyTransportFailure } from "./network-diagnostic.js";
import {
  recurringTransportFailure,
  retryDelay,
  type EvalAttempt,
  type RetryHooks,
} from "./eval-retry.js";
import { observeDecision, runLiveScreen } from "./live-runner.js";
import { buildLiveReport } from "./live-report.js";
import { planScreen } from "./screen.js";

const row = planScreen()[0];
if (row === undefined) throw new TypeError("Missing frozen fixture");
const completed = (
  value: unknown = validDecision(),
): Extract<AIProviderResult, { kind: "completed" }> => ({
  kind: "completed",
  model: "gpt-5.6-luna",
  responseId: null,
  latencyMs: 7,
  usage: { input: 100, output: 100, total: 200, cachedInput: 0, reasoning: 20 },
  value,
});
const unknownUsage = { input: null, output: null, total: null, cachedInput: null, reasoning: null };
const network = (): Extract<AIProviderResult, { kind: "provider_error" }> => ({
  ...completed(),
  kind: "provider_error",
  category: "network",
  retryable: false,
  retryAfterMs: null,
  usage: unknownUsage,
});
const cause = (code: string) =>
  classifyTransportFailure(new TypeError("synthetic-sensitive", { cause: { code } }), null, 7);
const hooks = (): RetryHooks => ({
  resetDiagnostics: () => {},
  diagnostics: () => ({ transport: cause("ECONNRESET"), http: null }),
  random: () => 0,
  sleep: vi.fn(() => Promise.resolve()),
});
const mock = (results: readonly AIProviderResult[]) => {
  let index = 0;
  return {
    decide: vi.fn<AIProvider["decide"]>(() => {
      const value = results[index++];
      if (value === undefined) throw new TypeError("Forbidden extra physical attempt");
      return Promise.resolve(value);
    }),
  };
};
const prior = (): EvalAttempt => ({
  model: "gpt-5.6-luna",
  caseId: row.item.case_id,
  phase: row.phase,
  hint: row.hint,
  attemptNumber: 1,
  purpose: "initial",
  resultKind: "provider_error",
  category: "network",
  transport: null,
  http: null,
  aborted: null,
  elapsedMs: null,
  backoffMs: 0,
  retrySucceeded: null,
  usage: unknownUsage,
  billableCostUSD: null,
  unresolvedReservationUSD: "$0.007050",
  source: "historical",
});

describe("S13 owner-approved evaluation-only bounded recovery", () => {
  it.each(["EAI_AGAIN", "ECONNREFUSED", "UND_ERR_CONNECT_TIMEOUT", "ECONNRESET", "UND_ERR_SOCKET"])(
    "permits a single classified transient %s",
    (code) => {
      expect(retryDelay(network(), cause(code), null, () => 0)).toBe(1000);
    },
  );
  it.each([
    "ENOTFOUND",
    "CERT_HAS_EXPIRED",
    "ERR_TLS_CERT_ALTNAME_INVALID",
    "ABORT_ERR",
    "ETIMEDOUT",
  ])("does not retry permanent/ambiguous %s", (code) => {
    expect(retryDelay(network(), cause(code), null)).toBeNull();
  });
  it("does not retry an unclassified network exception", () => {
    expect(retryDelay(network(), null, null)).toBeNull();
  });
  it.each([408, 500, 502, 503, 504])("permits explicitly transient HTTP %s", (status) => {
    expect(
      retryDelay(
        { ...network(), category: "unavailable" },
        null,
        { status, code: null, category: null },
        () => 1,
      ),
    ).toBe(2000);
  });
  it.each([400, 401, 403, 404, 422, 501, 505])("rejects non-transient HTTP %s", (status) => {
    expect(
      retryDelay({ ...network(), category: "request" }, null, {
        status,
        code: null,
        category: null,
      }),
    ).toBeNull();
  });
  it.each(["insufficient_quota", "credit_balance_exhausted", "project_spend_limit_exceeded", null])(
    "rejects quota/billing/unknown 429 %s",
    (code) => {
      expect(
        retryDelay({ ...network(), category: "rate_limit", retryAfterMs: 2000 }, null, {
          status: 429,
          code,
          category: null,
        }),
      ).toBeNull();
    },
  );
  it("requires explicit throttling and honors bounded Retry-After", () => {
    const rate = { ...network(), category: "rate_limit", retryAfterMs: 5000 } as const;
    const http = { status: 429, code: "rate_limit_exceeded", category: "rate_limit_error" };
    expect(retryDelay(rate, null, http)).toBe(5000);
    expect(retryDelay({ ...rate, retryAfterMs: null }, null, http)).toBeNull();
    expect(retryDelay({ ...rate, retryAfterMs: 60000 }, null, http)).toBeNull();
    expect(retryDelay(rate, null, { ...http, category: "insufficient_quota" })).toBeNull();
  });
  it.each(["completed", "refusal", "invalid_output", "incomplete"] as const)(
    "never transport-retries a completed %s outcome",
    (kind) => {
      const value: AIProviderResult =
        kind === "incomplete"
          ? { ...completed(), kind, reason: "output_limit" }
          : { ...completed(), kind };
      expect(
        retryDelay(value, cause("ECONNRESET"), { status: 503, code: null, category: null }),
      ).toBeNull();
    },
  );
  it("keeps the failed reservation and records both calls when recovery succeeds", async () => {
    const ledger = createBudgetLedger(),
      attempts: EvalAttempt[] = [],
      provider = mock([network(), completed()]);
    const observation = await observeDecision("gpt-5.6-luna", provider, row, ledger, {
      retry: hooks(),
      onAttempt: (attempt) => attempts.push(attempt),
    });
    expect(provider.decide).toHaveBeenCalledTimes(2);
    expect(attempts.map((attempt) => attempt.attemptNumber)).toEqual([1, 2]);
    expect(attempts[0]).toMatchObject({
      category: "network",
      unresolvedReservationUSD: "$0.007050",
      billableCostUSD: null,
    });
    expect(attempts[1]).toMatchObject({
      retrySucceeded: true,
      backoffMs: 1000,
      billableCostUSD: "$0.000145",
    });
    expect(ledger.snapshot()).toMatchObject({ calls: 2, estimatedSpendUSD: "$0.007195" });
    expect(observation.repair).toBeNull();
  });
  it("stops immediately after a second failure, retaining both unknown bills", async () => {
    const ledger = createBudgetLedger(),
      attempts: EvalAttempt[] = [],
      provider = mock([network(), network()]);
    await expect(
      observeDecision("gpt-5.6-luna", provider, row, ledger, {
        retry: hooks(),
        onAttempt: (attempt) => attempts.push(attempt),
      }),
    ).rejects.toThrow();
    expect(provider.decide).toHaveBeenCalledTimes(2);
    expect(attempts[1]?.retrySucceeded).toBe(false);
    expect(ledger.snapshot()).toMatchObject({ calls: 2, estimatedSpendUSD: "$0.014100" });
    expect(() => ledger.before("gpt-5.6-luna")).toThrow();
  });
  it("does not combine a retry and repair into a third physical call", async () => {
    const provider = mock([network(), completed({ invalid: true })]);
    const observation = await observeDecision("gpt-5.6-luna", provider, row, createBudgetLedger(), {
      retry: hooks(),
    });
    expect(provider.decide).toHaveBeenCalledTimes(2);
    expect(observation.final.schema).toBe(false);
    expect(observation.repair).toBeNull();
  });
  it("does not transport-retry an interrupted second-call schema repair", async () => {
    const provider = mock([completed({ invalid: true }), network()]);
    await expect(
      observeDecision("gpt-5.6-luna", provider, row, createBudgetLedger(), { retry: hooks() }),
    ).rejects.toThrow();
    expect(provider.decide).toHaveBeenCalledTimes(2);
  });
  it("a historical failed first attempt leaves exactly one physical call", async () => {
    const old = createBudgetLedger();
    old.before("gpt-5.6-luna");
    expect(() => old.after(unknownUsage)).toThrow();
    const ledger = createBudgetLedger(0n, old.snapshot()),
      provider = mock([network()]),
      attempts: EvalAttempt[] = [];
    await expect(
      observeDecision("gpt-5.6-luna", provider, row, ledger, {
        retry: hooks(),
        priorAttempt: prior(),
        onAttempt: (attempt) => attempts.push(attempt),
      }),
    ).rejects.toThrow();
    expect(provider.decide).toHaveBeenCalledTimes(1);
    expect(attempts[0]?.attemptNumber).toBe(2);
    expect(ledger.snapshot().calls).toBe(2);
  });
  it("cannot reset a historical two-attempt decision", async () => {
    const provider = mock([]);
    await expect(
      observeDecision("gpt-5.6-luna", provider, row, createBudgetLedger(), {
        retry: hooks(),
        priorAttempt: { ...prior(), attemptNumber: 2 },
      }),
    ).rejects.toThrow("retry_exhausted");
    expect(provider.decide).not.toHaveBeenCalled();
  });
  it("retains failed time and backoff, while exposing separate reliability latency", async () => {
    let time = 0,
      index = 0;
    const attempts: EvalAttempt[] = [];
    const provider: AIProvider = {
      decide: () => {
        time += index === 0 ? 7 : 13;
        return Promise.resolve(index++ === 0 ? network() : completed());
      },
    };
    const observation = await observeDecision("gpt-5.6-luna", provider, row, createBudgetLedger(), {
      clock: () => time,
      onAttempt: (attempt) => attempts.push(attempt),
      retry: {
        ...hooks(),
        random: () => 0.5,
        sleep: (delay) => {
          time += delay;
          return Promise.resolve();
        },
      },
    });
    expect(observation.logicalLatencyMs).toBe(1520);
    expect(attempts.map((attempt) => attempt.elapsedMs)).toEqual([7, 13]);
    const report = buildLiveReport([observation], attempts).models.find(
      (model) => model.model === "gpt-5.6-luna",
    );
    expect(report?.operational.retryRequiredLatencyMs.p99).toBe(1520);
    expect(report?.operational.successfulFirstAttemptLatencyMs.samples).toBe(0);
    expect(report?.operational.retrySuccessRate).toBe(1);
  });
  it("does not fabricate missing historical interrupted latency", () => {
    const recovered: EvalAttempt = {
      ...prior(),
      attemptNumber: 2,
      purpose: "owner_resume",
      resultKind: "completed",
      elapsedMs: 13,
      backoffMs: 1000,
      retrySucceeded: true,
    };
    const report = buildLiveReport([], [prior(), recovered]).models.find(
      (model) => model.model === "gpt-5.6-luna",
    );
    expect(report?.operational.retryLatencyUnknown).toBe(1);
    expect(report?.operational.retryRequiredLatencyMs.samples).toBe(0);
  });
  it("counts provider refusals by result kind, not the frozen refusal-conformance score", () => {
    const report = buildLiveReport([], [{ ...prior(), resultKind: "refusal" }]).models.find(
      (model) => model.model === "gpt-5.6-luna",
    );
    expect(report?.operational.providerRefusals).toBe(1);
  });
  it("stops on three distinct decisions sharing a classified transport cause", () => {
    const values = [0, 1, 2].map((index): EvalAttempt => ({
      ...prior(),
      caseId: `synthetic-${index}`,
      transport: cause("ECONNRESET"),
    }));
    expect(recurringTransportFailure(values.slice(0, 2))).toBe(false);
    expect(recurringTransportFailure(values)).toBe(true);
    expect(
      recurringTransportFailure([values[0] ?? prior(), values[0] ?? prior(), values[0] ?? prior()]),
    ).toBe(false);
  });
  it("pre-dispatch projected full-run cost enforces the hard ceiling", async () => {
    const provider = mock([]);
    const checkpoint = {
      calls: 1,
      estimatedSpendUSD: "$9.990000",
      targetUSD: "$5.000000",
      hardCapUSD: "$10.000000",
      preflightReservedUSD: "$0.000000",
      perModelUSD: { "gemini-3.8-flash": "$9.990000", "gpt-5.6-luna": "$0.000000" },
    };
    await expect(
      runLiveScreen({ "gpt-5.6-luna": provider, "gemini-3.8-flash": provider }, () => {}, {
        plan: [row],
        carryBudget: checkpoint,
        initialAttempts: [
          {
            ...prior(),
            model: "gemini-3.8-flash",
            unresolvedReservationUSD: usd(reservePerCall("gemini-3.8-flash")),
          },
        ],
        retry: hooks(),
      }),
    ).rejects.toThrow("usage_unknown_or_overrun");
    expect(provider.decide).not.toHaveBeenCalled();
  });
});
