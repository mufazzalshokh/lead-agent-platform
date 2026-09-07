import {
  DomainEventSchemasByVersion,
  isSchemaValue,
  type ActorRef,
  type AggregateVersion,
  type OrganizationId,
  type UtcTimestamp,
} from "@lead-agent/contracts";
import {
  validateAppointmentRequest,
  validateConversation,
  validateHandoff,
  validateLead,
} from "@lead-agent/domain";
import type { QueryResultRow } from "pg";

import { markTenantTransactionRollbackOnly, type TenantDbSession } from "../runtime/tenant.js";
import {
  InvalidRepositoryMutationPlanError,
  RepositoryDatabaseError,
  RepositoryNotFoundError,
  RepositoryOwnershipValidationError,
  RepositoryStructuralConflictError,
  RepositoryVersionConflictError,
  executeTenantRead,
  executeTenantWrite,
  mapAggregateVersion,
  mapRepositoryFailure,
  type RepositoryResource,
} from "./shared.js";
import type {
  AppointmentConfirmationEvidencePersistence,
  CoreAggregateMutation,
  CoreDomainEvent,
  CoreTransitionPersistence,
  DomainEventAppend,
  DomainMutationPlan,
  PersistedDomainMutation,
  TenantMutationAudit,
} from "./mutation-types.js";

export type * from "./mutation-types.js";

type CoreAggregateType = CoreAggregateMutation["aggregateType"];

type AggregateDescriptor = Readonly<{
  id: string;
  resource: RepositoryResource;
  type: CoreAggregateType;
  version: AggregateVersion;
}>;

const CORE_AGGREGATE_TYPES = ["appointment_request", "conversation", "handoff", "lead"] as const;

const invalidPlan = (): never => {
  throw new InvalidRepositoryMutationPlanError();
};

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const jsonValuesEqual = (left: unknown, right: unknown): boolean => {
  if (Object.is(left, right)) {
    return true;
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((entry, index) => jsonValuesEqual(entry, right[index]))
    );
  }
  if (!isRecord(left) || !isRecord(right)) {
    return false;
  }
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key, index) => key === rightKeys[index] && jsonValuesEqual(left[key], right[key]),
    )
  );
};

const aggregateDescriptor = (mutation: CoreAggregateMutation): AggregateDescriptor => {
  switch (mutation.aggregateType) {
    case "appointment_request":
      return {
        id: mutation.nextAggregate.appointmentRequestId,
        resource: "appointment_request",
        type: mutation.aggregateType,
        version: mutation.nextAggregate.version,
      };
    case "conversation":
      return {
        id: mutation.nextAggregate.conversationId,
        resource: "conversation",
        type: mutation.aggregateType,
        version: mutation.nextAggregate.version,
      };
    case "handoff":
      return {
        id: mutation.nextAggregate.handoffId,
        resource: "handoff",
        type: mutation.aggregateType,
        version: mutation.nextAggregate.version,
      };
    case "lead":
      return {
        id: mutation.nextAggregate.leadId,
        resource: "lead",
        type: mutation.aggregateType,
        version: mutation.nextAggregate.version,
      };
  }
};

const aggregateKey = (type: CoreAggregateType, id: string): string => `${type}:${id}`;

const transitionDescriptor = (
  transition: CoreTransitionPersistence,
): AggregateDescriptor &
  Readonly<{ actor: ActorRef; fromStatus: string | null; toStatus: string }> => {
  switch (transition.transitionType) {
    case "appointment_request":
      return {
        actor: transition.record.actor,
        fromStatus: transition.record.fromStatus,
        id: transition.record.appointmentRequestId,
        resource: "appointment_request",
        toStatus: transition.record.toStatus,
        type: "appointment_request",
        version: transition.record.version,
      };
    case "conversation":
      return {
        actor: transition.record.actor,
        fromStatus: transition.record.fromStatus,
        id: transition.record.conversationId,
        resource: "conversation",
        toStatus: transition.record.toStatus,
        type: "conversation",
        version: transition.record.version,
      };
    case "handoff":
      return {
        actor: transition.record.actor,
        fromStatus: transition.record.fromStatus,
        id: transition.record.handoffId,
        resource: "handoff",
        toStatus: transition.record.toStatus,
        type: "handoff",
        version: transition.record.version,
      };
    case "lead":
      return {
        actor: transition.record.actor,
        fromStatus: transition.record.fromStatus,
        id: transition.record.leadId,
        resource: "lead",
        toStatus: transition.record.toStatus,
        type: "lead",
        version: transition.record.version,
      };
  }
};

const occurredAtFor = (
  mutation: CoreAggregateMutation,
  transitions: readonly CoreTransitionPersistence[],
): UtcTimestamp => {
  const descriptor = aggregateDescriptor(mutation);
  const matching = transitions.filter((transition) => {
    const candidate = transitionDescriptor(transition);
    return candidate.type === descriptor.type && candidate.id === descriptor.id;
  });
  const last = matching.at(-1);
  return last?.record.occurredAt ?? invalidPlan();
};

