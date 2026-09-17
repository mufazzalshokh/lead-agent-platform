import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { createOpenAIProvider } from "../../packages/ai/src/providers/openai.js";
import { createGeminiProvider } from "../../packages/ai/src/providers/gemini.js";
import { buildLiveReport } from "./live-report.js";
import { runLiveScreen, ScreenStop, type LiveObservation } from "./live-runner.js";
import { preflightInputCounts } from "./live-preflight.js";
import {
  EVAL_INSTRUCTIONS,
  LOGICAL_DEADLINE_MS,
  openAIScreenFetch,
  planScreen,
  SCREEN_HASH,
  type ScreenModel,
} from "./screen.js";
import { screenProjection } from "./budget.js";
import { usd } from "./cost.js";
import { readResumeEvidence } from "./resume.js";
import { diagnosticFetch, type HTTPDiagnostic } from "./http-diagnostic.js";
import { transportDiagnosticFetch, type TransportDiagnostic } from "./network-diagnostic.js";
import { historicalAttempts } from "./retry-history.js";
import type { EvalAttempt } from "./eval-retry.js";

// Default CI is fully offline. A single explicit opt-in spends owner-authorized evaluation budget.
it.skipIf(process.env["S13_LIVE_SCREEN"] !== "1")(
  "S13.B bounded paid two-model screen",
  async () => {
    const openai = process.env["OPENAI_API_KEY"],
      gemini = process.env["GEMINI_API_KEY"];
    if (!openai || !gemini) throw new Error("Evaluation credentials missing; no generation");
    const resumePath = process.env["S13_RESUME_EVIDENCE"];
    const resume = resumePath === undefined ? null : readResumeEvidence(resumePath);
    const attempts: EvalAttempt[] =
      resumePath === undefined ? [] : [...historicalAttempts(resumePath)];
    const directory = mkdtempSync(join(tmpdir(), "s13-screen-"));
    const artifact = join(directory, "evidence.json");
    const observations: LiveObservation[] = [...(resume?.observations ?? [])];
    const startedAt = resume?.startedAt ?? new Date().toISOString(),
      projection = screenProjection(planScreen().length);
    const preflight = resume?.preflight ?? (await preflightInputCounts({ openai, gemini }));
    let httpDiagnostic: HTTPDiagnostic | null = null;
    let transportDiagnostic: Readonly<{ model: string; failure: TransportDiagnostic }> | null =
      null;
    const diagnostics: Record<
      ScreenModel,
      { transport: TransportDiagnostic | null; http: HTTPDiagnostic | null }
    > = {
      "gemini-3.8-flash": { transport: null, http: null },
      "gpt-5.6-luna": { transport: null, http: null },
    };
    console.log(
      JSON.stringify({
        event: resume === null ? "preflight" : "resume",
        preservedDecisions: observations.length,
        carryBudget: resume?.budget ?? null,
        remainingDecisions: resume?.remainingDecisions ?? 310,
        worstTotalUSD: resume === null ? "$8.938000" : usd(resume.worstTotalMicros),
        preflight,
        projection,
        preflightReserveUSD: "$0.010000",
        artifact,
        corpusHash: SCREEN_HASH,
      }),
    );
    const persist = (status: string, budget: unknown, stop: unknown = null) =>
      writeFileSync(
        artifact,
        JSON.stringify(
          {
            startedAt,
            status,
            preflight,
            projection,
            budget,
            stop,
            previousEvidence: resumePath ?? null,
            observations,
            attempts,
            report: buildLiveReport(observations, attempts),
          },
          null,
          2,
        ),
        { encoding: "utf8", mode: 0o600 },
      );
    const providers = {
      "gpt-5.6-luna": createOpenAIProvider(
        { apiKey: openai, model: "gpt-5.6-luna", requestTimeoutMs: LOGICAL_DEADLINE_MS },
        {
          fetch: openAIScreenFetch(
            diagnosticFetch(
              transportDiagnosticFetch(fetch, (failure) => {
                transportDiagnostic = { model: "gpt-5.6-luna", failure };
                diagnostics["gpt-5.6-luna"].transport = failure;
              }),
              (value) => {
                httpDiagnostic = value;
                diagnostics["gpt-5.6-luna"].http = value;
              },
            ),
          ),
          clock: () => performance.now(),
        },
      ),
      "gemini-3.8-flash": createGeminiProvider(
        { apiKey: gemini, model: "gemini-3.8-flash", requestTimeoutMs: LOGICAL_DEADLINE_MS },
        {
          instructions: EVAL_INSTRUCTIONS,
          thinkingLevel: "low",
          clock: () => performance.now(),
          fetch: diagnosticFetch(
            transportDiagnosticFetch(fetch, (failure) => {
              transportDiagnostic = { model: "gemini-3.8-flash", failure };
              diagnostics["gemini-3.8-flash"].transport = failure;
            }),
            (value) => {
              httpDiagnostic = value;
              diagnostics["gemini-3.8-flash"].http = value;
            },
          ),
        },
      ),
    };
    const result = await runLiveScreen(
      providers,
      (row, budget) => {
        observations.push(row);
        persist("RUNNING", budget);
        console.log(
          JSON.stringify({
            event: "progress",
            completed: observations.length,
            model: row.model,
            phase: row.phase,
            caseId: row.caseId,
            firstSchema: row.first.schema,
            afterSchema: row.final.schema,
            latencyMs: row.logicalLatencyMs,
            estimatedSpendUSD: budget.estimatedSpendUSD,
          }),
        );
      },
      {
        secretValues: [openai, gemini],
        preflightReserveMicros: 10000n,
        initialAttempts: attempts,
        retry: {
          resetDiagnostics: (model) => {
            diagnostics[model] = { transport: null, http: null };
            httpDiagnostic = null;
            transportDiagnostic = null;
          },
          diagnostics: (model) => diagnostics[model],
        },
        onAttempt: (attempt, budget) => {
          attempts.push(attempt);
          persist("RUNNING", budget);
          console.log(JSON.stringify({ event: "physical_attempt", attempt, budget }));
        },
        ...(resume === null
          ? {}
          : { initialObservations: resume.observations, carryBudget: resume.budget }),
        onStop: (error, budget) => {
          const stop =
            error instanceof ScreenStop
              ? {
                  reason: error.reason,
                  details: error.details ?? null,
                  httpDiagnostic,
                  transportDiagnostic,
                }
              : { reason: "unexpected_runner_failure" };
          persist("STOPPED", budget, stop);
          console.log(JSON.stringify({ event: "stopped", stop, budget, artifact }));
        },
      },
    );
    expect(result.observations).toHaveLength(310);
    persist("COMPLETE", result.budget);
    console.log(JSON.stringify({ event: "complete", budget: result.budget, artifact }));
  },
  60 * 60 * 1000,
);
