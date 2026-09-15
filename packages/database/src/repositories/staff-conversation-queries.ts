import type {
  StaffConversationQueryStore,
  StoredContact,
  StoredContactIdentity,
  StoredMessage,
} from "@lead-agent/application";
import type { StaffConversation, StaffLead } from "@lead-agent/contracts";
import type { AuthorizationContext } from "@lead-agent/security";
import type { QueryResultRow } from "pg";

import type { TenantDatabaseRuntime, TenantDbSession } from "../runtime/tenant.js";
import { executeTenantQuery } from "../runtime/tenant.js";
import {
  mapAggregateVersion,
  mapChannelConnectionId,
  mapContactId,
  mapConversationId,
  mapEnum,
  mapHandoffId,
  mapLeadId,
  mapLocationId,
  mapMembershipId,
  mapMessageId,
  mapNullableBytes,
  mapNullableIdentifier,
  mapNullableUtcTimestamp,
  mapResourceId,
  mapSafeBigInt,
  mapServiceId,
  mapString,
  mapUtcTimestamp,
} from "./shared.js";

const CONTACT_STATUSES = ["active", "anonymized", "blocked"] as const;
const IDENTITY_TYPES = ["widget_participant", "telegram_user", "phone", "email"] as const;
const IDENTITY_VALIDATION_STATUSES = ["unverified", "valid", "verified", "invalid"] as const;
const IDENTITY_STATUSES = ["active", "withdrawn", "anonymized"] as const;
const LEAD_STATUSES = [
  "new",
  "engaged",
  "qualified",
  "booking_requested",
  "converted",
  "disqualified",
  "closed",
] as const;
const CONVERSATION_STATUSES = [
  "open",
  "awaiting_lead",
  "awaiting_staff",
  "resolved",
  "closed",
] as const;
const AUTOMATION_MODES = ["ai", "paused", "staff"] as const;
const MESSAGE_DIRECTIONS = ["inbound", "outbound", "staff_internal"] as const;
const MESSAGE_SENDERS = ["customer", "member", "system"] as const;
const MESSAGE_PROCESSING = ["accepted", "processing", "processed", "failed", "suppressed"] as const;
const MESSAGE_DELIVERY = ["not_applicable", "queued", "sent", "delivered", "failed"] as const;
const LOCALES = ["uz", "ru", "en"] as const;
const mapLocale = (value: unknown): (typeof LOCALES)[number] => mapEnum(value, LOCALES);

type ContactRow = QueryResultRow & {
  anonymized_at: unknown;
  created_at: unknown;
  display_name_ciphertext: unknown;
  first_seen_at: unknown;
  id: unknown;
  last_seen_at: unknown;
  preferred_locale: unknown;
  status: unknown;
  updated_at: unknown;
  version: unknown;
};
type IdentityRow = QueryResultRow & {
  channel_connection_id: unknown;
  display_redacted: unknown;
  id: unknown;
  identity_type: unknown;
  status: unknown;
  validation_status: unknown;
  value_ciphertext: unknown;
  verified_at: unknown;
};
type LeadRow = QueryResultRow & {
  assigned_membership_id: unknown;
  booking_requested_at: unknown;
  campaign_key: unknown;
  closed_at: unknown;
  closed_reason: unknown;
  contact_id: unknown;
  converted_at: unknown;
  created_at: unknown;
  engaged_at: unknown;
  id: unknown;
  location_id: unknown;
  qualification_policy_id: unknown;
  qualification_reason_codes: unknown;
  qualified_at: unknown;
  service_id: unknown;
  source_channel_connection_id: unknown;
  status: unknown;
  updated_at: unknown;
  version: unknown;
};
type ConversationRow = QueryResultRow & {
  active_handoff_id: unknown;
  automation_mode: unknown;
  channel_connection_id: unknown;
  closed_at: unknown;
  contact_id: unknown;
  created_at: unknown;
  id: unknown;
  identity_type: unknown;
  last_activity_at: unknown;
  lead_id: unknown;
  participant_display_redacted: unknown;
  preferred_locale: unknown;
  resolved_at: unknown;
  started_at: unknown;
  status: unknown;
  updated_at: unknown;
  version: unknown;
};
type MessageRow = QueryResultRow & {
  body_ciphertext: unknown;
  channel_connection_id: unknown;
  content_type: unknown;
  conversation_id: unknown;
  created_at: unknown;
  delivery_status: unknown;
  direction: unknown;
  id: unknown;
  locale: unknown;
  processing_status: unknown;
  redacted_at: unknown;
  reply_to_message_id: unknown;
  sender_membership_id: unknown;
  sender_type: unknown;
  sequence_no: unknown;
};

