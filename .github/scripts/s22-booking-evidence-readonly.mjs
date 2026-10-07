// Runs only as ES-module stdin in /app, in the reviewed immutable diagnostic image.
// No provider construction, customer content, writes, migration or credentials output.
const operation = "s22_booking_readonly";
const organization = "01a0ee39-91a9-7293-82c0-5b7046c10115";
const conversation = "01a1067f-d7d8-7e7e-9fb0-39bfe2f7cdc7";
const rollback = new Error("EXPECTED_READ_ONLY_ROLLBACK");
let runtime,
  currentState,
  requestStates,
  completionModule,
  completionResults,
  failures = 0,
  stage = "initialize";
const report = (assertion, pass, observed) => {
  if (!pass) failures++;
  console.log(JSON.stringify({ operation, assertion, outcome: pass ? "PASS" : "FAIL", observed }));
};
try {
  const config = await import("@lead-agent/config");
  const db = await import("@lead-agent/database");
  const internal = await import(
    new URL("./runtime/tenant.js", import.meta.resolve("@lead-agent/database")).href
  );
  const url = new URL(config.withLibpqCompatibleRequireSsl(process.env.DATABASE_URL));
  url.searchParams.set(
    "options",
    "-c default_transaction_read_only=on -c row_security=on -c statement_timeout=5000 -c lock_timeout=1000 -c idle_in_transaction_session_timeout=10000",
  );
  runtime = db.createTenantDatabaseRuntime(
    config.createTenantDatabaseRuntimeConfig({
      connectionString: url.toString(),
      maxConnections: 1,
      connectionTimeoutMilliseconds: 5000,
      statementTimeoutMilliseconds: 5000,
      idleTimeoutMilliseconds: 5000,
    }),
    {
      onUnexpectedPoolError: () => {
        failures++;
        process.exitCode = 1;
        console.log(
          JSON.stringify({
            operation,
            assertion: "pool_error",
            outcome: "BLOCKED",
            code: "DATABASE_UNAVAILABLE",
          }),
        );
      },
    },
  );
  await runtime.verifyReady();
  const readOnly = async (tenant, callback) => {
    if (tenant !== organization) throw Object.assign(new Error(), { code: "TENANT_MISMATCH" });
    let result;
    try {
      await runtime.withTenantTransaction(tenant, async (session) => {
        const rows = (
          await internal.executeTenantQuery(session, (org) => ({
            text: `select current_user='lead_agent_runtime' and session_user=current_user as runtime,
            current_database()='lead_agent_staging' as staging_database,
            not r.rolsuper and not r.rolbypassrls as least_privilege,
            current_setting('transaction_read_only')='on' as read_only,
            current_setting('row_security')='on' as row_security,
            current_setting('app.organization_id')=$1 as tenant_matches
            from pg_catalog.pg_roles r where r.rolname=current_user limit 1`,
            values: [org],
          }))
        ).rows;
        if (rows.length !== 1 || !Object.values(rows[0]).every((v) => v === true))
          throw Object.assign(new Error(), { code: "READ_ONLY_RUNTIME_TENANT_GUARD_FAILED" });
        result = await callback(session);
        throw rollback; // Successful reads roll back too; never commit a mutation.
      });
    } catch (error) {
      if (error !== rollback) throw error;
    }
    return result;
  };
  stage = "runtime_rls_and_baseline";
  await readOnly(organization, async (session) => {
    const read = async (text, extra = []) =>
      (await internal.executeTenantQuery(session, (org) => ({ text, values: [org, ...extra] })))
        .rows;
    const tables = [
      "ai_runs",
      "ai_action_evaluations",
      "audit_events",
      "conversations",
      "appointment_requests",
      "messages",
      "outbox_events",
      ...(process.env.S22_BOOKING_READ_STAGE === "final-turn"
        ? ["channel_connections", "thread_automation_controls", "webhook_receipts"]
        : []),
      ...(process.env.S22_BOOKING_READ_STAGE === "completion"
        ? [
            "appointment_request_transitions",
            "appointment_confirmation_evidence",
            "leads",
            "channel_connections",
            "memberships",
          ]
        : []),
    ];
    const [rls] = await read(
      `select count(*)::int as count,
      bool_and(c.relrowsecurity and c.relforcerowsecurity and c.relowner<>(select oid from pg_catalog.pg_roles where rolname=current_user)) as safe
      from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relname=any($2::text[]) and $1::uuid is not null limit 1`,
      [tables],
    );
    if (rls?.count !== tables.length || rls.safe !== true)
      throw Object.assign(new Error(), { code: "FORCE_RLS_GUARD_FAILED" });
    const history = await read(
      `select id::text as run_id,(estimated_cost_micros is null) as cost_unknown,
      (finished_at is not null) as finished from ai_runs where organization_id=$1 and conversation_id=$2
      and id=any($3::uuid[]) order by id limit 3`,
      [conversation, config.S22_BOOKING_COHORT.historicalRunIds],
    );
    const historyOk =
      history.length === 2 &&
      new Set(history.map((r) => r.run_id)).size === 2 &&
      history.every(
        (r) =>
          config.S22_BOOKING_COHORT.historicalRunIds.includes(r.run_id) &&
          r.cost_unknown &&
          r.finished,
      );
    report(stage, historyOk, {
      runtime_read_only_tenant_guard: true,
      force_rls: true,
      tables: tables.length,
      historical_runs: history.length,
      historical_null_costs_preserved: historyOk,
    });
    if (!historyOk) throw Object.assign(new Error(), { code: "HISTORICAL_BASELINE_FAILED" });
    const current = await read(
      `select id::text,status,version,automation_mode,(active_handoff_id is null) as no_active_handoff
      from conversations where organization_id=$1 and id=$2 limit 2`,
      [conversation],
    );
    currentState = current[0];
    const currentOk = current.length === 1 && currentState.id === conversation;
    report("synthetic_conversation", currentOk, {
      rows: current,
      exact_conversation: conversation,
    });
    const requests = await read(
      `select id::text,status,version,offer_version,start_at,end_at,
      confirmation_issued_at,offer_expires_at,confirmed_at,confirmation_source
      from appointment_requests where organization_id=$1 and conversation_id=$2 order by created_at,id limit 11`,
      [conversation],
    );
    requestStates = requests;
    report("synthetic_requests", requests.length < 11, { rows: requests });
    const sends = await read(
      `select id::text,direction,delivery_status,created_at
      from messages where organization_id=$1 and conversation_id=$2 and created_at >= $3::timestamptz
      order by created_at,id limit 21`,
      [conversation, "2026-10-05T16:28:09Z"],
    );
    report("synthetic_delivery_metadata", sends.length < 21, { rows: sends });
    if (process.env.S22_BOOKING_READ_STAGE === "first-turn") {
      stage = "first_turn_trace";
      if (!process.env.S22_BOOKING_TRACE_B64)
        throw Object.assign(new Error(), { code: "FIRST_TURN_MODULE_MISSING" });
      const { firstTurnScope, collectFirstTurnEvidence } = await import(
        `data:text/javascript;base64,${process.env.S22_BOOKING_TRACE_B64}`
      );
      if (
        organization !== firstTurnScope.organization ||
        conversation !== firstTurnScope.conversation
      )
        throw Object.assign(new Error(), { code: "FIRST_TURN_SCOPE_MISMATCH" });
      await collectFirstTurnEvidence(read, report);
    }
    if (process.env.S22_BOOKING_READ_STAGE === "final-turn") {
      stage = "final_turn_trace";
      if (!process.env.S22_BOOKING_TRACE_B64)
        throw Object.assign(new Error(), { code: "FINAL_TURN_MODULE_MISSING" });
      const { finalTurnScope, collectFinalTurnEvidence } = await import(
        `data:text/javascript;base64,${process.env.S22_BOOKING_TRACE_B64}`
      );
      if (
        organization !== finalTurnScope.organization ||
        conversation !== finalTurnScope.conversation
      )
        throw Object.assign(new Error(), { code: "FINAL_TURN_SCOPE_MISMATCH" });
      await collectFinalTurnEvidence(read, report);
    }
    if (process.env.S22_BOOKING_READ_STAGE === "completion") {
      stage = "completion_trace";
      if (!process.env.S22_BOOKING_TRACE_GZIP_B64)
        throw Object.assign(new Error(), { code: "COMPLETION_MODULE_MISSING" });
      try {
        const { gunzipSync } = await import("node:zlib");
        const source = gunzipSync(Buffer.from(process.env.S22_BOOKING_TRACE_GZIP_B64, "base64"), {
          maxOutputLength: 65536,
        });
        completionModule = await import(`data:text/javascript;base64,${source.toString("base64")}`);
      } catch {
        throw Object.assign(new Error(), { code: "COMPLETION_MODULE_INVALID" });
      }
      if (
        organization !== completionModule.completionScope.organization ||
        conversation !== completionModule.completionScope.conversation
      )
        throw Object.assign(new Error(), { code: "COMPLETION_SCOPE_MISMATCH" });
      completionResults = await completionModule.collectCompletionEvidence(read, report);
    }
  });
  stage = "deployed_cohort_binding";
  const cohort = config.loadAIJourneyCohortConfig({
    DEPLOYMENT_ENVIRONMENT: "staging",
    AI_JOURNEY_MODE: "booking",
    AI_REQUEST_TIMEOUT_MS: "15000",
  });
  const bindingOk =
    cohort?.organizationId === organization &&
    cohort.conversationId === conversation &&
    cohort.historicalReserveMicros === 1033396n &&
    cohort.hardCeilingMicros === 10000000n &&
    cohort.maximumCalls === 5 &&
    cohort.maximumMessages === 4 &&
    cohort.maximumCallsPerMessage === 2 &&
    cohort.inputTokenLimit === 1048576 &&
    cohort.outputTokenLimit === 4000;
  report(stage, bindingOk, {
    profile: cohort?.profile,
    organization,
    conversation,
    maximum_calls: cohort?.maximumCalls,
    maximum_messages: cohort?.maximumMessages,
    maximum_calls_per_message: cohort?.maximumCallsPerMessage,
    historical_reserve_micros: cohort?.historicalReserveMicros.toString(),
    hard_ceiling_micros: cohort?.hardCeilingMicros.toString(),
  });
  if (!bindingOk) throw Object.assign(new Error(), { code: "COHORT_BINDING_FAILED" });
  stage = "cohort_reservation_accounting";
  const guard = db.createAIJourneyBudgetGuard(
    {
      withTenantTransaction: readOnly,
      close: () => runtime.close(),
      verifyReady: () => runtime.verifyReady(),
    },
    cohort,
  );
  const snapshot = await guard.read(organization);
  report(
    stage,
    process.env.S22_BOOKING_READ_STAGE === "completion"
      ? completionModule.completionAccountingPass(snapshot, completionResults)
      : !snapshot.blocked &&
          snapshot.accountingComplete === false &&
          snapshot.historicalReserveMicros === "1033396" &&
          snapshot.perCallReserveMicros === "801432" &&
          BigInt(snapshot.combinedExposureMicros) < 10000000n,
    snapshot,
  );
  if (snapshot.physicalCalls === 0)
    report(
      "first_turn_readiness",
      snapshot.logicalMessages === 0 &&
        snapshot.knownCostMicros === "0" &&
        snapshot.unresolvedReserveMicros === "0" &&
        snapshot.combinedExposureMicros === "1033396" &&
        requestStates.length === 0 &&
        currentState.status === "open" &&
        currentState.automation_mode === "ai" &&
        currentState.no_active_handoff,
      {
        no_pending_paid_calls:
          snapshot.physicalCalls === 0 && snapshot.unresolvedReserveMicros === "0",
        no_existing_synthetic_request: requestStates.length === 0,
      },
    );
} catch (error) {
  failures++;
  const code =
    typeof error?.code === "string" && /^[A-Z0-9_]{2,64}$/.test(error.code)
      ? error.code
      : "READ_ONLY_VERIFICATION_UNAVAILABLE";
  console.log(JSON.stringify({ operation, assertion: stage, outcome: "BLOCKED", code }));
} finally {
  if (runtime)
    try {
      await runtime.close();
    } catch {
      failures++;
      console.log(
        JSON.stringify({
          operation,
          assertion: "cleanup",
          outcome: "BLOCKED",
          code: "CLEANUP_FAILED",
        }),
      );
    }
  if (failures) process.exitCode = 1;
}
