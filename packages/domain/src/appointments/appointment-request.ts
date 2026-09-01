import {
  ActorRefSchema,
  AggregateVersionSchema,
  AppointmentRequestIdSchema,
  ContactIdSchema,
  ConversationIdSchema,
  DomainEventPayloadSchemas,
  LeadIdSchema,
  LocationIdSchema,
  MembershipIdSchema,
  MessageIdSchema,
  OrganizationIdSchema,
  ResourceIdSchema,
  ServiceIdSchema,
  UtcTimestampSchema,
  isSchemaValue,
  type ActorRef,
  type AggregateVersion,
  type AppointmentRequestId,
  type ContactId,
  type ConversationId,
  type DomainEventPayloadByName,
  type LeadId,
  type LocationId,
  type MembershipId,
  type MessageId,
  type OrganizationId,
  type ResourceId,
  type ServiceId,
  type UtcTimestamp,
} from "@lead-agent/contracts";

import { invariantViolation, type InvariantViolation } from "../foundation/errors.js";
import { failure, success, type Result } from "../foundation/result.js";
import {
  compareUtcTimestamps,
  isNamedIanaTimeZone,
  isWithinHalfOpenInterval,
  validateUtcTimeWindow,
  type IanaTimeZone,
} from "../values/time.js";

const AppointmentRequestStatusSchema =
  DomainEventPayloadSchemas["appointment_request.cancelled"].properties.previous_appointment_status;
const AppointmentConfirmationSourceSchema =
  DomainEventPayloadSchemas["appointment_request.confirmed"].properties.confirmation_source;
const AppointmentRequestReasonCodeSchema =
  DomainEventPayloadSchemas["appointment_request.cancelled"].properties.reason_code;

const LOCAL_REPRESENTATION_MAX_LENGTH = 100;

declare const appointmentOfferVersionBrand: unique symbol;
declare const appointmentRequestReasonCodeBrand: unique symbol;

export type AppointmentRequestStatus =
  DomainEventPayloadByName["appointment_request.cancelled"]["previous_appointment_status"];
export type AppointmentConfirmationSource =
  DomainEventPayloadByName["appointment_request.confirmed"]["confirmation_source"];
export type AppointmentOfferVersion = AggregateVersion & {
  readonly [appointmentOfferVersionBrand]: "AppointmentOfferVersion";
};
export type AppointmentRequestReasonCode = string & {
  readonly [appointmentRequestReasonCodeBrand]: "AppointmentRequestReasonCode";
};

export type AppointmentPreference = Readonly<{
  endAt: UtcTimestamp;
  localEnd: string;
  localStart: string;
  precision: "exact";
  preferenceId: ResourceId;
  preferenceOrder: number;
  startAt: UtcTimestamp;
  timeZone: IanaTimeZone;
}>;

export type AppointmentOffer = Readonly<{
  endAt: UtcTimestamp;
  localEnd: string;
  localStart: string;
  locationId: LocationId;
  offerVersion: AppointmentOfferVersion;
  startAt: UtcTimestamp;
  timeZone: IanaTimeZone;
}>;

export type AppointmentConfirmationOffer = Readonly<{
  expiresAt: UtcTimestamp;
  issuedAt: UtcTimestamp;
  offerVersion: AppointmentOfferVersion;
}>;

type AppointmentConfirmationEvidenceBase = Readonly<{
  appointmentRequestId: AppointmentRequestId;
  contactId: ContactId;
  customerActedAt: UtcTimestamp;
  evidenceId: ResourceId;
  offerVersion: AppointmentOfferVersion;
  organizationId: OrganizationId;
  recordedAt: UtcTimestamp;
}>;

export type CustomerSessionConfirmationEvidence = AppointmentConfirmationEvidenceBase &
  Readonly<{
    source: "customer_session";
  }>;

export type TelegramConfirmationEvidence = AppointmentConfirmationEvidenceBase &
  Readonly<{
    source: "telegram";
    sourceMessageId: MessageId;
  }>;

export type StaffAttestedExternalConfirmationEvidence = AppointmentConfirmationEvidenceBase &
  Readonly<{
    attestationMethod: "in_person" | "phone";
    attestationReasonCode: AppointmentRequestReasonCode;
    customerAct: "explicit_confirmation";
    protectedEvidenceId: ResourceId | null;
    recordedByMembershipId: MembershipId;
    source: "staff_attested_external";
  }>;

