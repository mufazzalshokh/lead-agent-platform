import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve, basename } from "node:path";
import { gzipSync } from "node:zlib";
import test from "node:test";
import { moduleBootstrap } from "./s22-booking-evidence.mjs";
import {
  collectCompletionEvidence,
  completionAccountingPass,
  completionAssertions,
  completionScope,
} from "./s22-booking-completion-readonly.mjs";

const resource = (suffix) => `01a11700-aaaa-7bbb-8ccc-${suffix.padStart(12, "0")}`;
const requestId = resource("1"),
  sourceId = resource("2"),
  confirmationId = resource("3");
const sourceCorrelation = resource("4"),
  staffCorrelation = resource("5"),
  customerCorrelation = resource("6");
const created = "2026-10-07T13:40:05.000Z";
const accepted = "2026-10-07T14:00:00.000Z";
const issued = "2026-10-07T14:00:01.000Z";
const acted = "2026-10-07T14:02:00.000Z";
const confirmed = "2026-10-07T14:02:01.000Z";
const fixture = () => ({
  request: [
    {
      id: requestId,
      status: "confirmed",
      version: "4",
      offer_version: 1,
      start_at: completionScope.start,
      end_at: completionScope.end,
      offered_time_zone: "Asia/Tashkent",
      confirmation_issued_at: issued,
      offer_expires_at: completionScope.start,
      confirmed_at: confirmed,
      confirmation_source: "instagram",
      staff_decided_at: accepted,
      source_message_id: sourceId,
    },
  ],
  transitions: [
    [
      null,
      "requested",
      "create_appointment_request",
      "customer",
      created,
      sourceCorrelation,
      sourceId,
      null,
    ],
    [
      "requested",
      "staff_accepted",
      "staff_accept_appointment_request",
      "member",
      accepted,
      staffCorrelation,
      null,
      1,
    ],
    [
      "staff_accepted",
      "awaiting_customer_confirmation",
      "prepare_customer_confirmation",
      "system",
      issued,
      staffCorrelation,
      null,
      1,
    ],
    [
      "awaiting_customer_confirmation",
      "confirmed",
      "confirm_appointment_request",
      "customer",
      confirmed,
      customerCorrelation,
      confirmationId,
      1,
    ],
  ].map(
    (
      [
        from_status,
        to_status,
        command,
        actor_type,
        occurred_at,
        correlation_id,
        source_message_id,
        offer_version,
      ],
      index,
    ) => ({
      id: resource(String(10 + index)),
      from_status,
      to_status,
      command,
      actor_type,
      occurred_at,
      correlation_id,
      source_message_id,
      offer_version,
      aggregate_version: String(index + 1),
      actor_binding: true,
    }),
  ),
  evidence: [
    {
      id: resource("20"),
      offer_version: 1,
      outcome: "confirmed",
      source: "instagram",
      source_message_id: confirmationId,
      customer_acted_at: acted,
      recorded_at: confirmed,
      correlation_id: customerCorrelation,
      customer_bound: true,
      channel_bound: true,
      source_bound: true,
      offer_bound: true,
      within_window: true,
    },
  ],
  prompts: [
    {
      id: resource("21"),
      direction: "outbound",
      processing_status: "processed",
      delivery_status: "sent",
      sequence_no: "20",
      reply_to_message_id: null,
      ai_run_id: null,
      created_at: issued,
      correlation_id: staffCorrelation,
      confirmation_kind: "prompt",
      offer_bound: true,
      customer_after_prompt: true,
      source_bound: true,
    },
  ],
  acknowledgments: [
    {
      id: resource("22"),
      direction: "outbound",
      processing_status: "processed",
      delivery_status: "sent",
      sequence_no: "22",
      reply_to_message_id: confirmationId,
      ai_run_id: null,
      created_at: confirmed,
      correlation_id: customerCorrelation,
      confirmation_kind: "confirmed",
      source_bound: true,
    },
  ],
  audits: [
    {
      id: resource("23"),
      target_type: "appointment_request",
      action: "appointment_request.transition",
      result: "succeeded",
      actor_type: "member",
      staff_operation: "accept",
      expected_version: "1",
      correlation_id: staffCorrelation,
      occurred_at: accepted,
      actor_binding: true,
      transition_bound: true,
      owner_active: true,
      owner_unique: true,
    },
    {
      id: resource("24"),
      target_type: "appointment_request",
      action: "appointment_request.transition",
      result: "succeeded",
      actor_type: "customer",
      staff_operation: null,
      expected_version: "3",
      correlation_id: customerCorrelation,
      occurred_at: confirmed,
      actor_binding: true,
      transition_bound: true,
      owner_active: null,
      owner_unique: true,
    },
    {
      id: resource("25"),
      target_type: "lead",
      action: "lead.transition",
      result: "succeeded",
      actor_type: "customer",
      staff_operation: null,
      expected_version: "3",
      correlation_id: customerCorrelation,
      occurred_at: confirmed,
      actor_binding: true,
      transition_bound: true,
      owner_active: null,
      owner_unique: true,
    },
  ],
  leads: [
    {
      status: "converted",
      version: "7",
      converted_at: confirmed,
      event_type: "lead.converted",
      aggregate_version: "7",
      correlation_id: customerCorrelation,
      occurred_at: confirmed,
      appointment_bound: true,
    },
  ],
  runs: [
    {
      id: resource("26"),
      status: "succeeded",
      attempt_no: 1,
      trigger_message_id: sourceId,
      provider_id: "gemini",
      cost_currency: "USD",
      schema_valid: true,
      policy_allowed: true,
      cost_catalog_version: "ai-provider-prices.2026-09-17.v1",
      requested_model_id: "gemini-3.8-flash",
      provider_resolved_model_id: "gemini-3.8-flash",
      estimated_cost_micros: "2100",
      input_units: "700",
      output_units: "200",
      cached_input_units: "0",
      total_units: "900",
      finished_at: created,
      correlation_id: sourceCorrelation,
      booking_trigger: true,
      reservations: "1",
      journey_starts: "1",
      reserved_micros: "801432",
      approved_limits: true,
    },
  ],
});
const family = (text) => {
  if (text.includes("from appointment_requests r where")) return "request";
  if (text.includes("from appointment_request_transitions t join")) return "transitions";
  if (text.includes("from appointment_confirmation_evidence e join")) return "evidence";
  if (text.includes("confirmation_kind'='prompt'")) return "prompts";
  if (text.includes("confirmation_kind'='confirmed'")) return "acknowledgments";
  if (text.includes("from audit_events a join")) return "audits";
  if (text.includes("from leads l join")) return "leads";
  if (text.includes("from ai_runs run join")) return "runs";
  assert.fail("Unexpected diagnostic query");
};
const collect = async (data = fixture(), onRead = () => {}) => {
  const records = [];
  const summary = await collectCompletionEvidence(
    async (text, args) => {
      onRead(text, args);
      return data[family(text)];
    },
    (assertion, pass, observed) => records.push({ assertion, pass, observed }),
  );
  return { records, summary };
};
const assertion = (result, name) => result.records.find((row) => row.assertion === name);

