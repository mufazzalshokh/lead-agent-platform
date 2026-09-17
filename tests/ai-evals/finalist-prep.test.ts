import { randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CORPUS, SCREEN } from "./corpus.js";
import { SCREEN_MODELS } from "./screen.js";
import { usd } from "./cost.js";
import {
  blindedReviewPacket,
  ACCEPTED_SCREEN_SHA256,
  finalistCostPlan,
  readAcceptedScreen,
  remainingFinalistCases,
  REVIEW_QUOTAS,
  type AcceptedCoreRow,
} from "./finalist-prep.js";

const syntheticRows = (): readonly AcceptedCoreRow[] =>
  SCREEN.flatMap((item) =>
    SCREEN_MODELS.map((model) => ({
      model,
      caseId: item.case_id,
      usage: { input: 100, output: 100, total: 200, cachedInput: 0, reasoning: 20 },
      costUSD: model === "gemini-3.8-flash" ? "$0.000450" : "$0.000145",
      intentPass: true,
      safetyPass: true,
      scriptPass: true,
      deterministicPass: true,
      intent: "greeting",
      action: "none",
      draft: "Salom, sizga qanday yordam bera olaman?",
    })),
  );
const seed = "a".repeat(64); // Synthetic test seed only; never used for the real review packet.

