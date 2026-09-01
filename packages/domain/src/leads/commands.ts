import {
  ActorRefSchema,
  AggregateVersionSchema,
  AppointmentRequestIdSchema,
  ContactIdSchema,
  DomainEventPayloadSchemas,
  DomainEventSchemas,
  LeadIdSchema,
  LeadReopenedDomainEventPayloadV2Schema,
  LeadReopenedDomainEventV2Schema,
  MessageIdSchema,
  OrganizationIdSchema,
  ResourceIdSchema,
  SchemaIdSchema,
  SchemaVersionSchema,
  UtcTimestampSchema,
  isSchemaValue,
  type ActorRef,
  type AggregateVersion,
  type AppointmentRequestId,
  type ContactId,
  type DomainEventFor,
  type LeadId,
  type LeadReopenedDomainEventV2,
  type MessageId,
  type OrganizationId,
  type ResourceId,
  type SchemaId,
  type SchemaVersion,
  type UtcTimestamp,
} from "@lead-agent/contracts";

import {
  invalidStateTransition,
  invariantViolation,
  qualificationIncomplete,
  type ConcurrencyConflict,
  type InvalidStateTransition,
  type InvariantViolation,
  type QualificationIncomplete,
  type TenantScopeViolation,
} from "../foundation/errors.js";
import type { CanonicalDomainEvent, DomainEventDraft } from "../foundation/event-draft.js";
import { cloneAndFreeze } from "../foundation/immutable.js";
import { failure, success, type Result } from "../foundation/result.js";
import {
  transitionFailure,
  transitionSuccess,
  type TransitionResult,
} from "../foundation/transition.js";
import { advanceAggregateVersion, initialAggregateVersion } from "../foundation/version.js";
import { requireSameOrganization } from "../values/tenant.js";
import { validateLead, type Lead, type LeadQualification, type LeadStatus } from "./lead.js";

declare const leadReasonCodeBrand: unique symbol;

export type LeadReasonCode = string & {
  readonly [leadReasonCodeBrand]: "LeadReasonCode";
};

export type LeadCommandName =
  | "create_lead"
  | "record_engagement"
  | "disqualify_lead"
  | "qualify_lead"
  | "reopen_disqualified_lead"
  | "record_appointment_request"
  | "restore_after_appointment_request"
  | "convert_lead"
  | "close_lead";

export type ExistingLeadCommandName = Exclude<LeadCommandName, "create_lead">;

type LeadEvent =
  | DomainEventFor<"lead.created">
  | DomainEventFor<"lead.engaged">
  | DomainEventFor<"lead.qualified">
  | DomainEventFor<"lead.disqualified">
  | DomainEventFor<"lead.booking_requested">
  | DomainEventFor<"lead.converted">
  | DomainEventFor<"lead.closed">
  | LeadReopenedDomainEventV2;

type DistributedDomainEventDraft<Event> = Event extends CanonicalDomainEvent
  ? DomainEventDraft<Event>
  : never;

export type LeadEventDraft = DistributedDomainEventDraft<LeadEvent>;

export type LeadTransitionRecord = Readonly<{
  actor: ActorRef;
  appointmentRequestId: AppointmentRequestId | null;
  command: LeadCommandName;
  fromStatus: LeadStatus | null;
  leadId: LeadId;
  occurredAt: UtcTimestamp;
  organizationId: OrganizationId;
  policyId: ResourceId | null;
  qualificationEvaluationId: ResourceId | null;
  reasonCodes: readonly LeadReasonCode[];
  sourceMessageId: MessageId | null;
  toStatus: LeadStatus;
  version: AggregateVersion;
}>;

export type LeadCommandError =
  | ConcurrencyConflict<AggregateVersion>
  | InvalidStateTransition<LeadStatus, ExistingLeadCommandName>
  | InvariantViolation
  | QualificationIncomplete
  | TenantScopeViolation;

