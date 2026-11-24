import { DomainEventSchemasByVersion, isSchemaValue } from "@lead-agent/contracts";
import { CUSTOMER_CONFIRMATION_PROFILE } from "@lead-agent/application";
import type { CustomerDataProtection } from "@lead-agent/security";
import type { TenantDbSession } from "../runtime/tenant.js";
import {
  executeTenantWrite,
  mapSafeBigInt,
  mapMessageId,
  RepositoryDataIntegrityError,
} from "./shared.js";
import type {
  ChannelConnectionId,
  ConversationId,
  CorrelationId,
  Locale,
  MembershipId,
  MessageId,
} from "@lead-agent/contracts";

export type CustomerReplyInput = Readonly<{
  conversationId: ConversationId;
  channelConnectionId: ChannelConnectionId;
  conversationVersion: number;
  text: string;
  locale: Locale;
  replyToMessageId: MessageId | null;
  aiRunId: string | null;
  correlationId: CorrelationId;
  causationId: string | null;
  requestId: string;
  manifest: Readonly<Record<string, unknown>>;
  updatePreferredLocale: boolean;
}>;
export type QueuedCustomerReply = Readonly<{
  messageId: MessageId;
  sequence: number;
  conversationVersion: number;
}>;
export type WithdrawnConfirmationPrompt = Readonly<{ kind: "withdrawn_confirmation_prompt" }>;

// Shared predicate for customer message projections using the messages alias m.
export const WITHDRAWN_CONFIRMATION_PROMPT_SQL = `exists (
  select 1 from appointment_requests ar
   where m.direction='outbound' and m.ai_run_id is null
     and m.knowledge_manifest_jsonb->>'confirmation_profile'='${CUSTOMER_CONFIRMATION_PROFILE}'
     and m.knowledge_manifest_jsonb->>'confirmation_kind'='prompt'
     and ar.organization_id=m.organization_id and ar.conversation_id=m.conversation_id
     and ar.id::text=m.knowledge_manifest_jsonb->>'confirmation_request_id'
     and ar.offer_version::text=m.knowledge_manifest_jsonb->>'confirmation_offer_version'
     and ar.status='cancelled' and ar.cancelled_by_type='member'
)`;
type QueuedCustomerMessage = Pick<
  CustomerReplyInput,
  "conversationId" | "channelConnectionId" | "text" | "locale" | "replyToMessageId" | "aiRunId"
> &
  Readonly<{
    messageId: MessageId;
    sequence: number;
    senderMembershipId: MembershipId | null;
    manifest: CustomerReplyInput["manifest"] | null;
  }>;

export const insertQueuedCustomerMessage = async (
  session: TenantDbSession,
  input: QueuedCustomerMessage,
  protection: CustomerDataProtection,
  occurredAt: Date,
): Promise<void> => {
  const body = protection.protectMessageBody({
    organizationId: session.organizationId,
    channelConnectionId: input.channelConnectionId,
    contentType: "text",
    content: { type: "text", text: input.text, locale_hint: input.locale },
  });
  await executeTenantWrite(
    session,
    `insert into messages (organization_id,id,conversation_id,channel_connection_id,direction,sender_type,
      sender_membership_id,sequence_no,content_type,body_ciphertext,body_hash,locale,processing_status,delivery_status,
      reply_to_message_id,ai_run_id,knowledge_manifest_jsonb,created_at)
      values ($1,$2,$3,$4,'outbound',$5,$6,$7,'text',$8,$9,$10,'processed','queued',$11,$12,$13::jsonb,$14)`,
    [
      input.messageId,
      input.conversationId,
      input.channelConnectionId,
      input.senderMembershipId === null ? "system" : "member",
      input.senderMembershipId,
      input.sequence,
      body.ciphertext,
      body.hash,
      input.locale,
      input.replyToMessageId,
      input.aiRunId,
      input.manifest === null ? null : JSON.stringify(input.manifest),
      occurredAt,
    ],
  );
};
/** Shared encrypted customer delivery intent, always inside the caller's tenant transaction. */
export const queueCustomerReply = async (
  session: TenantDbSession,
  input: CustomerReplyInput,
  protection: CustomerDataProtection,
  nextId: () => string,
  occurredAt: Date,
): Promise<QueuedCustomerReply> => {
  if (Buffer.byteLength(input.text, "utf8") > 1_000) throw new RepositoryDataIntegrityError();
  const messageId = mapMessageId(nextId());
  const sequences = await executeTenantWrite(
    session,
    `update conversations set next_sequence_no=next_sequence_no+1,version=version+1,
      last_activity_at=greatest(last_activity_at,$4),updated_at=greatest(updated_at,$4)${input.updatePreferredLocale ? ",preferred_locale=$5" : ""}
      where organization_id=$1 and id=$2 and version=$3 returning next_sequence_no-1 as sequence_no`,
    [
      input.conversationId,
      input.conversationVersion,
      occurredAt,
      ...(input.updatePreferredLocale ? [input.locale] : []),
    ],
  );
  if (sequences.rowCount !== 1 || sequences.rows.length !== 1)
    throw new RepositoryDataIntegrityError();
  const sequence = mapSafeBigInt(sequences.rows[0]?.["sequence_no"]);
  await insertQueuedCustomerMessage(
    session,
    { ...input, messageId, sequence, senderMembershipId: null },
    protection,
    occurredAt,
  );
  const schema = DomainEventSchemasByVersion["message.response_queued"]["1"];
  const schemaId: unknown = Reflect.get(schema, "$id");
  const event: unknown = {
    actor: { actor_type: "system", actor_id: null },
    aggregate_id: input.conversationId,
    aggregate_type: "conversation",
    aggregate_version: input.conversationVersion + 1,
    causation_id: input.causationId,
    correlation_id: input.correlationId,
    event_id: nextId(),
    event_type: "message.response_queued",
    occurred_at: occurredAt.toISOString(),
    organization_id: session.organizationId,
    payload: { message_direction: "outbound", message_id: messageId, message_status: "queued" },
    request_id: null,
    schema_id: schemaId,
    schema_version: "1",
  };
  if (!isSchemaValue(schema, event)) throw new RepositoryDataIntegrityError();
  await executeTenantWrite(
    session,
    `insert into audit_events (organization_id,id,event_type,actor_type,actor_id,target_type,target_id,
      action,result,request_id,correlation_id,metadata_redacted_jsonb,occurred_at)
      values ($1,$2,'message.response_queued','system',null,'conversation',$3,'message.response_queued',
      'succeeded',$4,$5,'{}'::jsonb,$6)`,
    [nextId(), input.conversationId, input.requestId, input.correlationId, occurredAt],
  );
  await executeTenantWrite(
    session,
    `insert into outbox_events (organization_id,id,event_type,schema_version,aggregate_type,aggregate_id,
      aggregate_version,payload_jsonb,correlation_id,causation_id,occurred_at,status,available_at)
      values ($1,$2,'message.response_queued','1','conversation',$3,$4,$5::jsonb,$6,$7,$8,'pending',$8)`,
    [
      event.event_id,
      input.conversationId,
      input.conversationVersion + 1,
      JSON.stringify(event),
      input.correlationId,
      input.causationId,
      occurredAt,
    ],
  );
  return { messageId, sequence, conversationVersion: input.conversationVersion + 1 };
};
