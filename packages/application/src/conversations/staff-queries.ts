import { createHmac, timingSafeEqual } from "node:crypto";

import {
  OpaqueCursorSchema,
  StaffContactReadParamsSchema,
  StaffContactSchema,
  StaffConversationListQuerySchema,
  StaffConversationReadParamsSchema,
  StaffLeadListQuerySchema,
  StaffLeadReadParamsSchema,
  StaffMessageListQuerySchema,
  StaffMessageSchema,
  UtcTimestampSchema,
  isSchemaValue,
  type ChannelConnectionId,
  type ContactId,
  type ConversationId,
  type LeadId,
  type Locale,
  type MembershipId,
  type MessageId,
  type OpaqueCursor,
  type StaffContact,
  type StaffContactIdentity,
  type StaffContactIdentityType,
  type StaffConversation,
  type StaffConversationListQuery,
  type StaffContactReadParams,
  type StaffLead,
  type StaffLeadListQuery,
  type StaffLeadReadParams,
  type StaffMessage,
  type StaffMessageDeliveryStatus,
  type StaffMessageDirection,
  type StaffMessageListQuery,
  type StaffMessageProcessingStatus,
  type StaffMessageSenderType,
  type UtcTimestamp,
} from "@lead-agent/contracts";
import {
  hasPermission,
  isAuthorizationContext,
  type AuthorizationContext,
  type MembershipRole,
  type TenantPermission,
} from "@lead-agent/security";

export type StaffQueryFailureCode =
  "internal_error" | "permission_denied" | "resource_not_found" | "validation_failed";
export type StaffQueryResult<Value> =
  | Readonly<{ ok: true; value: Value }>
  | Readonly<{ error: Readonly<{ code: StaffQueryFailureCode }>; ok: false }>;

export type StaffQueryPage<Value> = Readonly<{
  items: readonly Value[];
  nextCursor: OpaqueCursor | null;
}>;

type Replace<Value, Keys extends keyof Value, Fields> = Value extends unknown
  ? Omit<Value, Keys> & Fields
  : never;

export type StoredContactIdentity = Replace<
  StaffContactIdentity,
  "value",
  Readonly<{ valueCiphertext: Uint8Array | null }>
>;
export type StoredContact = Replace<
  StaffContact,
  "display_name" | "identities" | "sensitive_fields_visible",
  Readonly<{
    displayNameCiphertext: Uint8Array | null;
    identities: readonly StoredContactIdentity[];
  }>
>;
export type StoredMessage = Readonly<{
  bodyCiphertext: Uint8Array | null;
  channel_connection_id: ChannelConnectionId;
  content_type: string;
  conversation_id: ConversationId;
  created_at: UtcTimestamp;
  delivery_status: StaffMessageDeliveryStatus;
  direction: StaffMessageDirection;
  id: MessageId;
  locale: Locale | null;
  processing_status: StaffMessageProcessingStatus;
  redacted_at: UtcTimestamp | null;
  reply_to_message_id: MessageId | null;
  sender_membership_id: MembershipId | null;
  sender_type: StaffMessageSenderType;
  sequence_no: number;
}>;

export type LeadPagePosition = Readonly<{ createdAt: StaffLead["created_at"]; id: LeadId }>;
export type ConversationPagePosition = Readonly<{
  id: ConversationId;
  lastActivityAt: StaffConversation["last_activity_at"];
}>;
export type MessagePagePosition = Readonly<{ id: string; sequenceNo: number }>;

export interface StaffConversationQueryStore {
  getContact(
    input: Readonly<{ authorization: AuthorizationContext; contactId: ContactId }>,
  ): Promise<StoredContact | null>;
  getLead(
    input: Readonly<{ authorization: AuthorizationContext; leadId: LeadId }>,
  ): Promise<StaffLead | null>;
  listLeads(
    input: Readonly<{
      after: LeadPagePosition | null;
      authorization: AuthorizationContext;
      filter: Omit<StaffLeadListQuery, "cursor" | "limit">;
      limit: number;
    }>,
  ): Promise<Readonly<{ items: readonly StaffLead[]; next: LeadPagePosition | null }>>;
  getConversation(
    input: Readonly<{ authorization: AuthorizationContext; conversationId: ConversationId }>,
  ): Promise<StaffConversation | null>;
  listConversations(
    input: Readonly<{
      after: ConversationPagePosition | null;
      authorization: AuthorizationContext;
      filter: Omit<StaffConversationListQuery, "cursor" | "limit">;
      limit: number;
    }>,
  ): Promise<
    Readonly<{ items: readonly StaffConversation[]; next: ConversationPagePosition | null }>
  >;
  listMessages(
    input: Readonly<{
      after: MessagePagePosition | null;
      authorization: AuthorizationContext;
      conversationId: ConversationId;
      limit: number;
    }>,
  ): Promise<Readonly<{
    items: readonly StoredMessage[];
    next: MessagePagePosition | null;
  }> | null>;
}

