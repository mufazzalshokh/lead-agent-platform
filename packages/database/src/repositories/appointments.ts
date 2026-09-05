import type {
  AppointmentRequestId,
  ContactId,
  ConversationId,
  CurrencyCode,
  LeadId,
  LocationId,
  MembershipId,
  MessageId,
  ResourceId,
  ResourceVersion,
  ServiceId,
  UtcTimestamp,
} from "@lead-agent/contracts";
import type { QueryResultRow } from "pg";

import type { TenantDbSession } from "../runtime/tenant.js";
import {
  createRepositoryPage,
  executeTenantRead,
  mapAggregateVersion,
  mapAppointmentRequestId,
  mapBoolean,
  mapContactId,
  mapConversationId,
  mapCurrencyCode,
  mapEnum,
  mapJsonObject,
  mapLeadId,
  mapLocationId,
  mapMembershipId,
  mapMessageId,
  mapNullableBytes,
  mapNullableIdentifier,
  mapNullableString,
  mapNullableUtcTimestamp,
  mapNonNegativeInteger,
  mapPositiveInteger,
  mapResourceId,
  mapSafeBigInt,
  mapServiceId,
  mapString,
  mapUtcTimestamp,
  requireFound,
  resolvePageLimit,
  type RepositoryPage,
  type RepositoryPageRequest,
} from "./shared.js";

export const APPOINTMENT_REQUEST_STATUSES = [
  "requested",
  "staff_accepted",
  "awaiting_customer_confirmation",
  "confirmed",
  "rejected",
  "cancelled",
  "expired",
] as const;
export type PersistedAppointmentRequestStatus = (typeof APPOINTMENT_REQUEST_STATUSES)[number];
const PREFERENCE_PRECISIONS = ["exact", "part_of_day", "date_only", "free_text"] as const;
const TRANSITION_ACTOR_TYPES = ["customer", "member", "system"] as const;
const CONFIRMATION_OUTCOMES = ["confirmed", "declined"] as const;
const CONFIRMATION_SOURCES = ["customer_session", "telegram", "staff_attested_external"] as const;
const ATTENDANCE_OUTCOMES = ["attended", "did_not_attend", "unknown"] as const;
const BUSINESS_RECORD_SOURCES = ["staff_manual", "approved_import"] as const;
const REVENUE_ENTRY_TYPES = ["charge", "adjustment", "reversal"] as const;

export type AppointmentRequestRecord = Readonly<{
  appointmentRequestId: AppointmentRequestId;
  leadId: LeadId;
  contactId: ContactId;
  conversationId: ConversationId;
  sourceMessageId: MessageId;
  serviceId: ServiceId;
  serviceVersionId: ResourceId;
  locationId: LocationId;
  locationVersionId: ResourceId;
  businessPolicyId: ResourceId;
  status: PersistedAppointmentRequestStatus;
  requestDedupeKey: string;
  customerNotesCiphertext: Uint8Array | null;
  staffDecidedByMembershipId: MembershipId | null;
  staffDecidedAt: UtcTimestamp | null;
  staffDecisionReasonCode: string | null;
  startAt: UtcTimestamp | null;
  endAt: UtcTimestamp | null;
  offeredTimeZone: string | null;
  offeredLocalStart: string | null;
  offerVersion: number;
  confirmationIssuedAt: UtcTimestamp | null;
  offerExpiresAt: UtcTimestamp | null;
  confirmationTokenConsumedAt: UtcTimestamp | null;
  confirmedAt: UtcTimestamp | null;
  confirmationSource: string | null;
  rejectionReasonCode: string | null;
  cancellationReasonCode: string | null;
  cancelledByType: string | null;
  expiredAt: UtcTimestamp | null;
  version: ResourceVersion;
  createdAt: UtcTimestamp;
  updatedAt: UtcTimestamp;
}>;

export type AppointmentRequestKeyset = Readonly<{
  createdAt: UtcTimestamp;
  appointmentRequestId: AppointmentRequestId;
}>;

export type AppointmentPreference = Readonly<{
  preferenceId: ResourceId;
  appointmentRequestId: AppointmentRequestId;
  preferenceOrder: number;
  startAt: UtcTimestamp | null;
  endAt: UtcTimestamp | null;
  timeZone: string;
  originalLocalTextCiphertext: Uint8Array | null;
  localStart: string | null;
  localEnd: string | null;
  precision: (typeof PREFERENCE_PRECISIONS)[number];
  createdAt: UtcTimestamp;
}>;