const validateAggregate = (
  mutation: CoreAggregateMutation,
  organizationId: OrganizationId,
): void => {
  if (mutation.nextAggregate.organizationId !== organizationId) {
    invalidPlan();
  }
  const validation = (() => {
    switch (mutation.aggregateType) {
      case "appointment_request":
        return validateAppointmentRequest(mutation.nextAggregate);
      case "conversation":
        return validateConversation(mutation.nextAggregate);
      case "handoff":
        return validateHandoff(mutation.nextAggregate);
      case "lead":
        return validateLead(mutation.nextAggregate);
    }
  })();
  if (!validation.ok) {
    invalidPlan();
  }
  if (mutation.mode === "create" && mutation.nextAggregate.version !== 1) {
    invalidPlan();
  }
  if (mutation.mode === "update" && mutation.nextAggregate.version <= mutation.expectedVersion) {
    invalidPlan();
  }
};

const validateActorForTenantHistory = (actor: ActorRef): void => {
  if (actor.actor_type === "platform_operator") {
    invalidPlan();
  }
};

const validateEventEnvelope = (append: DomainEventAppend): void => {
  const eventEntry = Object.entries(DomainEventSchemasByVersion).find(
    ([eventType]) => eventType === append.envelope.event_type,
  );
  const schemaEntry =
    eventEntry === undefined
      ? undefined
      : Object.entries(eventEntry[1]).find(
          ([schemaVersion]) => schemaVersion === append.envelope.schema_version,
        );
  if (schemaEntry === undefined || !isSchemaValue(schemaEntry[1], append.envelope)) {
    invalidPlan();
  }
  if (
    append.draft.aggregate_version !== append.envelope.aggregate_version ||
    append.draft.event_type !== append.envelope.event_type ||
    append.draft.schema_id !== append.envelope.schema_id ||
    append.draft.schema_version !== append.envelope.schema_version ||
    !jsonValuesEqual(append.draft.payload, append.envelope.payload)
  ) {
    invalidPlan();
  }
};

type ValidatedPlan = Readonly<{
  aggregateByKey: ReadonlyMap<string, CoreAggregateMutation>;
  transitionsByKey: ReadonlyMap<string, readonly CoreTransitionPersistence[]>;
}>;

const expectedEventTypes = (transition: CoreTransitionPersistence): readonly string[] => {
  switch (transition.transitionType) {
    case "lead": {
      const byCommand = {
        close_lead: ["lead.closed"],
        convert_lead: ["lead.converted"],
        create_lead: ["lead.created"],
        disqualify_lead: ["lead.disqualified"],
        qualify_lead: ["lead.qualified"],
        record_appointment_request: ["lead.booking_requested"],
        record_engagement: ["lead.engaged"],
        reopen_disqualified_lead: ["lead.reopened"],
        restore_after_appointment_request: ["lead.reopened"],
      } as const;
      return byCommand[transition.record.command];
    }
    case "conversation": {
      const byCommand = {
        accept_customer_message: ["message.received", "conversation.status_changed"],
        close_conversation: ["conversation.closed"],
        create_conversation: ["conversation.started", "message.received"],
        queue_ai_response: ["message.response_queued", "conversation.status_changed"],
        queue_staff_response: ["message.response_queued", "conversation.status_changed"],
        record_staff_ownership: ["conversation.automation_mode_changed"],
        reopen_conversation: ["message.received", "conversation.status_changed"],
        resolve_conversation: ["conversation.resolved"],
        resume_ai: ["conversation.status_changed"],
        route_to_human: ["conversation.status_changed"],
        record_successor_handoff: [
          transition.record.fromAutomationMode === "paused"
            ? "conversation.active_handoff_changed"
            : "conversation.automation_mode_changed",
        ],
      } as const;
      return byCommand[transition.record.command];
    }
    case "appointment_request": {
      const byCommand = {
        cancel_appointment_request: ["appointment_request.cancelled"],
        confirm_appointment_request: ["appointment_request.confirmed"],
        create_appointment_request: ["appointment_request.created"],
        expire_appointment_request: ["appointment_request.expired"],
        prepare_customer_confirmation: ["appointment_request.customer_confirmation_requested"],
        reject_appointment_request: ["appointment_request.rejected"],
        staff_accept_appointment_request: ["appointment_request.staff_accepted"],
      } as const;
      return byCommand[transition.record.command];
    }
    case "handoff": {
      const byCommand = {
        assign_handoff: ["handoff.assigned"],
        cancel_handoff: ["handoff.cancelled"],
        expire_handoff: ["handoff.expired"],
        reassign_handoff: ["handoff.assigned"],
        request_handoff: ["handoff.requested"],
        resolve_handoff: ["handoff.resolved"],
        start_handoff: ["handoff.started"],
      } as const;
      if (transition.record.command === "claim_and_start_handoff") {
        return transition.record.toStatus === "assigned"
          ? ["handoff.assigned"]
          : ["handoff.started"];
      }
      return byCommand[transition.record.command];
    }
  }
};