export type AppointmentConfirmationEvidence =
  | CustomerSessionConfirmationEvidence
  | TelegramConfirmationEvidence
  | StaffAttestedExternalConfirmationEvidence;

export type AppointmentStaffDecision =
  | Readonly<{
      decidedAt: UtcTimestamp;
      membershipId: MembershipId;
      outcome: "accepted";
    }>
  | Readonly<{
      decidedAt: UtcTimestamp;
      membershipId: MembershipId;
      outcome: "rejected";
      reasonCode: AppointmentRequestReasonCode;
    }>;

export type AppointmentCancellation = Readonly<{
  actor: ActorRef;
  cancelledAt: UtcTimestamp;
  reasonCode: AppointmentRequestReasonCode;
}>;

export type AppointmentExpiration = Readonly<{
  expiredAt: UtcTimestamp;
  reasonCode: AppointmentRequestReasonCode;
}>;

export type AppointmentRequest = Readonly<{
  appointmentRequestId: AppointmentRequestId;
  businessPolicyId: ResourceId;
  cancellation: AppointmentCancellation | null;
  confirmationEvidence: AppointmentConfirmationEvidence | null;
  confirmationOffer: AppointmentConfirmationOffer | null;
  confirmedAt: UtcTimestamp | null;
  contactId: ContactId;
  conversationId: ConversationId;
  createdAt: UtcTimestamp;
  expiration: AppointmentExpiration | null;
  leadId: LeadId;
  locationId: LocationId;
  locationVersionId: ResourceId;
  offer: AppointmentOffer | null;
  organizationId: OrganizationId;
  preferences: readonly AppointmentPreference[];
  serviceId: ServiceId;
  serviceVersionId: ResourceId;
  sourceMessageId: MessageId;
  staffDecision: AppointmentStaffDecision | null;
  status: AppointmentRequestStatus;
  version: AggregateVersion;
}>;

export type InvalidAppointmentRequest = InvariantViolation<"invalid_appointment_request">;
export type InvalidAppointmentRequestReasonCode = InvariantViolation<"invalid_reason_code">;

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isLocalRepresentation = (value: unknown): value is string =>
  typeof value === "string" && value.length >= 1 && value.length <= LOCAL_REPRESENTATION_MAX_LENGTH;

const isSameOrAfter = (value: UtcTimestamp, boundary: UtcTimestamp): boolean => {
  const comparison = compareUtcTimestamps(value, boundary);
  return comparison.ok && comparison.value >= 0;
};

const isAfter = (value: UtcTimestamp, boundary: UtcTimestamp): boolean => {
  const comparison = compareUtcTimestamps(value, boundary);
  return comparison.ok && comparison.value > 0;
};

const identifiersEqual = (left: string, right: string): boolean => left === right;

export const isAppointmentRequestStatus = (value: unknown): value is AppointmentRequestStatus =>
  isSchemaValue(AppointmentRequestStatusSchema, value);

export const isAppointmentConfirmationSource = (
  value: unknown,
): value is AppointmentConfirmationSource =>
  isSchemaValue(AppointmentConfirmationSourceSchema, value);

export const isAppointmentOfferVersion = (value: unknown): value is AppointmentOfferVersion =>
  isSchemaValue(AggregateVersionSchema, value);

export const validateAppointmentOfferVersion = (
  value: unknown,
): Result<AppointmentOfferVersion, InvariantViolation<"invalid_version">> =>
  isAppointmentOfferVersion(value)
    ? success(value)
    : failure(invariantViolation("invalid_version"));

export const isAppointmentRequestReasonCode = (
  value: unknown,
): value is AppointmentRequestReasonCode =>
  isSchemaValue(AppointmentRequestReasonCodeSchema, value);

export const validateAppointmentRequestReasonCode = (
  value: unknown,
): Result<AppointmentRequestReasonCode, InvalidAppointmentRequestReasonCode> =>
  isAppointmentRequestReasonCode(value)
    ? success(value)
    : failure(invariantViolation("invalid_reason_code"));

