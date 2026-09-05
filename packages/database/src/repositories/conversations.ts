import type {
  ChannelConnectionId,
  ContactId,
  ConversationId,
  HandoffId,
  LeadId,
  MembershipId,
  MessageId,
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
  mapBytes,
  mapChannelConnectionId,
  mapContactId,
  mapConversationId,
  mapEnum,
  mapHandoffId,
  mapJsonObject,
  mapLeadId,
  mapMembershipId,
  mapMessageId,
  mapNullableBytes,
  mapNullableIdentifier,
  mapNullableString,
  mapNullableUtcTimestamp,
  mapSafeBigInt,
  mapString,
  mapUtcTimestamp,
  requireFound,
  requireLookupHash,
  resolvePageLimit,
  type RepositoryPage,
  type RepositoryPageRequest,
} from "./shared.js";

export const CONVERSATION_STATUSES = [
  "open",
  "awaiting_lead",
  "awaiting_staff",
  "resolved",
  "closed",
] as const;
export type PersistedConversationStatus = (typeof CONVERSATION_STATUSES)[number];
const ACTIVE_CONVERSATION_SQL = "('open', 'awaiting_lead', 'awaiting_staff')";
const AUTOMATION_MODES = ["ai", "paused", "staff"] as const;
const MESSAGE_DIRECTIONS = ["inbound", "outbound", "staff_internal"] as const;
const MESSAGE_SENDERS = ["customer", "member", "system"] as const;
const PROCESSING_STATUSES = [
  "accepted",
  "processing",
  "processed",
  "failed",
  "suppressed",
] as const;
const DELIVERY_STATUSES = ["not_applicable", "queued", "sent", "delivered", "failed"] as const;

export type ConversationRecord = Readonly<{
  conversationId: ConversationId;
  contactId: ContactId;
  leadId: LeadId;
  channelConnectionId: ChannelConnectionId;
  externalThreadHash: Uint8Array | null;
  status: PersistedConversationStatus;
  preferredLocale: "en" | "ru" | "uz";
  automationMode: (typeof AUTOMATION_MODES)[number];
  activeHandoffId: HandoffId | null;
  nextSequenceNo: number;
  startedAt: UtcTimestamp;
  lastActivityAt: UtcTimestamp;
  resolvedAt: UtcTimestamp | null;
  closedAt: UtcTimestamp | null;
  version: ResourceVersion;
  createdAt: UtcTimestamp;
  updatedAt: UtcTimestamp;
}>;

export type ConversationKeyset = Readonly<{
  lastActivityAt: UtcTimestamp;
  conversationId: ConversationId;
}>;

export type MessageRecord = Readonly<{
  messageId: MessageId;
  conversationId: ConversationId;
  channelConnectionId: ChannelConnectionId;
  direction: (typeof MESSAGE_DIRECTIONS)[number];
  senderType: (typeof MESSAGE_SENDERS)[number];
  senderContactId: ContactId | null;
  senderMembershipId: MembershipId | null;
  sequenceNo: number;
  externalEventId: string | null;
  externalMessageId: string | null;
  externalSentAt: UtcTimestamp | null;
  externalSequence: number | null;
  contentType: string;
  bodyCiphertext: Uint8Array | null;
  bodyHash: Uint8Array;
  locale: "en" | "ru" | "uz" | null;
  processingStatus: (typeof PROCESSING_STATUSES)[number];
  deliveryStatus: (typeof DELIVERY_STATUSES)[number];
  replyToMessageId: MessageId | null;
  aiRunId: ResourceId | null;
  knowledgeManifest: Readonly<Record<string, unknown>> | null;
  redactedAt: UtcTimestamp | null;
  createdAt: UtcTimestamp;
}>;

export type MessageKeyset = Readonly<{
  sequenceNo: number;
  messageId: MessageId;
}>;

type ConversationRow = QueryResultRow & {
  id: unknown;
  contact_id: unknown;
  lead_id: unknown;
  channel_connection_id: unknown;
  external_thread_hash: unknown;
  status: unknown;
  preferred_locale: unknown;
  automation_mode: unknown;
  active_handoff_id: unknown;
  next_sequence_no: unknown;
  started_at: unknown;
  last_activity_at: unknown;
  resolved_at: unknown;
  closed_at: unknown;
  version: unknown;
  created_at: unknown;
  updated_at: unknown;
};