const validatePlan = (organizationId: OrganizationId, plan: DomainMutationPlan): ValidatedPlan => {
  if (
    plan.aggregates.length === 0 ||
    plan.transitions.length === 0 ||
    plan.events.length === 0 ||
    plan.audits.length === 0
  ) {
    invalidPlan();
  }

  const aggregateByKey = new Map<string, CoreAggregateMutation>();
  for (const mutation of plan.aggregates) {
    validateAggregate(mutation, organizationId);
    const descriptor = aggregateDescriptor(mutation);
    const key = aggregateKey(descriptor.type, descriptor.id);
    if (aggregateByKey.has(key)) {
      invalidPlan();
    }
    aggregateByKey.set(key, mutation);
  }

  const transitionsByKey = new Map<string, CoreTransitionPersistence[]>();
  for (const transition of plan.transitions) {
    const descriptor = transitionDescriptor(transition);
    validateActorForTenantHistory(descriptor.actor);
    if (transition.record.organizationId !== organizationId) {
      invalidPlan();
    }
    const key = aggregateKey(descriptor.type, descriptor.id);
    if (!aggregateByKey.has(key)) {
      invalidPlan();
    }
    const group = transitionsByKey.get(key) ?? [];
    group.push(transition);
    transitionsByKey.set(key, group);

    if (transition.transitionType === "handoff") {
      const isTerminal = ["resolved", "cancelled", "expired"].includes(transition.record.toStatus);
      if (isTerminal !== (transition.conversationDisposition !== null)) {
        invalidPlan();
      }
    }
  }

  for (const mutation of plan.aggregates) {
    const descriptor = aggregateDescriptor(mutation);
    const transitions = transitionsByKey.get(aggregateKey(descriptor.type, descriptor.id));
    if (transitions === undefined || transitions.length === 0) {
      invalidPlan();
    }
    const verifiedTransitions = transitions ?? invalidPlan();
    let expected = mutation.mode === "create" ? 1 : mutation.expectedVersion + 1;
    for (const transition of verifiedTransitions) {
      const candidate = transitionDescriptor(transition);
      if (candidate.version !== expected) {
        invalidPlan();
      }
      expected += 1;
    }
    const last = transitionDescriptor(verifiedTransitions.at(-1) ?? invalidPlan());
    if (
      last.version !== descriptor.version ||
      last.toStatus !== mutation.nextAggregate.status ||
      (mutation.mode === "create" && verifiedTransitions[0]?.record.fromStatus !== null)
    ) {
      invalidPlan();
    }
  }

  const eventIds = new Set<string>();
  const eventsByTransitionKey = new Map<string, string[]>();
  for (const append of plan.events) {
    validateEventEnvelope(append);
    const event = append.envelope;
    if (
      event.organization_id !== organizationId ||
      !CORE_AGGREGATE_TYPES.some((type) => type === event.aggregate_type) ||
      eventIds.has(event.event_id)
    ) {
      invalidPlan();
    }
    eventIds.add(event.event_id);
    const key = aggregateKey(event.aggregate_type, event.aggregate_id);
    const transitions = transitionsByKey.get(key);
    if (transitions === undefined) {
      invalidPlan();
    }
    const verifiedTransitions = transitions ?? invalidPlan();
    const transition = verifiedTransitions.find(
      (candidate) => candidate.record.version === event.aggregate_version,
    );
    if (transition === undefined || !jsonValuesEqual(transition.record.actor, event.actor)) {
      invalidPlan();
    }
    const transitionKey = `${key}:${event.aggregate_version}`;
    const eventTypes = eventsByTransitionKey.get(transitionKey) ?? [];
    eventTypes.push(event.event_type);
    eventsByTransitionKey.set(transitionKey, eventTypes);
  }
  for (const transition of plan.transitions) {
    const descriptor = transitionDescriptor(transition);
    const actualEventTypes = eventsByTransitionKey.get(
      `${aggregateKey(descriptor.type, descriptor.id)}:${descriptor.version}`,
    );
    const expected = expectedEventTypes(transition);
    if (
      actualEventTypes === undefined ||
      actualEventTypes.length !== expected.length ||
      !actualEventTypes.every((eventType, index) => eventType === expected[index])
    ) {
      invalidPlan();
    }
  }

  const eventCorrelations = new Set(plan.events.map(({ envelope }) => envelope.correlation_id));
  for (const audit of plan.audits) {
    const key = aggregateKey(audit.target.targetType, audit.target.targetId);
    if (!aggregateByKey.has(key) || !eventCorrelations.has(audit.correlationId)) {
      invalidPlan();
    }
    if (
      (audit.actor.actor_type === "member" &&
        (audit.actorMembershipId === null ||
          String(audit.actorMembershipId) !== String(audit.actor.actor_id))) ||
      (audit.actor.actor_type !== "member" && audit.actorMembershipId !== null)
    ) {
      invalidPlan();
    }
  }

  const evidence = plan.confirmationEvidence ?? [];
  for (const append of evidence) {
    const key = aggregateKey("appointment_request", append.evidence.appointmentRequestId);
    const mutation = aggregateByKey.get(key);
    if (
      mutation?.aggregateType !== "appointment_request" ||
      mutation.nextAggregate.status !== "confirmed" ||
      mutation.nextAggregate.confirmationEvidence?.evidenceId !== append.evidence.evidenceId ||
      append.evidence.organizationId !== organizationId ||
      !jsonValuesEqual(mutation.nextAggregate.confirmationEvidence, append.evidence)
    ) {
      invalidPlan();
    }
  }
  for (const mutation of plan.aggregates) {
    if (
      mutation.aggregateType === "appointment_request" &&
      mutation.nextAggregate.status === "confirmed" &&
      mutation.nextAggregate.confirmationEvidence !== null &&
      !evidence.some(
        ({ evidence: candidate }) =>
          candidate.evidenceId === mutation.nextAggregate.confirmationEvidence?.evidenceId,
      )
    ) {
      invalidPlan();
    }
  }

  return Object.freeze({ aggregateByKey, transitionsByKey });
};

