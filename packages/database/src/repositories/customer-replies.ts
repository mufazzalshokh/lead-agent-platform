import { DomainEventSchemasByVersion, isSchemaValue } from "@lead-agent/contracts";
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
  const body = protection.protectMessageBody({
    organizationId: session.organizationId,
    channelConnectionId: input.channelConnectionId,
    contentType: "text",
    content: { type: "text", text: input.text, locale_hint: input.locale },
  });
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
  await executeTenantWrite(
    session,
    `insert into messages (organization_id,id,conversation_id,channel_connection_id,direction,sender_type,
      sequence_no,content_type,body_ciphertext,body_hash,locale,processing_status,delivery_status,
      reply_to_message_id,ai_run_id,knowledge_manifest_jsonb,created_at)
      values ($1,$2,$3,$4,'outbound','system',$5,'text',$6,$7,$8,'processed','queued',$9,$10,$11::jsonb,$12)`,
    [
      messageId,
      input.conversationId,
      input.channelConnectionId,
      sequence,
      body.ciphertext,
      body.hash,
      input.locale,
      input.replyToMessageId,
      input.aiRunId,
      JSON.stringify(input.manifest),
      occurredAt,
    ],
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
