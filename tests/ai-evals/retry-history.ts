import { readFileSync, statSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { decodeResumeEvidence } from "./resume.js";
import { planScreen, SCREEN_MODELS } from "./screen.js";
import { reservePerCall } from "./budget.js";
import { usd } from "./cost.js";
import type { EvalAttempt } from "./eval-retry.js";

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const unknownUsage = { input: null, output: null, total: null, cachedInput: null, reasoning: null };

/** Reconstruct only the accepted legacy checkpoints. Never infer missing latency/abort/usage. */
export const historicalAttempts = (path: string): readonly EvalAttempt[] => {
  const failures = new Map<string, EvalAttempt>();
  let current: string | null = path;
  let latest: ReturnType<typeof decodeResumeEvidence> | undefined;
  const seen = new Set<string>();
  const paired = planScreen().flatMap((row) => SCREEN_MODELS.map((model) => ({ row, model })));
  while (current !== null) {
    const absolute = resolve(current);
    if (
      seen.size >= 8 ||
      seen.has(absolute) ||
      basename(absolute) !== "evidence.json" ||
      !/^s13-screen-[a-zA-Z0-9]+$/u.test(basename(dirname(absolute))) ||
      resolve(dirname(dirname(absolute))) !== resolve(tmpdir()) ||
      statSync(absolute).size > 10000000
    )
      throw new TypeError("Unsafe legacy evidence chain");
    seen.add(absolute);
    const raw: unknown = JSON.parse(readFileSync(absolute, "utf8"));
    if (!record(raw) || raw["attempts"] !== undefined)
      throw new TypeError(
        "Legacy reconstruction cannot reset an existing operational attempt ledger",
      );
    const decoded = decodeResumeEvidence(raw);
    latest ??= decoded;
    if (
      decoded.observations.some(
        (row, index) => JSON.stringify(row) !== JSON.stringify(latest?.observations[index]),
      )
    )
      throw new TypeError("Legacy observations changed across the evidence chain");
    const pending = paired[decoded.observations.length];
    const stop: unknown = raw["stop"];
    if (pending === undefined || !record(stop) || !record(stop["details"]))
      throw new TypeError("Missing interrupted legacy decision");
    const details = stop["details"];
    if (
      details["model"] !== pending.model ||
      details["caseId"] !== pending.row.item.case_id ||
      details["phase"] !== pending.row.phase ||
      details["resultKind"] !== "provider_error" ||
      !["network", "rate_limit"].includes(String(details["category"]))
    )
      throw new TypeError("Unexpected legacy interruption");
    const key = `${pending.model}:${pending.row.phase}:${pending.row.item.case_id}`;
    if (failures.has(key)) throw new TypeError("Legacy decision already used its second attempt");
    failures.set(key, {
      model: pending.model,
      caseId: pending.row.item.case_id,
      phase: pending.row.phase,
      hint: pending.row.hint,
      attemptNumber: 1,
      purpose: "initial",
      resultKind: "provider_error",
      category: details["category"] === "network" ? "network" : "rate_limit",
      transport: null,
      http:
        details["category"] === "rate_limit" ? { status: 429, code: null, category: null } : null,
      aborted: null,
      elapsedMs: null,
      backoffMs: 0,
      retrySucceeded: null,
      usage: unknownUsage,
      billableCostUSD: null,
      unresolvedReservationUSD: usd(reservePerCall(pending.model)),
      source: "historical",
    });
    const previous: unknown = raw["previousEvidence"] ?? null;
    if (previous !== null && typeof previous !== "string")
      throw new TypeError("Invalid legacy parent");
    current = previous;
  }
  if (latest === undefined) throw new TypeError("Empty evidence history");
  const attempts: EvalAttempt[] = [];
  for (const observation of latest.observations) {
    const failed = failures.get(`${observation.model}:${observation.phase}:${observation.caseId}`);
    if (failed !== undefined) attempts.push(failed);
    if (failed !== undefined && observation.repair !== null)
      throw new TypeError("Legacy physical limit exceeded");
    for (const [index, score] of [
      observation.first,
      ...(observation.repair === null ? [] : [observation.repair]),
    ].entries()) {
      attempts.push({
        model: observation.model,
        caseId: observation.caseId,
        phase: observation.phase,
        hint: observation.hint,
        attemptNumber: failed !== undefined || index === 1 ? 2 : 1,
        purpose: failed !== undefined ? "owner_resume" : index === 1 ? "schema_repair" : "initial",
        resultKind: score.resultKind,
        category: null,
        transport: null,
        http: null,
        aborted: null,
        elapsedMs: score.providerMetadata.latencyMs,
        backoffMs: failed === undefined ? 0 : null,
        retrySucceeded:
          failed === undefined ? null : !["provider_error", "timeout"].includes(score.resultKind),
        usage: score.providerMetadata.usage,
        billableCostUSD: index === 0 ? observation.firstCostUSD : observation.repairCostUSD,
        unresolvedReservationUSD: null,
        source: "historical",
      });
    }
  }
  const pending = paired[latest.observations.length];
  const interrupted =
    pending === undefined
      ? undefined
      : failures.get(`${pending.model}:${pending.row.phase}:${pending.row.item.case_id}`);
  if (interrupted === undefined || interrupted.category !== "network")
    throw new TypeError("Owner-authorized pending network decision missing");
  attempts.push(interrupted);
  if (attempts.length !== latest.budget.calls)
    throw new TypeError("Historical attempt accounting mismatch");
  return attempts;
};