const isAppointmentPreference = (
  value: unknown,
  createdAt: UtcTimestamp,
): value is AppointmentPreference => {
  if (
    !isRecord(value) ||
    !isSchemaValue(ResourceIdSchema, value["preferenceId"]) ||
    typeof value["preferenceOrder"] !== "number" ||
    !Number.isSafeInteger(value["preferenceOrder"]) ||
    value["preferenceOrder"] < 1 ||
    value["precision"] !== "exact" ||
    !isSchemaValue(UtcTimestampSchema, value["startAt"]) ||
    !isSchemaValue(UtcTimestampSchema, value["endAt"]) ||
    !isNamedIanaTimeZone(value["timeZone"]) ||
    !isLocalRepresentation(value["localStart"]) ||
    !isLocalRepresentation(value["localEnd"])
  ) {
    return false;
  }

  const validWindow = validateUtcTimeWindow({ end: value["endAt"], start: value["startAt"] });
  return validWindow.ok && isSameOrAfter(value["startAt"], createdAt);
};

const areAppointmentPreferencesValid = (preferences: unknown, createdAt: UtcTimestamp): boolean => {
  if (!Array.isArray(preferences) || preferences.length === 0) {
    return false;
  }

  const ids = new Set<ResourceId>();
  return preferences.every((candidate: unknown, index) => {
    if (
      !isAppointmentPreference(candidate, createdAt) ||
      candidate.preferenceOrder !== index + 1 ||
      ids.has(candidate.preferenceId)
    ) {
      return false;
    }
    ids.add(candidate.preferenceId);
    return true;
  });
};

const isAppointmentOffer = (
  value: unknown,
  locationId: LocationId,
  decidedAt: UtcTimestamp,
): value is AppointmentOffer => {
  if (
    !isRecord(value) ||
    !isSchemaValue(LocationIdSchema, value["locationId"]) ||
    value["locationId"] !== locationId ||
    !isAppointmentOfferVersion(value["offerVersion"]) ||
    !isSchemaValue(UtcTimestampSchema, value["startAt"]) ||
    !isSchemaValue(UtcTimestampSchema, value["endAt"]) ||
    !isNamedIanaTimeZone(value["timeZone"]) ||
    !isLocalRepresentation(value["localStart"]) ||
    !isLocalRepresentation(value["localEnd"])
  ) {
    return false;
  }

  const validWindow = validateUtcTimeWindow({ end: value["endAt"], start: value["startAt"] });
  return validWindow.ok && isAfter(value["startAt"], decidedAt);
};

const isStaffDecision = (value: unknown): value is AppointmentStaffDecision => {
  if (
    !isRecord(value) ||
    !isSchemaValue(MembershipIdSchema, value["membershipId"]) ||
    !isSchemaValue(UtcTimestampSchema, value["decidedAt"])
  ) {
    return false;
  }

  return (
    value["outcome"] === "accepted" ||
    (value["outcome"] === "rejected" && isAppointmentRequestReasonCode(value["reasonCode"]))
  );
};

const isConfirmationOffer = (
  value: unknown,
  offer: AppointmentOffer,
  decidedAt: UtcTimestamp,
): value is AppointmentConfirmationOffer => {
  if (
    !isRecord(value) ||
    value["offerVersion"] !== offer.offerVersion ||
    !isSchemaValue(UtcTimestampSchema, value["issuedAt"]) ||
    !isSchemaValue(UtcTimestampSchema, value["expiresAt"])
  ) {
    return false;
  }

  const validInterval = validateUtcTimeWindow({
    end: value["expiresAt"],
    start: value["issuedAt"],
  });
  return validInterval.ok && isSameOrAfter(value["issuedAt"], decidedAt);
};