test("full persisted lifecycle, current Instagram offer binding, owner audit and sent messages pass independently", async () => {
  const { records, summary } = await collect();
  assert.deepEqual(
    records.map((row) => row.assertion),
    completionAssertions,
  );
  assert.equal(
    records.every((row) => row.pass),
    true,
  );
  assert.deepEqual(summary, {
    continuationCostMicros: "2100",
    continuationCalls: 1,
    providerPass: true,
  });
  assert.equal(completionScope.from, "2026-10-07T13:35:00Z");
  assert.equal(completionScope.start, "2026-10-08T12:00:00Z");
});

test("all eight reads are parameterized, tenant/conversation/request/window scoped and bounded; no database mutation or sensitive projection", async () => {
  const queries = [];
  await collect(fixture(), (text, args) => {
    queries.push(text);
    assert.match(text.trim(), /^select /iu);
    assert.match(text, /r\.organization_id=\$1 and r\.conversation_id=\$2/u);
    assert.match(text, /r\.created_at >= \$3::timestamptz and r\.created_at < \$4::timestamptz/u);
    assert.match(text, /limit (2|3|4|5)$/u);
    assert.doesNotMatch(
      text,
      /\b(insert|update|delete|truncate|alter|drop|grant|revoke|ciphertext|external_message_id|external_event_id|account_id|body_hash)\b/iu,
    );
    assert.doesNotMatch(text, /select\s+(?:\w+\.)?\*/iu);
    assert.doesNotMatch(
      text,
      /select[^]*?\b(?:r\.contact_id|e\.customer_contact_id|m\.sender_contact_id|a\.actor_id)::text/iu,
    );
    assert.deepEqual(args.slice(0, 3), [
      completionScope.conversation,
      completionScope.from,
      completionScope.until,
    ]);
    if (family(text) !== "request") {
      assert.match(text, /r\.id=\$5/u);
      assert.equal(args[3], requestId);
    }
    if (["prompts", "acknowledgments", "audits"].includes(family(text)))
      assert.equal(args[4], "s18_customer_confirmation.v1");
  });
  assert.equal(queries.length, 8);
  const evidence = queries.find((text) => family(text) === "evidence");
  for (const guard of [
    "m.sender_contact_id=r.contact_id",
    "m.channel_connection_id=c.channel_connection_id",
    "m.external_sent_at >= r.confirmation_issued_at",
    "e.customer_acted_at < r.offer_expires_at",
    "e.recorded_at < r.offer_expires_at",
    "cc.channel_type='instagram'",
  ])
    assert.equal(evidence.includes(guard), true, guard);
  const prompt = queries.find((text) => family(text) === "prompts");
  for (const guard of [
    "confirmation_request_id'=r.id::text",
    "confirmation_offer_version'=r.offer_version::text",
    "m.created_at=t.occurred_at",
    "customer.sequence_no>m.sequence_no",
  ])
    assert.equal(prompt.includes(guard), true, guard);
  const ack = queries.find((text) => family(text) === "acknowledgments");
  assert.match(ack, /m\.reply_to_message_id=e\.source_message_id/u);
  assert.match(ack, /o\.correlation_id=e\.correlation_id/u);
  // Real natural-message acknowledgment does not contain an offer/request manifest.
  assert.doesNotMatch(ack, /confirmation_request_id|confirmation_offer_version/u);
  assert.match(
    queries.find((text) => family(text) === "runs"),
    /run\.started_at >= \$3::timestamptz/u,
  );
});

