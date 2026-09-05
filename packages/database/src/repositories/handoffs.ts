import type {
  ContactId,
  ConversationId,
  HandoffId,
  LeadId,
  LocationId,
  MembershipId,
  ResourceId,
  ResourceVersion,
  UtcTimestamp,
} from "@lead-agent/contracts";
import type { QueryResultRow } from "pg";

import type { TenantDbSession } from "../runtime/tenant.js";
import {
  createRepositoryPage,
  executeTenantRead,
  mapAggregateVersion,
  mapContactId,
  mapConversationId,
  mapEnum,
  mapHandoffId,
  mapLeadId,
  mapLocationId,
  mapMembershipId,
  mapNullableBytes,
  mapNullableString,
  mapNullableUtcTimestamp,
  mapNonNegativeInteger,
  mapPositiveInteger,
  mapResourceId,
  mapString,
  mapUtcTimestamp,
  requireFound,
  resolvePageLimit,
  type RepositoryPage,
  type RepositoryPageRequest,
} from "./shared.js";

export const HANDOFF_STATUSES = [
  "requested",
  "assigned",
  "in_progress",
  "resolved",
  "cancelled",
  "expired",
] as const;
export type PersistedHandoffStatus = (typeof HANDOFF_STATUSES)[number];
const ACTIVE_HANDOFF_SQL = "('requested', 'assigned', 'in_progress')";
const HANDOFF_REASONS = [
  "customer_requested",
  "missing_authoritative_information",
  "medical_or_safety",
  "low_confidence",
  "policy_blocked",
  "ai_unavailable",
  "delivery_problem",
  "staff_created",
  "other",
] as const;
const ACTOR_TYPES = ["customer", "member", "system"] as const;
const CONVERSATION_DISPOSITIONS = [
  "resume_ai",
  "resolve_conversation",
  "successor_handoff",
] as const;
const NOTIFICATION_TYPES = ["staff_task", "customer_message", "staff_alert"] as const;
const AUDIENCE_TYPES = ["membership", "contact", "queue"] as const;
const RESOURCE_TYPES = [
  "appointment_request",
  "handoff",
  "conversation",
  "lead",
  "channel_connection",
  "ai_run",
] as const;
const NOTIFICATION_STATUSES = [
  "pending",
  "processing",
  "delivered",
  "failed",
  "dead_lettered",
  "cancelled",
] as const;
const NOTIFICATION_ADAPTERS = ["in_app", "widget", "telegram", "email", "sms", "push"] as const;
const ATTEMPT_OUTCOMES = ["delivered", "retryable_failure", "permanent_failure"] as const;

export type HandoffRecord = Readonly<{
  handoffId: HandoffId;
  conversationId: ConversationId;
  leadId: LeadId;
  locationId: LocationId | null;
  status: PersistedHandoffStatus;
  triggerReason: (typeof HANDOFF_REASONS)[number];
  queueKey: string;
  assignedMembershipId: MembershipId | null;
  requestedAt: UtcTimestamp;
  assignedAt: UtcTimestamp | null;
  startedAt: UtcTimestamp | null;
  slaDueAt: UtcTimestamp;
  resolvedAt: UtcTimestamp | null;
  resolutionCode: string | null;
  version: ResourceVersion;
  createdAt: UtcTimestamp;
  updatedAt: UtcTimestamp;
}>;

export type HandoffQueueKeyset = Readonly<{ requestedAt: UtcTimestamp; handoffId: HandoffId }>;

export type HandoffTransition = Readonly<{
  transitionId: ResourceId;
  handoffId: HandoffId;
  fromStatus: PersistedHandoffStatus | null;
  toStatus: PersistedHandoffStatus;
  aggregateVersion: number;
  actorType: (typeof ACTOR_TYPES)[number];
  actorContactId: ContactId | null;
  actorMembershipId: MembershipId | null;
  fromAssigneeId: MembershipId | null;
  toAssigneeId: MembershipId | null;
  conversationDisposition: (typeof CONVERSATION_DISPOSITIONS)[number] | null;
  reasonCode: string | null;
  correlationId: ResourceId;
  occurredAt: UtcTimestamp;
}>;