export type LeadCreationError = InvariantViolation | TenantScopeViolation;

export type LeadCommandResult = TransitionResult<
  Lead,
  LeadEventDraft,
  LeadCommandError,
  LeadTransitionRecord
>;

export type LeadCreationResult = TransitionResult<
  Lead,
  LeadEventDraft,
  LeadCreationError,
  LeadTransitionRecord
>;

export type LeadContactReference = Readonly<{
  contactId: ContactId;
  organizationId: OrganizationId;
}>;

export type LeadMessageReference = Readonly<{
  messageId: MessageId;
  organizationId: OrganizationId;
}>;

export type LeadAppointmentRequestReference = Readonly<{
  appointmentRequestId: AppointmentRequestId;
  organizationId: OrganizationId;
}>;

export type LeadQualificationEvidence = Readonly<{
  evaluationId: ResourceId;
  organizationId: OrganizationId;
  policyId: ResourceId;
}>;

export type LeadCommandContext = Readonly<{
  actor: ActorRef;
  expectedVersion: AggregateVersion;
  occurredAt: UtcTimestamp;
  organizationId: OrganizationId;
}>;

export type CreateLeadCommand = Readonly<{
  actor: ActorRef;
  contact: LeadContactReference;
  leadId: LeadId;
  occurredAt: UtcTimestamp;
  organizationId: OrganizationId;
}>;

export type RecordEngagementCommand = LeadCommandContext &
  Readonly<{
    sourceMessage: LeadMessageReference;
  }>;

export type QualifyLeadCommand = LeadCommandContext &
  Readonly<{
    qualification: LeadQualificationEvidence;
  }>;

export type DisqualifyLeadCommand = LeadCommandContext &
  Readonly<{
    qualification: LeadQualificationEvidence;
    reasonCodes: readonly LeadReasonCode[];
  }>;

export type ReopenDisqualifiedLeadCommand = LeadCommandContext &
  Readonly<{
    reasonCode: LeadReasonCode;
  }>;

export type RecordAppointmentRequestCommand = LeadCommandContext &
  Readonly<{
    appointmentRequest: LeadAppointmentRequestReference;
  }>;

export type RestoreAfterAppointmentRequestCommand = LeadCommandContext &
  Readonly<{
    appointmentRequest: LeadAppointmentRequestReference;
    reasonCode: LeadReasonCode;
  }>;

export type ConvertLeadCommand = LeadCommandContext &
  Readonly<{
    appointmentRequest: LeadAppointmentRequestReference;
  }>;

export type CloseLeadCommand = LeadCommandContext &
  Readonly<{
    reasonCode: LeadReasonCode;
  }>;

type EventIdentity = Readonly<{
  schemaId: SchemaId;
  schemaVersion: SchemaVersion;
}>;

type ValidTransitionContext = Readonly<{
  actor: ActorRef;
  nextVersion: AggregateVersion;
  occurredAt: UtcTimestamp;
}>;

type RecordDetails = Readonly<{
  appointmentRequestId?: AppointmentRequestId;
  policyId?: ResourceId;
  qualificationEvaluationId?: ResourceId;
  reasonCodes?: readonly LeadReasonCode[];
  sourceMessageId?: MessageId;
}>;

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const eventIdentity = (schema: object): EventIdentity => {
  const schemaId: unknown = Reflect.get(schema, "$id");
  const properties: unknown = Reflect.get(schema, "properties");
  const schemaVersion =
    isRecord(properties) && isRecord(properties["schema_version"])
      ? properties["schema_version"]["const"]
      : undefined;

  if (
    !isSchemaValue(SchemaIdSchema, schemaId) ||
    !isSchemaValue(SchemaVersionSchema, schemaVersion)
  ) {
    throw new TypeError("Invalid canonical Lead event identity");
  }

  return Object.freeze({ schemaId, schemaVersion });
};