test("extra fields, whole JSON, credential values and customer identifiers never enter the emitted projection", async () => {
  const data = fixture();
  for (const rows of Object.values(data))
    for (const row of rows)
      Object.assign(row, {
        actor_id: "private-customer",
        customer_contact_id: "private-customer",
        account_id: "private-account",
        metadata_redacted_jsonb: { secret: "private-secret" },
        knowledge_manifest_jsonb: { body: "private-message" },
        body_ciphertext: "private-ciphertext",
        environment: "private-DSN",
      });
  assert.doesNotMatch(
    JSON.stringify(await collect(data)),
    /private-|metadata_redacted_jsonb|knowledge_manifest_jsonb|body_ciphertext|customer_contact_id|actor_id|account_id/,
  );
});

for (const count of [0, 2])
  test(`request discovery (${count}) fails closed, never guesses and still reports every independent check`, async () => {
    const data = fixture();
    data.request = Array.from({ length: count }, () => data.request[0]);
    let downstream = 0;
    const result = await collect(data, (text, args) => {
      if (family(text) !== "request") {
        downstream++;
        assert.equal(args[3], null);
      }
    });
    assert.equal(assertion(result, "completion_request").pass, false);
    assert.equal(result.records.length, 8);
    assert.equal(downstream, 7);
    assert.equal(result.summary.providerPass, false);
  });