export type AppointmentTransition = Readonly<{
  transitionId: ResourceId;
  appointmentRequestId: AppointmentRequestId;
  fromStatus: PersistedAppointmentRequestStatus | null;
  toStatus: PersistedAppointmentRequestStatus;
  aggregateVersion: number;
  command: string;
  offerVersion: number | null;
  actorType: (typeof TRANSITION_ACTOR_TYPES)[number];
  actorContactId: ContactId | null;
  actorMembershipId: MembershipId | null;
  reasonCode: string | null;
  sourceMessageId: MessageId | null;
  correlationId: ResourceId;
  occurredAt: UtcTimestamp;
  metadata: Readonly<Record<string, unknown>>;
}>;

export type AppointmentConfirmationEvidence = Readonly<{
  evidenceId: ResourceId;
  appointmentRequestId: AppointmentRequestId;
  offerVersion: number;
  outcome: (typeof CONFIRMATION_OUTCOMES)[number];
  source: (typeof CONFIRMATION_SOURCES)[number];
  customerContactId: ContactId;
  recordedByMembershipId: MembershipId | null;
  sourceMessageId: MessageId | null;
  externalReferenceHash: Uint8Array | null;
  customerActedAt: UtcTimestamp;
  recordedAt: UtcTimestamp;
  attestationMethod: string | null;
  attestationReasonCode: string | null;
  evidenceCiphertext: Uint8Array | null;
  correlationId: ResourceId;
}>;

export type AppointmentAttendance = Readonly<{
  attendanceId: ResourceId;
  appointmentRequestId: AppointmentRequestId;
  outcome: (typeof ATTENDANCE_OUTCOMES)[number];
  occurredAt: UtcTimestamp | null;
  recordedByMembershipId: MembershipId;
  recordedAt: UtcTimestamp;
  source: (typeof BUSINESS_RECORD_SOURCES)[number];
  isCurrent: boolean;
  supersedesId: ResourceId | null;
  reasonCode: string | null;
}>;

export type AppointmentRevenueAttribution = Readonly<{
  attributionId: ResourceId;
  appointmentRequestId: AppointmentRequestId;
  amountMinor: number;
  currency: CurrencyCode;
  entryType: (typeof REVENUE_ENTRY_TYPES)[number];
  categoryCode: string;
  recognizedAt: UtcTimestamp;
  recordedByMembershipId: MembershipId;
  recordedAt: UtcTimestamp;
  source: (typeof BUSINESS_RECORD_SOURCES)[number];
  reversesAttributionId: ResourceId | null;
  externalReferenceHash: Uint8Array | null;
  reasonCode: string | null;
}>;

export type OrderedIdKeyset = Readonly<{ order: number; id: ResourceId }>;
export type VersionedHistoryKeyset = Readonly<{ version: number; id: ResourceId }>;
export type RecordedHistoryKeyset = Readonly<{ recordedAt: UtcTimestamp; id: ResourceId }>;

type AppointmentRow = QueryResultRow & {
  id: unknown;
  lead_id: unknown;
  contact_id: unknown;
  conversation_id: unknown;
  source_message_id: unknown;
  service_id: unknown;
  service_version_id: unknown;
  location_id: unknown;
  location_version_id: unknown;
  business_policy_id: unknown;
  status: unknown;
  request_dedupe_key: unknown;
  customer_notes_ciphertext: unknown;
  staff_decided_by_membership_id: unknown;
  staff_decided_at: unknown;
  staff_decision_reason_code: unknown;
  start_at: unknown;
  end_at: unknown;
  offered_time_zone: unknown;
  offered_local_start: unknown;
  offer_version: unknown;
  confirmation_issued_at: unknown;
  offer_expires_at: unknown;
  confirmation_token_consumed_at: unknown;
  confirmed_at: unknown;
  confirmation_source: unknown;
  rejection_reason_code: unknown;
  cancellation_reason_code: unknown;
  cancelled_by_type: unknown;
  expired_at: unknown;
  version: unknown;
  created_at: unknown;
  updated_at: unknown;
};