const validateOwnedReference = async (
  session: TenantDbSession,
  resource: "contact" | "membership",
  id: string,
): Promise<void> => {
  const table = resource === "contact" ? "contacts" : "memberships";
  const rows = await executeTenantRead<QueryResultRow>(
    session,
    `select id from ${table} where organization_id = $1 and id = $2`,
    [id],
  );
  if (rows.length === 0) {
    throw new RepositoryOwnershipValidationError(resource);
  }
};

const validateActorOwnership = async (
  session: TenantDbSession,
  transitions: readonly CoreTransitionPersistence[],
  audits: readonly TenantMutationAudit[],
): Promise<void> => {
  const validated = new Set<string>();
  const actors = [
    ...transitions.map(({ record }) => record.actor),
    ...audits.map(({ actor }) => actor),
  ];
  for (const actor of actors) {
    if (actor.actor_type === "system") {
      continue;
    }
    const resource = actor.actor_type === "member" ? "membership" : "contact";
    const key = `${resource}:${actor.actor_id}`;
    if (!validated.has(key)) {
      await validateOwnedReference(session, resource, actor.actor_id);
      validated.add(key);
    }
  }
};

const currentVersion = async (
  session: TenantDbSession,
  table: string,
  id: string,
  resource: RepositoryResource,
): Promise<AggregateVersion> => {
  type Row = QueryResultRow & { version: unknown };
  const rows = await executeTenantRead<Row>(
    session,
    `select version from ${table} where organization_id = $1 and id = $2`,
    [id],
  );
  const row = rows[0];
  if (row === undefined) {
    throw new RepositoryNotFoundError(resource);
  }
  return mapAggregateVersion(row.version);
};

const requireCasUpdated = async (
  session: TenantDbSession,
  result: Readonly<{ rowCount: number }>,
  table: string,
  id: string,
  expectedVersion: AggregateVersion,
  resource: RepositoryResource,
): Promise<void> => {
  if (result.rowCount === 1) {
    return;
  }
  if (result.rowCount !== 0) {
    invalidPlan();
  }
  const version = await currentVersion(session, table, id, resource);
  if (version !== expectedVersion) {
    throw new RepositoryVersionConflictError(resource, version);
  }
  invalidPlan();
};

const finalTransitionFor = (
  mutation: CoreAggregateMutation,
  validated: ValidatedPlan,
): CoreTransitionPersistence => {
  const descriptor = aggregateDescriptor(mutation);
  const transitions = validated.transitionsByKey.get(aggregateKey(descriptor.type, descriptor.id));
  return transitions?.at(-1) ?? invalidPlan();
};

const insertLead = async (
  session: TenantDbSession,
  mutation: Extract<CoreAggregateMutation, { aggregateType: "lead"; mode: "create" }>,
  occurredAt: UtcTimestamp,
): Promise<void> => {
  const lead = mutation.nextAggregate;
  await executeTenantWrite(
    session,
    `insert into leads
      (organization_id, id, contact_id, status, source_channel_connection_id,
       campaign_key, service_id, location_id, assigned_membership_id,
       qualification_policy_id, qualification_reason_codes, engaged_at,
       qualified_at, booking_requested_at, converted_at, closed_at, closed_reason,
       version, created_at, updated_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$19)`,
    [
      lead.leadId,
      lead.contactId,
      lead.status,
      mutation.storage.sourceChannelConnectionId,
      mutation.storage.campaignKey,
      mutation.storage.serviceId,
      mutation.storage.locationId,
      mutation.storage.assignedMembershipId,
      lead.qualification?.policyId ?? null,
      lead.qualification?.reasonCodes ?? [],
      null,
      null,
      null,
      null,
      null,
      null,
      lead.version,
      occurredAt,
    ],
  );
};

const updateLead = async (
  session: TenantDbSession,
  mutation: Extract<CoreAggregateMutation, { aggregateType: "lead"; mode: "update" }>,
  transition: CoreTransitionPersistence,
): Promise<void> => {
  if (transition.transitionType !== "lead") {
    invalidPlan();
  }
  const leadTransition = transition.transitionType === "lead" ? transition : invalidPlan();
  const lead = mutation.nextAggregate;
  const occurredAt = leadTransition.record.occurredAt;
  const closedReason = lead.status === "closed" ? leadTransition.record.reasonCodes[0] : null;
  const result = await executeTenantWrite(
    session,
    `update leads set
       status = $3::varchar, qualification_policy_id = $4,
       qualification_reason_codes = $5,
       engaged_at = case when $3::varchar = 'engaged' then coalesce(engaged_at, $6) else engaged_at end,
       qualified_at = case when $3::varchar = 'qualified' then coalesce(qualified_at, $6) else qualified_at end,
       booking_requested_at = case when $3::varchar = 'booking_requested' then coalesce(booking_requested_at, $6) else booking_requested_at end,
       converted_at = case when $3::varchar = 'converted' then coalesce(converted_at, $6) else converted_at end,
       closed_at = case when $3::varchar = 'closed' then $6 else null end,
       closed_reason = $7, version = $8, updated_at = $6
     where organization_id = $1 and id = $2 and version = $9`,
    [
      lead.leadId,
      lead.status,
      lead.qualification?.policyId ?? null,
      lead.qualification?.reasonCodes ?? [],
      occurredAt,
      closedReason,
      lead.version,
      mutation.expectedVersion,
    ],
  );
  await requireCasUpdated(session, result, "leads", lead.leadId, mutation.expectedVersion, "lead");
};

