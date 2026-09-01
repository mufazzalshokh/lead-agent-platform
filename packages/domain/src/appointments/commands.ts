import {
  ActorRefSchema,
  AggregateVersionSchema,
  AppointmentRequestIdSchema,
  ContactIdSchema,
  ConversationIdSchema,
  DomainEventSchemas,
  LeadIdSchema,
  LocationIdSchema,
  MembershipIdSchema,
  MessageIdSchema,
  OrganizationIdSchema,
  ResourceIdSchema,
  SchemaIdSchema,
  SchemaVersionSchema,
  ServiceIdSchema,
  UtcTimestampSchema,
  isSchemaValue,
  type ActorRef,
  type AggregateVersion,
  type AppointmentRequestId,
  type ContactId,
  type ConversationId,
  type DomainEventFor,
  type LeadId,
  type LocationId,
  type MembershipId,
  type MessageId,
  type OrganizationId,
  type ResourceId,
  type SchemaId,
  type SchemaVersion,
  type ServiceId,
  type UtcTimestamp,
} from "@lead-agent/contracts";

import {
  confirmationEvidenceInvalid,
  invalidStateTransition,
  invariantViolation,
  type ConcurrencyConflict,
  type ConfirmationEvidenceInvalid,
  type InvalidStateTransition,
  type InvariantViolation,
  type OfferExpired,
  type TenantScopeViolation,
} from "../foundation/errors.js";
import type { DomainEventDraft } from "../foundation/event-draft.js";
import { cloneAndFreeze } from "../foundation/immutable.js";
import { failure, success, type Result } from "../foundation/result.js";
import {
  transitionFailure,
  transitionSuccess,
  type TransitionResult,
} from "../foundation/transition.js";
import { advanceAggregateVersion, initialAggregateVersion } from "../foundation/version.js";
import { requireSameOrganization } from "../values/tenant.js";
import {
  compareUtcTimestamps,
  isNamedIanaTimeZone,
  isWithinHalfOpenInterval,
  requireUnexpired,
  validateUtcTimeWindow,
  type IanaTimeZone,
} from "../values/time.js";
import {
  isAppointmentOfferVersion,
  validateAppointmentRequest,
  validateAppointmentRequestReasonCode,
  type AppointmentCancellation,
  type AppointmentConfirmationEvidence,
  type AppointmentConfirmationOffer,
  type AppointmentExpiration,
  type AppointmentOffer,
  type AppointmentOfferVersion,
  type AppointmentPreference,
  type AppointmentRequest,
  type AppointmentRequestReasonCode,
  type AppointmentRequestStatus,
  type AppointmentStaffDecision,
  type InvalidAppointmentRequest,
  type InvalidAppointmentRequestReasonCode,
  type StaffAttestedExternalConfirmationEvidence,
  type TelegramConfirmationEvidence,
} from "./appointment-request.js";

type AppointmentRequestEvent =
  | DomainEventFor<"appointment_request.created">
  | DomainEventFor<"appointment_request.staff_accepted">
  | DomainEventFor<"appointment_request.customer_confirmation_requested">
  | DomainEventFor<"appointment_request.confirmed">
  | DomainEventFor<"appointment_request.rejected">
  | DomainEventFor<"appointment_request.cancelled">
  | DomainEventFor<"appointment_request.expired">;

export type AppointmentRequestEventDraft = DomainEventDraft<AppointmentRequestEvent>;

export type AppointmentLeadReference = Readonly<{
  leadId: LeadId;
  organizationId: OrganizationId;
}>;

export type AppointmentContactReference = Readonly<{
  contactId: ContactId;
  organizationId: OrganizationId;
}>;

export type AppointmentConversationReference = Readonly<{
  conversationId: ConversationId;
  organizationId: OrganizationId;
}>;

export type AppointmentServiceReference = Readonly<{
  organizationId: OrganizationId;
  serviceId: ServiceId;
  serviceVersionId: ResourceId;
}>;

export type AppointmentLocationReference = Readonly<{
  locationId: LocationId;
  locationVersionId: ResourceId;
  organizationId: OrganizationId;
}>;

export type AppointmentBusinessPolicyReference = Readonly<{
  businessPolicyId: ResourceId;
  organizationId: OrganizationId;
}>;

export type AppointmentMessageReference = Readonly<{
  messageId: MessageId;
  organizationId: OrganizationId;
}>;

export type AppointmentStaffReference = Readonly<{
  membershipId: MembershipId;
  organizationId: OrganizationId;
}>;

export type AppointmentEvidenceReference = Readonly<{
  evidenceId: ResourceId;
  organizationId: OrganizationId;
}>;

export type AppointmentRequestReference = Readonly<{
  appointmentRequestId: AppointmentRequestId;
  organizationId: OrganizationId;
}>;

export type AppointmentCustomerInitiator = Readonly<{
  contact: AppointmentContactReference;
  kind: "customer";
}>;

export type AppointmentStaffInitiator = Readonly<{
  kind: "staff";
  staff: AppointmentStaffReference;
}>;

export type AppointmentInitiator = AppointmentCustomerInitiator | AppointmentStaffInitiator;

export type ApprovedAppointmentSlot = Readonly<{
  endAt: UtcTimestamp;
  localEnd: string;
  localStart: string;
  startAt: UtcTimestamp;
  timeZone: IanaTimeZone;
}>;

export type AppointmentCommandContext = Readonly<{
  actor: ActorRef;
  expectedVersion: AggregateVersion;
  occurredAt: UtcTimestamp;
  organizationId: OrganizationId;
}>;

