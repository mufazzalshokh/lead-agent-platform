// Self-contained ES module loaded from reviewed execution-override source.
// No imports: package/relative resolution remains in the main reader rooted at /app.
// Metadata only: no provider, writes, ciphertext or message content.
export const firstTurnScope = Object.freeze({
  organization: "01a0ee39-91a9-7293-82c0-5b7046c10115",
  conversation: "01a1067f-d7d8-7e7e-9fb0-39bfe2f7cdc7",
  message: "01a10d17-89b6-7c09-8d19-8bbaacec8979",
  correlation: "01a10d17-89b6-7d26-a4c5-cd14151eaeb4",
  outbox: "01a10d17-89b6-77b6-8365-99f28ec3c2b1",
  from: "2026-10-05T17:22:00Z",
  until: "2026-10-05T17:37:00Z",
});

export const collectFirstTurnEvidence = async (read, report) => {
  const s = firstTurnScope;
  const exact = [s.conversation, s.message, s.correlation, s.from, s.until];
  const checks = [
    {
      name: "first_turn_runs",
      limit: 3,
      minimum: 1,
      text: `select id::text as run_id,trigger_message_id::text,correlation_id::text,
        status,attempt_no,expected_conversation_version::text,provider_id,requested_model_id,
        provider_resolved_model_id,schema_valid,policy_allowed,failure_category,
        input_units::text,output_units::text,cached_input_units::text,reasoning_units::text,
        total_units::text,estimated_cost_micros::text,cost_catalog_version,latency_ms,
        (output_hash is not null) as has_output_hash,started_at,finished_at
        from ai_runs where organization_id=$1 and conversation_id=$2 and trigger_message_id=$3
        and correlation_id=$4 and started_at >= $5::timestamptz and started_at <= $6::timestamptz
        order by attempt_no,id limit 3`,
    },
    {
      name: "first_turn_actions",
      limit: 5,
      text: `select e.id::text,e.ai_run_id::text,e.action_name,e.validation_status,
        e.policy_reason_code,e.application_status,e.started_at,e.finished_at
        from ai_action_evaluations e join ai_runs r
        on r.organization_id=e.organization_id and r.id=e.ai_run_id
        where e.organization_id=$1 and r.conversation_id=$2 and r.trigger_message_id=$3
        and r.correlation_id=$4 and r.started_at >= $5::timestamptz
        and r.started_at <= $6::timestamptz order by e.started_at,e.id limit 5`,
    },
    {
      name: "first_turn_messages",
      limit: 9,
      minimum: 1,
      text: `select m.id::text,m.direction,m.sequence_no::text,m.processing_status,
        m.delivery_status,m.reply_to_message_id::text,m.ai_run_id::text,m.created_at
        from messages m where m.organization_id=$1 and m.conversation_id=$2
        and m.created_at >= $5::timestamptz and m.created_at <= $6::timestamptz
        and (m.id=$3 or m.reply_to_message_id=$3 or m.ai_run_id in
          (select r.id from ai_runs r where r.organization_id=$1 and r.conversation_id=$2
            and r.trigger_message_id=$3 and r.correlation_id=$4
            and r.started_at >= $5::timestamptz and r.started_at <= $6::timestamptz))
        order by m.created_at,m.id limit 9`,
    },
    {
      name: "first_turn_audits",
      limit: 21,
      text: `select a.id::text,a.event_type,a.target_type,a.target_id::text,a.action,a.result,
        a.reason_code,a.correlation_id::text,a.occurred_at,
        a.metadata_redacted_jsonb->>'status' as recorded_status,
        a.metadata_redacted_jsonb->>'attempt_no' as recorded_attempt_no,
        a.metadata_redacted_jsonb->>'dispatch_authorized' as dispatch_authorized,
        a.metadata_redacted_jsonb->>'reservation_micros' as reservation_micros
        from audit_events a where a.organization_id=$1 and a.correlation_id=$4
        and a.occurred_at >= $5::timestamptz and a.occurred_at <= $6::timestamptz
        and (a.target_id=$2 or a.target_id=$3 or a.target_id in
          (select r.id from ai_runs r where r.organization_id=$1 and r.conversation_id=$2
            and r.trigger_message_id=$3 and r.correlation_id=$4
            and r.started_at >= $5::timestamptz and r.started_at <= $6::timestamptz))
        order by a.occurred_at,a.id limit 21`,
    },
    {
      name: "first_turn_outbox",
      limit: 21,
      extra: [...exact, s.outbox],
      text: `select o.id::text,o.event_type,o.aggregate_type,o.aggregate_id::text,
        o.aggregate_version::text,o.status,o.attempt_count,o.last_error_category,
        o.available_at,o.published_at,o.occurred_at,o.correlation_id::text,o.causation_id::text,
        o.payload_jsonb->'payload'->>'ai_run_outcome' as ai_run_outcome,
        o.payload_jsonb->'payload'->>'proposed_action' as proposed_action,
        o.payload_jsonb->'payload'->>'reason_code' as reason_code,
        o.payload_jsonb->'payload'->>'failure_category' as failure_category
        from outbox_events o where o.organization_id=$1 and o.correlation_id=$4
        and o.occurred_at >= $5::timestamptz and o.occurred_at <= $6::timestamptz
        and (o.id=$7 or o.aggregate_id=$2 or o.aggregate_id=$3 or o.aggregate_id in
          (select r.id from ai_runs r where r.organization_id=$1 and r.conversation_id=$2
            and r.trigger_message_id=$3 and r.correlation_id=$4
            and r.started_at >= $5::timestamptz and r.started_at <= $6::timestamptz))
        order by o.occurred_at,o.id limit 21`,
    },
  ];
  for (const check of checks) {
    const rows = await read(check.text, check.extra ?? exact);
    // PASS means the bounded metadata read succeeded, not generation/delivery PASS.
    report(check.name, rows.length >= (check.minimum ?? 0) && rows.length < check.limit, {
      rows,
      collection_only: true,
    });
  }
  const rows = await read(
    `select has_table_privilege(current_user,'app.worker_handler_executions','SELECT') as handler_read,
      has_schema_privilege(current_user,'pgboss','USAGE') and
      has_table_privilege(current_user,'pgboss.job','SELECT') as job_read
      where $1::uuid is not null limit 1`,
    [],
  );
  report("first_turn_queue_access", rows.length === 1, {
    rows,
    collection_only: true,
    queue_record_proof: "NOT_COLLECTED_USE_EXACT_CORRELATION_LOGS",
  });
};