const hasValidEvidenceBase = (
  value: Readonly<Record<string, unknown>>,
  appointmentRequest: AppointmentRequest,
  confirmationOffer: AppointmentConfirmationOffer,
): boolean => {
  if (
    !isSchemaValue(ResourceIdSchema, value["evidenceId"]) ||
    !isSchemaValue(OrganizationIdSchema, value["organizationId"]) ||
    value["organizationId"] !== appointmentRequest.organizationId ||
    !isSchemaValue(AppointmentRequestIdSchema, value["appointmentRequestId"]) ||
    value["appointmentRequestId"] !== appointmentRequest.appointmentRequestId ||
    !isSchemaValue(ContactIdSchema, value["contactId"]) ||
    value["contactId"] !== appointmentRequest.contactId ||
    value["offerVersion"] !== confirmationOffer.offerVersion ||
    !isSchemaValue(UtcTimestampSchema, value["customerActedAt"]) ||
    !isSchemaValue(UtcTimestampSchema, value["recordedAt"])
  ) {
    return false;
  }

  const customerActIsValid = isWithinHalfOpenInterval(
    value["customerActedAt"],
    confirmationOffer.issuedAt,
    confirmationOffer.expiresAt,
  );
  const recordedAtIsValid = isWithinHalfOpenInterval(
    value["recordedAt"],
    confirmationOffer.issuedAt,
    confirmationOffer.expiresAt,
  );

  return (
    customerActIsValid.ok &&
    customerActIsValid.value &&
    recordedAtIsValid.ok &&
    recordedAtIsValid.value &&
    isSameOrAfter(value["recordedAt"], value["customerActedAt"])
  );
};

const isConfirmationEvidence = (
  value: unknown,
  appointmentRequest: AppointmentRequest,
  confirmationOffer: AppointmentConfirmationOffer,
): value is AppointmentConfirmationEvidence => {
  if (!isRecord(value) || !hasValidEvidenceBase(value, appointmentRequest, confirmationOffer)) {
    return false;
  }

  switch (value["source"]) {
    case "customer_session":
      return true;
    case "telegram":
      return isSchemaValue(MessageIdSchema, value["sourceMessageId"]);
    case "staff_attested_external":
      return (
        value["customerAct"] === "explicit_confirmation" &&
        (value["attestationMethod"] === "phone" || value["attestationMethod"] === "in_person") &&
        isAppointmentRequestReasonCode(value["attestationReasonCode"]) &&
        isSchemaValue(MembershipIdSchema, value["recordedByMembershipId"]) &&
        (value["protectedEvidenceId"] === null ||
          isSchemaValue(ResourceIdSchema, value["protectedEvidenceId"]))
      );
    default:
      return false;
  }
};

const isCancellation = (value: unknown, contactId: ContactId): value is AppointmentCancellation => {
  if (!isRecord(value) || !isSchemaValue(ActorRefSchema, value["actor"])) {
    return false;
  }

  const actor = value["actor"];
  return (
    actor.actor_type !== "system" &&
    (actor.actor_type !== "customer" || identifiersEqual(actor.actor_id, contactId)) &&
    isSchemaValue(UtcTimestampSchema, value["cancelledAt"]) &&
    isAppointmentRequestReasonCode(value["reasonCode"])
  );
};

const isExpiration = (value: unknown): value is AppointmentExpiration =>
  isRecord(value) &&
  isSchemaValue(UtcTimestampSchema, value["expiredAt"]) &&
  isAppointmentRequestReasonCode(value["reasonCode"]);

const hasAcceptedPath = (request: AppointmentRequest): boolean => {
  if (request.staffDecision?.outcome !== "accepted" || request.offer === null) {
    return false;
  }
  if (!isAppointmentOffer(request.offer, request.locationId, request.staffDecision.decidedAt)) {
    return false;
  }
  if (request.confirmationOffer === null) {
    return request.confirmationEvidence === null && request.confirmedAt === null;
  }
  if (
    !isConfirmationOffer(request.confirmationOffer, request.offer, request.staffDecision.decidedAt)
  ) {
    return false;
  }
  if (request.confirmationEvidence === null) {
    return request.confirmedAt === null;
  }
  return (
    isConfirmationEvidence(request.confirmationEvidence, request, request.confirmationOffer) &&
    request.confirmedAt === request.confirmationEvidence.recordedAt
  );
};