const mapAppointment = (row: AppointmentRow): AppointmentRequestRecord =>
  Object.freeze({
    appointmentRequestId: mapAppointmentRequestId(row.id),
    leadId: mapLeadId(row.lead_id),
    contactId: mapContactId(row.contact_id),
    conversationId: mapConversationId(row.conversation_id),
    sourceMessageId: mapMessageId(row.source_message_id),
    serviceId: mapServiceId(row.service_id),
    serviceVersionId: mapResourceId(row.service_version_id),
    locationId: mapLocationId(row.location_id),
    locationVersionId: mapResourceId(row.location_version_id),
    businessPolicyId: mapResourceId(row.business_policy_id),
    status: mapEnum(row.status, APPOINTMENT_REQUEST_STATUSES),
    requestDedupeKey: mapString(row.request_dedupe_key),
    customerNotesCiphertext: mapNullableBytes(row.customer_notes_ciphertext),
    staffDecidedByMembershipId:
      row.staff_decided_by_membership_id === null
        ? null
        : mapMembershipId(row.staff_decided_by_membership_id),
    staffDecidedAt: mapNullableUtcTimestamp(row.staff_decided_at),
    staffDecisionReasonCode: mapNullableString(row.staff_decision_reason_code),
    startAt: mapNullableUtcTimestamp(row.start_at),
    endAt: mapNullableUtcTimestamp(row.end_at),
    offeredTimeZone: mapNullableString(row.offered_time_zone),
    offeredLocalStart: mapNullableString(row.offered_local_start),
    offerVersion: mapNonNegativeInteger(row.offer_version),
    confirmationIssuedAt: mapNullableUtcTimestamp(row.confirmation_issued_at),
    offerExpiresAt: mapNullableUtcTimestamp(row.offer_expires_at),
    confirmationTokenConsumedAt: mapNullableUtcTimestamp(row.confirmation_token_consumed_at),
    confirmedAt: mapNullableUtcTimestamp(row.confirmed_at),
    confirmationSource: mapNullableString(row.confirmation_source),
    rejectionReasonCode: mapNullableString(row.rejection_reason_code),
    cancellationReasonCode: mapNullableString(row.cancellation_reason_code),
    cancelledByType: mapNullableString(row.cancelled_by_type),
    expiredAt: mapNullableUtcTimestamp(row.expired_at),
    version: mapAggregateVersion(row.version),
    createdAt: mapUtcTimestamp(row.created_at),
    updatedAt: mapUtcTimestamp(row.updated_at),
  });

const APPOINTMENT_COLUMNS = `id, lead_id, contact_id, conversation_id,
  source_message_id, service_id, service_version_id, location_id,
  location_version_id, business_policy_id, status, request_dedupe_key,
  customer_notes_ciphertext, staff_decided_by_membership_id, staff_decided_at,
  staff_decision_reason_code, start_at, end_at, offered_time_zone,
  offered_local_start::text as offered_local_start, offer_version,
  confirmation_issued_at, offer_expires_at, confirmation_token_consumed_at,
  confirmed_at, confirmation_source, rejection_reason_code,
  cancellation_reason_code, cancelled_by_type, expired_at, version,
  created_at, updated_at`;

export type AppointmentRepository = Readonly<{
  getAppointmentRequest: (id: AppointmentRequestId) => Promise<AppointmentRequestRecord>;
  listReviewQueue: (
    request?: RepositoryPageRequest<AppointmentRequestKeyset> &
      Readonly<{ status?: PersistedAppointmentRequestStatus; locationId?: LocationId }>,
  ) => Promise<RepositoryPage<AppointmentRequestRecord, AppointmentRequestKeyset>>;
  listPreferences: (
    id: AppointmentRequestId,
    request?: RepositoryPageRequest<OrderedIdKeyset>,
  ) => Promise<RepositoryPage<AppointmentPreference, OrderedIdKeyset>>;
  listTransitions: (
    id: AppointmentRequestId,
    request?: RepositoryPageRequest<VersionedHistoryKeyset>,
  ) => Promise<RepositoryPage<AppointmentTransition, VersionedHistoryKeyset>>;
  listConfirmationEvidence: (
    id: AppointmentRequestId,
    request?: RepositoryPageRequest<RecordedHistoryKeyset>,
  ) => Promise<RepositoryPage<AppointmentConfirmationEvidence, RecordedHistoryKeyset>>;
  listAttendanceHistory: (
    id: AppointmentRequestId,
    request?: RepositoryPageRequest<RecordedHistoryKeyset>,
  ) => Promise<RepositoryPage<AppointmentAttendance, RecordedHistoryKeyset>>;
  listRevenueAttributions: (
    id: AppointmentRequestId,
    request?: RepositoryPageRequest<RecordedHistoryKeyset>,
  ) => Promise<RepositoryPage<AppointmentRevenueAttribution, RecordedHistoryKeyset>>;
}>;

