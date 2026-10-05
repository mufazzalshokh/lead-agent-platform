import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import test from "node:test";
import { collectFirstTurnEvidence, firstTurnScope } from "./s22-booking-first-turn-readonly.mjs";
import { logReadFailureCode, moduleBootstrap, sanitizeRows } from "./s22-booking-evidence.mjs";

test("first-turn read binds exact tenant resources, correlation and window without sensitive selects or queue access", async () => {
  const calls = [],
    records = [];
  await collectFirstTurnEvidence(
    async (text, extra) => {
      calls.push({ text, values: [firstTurnScope.organization, ...extra] });
      assert.match(text.trimStart(), /^select /iu);
      assert.doesNotMatch(
        text,
        /\b(insert|update|delete|for update|ciphertext|body_hash|external_message_id|external_event_id|sender_contact_id|output_snapshot|input_snapshot)\b/iu,
      );
      if (text.includes("has_table_privilege")) return [{ handler_read: false, job_read: false }];
      assert.match(text, /organization_id=\$1/);
      assert.match(text, /correlation_id=\$4/);
      assert.match(text, /\$5::timestamptz/);
      assert.match(text, /\$6::timestamptz/);
      assert.match(text, /limit (3|5|9|21)$/);
      assert.deepEqual(extra.slice(0, 5), [
        firstTurnScope.conversation,
        firstTurnScope.message,
        firstTurnScope.correlation,
        firstTurnScope.from,
        firstTurnScope.until,
      ]);
      return [{ id: "synthetic", status: "policy_denied" }];
    },
    (assertion, pass, observed) => records.push({ assertion, pass, observed }),
  );
  assert.equal(calls.length, 6);
  assert.equal(records.length, 6);
  assert.equal(
    records.every((r) => r.pass && r.observed.collection_only),
    true,
  );
  assert.equal(records.at(-1).observed.rows[0].handler_read, false);
  assert.match(records.at(-1).observed.queue_record_proof, /NOT_COLLECTED/);
  // Catalog privilege inspection must not touch private job/handler records.
  assert.equal(
    calls.some((c) => /from (app\.worker_handler_executions|pgboss\.job)/iu.test(c.text)),
    false,
  );
});

test("first-turn missing run and every row-cap overflow fail collection without discarding other reads", async () => {
  const records = [];
  await collectFirstTurnEvidence(
    async (text) => {
      if (text.includes("has_table_privilege")) return [{ handler_read: false, job_read: false }];
      if (text.includes("from ai_runs where")) return [];
      const maximum = Number(text.match(/limit (\d+)$/u)[1]);
      return Array.from({ length: maximum }, () => ({ id: "synthetic" }));
    },
    (name, pass) => records.push({ name, pass }),
  );
  assert.equal(records.length, 6);
  assert.equal(
    records.slice(0, 5).every((r) => r.pass === false),
    true,
  );
  assert.equal(records.at(-1).pass, true);
});

test("first-turn outcome projection keeps run/action/failure and NULL-cost metadata, never ciphertext or payloads", () => {
  const projected = sanitizeRows([
    {
      jsonPayload: {
        operation: "s22_booking_readonly",
        assertion: "first_turn_actions",
        outcome: "PASS",
        observed: {
          collection_only: true,
          rows: [
            {
              action_name: "none",
              validation_status: "denied",
              policy_reason_code: "policy_denied",
              application_status: "not_applied",
              estimated_cost_micros: null,
              arguments_ciphertext: "secret",
              payload_jsonb: { body: "private" },
            },
          ],
        },
      },
    },
  ]);
  assert.deepEqual(projected[0].observed.rows[0], {
    action_name: "none",
    validation_status: "denied",
    policy_reason_code: "policy_denied",
    application_status: "not_applied",
    estimated_cost_micros: null,
  });
});

test("log permission failure is distinct and raw credential-bearing stderr never becomes a failure code", () => {
  assert.equal(
    logReadFailureCode({ stderr: "PERMISSION_DENIED credential=private" }),
    "EXACT_EXECUTION_LOG_PERMISSION_DENIED",
  );
  assert.equal(
    logReadFailureCode({ stderr: "network unavailable credential=private" }),
    "EXACT_EXECUTION_LOG_READ_BLOCKED",
  );
  assert.equal(logReadFailureCode({}), "EXACT_EXECUTION_LOG_READ_BLOCKED");
});

