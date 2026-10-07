// Import-free: executed as a data-URL module by the bounded read-only reader.
// Only tenant-scoped metadata is selected. No message content or identifiers
// belonging to customers/provider accounts are emitted.
export const completionScope = Object.freeze({
  organization: "01a0ee39-91a9-7293-82c0-5b7046c10115",
  conversation: "01a1067f-d7d8-7e7e-9fb0-39bfe2f7cdc7",
  from: "2026-10-07T13:35:00Z",
  until: "2026-10-08T00:00:00Z",
  start: "2026-10-08T12:00:00Z",
  end: "2026-10-08T12:30:00Z",
});
export const completionAssertions = Object.freeze([
  "completion_request",
  "completion_transitions",
  "completion_customer_evidence",
  "completion_offer_delivery",
  "completion_confirmation_delivery",
  "completion_audits",
  "completion_lead",
  "completion_provider_runs",
]);
const profile = "s18_customer_confirmation.v1";
const uuid = (value) =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(value);
const integer = (value) => {
  const text = typeof value === "number" && Number.isSafeInteger(value) ? String(value) : value;
  return typeof text === "string" && /^(0|[1-9][0-9]{0,17})$/u.test(text) ? BigInt(text) : null;
};
const instant = (value) => {
  const result = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(result) ? result : null;
};
const equalTime = (left, right) => instant(left) !== null && instant(left) === instant(right);
const allTrue = (row, keys) => keys.every((key) => row?.[key] === true);
const sent = (row) => row?.delivery_status === "sent" || row?.delivery_status === "delivered";
const project = (rows, keys) =>
  rows.map((row) => Object.fromEntries(keys.map((key) => [key, row[key] ?? null])));
const scopeWhere = `r.organization_id=$1 and r.conversation_id=$2 and r.id=$5
  and r.created_at >= $3::timestamptz and r.created_at < $4::timestamptz`;

/** Expected exhaustion closes this cohort; it is not a failure to account for it.
 * Historical NULL costs stay unknown; this proves the approved budget reserve,
 * new known costs, immutable dispatch slots and zero pending liabilities only. */
export const completionAccountingPass = (snapshot, collected) => {
  const cost = integer(snapshot?.knownCostMicros);
  const exposure = integer(snapshot?.combinedExposureMicros);
  const continuationCost = integer(collected?.continuationCostMicros);
  return (
    collected?.providerPass === true &&
    (collected.continuationCalls === 1 || collected.continuationCalls === 2) &&
    snapshot?.profile === "s22-synthetic-booking.v1" &&
    snapshot.mode === "booking" &&
    snapshot.logicalMessages === 4 &&
    snapshot.physicalCalls === 3 + collected.continuationCalls &&
    snapshot.blocked === true &&
    snapshot.reason === (snapshot.physicalCalls === 4 ? "message_limit" : "attempt_limit") &&
    snapshot.accountingComplete === false &&
    snapshot.unresolvedReserveMicros === "0" &&
    snapshot.historicalReserveMicros === "1033396" &&
    snapshot.perCallReserveMicros === "801432" &&
    typeof snapshot.knownCostMicros === "string" &&
    typeof snapshot.combinedExposureMicros === "string" &&
    typeof collected.continuationCostMicros === "string" &&
    cost !== null &&
    continuationCost !== null &&
    cost >= 6207n &&
    cost <= 1609071n &&
    cost === 6207n + continuationCost &&
    exposure === 1033396n + cost &&
    exposure <= 2642467n &&
    exposure < 10000000n
  );
};