export const createAppointmentRepository = (session: TenantDbSession): AppointmentRepository =>
  Object.freeze({
    getAppointmentRequest: async (id) => {
      const rows = await executeTenantRead<AppointmentRow>(
        session,
        `select ${APPOINTMENT_COLUMNS} from appointment_requests
          where organization_id = $1 and id = $2`,
        [id],
      );
      return mapAppointment(requireFound(rows, "appointment_request"));
    },

    listReviewQueue: async (request = {}) => {
      const limit = resolvePageLimit(request.limit);
      const after = request.after;
      const rows = await executeTenantRead<AppointmentRow>(
        session,
        `select ${APPOINTMENT_COLUMNS} from appointment_requests
          where organization_id = $1
            and ($2::text is null or status = $2)
            and ($3::uuid is null or location_id = $3)
            and ($4::timestamptz is null or (created_at, id) > ($4, $5::uuid))
          order by created_at, id
          limit $6`,
        [
          request.status ?? null,
          request.locationId ?? null,
          after?.createdAt ?? null,
          after?.appointmentRequestId ?? null,
          limit + 1,
        ],
      );
      return createRepositoryPage(rows, limit, mapAppointment, (item) => ({
        createdAt: item.createdAt,
        appointmentRequestId: item.appointmentRequestId,
      }));
    },

    listPreferences: async (id, request = {}) => {
      type Row = QueryResultRow & {
        id: unknown;
        appointment_request_id: unknown;
        preference_order: unknown;
        start_at: unknown;
        end_at: unknown;
        time_zone: unknown;
        original_local_text_ciphertext: unknown;
        local_start: unknown;
        local_end: unknown;
        precision: unknown;
        created_at: unknown;
      };
      const limit = resolvePageLimit(request.limit);
      const after = request.after;
      const rows = await executeTenantRead<Row>(
        session,
        `select id, appointment_request_id, preference_order, start_at, end_at,
                time_zone, original_local_text_ciphertext,
                local_start::text as local_start, local_end::text as local_end,
                precision, created_at
           from appointment_request_preferences
          where organization_id = $1 and appointment_request_id = $2
            and ($3::integer is null or (preference_order, id) > ($3, $4::uuid))
          order by preference_order, id limit $5`,
        [id, after?.order ?? null, after?.id ?? null, limit + 1],
      );
      return createRepositoryPage(
        rows,
        limit,
        (row) =>
          Object.freeze({
            preferenceId: mapResourceId(row.id),
            appointmentRequestId: mapAppointmentRequestId(row.appointment_request_id),
            preferenceOrder: mapPositiveInteger(row.preference_order),
            startAt: mapNullableUtcTimestamp(row.start_at),
            endAt: mapNullableUtcTimestamp(row.end_at),
            timeZone: mapString(row.time_zone),
            originalLocalTextCiphertext: mapNullableBytes(row.original_local_text_ciphertext),
            localStart: mapNullableString(row.local_start),
            localEnd: mapNullableString(row.local_end),
            precision: mapEnum(row.precision, PREFERENCE_PRECISIONS),
            createdAt: mapUtcTimestamp(row.created_at),
          }),
        (item) => ({ order: item.preferenceOrder, id: item.preferenceId }),
      );
    },

    listTransitions: async (id, request = {}) => {
      type Row = QueryResultRow & {
        id: unknown;
        appointment_request_id: unknown;
        from_status: unknown;
        to_status: unknown;
        aggregate_version: unknown;
        command: unknown;
        offer_version: unknown;
        actor_type: unknown;
        actor_contact_id: unknown;
        actor_membership_id: unknown;
        reason_code: unknown;
        source_message_id: unknown;
        correlation_id: unknown;
        occurred_at: unknown;
        metadata_jsonb: unknown;
      };
      const limit = resolvePageLimit(request.limit);
      const after = request.after;
      const rows = await executeTenantRead<Row>(
        session,
        `select id, appointment_request_id, from_status, to_status, aggregate_version,
                command, offer_version, actor_type, actor_contact_id,
                actor_membership_id, reason_code, source_message_id, correlation_id,
                occurred_at, metadata_jsonb
           from appointment_request_transitions
          where organization_id = $1 and appointment_request_id = $2
            and ($3::bigint is null or (aggregate_version, id) > ($3, $4::uuid))
          order by aggregate_version, id limit $5`,
        [id, after?.version ?? null, after?.id ?? null, limit + 1],
      );
      return createRepositoryPage(
        rows,
        limit,
        (row) =>
          Object.freeze({
            transitionId: mapResourceId(row.id),
            appointmentRequestId: mapAppointmentRequestId(row.appointment_request_id),
            fromStatus:
              row.from_status === null
                ? null
                : mapEnum(row.from_status, APPOINTMENT_REQUEST_STATUSES),
            toStatus: mapEnum(row.to_status, APPOINTMENT_REQUEST_STATUSES),
            aggregateVersion: mapAggregateVersion(row.aggregate_version),
            command: mapString(row.command),
            offerVersion: row.offer_version === null ? null : mapPositiveInteger(row.offer_version),
            actorType: mapEnum(row.actor_type, TRANSITION_ACTOR_TYPES),
            actorContactId:
              row.actor_contact_id === null ? null : mapContactId(row.actor_contact_id),
            actorMembershipId:
              row.actor_membership_id === null ? null : mapMembershipId(row.actor_membership_id),
            reasonCode: mapNullableString(row.reason_code),
            sourceMessageId:
              row.source_message_id === null ? null : mapMessageId(row.source_message_id),
            correlationId: mapResourceId(row.correlation_id),
            occurredAt: mapUtcTimestamp(row.occurred_at),
            metadata: mapJsonObject(row.metadata_jsonb),
          }),
        (item) => ({ version: item.aggregateVersion, id: item.transitionId }),
      );
    },

    listConfirmationEvidence: async (id, request = {}) => {
      type Row = QueryResultRow & {
        id: unknown;
        appointment_request_id: unknown;
        offer_version: unknown;
        outcome: unknown;
        source: unknown;
        customer_contact_id: unknown;
        recorded_by_membership_id: unknown;
        source_message_id: unknown;
        external_reference_hash: unknown;
        customer_acted_at: unknown;
        recorded_at: unknown;
        attestation_method: unknown;
        attestation_reason_code: unknown;
        evidence_ciphertext: unknown;
        correlation_id: unknown;
      };
      const limit = resolvePageLimit(request.limit);
      const after = request.after;
      const rows = await executeTenantRead<Row>(
        session,
        `select id, appointment_request_id, offer_version, outcome, source,
                customer_contact_id, recorded_by_membership_id, source_message_id,
                external_reference_hash, customer_acted_at, recorded_at,
                attestation_method, attestation_reason_code, evidence_ciphertext,
                correlation_id
           from appointment_confirmation_evidence
          where organization_id = $1 and appointment_request_id = $2
            and ($3::timestamptz is null or (recorded_at, id) < ($3, $4::uuid))
          order by recorded_at desc, id desc limit $5`,
        [id, after?.recordedAt ?? null, after?.id ?? null, limit + 1],
      );
      return createRepositoryPage(
        rows,
        limit,
        (row) =>
          Object.freeze({
            evidenceId: mapResourceId(row.id),
            appointmentRequestId: mapAppointmentRequestId(row.appointment_request_id),
            offerVersion: mapPositiveInteger(row.offer_version),
            outcome: mapEnum(row.outcome, CONFIRMATION_OUTCOMES),
            source: mapEnum(row.source, CONFIRMATION_SOURCES),
            customerContactId: mapContactId(row.customer_contact_id),
            recordedByMembershipId:
              row.recorded_by_membership_id === null
                ? null
                : mapMembershipId(row.recorded_by_membership_id),
            sourceMessageId:
              row.source_message_id === null ? null : mapMessageId(row.source_message_id),
            externalReferenceHash: mapNullableBytes(row.external_reference_hash),
            customerActedAt: mapUtcTimestamp(row.customer_acted_at),
            recordedAt: mapUtcTimestamp(row.recorded_at),
            attestationMethod: mapNullableString(row.attestation_method),
            attestationReasonCode: mapNullableString(row.attestation_reason_code),
            evidenceCiphertext: mapNullableBytes(row.evidence_ciphertext),
            correlationId: mapResourceId(row.correlation_id),
          }),
        (item) => ({ recordedAt: item.recordedAt, id: item.evidenceId }),
      );
    },

    listAttendanceHistory: async (id, request = {}) => {
      type Row = QueryResultRow & {
        id: unknown;
        appointment_request_id: unknown;
        outcome: unknown;
        occurred_at: unknown;
        recorded_by_membership_id: unknown;
        recorded_at: unknown;
        source: unknown;
        is_current: unknown;
        supersedes_id: unknown;
        reason_code: unknown;
      };
      const limit = resolvePageLimit(request.limit);
      const after = request.after;
      const rows = await executeTenantRead<Row>(
        session,
        `select id, appointment_request_id, outcome, occurred_at,
                recorded_by_membership_id, recorded_at, source, is_current,
                supersedes_id, reason_code
           from appointment_request_attendance
          where organization_id = $1 and appointment_request_id = $2
            and ($3::timestamptz is null or (recorded_at, id) < ($3, $4::uuid))
          order by recorded_at desc, id desc limit $5`,
        [id, after?.recordedAt ?? null, after?.id ?? null, limit + 1],
      );
      return createRepositoryPage(
        rows,
        limit,
        (row) =>
          Object.freeze({
            attendanceId: mapResourceId(row.id),
            appointmentRequestId: mapAppointmentRequestId(row.appointment_request_id),
            outcome: mapEnum(row.outcome, ATTENDANCE_OUTCOMES),
            occurredAt: mapNullableUtcTimestamp(row.occurred_at),
            recordedByMembershipId: mapMembershipId(row.recorded_by_membership_id),
            recordedAt: mapUtcTimestamp(row.recorded_at),
            source: mapEnum(row.source, BUSINESS_RECORD_SOURCES),
            isCurrent: mapBoolean(row.is_current),
            supersedesId: mapNullableIdentifier(row.supersedes_id),
            reasonCode: mapNullableString(row.reason_code),
          }),
        (item) => ({ recordedAt: item.recordedAt, id: item.attendanceId }),
      );
    },

    listRevenueAttributions: async (id, request = {}) => {
      type Row = QueryResultRow & {
        id: unknown;
        appointment_request_id: unknown;
        amount_minor: unknown;
        currency: unknown;
        entry_type: unknown;
        category_code: unknown;
        recognized_at: unknown;
        recorded_by_membership_id: unknown;
        recorded_at: unknown;
        source: unknown;
        reverses_attribution_id: unknown;
        external_reference_hash: unknown;
        reason_code: unknown;
      };
      const limit = resolvePageLimit(request.limit);
      const after = request.after;
      const rows = await executeTenantRead<Row>(
        session,
        `select id, appointment_request_id, amount_minor, currency, entry_type,
                category_code, recognized_at, recorded_by_membership_id,
                recorded_at, source, reverses_attribution_id,
                external_reference_hash, reason_code
           from appointment_revenue_attributions
          where organization_id = $1 and appointment_request_id = $2
            and ($3::timestamptz is null or (recorded_at, id) < ($3, $4::uuid))
          order by recorded_at desc, id desc limit $5`,
        [id, after?.recordedAt ?? null, after?.id ?? null, limit + 1],
      );
      return createRepositoryPage(
        rows,
        limit,
        (row) =>
          Object.freeze({
            attributionId: mapResourceId(row.id),
            appointmentRequestId: mapAppointmentRequestId(row.appointment_request_id),
            amountMinor: mapSafeBigInt(row.amount_minor),
            currency: mapCurrencyCode(row.currency),
            entryType: mapEnum(row.entry_type, REVENUE_ENTRY_TYPES),
            categoryCode: mapString(row.category_code),
            recognizedAt: mapUtcTimestamp(row.recognized_at),
            recordedByMembershipId: mapMembershipId(row.recorded_by_membership_id),
            recordedAt: mapUtcTimestamp(row.recorded_at),
            source: mapEnum(row.source, BUSINESS_RECORD_SOURCES),
            reversesAttributionId: mapNullableIdentifier(row.reverses_attribution_id),
            externalReferenceHash: mapNullableBytes(row.external_reference_hash),
            reasonCode: mapNullableString(row.reason_code),
          }),
        (item) => ({ recordedAt: item.recordedAt, id: item.attributionId }),
      );
    },
  });
