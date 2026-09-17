import { mkdtempSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createBudgetLedger, parseUSDMicros } from "./budget.js";
import { usd } from "./cost.js";
import { readResumeEvidence } from "./resume.js";
import { planScreen, SCREEN_HASH } from "./screen.js";
import { historicalAttempts } from "./retry-history.js";

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) {
    unlinkSync(join(directory, "evidence.json"));
    rmdirSync(directory); // Only the exact empty synthetic fixture directory; never recursive.
  }
});
const seed = (overrides: Readonly<Record<string, unknown>> = {}) => {
  const ledger = createBudgetLedger();
  ledger.before("gemini-3.8-flash");
  try {
    ledger.after({ input: null, output: null, total: null, cachedInput: null, reasoning: null });
  } catch {
    /* expected unknown-bill reservation */
  }
  const row = planScreen()[0];
  if (row === undefined) throw new TypeError("Missing frozen fixture");
  const directory = mkdtempSync(join(tmpdir(), "s13-screen-"));
  directories.push(directory);
  const path = join(directory, "evidence.json");
  writeFileSync(
    path,
    JSON.stringify({
      status: "STOPPED",
      startedAt: "2026-09-17T09:21:31.403Z",
      budget: ledger.snapshot(),
      observations: [],
      report: { corpusHash: SCREEN_HASH },
      previousEvidence: null,
      preflight: {
        openai: 1537,
        gemini: 453,
        inputReserve: 9000,
        largestSerializedBytes: 8453,
        caseId: row.item.case_id,
      },
      stop: {
        details: {
          model: "gemini-3.8-flash",
          caseId: row.item.case_id,
          phase: row.phase,
          resultKind: "provider_error",
          category: "network",
        },
      },
      ...overrides,
    }),
  );
  return path;
};
describe("S13 preserved legacy retry history", () => {
  it.skipIf(process.env["S13_RESUME_EVIDENCE"] === undefined)(
    "proves preserved owner evidence without any provider call",
    () => {
      const path = process.env["S13_RESUME_EVIDENCE"];
      if (path === undefined) throw new TypeError("Missing diagnostic state");
      const resume = readResumeEvidence(path),
        attempts = historicalAttempts(path);
      const known = attempts.reduce(
        (sum, row) => sum + parseUSDMicros(row.billableCostUSD ?? "$0.000000"),
        0n,
      );
      const unknown = attempts.reduce(
        (sum, row) => sum + parseUSDMicros(row.unresolvedReservationUSD ?? "$0.000000"),
        0n,
      );
      expect(known + unknown + parseUSDMicros(resume.budget.preflightReservedUSD)).toBe(
        parseUSDMicros(resume.budget.estimatedSpendUSD),
      );
      expect(attempts.length).toBe(resume.budget.calls);
      expect(attempts.at(-1)?.attemptNumber).toBe(1);
      console.log(
        JSON.stringify({
          event: "offline_resume_proof",
          preserved: resume.observations.length,
          remaining: resume.remainingDecisions,
          physicalAttempts: attempts.length,
          known: usd(known),
          unresolved: usd(unknown),
          conservative: resume.budget.estimatedSpendUSD,
          maximumProjected: usd(resume.worstTotalMicros),
        }),
      );
    },
  );
  it("retains the interrupted original attempt without inventing transport/usage/latency", () => {
    expect(historicalAttempts(seed())).toMatchObject([
      {
        model: "gemini-3.8-flash",
        attemptNumber: 1,
        source: "historical",
        transport: null,
        aborted: null,
        elapsedMs: null,
        billableCostUSD: null,
        unresolvedReservationUSD: "$0.021750",
      },
    ]);
  });
  it("refuses to reset already-recorded physical attempts during a later resume", () => {
    expect(() => historicalAttempts(seed({ attempts: [] }))).toThrow("cannot reset");
  });
  it("accepts the original legacy root that predates the parent-link field", () => {
    expect(historicalAttempts(seed({ previousEvidence: undefined }))).toHaveLength(1);
  });
  it("rejects unrelated/unsafe parent files before using any state", () => {
    expect(() =>
      historicalAttempts(seed({ previousEvidence: join(tmpdir(), "unrelated-private-file") })),
    ).toThrow("Unsafe");
  });
});