export type CreateAppointmentRequestCommand = Readonly<{
  actor: ActorRef;
  appointmentRequestId: AppointmentRequestId;
  businessPolicy: AppointmentBusinessPolicyReference;
  contact: AppointmentContactReference;
  conversation: AppointmentConversationReference;
  initiator: AppointmentInitiator;
  lead: AppointmentLeadReference;
  location: AppointmentLocationReference;
  occurredAt: UtcTimestamp;
  organizationId: OrganizationId;
  preferences: readonly AppointmentPreference[];
  service: AppointmentServiceReference;
  sourceMessage: AppointmentMessageReference;
}>;

export type StaffAcceptAppointmentRequestCommand = AppointmentCommandContext &
  Readonly<{
    location: AppointmentLocationReference;
    offeredSlot: ApprovedAppointmentSlot;
    staff: AppointmentStaffReference;
  }>;

export type RejectAppointmentRequestCommand = AppointmentCommandContext &
  Readonly<{
    reasonCode: AppointmentRequestReasonCode;
    staff: AppointmentStaffReference;
  }>;

export type PrepareCustomerConfirmationCommand = Readonly<{
  actor: ActorRef;
  expectedVersion: AggregateVersion;
  expiresAt: UtcTimestamp;
  issuedAt: UtcTimestamp;
  offerVersion: AppointmentOfferVersion;
  organizationId: OrganizationId;
}>;

type ConfirmationEvidenceInputBase = Readonly<{
  appointmentRequest: AppointmentRequestReference;
  contact: AppointmentContactReference;
  customerActedAt: UtcTimestamp;
  evidence: AppointmentEvidenceReference;
  offerVersion: AppointmentOfferVersion;
}>;

export type CustomerSessionConfirmationEvidenceInput = ConfirmationEvidenceInputBase &
  Readonly<{
    source: "customer_session";
  }>;

export type TelegramConfirmationEvidenceInput = ConfirmationEvidenceInputBase &
  Readonly<{
    source: "telegram";
    sourceMessage: AppointmentMessageReference;
  }>;

export type StaffAttestedExternalConfirmationEvidenceInput = ConfirmationEvidenceInputBase &
  Readonly<{
    attestationMethod: "in_person" | "phone";
    attestationReasonCode: AppointmentRequestReasonCode;
    customerAct: "explicit_confirmation";
    protectedEvidence: AppointmentEvidenceReference | null;
    source: "staff_attested_external";
    staff: AppointmentStaffReference;
  }>;

export type AppointmentConfirmationEvidenceInput =
  | CustomerSessionConfirmationEvidenceInput
  | TelegramConfirmationEvidenceInput
  | StaffAttestedExternalConfirmationEvidenceInput;

export type ConfirmAppointmentRequestCommand = Readonly<{
  actor: ActorRef;
  evidence: AppointmentConfirmationEvidenceInput;
  expectedVersion: AggregateVersion;
  now: UtcTimestamp;
  organizationId: OrganizationId;
}>;

export type CancelAppointmentRequestCommand = AppointmentCommandContext &
  Readonly<{
    initiator: AppointmentInitiator;
    reasonCode: AppointmentRequestReasonCode;
  }>;

export type ExpireAppointmentRequestCommand = Readonly<{
  actor: ActorRef;
  expectedVersion: AggregateVersion;
  now: UtcTimestamp;
  organizationId: OrganizationId;
  reasonCode: AppointmentRequestReasonCode;
}>;

export type AppointmentRequestCommandName =
  | "create_appointment_request"
  | "staff_accept_appointment_request"
  | "reject_appointment_request"
  | "prepare_customer_confirmation"
  | "confirm_appointment_request"
  | "cancel_appointment_request"
  | "expire_appointment_request";

export type ExistingAppointmentRequestCommandName = Exclude<
  AppointmentRequestCommandName,
  "create_appointment_request"
>;

export type AppointmentRequestTransitionRecord = Readonly<{
  actor: ActorRef;
  appointmentRequestId: AppointmentRequestId;
  command: AppointmentRequestCommandName;
  fromStatus: AppointmentRequestStatus | null;
  occurredAt: UtcTimestamp;
  offerVersion: AppointmentOfferVersion | null;
  organizationId: OrganizationId;
  reasonCode: AppointmentRequestReasonCode | null;
  toStatus: AppointmentRequestStatus;
  version: AggregateVersion;
}>;

type VersionError =
  | ConcurrencyConflict<AggregateVersion>
  | InvariantViolation<"invalid_version" | "version_overflow">;

export type AppointmentRequestCreationError =
  InvalidAppointmentRequest | InvariantViolation<"invalid_reference"> | TenantScopeViolation;

export type AppointmentRequestCommandError =
  | AppointmentRequestCreationError
  | ConfirmationEvidenceInvalid
  | InvalidAppointmentRequestReasonCode
  | InvariantViolation<"appointment_request_not_due">
  | InvalidStateTransition<AppointmentRequestStatus, ExistingAppointmentRequestCommandName>
  | OfferExpired
  | VersionError;

export type AppointmentRequestCreationResult = TransitionResult<
  AppointmentRequest,
  AppointmentRequestEventDraft,
  AppointmentRequestCreationError,
  AppointmentRequestTransitionRecord
>;

export type AppointmentRequestCommandResult = TransitionResult<
  AppointmentRequest,
  AppointmentRequestEventDraft,
  AppointmentRequestCommandError,
  AppointmentRequestTransitionRecord
>;

type EventIdentity = Readonly<{
  schemaId: SchemaId;
  schemaVersion: SchemaVersion;
}>;

type ValidTransitionContext = Readonly<{
  actor: ActorRef;
  nextVersion: AggregateVersion;
  occurredAt: UtcTimestamp;
}>;

type TransitionDetails = Readonly<{
  offerVersion?: AppointmentOfferVersion | null;
  reasonCode?: AppointmentRequestReasonCode;
}>;

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const identifiersEqual = (left: string, right: string): boolean => left === right;

