import {
  EMPTY_SALES_EVIDENCE,
  resolveSalesEvidence,
  selectGroundingFacts,
  salesLocale,
  type AIContextSnapshot,
  type AIFact,
  type SalesContext,
  type SalesEvidence,
} from "@lead-agent/application";
import {
  LocationIdSchema,
  ServiceIdSchema,
  MessageIdSchema,
  isSchemaValue,
  type ConversationId,
  type Locale,
  type PublishedBusinessKnowledgeV2,
} from "@lead-agent/contracts";
import type { TenantDbSession } from "../runtime/tenant.js";
import { createConversationRepository } from "./conversations.js";
import { createLeadRepository } from "./leads.js";
import { executeTenantRead, executeTenantRootRead, mapEnum, mapUtcTimestamp } from "./shared.js";
import { readConversationPublishedKnowledge } from "./published-business-knowledge.js";

const storedEvidence = (value: unknown): SalesEvidence => {
  if (
    typeof value !== "object" ||
    value === null ||
    !("schema_version" in value) ||
    value.schema_version !== "s15.v1" ||
    !("evidence" in value)
  )
    return EMPTY_SALES_EVIDENCE;
  const fact = value.evidence;
  if (
    typeof fact !== "object" ||
    fact === null ||
    !("serviceId" in fact) ||
    !("locationId" in fact) ||
    !("positiveNextStep" in fact) ||
    !("serviceMessageId" in fact) ||
    !("locationMessageId" in fact) ||
    !("nextStepMessageId" in fact)
  )
    return EMPTY_SALES_EVIDENCE;
  if (
    (fact.serviceId !== null && !isSchemaValue(ServiceIdSchema, fact.serviceId)) ||
    (fact.locationId !== null && !isSchemaValue(LocationIdSchema, fact.locationId)) ||
    typeof fact.positiveNextStep !== "boolean" ||
    (fact.serviceMessageId !== null && !isSchemaValue(MessageIdSchema, fact.serviceMessageId)) ||
    (fact.locationMessageId !== null && !isSchemaValue(MessageIdSchema, fact.locationMessageId)) ||
    (fact.nextStepMessageId !== null && !isSchemaValue(MessageIdSchema, fact.nextStepMessageId))
  )
    return EMPTY_SALES_EVIDENCE;
  return {
    serviceId: fact.serviceId,
    locationId: fact.locationId,
    positiveNextStep: fact.positiveNextStep,
    serviceMessageId: fact.serviceMessageId,
    locationMessageId: fact.locationMessageId,
    nextStepMessageId: fact.nextStepMessageId,
  };
};

/** Uses the same effective, versioned S7 projection, not a parallel catalog query. */
export const readSalesContext = async (
  session: TenantDbSession,
  input: Readonly<{
    conversationId: ConversationId;
    locale: Locale;
    message: string;
    history: AIContextSnapshot["history"];
    sourceMessageId: AIContextSnapshot["sourceMessageId"];
    sourceSequence: number;
    conversationVersion: number;
    lock: boolean;
    now: Date;
  }>,
): Promise<
  Readonly<{
    sales: SalesContext;
    facts: readonly AIFact[];
    knowledge: PublishedBusinessKnowledgeV2 | null;
  }>