const nullable = <Value>(value: unknown, mapper: (candidate: unknown) => Value): Value | null =>
  value === null ? null : mapper(value);

const mapStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string")) {
    throw new TypeError("Persisted staff query data is invalid");
  }
  return [...value];
};

const mapContact = (
  row: ContactRow,
  identities: readonly StoredContactIdentity[],
): StoredContact => ({
  anonymized_at: mapNullableUtcTimestamp(row.anonymized_at),
  created_at: mapUtcTimestamp(row.created_at),
  displayNameCiphertext: mapNullableBytes(row.display_name_ciphertext),
  first_seen_at: mapUtcTimestamp(row.first_seen_at),
  id: mapContactId(row.id),
  identities,
  last_seen_at: mapUtcTimestamp(row.last_seen_at),
  preferred_locale: nullable(row.preferred_locale, mapLocale),
  status: mapEnum(row.status, CONTACT_STATUSES),
  updated_at: mapUtcTimestamp(row.updated_at),
  version: mapAggregateVersion(row.version),
});

const mapIdentity = (row: IdentityRow): StoredContactIdentity => ({
  channel_connection_id: nullable(row.channel_connection_id, mapChannelConnectionId),
  display_redacted: nullable(row.display_redacted, mapString),
  id: mapResourceId(row.id),
  identity_type: mapEnum(row.identity_type, IDENTITY_TYPES),
  status: mapEnum(row.status, IDENTITY_STATUSES),
  validation_status: mapEnum(row.validation_status, IDENTITY_VALIDATION_STATUSES),
  valueCiphertext: mapNullableBytes(row.value_ciphertext),
  verified_at: mapNullableUtcTimestamp(row.verified_at),
});

const mapLead = (row: LeadRow): StaffLead => ({
  assigned_membership_id: nullable(row.assigned_membership_id, mapMembershipId),
  booking_requested_at: mapNullableUtcTimestamp(row.booking_requested_at),
  campaign_key: nullable(row.campaign_key, mapString),
  closed_at: mapNullableUtcTimestamp(row.closed_at),
  closed_reason: nullable(row.closed_reason, mapString),
  contact_id: mapContactId(row.contact_id),
  converted_at: mapNullableUtcTimestamp(row.converted_at),
  created_at: mapUtcTimestamp(row.created_at),
  engaged_at: mapNullableUtcTimestamp(row.engaged_at),
  id: mapLeadId(row.id),
  location_id: nullable(row.location_id, mapLocationId),
  qualification_policy_id: mapNullableIdentifier(row.qualification_policy_id),
  qualification_reason_codes: mapStringArray(row.qualification_reason_codes),
  qualified_at: mapNullableUtcTimestamp(row.qualified_at),
  service_id: nullable(row.service_id, mapServiceId),
  source_channel_connection_id: mapChannelConnectionId(row.source_channel_connection_id),
  status: mapEnum(row.status, LEAD_STATUSES),
  updated_at: mapUtcTimestamp(row.updated_at),
  version: mapAggregateVersion(row.version),
});