const insertConversation = async (
  session: TenantDbSession,
  mutation: Extract<CoreAggregateMutation, { aggregateType: "conversation"; mode: "create" }>,
  occurredAt: UtcTimestamp,
): Promise<void> => {
  const conversation = mutation.nextAggregate;
  await executeTenantWrite(
    session,
    `insert into conversations
      (organization_id, id, contact_id, lead_id, channel_connection_id,
       external_thread_hash, status, preferred_locale, automation_mode,
       active_handoff_id, next_sequence_no, started_at, last_activity_at,
       resolved_at, closed_at, version, created_at, updated_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,$11,null,null,$12,$11,$11)`,
    [
      conversation.conversationId,
      conversation.contactId,
      conversation.leadId,
      conversation.channelConnectionId,
      mutation.storage.externalThreadHash,
      conversation.status,
      mutation.storage.preferredLocale,
      conversation.automationMode,
      conversation.activeHandoff?.handoffId ?? null,
      occurredAt,
      conversation.version,
    ],
  );
};

const updateConversation = async (
  session: TenantDbSession,
  mutation: Extract<CoreAggregateMutation, { aggregateType: "conversation"; mode: "update" }>,
  occurredAt: UtcTimestamp,
): Promise<void> => {
  const conversation = mutation.nextAggregate;
  const result = await executeTenantWrite(
    session,
    `update conversations set
       status = $3::varchar, automation_mode = $4, active_handoff_id = $5,
       last_activity_at = greatest(last_activity_at, $6),
       resolved_at = case
          when $3::varchar = 'resolved' then coalesce(resolved_at, $6)
          when $3::varchar = 'closed' then resolved_at
         else null end,
       closed_at = case when $3::varchar = 'closed' then $6 else null end,
       version = $7, updated_at = $6
     where organization_id = $1 and id = $2 and version = $8`,
    [
      conversation.conversationId,
      conversation.status,
      conversation.automationMode,
      conversation.activeHandoff?.handoffId ?? null,
      occurredAt,
      conversation.version,
      mutation.expectedVersion,
    ],
  );
  await requireCasUpdated(
    session,
    result,
    "conversations",
    conversation.conversationId,
    mutation.expectedVersion,
    "conversation",
  );
};

const appointmentValues = (
  mutation: Extract<CoreAggregateMutation, { aggregateType: "appointment_request" }>,
) => {
  const request = mutation.nextAggregate;
  const decision = request.staffDecision;
  const cancellation = request.cancellation;
  return {
    cancellationReason: cancellation?.reasonCode ?? null,
    cancelledByType: cancellation?.actor.actor_type ?? null,
    confirmationSource: request.confirmationEvidence?.source ?? null,
    expiredAt: request.expiration?.expiredAt ?? null,
    offer: request.offer,
    rejectionReason: decision?.outcome === "rejected" ? decision.reasonCode : null,
    request,
    staffDecisionAt: decision?.decidedAt ?? null,
    staffDecisionMembershipId: decision?.membershipId ?? null,
    staffDecisionReason: decision?.outcome === "rejected" ? decision.reasonCode : null,
  };
};

const insertAppointmentRequest = async (
  session: TenantDbSession,
  mutation: Extract<
    CoreAggregateMutation,
    { aggregateType: "appointment_request"; mode: "create" }
  >,
): Promise<void> => {
  const value = appointmentValues(mutation);
  const request = value.request;
  await executeTenantWrite(
    session,
    `insert into appointment_requests
      (organization_id, id, lead_id, contact_id, conversation_id, source_message_id,
       service_id, service_version_id, location_id, location_version_id,
       business_policy_id, status, request_dedupe_key, customer_notes_ciphertext,
       staff_decided_by_membership_id, staff_decided_at, staff_decision_reason_code,
       start_at, end_at, offered_time_zone, offered_local_start, offer_version,
       confirmation_issued_at, offer_expires_at, confirmation_token_hash,
       confirmation_token_consumed_at, confirmed_at, confirmation_source,
       rejection_reason_code, cancellation_reason_code, cancelled_by_type,
       expired_at, version, created_at, updated_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,
       $18,$19,$20,$21,$22,$23,$24,null,null,$25,$26,$27,$28,$29,$30,$31,$32,$32)`,
    [
      request.appointmentRequestId,
      request.leadId,
      request.contactId,
      request.conversationId,
      request.sourceMessageId,
      request.serviceId,
      request.serviceVersionId,
      request.locationId,
      request.locationVersionId,
      request.businessPolicyId,
      request.status,
      mutation.storage.requestDedupeKey,
      mutation.storage.customerNotesCiphertext,
      value.staffDecisionMembershipId,
      value.staffDecisionAt,
      value.staffDecisionReason,
      value.offer?.startAt ?? null,
      value.offer?.endAt ?? null,
      value.offer?.timeZone ?? null,
      value.offer?.localStart ?? null,
      value.offer?.offerVersion ?? 0,
      request.confirmationOffer?.issuedAt ?? null,
      request.confirmationOffer?.expiresAt ?? null,
      request.confirmedAt,
      value.confirmationSource,
      value.rejectionReason,
      value.cancellationReason,
      value.cancelledByType,
      value.expiredAt,
      request.version,
      request.createdAt,
    ],
  );
  for (const preference of request.preferences) {
    await executeTenantWrite(
      session,
      `insert into appointment_request_preferences
        (organization_id, id, appointment_request_id, preference_order, start_at,
         end_at, time_zone, original_local_text_ciphertext, local_start, local_end,
         precision, created_at)
       values ($1,$2,$3,$4,$5,$6,$7,null,$8,$9,$10,$11)`,
      [
        preference.preferenceId,
        request.appointmentRequestId,
        preference.preferenceOrder,
        preference.startAt,
        preference.endAt,
        preference.timeZone,
        preference.localStart,
        preference.localEnd,
        preference.precision,
        request.createdAt,
      ],
    );
  }
};

