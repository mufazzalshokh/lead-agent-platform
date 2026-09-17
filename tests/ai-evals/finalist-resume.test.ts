import { readFileSync } from "node:fs";
import { expect, it, vi } from "vitest";
import type { AIProvider, AIProviderResult } from "@lead-agent/application";
import { validDecision } from "../ai/fixtures.js";
import { CORPUS } from "./corpus.js";
import { createBudgetLedger } from "./budget.js";
import { observeDecision } from "./live-runner.js";
import { buildLiveReport } from "./live-report.js";
import type { EvalAttempt, RetryHooks } from "./eval-retry.js";
import {
  decodeFinalistResume,
  decodeDNSFinalistResume,
  readFinalistResume,
} from "./finalist-resume.js";
import { readFinalistBase, finalistPlan } from "./finalist.js";

const item = CORPUS.find((row) => row.case_id === "s13-uz-mixed-script-26-0");
if (item === undefined) throw new TypeError("Missing owner recovery fixture");
const row = { item, phase: "core" as const, hint: false };
const prior: EvalAttempt = {
  model: "gpt-5.6-luna",
  caseId: item.case_id,
  phase: "core",
  hint: false,
  attemptNumber: 1,
  purpose: "initial",
  resultKind: "unknown_interruption",
  category: null,
  transport: null,
  http: null,
  aborted: null,
  elapsedMs: null,
  backoffMs: null,
  retrySucceeded: null,
  usage: { input: null, output: null, total: null, cachedInput: null, reasoning: null },
  billableCostUSD: null,
  unresolvedReservationUSD: "$0.007050",
  source: "historical",
};
const complete: Extract<AIProviderResult, { kind: "completed" }> = {
  kind: "completed",
  model: "gpt-5.6-luna",
  responseId: null,
  latencyMs: 7,
  value: validDecision(),
  usage: { input: 100, output: 100, total: 200, cachedInput: 0, reasoning: 20 },
};
const retry: RetryHooks = {
  resetDiagnostics: () => {},
  diagnostics: () => ({ transport: null, http: null }),
  random: () => 0,
  sleep: () => Promise.resolve(),
};
const mock = (value: AIProviderResult) => ({
  decide: vi.fn<AIProvider["decide"]>(() => Promise.resolve(value)),
});
it("allows precisely the owner-approved second call and retains unknown history", async () => {
  const provider = mock(complete),
    attempts: EvalAttempt[] = [prior];
  const observation = await observeDecision(
    "gpt-5.6-luna",
    provider,
    row,
    createBudgetLedger(0n, undefined, "finalist"),
    {
      priorAttempt: prior,
      ownerRecovery: "s13c-luna-mixed-script-26-0",
      retry,
      onAttempt: (attempt) => attempts.push(attempt),
    },
  );
  expect(provider.decide).toHaveBeenCalledTimes(1);
  expect(attempts[1]).toMatchObject({
    attemptNumber: 2,
    purpose: "owner_resume",
    retrySucceeded: true,
  });
  const report = buildLiveReport([observation], attempts).models.find(
    (m) => m.model === "gpt-5.6-luna",
  );
  expect(report?.operational).toMatchObject({
    physicalAttempts: 2,
    successfulCalls: 1,
    unclassifiedInterruptions: 1,
    providerFailures: 0,
    retryLatencyUnknown: 1,
  });
  expect(report?.firstPhysicalSchema.passed).toBe(0);
});
it.each([
  "refusal",
  "incomplete",
  "invalid_output",
  "provider_error",
  "timeout",
  "invalid_schema",
  "different_model",
])("owner retry failure %s stops without repair/third call", async (failure) => {
  const failed: AIProviderResult =
    failure === "invalid_schema"
      ? { ...complete, value: {} }
      : failure === "different_model"
        ? { ...complete, model: "gemini-3.8-flash" }
        : failure === "refusal"
          ? { ...complete, kind: "refusal" }
          : failure === "incomplete"
            ? { ...complete, kind: "incomplete", reason: "unknown" }
            : failure === "provider_error"
              ? {
                  ...complete,
                  model: null,
                  kind: "provider_error",
                  category: "network",
                  retryable: false,
                  retryAfterMs: null,
                }
              : failure === "timeout"
                ? { ...complete, model: null, kind: "timeout" }
                : { ...complete, kind: "invalid_output" };
  const provider = mock(failed);
  await expect(
    observeDecision("gpt-5.6-luna", provider, row, createBudgetLedger(0n, undefined, "finalist"), {
      priorAttempt: prior,
      ownerRecovery: "s13c-luna-mixed-script-26-0",
      retry,
    }),
  ).rejects.toThrow();
  expect(provider.decide).toHaveBeenCalledTimes(1);
});
it("does not authorize unknown failures on other cases or an already-used second attempt", async () => {
  const provider = mock(complete);
  for (const modified of [
    { ...prior, caseId: "different-case" },
    { ...prior, attemptNumber: 2 as const },
  ]) {
    await expect(
      observeDecision(
        "gpt-5.6-luna",
        provider,
        row,
        createBudgetLedger(0n, undefined, "finalist"),
        { priorAttempt: modified, ownerRecovery: "s13c-luna-mixed-script-26-0", retry },
      ),
    ).rejects.toThrow("retry_exhausted");
  }
  await expect(
    observeDecision("gpt-5.6-luna", provider, row, createBudgetLedger(), {
      priorAttempt: prior,
      retry,
    }),
  ).rejects.toThrow("retry_exhausted");
  expect(provider.decide).not.toHaveBeenCalled();
});
it.skipIf(process.env["S13_FINALIST_RESUME_PROOF"] === undefined)(
  "read-only proof preserves 407 decisions and all 408 reservations",
  () => {
    const path = process.env["S13_FINALIST_RESUME_PROOF"],
      basePath = process.env["S13_FINALIST_BASE"];
    if (!path || !basePath) throw new TypeError("Missing preserved artifacts");
    const plan = finalistPlan(readFinalistBase(basePath).rows),
      resume = readFinalistResume(path, plan);
    expect(resume.observations).toHaveLength(407);
    expect(resume.attempts).toHaveLength(408);
    expect(resume.attempts.at(-1)).toEqual(prior);
    const raw: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (typeof raw !== "object" || raw === null || Array.isArray(raw))
      throw new TypeError("Bad artifact");
    expect(() =>
      decodeFinalistResume(
        { ...raw, pending: { model: "gpt-5.6-luna", caseId: "other", attemptNumber: 1 } },
        plan,
      ),
    ).toThrow();
    expect(() =>
      decodeFinalistResume({ ...raw, observations: resume.observations.slice(1) }, plan),
    ).toThrow();
    expect(() => decodeFinalistResume({ ...raw, attempts: resume.attempts }, plan)).toThrow();
    expect(() => decodeFinalistResume({ ...raw, corpusHash: "changed" }, plan)).toThrow();
    console.log(
      JSON.stringify({
        event: "s13c_resume_validated",
        observations: 407,
        physicalLedger: 408,
        remaining: 433,
        budget: resume.budget,
        paidCalls: 0,
      }),
    );
  },
);
it.skipIf(process.env["S13_FINALIST_DNS_RESUME_PROOF"] === undefined)(
  "read-only DNS resume preserves 501 decisions, 503 attempts and both unknown bills",
  () => {
    const path = process.env["S13_FINALIST_DNS_RESUME_PROOF"],
      basePath = process.env["S13_FINALIST_BASE"];
    if (!path || !basePath) throw new TypeError("Missing DNS checkpoint artifacts");
    const plan = finalistPlan(readFinalistBase(basePath).rows),
      resume = readFinalistResume(path, plan);
    expect(resume.observations).toHaveLength(501);
    expect(resume.attempts).toHaveLength(503);
    expect(resume.ownerRecovery).toBeNull();
    expect(resume.attempts.at(-1)).toMatchObject({
      caseId: "s13-uz-typos-phonetic-25-0",
      model: "gpt-5.6-luna",
      attemptNumber: 1,
      transport: { classification: "DNS", causeCode: "ENOTFOUND" },
      http: null,
      unresolvedReservationUSD: "$0.007050",
    });
    expect(resume.budget.estimatedSpendUSD).toBe("$0.413749");
    const raw: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (
      typeof raw !== "object" ||
      raw === null ||
      Array.isArray(raw) ||
      !("previousEvidence" in raw) ||
      typeof raw.previousEvidence !== "string"
    )
      throw new TypeError("Invalid DNS checkpoint");
    const original = readFinalistResume(raw.previousEvidence, plan);
    if (original.ownerRecovery === null) throw new TypeError("Not the original checkpoint");
    expect(() =>
      decodeDNSFinalistResume(
        { ...raw, observations: resume.observations.slice(1) },
        plan,
        original,
      ),
    ).toThrow();
    expect(() =>
      decodeDNSFinalistResume({ ...raw, attempts: resume.attempts.slice(1) }, plan, original),
    ).toThrow();
    expect(() =>
      decodeDNSFinalistResume(
        { ...raw, budget: { ...resume.budget, estimatedSpendUSD: "$0.000000" } },
        plan,
        original,
      ),
    ).toThrow();
    expect(() =>
      decodeDNSFinalistResume(
        {
          ...raw,
          attempts: [
            ...resume.attempts.slice(0, -1),
            { ...resume.attempts.at(-1), attemptNumber: 2 },
          ],
        },
        plan,
        original,
      ),
    ).toThrow();
    console.log(
      JSON.stringify({
        event: "s13c_dns_resume_validated",
        observations: 501,
        physicalLedger: 503,
        remaining: 339,
        budget: resume.budget,
        paidCalls: 0,
      }),
    );
  },
);