const mapConversation = (row: ConversationRow): StaffConversation => ({
  active_handoff_id: nullable(row.active_handoff_id, mapHandoffId),
  automation_mode: mapEnum(row.automation_mode, AUTOMATION_MODES),
  channel_connection_id: mapChannelConnectionId(row.channel_connection_id),
  closed_at: mapNullableUtcTimestamp(row.closed_at),
  contact_id: mapContactId(row.contact_id),
  created_at: mapUtcTimestamp(row.created_at),
  id: mapConversationId(row.id),
  last_activity_at: mapUtcTimestamp(row.last_activity_at),
  lead_id: mapLeadId(row.lead_id),
  participant: {
    contact_id: mapContactId(row.contact_id),
    display_redacted: nullable(row.participant_display_redacted, mapString),
    identity_type: nullable(row.identity_type, (value) => mapEnum(value, IDENTITY_TYPES)),
  },
  preferred_locale: mapLocale(row.preferred_locale),
  resolved_at: mapNullableUtcTimestamp(row.resolved_at),
  started_at: mapUtcTimestamp(row.started_at),
  status: mapEnum(row.status, CONVERSATION_STATUSES),
  updated_at: mapUtcTimestamp(row.updated_at),
  version: mapAggregateVersion(row.version),
});

const mapMessage = (row: MessageRow): StoredMessage => ({
  bodyCiphertext: mapNullableBytes(row.body_ciphertext),
  channel_connection_id: mapChannelConnectionId(row.channel_connection_id),
  content_type: mapString(row.content_type),
  conversation_id: mapConversationId(row.conversation_id),
  created_at: mapUtcTimestamp(row.created_at),
  delivery_status: mapEnum(row.delivery_status, MESSAGE_DELIVERY),
  direction: mapEnum(row.direction, MESSAGE_DIRECTIONS),
  id: mapMessageId(row.id),
  locale: nullable(row.locale, mapLocale),
  processing_status: mapEnum(row.processing_status, MESSAGE_PROCESSING),
  redacted_at: mapNullableUtcTimestamp(row.redacted_at),
  reply_to_message_id: nullable(row.reply_to_message_id, mapMessageId),
  sender_membership_id: nullable(row.sender_membership_id, mapMembershipId),
  sender_type: mapEnum(row.sender_type, MESSAGE_SENDERS),
  sequence_no: mapSafeBigInt(row.sequence_no),
});

const scopeSql = (
  authorization: AuthorizationContext,
  alias: string,
  parameter: number,
): Readonly<{ text: string; value?: readonly string[] }> =>
  authorization.locationScope === "all"
    ? { text: "true" }
    : {
        text: `${alias}.location_id = any($${parameter}::uuid[])`,
        value: authorization.allowedLocationIds,
      };

const conversationProjection = `
  c.id, c.contact_id, c.lead_id, c.channel_connection_id, c.status,
  c.preferred_locale, c.automation_mode, c.active_handoff_id, c.started_at,
  c.last_activity_at, c.resolved_at, c.closed_at, c.version, c.created_at, c.updated_at,
  participant.identity_type, participant.display_redacted as participant_display_redacted`;
const participantJoin = `
  left join lateral (
    select ci.identity_type, ci.display_redacted
      from contact_identities ci
     where ci.organization_id = $1
       and ci.contact_id = c.contact_id
       and ci.status <> 'anonymized'
     order by (ci.channel_connection_id = c.channel_connection_id) desc nulls last,
              ci.created_at asc, ci.id asc
     limit 1
  ) participant on true`;

const withRuntime = <Value>(
  runtime: TenantDatabaseRuntime,
  authorization: AuthorizationContext,
  operation: (session: TenantDbSession) => Promise<Value>,
): Promise<Value> => runtime.withTenantTransaction(authorization.organizationId, operation);