const updateAppointmentRequest = async (
  session: TenantDbSession,
  mutation: Extract<
    CoreAggregateMutation,
    { aggregateType: "appointment_request"; mode: "update" }
  >,
  occurredAt: UtcTimestamp,
): Promise<void> => {
  const value = appointmentValues(mutation);
  const request = value.request;
  const tokenHashSupplied = Object.hasOwn(mutation.storage ?? {}, "confirmationTokenHash");
  const tokenConsumedSupplied = Object.hasOwn(
    mutation.storage ?? {},
    "confirmationTokenConsumedAt",
  );
  const result = await executeTenantWrite(
    session,
    `update appointment_requests set
       status=$3, staff_decided_by_membership_id=$4, staff_decided_at=$5,
       staff_decision_reason_code=$6, start_at=$7, end_at=$8,
       offered_time_zone=$9, offered_local_start=$10, offer_version=$11,
       confirmation_issued_at=$12, offer_expires_at=$13,
       confirmation_token_hash=case when $14 then $15 else confirmation_token_hash end,
       confirmation_token_consumed_at=case when $16 then $17 else confirmation_token_consumed_at end,
       confirmed_at=$18, confirmation_source=$19, rejection_reason_code=$20,
       cancellation_reason_code=$21, cancelled_by_type=$22, expired_at=$23,
       version=$24, updated_at=$25
     where organization_id=$1 and id=$2 and version=$26`,
    [
      request.appointmentRequestId,
      request.status,
      value.staffDecisionMembershipId,
      value.staffDecisionAt,
      value.staffDecisionReason,
      value.offer?.startAt ?? null,
      value.offer?.endAt ?? null,
      value.offer?.timeZone ?? null,
      value.offer?.localStart ?? null,
      value.offer?.offerVersion ?? 0,
      request.confirmationOffer?.issuedAt ?? null,
      request.confirmationOffer?.expiresAt ?? null,
      tokenHashSupplied,
      mutation.storage?.confirmationTokenHash ?? null,
      tokenConsumedSupplied,
      mutation.storage?.confirmationTokenConsumedAt ?? null,
      request.confirmedAt,
      value.confirmationSource,
      value.rejectionReason,
      value.cancellationReason,
      value.cancelledByType,
      value.expiredAt,
      request.version,
      occurredAt,
      mutation.expectedVersion,
    ],
  );
  await requireCasUpdated(
    session,
    result,
    "appointment_requests",
    request.appointmentRequestId,
    mutation.expectedVersion,
    "appointment_request",
  );
};

const insertHandoff = async (
  session: TenantDbSession,
  mutation: Extract<CoreAggregateMutation, { aggregateType: "handoff"; mode: "create" }>,
): Promise<void> => {
  const handoff = mutation.nextAggregate;
  await executeTenantWrite(
    session,
    `insert into handoffs
      (organization_id,id,conversation_id,lead_id,location_id,status,trigger_reason,
       queue_key,assigned_membership_id,requested_at,assigned_at,started_at,
       sla_due_at,resolved_at,resolution_code,version,created_at,updated_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$10,$10)`,
    [
      handoff.handoffId,
      handoff.conversationId,
      handoff.leadId,
      handoff.locationId,
      handoff.status,
      handoff.triggerReason,
      handoff.queueKey,
      handoff.assignedMembershipId,
      handoff.requestedAt,
      handoff.assignedAt,
      handoff.startedAt,
      handoff.slaDueAt,
      handoff.resolvedAt,
      handoff.resolutionCode,
      handoff.version,
    ],
  );
};