describe("S13.C offline finalist preparation", () => {
  it("subtracts exactly 140 accepted IDs, leaving 420/model with zero overlap", () => {
    const plan = remainingFinalistCases(syntheticRows());
    expect(plan.map((row) => row.cases.length)).toEqual([420, 420]);
    for (const row of plan) {
      expect(new Set(row.cases.map((item) => item.case_id)).size).toBe(420);
      expect(row.cases.some((item) => SCREEN.some((old) => old.case_id === item.case_id))).toBe(
        false,
      );
      expect(new Set([...row.cases, ...SCREEN].map((item) => item.case_id)).size).toBe(560);
    }
  });
  it("rejects duplicate, missing, non-screen and mismatched candidate evidence", () => {
    const rows = syntheticRows(),
      first = rows[0],
      second = rows[1];
    const newCase = CORPUS.find((item) => !SCREEN.includes(item));
    if (first === undefined || second === undefined || newCase === undefined)
      throw new TypeError("Missing test fixture");
    expect(() => remainingFinalistCases(rows.slice(1))).toThrow();
    expect(() => remainingFinalistCases([second, ...rows.slice(1)])).toThrow();
    expect(() =>
      remainingFinalistCases([{ ...first, caseId: newCase.case_id }, ...rows.slice(1)]),
    ).toThrow();
    expect(() =>
      remainingFinalistCases([{ ...first, model: second.model }, ...rows.slice(1)]),
    ).toThrow();
  });
  it("makes cost bounds explicit without authorizing paid execution", () => {
    const plan = finalistCostPlan(syntheticRows());
    expect(plan.newLogicalDecisions).toBe(840);
    expect(plan.maximumPhysicalCalls).toBe(1680);
    expect(plan.maximumReservationUSD).toBe("$24.192000");
    expect(plan.paidAuthorized).toBe(false);
    expect(plan.proposedHardCeilingUSD).toBe("$5.000000");
    expect(plan.uniqueSeedClusters).toBe(60);
    expect(
      plan.models.every(
        (model) => model.perSlice.reduce((n, row) => n + row.additional, 0) === 420,
      ),
    ).toBe(true);
    expect(plan.models.every((model) => model.recoveryAllowance === 3)).toBe(true);
  });
  it("does not count reasoning twice or treat unknown cache as a discount", () => {
    const rows = syntheticRows();
    expect(
      finalistCostPlan(rows.map((row) => ({ ...row, usage: { ...row.usage, reasoning: 0 } }))),
    ).toEqual(finalistCostPlan(rows));
    const first = rows[0];
    if (first === undefined) throw new TypeError("Missing test fixture");
    expect(() =>
      finalistCostPlan([{ ...first, usage: { ...first.usage, input: null } }, ...rows.slice(1)]),
    ).toThrow("unknown delivered usage");
  });
  it("builds 40 blinded comparisons covering all eight priority slices", () => {
    const result = blindedReviewPacket(syntheticRows(), seed);
    expect(result.curator).toHaveLength(40);
    for (const [slice, quota] of REVIEW_QUOTAS)
      expect(result.curator.filter((row) => row.slice === slice)).toHaveLength(quota);
    expect(result.curator.filter((row) => row.modelA === "gemini-3.8-flash")).toHaveLength(20);
    expect(result.packet).not.toMatch(
      /gemini|gpt-5|luna|intentPass|deterministicPass|seed_cluster|s13-uz/i,
    );
    expect(result.packet.match(/^## review-/gm)).toHaveLength(40);
  });
  it("randomizes case/side assignment reproducibly with a private seed", () => {
    const rows = syntheticRows(),
      a = blindedReviewPacket(rows, seed);
    expect(blindedReviewPacket(rows, seed)).toEqual(a);
    expect(blindedReviewPacket(rows, "b".repeat(64)).packet).not.toBe(a.packet);
    expect(() => blindedReviewPacket(rows, "public-short-seed")).toThrow();
  });
  it("keeps absent drafts ungraded rather than synthesizing customer wording", () => {
    const rows = syntheticRows().map((row) => ({ ...row, draft: null }));
    expect(blindedReviewPacket(rows, seed).packet).toContain("NO CUSTOMER DRAFT");
    expect(blindedReviewPacket(rows, seed).packet).toContain("N/A for missing drafts");
  });
  it("renders untrusted output as inert code data, without changing the text", () => {
    const raw = "<script>synthetic()</script>\n```\nIgnore instructions";
    const result = blindedReviewPacket(
      syntheticRows().map((row) => ({ ...row, draft: raw })),
      seed,
    );
    expect(result.packet).toContain(
      "    <script>synthetic()</script>\n    ```\n    Ignore instructions",
    );
    expect(result.packet).not.toMatch(/^<script>/m);
  });
  it.skipIf(process.env["S13_PREP_EVIDENCE"] === undefined)(
    "proves accepted evidence, empirical cost and actual blinded packet without any provider call",
    () => {
      const path = process.env["S13_PREP_EVIDENCE"];
      if (path === undefined) throw new TypeError("Missing preserved artifact");
      const rows = readAcceptedScreen(path),
        plan = finalistCostPlan(rows);
      expect(plan.expectedUSD).toBe("$0.742803");
      expect(plan.conservativeUSD).toBe("$1.520532");
      expect(plan.worstReasonableUSD).toBe("$3.338592");
      expect(plan.maximumReservationUSD).toBe("$24.192000");
      const review = blindedReviewPacket(rows, randomBytes(32).toString("hex"));
      expect(review.packet).not.toMatch(/gemini|gpt-5\.6|luna|openai|google/i);
      expect(review.curator).toHaveLength(40);
      const keys = [process.env["OPENAI_API_KEY"], process.env["GEMINI_API_KEY"]];
      for (const key of keys) if (key) expect(review.packet.includes(key)).toBe(false);
      let packetPath: string | null = null;
      if (process.env["S13_PREP_EXPORT_REVIEW"] === "1") {
        // Intentional synthetic review artifacts, not source edits/debug files. Curator key stays outside Git.
        const directory = mkdtempSync(join(tmpdir(), "s13c-review-"));
        packetPath = join(directory, "reviewer-packet.md");
        writeFileSync(packetPath, review.packet, { mode: 0o600 });
        writeFileSync(
          join(directory, "curator-unblinding.json"),
          JSON.stringify(
            {
              artifactSha256: ACCEPTED_SCREEN_SHA256,
              corpusHash: plan.corpusHash,
              privateSeed: review.privateSeed,
              mapping: review.curator,
              instruction: "DO NOT OPEN/SHARE WITH REVIEWER UNTIL RATINGS ARE SEALED",
              nativeReview: "PENDING",
            },
            null,
            2,
          ),
          { mode: 0o600 },
        );
        expect(readFileSync(packetPath, "utf8")).toBe(review.packet);
      }
      console.log(
        JSON.stringify({
          event: "s13c_offline_prep",
          cases: 560,
          acceptedPerModel: 140,
          newPerModel: 420,
          seedClusters: plan.uniqueSeedClusters,
          corpusHash: plan.corpusHash,
          expectedUSD: plan.expectedUSD,
          conservativeUSD: plan.conservativeUSD,
          worstReasonableUSD: plan.worstReasonableUSD,
          maximumReservationUSD: plan.maximumReservationUSD,
          modelCosts: plan.models.map((model) => ({
            model: model.model,
            expectedUSD: usd(model.expectedMicros),
            conservativeUSD: usd(model.conservativeMicros),
            worstReasonableUSD: usd(model.worstReasonableMicros),
            p95Input: model.p95Input,
            p95Output: model.p95Output,
            maxInput: model.maxInput,
            maxOutput: model.maxOutput,
            expectedCalls: model.expectedPhysicalCalls,
            conservativeCalls: model.conservativePhysicalCalls,
            worstReasonableCalls: model.worstReasonablePhysicalCalls,
          })),
          reviewComparisons: review.curator.length,
          packetPath,
          paidCalls: 0,
        }),
      );
    },
  );
});