test("main reader remains an ES module; self-contained trace module resolves and executes in a subprocess without DB/provider access", () => {
  const helper = readFileSync(
    new URL("./s22-booking-first-turn-readonly.mjs", import.meta.url),
    "utf8",
  );
  const base = readFileSync(
    new URL("./s22-booking-evidence-readonly.mjs", import.meta.url),
    "utf8",
  );
  const syntax = spawnSync(process.execPath, ["--input-type=module", "--check"], {
    input: base,
    encoding: "utf8",
    timeout: 10000,
  });
  assert.equal(syntax.status, 0, syntax.stderr);
  assert.doesNotMatch(helper, /\bimport\s*(?:\(|[{"'])/u);
  const exercise = `const {firstTurnScope,collectFirstTurnEvidence}=await import('data:text/javascript;base64,'+process.env.S22_BOOKING_TRACE_B64);
  let count=0;await collectFirstTurnEvidence(async(text,extra)=>{
    if(!text.trimStart().startsWith('select '))throw Error('WRITE_ATTEMPT');
    if(text.includes('has_table_privilege'))return[{handler_read:false,job_read:false}];
    if(extra[1]!==firstTurnScope.message||extra[2]!==firstTurnScope.correlation)throw Error('SCOPE_FAILED');
    return[{status:'failed',failure_category:'provider_unavailable'}];
  },(name,pass,observed)=>{if(!pass||observed.collection_only!==true)throw Error('READ_FAILED');count++;});
  if(count!==6)throw Error('INCOMPLETE');console.log('FIRST_TURN_MODULE_PASS');`;
  const execution = spawnSync(process.execPath, ["--input-type=module"], {
    input: exercise,
    env: { ...process.env, S22_BOOKING_TRACE_B64: Buffer.from(helper).toString("base64") },
    encoding: "utf8",
    timeout: 10000,
  });
  assert.equal(execution.status, 0, execution.stderr);
  assert.match(execution.stdout, /FIRST_TURN_MODULE_PASS/);
  assert.equal(Buffer.byteLength(Buffer.from(base).toString("base64")) < 32000, true);
  assert.equal(Buffer.byteLength(Buffer.from(helper).toString("base64")) < 32000, true);
});

test("exact bootstrap executes the complete first-turn reader with controlled package/relative modules, rollback and cleanup", () => {
  const fixture = mkdtempSync(join(tmpdir(), "s22-first-turn-bootstrap-"));
  const packages = join(fixture, "node_modules", "@lead-agent");
  const historical = [
    "01a1067f-dfc8-7e14-9e12-89a0e30fd27e",
    "01a10af4-5126-7ce8-ab52-0424e07ab3d9",
  ];
  const cohort = {
    profile: "s22-synthetic-booking.v1",
    organizationId: firstTurnScope.organization,
    conversationId: firstTurnScope.conversation,
    historicalReserveMicros: "1033396",
    hardCeilingMicros: "10000000",
    maximumCalls: 6,
    maximumMessages: 3,
    maximumCallsPerMessage: 2,
    inputTokenLimit: 1048576,
    outputTokenLimit: 4000,
  };
  for (const name of ["config", "database"]) {
    mkdirSync(join(packages, name), { recursive: true });
    writeFileSync(
      join(packages, name, "package.json"),
      JSON.stringify({
        name: `@lead-agent/${name}`,
        type: "module",
        exports: "./index.js",
      }),
    );
  }
  writeFileSync(
    join(packages, "config", "index.js"),
    `
    export const S22_BOOKING_COHORT={historicalRunIds:${JSON.stringify(historical)}};
    export const withLibpqCompatibleRequireSsl=v=>v;
    export const createTenantDatabaseRuntimeConfig=v=>v;
    export const loadAIJourneyCohortConfig=()=>{const v=${JSON.stringify(cohort)};
      v.historicalReserveMicros=BigInt(v.historicalReserveMicros);v.hardCeilingMicros=BigInt(v.hardCeilingMicros);return v;};
  `,
  );
  writeFileSync(
    join(packages, "database", "index.js"),
    `
    export const createTenantDatabaseRuntime=()=>({verifyReady:async()=>{},
      withTenantTransaction:async(org,fn)=>{if(org!==${JSON.stringify(firstTurnScope.organization)})throw Error('WRONG_TENANT');
        try{await fn({organizationId:org});throw Error('COMMIT_NOT_ALLOWED');}
        catch(e){if(e.message!=='EXPECTED_READ_ONLY_ROLLBACK')throw e;console.log('FIXTURE_ROLLBACK');throw e;}},
      close:async()=>console.log('FIXTURE_RUNTIME_CLOSED')});
    export const createAIJourneyBudgetGuard=runtime=>({read:async org=>{
      await runtime.withTenantTransaction(org,async()=>{});
      return {physicalCalls:1,logicalMessages:1,knownCostMicros:'1950',unresolvedReserveMicros:'0',
        historicalReserveMicros:'1033396',combinedExposureMicros:'1035346',perCallReserveMicros:'801432',
        blocked:false,accountingComplete:false};}});
  `,
  );
  mkdirSync(join(packages, "database", "runtime"));
  writeFileSync(
    join(packages, "database", "runtime", "tenant.js"),
    `
    export const executeTenantQuery=async(session,build)=>{const q=build(session.organizationId), t=q.text;
      if(q.values[0]!==${JSON.stringify(firstTurnScope.organization)}||!t.trimStart().startsWith('select '))throw Error('UNSAFE_QUERY');
      let rows;
      if(t.includes("current_user='lead_agent_runtime'"))rows=[{runtime:true,staging_database:true,least_privilege:true,read_only:true,row_security:true,tenant_matches:true}];
      else if(t.includes('pg_catalog.pg_class'))rows=[{count:7,safe:true}];
      else if(t.includes('as cost_unknown'))rows=${JSON.stringify(historical.map((run_id) => ({ run_id, cost_unknown: true, finished: true })))};
      else if(t.includes('status,version,automation_mode'))rows=[{id:${JSON.stringify(firstTurnScope.conversation)},status:'open',version:'13',automation_mode:'ai',no_active_handoff:true}];
      else if(t.includes('from appointment_requests'))rows=[];
      else if(t.includes('select id::text,direction,delivery_status'))rows=[{id:${JSON.stringify(firstTurnScope.message)},direction:'inbound',delivery_status:'not_applicable'}];
      else if(t.includes('select id::text as run_id,trigger_message_id'))rows=[{run_id:'synthetic',status:'failed',failure_category:'policy_denied',schema_valid:true,policy_allowed:false,estimated_cost_micros:'1950'}];
      else if(t.includes('select e.id::text'))rows=[{action_name:'none',validation_status:'denied',policy_reason_code:'policy_denied',application_status:'not_applied'}];
      else if(t.includes('select m.id::text'))rows=[{id:${JSON.stringify(firstTurnScope.message)},direction:'inbound',processing_status:'suppressed'}];
      else if(t.includes('select a.id::text'))rows=[{event_type:'ai_run.failed',reason_code:'policy_denied',dispatch_authorized:'true'}];
      else if(t.includes('select o.id::text'))rows=[{event_type:'ai_run.failed',status:'published'}];
      else if(t.includes('has_table_privilege'))rows=[{handler_read:false,job_read:false}];
      else throw Error('UNEXPECTED_QUERY');
      return {rows};};
  `,
  );
  try {
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", moduleBootstrap], {
      cwd: fixture,
      env: {
        ...process.env,
        DATABASE_URL: "postgresql://invalid.invalid/test",
        S22_BOOKING_READ_STAGE: "first-turn",
        S22_BOOKING_READ_B64: readFileSync(
          new URL("./s22-booking-evidence-readonly.mjs", import.meta.url),
        ).toString("base64"),
        S22_BOOKING_TRACE_B64: readFileSync(
          new URL("./s22-booking-first-turn-readonly.mjs", import.meta.url),
        ).toString("base64"),
      },
      encoding: "utf8",
      timeout: 15000,
    });
    assert.equal(result.status, 0, result.stderr + result.stdout);
    const assertions = result.stdout
      .split(/\r?\n/u)
      .filter((line) => line.startsWith("{"))
      .map((line) => JSON.parse(line));
    assert.equal(assertions.length, 12);
    assert.equal(
      assertions.every((a) => a.outcome === "PASS"),
      true,
    );
    assert.equal(assertions.filter((a) => a.assertion.startsWith("first_turn_")).length, 6);
    assert.match(result.stdout, /FIXTURE_RUNTIME_CLOSED/);
    assert.equal((result.stdout.match(/FIXTURE_ROLLBACK/gu) || []).length, 2);
    assert.doesNotMatch(result.stdout, /postgresql:\/\/|invalid\.invalid/);
  } finally {
    assert.equal(resolve(fixture).startsWith(resolve(tmpdir())), true);
    assert.equal(basename(fixture).startsWith("s22-first-turn-bootstrap-"), true);
    rmSync(fixture, { recursive: true, force: true });
  }
});