export type HandoffTransitionKeyset = Readonly<{ version: number; transitionId: ResourceId }>;

export type NotificationRecord = Readonly<{
  notificationId: ResourceId;
  notificationType: (typeof NOTIFICATION_TYPES)[number];
  audienceType: (typeof AUDIENCE_TYPES)[number];
  recipientMembershipId: MembershipId | null;
  recipientContactId: ContactId | null;
  queueKey: string | null;
  relatedResourceType: (typeof RESOURCE_TYPES)[number];
  relatedResourceId: ResourceId;
  originatingOutboxEventId: ResourceId;
  templateKey: string;
  templateVersion: number;
  payloadCiphertext: Uint8Array | null;
  status: (typeof NOTIFICATION_STATUSES)[number];
  availableAt: UtcTimestamp;
  attemptCount: number;
  nextAttemptAt: UtcTimestamp | null;
  deliveredAt: UtcTimestamp | null;
  readAt: UtcTimestamp | null;
  claimedByMembershipId: MembershipId | null;
  lastErrorCategory: string | null;
  version: ResourceVersion;
  createdAt: UtcTimestamp;
  updatedAt: UtcTimestamp;
}>;

export type NotificationKeyset = Readonly<{ createdAt: UtcTimestamp; notificationId: ResourceId }>;

export type NotificationAttempt = Readonly<{
  attemptId: ResourceId;
  notificationId: ResourceId;
  adapter: (typeof NOTIFICATION_ADAPTERS)[number];
  attemptNo: number;
  providerRequestKey: string;
  startedAt: UtcTimestamp;
  finishedAt: UtcTimestamp;
  outcome: (typeof ATTEMPT_OUTCOMES)[number];
  providerStatusCode: number | null;
  errorCategory: string | null;
  providerMessageIdHash: Uint8Array | null;
  latencyMs: number;
}>;

export type NotificationAttemptKeyset = Readonly<{ attemptNo: number; attemptId: ResourceId }>;

type HandoffRow = QueryResultRow & {
  id: unknown;
  conversation_id: unknown;
  lead_id: unknown;
  location_id: unknown;
  status: unknown;
  trigger_reason: unknown;
  queue_key: unknown;
  assigned_membership_id: unknown;
  requested_at: unknown;
  assigned_at: unknown;
  started_at: unknown;
  sla_due_at: unknown;
  resolved_at: unknown;
  resolution_code: unknown;
  version: unknown;
  created_at: unknown;
  updated_at: unknown;
};

const mapHandoff = (row: HandoffRow): HandoffRecord =>
  Object.freeze({
    handoffId: mapHandoffId(row.id),
    conversationId: mapConversationId(row.conversation_id),
    leadId: mapLeadId(row.lead_id),
    locationId: row.location_id === null ? null : mapLocationId(row.location_id),
    status: mapEnum(row.status, HANDOFF_STATUSES),
    triggerReason: mapEnum(row.trigger_reason, HANDOFF_REASONS),
    queueKey: mapString(row.queue_key),
    assignedMembershipId:
      row.assigned_membership_id === null ? null : mapMembershipId(row.assigned_membership_id),
    requestedAt: mapUtcTimestamp(row.requested_at),
    assignedAt: mapNullableUtcTimestamp(row.assigned_at),
    startedAt: mapNullableUtcTimestamp(row.started_at),
    slaDueAt: mapUtcTimestamp(row.sla_due_at),
    resolvedAt: mapNullableUtcTimestamp(row.resolved_at),
    resolutionCode: mapNullableString(row.resolution_code),
    version: mapAggregateVersion(row.version),
    createdAt: mapUtcTimestamp(row.created_at),
    updatedAt: mapUtcTimestamp(row.updated_at),
  });