const hasOnlyKeys = (
  value: Readonly<Record<string, unknown>>,
  keys: readonly string[],
): boolean => {
  const allowed = new Set(keys);
  return (
    Object.keys(value).every((key) => allowed.has(key)) && Object.keys(value).length === keys.length
  );
};

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
    throw new TypeError("Invalid canonical AppointmentRequest event identity");
  }

  return Object.freeze({ schemaId, schemaVersion });
};

const EVENT_IDENTITIES = Object.freeze({
  "appointment_request.cancelled": eventIdentity(
    DomainEventSchemas["appointment_request.cancelled"],
  ),
  "appointment_request.confirmed": eventIdentity(
    DomainEventSchemas["appointment_request.confirmed"],
  ),
  "appointment_request.created": eventIdentity(DomainEventSchemas["appointment_request.created"]),
  "appointment_request.customer_confirmation_requested": eventIdentity(
    DomainEventSchemas["appointment_request.customer_confirmation_requested"],
  ),
  "appointment_request.expired": eventIdentity(DomainEventSchemas["appointment_request.expired"]),
  "appointment_request.rejected": eventIdentity(DomainEventSchemas["appointment_request.rejected"]),
  "appointment_request.staff_accepted": eventIdentity(
    DomainEventSchemas["appointment_request.staff_accepted"],
  ),
});

