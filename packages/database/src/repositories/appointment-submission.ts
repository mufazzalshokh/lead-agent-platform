import type {
  AIRunFinish,
  AppointmentSubmissionContext,
  AppointmentSubmissionPlan,
  SalesContext,
} from "@lead-agent/application";
import { APPOINTMENT_SUBMISSION_PROFILE } from "@lead-agent/application";
import {
  ActorRefSchema,
  DomainEventSchema,
  RequestIdSchema,
  isSchemaValue,
  type PublishedBusinessKnowledgeV2,
  type ConversationId,
} from "@lead-agent/contracts";
import { createAppointmentRequestWorkflow } from "@lead-agent/domain";
import type { TenantDbSession } from "../runtime/tenant.js";
import { createConversationRepository } from "./conversations.js";
import { createLeadRepository } from "./leads.js";
import { persistDomainMutationPlan } from "./mutations.js";
import type {
  DomainEventAppend,
  CoreTransitionPersistence,
  NonEmptyReadonlyArray,
} from "./mutation-types.js";
import {
  executeTenantRead,
  executeTenantWrite,
  mapAggregateVersion,
  mapAppointmentRequestId,
  mapResourceId,
  mapSafeBigInt,
  mapUtcTimestamp,
  RepositoryDataIntegrityError,
} from "./shared.js";