const defects = [
  ["request", "status", "staff_accepted", "completion_request"],
  ["request", "start_at", "2026-10-08T13:00:00Z", "completion_request"],
  ["request", "confirmation_source", "staff_attested_external", "completion_request"],
  ["transitions", "actor_binding", false, "completion_transitions"],
  ["evidence", "source", "telegram", "completion_customer_evidence"],
  ["evidence", "source_bound", false, "completion_customer_evidence"],
  ["evidence", "channel_bound", false, "completion_customer_evidence"],
  ["evidence", "within_window", false, "completion_customer_evidence"],
  ["evidence", "offer_version", 2, "completion_customer_evidence"],
  ["evidence", "source_message_id", sourceId, "completion_customer_evidence"],
  ["prompts", "offer_bound", false, "completion_offer_delivery"],
  ["prompts", "customer_after_prompt", false, "completion_offer_delivery"],
  ["prompts", "delivery_status", "queued", "completion_offer_delivery"],
  ["acknowledgments", "delivery_status", "failed", "completion_confirmation_delivery"],
  ["acknowledgments", "reply_to_message_id", sourceId, "completion_confirmation_delivery"],
  ["acknowledgments", "source_bound", false, "completion_confirmation_delivery"],
  ["audits", "owner_active", false, "completion_audits"],
  ["audits", "owner_unique", false, "completion_audits"],
  ["audits", "transition_bound", false, "completion_audits"],
  ["audits", "actor_binding", false, "completion_audits"],
  ["leads", "status", "booking_requested", "completion_lead"],
  ["leads", "appointment_bound", false, "completion_lead"],
  ["runs", "estimated_cost_micros", null, "completion_provider_runs"],
  ["runs", "estimated_cost_micros", "801433", "completion_provider_runs"],
  ["runs", "finished_at", null, "completion_provider_runs"],
  ["runs", "schema_valid", false, "completion_provider_runs"],
  ["runs", "policy_allowed", false, "completion_provider_runs"],
  ["runs", "cost_catalog_version", "not-priced.v1", "completion_provider_runs"],
  ["runs", "cached_input_units", null, "completion_provider_runs"],
  ["runs", "cached_input_units", "701", "completion_provider_runs"],
  ["runs", "input_units", null, "completion_provider_runs"],
  ["runs", "output_units", "4001", "completion_provider_runs"],
  ["runs", "total_units", null, "completion_provider_runs"],
  ["runs", "total_units", "901", "completion_provider_runs"],
  ["runs", "requested_model_id", "other-model", "completion_provider_runs"],
  ["runs", "reservations", "0", "completion_provider_runs"],
  ["runs", "journey_starts", "2", "completion_provider_runs"],
  ["runs", "approved_limits", false, "completion_provider_runs"],
  ["runs", "booking_trigger", false, "completion_provider_runs"],
];
for (const [group, key, value, name] of defects)
  test(`${name} rejects ${key}=${String(value)} and succeeds after correcting that concrete defect`, async () => {
    const data = fixture();
    data[group][0][key] = value;
    assert.equal(assertion(await collect(data), name).pass, false);
    assert.equal(assertion(await collect(), name).pass, true);
  });

test("missing intermediate prepare, duplicate evidence, duplicated delivery or duplicate audit cannot pass", async () => {
  for (const [group, name] of [
    ["transitions", "completion_transitions"],
    ["evidence", "completion_customer_evidence"],
    ["prompts", "completion_offer_delivery"],
    ["acknowledgments", "completion_confirmation_delivery"],
    ["audits", "completion_audits"],
    ["leads", "completion_lead"],
    ["runs", "completion_provider_runs"],
  ]) {
    const data = fixture();
    data[group].push(data[group][0]);
    assert.equal(assertion(await collect(data), name).pass, false, group);
  }
  const missing = fixture();
  missing.transitions.splice(2, 1);
  assert.equal(assertion(await collect(missing), "completion_transitions").pass, false);
});

test("one known retry remains bounded; a confirmation-triggered run is detected rather than hidden", async () => {
  const data = fixture();
  data.runs[0].status = "schema_rejected";
  data.runs.push({
    ...data.runs[0],
    id: resource("27"),
    attempt_no: 2,
    status: "succeeded",
    estimated_cost_micros: "2000",
  });
  assert.deepEqual((await collect(data)).summary, {
    continuationCostMicros: "4100",
    continuationCalls: 2,
    providerPass: true,
  });
  data.runs[1].booking_trigger = false;
  data.runs[1].trigger_message_id = confirmationId;
  const result = await collect(data);
  assert.equal(assertion(result, "completion_provider_runs").pass, false);
  assert.equal(assertion(result, "completion_provider_runs").observed.confirmation_calls, 1);
  assert.equal(result.summary.continuationCostMicros, null);
});