const createEventDraft = <Event extends AppointmentRequestEvent>(
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

const invalidAppointmentRequest = (): InvalidAppointmentRequest =>
  invariantViolation("invalid_appointment_request");

const appointmentRequestNotDue = (): InvariantViolation<"appointment_request_not_due"> =>
  invariantViolation("appointment_request_not_due");

const initialAppointmentOfferVersion = (): AppointmentOfferVersion => {
  const initialVersion = initialAggregateVersion();
  if (!isAppointmentOfferVersion(initialVersion)) {
    throw new TypeError("Invalid initial AppointmentRequest offer version");
  }
  return initialVersion;
};

const validateScopedReference = <Identifier>(
  reference: unknown,
  idMember: string,
  additionalMembers: readonly string[],
  isIdentifier: (value: unknown) => value is Identifier,
  organizationId: OrganizationId,
): Result<Identifier, InvariantViolation<"invalid_reference"> | TenantScopeViolation> => {
  if (
    !isRecord(reference) ||
    !hasOnlyKeys(reference, [idMember, "organizationId", ...additionalMembers]) ||
    !isIdentifier(reference[idMember]) ||
    !isSchemaValue(OrganizationIdSchema, reference["organizationId"])
  ) {
    return failure(invalidReference());
  }

  const sameOrganization = requireSameOrganization(organizationId, reference["organizationId"]);
  return sameOrganization.ok ? success(reference[idMember]) : sameOrganization;
};

const validateSimpleReference = <Identifier>(
  reference: unknown,
  idMember: string,
  isIdentifier: (value: unknown) => value is Identifier,
  organizationId: OrganizationId,
): Result<Identifier, InvariantViolation<"invalid_reference"> | TenantScopeViolation> =>
  validateScopedReference(reference, idMember, [], isIdentifier, organizationId);

const validateContactReference = (
  reference: unknown,
  organizationId: OrganizationId,
): Result<ContactId, InvariantViolation<"invalid_reference"> | TenantScopeViolation> =>
  validateSimpleReference(
    reference,
    "contactId",
    (value): value is ContactId => isSchemaValue(ContactIdSchema, value),
    organizationId,
  );

const validateStaffReference = (
  reference: unknown,
  organizationId: OrganizationId,
): Result<MembershipId, InvariantViolation<"invalid_reference"> | TenantScopeViolation> =>
  validateSimpleReference(
    reference,
    "membershipId",
    (value): value is MembershipId => isSchemaValue(MembershipIdSchema, value),
    organizationId,
  );

const validateInitiator = (
  actor: ActorRef,
  initiator: unknown,
  organizationId: OrganizationId,
  contactId: ContactId,
): Result<void, InvariantViolation<"invalid_reference"> | TenantScopeViolation> => {
  if (
    !isRecord(initiator) ||
    !hasOnlyKeys(initiator, ["kind", initiator["kind"] === "customer" ? "contact" : "staff"])
  ) {
    return failure(invalidReference());
  }

  if (initiator["kind"] === "customer") {
    const contact = validateContactReference(initiator["contact"], organizationId);
    if (!contact.ok) {
      return contact;
    }
    return actor.actor_type === "customer" &&
      identifiersEqual(actor.actor_id, contact.value) &&
      contact.value === contactId
      ? success(undefined)
      : failure(invalidReference());
  }

  if (initiator["kind"] === "staff") {
    const staff = validateStaffReference(initiator["staff"], organizationId);
    if (!staff.ok) {
      return staff;
    }
    return actor.actor_type === "member" && identifiersEqual(actor.actor_id, staff.value)
      ? success(undefined)
      : failure(invalidReference());
  }

  return failure(invalidReference());
};

const validateStaffActor = (
  actor: ActorRef,
  staffReference: unknown,
  organizationId: OrganizationId,
): Result<MembershipId, InvariantViolation<"invalid_reference"> | TenantScopeViolation> => {
  const staff = validateStaffReference(staffReference, organizationId);
  if (!staff.ok) {
    return staff;
  }
  return actor.actor_type === "member" && identifiersEqual(actor.actor_id, staff.value)
    ? staff
    : failure(invalidReference());
};

const latestLifecycleTimestamp = (request: AppointmentRequest): UtcTimestamp =>
  request.confirmedAt ??
  request.confirmationOffer?.issuedAt ??
  request.staffDecision?.decidedAt ??
  request.createdAt;

const beginTransition = (
  request: AppointmentRequest,
  command: unknown,
  commandName: ExistingAppointmentRequestCommandName,
  occurredAtMember: "now" | "occurredAt" | "issuedAt",
  allowedStatuses: readonly AppointmentRequestStatus[],
): Result<ValidTransitionContext, AppointmentRequestCommandError> => {
  const validRequest = validateAppointmentRequest(request);
  if (!validRequest.ok) {
    return validRequest;
  }
  if (
    !isRecord(command) ||
    !isSchemaValue(ActorRefSchema, command["actor"]) ||
    !isSchemaValue(AggregateVersionSchema, command["expectedVersion"]) ||
    !isSchemaValue(OrganizationIdSchema, command["organizationId"]) ||
    !isSchemaValue(UtcTimestampSchema, command[occurredAtMember])
  ) {
    return failure(invalidReference());
  }

  const sameOrganization = requireSameOrganization(
    request.organizationId,
    command["organizationId"],
  );
  if (!sameOrganization.ok) {
    return sameOrganization;
  }

  const nextVersion = advanceAggregateVersion(request.version, command["expectedVersion"]);
  if (!nextVersion.ok) {
    return nextVersion;
  }

  if (!allowedStatuses.includes(request.status)) {
    return failure(invalidStateTransition(request.status, commandName));
  }

  const occurrenceOrder = compareUtcTimestamps(
    command[occurredAtMember],
    latestLifecycleTimestamp(request),
  );
  if (!occurrenceOrder.ok || occurrenceOrder.value < 0) {
    return failure(invalidAppointmentRequest());
  }

  return success(
    Object.freeze({
      actor: command["actor"],
      nextVersion: nextVersion.value,
      occurredAt: command[occurredAtMember],
    }),
  );
};

const createTransitionRecord = (
  request: Pick<AppointmentRequest, "appointmentRequestId" | "organizationId">,
  context: Readonly<{ actor: ActorRef; occurredAt: UtcTimestamp }>,
  command: AppointmentRequestCommandName,
  fromStatus: AppointmentRequestStatus | null,
  toStatus: AppointmentRequestStatus,
  version: AggregateVersion,
  details: TransitionDetails = {},
): AppointmentRequestTransitionRecord =>
  Object.freeze({
    actor: context.actor,
    appointmentRequestId: request.appointmentRequestId,
    command,
    fromStatus,
    occurredAt: context.occurredAt,
    offerVersion: details.offerVersion ?? null,
    organizationId: request.organizationId,
    reasonCode: details.reasonCode ?? null,
    toStatus,
    version,
  });

const completeTransition = (
  request: AppointmentRequest,
  context: ValidTransitionContext,
  command: ExistingAppointmentRequestCommandName,
  toStatus: AppointmentRequestStatus,
  event: AppointmentRequestEventDraft,
  changes: Partial<
    Pick<
      AppointmentRequest,
      | "cancellation"
      | "confirmationEvidence"
      | "confirmationOffer"
      | "confirmedAt"
      | "expiration"
      | "offer"
      | "staffDecision"
    >
  > = {},
  details: TransitionDetails = {},
): AppointmentRequestCommandResult => {
  const nextRequest: AppointmentRequest = {
    ...request,
    ...changes,
    status: toStatus,
    version: context.nextVersion,
  };
  const validNextRequest = validateAppointmentRequest(nextRequest);
  if (!validNextRequest.ok) {
    return transitionFailure(validNextRequest.error);
  }

  return transitionSuccess(
    nextRequest,
    [event],
    [
      createTransitionRecord(
        request,
        context,
        command,
        request.status,
        toStatus,
        context.nextVersion,
        details,
      ),
    ],
  );
};

const validateApprovedSlot = (
  value: unknown,
  occurredAt: UtcTimestamp,
): Result<ApprovedAppointmentSlot, InvalidAppointmentRequest> => {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["endAt", "localEnd", "localStart", "startAt", "timeZone"]) ||
    !isSchemaValue(UtcTimestampSchema, value["startAt"]) ||
    !isSchemaValue(UtcTimestampSchema, value["endAt"]) ||
    !isNamedIanaTimeZone(value["timeZone"]) ||
    typeof value["localStart"] !== "string" ||
    value["localStart"].length < 1 ||
    value["localStart"].length > 100 ||
    typeof value["localEnd"] !== "string" ||
    value["localEnd"].length < 1 ||
    value["localEnd"].length > 100
  ) {
    return failure(invalidAppointmentRequest());
  }

  const window = validateUtcTimeWindow({ end: value["endAt"], start: value["startAt"] });
  const future = compareUtcTimestamps(value["startAt"], occurredAt);
  return window.ok && future.ok && future.value > 0
    ? success(
        Object.freeze({
          endAt: value["endAt"],
          localEnd: value["localEnd"],
          localStart: value["localStart"],
          startAt: value["startAt"],
          timeZone: value["timeZone"],
        }),
      )
    : failure(invalidAppointmentRequest());
};