export const createStaffConversationQueryStore = (
  runtime: TenantDatabaseRuntime,
): StaffConversationQueryStore => {
  const store: StaffConversationQueryStore = {
    getContact: ({ authorization, contactId }) =>
      withRuntime(runtime, authorization, async (session) => {
        const scope = scopeSql(authorization, "l", 3);
        const values: unknown[] = [authorization.organizationId, contactId];
        if (scope.value !== undefined) values.push(scope.value);
        const contact = await executeTenantQuery<ContactRow>(session, () => ({
          text: `select c.id, c.display_name_ciphertext, c.preferred_locale, c.status,
                      c.first_seen_at, c.last_seen_at, c.anonymized_at, c.version,
                      c.created_at, c.updated_at
                 from contacts c
                where c.organization_id = $1 and c.id = $2
                  and exists (
                    select 1 from leads l
                     where l.organization_id = $1 and l.contact_id = c.id and ${scope.text}
                  )`,
          values,
        }));
        const row = contact.rows[0];
        if (row === undefined) return null;
        const identities = await executeTenantQuery<IdentityRow>(session, () => ({
          text: `select id, identity_type, channel_connection_id, value_ciphertext,
                      display_redacted, validation_status, verified_at, status
                 from contact_identities
                where organization_id = $1 and contact_id = $2
                order by created_at asc, id asc`,
          values: [authorization.organizationId, contactId],
        }));
        return mapContact(row, identities.rows.map(mapIdentity));
      }),
    getLead: ({ authorization, leadId }) =>
      withRuntime(runtime, authorization, async (session) => {
        const scope = scopeSql(authorization, "l", 3);
        const values: unknown[] = [authorization.organizationId, leadId];
        if (scope.value !== undefined) values.push(scope.value);
        const result = await executeTenantQuery<LeadRow>(session, () => ({
          text: `select l.* from leads l
                where l.organization_id = $1 and l.id = $2 and ${scope.text}`,
          values,
        }));
        return result.rows[0] === undefined ? null : mapLead(result.rows[0]);
      }),
    listLeads: ({ after, authorization, filter, limit }) =>
      withRuntime(runtime, authorization, async (session) => {
        const values: unknown[] = [authorization.organizationId];
        const conditions = ["l.organization_id = $1"];
        const scope = scopeSql(authorization, "l", values.length + 1);
        conditions.push(scope.text);
        if (scope.value !== undefined) values.push(scope.value);
        const add = (sql: string, value: unknown): void => {
          values.push(value);
          conditions.push(sql.replace("?", `$${values.length}`));
        };
        if (filter.status !== undefined) add("l.status = ?", filter.status);
        if (filter.location_id !== undefined) add("l.location_id = ?", filter.location_id);
        if (filter.assigned_membership_id !== undefined)
          add("l.assigned_membership_id = ?", filter.assigned_membership_id);
        if (filter.created_from !== undefined) add("l.created_at >= ?", filter.created_from);
        if (filter.created_to !== undefined) add("l.created_at < ?", filter.created_to);
        if (after !== null) {
          values.push(after.createdAt, after.id);
          conditions.push(
            `(l.created_at, l.id) < ($${values.length - 1}::timestamptz, $${values.length}::uuid)`,
          );
        }
        values.push(limit + 1);
        const result = await executeTenantQuery<LeadRow>(session, () => ({
          text: `select l.* from leads l where ${conditions.join(" and ")}
                order by l.created_at desc, l.id desc limit $${values.length}`,
          values,
        }));
        const mapped = result.rows.map(mapLead);
        const items = mapped.slice(0, limit);
        const last = items.at(-1);
        return {
          items,
          next:
            mapped.length > limit && last !== undefined
              ? { createdAt: last.created_at, id: last.id }
              : null,
        };
      }),
    getConversation: ({ authorization, conversationId }) =>
      withRuntime(runtime, authorization, async (session) => {
        const scope = scopeSql(authorization, "l", 3);
        const values: unknown[] = [authorization.organizationId, conversationId];
        if (scope.value !== undefined) values.push(scope.value);
        const result = await executeTenantQuery<ConversationRow>(session, () => ({
          text: `select ${conversationProjection}
                 from conversations c join leads l
                   on l.organization_id = $1 and l.id = c.lead_id
                 ${participantJoin}
                where c.organization_id = $1 and c.id = $2 and ${scope.text}`,
          values,
        }));
        return result.rows[0] === undefined ? null : mapConversation(result.rows[0]);
      }),
    listConversations: ({ after, authorization, filter, limit }) =>
      withRuntime(runtime, authorization, async (session) => {
        const values: unknown[] = [authorization.organizationId];
        const conditions = ["c.organization_id = $1"];
        const scope = scopeSql(authorization, "l", values.length + 1);
        conditions.push(scope.text);
        if (scope.value !== undefined) values.push(scope.value);
        const add = (sql: string, value: unknown): void => {
          values.push(value);
          conditions.push(sql.replace("?", `$${values.length}`));
        };
        if (filter.status !== undefined) add("c.status = ?", filter.status);
        if (filter.channel_connection_id !== undefined)
          add("c.channel_connection_id = ?", filter.channel_connection_id);
        if (filter.assigned_membership_id !== undefined)
          add("h.assigned_membership_id = ?", filter.assigned_membership_id);
        if (after !== null) {
          values.push(after.lastActivityAt, after.id);
          conditions.push(
            `(c.last_activity_at, c.id) < ($${values.length - 1}::timestamptz, $${values.length}::uuid)`,
          );
        }
        values.push(limit + 1);
        const result = await executeTenantQuery<ConversationRow>(session, () => ({
          text: `select ${conversationProjection}
                 from conversations c join leads l
                   on l.organization_id = $1 and l.id = c.lead_id
                 left join handoffs h
                   on h.organization_id = $1 and h.id = c.active_handoff_id
                 ${participantJoin}
                where ${conditions.join(" and ")}
                order by c.last_activity_at desc, c.id desc limit $${values.length}`,
          values,
        }));
        const mapped = result.rows.map(mapConversation);
        const items = mapped.slice(0, limit);
        const last = items.at(-1);
        return {
          items,
          next:
            mapped.length > limit && last !== undefined
              ? { id: last.id, lastActivityAt: last.last_activity_at }
              : null,
        };
      }),
    listMessages: ({ after, authorization, conversationId, limit }) =>
      withRuntime(runtime, authorization, async (session) => {
        const scope = scopeSql(authorization, "l", 3);
        const authorizationValues: unknown[] = [authorization.organizationId, conversationId];
        if (scope.value !== undefined) authorizationValues.push(scope.value);
        const authorized = await executeTenantQuery<QueryResultRow & { allowed: boolean }>(
          session,
          () => ({
            text: `select true as allowed
                 from conversations c join leads l
                   on l.organization_id = $1 and l.id = c.lead_id
                where c.organization_id = $1 and c.id = $2 and ${scope.text}`,
            values: authorizationValues,
          }),
        );
        if (authorized.rows.length === 0) return null;
        const values: unknown[] = [authorization.organizationId, conversationId];
        const conditions = ["m.organization_id = $1", "m.conversation_id = $2"];
        if (after !== null) {
          values.push(after.sequenceNo, after.id);
          conditions.push(`(m.sequence_no, m.id) > ($3::bigint, $4::uuid)`);
        }
        values.push(limit + 1);
        const result = await executeTenantQuery<MessageRow>(session, () => ({
          text: `select m.id, m.conversation_id, m.channel_connection_id, m.direction,
                      m.sender_type, m.sender_membership_id, m.sequence_no, m.content_type,
                      m.body_ciphertext, m.locale, m.processing_status, m.delivery_status,
                      m.reply_to_message_id, m.redacted_at, m.created_at
                 from messages m where ${conditions.join(" and ")}
                order by m.sequence_no asc, m.id asc limit $${values.length}`,
          values,
        }));
        const mapped = result.rows.map(mapMessage);
        const items = mapped.slice(0, limit);
        const last = items.at(-1);
        return {
          items,
          next:
            mapped.length > limit && last !== undefined
              ? { id: last.id, sequenceNo: last.sequence_no }
              : null,
        };
      }),
  };
  return Object.freeze(store);
};