const hasConsistentLifecycleShape = (request: AppointmentRequest): boolean => {
  switch (request.status) {
    case "requested":
      return (
        request.staffDecision === null &&
        request.offer === null &&
        request.confirmationOffer === null &&
        request.confirmationEvidence === null &&
        request.confirmedAt === null &&
        request.cancellation === null &&
        request.expiration === null
      );
    case "staff_accepted":
      return (
        hasAcceptedPath(request) &&
        request.confirmationOffer === null &&
        request.cancellation === null &&
        request.expiration === null
      );
    case "awaiting_customer_confirmation":
      return (
        hasAcceptedPath(request) &&
        request.confirmationOffer !== null &&
        request.confirmationEvidence === null &&
        request.cancellation === null &&
        request.expiration === null
      );
    case "confirmed":
      return (
        hasAcceptedPath(request) &&
        request.confirmationEvidence !== null &&
        request.confirmedAt !== null &&
        request.cancellation === null &&
        request.expiration === null
      );
    case "rejected":
      return (
        request.staffDecision?.outcome === "rejected" &&
        request.offer === null &&
        request.confirmationOffer === null &&
        request.confirmationEvidence === null &&
        request.confirmedAt === null &&
        request.cancellation === null &&
        request.expiration === null
      );
    case "cancelled":
      return (
        request.staffDecision?.outcome !== "rejected" &&
        (request.staffDecision === null || hasAcceptedPath(request)) &&
        request.cancellation !== null &&
        request.expiration === null
      );
    case "expired":
      return (
        request.staffDecision?.outcome !== "rejected" &&
        (request.staffDecision === null || hasAcceptedPath(request)) &&
        request.confirmationEvidence === null &&
        request.confirmedAt === null &&
        request.cancellation === null &&
        request.expiration !== null
      );
  }
};

const hasConsistentChronology = (request: AppointmentRequest): boolean => {
  if (
    request.staffDecision !== null &&
    !isSameOrAfter(request.staffDecision.decidedAt, request.createdAt)
  ) {
    return false;
  }

  const latestCommittedAt =
    request.confirmedAt ??
    request.confirmationOffer?.issuedAt ??
    request.staffDecision?.decidedAt ??
    request.createdAt;

  if (
    request.cancellation !== null &&
    !isSameOrAfter(request.cancellation.cancelledAt, latestCommittedAt)
  ) {
    return false;
  }

  if (request.expiration !== null) {
    const expiryBoundary = request.confirmationOffer?.expiresAt ?? latestCommittedAt;
    if (!isSameOrAfter(request.expiration.expiredAt, expiryBoundary)) {
      return false;
    }
  }

  return true;
};

export const validateAppointmentRequest = (
  request: AppointmentRequest,
): Result<AppointmentRequest, InvalidAppointmentRequest> => {
  if (
    !isRecord(request) ||
    !isSchemaValue(AppointmentRequestIdSchema, request["appointmentRequestId"]) ||
    !isSchemaValue(OrganizationIdSchema, request["organizationId"]) ||
    !isSchemaValue(LeadIdSchema, request["leadId"]) ||
    !isSchemaValue(ContactIdSchema, request["contactId"]) ||
    !isSchemaValue(ConversationIdSchema, request["conversationId"])
  ) {
    return failure(invariantViolation("invalid_appointment_request"));
  }

  if (
    !isSchemaValue(MessageIdSchema, request["sourceMessageId"]) ||
    !isSchemaValue(ServiceIdSchema, request["serviceId"]) ||
    !isSchemaValue(ResourceIdSchema, request["serviceVersionId"]) ||
    !isSchemaValue(LocationIdSchema, request["locationId"]) ||
    !isSchemaValue(ResourceIdSchema, request["locationVersionId"]) ||
    !isSchemaValue(ResourceIdSchema, request["businessPolicyId"]) ||
    !isSchemaValue(UtcTimestampSchema, request["createdAt"]) ||
    !isAppointmentRequestStatus(request["status"]) ||
    !isSchemaValue(AggregateVersionSchema, request["version"]) ||
    !areAppointmentPreferencesValid(request.preferences, request.createdAt) ||
    (request.staffDecision !== null && !isStaffDecision(request.staffDecision)) ||
    (request.cancellation !== null && !isCancellation(request.cancellation, request.contactId)) ||
    (request.expiration !== null && !isExpiration(request.expiration)) ||
    !hasConsistentChronology(request) ||
    !hasConsistentLifecycleShape(request)
  ) {
    return failure(invariantViolation("invalid_appointment_request"));
  }

  return success(request);
};