const updateHandoff = async (
  session: TenantDbSession,
  mutation: Extract<CoreAggregateMutation, { aggregateType: "handoff"; mode: "update" }>,
  occurredAt: UtcTimestamp,
): Promise<void> => {
  const handoff = mutation.nextAggregate;
  const result = await executeTenantWrite(
    session,
    `update handoffs set status=$3, assigned_membership_id=$4, assigned_at=$5,
       started_at=$6, resolved_at=$7, resolution_code=$8, version=$9, updated_at=$10
     where organization_id=$1 and id=$2 and version=$11`,
    [
      handoff.handoffId,
      handoff.status,
      handoff.assignedMembershipId,
      handoff.assignedAt,
      handoff.startedAt,
      handoff.resolvedAt,
      handoff.resolutionCode,
      handoff.version,
      occurredAt,
      mutation.expectedVersion,
    ],
  );
  await requireCasUpdated(
    session,
    result,
    "handoffs",
    handoff.handoffId,
    mutation.expectedVersion,
    "handoff",
  );
};

const persistAggregates = async (
  session: TenantDbSession,
  plan: DomainMutationPlan,
  validated: ValidatedPlan,
): Promise<void> => {
  for (const mutation of plan.aggregates) {
    if (mutation.mode === "create" && mutation.aggregateType === "lead") {
      await insertLead(session, mutation, occurredAtFor(mutation, plan.transitions));
    }
  }
  for (const mutation of plan.aggregates) {
    if (mutation.mode === "create" && mutation.aggregateType === "conversation") {
      await insertConversation(session, mutation, occurredAtFor(mutation, plan.transitions));
    }
  }
  for (const mutation of plan.aggregates) {
    if (mutation.mode === "create" && mutation.aggregateType === "appointment_request") {
      await insertAppointmentRequest(session, mutation);
    }
  }
  for (const mutation of plan.aggregates) {
    if (mutation.mode === "update" && mutation.aggregateType === "handoff") {
      await updateHandoff(session, mutation, occurredAtFor(mutation, plan.transitions));
    }
  }
  for (const mutation of plan.aggregates) {
    if (mutation.mode === "create" && mutation.aggregateType === "handoff") {
      await insertHandoff(session, mutation);
    }
  }
  for (const mutation of plan.aggregates) {
    if (mutation.mode === "update" && mutation.aggregateType === "conversation") {
      await updateConversation(session, mutation, occurredAtFor(mutation, plan.transitions));
    }
  }
  for (const mutation of plan.aggregates) {
    if (mutation.mode === "update" && mutation.aggregateType === "appointment_request") {
      await updateAppointmentRequest(session, mutation, occurredAtFor(mutation, plan.transitions));
    }
  }
  for (const mutation of plan.aggregates) {
    if (mutation.mode === "update" && mutation.aggregateType === "lead") {
      await updateLead(session, mutation, finalTransitionFor(mutation, validated));
    }
  }
};

const historyActor = (actor: ActorRef) => {
  validateActorForTenantHistory(actor);
  return {
    actorContactId: actor.actor_type === "customer" ? actor.actor_id : null,
    actorMembershipId: actor.actor_type === "member" ? actor.actor_id : null,
    actorType: actor.actor_type,
  };
};