export const createAppointmentRequest = (
  command: CreateAppointmentRequestCommand,
): AppointmentRequestCreationResult => {
  if (
    !isRecord(command) ||
    !hasOnlyKeys(command, [
      "actor",
      "appointmentRequestId",
      "businessPolicy",
      "contact",
      "conversation",
      "initiator",
      "lead",
      "location",
      "occurredAt",
      "organizationId",
      "preferences",
      "service",
      "sourceMessage",
    ]) ||
    !isSchemaValue(ActorRefSchema, command["actor"]) ||
    !isSchemaValue(AppointmentRequestIdSchema, command["appointmentRequestId"]) ||
    !isSchemaValue(OrganizationIdSchema, command["organizationId"]) ||
    !isSchemaValue(UtcTimestampSchema, command["occurredAt"]) ||
    !Array.isArray(command["preferences"])
  ) {
    return transitionFailure(invalidReference());
  }

  const contact = validateContactReference(command["contact"], command["organizationId"]);
  if (!contact.ok) {
    return transitionFailure(contact.error);
  }
  const initiator = validateInitiator(
    command["actor"],
    command["initiator"],
    command["organizationId"],
    contact.value,
  );
  if (!initiator.ok) {
    return transitionFailure(initiator.error);
  }

  const lead = validateSimpleReference(
    command["lead"],
    "leadId",
    (value): value is LeadId => isSchemaValue(LeadIdSchema, value),
    command["organizationId"],
  );
  if (!lead.ok) {
    return transitionFailure(lead.error);
  }
  const conversation = validateSimpleReference(
    command["conversation"],
    "conversationId",
    (value): value is ConversationId => isSchemaValue(ConversationIdSchema, value),
    command["organizationId"],
  );
  if (!conversation.ok) {
    return transitionFailure(conversation.error);
  }
  const sourceMessage = validateSimpleReference(
    command["sourceMessage"],
    "messageId",
    (value): value is MessageId => isSchemaValue(MessageIdSchema, value),
    command["organizationId"],
  );
  if (!sourceMessage.ok) {
    return transitionFailure(sourceMessage.error);
  }
  const businessPolicy = validateSimpleReference(
    command["businessPolicy"],
    "businessPolicyId",
    (value): value is ResourceId => isSchemaValue(ResourceIdSchema, value),
    command["organizationId"],
  );
  if (!businessPolicy.ok) {
    return transitionFailure(businessPolicy.error);
  }

  if (
    !isRecord(command["service"]) ||
    !isSchemaValue(ResourceIdSchema, command["service"]["serviceVersionId"])
  ) {
    return transitionFailure(invalidReference());
  }
  const service = validateScopedReference(
    command["service"],
    "serviceId",
    ["serviceVersionId"],
    (value): value is ServiceId => isSchemaValue(ServiceIdSchema, value),
    command["organizationId"],
  );
  if (!service.ok) {
    return transitionFailure(service.error);
  }

  if (
    !isRecord(command["location"]) ||
    !isSchemaValue(ResourceIdSchema, command["location"]["locationVersionId"])
  ) {
    return transitionFailure(invalidReference());
  }
  const location = validateScopedReference(
    command["location"],
    "locationId",
    ["locationVersionId"],
    (value): value is LocationId => isSchemaValue(LocationIdSchema, value),
    command["organizationId"],
  );
  if (!location.ok) {
    return transitionFailure(location.error);
  }

  const version = initialAggregateVersion();
  const request: AppointmentRequest = {
    appointmentRequestId: command["appointmentRequestId"],
    businessPolicyId: businessPolicy.value,
    cancellation: null,
    confirmationEvidence: null,
    confirmationOffer: null,
    confirmedAt: null,
    contactId: contact.value,
    conversationId: conversation.value,
    createdAt: command["occurredAt"],
    expiration: null,
    leadId: lead.value,
    locationId: location.value,
    locationVersionId: command["location"]["locationVersionId"],
    offer: null,
    organizationId: command["organizationId"],
    preferences: command["preferences"],
    serviceId: service.value,
    serviceVersionId: command["service"]["serviceVersionId"],
    sourceMessageId: sourceMessage.value,
    staffDecision: null,
    status: "requested",
    version,
  };
  const validRequest = validateAppointmentRequest(request);
  if (!validRequest.ok) {
    return transitionFailure(validRequest.error);
  }

  const event = createEventDraft<DomainEventFor<"appointment_request.created">>(
    "appointment_request.created",
    version,
    {
      appointment_status: "requested",
      conversation_id: conversation.value,
      lead_id: lead.value,
      location_id: location.value,
      service_id: service.value,
    },
    EVENT_IDENTITIES["appointment_request.created"],
  );
  const record = createTransitionRecord(
    request,
    command,
    "create_appointment_request",
    null,
    "requested",
    version,
  );

  return transitionSuccess(request, [event], [record]);
};

export const staffAcceptAppointmentRequest = (
  request: AppointmentRequest,
  command: StaffAcceptAppointmentRequestCommand,
): AppointmentRequestCommandResult => {
  if (
    !isRecord(command) ||
    !hasOnlyKeys(command, [
      "actor",
      "expectedVersion",
      "location",
      "occurredAt",
      "offeredSlot",
      "organizationId",
      "staff",
    ])
  ) {
    return transitionFailure(invalidReference());
  }
  if (!isSchemaValue(ActorRefSchema, command["actor"])) {
    return transitionFailure(invalidReference());
  }
  const staff = validateStaffActor(command["actor"], command["staff"], request.organizationId);
  if (!staff.ok) {
    return transitionFailure(staff.error);
  }
  if (
    !isRecord(command["location"]) ||
    !isSchemaValue(ResourceIdSchema, command["location"]["locationVersionId"])
  ) {
    return transitionFailure(invalidReference());
  }
  const location = validateScopedReference(
    command["location"],
    "locationId",
    ["locationVersionId"],
    (value): value is LocationId => isSchemaValue(LocationIdSchema, value),
    request.organizationId,
  );
  if (!location.ok) {
    return transitionFailure(location.error);
  }
  if (
    location.value !== request.locationId ||
    command["location"]["locationVersionId"] !== request.locationVersionId
  ) {
    return transitionFailure(invalidReference());
  }

  const context = beginTransition(
    request,
    command,
    "staff_accept_appointment_request",
    "occurredAt",
    ["requested"],
  );
  if (!context.ok) {
    return transitionFailure(context.error);
  }
  const slot = validateApprovedSlot(command["offeredSlot"], context.value.occurredAt);
  if (!slot.ok) {
    return transitionFailure(slot.error);
  }

  const offerVersion = initialAppointmentOfferVersion();
  const decision: AppointmentStaffDecision = {
    decidedAt: context.value.occurredAt,
    membershipId: staff.value,
    outcome: "accepted",
  };
  const offer: AppointmentOffer = {
    endAt: slot.value.endAt,
    localEnd: slot.value.localEnd,
    localStart: slot.value.localStart,
    locationId: location.value,
    offerVersion,
    startAt: slot.value.startAt,
    timeZone: slot.value.timeZone,
  };
  const event = createEventDraft<DomainEventFor<"appointment_request.staff_accepted">>(
    "appointment_request.staff_accepted",
    context.value.nextVersion,
    {
      appointment_status: "staff_accepted",
      location_id: location.value,
      offer_version: offerVersion,
      scheduled_start_at: slot.value.startAt,
    },
    EVENT_IDENTITIES["appointment_request.staff_accepted"],
  );

  return completeTransition(
    request,
    context.value,
    "staff_accept_appointment_request",
    "staff_accepted",
    event,
    { offer, staffDecision: decision },
    { offerVersion },
  );
};