const snapshot = (calls = 1, cost = "2100") => ({
  profile: "s22-synthetic-booking.v1",
  mode: "booking",
  logicalMessages: 4,
  physicalCalls: 3 + calls,
  blocked: true,
  reason: calls === 1 ? "message_limit" : "attempt_limit",
  accountingComplete: false,
  unresolvedReserveMicros: "0",
  historicalReserveMicros: "1033396",
  perCallReserveMicros: "801432",
  knownCostMicros: (6207n + BigInt(cost)).toString(),
  combinedExposureMicros: (1033396n + 6207n + BigInt(cost)).toString(),
});
const summary = (calls = 1, cost = "2100") => ({
  providerPass: true,
  continuationCalls: calls,
  continuationCostMicros: cost,
});
test("completion passes exactly exhausted 4/4 and 4/5 paid cohorts without claiming exact historical accounting", () => {
  assert.equal(completionAccountingPass(snapshot(), summary()), true);
  assert.equal(completionAccountingPass(snapshot(2, "1602864"), summary(2, "1602864")), true);
  assert.equal(completionAccountingPass(snapshot(1, "0"), summary(1, "0")), true);
});
test("completion accounting fails closed for missing proof, unknown/pending costs, extra slots and malformed or nonmatching integer accounting", () => {
  assert.equal(completionAccountingPass(snapshot()), false);
  assert.equal(completionAccountingPass(snapshot(), { ...summary(), providerPass: false }), false);
  assert.equal(
    completionAccountingPass(snapshot(), { ...summary(), continuationCostMicros: null }),
    false,
  );
  for (const changes of [
    { profile: "other" },
    { mode: "paused" },
    { blocked: false },
    { reason: "physical_limit" },
    { reason: "cost_unknown" },
    { logicalMessages: 5 },
    { physicalCalls: 6 },
    { unresolvedReserveMicros: "1" },
    { historicalReserveMicros: "0" },
    { perCallReserveMicros: "0" },
    { accountingComplete: true },
    { knownCostMicros: null },
    { knownCostMicros: "08307" },
    { knownCostMicros: 8307 },
    { knownCostMicros: "8307.0" },
    { knownCostMicros: "-1" },
    { knownCostMicros: "6206" },
    { knownCostMicros: "1609072" },
    { combinedExposureMicros: "1039603" },
  ])
    assert.equal(
      completionAccountingPass({ ...snapshot(), ...changes }, summary()),
      false,
      JSON.stringify(changes),
    );
});

test("each failing query reports its exact stable stage and safe SQLSTATE without propagating SQL, credentials or provider payloads", async () => {
  const codes = {
    request: "REQUEST",
    transitions: "TRANSITIONS",
    evidence: "CUSTOMER_EVIDENCE",
    prompts: "OFFER_DELIVERY",
    acknowledgments: "CONFIRMATION_DELIVERY",
    audits: "AUDITS",
    leads: "LEAD",
    runs: "PROVIDER_RUNS",
  };
  for (const [failed, name] of Object.entries(codes)) {
    for (const [inputCode, expected] of [
      ["42501", "42501"],
      ["private-secret", "READ_FAILED"],
    ]) {
      const data = fixture();
      await assert.rejects(
        collectCompletionEvidence(
          async (text) => {
            const group = family(text);
            if (group === failed)
              throw Object.assign(Error("private-DSN private-message"), { code: inputCode });
            return data[group];
          },
          () => {},
        ),
        (error) => {
          assert.equal(error.code, `COMPLETION_${name}_${expected}`);
          assert.equal(error.message, "");
          assert.doesNotMatch(JSON.stringify(error), /private-|select |postgresql:/u);
          return true;
        },
      );
    }
  }
});

