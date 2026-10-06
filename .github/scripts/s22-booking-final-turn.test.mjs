import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { collectFinalTurnEvidence, finalTurnScope } from "./s22-booking-final-turn-readonly.mjs";
import {
  finalTraceAssertions,
  formatFinalTurnReport,
  recoverFinalTurnLogs,
  sanitizeRows,
} from "./s22-booking-evidence.mjs";

const message = "01a11260-aaaa-7bbb-8ccc-111111111111";
const rowFor = (text) => {
  if (text.includes("has_table_privilege")) return [{ handler_read: false, job_read: false }];
  if (text.includes("cc.status as connection_status")) return [{ id: finalTurnScope.conversation }];
  if (text.includes("select m.id::text"))
    return [{ id: message, direction: "inbound", processing_status: "accepted" }];
  return [];
};
const collect = async (reader = rowFor) => {
  const records = [];
  await collectFinalTurnEvidence(
    async (text, extra) => reader(text, extra),
    (assertion, pass, observed) =>
      records.push({ assertion, outcome: pass ? "PASS" : "FAIL", observed }),
  );
  return records;
};

test("final-turn discovery binds exact tenant/conversation/window; no historical IDs, sensitive selects, writes or queue reads", async () => {
  let count = 0;
  const rows = await collect((text, extra) => {
    count++;
    assert.match(text.trimStart(), /^select /iu);
    assert.doesNotMatch(
      text,
      /\b(insert|delete|update|ciphertext|external_message_id|external_event_id|account_id|sender_contact_id|body_hash)\b/iu,
    );
    if (!text.includes("has_table_privilege")) {
      assert.match(text, /organization_id=\$1/);
      assert.match(text, /\$3::timestamptz/);
      assert.match(text, /\$4::timestamptz/);
      assert.deepEqual(extra, [
        finalTurnScope.conversation,
        finalTurnScope.from,
        finalTurnScope.until,
      ]);
      assert.match(text, /limit (2|3|5|9|21)$/);
    } else assert.deepEqual(extra, []);
    assert.doesNotMatch(text, /select\s+(?:\w+\.)?\*/iu);
    assert.doesNotMatch(text, /from (app\.worker_handler_executions|pgboss\.job)/iu);
    return rowFor(text);
  });
  assert.equal(count, 8);
  assert.equal(rows.length, finalTraceAssertions.size);
  assert.equal(
    rows.every((r) => r.outcome === "PASS"),
    true,
  );
  assert.equal(
    rows.find((r) => r.assertion === "final_turn_discovery").observed.message_id,
    message,
  );
  assert.equal(finalTurnScope.from, "2026-10-06T17:58:00Z");
});

for (const size of [0, 2, 9]) {
  test(`missing/ambiguous/capped inbound (${size}) never guesses a message and still collects downstream evidence`, async () => {
    const records = await collect((text) =>
      text.includes("select m.id::text")
        ? Array.from({ length: size }, () => ({ id: message, direction: "inbound" }))
        : rowFor(text),
    );
    const discovery = records.find((r) => r.assertion === "final_turn_discovery");
    assert.equal(discovery.outcome, "FAIL");
    assert.equal(discovery.observed.message_id, null);
    assert.equal(records.length, 9);
    assert.equal(records.at(-1).assertion, "final_turn_queue_access");
  });
}

test("each bounded query fails closed at its cap; NULL cost and no provider run are observations, not successful generation", async () => {
  const records = await collect((text) =>
    text.includes("has_table_privilege")
      ? rowFor(text)
      : Array.from({ length: Number(text.match(/limit (\d+)$/u)[1]) }, () => ({ id: message })),
  );
  assert.equal(
    records.slice(0, -1).every((r) => r.outcome === "FAIL"),
    true,
  );
  const projected = sanitizeRows([
    {
      jsonPayload: {
        operation: "s22_booking_readonly",
        assertion: "final_turn_runs",
        outcome: "PASS",
        observed: {
          rows: [
            {
              run_id: message,
              estimated_cost_micros: null,
              input_units: null,
              failure_category: "timeout",
              payload_jsonb: { body: "private" },
              token: "private",
            },
          ],
        },
      },
    },
  ]);
  assert.deepEqual(projected[0].observed.rows[0], {
    run_id: message,
    estimated_cost_micros: null,
    input_units: null,
    failure_category: "timeout",
  });
});

const baseAssertions = [
  "runtime_rls_and_baseline",
  "synthetic_conversation",
  "synthetic_requests",
  "synthetic_delivery_metadata",
  "deployed_cohort_binding",
  "cohort_reservation_accounting",
];
const entries = () =>
  [...baseAssertions, ...finalTraceAssertions].map((assertion) => ({
    jsonPayload: {
      operation: "s22_booking_readonly",
      assertion,
      outcome: "PASS",
      observed: { rows: [] },
    },
  }));