export const rejectAppointmentRequest = (
  request: AppointmentRequest,
  command: RejectAppointmentRequestCommand,
): AppointmentRequestCommandResult => {
  const reasonCode = validateAppointmentRequestReasonCode(command.reasonCode);
  if (!reasonCode.ok) {
    return transitionFailure(reasonCode.error);
  }
  if (
    !isRecord(command) ||
    !hasOnlyKeys(command, [
      "actor",
      "expectedVersion",
      "occurredAt",
      "organizationId",
      "reasonCode",
      "staff",
    ]) ||
    !isSchemaValue(ActorRefSchema, command["actor"])
  ) {
    return transitionFailure(invalidReference());
  }
  const staff = validateStaffActor(command["actor"], command["staff"], request.organizationId);
  if (!staff.ok) {
    return transitionFailure(staff.error);
  }
  const context = beginTransition(request, command, "reject_appointment_request", "occurredAt", [
    "requested",
  ]);
  if (!context.ok) {
    return transitionFailure(context.error);
  }

  const decision: AppointmentStaffDecision = {
    decidedAt: context.value.occurredAt,
    membershipId: staff.value,
    outcome: "rejected",
    reasonCode: reasonCode.value,
  };
  const event = createEventDraft<DomainEventFor<"appointment_request.rejected">>(
    "appointment_request.rejected",
    context.value.nextVersion,
    { appointment_status: "rejected", reason_code: reasonCode.value },
    EVENT_IDENTITIES["appointment_request.rejected"],
  );

  return completeTransition(
    request,
    context.value,
    "reject_appointment_request",
    "rejected",
    event,
    { staffDecision: decision },
    { reasonCode: reasonCode.value },
  );
};

export const prepareCustomerConfirmation = (
  request: AppointmentRequest,
  command: PrepareCustomerConfirmationCommand,
): AppointmentRequestCommandResult => {
  if (
    !isRecord(command) ||
    !hasOnlyKeys(command, [
      "actor",
      "expectedVersion",
      "expiresAt",
      "issuedAt",
      "offerVersion",
      "organizationId",
    ]) ||
    !isAppointmentOfferVersion(command["offerVersion"]) ||
    !isSchemaValue(UtcTimestampSchema, command["expiresAt"])
  ) {
    return transitionFailure(invalidReference());
  }
  const context = beginTransition(request, command, "prepare_customer_confirmation", "issuedAt", [
    "staff_accepted",
  ]);
  if (!context.ok) {
    return transitionFailure(context.error);
  }
  if (
    context.value.actor.actor_type !== "system" ||
    request.offer === null ||
    command["offerVersion"] !== request.offer.offerVersion
  ) {
    return transitionFailure(invalidReference());
  }
  const interval = validateUtcTimeWindow({ end: command["expiresAt"], start: command["issuedAt"] });
  if (!interval.ok) {
    return transitionFailure(invalidAppointmentRequest());
  }

  const confirmationOffer: AppointmentConfirmationOffer = {
    expiresAt: command["expiresAt"],
    issuedAt: command["issuedAt"],
    offerVersion: command["offerVersion"],
  };
  const event = createEventDraft<
    DomainEventFor<"appointment_request.customer_confirmation_requested">
  >(
    "appointment_request.customer_confirmation_requested",
    context.value.nextVersion,
    {
      appointment_status: "awaiting_customer_confirmation",
      confirmation_expires_at: command["expiresAt"],
      offer_version: command["offerVersion"],
    },
    EVENT_IDENTITIES["appointment_request.customer_confirmation_requested"],
  );

  return completeTransition(
    request,
    context.value,
    "prepare_customer_confirmation",
    "awaiting_customer_confirmation",
    event,
    { confirmationOffer },
    { offerVersion: command["offerVersion"] },
  );
};

const confirmationInvalid = (): ConfirmationEvidenceInvalid => confirmationEvidenceInvalid();

const evidenceScopedId = <Identifier>(
  reference: unknown,
  idMember: string,
  isIdentifier: (value: unknown) => value is Identifier,
  organizationId: OrganizationId,
): Result<Identifier, ConfirmationEvidenceInvalid | TenantScopeViolation> => {
  const result = validateSimpleReference(reference, idMember, isIdentifier, organizationId);
  if (result.ok) {
    return result;
  }
  if (result.error.code === "tenant_scope_violation") {
    return failure(result.error);
  }
  return failure(confirmationInvalid());
};

