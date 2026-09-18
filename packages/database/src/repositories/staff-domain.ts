import { StaffOperationError, type StaffPreparedOperation } from "@lead-agent/application";
import {
  ActorRefSchema,
  DomainEventSchema,
  IanaTimeZoneSchema,
  RequestIdSchema,
  CorrelationIdSchema,
  isSchemaValue,
  type ResourceId,
} from "@lead-agent/contracts";
import {
  staffAcceptAppointmentRequest,
  rejectAppointmentRequest,
  validateAppointmentRequestReasonCode,
  validateHandoffQueueKey,
  validateHandoffResolutionCode,
  validateConversationResolutionCode,
  takeHandoffStaffOwnershipWorkflow,
  terminateHandoffAndResumeAiWorkflow,
  terminateHandoffAndResolveConversationWorkflow,
  type AppointmentRequest,
  type Conversation,
  type Handoff,
} from "@lead-agent/domain";
import type { TenantDbSession } from "../runtime/tenant.js";
import { createAppointmentRepository } from "./appointments.js";
import { createConversationRepository } from "./conversations.js";
import { createHandoffNotificationRepository } from "./handoffs.js";
import { persistDomainMutationPlan } from "./mutations.js";
import type {
  CoreDomainEventDraft,
  CoreTransitionPersistence,
  DomainEventAppend,
  NonEmptyReadonlyArray,
  TenantMutationAudit,
} from "./mutation-types.js";
import {
  mapAggregateVersion,
  mapAppointmentRequestId,
  mapConversationId,
  mapHandoffId,
  mapResourceId,
  RepositoryDataIntegrityError,
  executeTenantRead,
} from "./shared.js";
import { getStaffWork } from "./staff-work.js";