const EVENT_IDENTITIES = Object.freeze({
  "lead.booking_requested": eventIdentity(DomainEventSchemas["lead.booking_requested"]),
  "lead.closed": eventIdentity(DomainEventSchemas["lead.closed"]),
  "lead.converted": eventIdentity(DomainEventSchemas["lead.converted"]),
  "lead.created": eventIdentity(DomainEventSchemas["lead.created"]),
  "lead.disqualified": eventIdentity(DomainEventSchemas["lead.disqualified"]),
  "lead.engaged": eventIdentity(DomainEventSchemas["lead.engaged"]),
  "lead.qualified": eventIdentity(DomainEventSchemas["lead.qualified"]),
  "lead.reopened": eventIdentity(LeadReopenedDomainEventV2Schema),
});

const createEventDraft = <Event extends LeadEvent>(
  eventType: Event["event_type"],
  aggregateVersion: AggregateVersion,
  payload: Event["payload"],
  identity: EventIdentity,
): DomainEventDraft<Event> =>
  Object.freeze({
    aggregate_version: aggregateVersion,
    event_type: eventType,
    payload: cloneAndFreeze(payload),
    schema_id: identity.schemaId,
    schema_version: identity.schemaVersion,
  });

const invalidReference = (): InvariantViolation<"invalid_reference"> =>
  invariantViolation("invalid_reference");

const invalidReasonCode = (): InvariantViolation<"invalid_reason_code"> =>
  invariantViolation("invalid_reason_code");

export const isLeadReasonCode = (value: unknown): value is LeadReasonCode =>
  isSchemaValue(DomainEventPayloadSchemas["lead.closed"], {
    lead_status: "closed",
    previous_lead_status: "new",
    reason_code: value,
  });

export const validateLeadReasonCode = (
  value: unknown,
): Result<LeadReasonCode, InvariantViolation<"invalid_reason_code">> =>
  isLeadReasonCode(value) ? success(value) : failure(invalidReasonCode());

const validateCreationContext = (
  command: CreateLeadCommand,
): Result<
  Readonly<{
    actor: ActorRef;
    contactId: ContactId;
    leadId: LeadId;
    occurredAt: UtcTimestamp;
    organizationId: OrganizationId;
  }>,
  LeadCreationError
> => {
  if (
    !isRecord(command) ||
    !isSchemaValue(ActorRefSchema, command["actor"]) ||
    !isSchemaValue(ContactIdSchema, command["contact"]?.contactId) ||
    !isSchemaValue(LeadIdSchema, command["leadId"]) ||
    !isSchemaValue(OrganizationIdSchema, command["organizationId"]) ||
    !isSchemaValue(OrganizationIdSchema, command["contact"]?.organizationId) ||
    !isSchemaValue(UtcTimestampSchema, command["occurredAt"])
  ) {
    return failure(invalidReference());
  }

  const sameOrganization = requireSameOrganization(
    command["organizationId"],
    command["contact"].organizationId,
  );
  if (!sameOrganization.ok) {
    return sameOrganization;
  }

  return success(
    Object.freeze({
      actor: command["actor"],
      contactId: command["contact"].contactId,
      leadId: command["leadId"],
      occurredAt: command["occurredAt"],
      organizationId: command["organizationId"],
    }),
  );
};

const validateScopedReference = <Identifier>(
  reference: unknown,
  idMember: string,
  isIdentifier: (value: unknown) => value is Identifier,
  organizationId: OrganizationId,
): Result<Identifier, InvariantViolation<"invalid_reference"> | TenantScopeViolation> => {
  if (
    !isRecord(reference) ||
    !isIdentifier(reference[idMember]) ||
    !isSchemaValue(OrganizationIdSchema, reference["organizationId"])
  ) {
    return failure(invalidReference());
  }

  const sameOrganization = requireSameOrganization(organizationId, reference["organizationId"]);
  return sameOrganization.ok ? success(reference[idMember]) : sameOrganization;
};