type NotificationRow = QueryResultRow & {
  id: unknown;
  notification_type: unknown;
  audience_type: unknown;
  recipient_membership_id: unknown;
  recipient_contact_id: unknown;
  queue_key: unknown;
  related_resource_type: unknown;
  related_resource_id: unknown;
  originating_outbox_event_id: unknown;
  template_key: unknown;
  template_version: unknown;
  payload_ciphertext: unknown;
  status: unknown;
  available_at: unknown;
  attempt_count: unknown;
  next_attempt_at: unknown;
  delivered_at: unknown;
  read_at: unknown;
  claimed_by_membership_id: unknown;
  last_error_category: unknown;
  version: unknown;
  created_at: unknown;
  updated_at: unknown;
};

const mapNotification = (row: NotificationRow): NotificationRecord =>
  Object.freeze({
    notificationId: mapResourceId(row.id),
    notificationType: mapEnum(row.notification_type, NOTIFICATION_TYPES),
    audienceType: mapEnum(row.audience_type, AUDIENCE_TYPES),
    recipientMembershipId:
      row.recipient_membership_id === null ? null : mapMembershipId(row.recipient_membership_id),
    recipientContactId:
      row.recipient_contact_id === null ? null : mapContactId(row.recipient_contact_id),
    queueKey: mapNullableString(row.queue_key),
    relatedResourceType: mapEnum(row.related_resource_type, RESOURCE_TYPES),
    relatedResourceId: mapResourceId(row.related_resource_id),
    originatingOutboxEventId: mapResourceId(row.originating_outbox_event_id),
    templateKey: mapString(row.template_key),
    templateVersion: mapPositiveInteger(row.template_version),
    payloadCiphertext: mapNullableBytes(row.payload_ciphertext),
    status: mapEnum(row.status, NOTIFICATION_STATUSES),
    availableAt: mapUtcTimestamp(row.available_at),
    attemptCount: mapNonNegativeInteger(row.attempt_count),
    nextAttemptAt: mapNullableUtcTimestamp(row.next_attempt_at),
    deliveredAt: mapNullableUtcTimestamp(row.delivered_at),
    readAt: mapNullableUtcTimestamp(row.read_at),
    claimedByMembershipId:
      row.claimed_by_membership_id === null ? null : mapMembershipId(row.claimed_by_membership_id),
    lastErrorCategory: mapNullableString(row.last_error_category),
    version: mapAggregateVersion(row.version),
    createdAt: mapUtcTimestamp(row.created_at),
    updatedAt: mapUtcTimestamp(row.updated_at),
  });

const HANDOFF_COLUMNS = `id, conversation_id, lead_id, location_id, status,
  trigger_reason, queue_key, assigned_membership_id, requested_at, assigned_at,
  started_at, sla_due_at, resolved_at, resolution_code, version, created_at, updated_at`;
const NOTIFICATION_COLUMNS = `id, notification_type, audience_type,
  recipient_membership_id, recipient_contact_id, queue_key, related_resource_type,
  related_resource_id, originating_outbox_event_id, template_key, template_version,
  payload_ciphertext, status, available_at, attempt_count, next_attempt_at,
  delivered_at, read_at, claimed_by_membership_id, last_error_category,
  version, created_at, updated_at`;

export type HandoffNotificationRepository = Readonly<{
  getHandoff: (id: HandoffId) => Promise<HandoffRecord>;
  findActiveHandoffByConversation: (
    conversationId: ConversationId,
  ) => Promise<HandoffRecord | null>;
  listActiveHandoffs: (
    request?: RepositoryPageRequest<HandoffQueueKeyset> &
      Readonly<{ queueKey?: string; assignedMembershipId?: MembershipId }>,
  ) => Promise<RepositoryPage<HandoffRecord, HandoffQueueKeyset>>;
  listHandoffTransitions: (
    id: HandoffId,
    request?: RepositoryPageRequest<HandoffTransitionKeyset>,
  ) => Promise<RepositoryPage<HandoffTransition, HandoffTransitionKeyset>>;
  getNotification: (id: ResourceId) => Promise<NotificationRecord>;
  listRecipientNotifications: (
    membershipId: MembershipId,
    request?: RepositoryPageRequest<NotificationKeyset>,
  ) => Promise<RepositoryPage<NotificationRecord, NotificationKeyset>>;
  listNotificationAttempts: (
    notificationId: ResourceId,
    request?: RepositoryPageRequest<NotificationAttemptKeyset>,
  ) => Promise<RepositoryPage<NotificationAttempt, NotificationAttemptKeyset>>;
}>;