const execution = "lead-agent-staging-migrator-abc12";
test("owner recovery makes one exact bounded read; no HTTP retry, jobs API or raw payload output", async () => {
  let count = 0;
  const result = await recoverFinalTurnLogs(execution, "private", async (url, options) => {
    count++;
    assert.equal(url, "https://logging.googleapis.com/v2/entries:list");
    assert.equal(options.redirect, "error");
    const query = JSON.parse(options.body);
    assert.deepEqual(query.resourceNames, ["projects/lead-agent-stg-739284"]);
    assert.match(query.filter, /execution_name.*lead-agent-staging-migrator-abc12/u);
    assert.equal(query.pageSize, 30);
    assert.match(query.filter, /timestamp>=.*timestamp</u);
    return { ok: true, json: async () => ({ entries: entries() }) };
  });
  assert.equal(count, 1);
  assert.equal(result.outcome, "PASS");
  const text = formatFinalTurnReport(result);
  assert.match(text, /final turn runs: PASS/);
  assert.match(text, /No records in this exact scope/);
  assert.match(text, /not a claim of successful AI generation/);
  assert.doesNotMatch(text, /private|jsonPayload/);
});
test("recovery preserves failed assertions, rejects duplicates/truncation/missing rows and redacts secrets", async () => {
  const failure = entries();
  failure.at(-1).jsonPayload.outcome = "FAIL";
  failure.at(-1).jsonPayload.observed = {
    rows: [{ estimated_cost_micros: null, bot_token: "private" }],
  };
  for (const [payload, code] of [
    [{ entries: failure }, "LOG_ASSERTION_NOT_PASS"],
    [{ entries: entries().concat(entries()[0]) }, "LOG_ASSERTIONS_DUPLICATED"],
    [{ entries: entries(), nextPageToken: "private" }, "LOG_RESULT_TRUNCATED"],
    [{ entries: [] }, "LOG_ASSERTIONS_INCOMPLETE"],
    [{ entries: [null] }, "LOG_RESPONSE_INVALID"],
  ]) {
    const result = await recoverFinalTurnLogs(execution, "private", async () => ({
      ok: true,
      json: async () => payload,
    }));
    assert.equal(result.code, code);
    assert.doesNotMatch(JSON.stringify(result), /bot_token|private/);
  }
  const invalid = await recoverFinalTurnLogs("wrong", "private", () => {
    throw Error("MUST_NOT_AUTHENTICATE");
  });
  assert.equal(invalid.code, "EXECUTION_SCOPE_INVALID");
  for (const [status, code] of [
    [403, "EXACT_EXECUTION_LOG_PERMISSION_DENIED"],
    [401, "LOG_AUTHENTICATION_DENIED"],
    [500, "LOG_API_UNAVAILABLE"],
  ]) {
    const result = await recoverFinalTurnLogs(execution, "private", async () => ({
      ok: false,
      status,
    }));
    assert.equal(result.code, code);
  }
  const timedOut = await recoverFinalTurnLogs(execution, "private", async () => {
    throw Object.assign(Error("private"), { name: "TimeoutError" });
  });
  assert.equal(timedOut.code, "LOG_API_TIMEOUT");
});
test("plain report distinguishes unknown cost and collection from readiness; module fits execution env limit", () => {
  const report = formatFinalTurnReport({
    outcome: "BLOCKED",
    assertions: [
      {
        assertion: "final_turn_runs",
        outcome: "PASS",
        observed: { rows: [{ estimated_cost_micros: null, status: "failed" }] },
      },
    ],
  });
  assert.match(report, /estimated cost micros: unknown/);
  assert.doesNotMatch(report, /estimated cost micros: 0/);
  const source = readFileSync(new URL("./s22-booking-final-turn-readonly.mjs", import.meta.url));
  assert.equal(Buffer.byteLength(source.toString("base64")) < 32000, true);
  assert.doesNotMatch(source.toString(), /\bimport\s*(?:\(|[{"'])/u);
  const result = spawnSync(process.execPath, ["--input-type=module", "--check"], {
    input: source,
    encoding: "utf8",
    timeout: 10000,
  });
  assert.equal(result.status, 0, result.stderr);
});

test("final-turn workflow remains read-only and malformed recovery invocation cannot dispatch anything", () => {
  const workflow = readFileSync(
    new URL("../workflows/staging-terraform.yml", import.meta.url),
    "utf8",
  );
  assert.match(workflow, /- final-turn/);
  assert.match(workflow, /if: inputs\.phase == 'booking-evidence'/);
  assert.match(workflow, /inputs\.phase != 'booking-evidence'/);
  assert.match(workflow, /\[\[ "\$ACTION" == "plan" && -z "\$APPROVAL_TOKEN" \]\]/);
  for (const args of [
    ["--recover-final-turn", "wrong"],
    ["--recover-final-turn"],
    ["--recover-final-turn", execution, "extra"],
  ]) {
    const result = spawnSync(
      process.execPath,
      [fileURLToPath(new URL("./s22-booking-evidence.mjs", import.meta.url)), ...args],
      {
        env: { ...process.env, PATH: "" },
        encoding: "utf8",
        timeout: 5000,
      },
    );
    assert.equal(result.status, 1);
    assert.match(result.stdout, /EXECUTION_SCOPE_INVALID|READ_MODE_INVALID/);
    assert.doesNotMatch(result.stdout, /authentication|job_configuration_changed/);
  }
});