export interface StaffCustomerDataRevealer {
  revealContactDisplayName(
    input: Readonly<{
      ciphertext: Uint8Array;
      organizationId: AuthorizationContext["organizationId"];
    }>,
  ): string;
  revealContactIdentity(
    input: Readonly<{
      channelConnectionId: ChannelConnectionId | null;
      ciphertext: Uint8Array;
      identityType: StaffContactIdentityType;
      organizationId: AuthorizationContext["organizationId"];
    }>,
  ): string;
  revealMessageBody(
    input: Readonly<{
      channelConnectionId: ChannelConnectionId;
      ciphertext: Uint8Array;
      contentType: "attachment" | "quick_reply" | "text";
      organizationId: AuthorizationContext["organizationId"];
    }>,
  ): string | null;
}

type CursorRoute = "conversations" | "leads" | "messages";
type CursorPayload = Readonly<{
  binding: string;
  position: Readonly<Record<string, string | number>>;
  route: CursorRoute;
  version: 1;
}>;

export interface StaffQueryCursorCodec {
  decode(
    cursor: OpaqueCursor,
    route: CursorRoute,
    binding: string,
  ): Readonly<Record<string, string | number>> | null;
  encode(
    route: CursorRoute,
    binding: string,
    position: Readonly<Record<string, string | number>>,
  ): OpaqueCursor;
}

