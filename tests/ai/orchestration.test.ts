import { describe, expect, it, vi } from "vitest";
import {
  createAIOrchestrator,
  aiFallback,
  type AIOrchestrationStore,
  type AIProvider,
  type AIProviderResult,
} from "../../packages/application/src/index.js";
import { AI_METADATA, AI_REFERENCE, AI_SNAPSHOT, fixtureId, validDecision } from "./fixtures.js";

const setup = (
  results: readonly AIProviderResult[],
  options: Readonly<{ stale?: boolean; loadMissing?: boolean; contextLarge?: boolean }> = {},
) => {
  const load = vi.fn<AIOrchestrationStore["load"]>(() =>
    Promise.resolve(
      options.loadMissing
        ? null
        : options.contextLarge
          ? { ...AI_SNAPSHOT, message: "a".repeat(4_001) }
          : AI_SNAPSHOT,
    ),
  );
  const reserve = vi.fn<AIOrchestrationStore["reserve"]>(() =>
    Promise.resolve({
      attemptNo: 1,
      runId: fixtureId(12100),
    }),
  );
  const finish = vi.fn<AIOrchestrationStore["finish"]>((input) =>
    Promise.resolve(options.stale ? aiFallback("stale_context") : input.outcome),
  );
  let index = 0;
  const decide = vi.fn((): Promise<AIProviderResult> =>
    Promise.resolve(results[index++] ?? { ...AI_METADATA, kind: "invalid_output" }),
  );
  const record = vi.fn();
  const orchestrator = createAIOrchestrator({
    provider: { decide },
    store: { load, reserve, finish },
    timeoutMs: 1_000,
    telemetry: { record },
  });
  return { orchestrator, decide, load, reserve, finish, record };
};
describe("S12 deterministic orchestration", () => {
  it("validates schema and deterministic policy before a proposal-only outcome", async () => {
    const test = setup([{ ...AI_METADATA, kind: "completed", value: validDecision() }]);
    expect(await test.orchestrator.run(AI_REFERENCE)).toMatchObject({
      kind: "decision",
      applied: false,
    });
    expect(test.decide).toHaveBeenCalledTimes(1);
    expect(test.finish).toHaveBeenCalledTimes(1);
    expect(test.record).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "decision", repair: false }),
    );
    expect(JSON.stringify(test.record.mock.calls)).not.toContain("draft_text");
  });
  it("makes ONE repair and finalizes the rejected physical invocation separately", async () => {
    const test = setup([
      { ...AI_METADATA, kind: "completed", value: { wrong_schema: true } },
      { ...AI_METADATA, kind: "completed", value: validDecision() },
    ]);
    expect(await test.orchestrator.run(AI_REFERENCE)).toMatchObject({ kind: "decision" });
    expect(test.decide).toHaveBeenCalledTimes(2);
    expect(test.finish.mock.calls[0]?.[0]).toMatchObject({
      allowRepair: true,
      outcome: { reason: "invalid_output" },
    });
    expect(test.finish.mock.calls[1]?.[0]).toMatchObject({ allowRepair: false });
    expect(test.decide.mock.calls).toHaveLength(2);
  });
  it("never loops after a second invalid response", async () => {
    const test = setup([
      { ...AI_METADATA, kind: "invalid_output", outputHash: new Uint8Array(32).fill(5) },
      { ...AI_METADATA, kind: "invalid_output", outputHash: new Uint8Array(32).fill(5) },
    ]);
    expect(await test.orchestrator.run(AI_REFERENCE)).toMatchObject({ reason: "invalid_output" });
    expect(test.decide).toHaveBeenCalledTimes(2);
    expect(test.finish.mock.calls[1]?.[0].allowRepair).toBe(false);
  });
  it.each([
    { ...AI_METADATA, kind: "invalid_output" as const },
    {
      ...AI_METADATA,
      model: null,
      kind: "invalid_output" as const,
      outputHash: new Uint8Array(32).fill(5),
    },
    { ...AI_METADATA, model: null, kind: "invalid_output" as const },
  ])(
    "does not schema-repair malformed protocol or missing output provenance %o",
    async (result) => {
      const test = setup([result]);
      expect(await test.orchestrator.run(AI_REFERENCE)).toMatchObject({ reason: "invalid_output" });
      expect(test.decide).toHaveBeenCalledTimes(1);
      expect(test.finish.mock.calls[0]?.[0].allowRepair).toBe(false);
    },
  );
  it.each([
    { ...AI_METADATA, kind: "refusal" as const },
    { ...AI_METADATA, kind: "timeout" as const },
    {
      ...AI_METADATA,
      kind: "provider_error" as const,
      category: "authentication" as const,
      retryable: false,
      retryAfterMs: null,
    },
    {
      ...AI_METADATA,
      kind: "provider_error" as const,
      category: "rate_limit" as const,
      retryable: true,
      retryAfterMs: 1_000,
    },
    {
      ...AI_METADATA,
      kind: "provider_error" as const,
      category: "unavailable" as const,
      retryable: true,
      retryAfterMs: null,
    },
    { ...AI_METADATA, kind: "incomplete" as const, reason: "output_limit" as const },
  ])("does not schema-repair provider failure %o", async (result) => {
    const test = setup([result]);
    expect(await test.orchestrator.run(AI_REFERENCE)).toMatchObject({
      kind: "fallback_required",
      applied: false,
    });
    expect(test.decide).toHaveBeenCalledTimes(1);
  });
  it("denies a tool-like model payload even after repair", async () => {
    const result: AIProviderResult = {
      ...AI_METADATA,
      kind: "completed",
      value: { ...validDecision(), tools: [{ name: "execute_sql" }] },
    };
    const test = setup([result, result]);
    expect(await test.orchestrator.run(AI_REFERENCE)).toMatchObject({ reason: "invalid_output" });
    expect(test.decide).toHaveBeenCalledTimes(2);
  });
  it("does not repair schema-valid but policy-denied proposals", async () => {
    const test = setup([
      {
        ...AI_METADATA,
        kind: "completed",
        value: validDecision({ action: { type: "request_information", field: "phone" } }),
      },
    ]);
    expect(await test.orchestrator.run(AI_REFERENCE)).toMatchObject({ reason: "policy_denied" });
    expect(test.decide).toHaveBeenCalledTimes(1);
  });
  it("rechecks stale context after the external call and suppresses repair", async () => {
    const test = setup([{ ...AI_METADATA, kind: "completed", value: validDecision() }], {
      stale: true,
    });
    expect(await test.orchestrator.run(AI_REFERENCE)).toMatchObject({ reason: "stale_context" });
    expect(test.decide).toHaveBeenCalledTimes(1);
  });
  it("returns bounded typed fallback without provider call for overlarge context", async () => {
    const test = setup([], { contextLarge: true });
    expect(await test.orchestrator.run(AI_REFERENCE)).toMatchObject({
      reason: "context_too_large",
    });
    expect(test.decide).not.toHaveBeenCalled();
    expect(test.finish).toHaveBeenCalledTimes(1);
  });
  it("does not call provider for missing/duplicate/cross-tenant source", async () => {
    const test = setup([], { loadMissing: true });
    expect(await test.orchestrator.run(AI_REFERENCE)).toMatchObject({ reason: "stale_context" });
    expect(test.decide).not.toHaveBeenCalled();
    expect(test.reserve).not.toHaveBeenCalled();
  });
  it("sanitizes unexpected provider exceptions", async () => {
    const test = setup([]);
    test.decide.mockImplementation(() =>
      Promise.reject(new Error("synthetic-sensitive-provider-error")),
    );
    const result = await test.orchestrator.run(AI_REFERENCE);
    expect(result).toMatchObject({ reason: "provider_unavailable" });
    expect(JSON.stringify(result)).not.toContain("sensitive");
  });
  it("total deadline bounds even a broken provider ignoring AbortSignal", async () => {
    const test = setup([]);
    const decide = vi.fn((): Promise<AIProviderResult> => new Promise(() => {}));
    const orchestrator = createAIOrchestrator({
      provider: { decide },
      store: { load: test.load, reserve: test.reserve, finish: test.finish },
      timeoutMs: 10,
    });
    expect(await orchestrator.run(AI_REFERENCE)).toMatchObject({ reason: "timeout" });
    expect(decide).toHaveBeenCalledTimes(1);
  });
  it("cannot miss cancellation during synchronous provider startup", async () => {
    const test = setup([]);
    const controller = new AbortController();
    const decide = vi.fn((): Promise<AIProviderResult> => {
      controller.abort();
      return new Promise(() => {});
    });
    const orchestrator = createAIOrchestrator({
      provider: { decide },
      store: { load: test.load, reserve: test.reserve, finish: test.finish },
      timeoutMs: 1000,
    });
    const result = await Promise.race([
      orchestrator.run(AI_REFERENCE, controller.signal),
      new Promise<"MISSED_ABORT">((resolve) => setTimeout(() => resolve("MISSED_ABORT"), 50)),
    ]);
    expect(result).not.toBe("MISSED_ABORT");
    expect(result).toMatchObject({ kind: "fallback_required", reason: "timeout" });
    expect(decide).toHaveBeenCalledTimes(1);
    expect(test.finish).toHaveBeenCalledTimes(1);
    expect(test.finish.mock.calls[0]?.[0]).toMatchObject({
      dispatchAuthorized: true,
      allowRepair: false,
      provider: { kind: "timeout", model: null, usage: { input: null, output: null } },
    });
  });
  it.each(["completed", "throws"] as const)(
    "cleans up the deadline listener when provider startup %s",
    async (behavior) => {
      const test = setup([]);
      let removedCalls = 0;
      const decide: AIProvider["decide"] = (input) => {
        const originalRemove = input.signal.removeEventListener.bind(input.signal);
        vi.spyOn(input.signal, "removeEventListener").mockImplementation((...args) => {
          removedCalls++;
          originalRemove(...args);
        });
        if (behavior === "throws") throw new Error("sensitive-test-error");
        return Promise.resolve({ ...AI_METADATA, kind: "completed", value: validDecision() });
      };
      const outcome = await createAIOrchestrator({
        provider: { decide },
        store: { load: test.load, reserve: test.reserve, finish: test.finish },
        timeoutMs: 1000,
      }).run(AI_REFERENCE);
      expect(outcome.kind).toBe(behavior === "completed" ? "decision" : "fallback_required");
      expect(removedCalls).toBe(1);
      expect(JSON.stringify(outcome)).not.toContain("sensitive-test-error");
    },
  );
  it("a late completion after cancellation cannot finalize twice or replace unknown usage", async () => {
    const test = setup([]);
    const controller = new AbortController();
    let complete: ((result: AIProviderResult) => void) | undefined;
    const decide = vi.fn(
      (): Promise<AIProviderResult> =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    const result = createAIOrchestrator({
      provider: { decide },
      store: { load: test.load, reserve: test.reserve, finish: test.finish },
      timeoutMs: 1000,
      telemetry: { record: test.record },
    }).run(AI_REFERENCE, controller.signal);
    await vi.waitFor(() => expect(decide).toHaveBeenCalledOnce());
    controller.abort();
    expect(await result).toMatchObject({ reason: "timeout" });
    complete?.({ ...AI_METADATA, kind: "completed", value: validDecision() });
    await Promise.resolve();
    expect(test.finish).toHaveBeenCalledOnce();
    expect(test.record).toHaveBeenCalledOnce();
    expect(test.finish.mock.calls[0]?.[0].provider?.usage).toEqual({
      input: null,
      output: null,
      total: null,
      cachedInput: null,
      reasoning: null,
    });
  });
  it("uses the same total deadline across repair", async () => {
    const test = setup([
      { ...AI_METADATA, kind: "invalid_output", outputHash: new Uint8Array(32).fill(5) },
      { ...AI_METADATA, kind: "completed", value: validDecision() },
    ]);
    const signals: AbortSignal[] = [];
    const decide = vi.fn((input: Parameters<AIProvider["decide"]>[0]) => {
      signals.push(input.signal);
      return Promise.resolve(
        signals.length === 1
          ? {
              ...AI_METADATA,
              kind: "invalid_output" as const,
              outputHash: new Uint8Array(32).fill(5),
            }
          : { ...AI_METADATA, kind: "completed" as const, value: validDecision() },
      );
    });
    const orchestrator = createAIOrchestrator({
      provider: { decide },
      store: { load: test.load, reserve: test.reserve, finish: test.finish },
      timeoutMs: 1_000,
    });
    await orchestrator.run(AI_REFERENCE);
    expect(signals).toHaveLength(2);
    expect(signals[0]).toBe(signals[1]);
    expect(decide.mock.calls[1]?.[0].repair).toBe(true);
  });
});
