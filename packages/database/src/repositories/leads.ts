import type {
  ChannelConnectionId,
  ContactId,
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
  mapChannelConnectionId,
  mapContactId,
  mapEnum,
  mapJsonObject,
  mapLeadId,
  mapLocationId,
  mapMembershipId,
  mapMessageId,
  mapNullableIdentifier,
  mapNullableString,
  mapNullableUtcTimestamp,
  mapResourceId,
  mapServiceId,
  mapString,
  mapStringArray,
  mapUtcTimestamp,
  requireFound,
  resolvePageLimit,
  type RepositoryPage,
  type RepositoryPageRequest,
} from "./shared.js";

export const LEAD_STATUSES = [
  "new",
  "engaged",
  "qualified",
  "booking_requested",
  "converted",
  "disqualified",
  "closed",
] as const;
export type PersistedLeadStatus = (typeof LEAD_STATUSES)[number];
const ACTIVE_LEAD_SQL = "('new', 'engaged', 'qualified', 'booking_requested')";
const QUALIFICATION_RESULTS = ["qualified", "disqualified", "incomplete"] as const;
const EVALUATOR_TYPES = ["system", "member"] as const;
const EVIDENCE_KINDS = ["customer_statement", "staff_entry", "derived"] as const;

export type LeadRecord = Readonly<{
  leadId: LeadId;
  contactId: ContactId;
  status: PersistedLeadStatus;
  sourceChannelConnectionId: ChannelConnectionId;
  campaignKey: string | null;
  serviceId: ServiceId | null;
  locationId: LocationId | null;
  assignedMembershipId: MembershipId | null;
  qualificationPolicyId: ResourceId | null;
  qualificationReasonCodes: readonly string[];
  engagedAt: UtcTimestamp | null;
  qualifiedAt: UtcTimestamp | null;
  bookingRequestedAt: UtcTimestamp | null;
  convertedAt: UtcTimestamp | null;
  closedAt: UtcTimestamp | null;
  closedReason: string | null;
  version: ResourceVersion;
  createdAt: UtcTimestamp;
  updatedAt: UtcTimestamp;
}>;

export type LeadKeyset = Readonly<{ updatedAt: UtcTimestamp; leadId: LeadId }>;

export type LeadQualificationEvaluation = Readonly<{
  evaluationId: ResourceId;
  leadId: LeadId;
  businessPolicyId: ResourceId;
  result: (typeof QUALIFICATION_RESULTS)[number];
  reasonCodes: readonly string[];
  facts: Readonly<Record<string, unknown>>;
  evaluatedBy: (typeof EVALUATOR_TYPES)[number];
  memberId: MembershipId | null;
  occurredAt: UtcTimestamp;
}>;

export type LeadEvaluationKeyset = Readonly<{
  occurredAt: UtcTimestamp;
  evaluationId: ResourceId;
}>;

export type LeadQualificationEvidence = Readonly<{
  evaluationId: ResourceId;
  messageId: MessageId;
  fieldKey: string;
  evidenceKind: (typeof EVIDENCE_KINDS)[number];
  createdAt: UtcTimestamp;
}>;

export type LeadEvidenceKeyset = Readonly<{
  messageId: MessageId;
  fieldKey: string;
}>;

type LeadRow = QueryResultRow & {
  id: unknown;
  contact_id: unknown;
  status: unknown;
  source_channel_connection_id: unknown;
  campaign_key: unknown;
  service_id: unknown;
  location_id: unknown;
  assigned_membership_id: unknown;
  qualification_policy_id: unknown;
  qualification_reason_codes: unknown;
  engaged_at: unknown;
  qualified_at: unknown;
  booking_requested_at: unknown;
  converted_at: unknown;
  closed_at: unknown;
  closed_reason: unknown;
  version: unknown;
  created_at: unknown;
  updated_at: unknown;
};

const mapLead = (row: LeadRow): LeadRecord =>
  Object.freeze({
    leadId: mapLeadId(row.id),
    contactId: mapContactId(row.contact_id),
    status: mapEnum(row.status, LEAD_STATUSES),
    sourceChannelConnectionId: mapChannelConnectionId(row.source_channel_connection_id),
    campaignKey: mapNullableString(row.campaign_key),
    serviceId: row.service_id === null ? null : mapServiceId(row.service_id),
    locationId: row.location_id === null ? null : mapLocationId(row.location_id),
    assignedMembershipId:
      row.assigned_membership_id === null ? null : mapMembershipId(row.assigned_membership_id),
    qualificationPolicyId: mapNullableIdentifier(row.qualification_policy_id),
    qualificationReasonCodes: mapStringArray(row.qualification_reason_codes),
    engagedAt: mapNullableUtcTimestamp(row.engaged_at),
    qualifiedAt: mapNullableUtcTimestamp(row.qualified_at),
    bookingRequestedAt: mapNullableUtcTimestamp(row.booking_requested_at),
    convertedAt: mapNullableUtcTimestamp(row.converted_at),
    closedAt: mapNullableUtcTimestamp(row.closed_at),
    closedReason: mapNullableString(row.closed_reason),
    version: mapAggregateVersion(row.version),
    createdAt: mapUtcTimestamp(row.created_at),
    updatedAt: mapUtcTimestamp(row.updated_at),
  });

const LEAD_COLUMNS = `id, contact_id, status, source_channel_connection_id,
  campaign_key, service_id, location_id, assigned_membership_id,
  qualification_policy_id, qualification_reason_codes, engaged_at,
  qualified_at, booking_requested_at, converted_at, closed_at, closed_reason,
  version, created_at, updated_at`;