test("actual generated data-URL bootstrap parses this import-free module and executes all assertions without live dependencies", () => {
  const source = readFileSync(new URL("./s22-booking-completion-readonly.mjs", import.meta.url));
  assert.doesNotMatch(source.toString(), /\bimport\s*(?:\(|[{"'])/u);
  assert.equal(Buffer.byteLength(gzipSync(source).toString("base64")) < 32000, true);
  const controlled = fixture();
  const bootstrap = `const m=await import('data:text/javascript;base64,${source.toString("base64")}');
    const fixture=${JSON.stringify(controlled)};
    const family=${family.toString().replace('assert.fail("Unexpected diagnostic query")', 'throw Error("Unexpected diagnostic query")')};
    const rows=[];const result=await m.collectCompletionEvidence(async text=>fixture[family(text)],
      (assertion,pass,observed)=>rows.push({assertion,pass,observed}));
    if(rows.length!==8||rows.some(row=>!row.pass)||!result.providerPass)process.exitCode=1;
    console.log(JSON.stringify({assertions:rows.length,pass:rows.every(row=>row.pass),result}));`;
  const executed = spawnSync(process.execPath, ["--input-type=module"], {
    input: bootstrap,
    encoding: "utf8",
    timeout: 10000,
    stdio: ["pipe", "pipe", "pipe"],
  });
  assert.equal(executed.status, 0, executed.stderr);
  assert.equal(JSON.parse(executed.stdout).pass, true);
});

test("exact deployed bootstrap executes actual base+completion readers with bare/relative package resolution, rollback and closure; exhausted readiness and failed guard stay closed", () => {
  const directory = mkdtempSync(join(tmpdir(), "s22-completion-module-"));
  const packages = join(directory, "node_modules", "@lead-agent");
  const data = fixture(),
    scope = completionScope;
  const queryFamily = family
    .toString()
    .replace(
      'assert.fail("Unexpected diagnostic query")',
      'throw Error("Unexpected diagnostic query")',
    );
  const readBody = readFileSync(new URL("./s22-booking-evidence-readonly.mjs", import.meta.url));
  const completion = readFileSync(
    new URL("./s22-booking-completion-readonly.mjs", import.meta.url),
  );
  try {
    for (const name of ["config", "database"]) {
      const location = join(packages, name);
      mkdirSync(location, { recursive: true });
      writeFileSync(
        join(location, "package.json"),
        JSON.stringify({ name: `@lead-agent/${name}`, type: "module", exports: "./index.js" }),
      );
    }
    writeFileSync(
      join(packages, "config", "index.js"),
      `
      export const S22_BOOKING_COHORT={historicalRunIds:['01a1067f-dfc8-7e14-9e12-89a0e30fd27e','01a10af4-5126-7ce8-ab52-0424e07ab3d9']};
      export const withLibpqCompatibleRequireSsl=value=>value;
      export const createTenantDatabaseRuntimeConfig=value=>value;
      export const loadAIJourneyCohortConfig=()=>({organizationId:${JSON.stringify(scope.organization)},conversationId:${JSON.stringify(scope.conversation)},
        historicalReserveMicros:1033396n,hardCeilingMicros:10000000n,maximumCalls:5,maximumMessages:4,maximumCallsPerMessage:2,inputTokenLimit:1048576,outputTokenLimit:4000,
        profile:'s22-synthetic-booking.v1',mode:'booking'});
    `,
    );
    writeFileSync(
      join(packages, "database", "index.js"),
      `
      globalThis.probe={transactions:0,rollbacks:0,closed:0,completionQueries:0};
      export function createTenantDatabaseRuntime(config){
        if(config.maxConnections!==1||config.connectionTimeoutMilliseconds!==5000)throw Error('CONFIG_LIMITS_MISSING');
        const settings=new URL(config.connectionString).searchParams.get('options');
        if(!settings.includes('default_transaction_read_only=on')||!settings.includes('row_security=on'))throw Error('READ_ONLY_SETTINGS_MISSING');
        return {verifyReady:async()=>{},withTenantTransaction:async(organizationId,callback)=>{
          globalThis.probe.transactions++;
          try{return await callback({organizationId});}catch(error){
            globalThis.probe.rollbacks++;
            throw error;
          }
        },close:async()=>{globalThis.probe.closed++;console.log(JSON.stringify({probe:globalThis.probe}));}};
      }
      export function createAIJourneyBudgetGuard(runtime){return {read:async tenant=>runtime.withTenantTransaction(tenant,async()=>(${JSON.stringify(snapshot())}))};}
    `,
    );
    mkdirSync(join(packages, "database", "runtime"));
    writeFileSync(
      join(packages, "database", "runtime", "tenant.js"),
      `
      const fixture=${JSON.stringify(data)},scope=${JSON.stringify(scope)};
      const family=${queryFamily};
      export async function executeTenantQuery(session,make){
        const query=make(session.organizationId),text=query.text;
        if(query.values[0]!==scope.organization)throw Error('TENANT_MISMATCH');
        let rows;
        if(text.includes("current_user='lead_agent_runtime'"))rows=[{runtime:true,staging_database:true,least_privilege:true,
          read_only:process.env.CONTROLLED_GUARD_FAIL!=='1',row_security:true,tenant_matches:true}];
        else if(text.includes('pg_catalog.pg_class'))rows=[{count:query.values[1].length,safe:true}];
        else if(text.includes('as cost_unknown'))rows=query.values[2].map(run_id=>({run_id,cost_unknown:true,finished:true}));
        else if(text.includes('no_active_handoff'))rows=[{id:scope.conversation,status:'open',version:'30',automation_mode:'ai',no_active_handoff:true}];
        else if(text.startsWith('select id::text,status,version,offer_version'))rows=fixture.request;
        else if(text.startsWith('select id::text,direction,delivery_status'))rows=[{id:fixture.prompts[0].id,direction:'outbound',delivery_status:'sent',created_at:fixture.prompts[0].created_at}];
        else{globalThis.probe.completionQueries++;rows=fixture[family(text)];}
        return {rows};
      }
    `,
    );
    const run = (stage, fail = false) =>
      spawnSync(process.execPath, ["--input-type=module", "-e", moduleBootstrap], {
        cwd: directory,
        encoding: "utf8",
        timeout: 15000,
        env: {
          ...process.env,
          DATABASE_URL: "postgresql://fixture:synthetic@127.0.0.1/lead_agent_staging",
          S22_BOOKING_READ_B64: readBody.toString("base64"),
          S22_BOOKING_TRACE_GZIP_B64: gzipSync(completion).toString("base64"),
          S22_BOOKING_READ_STAGE: stage,
          CONTROLLED_GUARD_FAIL: fail ? "1" : "0",
        },
      });
    const lines = (result) =>
      result.stdout
        .trim()
        .split("\n")
        .map((value) => JSON.parse(value));
    const completed = run("completion");
    assert.equal(completed.status, 0, completed.stderr + completed.stdout);
    const proof = lines(completed);
    assert.equal(proof.filter((row) => row.operation === "s22_booking_readonly").length, 14);
    assert.equal(
      proof
        .filter((row) => row.operation === "s22_booking_readonly")
        .every((row) => row.outcome === "PASS"),
      true,
    );
    assert.deepEqual(proof.find((row) => row.probe)?.probe, {
      transactions: 2,
      rollbacks: 2,
      closed: 1,
      completionQueries: 8,
    });
    const observe = run("observe");
    assert.equal(observe.status, 1, observe.stderr);
    assert.equal(
      lines(observe).find((row) => row.assertion === "cohort_reservation_accounting").outcome,
      "FAIL",
    );
    assert.deepEqual(lines(observe).find((row) => row.probe)?.probe, {
      transactions: 2,
      rollbacks: 2,
      closed: 1,
      completionQueries: 0,
    });
    const guarded = run("completion", true);
    assert.equal(guarded.status, 1, guarded.stderr);
    assert.equal(
      lines(guarded).find((row) => row.code === "READ_ONLY_RUNTIME_TENANT_GUARD_FAILED").outcome,
      "BLOCKED",
    );
    assert.deepEqual(lines(guarded).find((row) => row.probe)?.probe, {
      transactions: 1,
      rollbacks: 1,
      closed: 1,
      completionQueries: 0,
    });
    for (const result of [completed, observe, guarded])
      assert.doesNotMatch(result.stdout, /postgresql:|fixture:synthetic|private-/u);
  } finally {
    assert.equal(resolve(directory).startsWith(resolve(tmpdir())), true);
    assert.equal(basename(directory).startsWith("s22-completion-module-"), true);
    rmSync(directory, { recursive: true, force: true });
  }
});