> => {
  const conversation = await createConversationRepository(session).getConversation(
    input.conversationId,
  );
  if (input.lock) {
    await executeTenantRead(
      session,
      `select id from leads where organization_id=$1 and id=$2 for update`,
      [conversation.leadId],
    );
    for (const table of ["services", "locations", "faqs", "business_policies"] as const) {
      const locked = await executeTenantRead(
        session,
        `select id from ${table} where organization_id=$1 and status=$2 order by id limit 501 for share`,
        [table === "services" || table === "locations" ? "active" : "published"],
      );
      // The shared projection returns a typed bounded-context failure; no
      // qualification facts are consumed from an oversized catalog.
      if (locked.length > 500) break;
    }
  }
  const lead = await createLeadRepository(session).getLead(conversation.leadId);
  const prior = await executeTenantRead(
    session,
    `select evaluation.facts_jsonb from lead_qualification_evaluations evaluation
    join lead_qualification_evidence evidence on evidence.organization_id=evaluation.organization_id and evidence.evaluation_id=evaluation.id and evidence.field_key='evaluation_source'
    join messages message on message.organization_id=evaluation.organization_id and message.id=evidence.message_id
    where evaluation.organization_id=$1 and evaluation.lead_id=$2 and evaluation.evaluated_by='system'
      and message.conversation_id=$3 and message.sender_type='customer' and message.sequence_no<$4
    order by message.sequence_no desc,evaluation.id desc limit 1`,
    [lead.leadId, input.conversationId, input.sourceSequence],
  );
  const saved = storedEvidence(prior[0]?.["facts_jsonb"]);
  const identities = await executeTenantRead(
    session,
    `select identity.id from contact_identities identity join channel_connections connection
      on connection.organization_id=identity.organization_id and connection.id=identity.channel_connection_id
    where identity.organization_id=$1 and identity.contact_id=$2 and identity.status='active' and identity.validation_status in ('valid','verified')
      and identity.channel_connection_id=$3 and connection.status='active'
      and ((connection.channel_type='telegram' and identity.identity_type='telegram_user') or (connection.channel_type='instagram' and identity.identity_type='instagram_user'))${input.lock ? " for share of identity,connection" : ""}`,
    [conversation.contactId, conversation.channelConnectionId],
  );
  const widget = await executeTenantRead(
    session,
    `select session.id from widget_sessions session
    join widget_allowed_origins origin on origin.organization_id=session.organization_id and origin.id=session.widget_allowed_origin_id and origin.channel_connection_id=session.channel_connection_id and origin.status='active'
    join channel_connections connection on connection.organization_id=session.organization_id and connection.id=session.channel_connection_id and connection.channel_type='widget' and connection.status='active'
    join contact_identities identity on identity.organization_id=session.organization_id and identity.contact_id=session.contact_id and identity.channel_connection_id=session.channel_connection_id and identity.lookup_hash=session.participant_lookup_hash and identity.identity_type='widget_participant' and identity.status='active' and identity.validation_status in ('valid','verified')
    where session.organization_id=$1 and session.contact_id=$2 and session.conversation_id=$3 and session.channel_connection_id=$4 and session.status='active' and session.revoked_at is null and session.issued_at<=$5 and session.expires_at>$5${input.lock ? " for share of session,identity,origin,connection" : ""}`,
    [conversation.contactId, input.conversationId, conversation.channelConnectionId, input.now],
  );
  const effectiveAt = mapUtcTimestamp(input.now),
    locale = salesLocale(input.message, input.locale);
  const projection = await readConversationPublishedKnowledge(session, {
    conversationId: input.conversationId,
    locale,
    effectiveAt,
    locationIds: null,
  });
  const knowledge = projection.ok ? projection.value : null;
  const policies = knowledge?.policies ?? [];
  // Never pick an arbitrary policy key. Reuse the Lead's explicit policy, otherwise require one applicable V1 policy.
  const selectedPolicy =
    lead.qualificationPolicyId === null
      ? policies.length === 1
        ? policies[0]
        : undefined
      : policies.find((policy) => policy.policy_id === lead.qualificationPolicyId);
  const services =
    knowledge?.services.map((service) => ({
      id: service.service_id,
      names: Object.values(service.name_i18n).filter((name): name is string => name !== undefined),
      locationIds: service.location_offerings.map((offering) => offering.location_id),
    })) ?? [];
  const locations =
    knowledge?.locations.map((location) => ({
      id: location.location_id,
      names: Object.values(location.name_i18n).filter((name): name is string => name !== undefined),
    })) ?? [];
  const sales: SalesContext = Object.freeze({
    leadId: lead.leadId,
    leadVersion: lead.version,
    leadStatus: lead.status,
    policy:
      selectedPolicy === undefined
        ? null
        : { id: selectedPolicy.policy_id, version: selectedPolicy.version_no },
    services,
    locations,
    stored: {
      ...saved,
      serviceId: saved.serviceId ?? lead.serviceId,
      locationId: saved.locationId ?? lead.locationId,
    },
    contactable: identities.length > 0 || widget.length > 0,
  });
  const evidence = resolveSalesEvidence({
    ...input,
    policy: {
      facts: [],
      appointments: [],
      automationMode: "ai",
      conversationStatus: "open",
      contactableWithoutPhone: sales.contactable,
      missingFields: [],
    },
    channelConnectionId: conversation.channelConnectionId,
    sales,
  });
  const organizations = await executeTenantRootRead(
    session,
    `select default_locale from organizations where id=$1 and status='active'`,
  );
  const defaultLocale = mapEnum(organizations[0]?.["default_locale"], ["uz", "ru", "en"] as const);
  const facts =
    knowledge === null
      ? []
      : selectGroundingFacts(knowledge, {
          message: input.message,
          locale,
          defaultLocale,
          serviceId: evidence.serviceId,
          locationId: evidence.locationId,
        });
  return Object.freeze({ sales, facts, knowledge });
};