export type LeadRepository = Readonly<{
  getLead: (leadId: LeadId) => Promise<LeadRecord>;
  findActiveLeadByContact: (contactId: ContactId) => Promise<LeadRecord | null>;
  listLeads: (
    request?: RepositoryPageRequest<LeadKeyset> & Readonly<{ status?: PersistedLeadStatus }>,
  ) => Promise<RepositoryPage<LeadRecord, LeadKeyset>>;
  listQualificationEvaluations: (
    leadId: LeadId,
    request?: RepositoryPageRequest<LeadEvaluationKeyset>,
  ) => Promise<RepositoryPage<LeadQualificationEvaluation, LeadEvaluationKeyset>>;
  listQualificationEvidence: (
    evaluationId: ResourceId,
    request?: RepositoryPageRequest<LeadEvidenceKeyset>,
  ) => Promise<RepositoryPage<LeadQualificationEvidence, LeadEvidenceKeyset>>;
}>;

export const createLeadRepository = (session: TenantDbSession): LeadRepository =>
  Object.freeze({
    getLead: async (leadId) => {
      const rows = await executeTenantRead<LeadRow>(
        session,
        `select ${LEAD_COLUMNS}
           from leads
          where organization_id = $1 and id = $2`,
        [leadId],
      );
      return mapLead(requireFound(rows, "lead"));
    },

    findActiveLeadByContact: async (contactId) => {
      const rows = await executeTenantRead<LeadRow>(
        session,
        `select ${LEAD_COLUMNS}
           from leads
          where organization_id = $1
            and contact_id = $2
            and status in ${ACTIVE_LEAD_SQL}`,
        [contactId],
      );
      const row = rows[0];
      return row === undefined ? null : mapLead(row);
    },

    listLeads: async (request = {}) => {
      const limit = resolvePageLimit(request.limit);
      const after = request.after;
      const rows = await executeTenantRead<LeadRow>(
        session,
        `select ${LEAD_COLUMNS}
           from leads
          where organization_id = $1
            and ($2::text is null or status = $2)
            and ($3::timestamptz is null or (updated_at, id) < ($3, $4::uuid))
          order by updated_at desc, id desc
          limit $5`,
        [request.status ?? null, after?.updatedAt ?? null, after?.leadId ?? null, limit + 1],
      );
      return createRepositoryPage(rows, limit, mapLead, (item) => ({
        updatedAt: item.updatedAt,
        leadId: item.leadId,
      }));
    },

    listQualificationEvaluations: async (leadId, request = {}) => {
      type Row = QueryResultRow & {
        id: unknown;
        lead_id: unknown;
        business_policy_id: unknown;
        result: unknown;
        reason_codes: unknown;
        facts_jsonb: unknown;
        evaluated_by: unknown;
        member_id: unknown;
        occurred_at: unknown;
      };
      const limit = resolvePageLimit(request.limit);
      const after = request.after;
      const rows = await executeTenantRead<Row>(
        session,
        `select id, lead_id, business_policy_id, result, reason_codes,
                facts_jsonb, evaluated_by, member_id, occurred_at
           from lead_qualification_evaluations
          where organization_id = $1
            and lead_id = $2
            and ($3::timestamptz is null or (occurred_at, id) < ($3, $4::uuid))
          order by occurred_at desc, id desc
          limit $5`,
        [leadId, after?.occurredAt ?? null, after?.evaluationId ?? null, limit + 1],
      );
      return createRepositoryPage(
        rows,
        limit,
        (row) =>
          Object.freeze({
            evaluationId: mapResourceId(row.id),
            leadId: mapLeadId(row.lead_id),
            businessPolicyId: mapResourceId(row.business_policy_id),
            result: mapEnum(row.result, QUALIFICATION_RESULTS),
            reasonCodes: mapStringArray(row.reason_codes),
            facts: mapJsonObject(row.facts_jsonb),
            evaluatedBy: mapEnum(row.evaluated_by, EVALUATOR_TYPES),
            memberId: row.member_id === null ? null : mapMembershipId(row.member_id),
            occurredAt: mapUtcTimestamp(row.occurred_at),
          }),
        (item) => ({ occurredAt: item.occurredAt, evaluationId: item.evaluationId }),
      );
    },

    listQualificationEvidence: async (evaluationId, request = {}) => {
      type Row = QueryResultRow & {
        evaluation_id: unknown;
        message_id: unknown;
        field_key: unknown;
        evidence_kind: unknown;
        created_at: unknown;
      };
      const limit = resolvePageLimit(request.limit);
      const after = request.after;
      const rows = await executeTenantRead<Row>(
        session,
        `select evaluation_id, message_id, field_key, evidence_kind, created_at
           from lead_qualification_evidence
          where organization_id = $1
            and evaluation_id = $2
            and ($3::uuid is null or (message_id, field_key) > ($3, $4))
          order by message_id, field_key
          limit $5`,
        [evaluationId, after?.messageId ?? null, after?.fieldKey ?? null, limit + 1],
      );
      return createRepositoryPage(
        rows,
        limit,
        (row) =>
          Object.freeze({
            evaluationId: mapResourceId(row.evaluation_id),
            messageId: mapMessageId(row.message_id),
            fieldKey: mapString(row.field_key),
            evidenceKind: mapEnum(row.evidence_kind, EVIDENCE_KINDS),
            createdAt: mapUtcTimestamp(row.created_at),
          }),
        (item) => ({ messageId: item.messageId, fieldKey: item.fieldKey }),
      );
    },
  });
