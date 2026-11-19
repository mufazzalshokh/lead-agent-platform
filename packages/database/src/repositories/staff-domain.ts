import {
  CUSTOMER_CONFIRMATION_PROFILE,
  StaffOperationError,
  confirmationText,
  type StaffPreparedOperation,
} from "@lead-agent/application";
import {
  ActorRefSchema,
  DomainEventSchema,
  RequestIdSchema,
  CorrelationIdSchema,
  STAFF_APPOINTMENT_WITHDRAWAL_REASON,
  isSchemaValue,
  type ActorRef,
  type ResourceId,
  type StaffWorkItem,
} from "@lead-agent/contracts";
import {
  staffAcceptAppointmentRequest,
  rejectAppointmentRequest,
  cancelAppointmentRequest,
  confirmAppointmentRequest,
  validateAppointmentOfferVersion,
  validateAppointmentRequestReasonCode,
  validateHandoffQueueKey,
  validateHandoffResolutionCode,
  validateConversationResolutionCode,
  takeHandoffStaffOwnershipWorkflow,
  terminateHandoffAndResumeAiWorkflow,
  terminateHandoffAndResolveConversationWorkflow,
  queueStaffResponse,
  type Conversation,
  type Handoff,
} from "@lead-agent/domain";
import type { CustomerDataProtection } from "@lead-agent/security";
import type { TenantDbSession } from "../runtime/tenant.js";
import { createAppointmentRepository } from "./appointments.js";
import {
  loadAppointmentForDecision,
  localSlotText,
  readExactAppointmentPreferences,
} from "./appointment-domain.js";
import { createConversationRepository } from "./conversations.js";
import {
  boundConfirmationChannel,
  isOfflineWidgetCustomer,
  persistConfirmationDecision,
} from "./customer-confirmation.js";
import { createHandoffNotificationRepository } from "./handoffs.js";
import { persistDomainMutationPlan } from "./mutations.js";
import { insertQueuedCustomerMessage, queueCustomerReply } from "./customer-replies.js";
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
  mapMessageId,
  mapResourceId,
  mapSafeBigInt,
  RepositoryDataIntegrityError,
  executeTenantRead,
  executeTenantWrite,
} from "./shared.js";
import { getStaffWork } from "./staff-work.js";