const mapConversation = (row: ConversationRow): ConversationRecord =>
  Object.freeze({
    conversationId: mapConversationId(row.id),
    contactId: mapContactId(row.contact_id),
    leadId: mapLeadId(row.lead_id),
    channelConnectionId: mapChannelConnectionId(row.channel_connection_id),
    externalThreadHash: mapNullableBytes(row.external_thread_hash),
    status: mapEnum(row.status, CONVERSATION_STATUSES),
    preferredLocale: mapEnum(row.preferred_locale, ["en", "ru", "uz"] as const),
    automationMode: mapEnum(row.automation_mode, AUTOMATION_MODES),
    activeHandoffId: row.active_handoff_id === null ? null : mapHandoffId(row.active_handoff_id),
    nextSequenceNo: mapSafeBigInt(row.next_sequence_no),
    startedAt: mapUtcTimestamp(row.started_at),
    lastActivityAt: mapUtcTimestamp(row.last_activity_at),
    resolvedAt: mapNullableUtcTimestamp(row.resolved_at),
    closedAt: mapNullableUtcTimestamp(row.closed_at),
    version: mapAggregateVersion(row.version),
    createdAt: mapUtcTimestamp(row.created_at),
    updatedAt: mapUtcTimestamp(row.updated_at),
  });

type MessageRow = QueryResultRow & {
  id: unknown;
  conversation_id: unknown;
  channel_connection_id: unknown;
  direction: unknown;
  sender_type: unknown;
  sender_contact_id: unknown;
  sender_membership_id: unknown;
  sequence_no: unknown;
  external_event_id: unknown;
  external_message_id: unknown;
  external_sent_at: unknown;
  external_sequence: unknown;
  content_type: unknown;
  body_ciphertext: unknown;
  body_hash: unknown;
  locale: unknown;
  processing_status: unknown;
  delivery_status: unknown;
  reply_to_message_id: unknown;
  ai_run_id: unknown;
  knowledge_manifest_jsonb: unknown;
  redacted_at: unknown;
  created_at: unknown;
};

const mapMessage = (row: MessageRow): MessageRecord =>
  Object.freeze({
    messageId: mapMessageId(row.id),
    conversationId: mapConversationId(row.conversation_id),
    channelConnectionId: mapChannelConnectionId(row.channel_connection_id),
    direction: mapEnum(row.direction, MESSAGE_DIRECTIONS),
    senderType: mapEnum(row.sender_type, MESSAGE_SENDERS),
    senderContactId: row.sender_contact_id === null ? null : mapContactId(row.sender_contact_id),
    senderMembershipId:
      row.sender_membership_id === null ? null : mapMembershipId(row.sender_membership_id),
    sequenceNo: mapSafeBigInt(row.sequence_no),
    externalEventId: mapNullableString(row.external_event_id),
    externalMessageId: mapNullableString(row.external_message_id),
    externalSentAt: mapNullableUtcTimestamp(row.external_sent_at),
    externalSequence: row.external_sequence === null ? null : mapSafeBigInt(row.external_sequence),
    contentType: mapString(row.content_type),
    bodyCiphertext: mapNullableBytes(row.body_ciphertext),
    bodyHash: mapBytes(row.body_hash),
    locale: row.locale === null ? null : mapEnum(row.locale, ["en", "ru", "uz"] as const),
    processingStatus: mapEnum(row.processing_status, PROCESSING_STATUSES),
    deliveryStatus: mapEnum(row.delivery_status, DELIVERY_STATUSES),
    replyToMessageId:
      row.reply_to_message_id === null ? null : mapMessageId(row.reply_to_message_id),
    aiRunId: mapNullableIdentifier(row.ai_run_id),
    knowledgeManifest:
      row.knowledge_manifest_jsonb === null ? null : mapJsonObject(row.knowledge_manifest_jsonb),
    redactedAt: mapNullableUtcTimestamp(row.redacted_at),
    createdAt: mapUtcTimestamp(row.created_at),
  });

