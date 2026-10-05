import { describe, expect, it, vi } from "vitest";
import { loadAIJourneyCohortConfig, S22_BOOKING_COHORT } from "../../packages/config/src/index.js";
import {
  createAIOrchestrator,
  type AIOrchestrationStore,
  type AIProviderResult,
} from "../../packages/application/src/index.js";
import { buildGeminiRequest } from "../../packages/ai/src/providers/gemini.js";
import { buildAIProviderInput } from "../../packages/application/src/index.js";
import { AI_REFERENCE, AI_SNAPSHOT, AI_METADATA, validDecision, fixtureId } from "./fixtures.js";

const flow = (
  authorizeDispatch: NonNullable<AIOrchestrationStore["authorizeDispatch"]>,
  results: readonly AIProviderResult[],
  preflight = false,
) => {
  let index = 0;
  const decide = vi.fn(() =>
    Promise.resolve(results[index++] ?? { ...AI_METADATA, kind: "timeout" as const }),
  );
  const finish = vi.fn<AIOrchestrationStore["finish"]>((input) => Promise.resolve(input.outcome));
  const store: AIOrchestrationStore = {
    load: () => Promise.resolve(AI_SNAPSHOT),
    reserve: () => Promise.resolve({ runId: fixtureId(18000 + index), attemptNo: index + 1 }),
    authorizeDispatch,
    finish,
  };
  return {
    decide,
    finish,
    run: createAIOrchestrator({
      provider: { decide },
      store,
      timeoutMs: 1000,
      ...(preflight ? { preflight: () => "staff_requested" as const } : {}),
    }).run,
  };
};
const complete = (): AIProviderResult => ({
  ...AI_METADATA,
  kind: "completed",
  value: validDecision(),
});

describe("S22 synthetic booking dispatch boundary", () => {
  it("defaults staging to paused and leaves non-staging configuration unchanged", () => {
    expect(loadAIJourneyCohortConfig({ DEPLOYMENT_ENVIRONMENT: "staging" })).toEqual({
      ...S22_BOOKING_COHORT,
      mode: "paused",
    });
    expect(loadAIJourneyCohortConfig({})).toBeNull();
    expect(
      loadAIJourneyCohortConfig({ DEPLOYMENT_ENVIRONMENT: "staging", AI_JOURNEY_MODE: "booking" })
        ?.mode,
    ).toBe("booking");
  });
  it.each([
    { AI_JOURNEY_MODE: "booking" },
    { DEPLOYMENT_ENVIRONMENT: "staging", AI_JOURNEY_MODE: "anything" },
    { DEPLOYMENT_ENVIRONMENT: "staging", AI_REQUEST_TIMEOUT_MS: "120000" },
  ])("rejects widened or non-staging activation %o", (environment) => {
    expect(() => loadAIJourneyCohortConfig(environment)).toThrow();
  });
  it("denial produces no provider invocation and persists explicit non-authorization", async () => {
    const authorize = vi.fn(() => Promise.resolve(false));
    const test = flow(authorize, [complete()]);
    expect(await test.run(AI_REFERENCE)).toMatchObject({ reason: "policy_denied" });
    expect(test.decide).not.toHaveBeenCalled();
    expect(test.finish.mock.calls[0]?.[0].dispatchAuthorized).toBe(false);
  });
  it("waits for durable authorization to finish before invoking the provider", async () => {
    let release: ((value: boolean) => void) | undefined;
    const authorize = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          release = resolve;
        }),
    );
    const test = flow(authorize, [complete()]);
    const result = test.run(AI_REFERENCE);
    await vi.waitFor(() => expect(authorize).toHaveBeenCalledTimes(1));
    expect(test.decide).not.toHaveBeenCalled();
    release?.(true);
    expect(await result).toMatchObject({ kind: "decision" });
    expect(test.finish.mock.calls[0]?.[0].dispatchAuthorized).toBe(true);
  });
  it("database/commit uncertainty fails closed and does not trigger a paid retry", async () => {
    const test = flow(() => {
      return Promise.reject(new Error("synthetic commit uncertainty"));
    }, [complete()]);
    await expect(test.run(AI_REFERENCE)).rejects.toThrow("synthetic commit uncertainty");
    expect(test.decide).not.toHaveBeenCalled();
  });
  it("deterministic staff preflight does not reserve a physical call", async () => {
    const authorize = vi.fn(() => Promise.resolve(true));
    const test = flow(authorize, [complete()], true);
    expect(await test.run(AI_REFERENCE)).toMatchObject({ reason: "staff_requested" });
    expect(authorize).not.toHaveBeenCalled();
    expect(test.decide).not.toHaveBeenCalled();
    expect(test.finish.mock.calls[0]?.[0].dispatchAuthorized).toBe(false);
  });
  it("the one schema repair requires a separate authorization; denial stops it", async () => {
    let slot = 0;
    const authorize = vi.fn(() => Promise.resolve(++slot === 1));
    const test = flow(authorize, [
      { ...AI_METADATA, kind: "completed", value: { malformed: true } },
      complete(),
    ]);
    expect(await test.run(AI_REFERENCE)).toMatchObject({ reason: "policy_denied" });
    expect(authorize).toHaveBeenCalledTimes(2);
    expect(test.decide).toHaveBeenCalledTimes(1);
  });
  it("aborting while authorization waits cannot dispatch after the deadline", async () => {
    const signal = new AbortController();
    const test = flow(() => {
      signal.abort();
      return Promise.resolve(true);
    }, [complete()]);
    expect(await test.run(AI_REFERENCE, signal.signal)).toMatchObject({ reason: "timeout" });
    expect(test.decide).not.toHaveBeenCalled();
  });
  it("production request fixes one candidate and total generated-token cap; no billable extras", () => {
    const input = buildAIProviderInput(AI_SNAPSHOT, new AbortController().signal);
    if (input === null) throw new Error("Invalid test context");
    const body = buildGeminiRequest(input);
    expect(body.generationConfig.candidateCount).toBe(1);
    expect(body.generationConfig.maxOutputTokens).toBe(4000);
    expect(body.generationConfig.thinkingConfig.thinkingLevel).toBe("low");
    for (const key of ["tools", "cachedContent", "serviceTier", "service_tier"])
      expect(body).not.toHaveProperty(key);
    expect(body.contents).toHaveLength(1);
    expect(
      body.contents[0]?.parts.every((part) => Object.keys(part).every((key) => key === "text")),
    ).toBe(true);
    expect((1_048_576n * 750_000n) / 1_000_000n + (4000n * 3_750_000n) / 1_000_000n).toBe(801_432n);
    expect(S22_BOOKING_COHORT.historicalReserveMicros + 6n * 801_432n).toBe(5_841_988n);
  });
});
