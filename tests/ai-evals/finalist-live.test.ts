import { randomBytes, createHash } from "node:crypto";
import { mkdtempSync, writeFileSync, renameSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { createOpenAIProvider } from "../../packages/ai/src/providers/openai.js";
import { createGeminiProvider } from "../../packages/ai/src/providers/gemini.js";
import { createBudgetLedger, type BudgetCheckpoint } from "./budget.js";
import { runLiveScreen, ScreenStop, type LiveObservation } from "./live-runner.js";
import { diagnosticFetch, type HTTPDiagnostic } from "./http-diagnostic.js";
import { transportDiagnosticFetch, type TransportDiagnostic } from "./network-diagnostic.js";
import {
  EVAL_INSTRUCTIONS,
  LOGICAL_DEADLINE_MS,
  openAIScreenFetch,
  type ScreenModel,
} from "./screen.js";
import type { EvalAttempt } from "./eval-retry.js";
import { readFinalistResume } from "./finalist-resume.js";
import { ACCEPTED_SCREEN_SHA256, blindedReviewPacket } from "./finalist-prep.js";
import {
  readFinalistBase,
  finalistPlan,
  FULL_CORPUS_HASH,
  verifyFinalistWireBounds,
  buildFinalistReport,
  mergeFinalist,
  reviewRows,
} from "./finalist.js";

// A separate explicit opt-in. CI neither spends nor reads private artifacts.
it.skipIf(process.env["S13_LIVE_FINALIST"] !== "1")(
  "S13.C authorized 840 new decisions",
  async () => {
    const openai = process.env["OPENAI_API_KEY"],
      gemini = process.env["GEMINI_API_KEY"],
      basePath = process.env["S13_FINALIST_BASE"];
    if (!openai || !gemini || !basePath)
      throw new Error("Finalist credentials/evidence absent; zero calls");
    const base = readFinalistBase(basePath),
      plan = finalistPlan(base.rows);
    const resumePath = process.env["S13_FINALIST_RESUME"];
    const resume = resumePath === undefined ? null : readFinalistResume(resumePath, plan);
    const wireProof = resume?.wireProof ?? (await verifyFinalistWireBounds(plan));
    const directory = mkdtempSync(join(tmpdir(), "s13-finalist-")),
      artifact = join(directory, "evidence.json");
    const observations: LiveObservation[] = [...(resume?.observations ?? [])],
      attempts: EvalAttempt[] = [...(resume?.attempts ?? [])];
    const startedAt = resume?.startedAt ?? new Date().toISOString();
    let pending: Readonly<{ model: ScreenModel; caseId: string; attemptNumber: number }> | null =
      null;
    const persist = (
      status: string,
      budget: BudgetCheckpoint,
      stop: unknown = null,
      report: unknown = null,
    ) => {
      const bytes = JSON.stringify(
        {
          version: "s13-finalist.v1",
          startedAt,
          status,
          corpusHash: FULL_CORPUS_HASH,
          acceptedScreenSha256: ACCEPTED_SCREEN_SHA256,
          basePath,
          previousEvidence: resumePath ?? null,
          wireProof,
          budget,
          pending,
          stop,
          observations,
          attempts,
          report,
        },
        null,
        2,
      );
      if ([openai, gemini].some((key) => bytes.includes(key)))
        throw new ScreenStop("secret_disclosure");
      writeFileSync(`${artifact}.pending`, bytes, { encoding: "utf8", mode: 0o600 });
      renameSync(`${artifact}.pending`, artifact);
    };
    const diagnostics: Record<
      ScreenModel,
      { transport: TransportDiagnostic | null; http: HTTPDiagnostic | null }
    > = {
      "gemini-3.8-flash": { transport: null, http: null },
      "gpt-5.6-luna": { transport: null, http: null },
    };
    const request = (model: ScreenModel) =>
      diagnosticFetch(
        transportDiagnosticFetch(fetch, (value) => {
          diagnostics[model].transport = value;
        }),
        (value) => {
          diagnostics[model].http = value;
        },
      );
    const providers = {
      "gpt-5.6-luna": createOpenAIProvider(
        { apiKey: openai, model: "gpt-5.6-luna", requestTimeoutMs: LOGICAL_DEADLINE_MS },
        { fetch: openAIScreenFetch(request("gpt-5.6-luna")), clock: () => performance.now() },
      ),
      "gemini-3.8-flash": createGeminiProvider(
        { apiKey: gemini, model: "gemini-3.8-flash", requestTimeoutMs: LOGICAL_DEADLINE_MS },
        {
          fetch: request("gemini-3.8-flash"),
          instructions: EVAL_INSTRUCTIONS,
          thinkingLevel: "low",
          clock: () => performance.now(),
        },
      ),
    };
    persist("READY", resume?.budget ?? createBudgetLedger(0n, undefined, "finalist").snapshot());
    console.log(
      JSON.stringify({
        event: "s13c_start",
        newDecisions: 840 - observations.length,
        preservedS13C: observations.length,
        preservedCore: 280,
        targetUSD: "$2.000000",
        hardCapUSD: "$5.000000",
        artifact,
        wireProof,
      }),
    );
    const result = await runLiveScreen(
      providers,
      (row, budget) => {
        observations.push(row);
        persist("RUNNING", budget);
        console.log(
          JSON.stringify({
            event: "s13c_progress",
            completed: observations.length,
            model: row.model,
            caseId: row.caseId,
            firstSchema: row.first.schema,
            afterSchema: row.final.schema,
            latencyMs: row.logicalLatencyMs,
            conservativeSpendUSD: budget.estimatedSpendUSD,
          }),
        );
      },
      {
        plan,
        budgetPhase: "finalist",
        secretValues: [openai, gemini],
        ...(resume === null
          ? {}
          : {
              initialObservations: resume.observations,
              carryBudget: resume.budget,
              initialAttempts: resume.attempts,
              ...(resume.ownerRecovery === null ? {} : { ownerRecovery: resume.ownerRecovery }),
            }),
        retry: {
          resetDiagnostics: (model) => {
            diagnostics[model] = { transport: null, http: null };
          },
          diagnostics: (model) => diagnostics[model],
        },
        onReserved: (model, row, attemptNumber, budget) => {
          pending = { model, caseId: row.item.case_id, attemptNumber };
          persist("RUNNING", budget);
        },
        onAttempt: (attempt, budget) => {
          attempts.push(attempt);
          pending = null;
          persist("RUNNING", budget);
          if (attempt.resultKind === "provider_error" || attempt.resultKind === "timeout")
            console.log(
              JSON.stringify({
                event: "s13c_operational_failure",
                model: attempt.model,
                caseId: attempt.caseId,
                attemptNumber: attempt.attemptNumber,
                category: attempt.category,
                http: attempt.http,
                transport: attempt.transport,
                conservativeSpendUSD: budget.estimatedSpendUSD,
              }),
            );
        },
        onStop: (error, budget) => {
          const stoppedModel =
            error instanceof ScreenStop ? (error.details?.model ?? pending?.model) : pending?.model;
          const stop =
            error instanceof ScreenStop
              ? {
                  reason: error.reason,
                  details: error.details ?? null,
                  diagnostics: stoppedModel === undefined ? null : diagnostics[stoppedModel],
                }
              : { reason: "unexpected_runner_failure" };
          persist("STOPPED", budget, stop);
          console.log(JSON.stringify({ event: "s13c_stopped", stop, budget, artifact }));
        },
      },
    );
    expect(result.observations).toHaveLength(840);
    const report = buildFinalistReport(base, observations, attempts, result.budget);
    const full = mergeFinalist(base.observations, observations);
    const review = blindedReviewPacket(reviewRows(full), randomBytes(32).toString("hex"), "full");
    const packetPath = join(directory, "reviewer-packet.md");
    if (/gemini|gpt-5\.6|luna|openai|google/i.test(review.packet))
      throw new Error("Reviewer packet identity leak; retain evidence for curator");
    writeFileSync(packetPath, review.packet, { mode: 0o600 });
    writeFileSync(
      join(directory, "curator-unblinding.json"),
      JSON.stringify(
        {
          corpusHash: FULL_CORPUS_HASH,
          acceptedScreenSha256: ACCEPTED_SCREEN_SHA256,
          privateSeed: review.privateSeed,
          mapping: review.curator,
          nativeReview: "PENDING",
          instruction: "DO NOT OPEN/SHARE UNTIL HUMAN RATINGS ARE SEALED",
        },
        null,
        2,
      ),
      { mode: 0o600 },
    );
    persist("COMPLETE", result.budget, null, report);
    console.log(
      JSON.stringify({
        event: "s13c_complete",
        observations: observations.length,
        budget: result.budget,
        artifact,
        artifactSha256: createHash("sha256")
          .update(JSON.stringify({ observations, attempts }))
          .digest("hex"),
        packetPath,
        nativeReview: "PENDING",
      }),
    );
  },
  3 * 60 * 60 * 1000,
);