const CONVERSATION_COLUMNS = `id, contact_id, lead_id, channel_connection_id,
  external_thread_hash, status, preferred_locale, automation_mode,
  active_handoff_id, next_sequence_no, started_at, last_activity_at,
  resolved_at, closed_at, version, created_at, updated_at`;

const MESSAGE_COLUMNS = `id, conversation_id, channel_connection_id, direction,
  sender_type, sender_contact_id, sender_membership_id, sequence_no,
  external_event_id, external_message_id, external_sent_at, external_sequence,
  content_type, body_ciphertext, body_hash, locale, processing_status,
  delivery_status, reply_to_message_id, ai_run_id, knowledge_manifest_jsonb,
  redacted_at, created_at`;

export type ConversationRepository = Readonly<{
  getConversation: (conversationId: ConversationId) => Promise<ConversationRecord>;
  findActiveConversation: (
    channelConnectionId: ChannelConnectionId,
    externalThreadHash: Uint8Array,
  ) => Promise<ConversationRecord | null>;
  listInbox: (
    request?: RepositoryPageRequest<ConversationKeyset> &
      Readonly<{ status?: PersistedConversationStatus }>,
  ) => Promise<RepositoryPage<ConversationRecord, ConversationKeyset>>;
  listMessages: (
    conversationId: ConversationId,
    request?: RepositoryPageRequest<MessageKeyset>,
  ) => Promise<RepositoryPage<MessageRecord, MessageKeyset>>;
}>;

export const createConversationRepository = (session: TenantDbSession): ConversationRepository =>
  Object.freeze({
    getConversation: async (conversationId) => {
      const rows = await executeTenantRead<ConversationRow>(
        session,
        `select ${CONVERSATION_COLUMNS}
           from conversations
          where organization_id = $1 and id = $2`,
        [conversationId],
      );
      return mapConversation(requireFound(rows, "conversation"));
    },

    findActiveConversation: async (channelConnectionId, externalThreadHash) => {
      const rows = await executeTenantRead<ConversationRow>(
        session,
        `select ${CONVERSATION_COLUMNS}
           from conversations
          where organization_id = $1
            and channel_connection_id = $2
            and external_thread_hash = $3
            and status in ${ACTIVE_CONVERSATION_SQL}`,
        [channelConnectionId, requireLookupHash(externalThreadHash)],
      );
      const row = rows[0];
      return row === undefined ? null : mapConversation(row);
    },

    listInbox: async (request = {}) => {
      const limit = resolvePageLimit(request.limit);
      const after = request.after;
      const rows = await executeTenantRead<ConversationRow>(
        session,
        `select ${CONVERSATION_COLUMNS}
           from conversations
          where organization_id = $1
            and ($2::text is null or status = $2)
            and ($3::timestamptz is null
              or (last_activity_at, id) < ($3, $4::uuid))
          order by last_activity_at desc, id desc
          limit $5`,
        [
          request.status ?? null,
          after?.lastActivityAt ?? null,
          after?.conversationId ?? null,
          limit + 1,
        ],
      );
      return createRepositoryPage(rows, limit, mapConversation, (item) => ({
        lastActivityAt: item.lastActivityAt,
        conversationId: item.conversationId,
      }));
    },

    listMessages: async (conversationId, request = {}) => {
      const limit = resolvePageLimit(request.limit);
      const after = request.after;
      const rows = await executeTenantRead<MessageRow>(
        session,
        `select ${MESSAGE_COLUMNS}
           from messages
          where organization_id = $1
            and conversation_id = $2
            and ($3::bigint is null or (sequence_no, id) > ($3, $4::uuid))
          order by sequence_no, id
          limit $5`,
        [conversationId, after?.sequenceNo ?? null, after?.messageId ?? null, limit + 1],
      );
      return createRepositoryPage(rows, limit, mapMessage, (item) => ({
        sequenceNo: item.sequenceNo,
        messageId: item.messageId,
      }));
    },
  });