export const staffActor = (
  input: StaffPreparedOperation,
): Extract<ActorRef, { actor_type: "member" }> => {
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
export const persistStaffAppointmentDecision = async (
  session: TenantDbSession,
  input: StaffPreparedOperation,
  nextId: () => string,
  protection: CustomerDataProtection,
): Promise<void> => {
  const repo = createAppointmentRepository(session);
  const initial = await repo.getAppointmentRequest(mapAppointmentRequestId(input.id));
  if (initial.version !== input.expectedVersion) throw new StaffOperationError("version_conflict");
  const cancelling = input.operation.action === "cancel";
  if (!cancelling && initial.status !== "requested")
    throw new StaffOperationError("business_rule_failed");
  // Confirmation takes the conversation lock before touching the appointment.
  await executeTenantRead(
    session,
    `select id from conversations where organization_id=$1 and id=$2 for ${cancelling ? "update" : "share"}`,
    [initial.conversationId],
  );
  const row = cancelling ? await repo.getAppointmentRequest(initial.appointmentRequestId) : initial;
  if (row.version !== input.expectedVersion) throw new StaffOperationError("version_conflict");
  if (row.status === "cancelled" || row.status === "rejected" || row.status === "expired")
    throw new StaffOperationError("business_rule_failed");
  const conversation = await createConversationRepository(session).getConversation(
    row.conversationId,
  );
  if (!cancelling && (conversation.status === "closed" || conversation.status === "resolved"))
    throw new StaffOperationError("business_rule_failed");
  const preferences = await readExactAppointmentPreferences(session, row.appointmentRequestId);
  if (preferences === null) throw new StaffOperationError("business_rule_failed");
  const request = await loadAppointmentForDecision(session, row, preferences);
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
  } else if (input.operation.action === "cancel") {
    const reason = validateAppointmentRequestReasonCode(input.operation.input.reason_code);
    if (!reason.ok) throw new StaffOperationError("validation_failed");
    if (row.status === "requested" && reason.value !== STAFF_APPOINTMENT_WITHDRAWAL_REASON)
      throw new StaffOperationError("business_rule_failed");
    result = cancelAppointmentRequest(request, {
      ...context,
      initiator: { kind: "staff", staff },
      reasonCode: reason.value,
    });
  } else throw new StaffOperationError("validation_failed");
  if (!result.ok) throw new StaffOperationError("business_rule_failed");
  const value = result.value;
  const events = nonempty(
    value.events.map((draft) => envelope(input, draft, "appointment_request", input.id, nextId)),
  );
  await persistDomainMutationPlan(session, {
    aggregates: [
      {
        aggregateType: "appointment_request",
        mode: "update",
        expectedVersion: context.expectedVersion,
        nextAggregate: value.nextAggregate,
        ...(cancelling && row.status !== "confirmed"
          ? {
              storage: { confirmationTokenHash: null, confirmationTokenConsumedAt: null },
            }
          : {}),
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
    events,
    audits: [
      audit(
        input,
        { targetType: "appointment_request", targetId: row.appointmentRequestId },
        nextId,
      ),
    ],
  });
  const now = new Date(input.occurredAt);
  if (
    cancelling &&
    request.offer !== null &&
    (await boundConfirmationChannel(session, conversation, now)) !== null
  ) {
    const kind = row.status === "confirmed" ? "cancelled_by_staff" : "offer_withdrawn";
    await queueCustomerReply(
      session,
      {
        conversationId: conversation.conversationId,
        channelConnectionId: conversation.channelConnectionId,
        conversationVersion: conversation.version,
        locale: conversation.preferredLocale,
        text: confirmationText(kind, conversation.preferredLocale, request.offer.localStart),
        replyToMessageId: null,
        aiRunId: null,
        correlationId: mapCorrelationId(input.correlationId),
        causationId: events[0].envelope.event_id,
        requestId: input.requestId,
        manifest: {
          sources: [],
          confirmation_profile: CUSTOMER_CONFIRMATION_PROFILE,
          confirmation_kind: kind,
          confirmation_request_id: request.appointmentRequestId,
          confirmation_offer_version: request.offer.offerVersion,
        },
        updatePreferredLocale: false,
      },
      protection,
      nextId,
      now,
    );
  }
};

export const persistStaffCustomerAttestation = async (
  session: TenantDbSession,
  input: StaffPreparedOperation,
  nextId: () => string,
): Promise<void> => {
  if (input.operation.action !== "attest-customer-confirmation")
    throw new StaffOperationError("validation_failed");
  const repo = createAppointmentRepository(session);
  const initial = await repo.getAppointmentRequest(mapAppointmentRequestId(input.id));
  await executeTenantRead(
    session,
    `select id from conversations where organization_id=$1 and id=$2 for update`,
    [initial.conversationId],
  );
  await executeTenantRead(
    session,
    `select id from appointment_requests where organization_id=$1 and id=$2 for update`,
    [initial.appointmentRequestId],
  );
  const row = await repo.getAppointmentRequest(initial.appointmentRequestId);
  const body = input.operation.input;
  if (row.version !== input.expectedVersion || row.offerVersion !== body.offer_version)
    throw new StaffOperationError("version_conflict");
  const now = new Date(input.occurredAt);
  const conversation = await createConversationRepository(session).getConversation(
    row.conversationId,
  );
  if (
    row.status !== "awaiting_customer_confirmation" ||
    row.contactId !== conversation.contactId ||
    row.leadId !== conversation.leadId ||
    !(await isOfflineWidgetCustomer(session, row.conversationId, now))
  )
    throw new StaffOperationError("business_rule_failed");
  const preferences = await readExactAppointmentPreferences(session, row.appointmentRequestId);
  if (preferences === null) throw new StaffOperationError("business_rule_failed");
  const request = await loadAppointmentForDecision(session, row, preferences);
  const offerVersion = validateAppointmentOfferVersion(row.offerVersion);
  const reason = validateAppointmentRequestReasonCode("customer_confirmed_offline");
  if (!offerVersion.ok || !reason.ok) throw new RepositoryDataIntegrityError();
  const organizationId = session.organizationId;
  const actor = staffActor(input);
  const result = confirmAppointmentRequest(request, {
    actor,
    organizationId,
    expectedVersion: request.version,
    now: input.occurredAt,
    evidence: {
      appointmentRequest: { organizationId, appointmentRequestId: request.appointmentRequestId },
      contact: { organizationId, contactId: request.contactId },
      evidence: { organizationId, evidenceId: mapResourceId(nextId()) },
      source: "staff_attested_external",
      offerVersion: offerVersion.value,
      customerAct: "explicit_confirmation",
      customerActedAt: body.customer_acted_at,
      attestationMethod: body.attestation_method,
      attestationReasonCode: reason.value,
      protectedEvidence: null,
      staff: { organizationId, membershipId: input.authorization.membershipId },
    },
  });
  if (!result.ok) throw new StaffOperationError("business_rule_failed");
  await persistConfirmationDecision(session, request, result, {
    actor,
    correlation: mapCorrelationId(input.correlationId),
    causation: null,
    now,
    nextId,
    staffRequestId: input.requestId,
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
export const persistStaffReply = async (
  session: TenantDbSession,
  input: StaffPreparedOperation,
  protection: CustomerDataProtection,
  nextId: () => string,
): Promise<void> => {
  if (input.operation.action !== "reply") throw new StaffOperationError("validation_failed");
  const row = await createConversationRepository(session).getConversation(
    mapConversationId(input.id),
  );
  if (row.version !== input.expectedVersion) throw new StaffOperationError("version_conflict");
  if (row.activeHandoffId === null) throw new StaffOperationError("business_rule_failed");
  // Handoff workflows lock the handoff before the conversation. Hold ownership stable through commit.
  const ownership = await executeTenantRead<{ status: unknown }>(
    session,
    `select status from handoffs where organization_id=$1 and id=$2 and conversation_id=$3
      and assigned_membership_id=$4 and status in ('assigned','in_progress') for share`,
    [row.activeHandoffId, row.conversationId, input.authorization.membershipId],
  );
  const handoffStatus = ownership[0]?.["status"];
  if (handoffStatus !== "assigned" && handoffStatus !== "in_progress")
    throw new StaffOperationError("business_rule_failed");
  await getStaffWork(session, input.authorization, "handoff", mapResourceId(row.activeHandoffId));
  const channels = await executeTenantRead(
    session,
    `select id from channel_connections where organization_id=$1 and id=$2 and status='active'
      and channel_type in ('widget','telegram','instagram')`,
    [row.channelConnectionId],
  );
  if (channels.length !== 1) throw new StaffOperationError("business_rule_failed");
  const expectedVersion = mapAggregateVersion(row.version);
  const messageId = mapMessageId(nextId());
  const result = queueStaffResponse(
    {
      ...row,
      organizationId: session.organizationId,
      version: expectedVersion,
      activeHandoff: {
        handoffId: row.activeHandoffId,
        organizationId: session.organizationId,
        status: handoffStatus,
      },
    },
    {
      actor: staffActor(input),
      organizationId: session.organizationId,
      expectedVersion,
      occurredAt: input.occurredAt,
      message: { messageId, organizationId: session.organizationId },
    },
  );
  if (!result.ok) throw new StaffOperationError("business_rule_failed");
  // Reserve the message sequence under the same CAS without advancing the domain version twice.
  const sequence = await executeTenantWrite<{ sequence_no: unknown }>(
    session,
    `update conversations set next_sequence_no=next_sequence_no+1
      where organization_id=$1 and id=$2 and version=$3 returning next_sequence_no-1 as sequence_no`,
    [row.conversationId, expectedVersion],
  );
  if (sequence.rowCount !== 1) throw new StaffOperationError("version_conflict");
  await insertQueuedCustomerMessage(
    session,
    {
      messageId,
      sequence: mapSafeBigInt(sequence.rows[0]?.["sequence_no"]),
      conversationId: row.conversationId,
      channelConnectionId: row.channelConnectionId,
      text: input.operation.input.text,
      locale: row.preferredLocale,
      senderMembershipId: input.authorization.membershipId,
      replyToMessageId: null,
      aiRunId: null,
      manifest: null,
    },
    protection,
    new Date(input.occurredAt),
  );
  await persistDomainMutationPlan(session, {
    aggregates: [
      {
        aggregateType: "conversation",
        mode: "update",
        expectedVersion,
        nextAggregate: result.value.nextAggregate,
      },
    ],
    transitions: nonempty(
      result.value.transitionRecords.map((record) => ({ transitionType: "conversation", record })),
    ),
    events: nonempty(
      result.value.events.map((draft) =>
        envelope(input, draft, "conversation", row.conversationId, nextId),
      ),
    ),
    audits: [audit(input, { targetType: "conversation", targetId: row.conversationId }, nextId)],
  });
};
export const requireStaffTarget = (
  session: TenantDbSession,
  input: StaffPreparedOperation,
): Promise<StaffWorkItem> =>
  getStaffWork(session, input.authorization, input.kind, mapResourceId(input.id));
export type StaffOutcomeId = ResourceId | null;
