// Self-contained module for the final authorized turn. No provider or mutation.
// Discovery is confined to the existing synthetic conversation and UTC window;
// never substitute the historical first-turn IDs or choose an ambiguous message.
export const finalTurnScope = Object.freeze({
  organization: "01a0ee39-91a9-7293-82c0-5b7046c10115",
  conversation: "01a1067f-d7d8-7e7e-9fb0-39bfe2f7cdc7",
  from: "2026-10-06T17:58:00Z",
  until: "2026-10-06T18:15:00Z",
});

export const collectFinalTurnEvidence = async (read, report) => {
  const s = finalTurnScope;
  const exact = [s.conversation, s.from, s.until];
  const checks = [
    {
      name: "final_turn_context",
      limit: 2,
      minimum: 1,
      text: `select c.id::text,c.status,c.version::text,c.automation_mode,
        (c.active_handoff_id is null) as no_active_handoff,c.last_activity_at,
        cc.id::text as channel_connection_id,cc.channel_type,
        cc.status as connection_status,cc.version::text as connection_version,
        (cc.credential_secret_ref is not null) as has_credential,
        cc.configuration_jsonb->>'token_expires_at' as token_expires_at,
        t.id::text as thread_control_id,t.eligibility_state,t.version::text as eligibility_version,
        t.reason_code as eligibility_reason,t.updated_at as eligibility_updated_at
        from conversations c join channel_connections cc
        on cc.organization_id=c.organization_id and cc.id=c.channel_connection_id
        left join thread_automation_controls t on t.organization_id=c.organization_id
        and t.channel_connection_id=c.channel_connection_id and t.external_thread_hash=c.external_thread_hash
        where c.organization_id=$1 and c.id=$2 and $3::timestamptz < $4::timestamptz limit 2`,
    },
    {
      name: "final_turn_messages",
      limit: 9,
      text: `select m.id::text,m.direction,m.sequence_no::text,m.processing_status,
        m.delivery_status,m.reply_to_message_id::text,m.ai_run_id::text,m.created_at
        from messages m where m.organization_id=$1 and m.conversation_id=$2
        and m.created_at >= $3::timestamptz and m.created_at < $4::timestamptz
        order by m.created_at,m.id limit 9`,
    },
    {
      name: "final_turn_runs",
      limit: 3,
      text: `select r.id::text as run_id,r.trigger_message_id::text,r.correlation_id::text,
        r.status,r.attempt_no,r.expected_conversation_version::text,r.provider_id,r.requested_model_id,
        r.provider_resolved_model_id,r.schema_valid,r.policy_allowed,r.failure_category,
        r.input_units::text,r.output_units::text,r.cached_input_units::text,r.reasoning_units::text,
        r.total_units::text,r.estimated_cost_micros::text,r.cost_catalog_version,r.latency_ms,
        (r.output_hash is not null) as has_output_hash,r.started_at,r.finished_at
        from ai_runs r where r.organization_id=$1 and r.conversation_id=$2
        and r.started_at >= $3::timestamptz and r.started_at < $4::timestamptz
        and r.trigger_message_id in (select m.id from messages m where m.organization_id=$1
          and m.conversation_id=$2 and m.direction='inbound'
          and m.created_at >= $3::timestamptz and m.created_at < $4::timestamptz)
        order by r.attempt_no,r.id limit 3`,
    },
    {
      name: "final_turn_actions",
      limit: 5,
      text: `select e.id::text,e.ai_run_id::text,e.action_name,e.validation_status,
        e.policy_reason_code,e.application_status,e.started_at,e.finished_at
        from ai_action_evaluations e join ai_runs r
        on r.organization_id=e.organization_id and r.id=e.ai_run_id
        where e.organization_id=$1 and r.conversation_id=$2
        and r.started_at >= $3::timestamptz and r.started_at < $4::timestamptz
        and r.trigger_message_id in (select m.id from messages m where m.organization_id=$1
          and m.conversation_id=$2 and m.direction='inbound'
          and m.created_at >= $3::timestamptz and m.created_at < $4::timestamptz)
        order by e.started_at,e.id limit 5`,
    },
    {
      name: "final_turn_outbox",
      limit: 21,
      text: `select o.id::text,o.event_type,o.aggregate_type,o.aggregate_id::text,
        o.aggregate_version::text,o.status,o.attempt_count,o.last_error_category,
        o.available_at,o.published_at,o.occurred_at,o.correlation_id::text,o.causation_id::text,
        o.payload_jsonb->'payload'->>'message_id' as message_id,
        o.payload_jsonb->'payload'->>'ai_run_outcome' as ai_run_outcome,
        o.payload_jsonb->'payload'->>'proposed_action' as proposed_action,
        o.payload_jsonb->'payload'->>'reason_code' as reason_code,
        o.payload_jsonb->'payload'->>'failure_category' as failure_category
        from outbox_events o where o.organization_id=$1
        and o.occurred_at >= $3::timestamptz and o.occurred_at < $4::timestamptz
        and (o.aggregate_id=$2 or o.aggregate_id in
          (select m.id from messages m where m.organization_id=$1 and m.conversation_id=$2
            and m.created_at >= $3::timestamptz and m.created_at < $4::timestamptz)
          or o.aggregate_id in (select r.id from ai_runs r where r.organization_id=$1
            and r.conversation_id=$2 and r.started_at >= $3::timestamptz
            and r.started_at < $4::timestamptz))
        order by o.occurred_at,o.id limit 21`,
    },
    {
      name: "final_turn_audits",
      limit: 21,
      text: `select a.id::text,a.event_type,a.target_type,a.target_id::text,a.action,a.result,
        a.reason_code,a.correlation_id::text,a.occurred_at,
        a.metadata_redacted_jsonb->>'status' as recorded_status,
        a.metadata_redacted_jsonb->>'attempt_no' as recorded_attempt_no,
        a.metadata_redacted_jsonb->>'dispatch_authorized' as dispatch_authorized,
        a.metadata_redacted_jsonb->>'reservation_micros' as reservation_micros
        from audit_events a where a.organization_id=$1
        and a.occurred_at >= $3::timestamptz and a.occurred_at < $4::timestamptz
        and (a.target_id=$2 or a.target_id in
          (select m.id from messages m where m.organization_id=$1 and m.conversation_id=$2
            and m.created_at >= $3::timestamptz and m.created_at < $4::timestamptz)
          or a.target_id in (select r.id from ai_runs r where r.organization_id=$1
            and r.conversation_id=$2 and r.started_at >= $3::timestamptz
            and r.started_at < $4::timestamptz))
        order by a.occurred_at,a.id limit 21`,
    },
    {
      name: "final_turn_receipts",
      limit: 9,
      // Canonical Instagram ingress currently does not write this legacy table.
      // Zero rows is an observation, not proof that the webhook was rejected.
      text: `select w.id::text,w.status,w.attempt_count,w.last_error_category,
        w.processed_message_id::text,w.correlation_id::text,w.first_received_at,w.last_received_at
        from webhook_receipts w join conversations c
        on c.organization_id=w.organization_id and c.channel_connection_id=w.channel_connection_id
        where w.organization_id=$1 and c.id=$2
        and w.first_received_at >= $3::timestamptz and w.first_received_at < $4::timestamptz
        and w.processed_message_id in (select m.id from messages m where m.organization_id=$1
          and m.conversation_id=$2 and m.created_at >= $3::timestamptz
          and m.created_at < $4::timestamptz)
        order by w.first_received_at,w.id limit 9`,
    },
  ];
  for (const check of checks) {
    const rows = await read(check.text, exact);
    report(check.name, rows.length >= (check.minimum ?? 0) && rows.length < check.limit, {
      rows,
      collection_only: true,
    });
    if (check.name === "final_turn_messages") {
      const inbound = rows.filter((r) => r.direction === "inbound");
      report("final_turn_discovery", inbound.length === 1 && rows.length < check.limit, {
        inbound_count: inbound.length,
        message_id: inbound.length === 1 ? inbound[0].id : null,
        reason:
          inbound.length === 0
            ? "NO_PERSISTED_INBOUND_IN_EXACT_WINDOW"
            : inbound.length > 1
              ? "AMBIGUOUS_INBOUND_NO_MESSAGE_SELECTED"
              : "EXACT_SINGLE_INBOUND",
        collection_only: true,
      });
    }
  }
  const rows = await read(
    `select has_table_privilege(current_user,'app.worker_handler_executions','SELECT') as handler_read,
      has_schema_privilege(current_user,'pgboss','USAGE') and
      has_table_privilege(current_user,'pgboss.job','SELECT') as job_read
      where $1::uuid is not null limit 1`,
    [],
  );
  report("final_turn_queue_access", rows.length === 1, {
    rows,
    collection_only: true,
    queue_record_proof: "NOT_COLLECTED_USE_EXACT_CORRELATION_LOGS",
  });
};
