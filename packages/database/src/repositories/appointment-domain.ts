import { IanaTimeZoneSchema, isSchemaValue } from "@lead-agent/contracts";
import {
  validateAppointmentOfferVersion,
  validateAppointmentRequestReasonCode,
  type AppointmentConfirmationEvidence,
  type AppointmentOfferVersion,
  type AppointmentPreference,
  type AppointmentRequest,
} from "@lead-agent/domain";
import type { TenantDbSession } from "../runtime/tenant.js";
import { createAppointmentRepository, type AppointmentRequestRecord } from "./appointments.js";
import { mapAggregateVersion, RepositoryDataIntegrityError } from "./shared.js";

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

export const readExactAppointmentPreferences = async (
  session: TenantDbSession,
  id: AppointmentRequestRecord["appointmentRequestId"],
): Promise<readonly AppointmentPreference[] | null> => {
  const page = await createAppointmentRepository(session).listPreferences(id, { limit: 20 });
  if (page.next !== null) return null;
  const preferences: AppointmentPreference[] = [];
  for (const item of page.items) {
    if (
      item.precision !== "exact" ||
      item.startAt === null ||
      item.endAt === null ||
      item.localStart === null ||
      item.localEnd === null ||
      !isSchemaValue(IanaTimeZoneSchema, item.timeZone)
    )
      return null;
    preferences.push({
      preferenceId: item.preferenceId,
      preferenceOrder: item.preferenceOrder,
      precision: "exact",
      startAt: item.startAt,
      endAt: item.endAt,
      localStart: item.localStart,
      localEnd: item.localEnd,
      timeZone: item.timeZone,
    });
  }
  return preferences;
};

const readConfirmedEvidence = async (
  session: TenantDbSession,
  row: AppointmentRequestRecord,
  offerVersion: AppointmentOfferVersion,
): Promise<AppointmentConfirmationEvidence> => {
  const evidence = (
    await createAppointmentRepository(session).listConfirmationEvidence(row.appointmentRequestId, {
      limit: 1,
    })
  ).items[0];
  if (
    evidence === undefined ||
    evidence.outcome !== "confirmed" ||
    evidence.offerVersion !== offerVersion ||
    evidence.source !== row.confirmationSource ||
    evidence.recordedAt !== row.confirmedAt ||
    evidence.customerContactId !== row.contactId
  )
    throw new RepositoryDataIntegrityError();
  const base = {
    evidenceId: evidence.evidenceId,
    appointmentRequestId: row.appointmentRequestId,
    organizationId: session.organizationId,
    contactId: evidence.customerContactId,
    customerActedAt: evidence.customerActedAt,
    recordedAt: evidence.recordedAt,
    offerVersion,
  };
  if (evidence.source === "customer_session") return { ...base, source: evidence.source };
  if (evidence.source === "telegram" || evidence.source === "instagram") {
    if (evidence.sourceMessageId === null) throw new RepositoryDataIntegrityError();
    return { ...base, source: evidence.source, sourceMessageId: evidence.sourceMessageId };
  }
  const reason = validateAppointmentRequestReasonCode(evidence.attestationReasonCode);
  if (
    evidence.recordedByMembershipId === null ||
    !reason.ok ||
    (evidence.attestationMethod !== "phone" && evidence.attestationMethod !== "in_person")
  )
    throw new RepositoryDataIntegrityError();
  return {
    ...base,
    source: "staff_attested_external",
    attestationMethod: evidence.attestationMethod,
    attestationReasonCode: reason.value,
    customerAct: "explicit_confirmation",
    recordedByMembershipId: evidence.recordedByMembershipId,
    protectedEvidenceId: null,
  };
};

export const loadAppointmentForDecision = async (
  session: TenantDbSession,
  row: AppointmentRequestRecord,
  preferences: readonly AppointmentPreference[],
): Promise<AppointmentRequest> => {
  const base: AppointmentRequest = {
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
    status: row.status,
    version: mapAggregateVersion(row.version),
    createdAt: row.createdAt,
    preferences,
    staffDecision: null,
    offer: null,
    confirmationOffer: null,
    confirmationEvidence: null,
    confirmedAt: null,
    cancellation: null,
    expiration: null,
  };
  if (row.status === "requested") return base;
  const version = validateAppointmentOfferVersion(row.offerVersion);
  if (
    !version.ok ||
    row.staffDecidedAt === null ||
    row.staffDecidedByMembershipId === null ||
    row.startAt === null ||
    row.endAt === null ||
    !isSchemaValue(IanaTimeZoneSchema, row.offeredTimeZone)
  )
    throw new RepositoryDataIntegrityError();
  return {
    ...base,
    staffDecision: {
      outcome: "accepted",
      decidedAt: row.staffDecidedAt,
      membershipId: row.staffDecidedByMembershipId,
    },
    offer: {
      startAt: row.startAt,
      endAt: row.endAt,
      localStart: localSlotText(row.startAt, row.offeredTimeZone),
      localEnd: localSlotText(row.endAt, row.offeredTimeZone),
      timeZone: row.offeredTimeZone,
      locationId: row.locationId,
      offerVersion: version.value,
    },
    confirmationOffer:
      row.confirmationIssuedAt === null || row.offerExpiresAt === null
        ? null
        : {
            issuedAt: row.confirmationIssuedAt,
            expiresAt: row.offerExpiresAt,
            offerVersion: version.value,
          },
    confirmationEvidence:
      row.status === "confirmed" ? await readConfirmedEvidence(session, row, version.value) : null,
    confirmedAt: row.confirmedAt,
  };
};