const validateQualificationEvidence = (
  evidence: unknown,
  organizationId: OrganizationId,
): Result<LeadQualificationEvidence, QualificationIncomplete | TenantScopeViolation> => {
  if (
    !isRecord(evidence) ||
    !isSchemaValue(OrganizationIdSchema, evidence["organizationId"]) ||
    !isSchemaValue(ResourceIdSchema, evidence["policyId"]) ||
    !isSchemaValue(ResourceIdSchema, evidence["evaluationId"])
  ) {
    return failure(qualificationIncomplete());
  }

  const sameOrganization = requireSameOrganization(organizationId, evidence["organizationId"]);
  if (!sameOrganization.ok) {
    return sameOrganization;
  }

  return success(
    Object.freeze({
      evaluationId: evidence["evaluationId"],
      organizationId: evidence["organizationId"],
      policyId: evidence["policyId"],
    }),
  );
};

const beginTransition = (
  lead: Lead,
  command: LeadCommandContext,
  commandName: ExistingLeadCommandName,
  allowedStatuses: readonly LeadStatus[],
): Result<ValidTransitionContext, LeadCommandError> => {
  const validLead = validateLead(lead);
  if (!validLead.ok) {
    return validLead;
  }

  if (
    !isRecord(command) ||
    !isSchemaValue(ActorRefSchema, command["actor"]) ||
    !isSchemaValue(AggregateVersionSchema, command["expectedVersion"]) ||
    !isSchemaValue(OrganizationIdSchema, command["organizationId"]) ||
    !isSchemaValue(UtcTimestampSchema, command["occurredAt"])
  ) {
    return failure(invalidReference());
  }

  const sameOrganization = requireSameOrganization(lead.organizationId, command["organizationId"]);
  if (!sameOrganization.ok) {
    return sameOrganization;
  }

  const nextVersion = advanceAggregateVersion(lead.version, command["expectedVersion"]);
  if (!nextVersion.ok) {
    return nextVersion;
  }

  if (!allowedStatuses.includes(lead.status)) {
    return failure(invalidStateTransition(lead.status, commandName));
  }

  return success(
    Object.freeze({
      actor: command["actor"],
      nextVersion: nextVersion.value,
      occurredAt: command["occurredAt"],
    }),
  );
};

const createTransitionRecord = (
  lead: Pick<Lead, "leadId" | "organizationId">,
  context: Readonly<{ actor: ActorRef; occurredAt: UtcTimestamp }>,
  command: LeadCommandName,
  fromStatus: LeadStatus | null,
  toStatus: LeadStatus,
  version: AggregateVersion,
  details: RecordDetails = {},
): LeadTransitionRecord =>
  Object.freeze({
    actor: context.actor,
    appointmentRequestId: details.appointmentRequestId ?? null,
    command,
    fromStatus,
    leadId: lead.leadId,
    occurredAt: context.occurredAt,
    organizationId: lead.organizationId,
    policyId: details.policyId ?? null,
    qualificationEvaluationId: details.qualificationEvaluationId ?? null,
    reasonCodes: details.reasonCodes ?? [],
    sourceMessageId: details.sourceMessageId ?? null,
    toStatus,
    version,
  });

const completeTransition = (
  lead: Lead,
  context: ValidTransitionContext,
  command: ExistingLeadCommandName,
  toStatus: LeadStatus,
  event: LeadEventDraft,
  changes: Partial<Pick<Lead, "appointmentRequestId" | "qualification">> = {},
  recordDetails: RecordDetails = {},
): LeadCommandResult => {
  const nextLead: Lead = {
    ...lead,
    ...changes,
    status: toStatus,
    version: context.nextVersion,
  };
  const record = createTransitionRecord(
    lead,
    context,
    command,
    lead.status,
    toStatus,
    context.nextVersion,
    recordDetails,
  );

  return transitionSuccess(nextLead, [event], [record]);
};