export const readAppointmentSubmissionContext = async (
  session: TenantDbSession,
  input: Readonly<{
    conversationId: ConversationId;
    sales: SalesContext;
    knowledge: PublishedBusinessKnowledgeV2 | null;
    now: Date;
    lock: boolean;
  }>,
): Promise<AppointmentSubmissionContext> => {
  const conversation = await createConversationRepository(session).getConversation(
    input.conversationId,
  );
  const active = await executeTenantRead(
    session,
    `select id from appointment_requests where organization_id=$1 and lead_id=$2 and status in ('requested','staff_accepted','awaiting_customer_confirmation','confirmed') order by created_at desc,id desc limit 2${input.lock ? " for share" : ""}`,
    [input.sales.leadId],
  );
  if (active.length > 1) throw new RepositoryDataIntegrityError();
  const prior = await executeTenantRead(
    session,
    `select message.sequence_no from appointment_requests request join messages message on message.organization_id=request.organization_id and message.id=request.source_message_id
      where request.organization_id=$1 and request.lead_id=$2 and request.conversation_id=$3 and request.status in ('rejected','cancelled','expired')
      order by request.created_at desc,request.id desc limit 1`,
    [input.sales.leadId, input.conversationId],
  );
  return Object.freeze({
    now: input.now.toISOString(),
    knowledge: input.knowledge,
    activeRequestId: active[0] === undefined ? null : mapAppointmentRequestId(active[0]["id"]),
    afterSequence: prior[0] === undefined ? 0 : mapSafeBigInt(prior[0]["sequence_no"]),
    staffActive: conversation.activeHandoffId !== null,
  });
};
/** Exclude projection clock/locale metadata, not effective records or authorization state. */
export const appointmentSubmissionState = (
  context: AppointmentSubmissionContext,
): Readonly<Record<string, unknown>> => ({
  knowledge:
    context.knowledge === null ? null : { ...context.knowledge, effective_at: null, locale: null },
  activeRequestId: context.activeRequestId,
  afterSequence: context.afterSequence,
  staffActive: context.staffActive,
});
const nonempty = <T>(values: readonly T[]): NonEmptyReadonlyArray<T> => {
  const [first, ...rest] = values;
  if (first === undefined) throw new RepositoryDataIntegrityError();
  return [first, ...rest];
};
/** Existing S5 writer, inside the same terminal AI transaction as qualification and reply. */
export const persistAppointmentSubmission = async (
  session: TenantDbSession,
  input: AIRunFinish,
  plan: AppointmentSubmissionPlan,
  nextId: () => string,
  now: Date,
): Promise<void> => {
  const submission = plan.submission;
  if (submission === null) return;
  const context = input.snapshot.sales;
  if (
    context?.policy === null ||
    context === undefined ||
    !context.contactable ||
    Date.parse(submission.preference.startAt) <= now.getTime()
  )
    throw new RepositoryDataIntegrityError();
  const conversation = await createConversationRepository(session).getConversation(
    input.reference.conversationId,
  );
  const lead = await createLeadRepository(session).getLead(conversation.leadId);
  if (
    lead.leadId !== context.leadId ||
    lead.contactId !== conversation.contactId ||
    lead.status !== "qualified" ||
    conversation.status !== "open" ||
    conversation.automationMode !== "ai" ||
    conversation.activeHandoffId !== null ||
    lead.qualificationPolicyId !== context.policy.id
  )
    throw new RepositoryDataIntegrityError();
  for (const messageId of new Set([
    input.reference.messageId,
    submission.dateMessageId,
    submission.timeMessageId,
  ])) {
    const owned = await executeTenantRead(
      session,
      `select id from messages where organization_id=$1 and id=$2 and conversation_id=$3 and sender_contact_id=$4 and sender_type='customer' and direction='inbound' and sequence_no<=$5 and redacted_at is null for share`,
      [
        messageId,
        conversation.conversationId,
        conversation.contactId,
        input.snapshot.sourceSequence,
      ],
    );
    if (owned.length !== 1) throw new RepositoryDataIntegrityError();
  }
  const evaluations = await executeTenantRead(
    session,
    `select id from lead_qualification_evaluations where organization_id=$1 and lead_id=$2 and business_policy_id=$3 and result='qualified' order by occurred_at desc,id desc limit 1`,
    [lead.leadId, context.policy.id],
  );
  if (evaluations[0] === undefined) throw new RepositoryDataIntegrityError();
  const actorValue: unknown = { actor_type: "customer", actor_id: conversation.contactId };
  if (!isSchemaValue(ActorRefSchema, actorValue) || actorValue.actor_type !== "customer")
    throw new RepositoryDataIntegrityError();
  const actor = actorValue,
    occurredAt = mapUtcTimestamp(now),
    requestIdValue = `s16:${input.reservation.runId}`;
  if (!isSchemaValue(RequestIdSchema, requestIdValue)) throw new RepositoryDataIntegrityError();
  const organizationId = session.organizationId,
    appointmentRequestId = mapAppointmentRequestId(nextId());
  const qualification = {
    evaluationId: mapResourceId(evaluations[0]["id"]),
    policyId: context.policy.id,
    reasonCodes: [] as const,
    result: "qualified" as const,
  };
  const workflow = createAppointmentRequestWorkflow(
    {
      leadId: lead.leadId,
      contactId: lead.contactId,
      organizationId,
      version: mapAggregateVersion(lead.version),
      status: "qualified",
      qualification,
      appointmentRequestId: null,
    },
    {
      lead: {
        actor,
        organizationId,
        occurredAt,
        expectedVersion: mapAggregateVersion(lead.version),
      },
      appointmentRequest: {
        actor,
        organizationId,
        appointmentRequestId,
        occurredAt,
        businessPolicy: { businessPolicyId: context.policy.id, organizationId },
        lead: { leadId: lead.leadId, organizationId },
        contact: { contactId: conversation.contactId, organizationId },
        conversation: { conversationId: conversation.conversationId, organizationId },
        initiator: {
          kind: "customer",
          contact: { contactId: conversation.contactId, organizationId },
        },
        service: {
          serviceId: submission.service.service_id,
          serviceVersionId: submission.service.provenance.record_id,
          organizationId,
        },
        location: {
          locationId: submission.location.location_id,
          locationVersionId: submission.location.provenance.record_id,
          organizationId,
        },
        sourceMessage: { messageId: input.reference.messageId, organizationId },
        preferences: [
          {
            preferenceId: mapResourceId(nextId()),
            preferenceOrder: 1,
            precision: "exact",
            startAt: mapUtcTimestamp(new Date(submission.preference.startAt)),
            endAt: mapUtcTimestamp(new Date(submission.preference.endAt)),
            localStart: submission.preference.localStart,
            localEnd: submission.preference.localEnd,
            timeZone: submission.location.time_zone,
          },
        ],
      },
    },
  );
  if (!workflow.ok) throw new RepositoryDataIntegrityError();
  const value = workflow.value;
  const events: DomainEventAppend[] = value.events.map((draft) => {
    const envelope: unknown = {
      ...draft,
      actor,
      organization_id: organizationId,
      aggregate_type:
        draft.event_type === "appointment_request.created" ? "appointment_request" : "lead",
      aggregate_id:
        draft.event_type === "appointment_request.created" ? appointmentRequestId : lead.leadId,
      event_id: nextId(),
      occurred_at: occurredAt,
      correlation_id: input.reference.correlationId,
      causation_id: input.reference.causationId,
      request_id: requestIdValue,
    };
    if (
      !isSchemaValue(DomainEventSchema, envelope) ||
      (envelope.aggregate_type !== "appointment_request" && envelope.aggregate_type !== "lead")
    )
      throw new RepositoryDataIntegrityError();
    return { draft, envelope };
  });
  const metadataRedacted = {
    submission_profile_version: APPOINTMENT_SUBMISSION_PROFILE,
    qualification_policy_id: context.policy.id,
    qualification_policy_version: context.policy.version,
    date_source_message_id: submission.dateMessageId,
    time_source_message_id: submission.timeMessageId,
    approximate_preference: submission.preference.approximate,
  };
  const transitions: CoreTransitionPersistence[] = value.transitionRecords.map((record) =>
    "leadId" in record
      ? { transitionType: "lead", record }
      : {
          transitionType: "appointment_request",
          record,
          correlationId: input.reference.correlationId,
          transitionId: mapResourceId(nextId()),
          sourceMessageId: input.reference.messageId,
        },
  );
  await persistDomainMutationPlan(session, {
    aggregates: [
      {
        aggregateType: "appointment_request",
        mode: "create",
        nextAggregate: value.appointmentRequest,
        storage: {
          requestDedupeKey: `s16:${input.reference.messageId}`,
          customerNotesCiphertext: null,
        },
      },
      {
        aggregateType: "lead",
        mode: "update",
        expectedVersion: mapAggregateVersion(lead.version),
        nextAggregate: value.lead,
      },
    ],
    audits: [
      {
        actor,
        actorMembershipId: null,
        auditId: mapResourceId(nextId()),
        correlationId: input.reference.correlationId,
        occurredAt,
        requestId: requestIdValue,
        target: { targetType: "appointment_request", targetId: appointmentRequestId },
        metadataRedacted,
      },
      {
        actor,
        actorMembershipId: null,
        auditId: mapResourceId(nextId()),
        correlationId: input.reference.correlationId,
        occurredAt,
        requestId: requestIdValue,
        target: { targetType: "lead", targetId: lead.leadId },
        metadataRedacted,
      },
    ],
    transitions: nonempty(transitions),
    events: nonempty(events),
  });
  const originating = events.find(
    (event) => event.envelope.event_type === "appointment_request.created",
  );
  if (originating === undefined) throw new RepositoryDataIntegrityError();
  // Minimum durable in-app task, not S17 inbox/API or optional delivery infrastructure.
  const notificationId = mapResourceId(nextId());
  const notification: unknown = {
    actor: { actor_type: "system", actor_id: null },
    organization_id: organizationId,
    aggregate_type: "notification",
    aggregate_id: notificationId,
    aggregate_version: 1,
    event_id: nextId(),
    event_type: "notification.created",
    schema_id: "NotificationCreatedDomainEvent.v1",
    schema_version: "1",
    occurred_at: occurredAt,
    correlation_id: input.reference.correlationId,
    causation_id: input.reference.causationId,
    request_id: requestIdValue,
    payload: {
      notification_status: "pending",
      notification_type: "staff_task",
      related_resource_type: "appointment_request",
      related_resource_id: appointmentRequestId,
    },
  };
  if (!isSchemaValue(DomainEventSchema, notification)) throw new RepositoryDataIntegrityError();
  const task = await executeTenantWrite(
    session,
    `insert into notifications (organization_id,id,notification_type,audience_type,queue_key,related_resource_type,related_resource_id,originating_outbox_event_id,template_key,template_version,status,dedupe_key,available_at,created_at,updated_at)
    select $1,$2,'staff_task','queue','staff','appointment_request',id,$4,'appointment_request.received',1,'pending',$5,$6,$6,$6 from appointment_requests where organization_id=$1 and id=$3`,
    [
      notificationId,
      appointmentRequestId,
      originating.envelope.event_id,
      `s16:staff:${appointmentRequestId}`,
      now,
    ],
  );
  if (task.rowCount !== 1) throw new RepositoryDataIntegrityError();
  await executeTenantWrite(
    session,
    `insert into audit_events (organization_id,id,event_type,actor_type,target_type,target_id,action,result,request_id,correlation_id,metadata_redacted_jsonb,occurred_at)
    values ($1,$2,'notification.created','system','notification',$3,'notification.created','succeeded',$4,$5,$6::jsonb,$7)`,
    [
      nextId(),
      notificationId,
      requestIdValue,
      input.reference.correlationId,
      JSON.stringify({ submission_profile_version: APPOINTMENT_SUBMISSION_PROFILE }),
      now,
    ],
  );
  await executeTenantWrite(
    session,
    `insert into outbox_events (organization_id,id,event_type,schema_version,aggregate_type,aggregate_id,aggregate_version,payload_jsonb,correlation_id,causation_id,occurred_at,status,available_at)
    values ($1,$2,'notification.created','1','notification',$3,1,$4::jsonb,$5,$6,$7,'pending',$7)`,
    [
      notification.event_id,
      notificationId,
      JSON.stringify(notification),
      input.reference.correlationId,
      input.reference.causationId,
      now,
    ],
  );
};