const validateConfirmationEvidence = (
  request: AppointmentRequest,
  input: unknown,
  actor: ActorRef,
  recordedAt: UtcTimestamp,
): Result<AppointmentConfirmationEvidence, ConfirmationEvidenceInvalid | TenantScopeViolation> => {
  if (
    !isRecord(input) ||
    !isAppointmentOfferVersion(input["offerVersion"]) ||
    !isSchemaValue(UtcTimestampSchema, input["customerActedAt"])
  ) {
    return failure(confirmationInvalid());
  }

  const appointmentRequestId = evidenceScopedId(
    input["appointmentRequest"],
    "appointmentRequestId",
    (value): value is AppointmentRequestId => isSchemaValue(AppointmentRequestIdSchema, value),
    request.organizationId,
  );
  if (!appointmentRequestId.ok) {
    return appointmentRequestId;
  }
  const contactId = evidenceScopedId(
    input["contact"],
    "contactId",
    (value): value is ContactId => isSchemaValue(ContactIdSchema, value),
    request.organizationId,
  );
  if (!contactId.ok) {
    return contactId;
  }
  const evidenceId = evidenceScopedId(
    input["evidence"],
    "evidenceId",
    (value): value is ResourceId => isSchemaValue(ResourceIdSchema, value),
    request.organizationId,
  );
  if (!evidenceId.ok) {
    return evidenceId;
  }

  if (
    appointmentRequestId.value !== request.appointmentRequestId ||
    contactId.value !== request.contactId ||
    request.confirmationOffer === null ||
    input["offerVersion"] !== request.confirmationOffer.offerVersion
  ) {
    return failure(confirmationInvalid());
  }

  const actedWithinOffer = isWithinHalfOpenInterval(
    input["customerActedAt"],
    request.confirmationOffer.issuedAt,
    request.confirmationOffer.expiresAt,
  );
  const actionBeforeRecord = compareUtcTimestamps(input["customerActedAt"], recordedAt);
  if (
    !actedWithinOffer.ok ||
    !actedWithinOffer.value ||
    !actionBeforeRecord.ok ||
    actionBeforeRecord.value > 0
  ) {
    return failure(confirmationInvalid());
  }

  const base = {
    appointmentRequestId: appointmentRequestId.value,
    contactId: contactId.value,
    customerActedAt: input["customerActedAt"],
    evidenceId: evidenceId.value,
    offerVersion: input["offerVersion"],
    organizationId: request.organizationId,
    recordedAt,
  };

  if (input["source"] === "customer_session") {
    if (
      !hasOnlyKeys(input, [
        "appointmentRequest",
        "contact",
        "customerActedAt",
        "evidence",
        "offerVersion",
        "source",
      ]) ||
      actor.actor_type !== "customer" ||
      !identifiersEqual(actor.actor_id, request.contactId)
    ) {
      return failure(confirmationInvalid());
    }
    return success(Object.freeze({ ...base, source: "customer_session" }));
  }

  if (input["source"] === "telegram") {
    if (
      !hasOnlyKeys(input, [
        "appointmentRequest",
        "contact",
        "customerActedAt",
        "evidence",
        "offerVersion",
        "source",
        "sourceMessage",
      ]) ||
      actor.actor_type !== "customer" ||
      !identifiersEqual(actor.actor_id, request.contactId)
    ) {
      return failure(confirmationInvalid());
    }
    const sourceMessageId = evidenceScopedId(
      input["sourceMessage"],
      "messageId",
      (value): value is MessageId => isSchemaValue(MessageIdSchema, value),
      request.organizationId,
    );
    if (!sourceMessageId.ok) {
      return sourceMessageId;
    }
    const evidence: TelegramConfirmationEvidence = {
      ...base,
      source: "telegram",
      sourceMessageId: sourceMessageId.value,
    };
    return success(Object.freeze(evidence));
  }

  if (input["source"] === "staff_attested_external") {
    if (
      !hasOnlyKeys(input, [
        "appointmentRequest",
        "attestationMethod",
        "attestationReasonCode",
        "contact",
        "customerAct",
        "customerActedAt",
        "evidence",
        "offerVersion",
        "protectedEvidence",
        "source",
        "staff",
      ]) ||
      input["customerAct"] !== "explicit_confirmation" ||
      (input["attestationMethod"] !== "phone" && input["attestationMethod"] !== "in_person")
    ) {
      return failure(confirmationInvalid());
    }
    const reasonCode = validateAppointmentRequestReasonCode(input["attestationReasonCode"]);
    if (!reasonCode.ok) {
      return failure(confirmationInvalid());
    }
    const staff = evidenceScopedId(
      input["staff"],
      "membershipId",
      (value): value is MembershipId => isSchemaValue(MembershipIdSchema, value),
      request.organizationId,
    );
    if (!staff.ok) {
      return staff;
    }
    if (actor.actor_type !== "member" || !identifiersEqual(actor.actor_id, staff.value)) {
      return failure(confirmationInvalid());
    }

    let protectedEvidenceId: ResourceId | null = null;
    if (input["protectedEvidence"] !== null) {
      const protectedEvidence = evidenceScopedId(
        input["protectedEvidence"],
        "evidenceId",
        (value): value is ResourceId => isSchemaValue(ResourceIdSchema, value),
        request.organizationId,
      );
      if (!protectedEvidence.ok) {
        return protectedEvidence;
      }
      protectedEvidenceId = protectedEvidence.value;
    }

    const evidence: StaffAttestedExternalConfirmationEvidence = {
      ...base,
      attestationMethod: input["attestationMethod"],
      attestationReasonCode: reasonCode.value,
      customerAct: "explicit_confirmation",
      protectedEvidenceId,
      recordedByMembershipId: staff.value,
      source: "staff_attested_external",
    };
    return success(Object.freeze(evidence));
  }

  return failure(confirmationInvalid());
};