export const createLead = (command: CreateLeadCommand): LeadCreationResult => {
  const validContext = validateCreationContext(command);
  if (!validContext.ok) {
    return transitionFailure(validContext.error);
  }

  const version = initialAggregateVersion();
  const lead: Lead = {
    appointmentRequestId: null,
    contactId: validContext.value.contactId,
    leadId: validContext.value.leadId,
    organizationId: validContext.value.organizationId,
    qualification: null,
    status: "new",
    version,
  };
  const payload: DomainEventFor<"lead.created">["payload"] = {
    contact_id: validContext.value.contactId,
    lead_status: "new",
  };
  const event = createEventDraft<DomainEventFor<"lead.created">>(
    "lead.created",
    version,
    payload,
    EVENT_IDENTITIES["lead.created"],
  );
  const record = createTransitionRecord(
    lead,
    validContext.value,
    "create_lead",
    null,
    "new",
    version,
  );

  return transitionSuccess(lead, [event], [record]);
};

export const recordEngagement = (
  lead: Lead,
  command: RecordEngagementCommand,
): LeadCommandResult => {
  const sourceMessage = validateScopedReference(
    command.sourceMessage,
    "messageId",
    (value): value is MessageId => isSchemaValue(MessageIdSchema, value),
    lead.organizationId,
  );
  if (!sourceMessage.ok) {
    return transitionFailure(sourceMessage.error);
  }

  const context = beginTransition(lead, command, "record_engagement", ["new"]);
  if (!context.ok) {
    return transitionFailure(context.error);
  }

  const payload: DomainEventFor<"lead.engaged">["payload"] = {
    lead_status: "engaged",
    source_message_id: sourceMessage.value,
  };
  const event = createEventDraft<DomainEventFor<"lead.engaged">>(
    "lead.engaged",
    context.value.nextVersion,
    payload,
    EVENT_IDENTITIES["lead.engaged"],
  );

  return completeTransition(
    lead,
    context.value,
    "record_engagement",
    "engaged",
    event,
    {},
    {
      sourceMessageId: sourceMessage.value,
    },
  );
};

export const qualifyLead = (lead: Lead, command: QualifyLeadCommand): LeadCommandResult => {
  const qualification = validateQualificationEvidence(command.qualification, lead.organizationId);
  if (!qualification.ok) {
    return transitionFailure(qualification.error);
  }

  const context = beginTransition(lead, command, "qualify_lead", ["engaged"]);
  if (!context.ok) {
    return transitionFailure(context.error);
  }

  const payload = {
    lead_status: "qualified",
    policy_id: qualification.value.policyId,
    qualification_evaluation_id: qualification.value.evaluationId,
  };
  if (!isSchemaValue(DomainEventPayloadSchemas["lead.qualified"], payload)) {
    return transitionFailure(qualificationIncomplete());
  }

  const nextQualification: LeadQualification = {
    evaluationId: qualification.value.evaluationId,
    policyId: qualification.value.policyId,
    reasonCodes: [],
    result: "qualified",
  };
  const event = createEventDraft<DomainEventFor<"lead.qualified">>(
    "lead.qualified",
    context.value.nextVersion,
    payload,
    EVENT_IDENTITIES["lead.qualified"],
  );

  return completeTransition(
    lead,
    context.value,
    "qualify_lead",
    "qualified",
    event,
    { qualification: nextQualification },
    {
      policyId: qualification.value.policyId,
      qualificationEvaluationId: qualification.value.evaluationId,
    },
  );
};