export const staffActor = (input: StaffPreparedOperation) => {
  const actor: unknown = { actor_type: "member", actor_id: input.authorization.membershipId };
  if (!isSchemaValue(ActorRefSchema, actor) || actor.actor_type !== "member")
    throw new RepositoryDataIntegrityError();
  return actor;
};
const nonempty = <T>(values: readonly T[]): NonEmptyReadonlyArray<T> => {
  const [first, ...rest] = values;
  if (first === undefined) throw new RepositoryDataIntegrityError();
  return [first, ...rest];
};
export const localSlotText = (instant: string, zone: string): string => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(instant));
  const part = (name: string) => parts.find((value) => value.type === name)?.value;
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}:${part("second")}`;
};
const envelope = (
  input: StaffPreparedOperation,
  draft: CoreDomainEventDraft,
  aggregateType: "appointment_request" | "handoff" | "conversation",
  aggregateId: string,
  nextId: () => string,
): DomainEventAppend => {
  const value: unknown = {
    ...draft,
    actor: staffActor(input),
    organization_id: input.authorization.organizationId,
    aggregate_type: aggregateType,
    aggregate_id: aggregateId,
    event_id: nextId(),
    occurred_at: input.occurredAt,
    correlation_id: input.correlationId,
    causation_id: null,
    request_id: input.requestId,
  };
  if (
    !isSchemaValue(DomainEventSchema, value) ||
    (value.aggregate_type !== "appointment_request" &&
      value.aggregate_type !== "handoff" &&
      value.aggregate_type !== "conversation")
  )
    throw new RepositoryDataIntegrityError();
  return { draft, envelope: value };
};
const mapCorrelationId = (value: string) => {
  if (!isSchemaValue(CorrelationIdSchema, value)) throw new RepositoryDataIntegrityError();
  return value;
};
const mapRequestId = (value: string) => {
  if (!isSchemaValue(RequestIdSchema, value)) throw new RepositoryDataIntegrityError();
  return value;
};
const audit = (
  input: StaffPreparedOperation,
  target: TenantMutationAudit["target"],
  nextId: () => string,
): TenantMutationAudit => ({
  actor: staffActor(input),
  actorMembershipId: input.authorization.membershipId,
  auditId: mapResourceId(nextId()),
  correlationId: mapCorrelationId(input.correlationId),
  occurredAt: input.occurredAt,
  requestId: mapRequestId(input.requestId),
  target,
  metadataRedacted: {
    staff_operation: input.operation.action,
    expected_version: input.expectedVersion,
  },
});
/** S17 may decide only a requested appointment. It cannot prepare or confirm it. */
export const persistStaffAppointmentDecision = async (
  session: TenantDbSession,
  input: StaffPreparedOperation,
  nextId: () => string,
): Promise<void> => {
  const repo = createAppointmentRepository(session),
    row = await repo.getAppointmentRequest(mapAppointmentRequestId(input.id));
  if (row.version !== input.expectedVersion) throw new StaffOperationError("version_conflict");
  if (row.status !== "requested") throw new StaffOperationError("business_rule_failed");
  // Keep the prerequisite state stable until the appointment CAS commits.
  await executeTenantRead(
    session,
    `select id from conversations where organization_id=$1 and id=$2 for share`,
    [row.conversationId],
  );
  const conversation = await createConversationRepository(session).getConversation(
    row.conversationId,
  );
  if (conversation.status === "closed" || conversation.status === "resolved")
    throw new StaffOperationError("business_rule_failed");
  const stored = await repo.listPreferences(row.appointmentRequestId, { limit: 20 });
  if (stored.next !== null) throw new StaffOperationError("business_rule_failed");
  const preferences = stored.items.map((pref) => {
    if (
      pref.precision !== "exact" ||
      pref.startAt === null ||
      pref.endAt === null ||
      pref.localStart === null ||
      pref.localEnd === null ||
      !isSchemaValue(IanaTimeZoneSchema, pref.timeZone)
    )
      throw new StaffOperationError("business_rule_failed");
    return {
      ...pref,
      precision: "exact" as const,
      startAt: pref.startAt,
      endAt: pref.endAt,
      localStart: pref.localStart,
      localEnd: pref.localEnd,
      timeZone: pref.timeZone,
    };
  });
  const request: AppointmentRequest = {
    appointmentRequestId: row.appointmentRequestId,
    organizationId: session.organizationId,
    leadId: row.leadId,
    contactId: row.contactId,
    conversationId: row.conversationId,
    sourceMessageId: row.sourceMessageId,
    serviceId: row.serviceId,
    serviceVersionId: row.serviceVersionId,
    locationId: row.locationId,
    locationVersionId: row.locationVersionId,
    businessPolicyId: row.businessPolicyId,
    preferences,
    status: "requested",
    version: mapAggregateVersion(row.version),
    createdAt: row.createdAt,
    staffDecision: null,
    offer: null,
    confirmationOffer: null,
    confirmationEvidence: null,
    confirmedAt: null,
    cancellation: null,
    expiration: null,
  };
  const context = {
      actor: staffActor(input),
      organizationId: session.organizationId,
      expectedVersion: mapAggregateVersion(input.expectedVersion),
      occurredAt: input.occurredAt,
    },
    staff = {
      organizationId: session.organizationId,
      membershipId: input.authorization.membershipId,
    };
  let result;
  if (input.operation.action === "accept") {
    const slot = input.operation.input,
      zone = preferences[0]?.timeZone;
    if (zone === undefined) throw new StaffOperationError("business_rule_failed");
    result = staffAcceptAppointmentRequest(request, {
      ...context,
      staff,
      location: {
        organizationId: session.organizationId,
        locationId: row.locationId,
        locationVersionId: row.locationVersionId,
      },
      offeredSlot: {
        startAt: slot.start_at,
        endAt: slot.end_at,
        timeZone: zone,
        localStart: localSlotText(slot.start_at, zone),
        localEnd: localSlotText(slot.end_at, zone),
      },
    });
  } else if (input.operation.action === "reject") {
    const reason = validateAppointmentRequestReasonCode(input.operation.input.reason_code);
    if (!reason.ok) throw new StaffOperationError("validation_failed");
    result = rejectAppointmentRequest(request, { ...context, staff, reasonCode: reason.value });
  } else throw new StaffOperationError("validation_failed");
  if (!result.ok) throw new StaffOperationError("business_rule_failed");
  const value = result.value;
  await persistDomainMutationPlan(session, {
    aggregates: [
      {
        aggregateType: "appointment_request",
        mode: "update",
        expectedVersion: context.expectedVersion,
        nextAggregate: value.nextAggregate,
      },
    ],
    transitions: nonempty(
      value.transitionRecords.map((record) => ({
        transitionType: "appointment_request" as const,
        record,
        transitionId: mapResourceId(nextId()),
        correlationId: mapCorrelationId(input.correlationId),
      })),
    ),
    events: nonempty(
      value.events.map((draft) => envelope(input, draft, "appointment_request", input.id, nextId)),
    ),
    audits: [
      audit(
        input,
        { targetType: "appointment_request", targetId: row.appointmentRequestId },
        nextId,
      ),
    ],
  });
};
export const persistStaffHandoff = async (
  session: TenantDbSession,
  input: StaffPreparedOperation,
  nextId: () => string,
): Promise<void> => {
  const row = await createHandoffNotificationRepository(session).getHandoff(mapHandoffId(input.id));
  const conversationRow = await createConversationRepository(session).getConversation(
    row.conversationId,
  );
  if (input.operation.action !== "claim" && input.operation.action !== "resolve")
    throw new StaffOperationError("validation_failed");
  if (
    row.version !== input.expectedVersion ||
    conversationRow.version !== input.operation.input.conversation_version
  )
    throw new StaffOperationError("version_conflict");
  const queue = validateHandoffQueueKey(row.queueKey);
  if (!queue.ok) throw new RepositoryDataIntegrityError();
  const resolution =
    row.resolutionCode === null ? null : validateHandoffResolutionCode(row.resolutionCode);
  if (resolution !== null && !resolution.ok) throw new RepositoryDataIntegrityError();
  const handoff: Handoff = {
    ...row,
    organizationId: session.organizationId,
    queueKey: queue.value,
    resolutionCode: resolution?.value ?? null,
    version: mapAggregateVersion(row.version),
  };
  if (
    handoff.status !== "requested" &&
    handoff.status !== "assigned" &&
    handoff.status !== "in_progress"
  )
    throw new StaffOperationError("business_rule_failed");
  if (conversationRow.activeHandoffId !== handoff.handoffId)
    throw new StaffOperationError("business_rule_failed");
  const conversation: Conversation = {
    ...conversationRow,
    organizationId: session.organizationId,
    version: mapAggregateVersion(conversationRow.version),
    activeHandoff: {
      handoffId: handoff.handoffId,
      organizationId: session.organizationId,
      status: handoff.status,
    },
  };
  const context = {
    actor: staffActor(input),
    organizationId: session.organizationId,
    occurredAt: input.occurredAt,
  };
  const conversationContext = {
      ...context,
      expectedVersion: mapAggregateVersion(input.operation.input.conversation_version),
    },
    handoffContext = { ...context, expectedVersion: mapAggregateVersion(input.expectedVersion) };
  let result;
  if (input.operation.action === "claim")
    result = takeHandoffStaffOwnershipWorkflow(handoff, conversation, {
      conversation: conversationContext,
      handoff: {
        action: "claim_and_start",
        command: {
          ...handoffContext,
          assignee: {
            organizationId: session.organizationId,
            membershipId: input.authorization.membershipId,
          },
        },
      },
    });
  else {
    const code = validateHandoffResolutionCode(input.operation.input.resolution_code),
      convCode = validateConversationResolutionCode(input.operation.input.resolution_code);
    if (!code.ok || !convCode.ok) throw new StaffOperationError("validation_failed");
    const terminal = {
      action: "resolved" as const,
      command: { ...handoffContext, resolutionCode: code.value },
    };
    result =
      input.operation.input.disposition === "resume_ai"
        ? terminateHandoffAndResumeAiWorkflow(handoff, conversation, {
            disposition: "resume_ai",
            conversation: conversationContext,
            handoff: terminal,
          })
        : terminateHandoffAndResolveConversationWorkflow(handoff, conversation, {
            disposition: "resolve_conversation",
            conversation: conversationContext,
            handoff: terminal,
            resolutionCode: convCode.value,
          });
  }
  if (!result.ok) throw new StaffOperationError("business_rule_failed");
  const value = result.value;
  const transitions: CoreTransitionPersistence[] = value.transitionRecords.map((record) =>
    "handoffId" in record
      ? {
          transitionType: "handoff",
          record,
          conversationDisposition:
            input.operation.action === "resolve" ? input.operation.input.disposition : null,
          transitionId: mapResourceId(nextId()),
          correlationId: mapCorrelationId(input.correlationId),
        }
      : { transitionType: "conversation", record },
  );
  await persistDomainMutationPlan(session, {
    aggregates: [
      {
        aggregateType: "handoff",
        mode: "update",
        expectedVersion: handoffContext.expectedVersion,
        nextAggregate: value.handoff,
      },
      {
        aggregateType: "conversation",
        mode: "update",
        expectedVersion: conversationContext.expectedVersion,
        nextAggregate: value.conversation,
      },
    ],
    transitions: nonempty(transitions),
    events: nonempty(
      value.events.map((draft) =>
        envelope(
          input,
          draft,
          draft.event_type.startsWith("handoff.") ? "handoff" : "conversation",
          draft.event_type.startsWith("handoff.") ? input.id : conversationRow.conversationId,
          nextId,
        ),
      ),
    ),
    audits: [
      audit(input, { targetType: "handoff", targetId: handoff.handoffId }, nextId),
      audit(
        input,
        { targetType: "conversation", targetId: mapConversationId(conversationRow.conversationId) },
        nextId,
      ),
    ],
  });
};
export const requireStaffTarget = (session: TenantDbSession, input: StaffPreparedOperation) =>
  getStaffWork(session, input.authorization, input.kind, mapResourceId(input.id));
export type StaffOutcomeId = ResourceId | null;
