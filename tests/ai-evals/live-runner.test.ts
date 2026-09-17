import { describe, expect, it, vi } from "vitest";
import type { AIProvider, AIProviderResult } from "@lead-agent/application";
import { validDecision } from "../ai/fixtures.js";
import { createBudgetLedger } from "./budget.js";
import { observeDecision, runLiveScreen } from "./live-runner.js";
import { buildLiveReport } from "./live-report.js";
import { inputForCase, openAIScreenFetch, planScreen, SCREEN_MODELS } from "./screen.js";
import { createOpenAIProvider } from "../../packages/ai/src/providers/openai.js";

const row = planScreen()[0];
if (row === undefined) throw new TypeError("Missing fixture");
const completed = (value: unknown = validDecision()): AIProviderResult => ({
  kind: "completed",
  model: "gpt-5.6-luna",
  responseId: null,
  latencyMs: 7,
  usage: { input: 100, output: 100, total: 200, cachedInput: 0, reasoning: 20 },
  value,
});
const provider = (results: readonly AIProviderResult[]) => {
  let position = 0;
  return {
    decide: vi.fn<AIProvider["decide"]>(() => {
      const result = results[position++];
      if (result === undefined) throw new Error("Unexpected extra call");
      return Promise.resolve(result);
    }),
  };
};
describe("S13 opt-in live orchestration without execution authority", () => {
  it("one schema repair, same original/signal/deadline, first-pass validity retained", async () => {
    const mock = provider([completed({ bad: true }), completed()]);
    const observation = await observeDecision("gpt-5.6-luna", mock, row, createBudgetLedger());
    expect(mock.decide).toHaveBeenCalledTimes(2);
    expect(mock.decide.mock.calls[0]?.[0].signal).toBe(mock.decide.mock.calls[1]?.[0].signal);
    expect(mock.decide.mock.calls.map((call) => call[0].message)).toEqual([
      row.item.input_original,
      row.item.input_original,
    ]);
    expect(mock.decide.mock.calls.map((call) => call[0].repair)).toEqual([false, true]);
    expect(observation).toMatchObject({
      first: { schema: false },
      final: { schema: true },
      repair: { schema: true },
      system: { protectedMutationBypass: false },
    });
  });
  it("never attempts a second repair", async () => {
    const mock = provider([completed({ bad: true }), completed({ bad: true })]);
    expect(
      (await observeDecision("gpt-5.6-luna", mock, row, createBudgetLedger())).final.schema,
    ).toBe(false);
    expect(mock.decide).toHaveBeenCalledTimes(2);
  });
  it.each(["refusal", "incomplete", "timeout", "provider_error", "invalid_output"] as const)(
    "no repair/retry for %s",
    async (kind) => {
      const base = completed();
      const result: AIProviderResult =
        kind === "incomplete"
          ? { ...base, kind, reason: "output_limit" }
          : kind === "provider_error"
            ? { ...base, kind, category: "rate_limit", retryable: true, retryAfterMs: 1000 }
            : { ...base, kind };
      const mock = provider([result]);
      await observeDecision("gpt-5.6-luna", mock, row, createBudgetLedger());
      expect(mock.decide).toHaveBeenCalledTimes(1);
    },
  );
  it("known malformed provider text can repair once", async () => {
    const mock = provider([
      { ...completed(), kind: "invalid_output", outputHash: new Uint8Array(32) },
      completed(),
    ]);
    expect(
      (await observeDecision("gpt-5.6-luna", mock, row, createBudgetLedger())).repair?.schema,
    ).toBe(true);
  });
  it("unknown billing permanently prevents further calls", async () => {
    const ledger = createBudgetLedger(),
      mock = provider([
        {
          ...completed(),
          usage: { input: null, output: null, total: null, cachedInput: null, reasoning: null },
        },
      ]);
    await expect(observeDecision("gpt-5.6-luna", mock, row, ledger)).rejects.toThrow(
      "usage_unknown_or_overrun",
    );
    expect(() => ledger.before("gpt-5.6-luna")).toThrow();
    expect(mock.decide).toHaveBeenCalledTimes(1);
  });
  it("charges model-mismatch call but stops before any repair", async () => {
    const ledger = createBudgetLedger(),
      mock = provider([{ ...completed(), model: "unexpected-model" }]);
    await expect(observeDecision("gpt-5.6-luna", mock, row, ledger)).rejects.toThrow(
      "provider_model_mismatch",
    );
    expect(ledger.snapshot().calls).toBe(1);
    expect(mock.decide).toHaveBeenCalledTimes(1);
  });
  it("does not write key-containing model prose to observations", async () => {
    const secret = "synthetic-secret-never-a-live-key";
    const mock = provider([
      completed(validDecision({ message: { mode: "send_candidate", draft_text: secret } })),
    ]);
    await expect(
      observeDecision("gpt-5.6-luna", mock, row, createBudgetLedger(), { secretValues: [secret] }),
    ).rejects.toThrow("secret_disclosure");
  });
  it("raw forbidden action remains a model failure even if policy blocks it", async () => {
    const unsafeRow = planScreen().find(
      (r) => r.phase === "core" && r.item.forbidden_actions.includes("confirm_appointment"),
    );
    if (!unsafeRow) throw new TypeError("Missing hostile case");
    const value = validDecision({
      action: {
        type: "confirm_appointment",
        appointment_request_id: "0193f1a8-7f65-7c28-a434-000000003101",
      },
    });
    const observation = await observeDecision(
      "gpt-5.6-luna",
      provider([completed(value)]),
      unsafeRow,
      createBudgetLedger(),
    );
    expect(observation.rawForbiddenAction).toBe(true);
    expect(observation.final.policyDisposition).toBe("fallback");
    expect(observation.system.protectedMutationBypass).toBe(false);
  });
  it("null safe fallback is NOT reported as a Latin reply", async () => {
    const mock = provider([
      completed(validDecision({ message: { mode: "use_safe_template", draft_text: null } })),
    ]);
    expect(
      (await observeDecision("gpt-5.6-luna", mock, row, createBudgetLedger())).latinDraft,
    ).toBeNull();
  });
  it("runs paired smoke before core and summarizes repair cost/latency separately", async () => {
    const observations = await runLiveScreen(
      {
        "gpt-5.6-luna": provider([completed()]),
        "gemini-3.8-flash": provider([{ ...completed(), model: "gemini-3.8-flash" }]),
      },
      () => {},
      { plan: [row] },
    );
    expect(observations.observations.map((r) => r.model)).toEqual(SCREEN_MODELS);
    const report = buildLiveReport(observations.observations);
    expect(report.models[0]?.latencyMs.physical).toMatchObject({
      samples: 1,
      p50: 7,
      p95: 7,
      p99: 7,
      max: 7,
    });
    expect(report.nativeHumanReview).toBe("PENDING");
    expect(report.productionModel).toBe("NOT_SELECTED");
    expect(report.models.every((r) => r.systemRedLines.executionAttempts === 0)).toBe(true);
  });
  it("all OpenAI fixtures/repairs also fit the wire-byte reservation", async () => {
    const request = vi.fn<typeof fetch>(() => Promise.resolve(Response.json({})));
    const mock = createOpenAIProvider(
      { apiKey: "synthetic-openai-test-key", model: "gpt-5.6-luna", requestTimeoutMs: 1000 },
      { fetch: openAIScreenFetch(request) },
    );
    for (const fixture of planScreen(true))
      for (const repair of [false, true]) {
        request.mockClear();
        await mock.decide(
          inputForCase(fixture.item, new AbortController().signal, fixture.hint, repair),
        );
        expect(request).toHaveBeenCalledTimes(1);
      }
  });
});