export const disqualifyLead = (lead: Lead, command: DisqualifyLeadCommand): LeadCommandResult => {
  const qualification = validateQualificationEvidence(command.qualification, lead.organizationId);
  if (!qualification.ok) {
    return transitionFailure(qualification.error);
  }

  const context = beginTransition(lead, command, "disqualify_lead", ["new", "engaged"]);
  if (!context.ok) {
    return transitionFailure(context.error);
  }

  const payload = {
    lead_status: "disqualified",
    policy_id: qualification.value.policyId,
    qualification_evaluation_id: qualification.value.evaluationId,
    reason_codes: command.reasonCodes,
  };
  if (!isSchemaValue(DomainEventPayloadSchemas["lead.disqualified"], payload)) {
    return transitionFailure(invalidReasonCode());
  }

  const nextQualification: LeadQualification = {
    evaluationId: qualification.value.evaluationId,
    policyId: qualification.value.policyId,
    reasonCodes: command.reasonCodes,
    result: "disqualified",
  };
  const event = createEventDraft<DomainEventFor<"lead.disqualified">>(
    "lead.disqualified",
    context.value.nextVersion,
    payload,
    EVENT_IDENTITIES["lead.disqualified"],
  );

  return completeTransition(
    lead,
    context.value,
    "disqualify_lead",
    "disqualified",
    event,
    { qualification: nextQualification },
    {
      policyId: qualification.value.policyId,
      qualificationEvaluationId: qualification.value.evaluationId,
      reasonCodes: command.reasonCodes,
    },
  );
};

export const reopenDisqualifiedLead = (
  lead: Lead,
  command: ReopenDisqualifiedLeadCommand,
): LeadCommandResult => {
  const reasonCode = validateLeadReasonCode(command.reasonCode);
  if (!reasonCode.ok) {
    return transitionFailure(reasonCode.error);
  }

  const context = beginTransition(lead, command, "reopen_disqualified_lead", ["disqualified"]);
  if (!context.ok) {
    return transitionFailure(context.error);
  }

  const payload = {
    lead_status: "engaged",
    previous_lead_status: "disqualified",
    reason_code: reasonCode.value,
  };
  if (!isSchemaValue(LeadReopenedDomainEventPayloadV2Schema, payload)) {
    return transitionFailure(invalidReasonCode());
  }

  const event = createEventDraft<LeadReopenedDomainEventV2>(
    "lead.reopened",
    context.value.nextVersion,
    payload,
    EVENT_IDENTITIES["lead.reopened"],
  );

  return completeTransition(
    lead,
    context.value,
    "reopen_disqualified_lead",
    "engaged",
    event,
    {},
    { reasonCodes: [reasonCode.value] },
  );
};

export const recordAppointmentRequest = (
  lead: Lead,
  command: RecordAppointmentRequestCommand,
): LeadCommandResult => {
  const appointmentRequest = validateScopedReference(
    command.appointmentRequest,
    "appointmentRequestId",
    (value): value is AppointmentRequestId => isSchemaValue(AppointmentRequestIdSchema, value),
    lead.organizationId,
  );
  if (!appointmentRequest.ok) {
    return transitionFailure(appointmentRequest.error);
  }

  const context = beginTransition(lead, command, "record_appointment_request", ["qualified"]);
  if (!context.ok) {
    return transitionFailure(context.error);
  }

  const payload: DomainEventFor<"lead.booking_requested">["payload"] = {
    appointment_request_id: appointmentRequest.value,
    lead_status: "booking_requested",
  };
  const event = createEventDraft<DomainEventFor<"lead.booking_requested">>(
    "lead.booking_requested",
    context.value.nextVersion,
    payload,
    EVENT_IDENTITIES["lead.booking_requested"],
  );

  return completeTransition(
    lead,
    context.value,
    "record_appointment_request",
    "booking_requested",
    event,
    { appointmentRequestId: appointmentRequest.value },
    { appointmentRequestId: appointmentRequest.value },
  );
};