export const confirmAppointmentRequest = (
  request: AppointmentRequest,
  command: ConfirmAppointmentRequestCommand,
): AppointmentRequestCommandResult => {
  if (
    !isRecord(command) ||
    !hasOnlyKeys(command, ["actor", "evidence", "expectedVersion", "now", "organizationId"])
  ) {
    return transitionFailure(confirmationInvalid());
  }
  const context = beginTransition(request, command, "confirm_appointment_request", "now", [
    "awaiting_customer_confirmation",
  ]);
  if (!context.ok) {
    return transitionFailure(context.error);
  }
  if (request.confirmationOffer === null) {
    return transitionFailure(confirmationInvalid());
  }

  const unexpired = requireUnexpired(context.value.occurredAt, request.confirmationOffer.expiresAt);
  if (!unexpired.ok) {
    return transitionFailure(
      unexpired.error.code === "offer_expired" ? unexpired.error : confirmationInvalid(),
    );
  }
  const issuedOrder = compareUtcTimestamps(
    context.value.occurredAt,
    request.confirmationOffer.issuedAt,
  );
  if (!issuedOrder.ok || issuedOrder.value < 0) {
    return transitionFailure(confirmationInvalid());
  }

  const evidence = validateConfirmationEvidence(
    request,
    command["evidence"],
    context.value.actor,
    context.value.occurredAt,
  );
  if (!evidence.ok) {
    return transitionFailure(evidence.error);
  }

  const event = createEventDraft<DomainEventFor<"appointment_request.confirmed">>(
    "appointment_request.confirmed",
    context.value.nextVersion,
    {
      appointment_status: "confirmed",
      confirmation_source: evidence.value.source,
      customer_confirmed_at: evidence.value.customerActedAt,
      offer_version: evidence.value.offerVersion,
    },
    EVENT_IDENTITIES["appointment_request.confirmed"],
  );

  return completeTransition(
    request,
    context.value,
    "confirm_appointment_request",
    "confirmed",
    event,
    { confirmationEvidence: evidence.value, confirmedAt: context.value.occurredAt },
    { offerVersion: evidence.value.offerVersion },
  );
};

export const cancelAppointmentRequest = (
  request: AppointmentRequest,
  command: CancelAppointmentRequestCommand,
): AppointmentRequestCommandResult => {
  const reasonCode = validateAppointmentRequestReasonCode(command.reasonCode);
  if (!reasonCode.ok) {
    return transitionFailure(reasonCode.error);
  }
  if (
    !isRecord(command) ||
    !hasOnlyKeys(command, [
      "actor",
      "expectedVersion",
      "initiator",
      "occurredAt",
      "organizationId",
      "reasonCode",
    ])
  ) {
    return transitionFailure(invalidReference());
  }
  const context = beginTransition(request, command, "cancel_appointment_request", "occurredAt", [
    "requested",
    "staff_accepted",
    "awaiting_customer_confirmation",
    "confirmed",
  ]);
  if (!context.ok) {
    return transitionFailure(context.error);
  }
  const initiator = validateInitiator(
    context.value.actor,
    command["initiator"],
    request.organizationId,
    request.contactId,
  );
  if (!initiator.ok) {
    return transitionFailure(initiator.error);
  }

  const cancellation: AppointmentCancellation = {
    actor: context.value.actor,
    cancelledAt: context.value.occurredAt,
    reasonCode: reasonCode.value,
  };
  const event = createEventDraft<DomainEventFor<"appointment_request.cancelled">>(
    "appointment_request.cancelled",
    context.value.nextVersion,
    {
      appointment_status: "cancelled",
      previous_appointment_status: request.status,
      reason_code: reasonCode.value,
    },
    EVENT_IDENTITIES["appointment_request.cancelled"],
  );

  return completeTransition(
    request,
    context.value,
    "cancel_appointment_request",
    "cancelled",
    event,
    { cancellation },
    { offerVersion: request.offer?.offerVersion ?? null, reasonCode: reasonCode.value },
  );
};

export const expireAppointmentRequest = (
  request: AppointmentRequest,
  command: ExpireAppointmentRequestCommand,
): AppointmentRequestCommandResult => {
  const reasonCode = validateAppointmentRequestReasonCode(command.reasonCode);
  if (!reasonCode.ok) {
    return transitionFailure(reasonCode.error);
  }
  if (
    !isRecord(command) ||
    !hasOnlyKeys(command, ["actor", "expectedVersion", "now", "organizationId", "reasonCode"])
  ) {
    return transitionFailure(invalidReference());
  }
  const context = beginTransition(request, command, "expire_appointment_request", "now", [
    "requested",
    "staff_accepted",
    "awaiting_customer_confirmation",
  ]);
  if (!context.ok) {
    return transitionFailure(context.error);
  }
  if (context.value.actor.actor_type !== "system") {
    return transitionFailure(invalidReference());
  }

  if (
    request.status !== "requested" &&
    request.status !== "staff_accepted" &&
    request.status !== "awaiting_customer_confirmation"
  ) {
    return transitionFailure(invalidStateTransition(request.status, "expire_appointment_request"));
  }

  if (request.status === "awaiting_customer_confirmation") {
    if (request.confirmationOffer === null) {
      return transitionFailure(invalidAppointmentRequest());
    }
    const expiryOrder = compareUtcTimestamps(
      context.value.occurredAt,
      request.confirmationOffer.expiresAt,
    );
    if (!expiryOrder.ok || expiryOrder.value < 0) {
      return transitionFailure(appointmentRequestNotDue());
    }
  }

  const expiration: AppointmentExpiration = {
    expiredAt: context.value.occurredAt,
    reasonCode: reasonCode.value,
  };
  const event = createEventDraft<DomainEventFor<"appointment_request.expired">>(
    "appointment_request.expired",
    context.value.nextVersion,
    {
      appointment_status: "expired",
      previous_appointment_status: request.status,
      reason_code: reasonCode.value,
    },
    EVENT_IDENTITIES["appointment_request.expired"],
  );

  return completeTransition(
    request,
    context.value,
    "expire_appointment_request",
    "expired",
    event,
    { expiration },
    { offerVersion: request.offer?.offerVersion ?? null, reasonCode: reasonCode.value },
  );
};
