import { describe, expect, it } from "vitest";

import {
  WORKER_FAILURE_CATEGORIES,
  WORKER_MAX_EXECUTIONS,
  WORKER_MAX_GENERIC_AGE_MILLISECONDS,
  WorkerExecutionFailure,
  classifyHandlerFailure,
  decideWorkerRetry,
  fullJitterCapSeconds,
  sampleFullJitterSeconds,
} from "../../apps/worker/src/reliability-policy.js";

const NOW = new Date("2026-09-14T12:00:00.000Z");
const FRESH = new Date(NOW.getTime() - 1_000);

const decide = (
  failure: WorkerExecutionFailure,
  executionNumber = 1,
  createdAt = FRESH,
  random = (): number => 0.5,
) => decideWorkerRetry({ createdAt, executionNumber, failure, now: NOW, random });

describe("S8.5 finite retry policy", () => {
  it("freezes the seven typed failure categories", () => {
    expect(WORKER_FAILURE_CATEGORIES).toEqual([
      "RETRYABLE_INFRASTRUCTURE",
      "RATE_LIMITED",
      "PERMANENT_VALIDATION",
      "UNSUPPORTED_VERSION",
      "TENANT_INTEGRITY",
      "PERMANENT_BUSINESS",
      "AMBIGUOUS_EXTERNAL_EFFECT",
    ]);
    expect(Object.isFrozen(WORKER_FAILURE_CATEGORIES)).toBe(true);
  });

  it.each([
    { cap: 5, retryIndex: 0 },
    { cap: 10, retryIndex: 1 },
    { cap: 20, retryIndex: 2 },
    { cap: 40, retryIndex: 3 },
    { cap: 300, retryIndex: 20 },
  ])("uses exact full-jitter bounds for retry $retryIndex", ({ cap, retryIndex }) => {
    expect(fullJitterCapSeconds(retryIndex)).toBe(cap);
    expect(sampleFullJitterSeconds(retryIndex, () => 0)).toBe(0);
    expect(sampleFullJitterSeconds(retryIndex, () => 0.5)).toBe(Math.floor((cap + 1) / 2));
    expect(sampleFullJitterSeconds(retryIndex, () => 0.999_999)).toBe(cap);
  });

  it("allows four retries but never a sixth execution", () => {
    const failure = new WorkerExecutionFailure("RETRYABLE_INFRASTRUCTURE");
    for (let execution = 1; execution < WORKER_MAX_EXECUTIONS; execution += 1) {
      expect(decide(failure, execution)).toMatchObject({ kind: "retry" });
    }
    expect(decide(failure, 5)).toEqual({
      category: "RETRYABLE_INFRASTRUCTURE",
      kind: "dead_letter",
    });
    expect(decide(failure, 6)).toEqual({
      category: "RETRYABLE_INFRASTRUCTURE",
      kind: "dead_letter",
    });
  });

  it.each([
    "PERMANENT_VALIDATION",
    "UNSUPPORTED_VERSION",
    "TENANT_INTEGRITY",
    "PERMANENT_BUSINESS",
  ] as const)("gives %s zero retries", (category) => {
    expect(decide(new WorkerExecutionFailure(category))).toEqual({
      category,
      kind: "dead_letter",
    });
  });

  it("requires reconciliation rather than blind retry after an ambiguous effect", () => {
    expect(decide(new WorkerExecutionFailure("AMBIGUOUS_EXTERNAL_EFFECT"))).toMatchObject({
      category: "AMBIGUOUS_EXTERNAL_EFFECT",
      kind: "reconcile",
    });
    const classified = classifyHandlerFailure(new Error("raw provider body must not escape"));
    expect(classified.category).toBe("AMBIGUOUS_EXTERNAL_EFFECT");
    expect(classified.message).not.toContain("raw provider body");
  });

  it("stops at the 24-hour generic age boundary", () => {
    expect(
      decide(
        new WorkerExecutionFailure("RETRYABLE_INFRASTRUCTURE"),
        1,
        new Date(NOW.getTime() - WORKER_MAX_GENERIC_AGE_MILLISECONDS),
      ),
    ).toMatchObject({ kind: "dead_letter" });
  });

  it("honors only bounded Retry-After inside the remaining deadline", () => {
    expect(
      decide(new WorkerExecutionFailure("RATE_LIMITED", { retryAfterMilliseconds: 12_000 })),
    ).toMatchObject({ delaySeconds: 12, kind: "retry" });
    expect(
      decide(new WorkerExecutionFailure("RATE_LIMITED", { retryAfterMilliseconds: -1 })),
    ).toMatchObject({ delaySeconds: 3, kind: "retry" });
    expect(
      decide(new WorkerExecutionFailure("RATE_LIMITED", { retryAfterMilliseconds: "malformed" })),
    ).toMatchObject({ delaySeconds: 3, kind: "retry" });
    expect(
      decide(new WorkerExecutionFailure("RATE_LIMITED", { retryAfterMilliseconds: 301_000 })),
    ).toMatchObject({ kind: "dead_letter" });
    expect(
      decide(
        new WorkerExecutionFailure("RATE_LIMITED", {
          businessDeadline: new Date(NOW.getTime() + 5_000),
          retryAfterMilliseconds: 6_000,
        }),
      ),
    ).toMatchObject({ kind: "dead_letter" });
  });
});