export const createHandoffNotificationRepository = (
  session: TenantDbSession,
): HandoffNotificationRepository =>
  Object.freeze({
    getHandoff: async (id) => {
      const rows = await executeTenantRead<HandoffRow>(
        session,
        `select ${HANDOFF_COLUMNS} from handoffs where organization_id = $1 and id = $2`,
        [id],
      );
      return mapHandoff(requireFound(rows, "handoff"));
    },
    findActiveHandoffByConversation: async (conversationId) => {
      const rows = await executeTenantRead<HandoffRow>(
        session,
        `select ${HANDOFF_COLUMNS} from handoffs
        where organization_id = $1 and conversation_id = $2
          and status in ${ACTIVE_HANDOFF_SQL}`,
        [conversationId],
      );
      return rows[0] === undefined ? null : mapHandoff(rows[0]);
    },
    listActiveHandoffs: async (request = {}) => {
      const limit = resolvePageLimit(request.limit);
      const after = request.after;
      const rows = await executeTenantRead<HandoffRow>(
        session,
        `select ${HANDOFF_COLUMNS} from handoffs
        where organization_id = $1 and status in ${ACTIVE_HANDOFF_SQL}
          and ($2::text is null or queue_key = $2)
          and ($3::uuid is null or assigned_membership_id = $3)
          and ($4::timestamptz is null or (requested_at, id) > ($4, $5::uuid))
        order by requested_at, id limit $6`,
        [
          request.queueKey ?? null,
          request.assignedMembershipId ?? null,
          after?.requestedAt ?? null,
          after?.handoffId ?? null,
          limit + 1,
        ],
      );
      return createRepositoryPage(rows, limit, mapHandoff, (item) => ({
        requestedAt: item.requestedAt,
        handoffId: item.handoffId,
      }));
    },
    listHandoffTransitions: async (id, request = {}) => {
      type Row = QueryResultRow & {
        id: unknown;
        handoff_id: unknown;
        from_status: unknown;
        to_status: unknown;
        aggregate_version: unknown;
        actor_type: unknown;
        actor_contact_id: unknown;
        actor_membership_id: unknown;
        from_assignee_id: unknown;
        to_assignee_id: unknown;
        conversation_disposition: unknown;
        reason_code: unknown;
        correlation_id: unknown;
        occurred_at: unknown;
      };
      const limit = resolvePageLimit(request.limit);
      const after = request.after;
      const rows = await executeTenantRead<Row>(
        session,
        `select id, handoff_id, from_status, to_status, aggregate_version, actor_type,
              actor_contact_id, actor_membership_id, from_assignee_id, to_assignee_id,
              conversation_disposition, reason_code, correlation_id, occurred_at
         from handoff_transitions where organization_id = $1 and handoff_id = $2
          and ($3::bigint is null or (aggregate_version, id) > ($3, $4::uuid))
        order by aggregate_version, id limit $5`,
        [id, after?.version ?? null, after?.transitionId ?? null, limit + 1],
      );
      return createRepositoryPage(
        rows,
        limit,
        (row) =>
          Object.freeze({
            transitionId: mapResourceId(row.id),
            handoffId: mapHandoffId(row.handoff_id),
            fromStatus:
              row.from_status === null ? null : mapEnum(row.from_status, HANDOFF_STATUSES),
            toStatus: mapEnum(row.to_status, HANDOFF_STATUSES),
            aggregateVersion: mapAggregateVersion(row.aggregate_version),
            actorType: mapEnum(row.actor_type, ACTOR_TYPES),
            actorContactId:
              row.actor_contact_id === null ? null : mapContactId(row.actor_contact_id),
            actorMembershipId:
              row.actor_membership_id === null ? null : mapMembershipId(row.actor_membership_id),
            fromAssigneeId:
              row.from_assignee_id === null ? null : mapMembershipId(row.from_assignee_id),
            toAssigneeId: row.to_assignee_id === null ? null : mapMembershipId(row.to_assignee_id),
            conversationDisposition:
              row.conversation_disposition === null
                ? null
                : mapEnum(row.conversation_disposition, CONVERSATION_DISPOSITIONS),
            reasonCode: mapNullableString(row.reason_code),
            correlationId: mapResourceId(row.correlation_id),
            occurredAt: mapUtcTimestamp(row.occurred_at),
          }),
        (item) => ({ version: item.aggregateVersion, transitionId: item.transitionId }),
      );
    },
    getNotification: async (id) => {
      const rows = await executeTenantRead<NotificationRow>(
        session,
        `select ${NOTIFICATION_COLUMNS} from notifications where organization_id = $1 and id = $2`,
        [id],
      );
      return mapNotification(requireFound(rows, "notification"));
    },
    listRecipientNotifications: async (membershipId, request = {}) => {
      const limit = resolvePageLimit(request.limit);
      const after = request.after;
      const rows = await executeTenantRead<NotificationRow>(
        session,
        `select ${NOTIFICATION_COLUMNS} from notifications
        where organization_id = $1 and recipient_membership_id = $2
          and ($3::timestamptz is null or (created_at, id) < ($3, $4::uuid))
        order by created_at desc, id desc limit $5`,
        [membershipId, after?.createdAt ?? null, after?.notificationId ?? null, limit + 1],
      );
      return createRepositoryPage(rows, limit, mapNotification, (item) => ({
        createdAt: item.createdAt,
        notificationId: item.notificationId,
      }));
    },
    listNotificationAttempts: async (notificationId, request = {}) => {
      type Row = QueryResultRow & {
        id: unknown;
        notification_id: unknown;
        adapter: unknown;
        attempt_no: unknown;
        provider_request_key: unknown;
        started_at: unknown;
        finished_at: unknown;
        outcome: unknown;
        provider_status_code: unknown;
        error_category: unknown;
        provider_message_id_hash: unknown;
        latency_ms: unknown;
      };
      const limit = resolvePageLimit(request.limit);
      const after = request.after;
      const rows = await executeTenantRead<Row>(
        session,
        `select id, notification_id, adapter, attempt_no, provider_request_key,
              started_at, finished_at, outcome, provider_status_code,
              error_category, provider_message_id_hash, latency_ms
         from notification_attempts where organization_id = $1 and notification_id = $2
          and ($3::integer is null or (attempt_no, id) > ($3, $4::uuid))
        order by attempt_no, id limit $5`,
        [notificationId, after?.attemptNo ?? null, after?.attemptId ?? null, limit + 1],
      );
      return createRepositoryPage(
        rows,
        limit,
        (row) =>
          Object.freeze({
            attemptId: mapResourceId(row.id),
            notificationId: mapResourceId(row.notification_id),
            adapter: mapEnum(row.adapter, NOTIFICATION_ADAPTERS),
            attemptNo: mapPositiveInteger(row.attempt_no),
            providerRequestKey: mapString(row.provider_request_key),
            startedAt: mapUtcTimestamp(row.started_at),
            finishedAt: mapUtcTimestamp(row.finished_at),
            outcome: mapEnum(row.outcome, ATTEMPT_OUTCOMES),
            providerStatusCode:
              row.provider_status_code === null
                ? null
                : mapPositiveInteger(row.provider_status_code),
            errorCategory: mapNullableString(row.error_category),
            providerMessageIdHash: mapNullableBytes(row.provider_message_id_hash),
            latencyMs: mapNonNegativeInteger(row.latency_ms),
          }),
        (item) => ({ attemptNo: item.attemptNo, attemptId: item.attemptId }),
      );
    },
  });
