import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createBudgetLedger, parseUSDMicros } from "./budget.js";
import { observation, budget } from "./resume.js";
import { acceptedAttempt, FULL_CORPUS_HASH } from "./finalist.js";
import { ACCEPTED_SCREEN_SHA256 } from "./finalist-prep.js";
import { SCREEN_MODELS, type PlannedDecision } from "./screen.js";
import { attemptKey, type EvalAttempt } from "./eval-retry.js";

export const INTERRUPTED_FINALIST_SHA256 =
  "85AD57B21CDB306429E663D2C1E2D3B734E37F60E23FC719010DCB5D148393E0";
export const DNS_INTERRUPTED_FINALIST_SHA256 =
  "5BDE1CBB1858BDB12904BBE744EDD9788A6D733AB779F0D02BEC2959F92E6A1F";
const record = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
/** Fixed one-time owner exception; no generic retry eligibility is inferred. */
export const decodeFinalistResume = (raw: unknown, plan: readonly PlannedDecision[]) => {
  if (
    !record(raw) ||
    raw["version"] !== "s13-finalist.v1" ||
    raw["status"] !== "STOPPED" ||
    raw["corpusHash"] !== FULL_CORPUS_HASH ||
    FULL_CORPUS_HASH !== "80331fe14fcf669a2bdb639c416157e8e3f3adc87df087c2c744690451f78659" ||
    raw["acceptedScreenSha256"] !== ACCEPTED_SCREEN_SHA256 ||
    typeof raw["startedAt"] !== "string" ||
    !Number.isFinite(Date.parse(raw["startedAt"])) ||
    !Array.isArray(raw["observations"]) ||
    raw["observations"].length !== 407 ||
    !raw["observations"].every(observation) ||
    !Array.isArray(raw["attempts"]) ||
    raw["attempts"].length !== 407 ||
    !raw["attempts"].every(acceptedAttempt) ||
    !budget(raw["budget"]) ||
    raw["budget"].calls !== 408 ||
    raw["budget"].estimatedSpendUSD !== "$0.325801" ||
    !record(raw["pending"]) ||
    raw["pending"]["model"] !== "gpt-5.6-luna" ||
    raw["pending"]["caseId"] !== "s13-uz-mixed-script-26-0" ||
    raw["pending"]["attemptNumber"] !== 1 ||
    !record(raw["stop"]) ||
    raw["stop"]["reason"] !== "provider_model_mismatch" ||
    !record(raw["wireProof"]) ||
    raw["wireProof"]["fixtures"] !== 420 ||
    raw["wireProof"]["originalAndRepair"] !== 840 ||
    raw["wireProof"]["largestSerializedBytes"] !== 8407 ||
    raw["wireProof"]["inputReserve"] !== 9000 ||
    raw["wireProof"]["authenticatedCalls"] !== 0
  )
    throw new TypeError("Not the owner-approved preserved finalist checkpoint");
  createBudgetLedger(0n, raw["budget"], "finalist");
  const observations = raw["observations"],
    attempts = raw["attempts"];
  const paired = plan.flatMap((row) => SCREEN_MODELS.map((model) => ({ row, model })));
  if (
    plan.length !== 420 ||
    observations.some((row, index) => {
      const expected = paired[index],
        attempt = attempts[index];
      return (
        expected === undefined ||
        attempt === undefined ||
        row.model !== expected.model ||
        row.caseId !== expected.row.item.case_id ||
        row.phase !== "core" ||
        row.hint ||
        attemptKey(row) !== attemptKey(attempt) ||
        attempt.attemptNumber !== 1 ||
        attempt.purpose !== "initial" ||
        attempt.billableCostUSD !== row.firstCostUSD ||
        attempt.unresolvedReservationUSD !== null ||
        row.repair !== null
      );
    })
  )
    throw new TypeError("Preserved decisions not the original exact plan prefix");
  const next = paired[407];
  if (next?.model !== "gpt-5.6-luna" || next.row.item.case_id !== "s13-uz-mixed-script-26-0")
    throw new TypeError("Recovery is not the next pending decision");
  const known = attempts.reduce(
    (sum, attempt) => sum + parseUSDMicros(attempt.billableCostUSD ?? "$0.000000"),
    0n,
  );
  if (known !== 318751n || parseUSDMicros(raw["budget"].estimatedSpendUSD) - known !== 7050n)
    throw new TypeError("Historical reservation mismatch");
  const interrupted: EvalAttempt = {
    model: "gpt-5.6-luna",
    caseId: "s13-uz-mixed-script-26-0",
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
  return {
    observations,
    attempts: [...attempts, interrupted],
    budget: raw["budget"],
    startedAt: raw["startedAt"],
    ownerRecovery: "s13c-luna-mixed-script-26-0" as const,
    wireProof: {
      fixtures: 420,
      originalAndRepair: 840,
      largestSerializedBytes: 8407,
      inputReserve: 9000,
      authenticatedCalls: 0,
    },
  };
};
/** Preserve the later SHA-pinned checkpoint, including its now-classified DNS failure. */
export const decodeDNSFinalistResume = (
  raw: unknown,
  plan: readonly PlannedDecision[],
  original: ReturnType<typeof decodeFinalistResume>,
) => {
  const historical = original.attempts.at(-1);
  const dnsAttempt = (v: unknown): v is EvalAttempt =>
    record(v) &&
    acceptedAttempt({ ...v, transport: null }) &&
    v["model"] === "gpt-5.6-luna" &&
    v["caseId"] === "s13-uz-typos-phonetic-25-0" &&
    v["phase"] === "core" &&
    v["hint"] === false &&
    v["attemptNumber"] === 1 &&
    v["purpose"] === "initial" &&
    v["resultKind"] === "provider_error" &&
    v["category"] === "network" &&
    v["http"] === null &&
    v["source"] === "current" &&
    v["billableCostUSD"] === null &&
    v["unresolvedReservationUSD"] === "$0.007050" &&
    record(v["transport"]) &&
    v["transport"]["classification"] === "DNS" &&
    v["transport"]["causeCode"] === "ENOTFOUND" &&
    JSON.stringify(v["transport"]["codes"]) === '["ENOTFOUND"]' &&
    v["transport"]["signalAborted"] === false;
  const attempt = (v: unknown): v is EvalAttempt =>
    acceptedAttempt(v) ||
    (historical !== undefined && JSON.stringify(v) === JSON.stringify(historical)) ||
    dnsAttempt(v);
  if (
    !record(raw) ||
    raw["version"] !== "s13-finalist.v1" ||
    raw["status"] !== "STOPPED" ||
    raw["corpusHash"] !== FULL_CORPUS_HASH ||
    raw["acceptedScreenSha256"] !== ACCEPTED_SCREEN_SHA256 ||
    raw["startedAt"] !== original.startedAt ||
    raw["pending"] !== null ||
    JSON.stringify(raw["wireProof"]) !== JSON.stringify(original.wireProof) ||
    !Array.isArray(raw["observations"]) ||
    raw["observations"].length !== 501 ||
    !raw["observations"].every(observation) ||
    !Array.isArray(raw["attempts"]) ||
    raw["attempts"].length !== 503 ||
    !raw["attempts"].every(attempt) ||
    !budget(raw["budget"]) ||
    raw["budget"].calls !== 503 ||
    raw["budget"].estimatedSpendUSD !== "$0.413749" ||
    !record(raw["stop"]) ||
    raw["stop"]["reason"] !== "usage_unknown_or_overrun"
  )
    throw new TypeError("Not the approved preserved DNS checkpoint");
  createBudgetLedger(0n, raw["budget"], "finalist");
  const observations = raw["observations"],
    attempts = raw["attempts"];
  if (
    observations
      .slice(0, 407)
      .some((row, index) => JSON.stringify(row) !== JSON.stringify(original.observations[index])) ||
    attempts
      .slice(0, 408)
      .some((row, index) => JSON.stringify(row) !== JSON.stringify(original.attempts[index])) ||
    !dnsAttempt(attempts.at(-1))
  )
    throw new TypeError("Prior finalist evidence changed");
  const paired = plan.flatMap((row) => SCREEN_MODELS.map((model) => ({ row, model })));
  if (
    plan.length !== 420 ||
    observations.some((row, index) => {
      const expected = paired[index],
        physical = attempts[index < 407 ? index : index + 1];
      return (
        expected === undefined ||
        physical === undefined ||
        row.model !== expected.model ||
        row.caseId !== expected.row.item.case_id ||
        row.phase !== "core" ||
        row.hint ||
        row.repair !== null ||
        attemptKey(row) !== attemptKey(physical) ||
        physical.attemptNumber !== (index === 407 ? 2 : 1) ||
        physical.purpose !== (index === 407 ? "owner_resume" : "initial") ||
        physical.billableCostUSD !== row.firstCostUSD ||
        physical.unresolvedReservationUSD !== null
      );
    }) ||
    paired[501]?.model !== "gpt-5.6-luna" ||
    paired[501]?.row.item.case_id !== "s13-uz-typos-phonetic-25-0"
  )
    throw new TypeError("DNS recovery is not the exact unfinished plan suffix");
  const known = attempts.reduce(
    (sum, row) => sum + parseUSDMicros(row.billableCostUSD ?? "$0.000000"),
    0n,
  );
  const unresolved = attempts.reduce(
    (sum, row) => sum + parseUSDMicros(row.unresolvedReservationUSD ?? "$0.000000"),
    0n,
  );
  if (
    known !== 399649n ||
    unresolved !== 14100n ||
    known + unresolved !== parseUSDMicros(raw["budget"].estimatedSpendUSD)
  )
    throw new TypeError("Preserved DNS cost ledger mismatch");
  return {
    observations,
    attempts,
    budget: raw["budget"],
    startedAt: original.startedAt,
    wireProof: original.wireProof,
    ownerRecovery: null,
  };
};
const readPreservedArtifact = (path: string) => {
  const absolute = resolve(path);
  if (
    basename(absolute) !== "evidence.json" ||
    !/^s13-finalist-[a-zA-Z0-9]+$/u.test(basename(dirname(absolute))) ||
    resolve(dirname(dirname(absolute))) !== resolve(tmpdir()) ||
    statSync(absolute).size > 10000000
  )
    throw new TypeError("Unsafe finalist checkpoint path");
  const bytes = readFileSync(absolute);
  const sha256 = createHash("sha256").update(bytes).digest("hex").toUpperCase();
  const raw: unknown = JSON.parse(bytes.toString("utf8"));
  return { sha256, raw };
};
export const readFinalistResume = (path: string, plan: readonly PlannedDecision[]) => {
  const current = readPreservedArtifact(path);
  if (current.sha256 === INTERRUPTED_FINALIST_SHA256)
    return decodeFinalistResume(current.raw, plan);
  if (
    current.sha256 !== DNS_INTERRUPTED_FINALIST_SHA256 ||
    !record(current.raw) ||
    typeof current.raw["previousEvidence"] !== "string"
  )
    throw new TypeError("Preserved finalist artifact changed");
  const original = readPreservedArtifact(current.raw["previousEvidence"]);
  if (original.sha256 !== INTERRUPTED_FINALIST_SHA256)
    throw new TypeError("Original finalist artifact changed");
  return decodeDNSFinalistResume(current.raw, plan, decodeFinalistResume(original.raw, plan));
};