const stableJson = (value: unknown): string => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${Object.entries(value as Readonly<Record<string, unknown>>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
    .join(",")}}`;
};

export const createStaffQueryCursorCodec = (key: Uint8Array): StaffQueryCursorCodec => {
  if (key.byteLength < 32) throw new TypeError("Staff query cursor key is invalid");
  const sign = (body: Uint8Array): Buffer => createHmac("sha256", key).update(body).digest();
  const codec: StaffQueryCursorCodec = {
    decode: (cursor, route, binding) => {
      if (!isSchemaValue(OpaqueCursorSchema, cursor)) return null;
      const packed = Buffer.from(cursor, "base64url");
      if (packed.toString("base64url") !== cursor || packed.byteLength <= 32) return null;
      const body = packed.subarray(0, -32);
      const signature = packed.subarray(-32);
      if (!timingSafeEqual(sign(body), signature)) return null;
      try {
        const value = JSON.parse(body.toString("utf8")) as unknown;
        if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
        const payload = value as Partial<CursorPayload>;
        if (
          payload.version !== 1 ||
          payload.route !== route ||
          payload.binding !== binding ||
          typeof payload.position !== "object" ||
          payload.position === null ||
          Array.isArray(payload.position)
        )
          return null;
        return payload.position;
      } catch {
        return null;
      }
    },
    encode: (route, binding, position) => {
      const body = Buffer.from(stableJson({ binding, position, route, version: 1 }), "utf8");
      const cursor = Buffer.concat([body, sign(body)]).toString("base64url");
      if (!isSchemaValue(OpaqueCursorSchema, cursor))
        throw new TypeError("Staff query cursor exceeds bounds");
      return cursor;
    },
  };
  return Object.freeze(codec);
};

export interface StaffConversationQueryUseCases {
  getContact(
    query: Readonly<{ authorization: AuthorizationContext; input: StaffContactReadParams }>,
  ): Promise<StaffQueryResult<StaffContact>>;
  getLead(
    query: Readonly<{ authorization: AuthorizationContext; input: StaffLeadReadParams }>,
  ): Promise<StaffQueryResult<StaffLead>>;
  listLeads(
    query: Readonly<{ authorization: AuthorizationContext; input: StaffLeadListQuery }>,
  ): Promise<StaffQueryResult<StaffQueryPage<StaffLead>>>;
  getConversation(
    query: Readonly<{
      authorization: AuthorizationContext;
      input: Readonly<{ id: ConversationId }>;
    }>,
  ): Promise<StaffQueryResult<StaffConversation>>;
  listConversations(
    query: Readonly<{ authorization: AuthorizationContext; input: StaffConversationListQuery }>,
  ): Promise<StaffQueryResult<StaffQueryPage<StaffConversation>>>;
  listMessages(
    query: Readonly<{
      authorization: AuthorizationContext;
      conversationId: ConversationId;
      input: StaffMessageListQuery;
    }>,
  ): Promise<StaffQueryResult<StaffQueryPage<StaffMessage>>>;
}

const failure = <Value>(code: StaffQueryFailureCode): StaffQueryResult<Value> =>
  Object.freeze({ error: Object.freeze({ code }), ok: false });
const success = <Value>(value: Value): StaffQueryResult<Value> =>
  Object.freeze({ ok: true, value });
export type StaffQueryPermissionEvaluator = (
  role: MembershipRole,
  permission: TenantPermission,
) => boolean;

const validAuthorization = (
  authorization: unknown,
  permission: "contacts.read" | "conversations.read" | "leads.read",
  evaluatePermission: StaffQueryPermissionEvaluator,
): authorization is AuthorizationContext =>
  isAuthorizationContext(authorization) && evaluatePermission(authorization.role, permission);
const scopeBinding = (authorization: AuthorizationContext): string =>
  stableJson({
    allowedLocationIds: [...authorization.allowedLocationIds].sort(),
    locationScope: authorization.locationScope,
    membershipId: authorization.membershipId,
    organizationId: authorization.organizationId,
    userId: authorization.userId,
  });
const filterBinding = (authorization: AuthorizationContext, filter: unknown): string =>
  stableJson({ filter, scope: scopeBinding(authorization) });

const leadPosition = (
  value: Readonly<Record<string, string | number>> | null,
): LeadPagePosition | null => {
  if (
    value === null ||
    !isSchemaValue(StaffLeadReadParamsSchema, { id: value["id"] }) ||
    !isSchemaValue(UtcTimestampSchema, value["createdAt"])
  )
    return null;
  return { createdAt: value["createdAt"], id: value["id"] as LeadId };
};
const conversationPosition = (
  value: Readonly<Record<string, string | number>> | null,
): ConversationPagePosition | null => {
  if (
    value === null ||
    !isSchemaValue(StaffConversationReadParamsSchema, { id: value["id"] }) ||
    !isSchemaValue(UtcTimestampSchema, value["lastActivityAt"])
  )
    return null;
  return {
    id: value["id"] as ConversationId,
    lastActivityAt: value["lastActivityAt"],
  };
};
const messagePosition = (
  value: Readonly<Record<string, string | number>> | null,
): MessagePagePosition | null => {
  if (
    value === null ||
    typeof value["id"] !== "string" ||
    !Number.isSafeInteger(value["sequenceNo"]) ||
    Number(value["sequenceNo"]) < 1
  )
    return null;
  return { id: value["id"], sequenceNo: Number(value["sequenceNo"]) };
};

const supportedContentType = (value: string): value is "attachment" | "quick_reply" | "text" =>
  value === "attachment" || value === "quick_reply" || value === "text";

export const createStaffConversationQueryUseCases = (
  store: StaffConversationQueryStore,
  revealer: StaffCustomerDataRevealer,
  cursors: StaffQueryCursorCodec,
  evaluatePermission: StaffQueryPermissionEvaluator = hasPermission,
): StaffConversationQueryUseCases => {
  const useCases: StaffConversationQueryUseCases = {
    getContact: async ({ authorization, input }) => {
      if (!validAuthorization(authorization, "contacts.read", evaluatePermission))
        return failure("permission_denied");
      if (!isSchemaValue(StaffContactReadParamsSchema, input)) return failure("validation_failed");
      const stored = await store.getContact({ authorization, contactId: input.id });
      if (stored === null) return failure("resource_not_found");
      const sensitive = evaluatePermission(authorization.role, "contacts.read_sensitive");
      try {
        const { displayNameCiphertext, identities, ...contactFields } = stored;
        const contact: StaffContact = {
          ...contactFields,
          display_name:
            sensitive && stored.status !== "anonymized" && displayNameCiphertext !== null
              ? revealer.revealContactDisplayName({
                  ciphertext: displayNameCiphertext,
                  organizationId: authorization.organizationId,
                })
              : null,
          identities: identities.map(({ valueCiphertext, ...identity }) => ({
            ...identity,
            value:
              sensitive &&
              stored.status !== "anonymized" &&
              identity.status !== "anonymized" &&
              valueCiphertext !== null
                ? revealer.revealContactIdentity({
                    channelConnectionId: identity.channel_connection_id,
                    ciphertext: valueCiphertext,
                    identityType: identity.identity_type,
                    organizationId: authorization.organizationId,
                  })
                : null,
          })),
          sensitive_fields_visible: sensitive,
        };
        return isSchemaValue(StaffContactSchema, contact)
          ? success(contact)
          : failure("internal_error");
      } catch {
        return failure("internal_error");
      }
    },
    getLead: async ({ authorization, input }) => {
      if (!validAuthorization(authorization, "leads.read", evaluatePermission))
        return failure("permission_denied");
      if (!isSchemaValue(StaffLeadReadParamsSchema, input)) return failure("validation_failed");
      const value = await store.getLead({ authorization, leadId: input.id });
      return value === null ? failure("resource_not_found") : success(value);
    },
    listLeads: async ({ authorization, input }) => {
      if (!validAuthorization(authorization, "leads.read", evaluatePermission))
        return failure("permission_denied");
      if (!isSchemaValue(StaffLeadListQuerySchema, input)) return failure("validation_failed");
      const { cursor, limit = 50, ...filter } = input;
      const binding = filterBinding(authorization, filter);
      const decoded =
        cursor === undefined || !isSchemaValue(OpaqueCursorSchema, cursor)
          ? null
          : leadPosition(cursors.decode(cursor, "leads", binding));
      if (cursor !== undefined && decoded === null) return failure("validation_failed");
      const page = await store.listLeads({ after: decoded, authorization, filter, limit });
      return success({
        items: page.items,
        nextCursor:
          page.next === null
            ? null
            : cursors.encode("leads", binding, {
                createdAt: page.next.createdAt,
                id: page.next.id,
              }),
      });
    },
    getConversation: async ({ authorization, input }) => {
      if (!validAuthorization(authorization, "conversations.read", evaluatePermission))
        return failure("permission_denied");
      if (!isSchemaValue(StaffConversationReadParamsSchema, input))
        return failure("validation_failed");
      const value = await store.getConversation({ authorization, conversationId: input.id });
      return value === null ? failure("resource_not_found") : success(value);
    },
    listConversations: async ({ authorization, input }) => {
      if (!validAuthorization(authorization, "conversations.read", evaluatePermission))
        return failure("permission_denied");
      if (!isSchemaValue(StaffConversationListQuerySchema, input))
        return failure("validation_failed");
      const { cursor, limit = 50, ...filter } = input;
      const binding = filterBinding(authorization, filter);
      const decoded =
        cursor === undefined || !isSchemaValue(OpaqueCursorSchema, cursor)
          ? null
          : conversationPosition(cursors.decode(cursor, "conversations", binding));
      if (cursor !== undefined && decoded === null) return failure("validation_failed");
      const page = await store.listConversations({ after: decoded, authorization, filter, limit });
      return success({
        items: page.items,
        nextCursor:
          page.next === null
            ? null
            : cursors.encode("conversations", binding, {
                id: page.next.id,
                lastActivityAt: page.next.lastActivityAt,
              }),
      });
    },
    listMessages: async ({ authorization, conversationId, input }) => {
      if (!validAuthorization(authorization, "conversations.read", evaluatePermission))
        return failure("permission_denied");
      if (
        !isSchemaValue(StaffConversationReadParamsSchema, { id: conversationId }) ||
        !isSchemaValue(StaffMessageListQuerySchema, input)
      )
        return failure("validation_failed");
      const { cursor, limit = 50 } = input;
      const binding = filterBinding(authorization, { conversationId });
      const decoded =
        cursor === undefined || !isSchemaValue(OpaqueCursorSchema, cursor)
          ? null
          : messagePosition(cursors.decode(cursor, "messages", binding));
      if (cursor !== undefined && decoded === null) return failure("validation_failed");
      const page = await store.listMessages({
        after: decoded,
        authorization,
        conversationId,
        limit,
      });
      if (page === null) return failure("resource_not_found");
      try {
        const items = page.items.map((stored): StaffMessage => {
          const body_text =
            stored.redacted_at !== null || stored.bodyCiphertext === null
              ? null
              : supportedContentType(stored.content_type)
                ? revealer.revealMessageBody({
                    channelConnectionId: stored.channel_connection_id,
                    ciphertext: stored.bodyCiphertext,
                    contentType: stored.content_type,
                    organizationId: authorization.organizationId,
                  })
                : (() => {
                    throw new TypeError("Unsupported protected message content type");
                  })();
          return {
            body_text,
            channel_connection_id: stored.channel_connection_id,
            content_type: stored.content_type,
            conversation_id: stored.conversation_id,
            created_at: stored.created_at,
            delivery_status: stored.delivery_status,
            direction: stored.direction,
            id: stored.id,
            locale: stored.locale,
            processing_status: stored.processing_status,
            redacted_at: stored.redacted_at,
            reply_to_message_id: stored.reply_to_message_id,
            sender_membership_id: stored.sender_membership_id,
            sender_type: stored.sender_type,
            sequence_no: stored.sequence_no,
          } as StaffMessage;
        });
        if (!items.every((item) => isSchemaValue(StaffMessageSchema, item)))
          return failure("internal_error");
        return success({
          items,
          nextCursor:
            page.next === null
              ? null
              : cursors.encode("messages", binding, {
                  id: page.next.id,
                  sequenceNo: page.next.sequenceNo,
                }),
        });
      } catch {
        return failure("internal_error");
      }
    },
  };
  return Object.freeze(useCases);
};
