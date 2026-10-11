import { S22_WIDGET_REPLACEMENT, S22_WIDGET_SELECTION_ENVELOPE } from "@lead-agent/config";
import { isSchemaValue, ResourceIdSchema } from "@lead-agent/contracts";
import type { TenantDbSession } from "../runtime/tenant.js";
import { executeTenantRead } from "./shared.js";

/** Metadata only; no ownership code, hash, bearer or customer text is returned.
 * Called under the original cohort mutex. Locks the retired identity/business
 * rows so selection cannot race recovery/intake or a staff request transition. */
export const readS22WidgetRetirement = async (session: TenantDbSession, at: Date) => {
  const scope = S22_WIDGET_REPLACEMENT;
  const rows = await executeTenantRead(
    session,
    `select /* s22_retired_widget */ ws.contact_id::text,
      ws.status='active' and ws.revoked_at is null
        and ws.recovery_token_hash is null and ws.access_expires_at is null
        and ws.expires_at<=$8 as retired,
      cv.contact_id=ws.contact_id and cv.channel_connection_id=ws.channel_connection_id
        and ar.contact_id=ws.contact_id and ar.lead_id=cv.lead_id
        and ar.source_message_id=$7 as owns_conversation,
      ar.status='requested' and ar.version=1 and ar.offer_version=0 as request_unchanged,
      (select count(*) from (select id from messages where organization_id=$1
        and conversation_id=$3 and direction='inbound' limit 2) m)=1 as one_inbound,
      exists(select 1 from messages where organization_id=$1 and id=$7
        and conversation_id=$3 and channel_connection_id=$4 and direction='inbound'
        and sender_type='customer' and sender_contact_id=ws.contact_id) as message_matches
     from widget_sessions ws
     join conversations cv on cv.organization_id=$1 and cv.id=ws.conversation_id
     join appointment_requests ar on ar.organization_id=$1 and ar.id=$6 and ar.conversation_id=cv.id
     where ws.organization_id=$1 and ws.id=$2 and ws.conversation_id=$3
       and ws.channel_connection_id=$4 and ws.widget_allowed_origin_id=$5
     limit 2 for update of ws,cv,ar`,
    [
      scope.retiredSessionId,
      scope.retiredConversationId,
      S22_WIDGET_SELECTION_ENVELOPE.channelConnectionId,
      S22_WIDGET_SELECTION_ENVELOPE.allowedOriginId,
      scope.retiredRequestId,
      scope.retiredMessageId,
      at,
    ],
  );
  const row = rows[0];
  if (
    rows.length !== 1 ||
    !isSchemaValue(ResourceIdSchema, row?.["contact_id"]) ||
    !["retired", "owns_conversation", "request_unchanged", "one_inbound", "message_matches"].every(
      (key) => row?.[key] === true,
    )
  )
    return null;
  return {
    conversationId: scope.retiredConversationId,
    contactId: row["contact_id"],
    inboundMessageIds: [scope.retiredMessageId],
  };
};