const persistTransitions = async (
  session: TenantDbSession,
  transitions: readonly CoreTransitionPersistence[],
): Promise<void> => {
  for (const transition of transitions) {
    if (transition.transitionType === "appointment_request") {
      const actor = historyActor(transition.record.actor);
      await executeTenantWrite(
        session,
        `insert into appointment_request_transitions
          (organization_id,id,appointment_request_id,from_status,to_status,
           aggregate_version,command,offer_version,actor_type,actor_contact_id,
           actor_membership_id,reason_code,source_message_id,correlation_id,
           occurred_at,metadata_jsonb)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb)`,
        [
          transition.transitionId,
          transition.record.appointmentRequestId,
          transition.record.fromStatus,
          transition.record.toStatus,
          transition.record.version,
          transition.record.command,
          transition.record.offerVersion,
          actor.actorType,
          actor.actorContactId,
          actor.actorMembershipId,
          transition.record.reasonCode,
          transition.sourceMessageId ?? null,
          transition.correlationId,
          transition.record.occurredAt,
          JSON.stringify(transition.metadata ?? {}),
        ],
      );
    } else if (transition.transitionType === "handoff") {
      const actor = historyActor(transition.record.actor);
      await executeTenantWrite(
        session,
        `insert into handoff_transitions
          (organization_id,id,handoff_id,from_status,to_status,aggregate_version,
           actor_type,actor_contact_id,actor_membership_id,from_assignee_id,
           to_assignee_id,conversation_disposition,reason_code,correlation_id,occurred_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
        [
          transition.transitionId,
          transition.record.handoffId,
          transition.record.fromStatus,
          transition.record.toStatus,
          transition.record.version,
          actor.actorType,
          actor.actorContactId,
          actor.actorMembershipId,
          transition.record.fromAssigneeMembershipId,
          transition.record.toAssigneeMembershipId,
          transition.conversationDisposition,
          transition.record.reasonCode,
          transition.correlationId,
          transition.record.occurredAt,
        ],
      );
    }
  }
};

const persistConfirmationEvidence = async (
  session: TenantDbSession,
  evidence: readonly AppointmentConfirmationEvidencePersistence[],
): Promise<void> => {
  for (const append of evidence) {
    const value = append.evidence;
    await executeTenantWrite(
      session,
      `insert into appointment_confirmation_evidence
        (organization_id,id,appointment_request_id,offer_version,outcome,source,
         customer_contact_id,recorded_by_membership_id,source_message_id,
         external_reference_hash,customer_acted_at,recorded_at,attestation_method,
         attestation_reason_code,evidence_ciphertext,correlation_id)
       values ($1,$2,$3,$4,'confirmed',$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [
        value.evidenceId,
        value.appointmentRequestId,
        value.offerVersion,
        value.source,
        value.contactId,
        value.source === "staff_attested_external" ? value.recordedByMembershipId : null,
        value.source === "telegram" ? value.sourceMessageId : null,
        append.externalReferenceHash ?? null,
        value.customerActedAt,
        value.recordedAt,
        value.source === "staff_attested_external" ? value.attestationMethod : null,
        value.source === "staff_attested_external" ? value.attestationReasonCode : null,
        append.evidenceCiphertext ?? null,
        append.correlationId,
      ],
    );
  }
};

const AUDIT_ACTIONS = Object.freeze({
  appointment_request: "appointment_request.transition",
  conversation: "conversation.transition",
  handoff: "handoff.transition",
  lead: "lead.transition",
} satisfies Record<CoreAggregateType, string>);

const persistAudits = async (
  session: TenantDbSession,
  audits: readonly TenantMutationAudit[],
): Promise<void> => {
  for (const audit of audits) {
    const actor = historyActor(audit.actor);
    const action = AUDIT_ACTIONS[audit.target.targetType];
    await executeTenantWrite(
      session,
      `insert into audit_events
        (organization_id,id,event_type,actor_type,actor_id,actor_membership_id,
         impersonation_session_id,support_grant_id,target_type,target_id,action,
         result,reason_code,request_id,trace_id,correlation_id,source_ip_prefix,
         user_agent_hash,metadata_redacted_jsonb,occurred_at)
       values ($1,$2,$3,$4,$5,$6,null,null,$7,$8,$3,'succeeded',$9,$10,$11,$12,
         $13::cidr,$14,$15::jsonb,$16)`,
      [
        audit.auditId,
        action,
        actor.actorType,
        audit.actor.actor_id,
        audit.actorMembershipId,
        audit.target.targetType,
        audit.target.targetId,
        audit.reasonCode ?? null,
        audit.requestId,
        audit.traceId ?? null,
        audit.correlationId,
        audit.sourceIpPrefix ?? null,
        audit.userAgentHash ?? null,
        JSON.stringify(audit.metadataRedacted ?? {}),
        audit.occurredAt,
      ],
    );
  }
};

const persistEvents = async (
  session: TenantDbSession,
  events: readonly DomainEventAppend[],
): Promise<readonly CoreDomainEvent["event_id"][]> => {
  const eventIds: CoreDomainEvent["event_id"][] = [];
  for (const { envelope } of events) {
    await executeTenantWrite(
      session,
      `insert into outbox_events
        (organization_id,id,event_type,schema_version,aggregate_type,aggregate_id,
         aggregate_version,payload_jsonb,correlation_id,causation_id,occurred_at,
         status,attempt_count,available_at,locked_by,locked_until,published_at,
         last_error_category)
       values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,'pending',0,$11,
         null,null,null,null)`,
      [
        envelope.event_id,
        envelope.event_type,
        envelope.schema_version,
        envelope.aggregate_type,
        envelope.aggregate_id,
        envelope.aggregate_version,
        JSON.stringify(envelope),
        envelope.correlation_id,
        envelope.causation_id,
        envelope.occurred_at,
      ],
    );
    eventIds.push(envelope.event_id);
  }
  return Object.freeze(eventIds);
};

const mapMutationFailure = (error: unknown, fallbackResource: RepositoryResource): Error => {
  if (!(error instanceof RepositoryDatabaseError)) {
    return mapRepositoryFailure(error);
  }
  if (error.classification.code === "active_record_conflict") {
    return new RepositoryStructuralConflictError(
      error.classification.resource,
      "active_record_conflict",
    );
  }
  if (error.classification.code === "integrity_conflict") {
    return new RepositoryStructuralConflictError(fallbackResource, "integrity_conflict");
  }
  return error;
};

export const persistDomainMutationPlan = async (
  session: TenantDbSession,
  plan: DomainMutationPlan,
): Promise<PersistedDomainMutation> => {
  let fallbackResource: RepositoryResource = "lead";
  try {
    const firstAggregate = plan.aggregates[0] ?? invalidPlan();
    fallbackResource = aggregateDescriptor(firstAggregate).resource;
    const validated = validatePlan(session.organizationId, plan);
    await validateActorOwnership(session, plan.transitions, plan.audits);
    await persistAggregates(session, plan, validated);
    await persistTransitions(session, plan.transitions);
    await persistConfirmationEvidence(session, plan.confirmationEvidence ?? []);
    await persistAudits(session, plan.audits);
    const eventIds = await persistEvents(session, plan.events);
    return Object.freeze({
      aggregateCount: plan.aggregates.length,
      auditCount: plan.audits.length,
      eventIds,
      transitionCount: plan.transitions.length,
    });
  } catch (error) {
    const mapped = mapMutationFailure(error, fallbackResource);
    markTenantTransactionRollbackOnly(session, mapped);
    throw mapped;
  }
};