export const restoreAfterAppointmentRequest = (
  lead: Lead,
  command: RestoreAfterAppointmentRequestCommand,
): LeadCommandResult => {
  const appointmentRequest = validateScopedReference(
    command.appointmentRequest,
    "appointmentRequestId",
    (value): value is AppointmentRequestId => isSchemaValue(AppointmentRequestIdSchema, value),
    lead.organizationId,
  );
  if (!appointmentRequest.ok) {
    return transitionFailure(appointmentRequest.error);
  }

  const reasonCode = validateLeadReasonCode(command.reasonCode);
  if (!reasonCode.ok) {
    return transitionFailure(reasonCode.error);
  }

  const context = beginTransition(lead, command, "restore_after_appointment_request", [
    "booking_requested",
  ]);
  if (!context.ok) {
    return transitionFailure(context.error);
  }

  if (lead.appointmentRequestId !== appointmentRequest.value) {
    return transitionFailure(invalidReference());
  }

  const payload = {
    appointment_request_id: appointmentRequest.value,
    lead_status: "qualified",
    previous_lead_status: "booking_requested",
    reason_code: reasonCode.value,
  };
  if (!isSchemaValue(LeadReopenedDomainEventPayloadV2Schema, payload)) {
    return transitionFailure(invalidReasonCode());
  }

  const event = createEventDraft<LeadReopenedDomainEventV2>(
    "lead.reopened",
    context.value.nextVersion,
    payload,
    EVENT_IDENTITIES["lead.reopened"],
  );

  return completeTransition(
    lead,
    context.value,
    "restore_after_appointment_request",
    "qualified",
    event,
    { appointmentRequestId: null },
    {
      appointmentRequestId: appointmentRequest.value,
      reasonCodes: [reasonCode.value],
    },
  );
};

export const convertLead = (lead: Lead, command: ConvertLeadCommand): LeadCommandResult => {
  const appointmentRequest = validateScopedReference(
    command.appointmentRequest,
    "appointmentRequestId",
    (value): value is AppointmentRequestId => isSchemaValue(AppointmentRequestIdSchema, value),
    lead.organizationId,
  );
  if (!appointmentRequest.ok) {
    return transitionFailure(appointmentRequest.error);
  }

  const context = beginTransition(lead, command, "convert_lead", ["booking_requested"]);
  if (!context.ok) {
    return transitionFailure(context.error);
  }

  if (lead.appointmentRequestId !== appointmentRequest.value) {
    return transitionFailure(invalidReference());
  }

  const payload: DomainEventFor<"lead.converted">["payload"] = {
    appointment_request_id: appointmentRequest.value,
    lead_status: "converted",
  };
  const event = createEventDraft<DomainEventFor<"lead.converted">>(
    "lead.converted",
    context.value.nextVersion,
    payload,
    EVENT_IDENTITIES["lead.converted"],
  );

  return completeTransition(
    lead,
    context.value,
    "convert_lead",
    "converted",
    event,
    {},
    {
      appointmentRequestId: appointmentRequest.value,
    },
  );
};

export const closeLead = (lead: Lead, command: CloseLeadCommand): LeadCommandResult => {
  const reasonCode = validateLeadReasonCode(command.reasonCode);
  if (!reasonCode.ok) {
    return transitionFailure(reasonCode.error);
  }

  const context = beginTransition(lead, command, "close_lead", [
    "new",
    "engaged",
    "qualified",
    "booking_requested",
  ]);
  if (!context.ok) {
    return transitionFailure(context.error);
  }

  const payload = {
    lead_status: "closed",
    previous_lead_status: lead.status,
    reason_code: reasonCode.value,
  };
  if (!isSchemaValue(DomainEventPayloadSchemas["lead.closed"], payload)) {
    return transitionFailure(invalidReasonCode());
  }

  const event = createEventDraft<DomainEventFor<"lead.closed">>(
    "lead.closed",
    context.value.nextVersion,
    payload,
    EVENT_IDENTITIES["lead.closed"],
  );

  const recordDetails: RecordDetails =
    lead.appointmentRequestId === null
      ? { reasonCodes: [reasonCode.value] }
      : {
          appointmentRequestId: lead.appointmentRequestId,
          reasonCodes: [reasonCode.value],
        };

  return completeTransition(lead, context.value, "close_lead", "closed", event, {}, recordDetails);
};