export const collectCompletionEvidence = async (read, report) => {
  const s = completionScope;
  const namedRead = async (name, text, args) => {
    try {
      return await read(text, args);
    } catch (error) {
      const state =
        typeof error?.code === "string" && /^[0-9A-Z]{5}$/u.test(error.code)
          ? error.code
          : "READ_FAILED";
      throw Object.assign(new Error(), { code: `COMPLETION_${name}_${state}` });
    }
  };
  const discovery = await namedRead(
    "REQUEST",
    `select r.id::text,r.status,r.version::text,r.offer_version,r.start_at,r.end_at,
      r.offered_time_zone,r.confirmation_issued_at,r.offer_expires_at,r.confirmed_at,
      r.confirmation_source,r.staff_decided_at,r.source_message_id::text
      from appointment_requests r where r.organization_id=$1 and r.conversation_id=$2
      and r.created_at >= $3::timestamptz and r.created_at < $4::timestamptz
      order by r.created_at,r.id limit 2`,
    [s.conversation, s.from, s.until],
  );
  // An ambiguous discovery never substitutes a different handoff/request ID.
  const request = discovery.length === 1 && uuid(discovery[0]?.id) ? discovery[0] : null;
  const args = [s.conversation, s.from, s.until, request?.id ?? null];
  const transitions = await namedRead(
    "TRANSITIONS",
    `select t.id::text,t.from_status,t.to_status,t.aggregate_version::text,t.command,
      t.offer_version,t.actor_type,t.source_message_id::text,t.correlation_id::text,t.occurred_at,
      case t.actor_type when 'customer' then t.actor_contact_id=r.contact_id
        when 'member' then t.actor_membership_id=r.staff_decided_by_membership_id
        else t.actor_contact_id is null and t.actor_membership_id is null end as actor_binding
      from appointment_request_transitions t join appointment_requests r
      on r.organization_id=t.organization_id and r.id=t.appointment_request_id
      where ${scopeWhere} and t.organization_id=$1
      order by t.aggregate_version,t.id limit 5`,
    args,
  );
  const evidence = await namedRead(
    "CUSTOMER_EVIDENCE",
    `select e.id::text,e.offer_version,e.outcome,e.source,e.source_message_id::text,
      e.customer_acted_at,e.recorded_at,e.correlation_id::text,
      (e.customer_contact_id=r.contact_id and e.recorded_by_membership_id is null
        and e.attestation_method is null) as customer_bound,
      (m.conversation_id=r.conversation_id and m.channel_connection_id=c.channel_connection_id
        and cc.channel_type='instagram') as channel_bound,
      (m.direction='inbound' and m.sender_type='customer' and m.sender_contact_id=r.contact_id
        and m.processing_status='processed' and m.ai_run_id is null
        and e.customer_acted_at=m.created_at) as source_bound,
      (e.offer_version=r.offer_version and e.recorded_at=r.confirmed_at) as offer_bound,
      (e.customer_acted_at >= r.confirmation_issued_at and e.customer_acted_at < r.offer_expires_at
        and e.recorded_at >= e.customer_acted_at and e.recorded_at < r.offer_expires_at
        and m.external_sent_at >= r.confirmation_issued_at
        and m.external_sent_at <= m.created_at) as within_window
      from appointment_confirmation_evidence e join appointment_requests r
      on r.organization_id=e.organization_id and r.id=e.appointment_request_id
      join conversations c on c.organization_id=r.organization_id and c.id=r.conversation_id
      join channel_connections cc on cc.organization_id=c.organization_id and cc.id=c.channel_connection_id
      left join messages m on m.organization_id=e.organization_id and m.id=e.source_message_id
      where ${scopeWhere} and e.organization_id=$1 order by e.recorded_at,e.id limit 2`,
    args,
  );
  const prompts = await namedRead(
    "OFFER_DELIVERY",
    `select m.id::text,m.direction,m.processing_status,m.delivery_status,m.sequence_no::text,
      m.reply_to_message_id::text,m.ai_run_id::text,m.created_at,t.correlation_id::text,
      m.knowledge_manifest_jsonb->>'confirmation_kind' as confirmation_kind,
      (m.knowledge_manifest_jsonb->>'confirmation_request_id'=r.id::text
        and m.knowledge_manifest_jsonb->>'confirmation_offer_version'=r.offer_version::text
        and t.offer_version=r.offer_version and m.created_at=t.occurred_at
        and m.created_at=r.confirmation_issued_at) as offer_bound,
      (customer.sequence_no>m.sequence_no and customer.created_at>=m.created_at) as customer_after_prompt,
      (o.id is not null and o.correlation_id=t.correlation_id) as source_bound
      from messages m join appointment_requests r on r.organization_id=m.organization_id
        and r.conversation_id=m.conversation_id
      join appointment_request_transitions t on t.organization_id=r.organization_id
        and t.appointment_request_id=r.id and t.command='prepare_customer_confirmation'
        and t.to_status='awaiting_customer_confirmation' and m.created_at=t.occurred_at
      left join appointment_confirmation_evidence e on e.organization_id=r.organization_id
        and e.appointment_request_id=r.id and e.offer_version=r.offer_version
      left join messages customer on customer.organization_id=e.organization_id and customer.id=e.source_message_id
      left join outbox_events o on o.organization_id=m.organization_id and o.aggregate_id=$2
        and o.event_type='message.response_queued' and o.payload_jsonb->'payload'->>'message_id'=m.id::text
      where ${scopeWhere} and m.organization_id=$1 and m.direction='outbound'
      and m.knowledge_manifest_jsonb->>'confirmation_profile'=$6
      and m.knowledge_manifest_jsonb->>'confirmation_kind'='prompt'
      order by m.sequence_no,m.id limit 2`,
    [...args, profile],
  );
  const acknowledgments = await namedRead(
    "CONFIRMATION_DELIVERY",
    `select m.id::text,m.direction,m.processing_status,m.delivery_status,m.sequence_no::text,
      m.reply_to_message_id::text,m.ai_run_id::text,m.created_at,o.correlation_id::text,
      m.knowledge_manifest_jsonb->>'confirmation_kind' as confirmation_kind,
      (m.created_at=e.recorded_at and m.reply_to_message_id=e.source_message_id
        and o.correlation_id=e.correlation_id) as source_bound
      from messages m join appointment_requests r on r.organization_id=m.organization_id
        and r.conversation_id=m.conversation_id
      join appointment_confirmation_evidence e on e.organization_id=r.organization_id
        and e.appointment_request_id=r.id and e.offer_version=r.offer_version
        and m.reply_to_message_id=e.source_message_id
      left join outbox_events o on o.organization_id=m.organization_id and o.aggregate_id=$2
        and o.event_type='message.response_queued' and o.payload_jsonb->'payload'->>'message_id'=m.id::text
      where ${scopeWhere} and m.organization_id=$1 and m.direction='outbound'
      and m.knowledge_manifest_jsonb->>'confirmation_profile'=$6
      and m.knowledge_manifest_jsonb->>'confirmation_kind'='confirmed'
      order by m.sequence_no,m.id limit 2`,
    [...args, profile],
  );
  const audits = await namedRead(
    "AUDITS",
    `select a.id::text,a.target_type,a.action,a.result,a.actor_type,a.correlation_id::text,a.occurred_at,
      a.metadata_redacted_jsonb->>'staff_operation' as staff_operation,
      a.metadata_redacted_jsonb->>'expected_version' as expected_version,
      case when a.actor_type='member' then a.actor_id=a.actor_membership_id
        and a.actor_membership_id=r.staff_decided_by_membership_id
        else a.actor_type='customer' and a.actor_id=r.contact_id and a.actor_membership_id is null end as actor_binding,
      (member.status='active' and member.role='owner') as owner_active,
      (select count(*)=1 from (select id from memberships own where own.organization_id=$1
        and own.status='active' and own.role='owner' limit 2) owners) as owner_unique,
      exists(select 1 from appointment_request_transitions t where t.organization_id=$1
        and t.appointment_request_id=r.id and t.correlation_id=a.correlation_id
        and t.occurred_at=a.occurred_at and t.actor_type=a.actor_type
        and ((a.actor_type='member' and t.command='staff_accept_appointment_request'
          and t.actor_membership_id=a.actor_membership_id)
          or (a.actor_type='customer' and t.command='confirm_appointment_request'
            and t.actor_contact_id=a.actor_id)) limit 1) as transition_bound
      from audit_events a join appointment_requests r on r.organization_id=a.organization_id
      left join memberships member on member.organization_id=a.organization_id and member.id=a.actor_membership_id
      where ${scopeWhere} and a.organization_id=$1 and a.result='succeeded'
      and a.occurred_at >= $3::timestamptz and a.occurred_at < $4::timestamptz
      and ((a.target_type='appointment_request' and a.target_id=r.id
        and a.action='appointment_request.transition' and a.metadata_redacted_jsonb->>'staff_operation'='accept')
        or (a.target_type='appointment_request' and a.target_id=r.id and a.action='appointment_request.transition'
          and a.actor_type='customer' and a.metadata_redacted_jsonb->>'confirmation_profile'=$6)
        or (a.target_type='lead' and a.target_id=r.lead_id and a.action='lead.transition'
          and a.actor_type='customer' and a.metadata_redacted_jsonb->>'confirmation_profile'=$6))
      order by a.occurred_at,a.id limit 4`,
    [...args, profile],
  );
  const leads = await namedRead(
    "LEAD",
    `select l.status,l.version::text,l.converted_at,o.event_type,o.aggregate_version::text,
      o.correlation_id::text,o.occurred_at,
      (o.occurred_at=r.confirmed_at and o.aggregate_version=l.version
        and o.payload_jsonb->'payload'->>'lead_status'='converted'
        and o.correlation_id=e.correlation_id) as appointment_bound
      from leads l join appointment_requests r on r.organization_id=l.organization_id and r.lead_id=l.id
      left join appointment_confirmation_evidence e on e.organization_id=r.organization_id
        and e.appointment_request_id=r.id and e.offer_version=r.offer_version
      left join outbox_events o on o.organization_id=l.organization_id and o.aggregate_id=l.id
        and o.aggregate_type='lead' and o.event_type='lead.converted'
        and o.occurred_at >= $3::timestamptz and o.occurred_at < $4::timestamptz
      where ${scopeWhere} and l.organization_id=$1 order by o.occurred_at,o.id limit 2`,
    args,
  );
  const runs = await namedRead(
    "PROVIDER_RUNS",
    `select run.id::text,run.status,run.attempt_no,run.trigger_message_id::text,run.provider_id,run.cost_currency,
      run.schema_valid,run.policy_allowed,run.cost_catalog_version,run.requested_model_id,
      run.provider_resolved_model_id,run.estimated_cost_micros::text,run.input_units::text,
      run.output_units::text,run.cached_input_units::text,run.total_units::text,run.finished_at,
      run.correlation_id::text,(run.trigger_message_id=r.source_message_id) as booking_trigger,
      (select count(*) from (select a.id from audit_events a where a.organization_id=$1
        and a.target_type='ai_run' and a.target_id=run.id and a.action='ai_run.dispatch_reserved' limit 3) slots) as reservations,
      (select count(*) from (select a.id from audit_events a where a.organization_id=$1
        and a.target_type='ai_run' and a.target_id=run.id and a.action='ai_run.journey_started' limit 3) starts) as journey_starts,
      (select a.metadata_redacted_jsonb->>'reservation_micros' from audit_events a
        where a.organization_id=$1 and a.target_type='ai_run' and a.target_id=run.id
        and a.action='ai_run.dispatch_reserved' order by a.occurred_at,a.id limit 1) as reserved_micros,
      exists(select 1 from audit_events a where a.organization_id=$1 and a.target_type='ai_run'
        and a.target_id=run.id and a.action='ai_run.dispatch_reserved'
        and a.metadata_redacted_jsonb->>'profile'='s22-synthetic-booking.v1'
        and a.metadata_redacted_jsonb->>'historical_reserve_micros'='1033396'
        and a.metadata_redacted_jsonb->>'input_token_limit'='1048576'
        and a.metadata_redacted_jsonb->>'output_token_limit'='4000'
        and run.provider_id='gemini' and run.cost_currency='USD'
        and run.input_units between 0 and 1048576 and run.output_units between 0 and 4000
        limit 1) as approved_limits
      from ai_runs run join appointment_requests r on r.organization_id=run.organization_id
        and r.conversation_id=run.conversation_id
      where ${scopeWhere} and run.organization_id=$1
        and run.started_at >= $3::timestamptz and run.started_at < $4::timestamptz
      order by run.started_at,run.id limit 3`,
    args,
  );
  const requestPass =
    request !== null &&
    request.status === "confirmed" &&
    integer(request.version) === 4n &&
    integer(request.offer_version) === 1n &&
    equalTime(request.start_at, s.start) &&
    equalTime(request.end_at, s.end) &&
    request.offered_time_zone === "Asia/Tashkent" &&
    request.confirmation_source === "instagram" &&
    uuid(request.source_message_id) &&
    instant(request.staff_decided_at) !== null &&
    instant(request.confirmed_at) !== null;
  const lifecycle = [
    [null, "requested", "create_appointment_request", "customer"],
    ["requested", "staff_accepted", "staff_accept_appointment_request", "member"],
    ["staff_accepted", "awaiting_customer_confirmation", "prepare_customer_confirmation", "system"],
    ["awaiting_customer_confirmation", "confirmed", "confirm_appointment_request", "customer"],
  ];
  const transitionPass =
    transitions.length === 4 &&
    transitions.every((row, index) => {
      const expected = lifecycle[index];
      return (
        uuid(row.id) &&
        row.from_status === expected[0] &&
        row.to_status === expected[1] &&
        row.command === expected[2] &&
        row.actor_type === expected[3] &&
        row.actor_binding === true &&
        integer(row.aggregate_version) === BigInt(index + 1) &&
        uuid(row.correlation_id) &&
        instant(row.occurred_at) !== null &&
        (index === 0
          ? row.offer_version === null
          : integer(row.offer_version) === integer(request?.offer_version)) &&
        (index === 0 ? row.source_message_id === request?.source_message_id : true) &&
        (index === 1 ? equalTime(row.occurred_at, request?.staff_decided_at) : true) &&
        (index === 2 ? equalTime(row.occurred_at, request?.confirmation_issued_at) : true) &&
        (index === 3 ? equalTime(row.occurred_at, request?.confirmed_at) : true) &&
        (index === 0 || instant(row.occurred_at) >= instant(transitions[index - 1].occurred_at))
      );
    }) &&
    transitions[1].correlation_id === transitions[2].correlation_id;
  const customer = evidence[0];
  const evidencePass =
    evidence.length === 1 &&
    uuid(customer?.id) &&
    customer.outcome === "confirmed" &&
    customer.source === "instagram" &&
    integer(customer.offer_version) === integer(request?.offer_version) &&
    uuid(customer.source_message_id) &&
    customer.source_message_id !== request?.source_message_id &&
    allTrue(customer, [
      "customer_bound",
      "channel_bound",
      "source_bound",
      "offer_bound",
      "within_window",
    ]) &&
    customer.source_message_id === transitions[3]?.source_message_id &&
    customer.correlation_id === transitions[3]?.correlation_id &&
    equalTime(customer.recorded_at, transitions[3]?.occurred_at);
  const prompt = prompts[0];
  const promptPass =
    prompts.length === 1 &&
    uuid(prompt?.id) &&
    sent(prompt) &&
    prompt.direction === "outbound" &&
    prompt.processing_status === "processed" &&
    prompt.ai_run_id === null &&
    prompt.confirmation_kind === "prompt" &&
    integer(prompt.sequence_no) !== null &&
    allTrue(prompt, ["offer_bound", "customer_after_prompt", "source_bound"]) &&
    prompt.correlation_id === transitions[2]?.correlation_id;
  const acknowledgment = acknowledgments[0];
  const acknowledgmentPass =
    acknowledgments.length === 1 &&
    uuid(acknowledgment?.id) &&
    sent(acknowledgment) &&
    acknowledgment.direction === "outbound" &&
    acknowledgment.processing_status === "processed" &&
    acknowledgment.ai_run_id === null &&
    acknowledgment.confirmation_kind === "confirmed" &&
    acknowledgment.source_bound === true &&
    acknowledgment.reply_to_message_id === customer?.source_message_id &&
    acknowledgment.correlation_id === customer?.correlation_id &&
    equalTime(acknowledgment.created_at, customer?.recorded_at) &&
    integer(acknowledgment.sequence_no) !== null &&
    integer(prompt?.sequence_no) !== null &&
    integer(acknowledgment.sequence_no) > integer(prompt.sequence_no);
  const staffAudits = audits.filter((row) => row.staff_operation === "accept");
  const confirmationAudits = audits.filter((row) => row.actor_type === "customer");
  const auditPass =
    audits.length === 3 &&
    staffAudits.length === 1 &&
    confirmationAudits.length === 2 &&
    new Set(confirmationAudits.map((row) => row.target_type)).size === 2 &&
    confirmationAudits.some((row) => row.target_type === "appointment_request") &&
    confirmationAudits.some((row) => row.target_type === "lead") &&
    audits.every(
      (row) =>
        uuid(row.id) &&
        row.result === "succeeded" &&
        row.action === `${row.target_type}.transition` &&
        allTrue(row, ["actor_binding", "transition_bound"]),
    ) &&
    staffAudits[0].actor_type === "member" &&
    staffAudits[0].target_type === "appointment_request" &&
    allTrue(staffAudits[0], ["owner_active", "owner_unique"]) &&
    integer(staffAudits[0].expected_version) === 1n &&
    staffAudits[0].correlation_id === transitions[1]?.correlation_id &&
    confirmationAudits.every(
      (row) =>
        integer(row.expected_version) === 3n &&
        row.correlation_id === customer?.correlation_id &&
        equalTime(row.occurred_at, customer?.recorded_at),
    );
  const lead = leads[0];
  const leadPass =
    leads.length === 1 &&
    lead?.status === "converted" &&
    integer(lead.version) !== null &&
    integer(lead.version) > 0n &&
    lead.event_type === "lead.converted" &&
    lead.appointment_bound === true &&
    integer(lead.aggregate_version) === integer(lead.version) &&
    lead.correlation_id === customer?.correlation_id &&
    equalTime(lead.converted_at, request?.confirmed_at);
  const costs = runs.map((row) => integer(row.estimated_cost_micros));
  const providerPass =
    runs.length >= 1 &&
    runs.length <= 2 &&
    new Set(runs.map((row) => row.id)).size === runs.length &&
    new Set(runs.map((row) => row.attempt_no)).size === runs.length &&
    runs.some(
      (row) =>
        row.status === "succeeded" && row.schema_valid === true && row.policy_allowed === true,
    ) &&
    runs.every(
      (row, index) =>
        uuid(row.id) &&
        row.booking_trigger === true &&
        row.trigger_message_id === request?.source_message_id &&
        integer(row.attempt_no) === BigInt(index + 1) &&
        row.requested_model_id === "gemini-3.8-flash" &&
        row.provider_resolved_model_id === "gemini-3.8-flash" &&
        row.provider_id === "gemini" &&
        row.cost_currency === "USD" &&
        row.cost_catalog_version === "ai-provider-prices.2026-09-17.v1" &&
        integer(row.input_units) !== null &&
        integer(row.input_units) <= 1048576n &&
        integer(row.output_units) !== null &&
        integer(row.output_units) <= 4000n &&
        integer(row.cached_input_units) !== null &&
        integer(row.cached_input_units) <= integer(row.input_units) &&
        integer(row.total_units) !== null &&
        integer(row.total_units) === integer(row.input_units) + integer(row.output_units) &&
        row.status !== "started" &&
        instant(row.finished_at) !== null &&
        costs[index] !== null &&
        costs[index] <= 801432n &&
        integer(row.reservations) === 1n &&
        integer(row.journey_starts) === 1n &&
        row.reserved_micros === "801432" &&
        row.approved_limits === true &&
        row.correlation_id === transitions[0]?.correlation_id,
    );
  const continuationCostMicros = providerPass
    ? costs.reduce((sum, cost) => sum + cost, 0n).toString()
    : null;
  const observations = [
    [
      requestPass,
      {
        request_count: discovery.length,
        rows: project(discovery, [
          "id",
          "status",
          "version",
          "offer_version",
          "start_at",
          "end_at",
          "offered_time_zone",
          "confirmation_issued_at",
          "offer_expires_at",
          "confirmed_at",
          "confirmation_source",
          "staff_decided_at",
          "source_message_id",
        ]),
      },
    ],
    [
      transitionPass,
      {
        rows: project(transitions, [
          "id",
          "from_status",
          "to_status",
          "aggregate_version",
          "command",
          "offer_version",
          "actor_type",
          "source_message_id",
          "correlation_id",
          "occurred_at",
          "actor_binding",
        ]),
      },
    ],
    [
      evidencePass,
      {
        rows: project(evidence, [
          "id",
          "offer_version",
          "outcome",
          "source",
          "source_message_id",
          "customer_acted_at",
          "recorded_at",
          "correlation_id",
          "customer_bound",
          "channel_bound",
          "source_bound",
          "offer_bound",
          "within_window",
        ]),
      },
    ],
    [
      promptPass,
      {
        rows: project(prompts, [
          "id",
          "direction",
          "processing_status",
          "delivery_status",
          "sequence_no",
          "reply_to_message_id",
          "ai_run_id",
          "created_at",
          "correlation_id",
          "confirmation_kind",
          "offer_bound",
          "customer_after_prompt",
          "source_bound",
        ]),
      },
    ],
    [
      acknowledgmentPass,
      {
        rows: project(acknowledgments, [
          "id",
          "direction",
          "processing_status",
          "delivery_status",
          "sequence_no",
          "reply_to_message_id",
          "ai_run_id",
          "created_at",
          "correlation_id",
          "confirmation_kind",
          "source_bound",
        ]),
      },
    ],
    [
      auditPass,
      {
        rows: project(audits, [
          "id",
          "target_type",
          "action",
          "result",
          "actor_type",
          "staff_operation",
          "expected_version",
          "correlation_id",
          "occurred_at",
          "actor_binding",
          "transition_bound",
          "owner_active",
          "owner_unique",
        ]),
      },
    ],
    [
      leadPass,
      {
        rows: project(leads, [
          "status",
          "version",
          "converted_at",
          "event_type",
          "aggregate_version",
          "correlation_id",
          "occurred_at",
          "appointment_bound",
        ]),
      },
    ],
    [
      providerPass,
      {
        continuation_cost_micros: continuationCostMicros,
        total_runs: runs.length,
        confirmation_calls: runs.filter((row) => row.booking_trigger !== true).length,
        rows: project(runs, [
          "id",
          "status",
          "attempt_no",
          "trigger_message_id",
          "provider_id",
          "cost_currency",
          "schema_valid",
          "policy_allowed",
          "cost_catalog_version",
          "requested_model_id",
          "provider_resolved_model_id",
          "estimated_cost_micros",
          "input_units",
          "output_units",
          "cached_input_units",
          "total_units",
          "finished_at",
          "correlation_id",
          "booking_trigger",
          "reservations",
          "journey_starts",
          "reserved_micros",
          "approved_limits",
        ]),
      },
    ],
  ];
  observations.forEach(([pass, observed], index) =>
    report(completionAssertions[index], pass, observed),
  );
  return Object.freeze({
    continuationCostMicros,
    continuationCalls: providerPass ? runs.length : null,
    providerPass,
  });
};
