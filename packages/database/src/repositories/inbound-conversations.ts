import type {
  CanonicalInboundFailureCode,
  CanonicalInboundPersistenceStore,
  CanonicalInboundReceipt,
  CanonicalInboundResult,
  PreparedCanonicalInbound,
} from "@lead-agent/application";
import {
  ActorRefSchema,
  ContactIdSchema,
  ConversationIdSchema,
  CorrelationIdSchema,
  DomainEventSchemasByVersion,
  EventIdSchema,
  LeadIdSchema,
  MessageIdSchema,
  RequestIdSchema,
  ResourceIdSchema,
  UtcTimestampSchema,
  isSchemaValue,
  type ActorRef,
  type ContactId,
  type ConversationId,
  type CorrelationId,
  type DomainEvent,
  type EventId,
  type LeadId,
  type MessageId,
  type RequestId,
  type ResourceId,
  type UtcTimestamp,
} from "@lead-agent/contracts";
import {
  acceptCustomerMessage,
  createConversation,
  createLead,
  isActiveConversationHandoffStatus,
  recordEngagement,
  type Conversation,
  type ConversationEventDraft,
  type ConversationTransitionRecord,
  type Lead,
  type LeadEventDraft,
  type LeadTransitionRecord,
  type Transition,
} from "@lead-agent/domain";
import {
  createSecurityIdentifierFactory,
  type SecurityIdentifierFactory,
} from "@lead-agent/security";
import type { QueryResultRow } from "pg";

import type { TenantDatabaseRuntime, TenantDbSession } from "../runtime/tenant.js";
import { createConfigurationRepository } from "./configuration.js";
import { createConversationRepository, type ConversationRecord } from "./conversations.js";
import { createCustomerRepository, type ContactRecord } from "./customers.js";
import { createHandoffNotificationRepository } from "./handoffs.js";
import { createLeadRepository, type LeadRecord } from "./leads.js";
import {
  persistDomainMutationPlan,
  type CoreAggregateMutation,
  type CoreDomainEvent,
  type CoreDomainEventDraft,
  type CoreTransitionPersistence,
  type DomainEventAppend,
  type DomainMutationPlan,
  type NonEmptyReadonlyArray,
  type TenantMutationAudit,
} from "./mutations.js";
import {
  RepositoryDataIntegrityError,
  RepositoryDatabaseError,
  RepositoryNotFoundError,
  RepositoryOwnershipValidationError,
  RepositoryStructuralConflictError,
  RepositoryVersionConflictError,
  executeTenantRead,
  executeTenantRootRead,
  executeTenantWrite,
  mapContactId,
  mapConversationId,
  mapEnum,
  mapLeadId,
  mapMessageId,
  mapSafeBigInt,
} from "./shared.js";

const MESSAGE_PROCESSING_STATUSES = [
  "accepted",
  "processing",
  "processed",
  "failed",
  "suppressed",
] as const;

type EventContext = Readonly<{
  actor: Exclude<ActorRef, { actor_type: "platform_operator" }>;
  correlationId: CorrelationId;
  occurredAt: UtcTimestamp;
  requestId: RequestId;
}>;

type DuplicateRow = QueryResultRow & {
  contact_id: unknown;
  conversation_id: unknown;
  lead_id: unknown;
  message_id: unknown;
  processing_status: unknown;
  sequence_no: unknown;
};

type PersistedContact = Readonly<{
  contact: ContactRecord | null;
  contactId: ContactId;
  contactWasCreated: boolean;
  identityId: ResourceId;
  preferredLocale: "en" | "ru" | "uz" | null;
}>;

type AggregateWork = Readonly<{
  mutation: CoreAggregateMutation;
  transitions: readonly CoreTransitionPersistence[];
  typedDrafts: readonly Readonly<{
    aggregateId: string;
    aggregateType: CoreDomainEvent["aggregate_type"];
    draft: CoreDomainEventDraft;
  }>[];
}>;

const failure = (code: CanonicalInboundFailureCode): CanonicalInboundResult =>
  Object.freeze({ error: Object.freeze({ code }), ok: false });

const requireNonEmpty = <Value>(values: readonly Value[]): NonEmptyReadonlyArray<Value> => {
  const first = values[0];
  if (first === undefined) throw new RepositoryDataIntegrityError();
  return Object.freeze([first, ...values.slice(1)]);
};

const issueIdentifier = <Value>(
  schema: Parameters<typeof isSchemaValue>[0],
  identifiers: SecurityIdentifierFactory,
  now: Date,
): Value => {
  const value = identifiers.issueResourceId(now);
  if (!isSchemaValue(schema, value)) throw new RepositoryDataIntegrityError();
  return value as Value;
};

const eventSchemaFor = (
  eventType: string,
  schemaVersion: string,
): Parameters<typeof isSchemaValue>[0] | undefined => {
  const versions: unknown = Reflect.get(DomainEventSchemasByVersion, eventType);
  if (typeof versions !== "object" || versions === null) return undefined;
  const schema: unknown = Reflect.get(versions, schemaVersion);
  return typeof schema === "object" && schema !== null ? schema : undefined;
};

const materializeCoreEvent = (
  draft: CoreDomainEventDraft,
  aggregateType: CoreDomainEvent["aggregate_type"],
  aggregateId: string,
  context: EventContext,
  organizationId: PreparedCanonicalInbound["organizationId"],
  eventId: EventId,
): DomainEventAppend => {
  const candidate = Object.freeze({
    actor: context.actor,
    aggregate_id: aggregateId,
    aggregate_type: aggregateType,
    aggregate_version: draft.aggregate_version,
    causation_id: null,
    correlation_id: context.correlationId,
    event_id: eventId,
    event_type: draft.event_type,
    occurred_at: context.occurredAt,
    organization_id: organizationId,
    payload: draft.payload,
    request_id: context.requestId,
    schema_id: draft.schema_id,
    schema_version: draft.schema_version,
  });
  const schema = eventSchemaFor(candidate.event_type, candidate.schema_version);
  if (schema === undefined || !isSchemaValue(schema, candidate)) {
    throw new RepositoryDataIntegrityError();
  }
  return Object.freeze({ draft, envelope: candidate as CoreDomainEvent });
};

const materializeContactEvent = (
  eventType:
    | "consent.declined"
    | "consent.granted"
    | "consent.not_required_recorded"
    | "consent.withdrawn"
    | "contact.created"
    | "contact.identity_added",
  aggregateVersion: number,
  payload: Readonly<Record<string, unknown>>,
  contactId: ContactId,
  context: EventContext,
  organizationId: PreparedCanonicalInbound["organizationId"],
  eventId: EventId,
): DomainEvent => {
  const schema = eventSchemaFor(eventType, "1");
  if (schema === undefined) throw new RepositoryDataIntegrityError();
  const schemaId: unknown = Reflect.get(schema, "$id");
  const candidate = Object.freeze({
    actor: context.actor,
    aggregate_id: contactId,
    aggregate_type: "contact",
    aggregate_version: aggregateVersion,
    causation_id: null,
    correlation_id: context.correlationId,
    event_id: eventId,
    event_type: eventType,
    occurred_at: context.occurredAt,
    organization_id: organizationId,
    payload,
    request_id: context.requestId,
    schema_id: schemaId,
    schema_version: "1",
  });
  if (!isSchemaValue(schema, candidate)) throw new RepositoryDataIntegrityError();
  return candidate as DomainEvent;
};

const acquireLocks = async (session: TenantDbSession, keys: readonly string[]): Promise<void> => {
  for (const key of [...new Set(keys)].sort()) {
    const rows = await executeTenantRootRead<QueryResultRow>(
      session,
      `select pg_catalog.pg_advisory_xact_lock(
                pg_catalog.hashtextextended($1::text || ':' || $2, 0)
              ) as acquired
         from organizations
        where id = $1::uuid`,
      [key],
    );
    if (rows.length !== 1) throw new RepositoryNotFoundError("organization");
  }
};

const duplicateReceipt = async (
  session: TenantDbSession,
  input: PreparedCanonicalInbound,
): Promise<CanonicalInboundReceipt | null> => {
  const rows = await executeTenantRead<DuplicateRow>(
    session,
    `select m.id as message_id, m.conversation_id, m.sequence_no,
            m.processing_status, c.contact_id, c.lead_id
       from messages m
       join conversations c
         on c.organization_id = m.organization_id
        and c.id = m.conversation_id
      where m.organization_id = $1
        and m.channel_connection_id = $2
        and (m.external_event_id = $3
          or ($4::text is not null and m.external_message_id = $4))
      order by m.id
      limit 2`,
    [
      input.event.channel_connection_id,
      input.event.event_id,
      input.event.external_message_id ?? null,
    ],
  );
  if (rows.length === 0) return null;
  if (rows.length !== 1) throw new RepositoryDataIntegrityError();
  const row = rows[0];
  if (row === undefined) throw new RepositoryDataIntegrityError();
  return Object.freeze({
    contactId: mapContactId(row.contact_id),
    contactWasCreated: false,
    conversationId: mapConversationId(row.conversation_id),
    conversationWasCreated: false,
    leadId: mapLeadId(row.lead_id),
    leadWasCreated: false,
    messageId: mapMessageId(row.message_id),
    messageSequenceNo: mapSafeBigInt(row.sequence_no),
    processingStatus: mapEnum(row.processing_status, MESSAGE_PROCESSING_STATUSES),
    status: "duplicate",
  });
};

const createContact = async (
  session: TenantDbSession,
  input: PreparedCanonicalInbound,
  contactId: ContactId,
  identityId: ResourceId,
  preferredLocale: "en" | "ru" | "uz",
): Promise<void> => {
  await executeTenantWrite(
    session,
    `insert into contacts
      (organization_id,id,display_name_ciphertext,preferred_locale,status,
       first_seen_at,last_seen_at,anonymized_at,version,created_at,updated_at)
     values ($1,$2,null,$3,'active',$4,$4,null,1,$4,$4)`,
    [contactId, preferredLocale, input.event.received_at],
  );
  await executeTenantWrite(
    session,
    `insert into contact_identities
      (organization_id,id,contact_id,identity_type,channel_connection_id,
       value_ciphertext,lookup_hash,hash_key_version,display_redacted,
       validation_status,verified_at,status,version,created_at,updated_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,null,$9,$10,'active',1,$11,$11)`,
    [
      identityId,
      contactId,
      input.identity.identityType,
      input.event.channel_connection_id,
      input.identity.valueCiphertext,
      input.identity.lookupHash,
      input.identity.hashKeyVersion,
      input.identity.validationStatus,
      input.identity.validationStatus === "verified" ? input.event.received_at : null,
      input.event.received_at,
    ],
  );
};

const updateContactActivity = async (
  session: TenantDbSession,
  contactId: ContactId,
  receivedAt: UtcTimestamp,
): Promise<number> => {
  type Row = QueryResultRow & { version: unknown };
  const result = await executeTenantWrite<Row>(
    session,
    `update contacts
        set last_seen_at = greatest(last_seen_at, $3),
            updated_at = greatest(updated_at, $3),
            version = version + 1
      where organization_id = $1 and id = $2
      returning version`,
    [contactId, receivedAt],
  );
  if (result.rowCount !== 1 || result.rows[0] === undefined) {
    throw new RepositoryDataIntegrityError();
  }
  return mapSafeBigInt(result.rows[0].version);
};

const persistContactAudit = async (
  session: TenantDbSession,
  contactId: ContactId,
  eventType: string,
  action: string,
  context: EventContext,
  identifiers: SecurityIdentifierFactory,
  now: Date,
): Promise<void> => {
  const auditId = issueIdentifier<ResourceId>(ResourceIdSchema, identifiers, now);
  await executeTenantWrite(
    session,
    `insert into audit_events
      (organization_id,id,event_type,actor_type,actor_id,actor_membership_id,
       impersonation_session_id,support_grant_id,target_type,target_id,action,
       result,reason_code,request_id,trace_id,correlation_id,source_ip_prefix,
       user_agent_hash,metadata_redacted_jsonb,occurred_at)
     values ($1,$2,$3,'customer',$4,null,null,null,'contact',$4,$5,
       'succeeded',null,$6,null,$7,null,null,'{"source":"canonical_inbound"}'::jsonb,$8)`,
    [
      auditId,
      eventType,
      contactId,
      action,
      context.requestId,
      context.correlationId,
      context.occurredAt,
    ],
  );
};

const persistContactOutboxEvent = async (
  session: TenantDbSession,
  event: DomainEvent,
): Promise<void> => {
  await executeTenantWrite(
    session,
    `insert into outbox_events
      (organization_id,id,event_type,schema_version,aggregate_type,aggregate_id,
       aggregate_version,payload_jsonb,correlation_id,causation_id,occurred_at,
       status,attempt_count,available_at,locked_by,locked_until,published_at,
       last_error_category)
     values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,'pending',0,$11,
       null,null,null,null)`,
    [
      event.event_id,
      event.event_type,
      event.schema_version,
      event.aggregate_type,
      event.aggregate_id,
      event.aggregate_version,
      JSON.stringify(event),
      event.correlation_id,
      event.causation_id,
      event.occurred_at,
    ],
  );
};

const reserveMessageSequence = async (
  session: TenantDbSession,
  conversationId: ConversationId,
): Promise<number> => {
  type Row = QueryResultRow & { sequence_no: unknown };
  const result = await executeTenantWrite<Row>(
    session,
    `update conversations
        set next_sequence_no = next_sequence_no + 1
      where organization_id = $1 and id = $2
      returning next_sequence_no - 1 as sequence_no`,
    [conversationId],
  );
  if (result.rowCount !== 1 || result.rows[0] === undefined) {
    throw new RepositoryDataIntegrityError();
  }
  return mapSafeBigInt(result.rows[0].sequence_no);
};

const persistMessage = async (
  session: TenantDbSession,
  input: PreparedCanonicalInbound,
  contactId: ContactId,
  conversationId: ConversationId,
  messageId: MessageId,
  sequenceNo: number,
): Promise<void> => {
  await executeTenantWrite(
    session,
    `insert into messages
      (organization_id,id,conversation_id,channel_connection_id,direction,
       sender_type,sender_contact_id,sender_membership_id,sequence_no,
       external_event_id,external_message_id,external_sent_at,external_sequence,
       content_type,body_ciphertext,body_hash,locale,processing_status,
       delivery_status,reply_to_message_id,ai_run_id,knowledge_manifest_jsonb,
       redacted_at,created_at)
     values ($1,$2,$3,$4,'inbound','customer',$5,null,$6,$7,$8,$9,null,$10,
       $11,$12,$13,$14,'not_applicable',null,null,null,null,$15)`,
    [
      messageId,
      conversationId,
      input.event.channel_connection_id,
      contactId,
      sequenceNo,
      input.event.event_id,
      input.event.external_message_id ?? null,
      input.event.occurred_at,
      input.event.kind,
      input.message.bodyCiphertext,
      input.message.bodyHash,
      input.message.localeHint,
      input.message.processingStatus,
      input.event.received_at,
    ],
  );
};

const persistConsent = async (
  session: TenantDbSession,
  input: PreparedCanonicalInbound,
  contactId: ContactId,
  identityId: ResourceId,
  conversationId: ConversationId,
  messageId: MessageId,
  contactVersion: number,
  context: EventContext,
  identifiers: SecurityIdentifierFactory,
  now: Date,
): Promise<void> => {
  const consent = input.consentEvidence;
  if (consent === null) return;
  const consentId = issueIdentifier<ResourceId>(ResourceIdSchema, identifiers, now);
  await executeTenantWrite(
    session,
    `insert into consent_records
      (organization_id,id,contact_id,conversation_id,contact_identity_id,purpose,
       status,lawful_basis_code,notice_key,notice_version,policy_url,locale,
       capture_channel,channel_connection_id,source_message_id,captured_by_type,
       captured_by_id,captured_at,withdrawn_at,supersedes_consent_id,evidence_hash,
       evidence_ciphertext,created_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'customer',
       $3,$16,$17,$18,$19,$20,$16)`,
    [
      consentId,
      contactId,
      conversationId,
      identityId,
      consent.purpose,
      consent.status,
      consent.lawfulBasisCode,
      consent.noticeKey,
      consent.noticeVersion,
      consent.policyUrl,
      consent.locale,
      input.event.channel,
      input.event.channel_connection_id,
      messageId,
      input.event.received_at,
      consent.status === "withdrawn" ? input.event.received_at : null,
      consent.supersedesConsentId,
      consent.evidenceHash,
      consent.evidenceCiphertext,
    ],
  );
  const eventType = (():
    | "consent.declined"
    | "consent.granted"
    | "consent.not_required_recorded"
    | "consent.withdrawn" => {
    switch (consent.status) {
      case "declined":
        return "consent.declined";
      case "granted":
        return "consent.granted";
      case "not_required":
        return "consent.not_required_recorded";
      case "withdrawn":
        return "consent.withdrawn";
    }
  })();
  const event = materializeContactEvent(
    eventType,
    contactVersion,
    Object.freeze({
      consent_decision: consent.status,
      consent_record_id: consentId,
      purpose: consent.purpose,
    }),
    contactId,
    context,
    input.organizationId,
    issueIdentifier<EventId>(EventIdSchema, identifiers, now),
  );
  await persistContactOutboxEvent(session, event);
  await persistContactAudit(
    session,
    contactId,
    eventType,
    "consent.record",
    context,
    identifiers,
    now,
  );
};

const requireTransition = <Aggregate, Event, Record>(
  result:
    | Readonly<{ error: unknown; ok: false }>
    | Readonly<{ ok: true; value: Transition<Aggregate, Event, Record> }>,
): Transition<Aggregate, Event, Record> => {
  if (!result.ok) throw new RepositoryDataIntegrityError();
  return result.value;
};

const leadDomainValue = (
  lead: LeadRecord,
  organizationId: PreparedCanonicalInbound["organizationId"],
): Lead => {
  if (lead.status !== "new") throw new RepositoryDataIntegrityError();
  return Object.freeze({
    appointmentRequestId: null,
    contactId: lead.contactId,
    leadId: lead.leadId,
    organizationId,
    qualification: null,
    status: "new",
    version: lead.version,
  });
};

const conversationDomainValue = async (
  session: TenantDbSession,
  conversation: ConversationRecord,
  organizationId: PreparedCanonicalInbound["organizationId"],
): Promise<Conversation> => {
  const handoff =
    conversation.activeHandoffId === null
      ? null
      : await createHandoffNotificationRepository(session).findActiveHandoffByConversation(
          conversation.conversationId,
        );
  if (
    (conversation.activeHandoffId === null) !== (handoff === null) ||
    (handoff !== null && handoff.handoffId !== conversation.activeHandoffId)
  ) {
    throw new RepositoryDataIntegrityError();
  }
  let activeHandoff: Conversation["activeHandoff"] = null;
  if (handoff !== null) {
    if (!isActiveConversationHandoffStatus(handoff.status)) {
      throw new RepositoryDataIntegrityError();
    }
    activeHandoff = Object.freeze({
      handoffId: handoff.handoffId,
      organizationId,
      status: handoff.status,
    });
  }
  return Object.freeze({
    activeHandoff,
    automationMode: conversation.automationMode,
    channelConnectionId: conversation.channelConnectionId,
    contactId: conversation.contactId,
    conversationId: conversation.conversationId,
    leadId: conversation.leadId,
    organizationId,
    status: conversation.status,
    version: conversation.version,
  });
};

const coreEventDrafts = <Event extends CoreDomainEventDraft>(
  drafts: readonly Event[],
  aggregateType: CoreDomainEvent["aggregate_type"],
  aggregateId: string,
): AggregateWork["typedDrafts"] =>
  drafts.map((draft) => Object.freeze({ aggregateId, aggregateType, draft }));

const leadWork = (
  transition: Transition<Lead, LeadEventDraft, LeadTransitionRecord>,
  mode: "create" | "update",
  sourceChannelConnectionId: PreparedCanonicalInbound["event"]["channel_connection_id"],
  expectedVersion?: number,
): AggregateWork => ({
  mutation:
    mode === "create"
      ? {
          aggregateType: "lead",
          mode,
          nextAggregate: transition.nextAggregate,
          storage: {
            assignedMembershipId: null,
            campaignKey: null,
            locationId: null,
            serviceId: null,
            sourceChannelConnectionId,
          },
        }
      : {
          aggregateType: "lead",
          expectedVersion: expectedVersion ?? 0,
          mode,
          nextAggregate: transition.nextAggregate,
        },
  transitions: transition.transitionRecords.map((record) => ({ record, transitionType: "lead" })),
  typedDrafts: coreEventDrafts(transition.events, "lead", transition.nextAggregate.leadId),
});

const conversationWork = (
  transition: Transition<Conversation, ConversationEventDraft, ConversationTransitionRecord>,
  mode: "create" | "update",
  input: PreparedCanonicalInbound,
  preferredLocale: "en" | "ru" | "uz",
  expectedVersion?: number,
): AggregateWork => ({
  mutation:
    mode === "create"
      ? {
          aggregateType: "conversation",
          mode,
          nextAggregate: transition.nextAggregate,
          storage: { externalThreadHash: input.threadHash, preferredLocale },
        }
      : {
          aggregateType: "conversation",
          expectedVersion: expectedVersion ?? 0,
          mode,
          nextAggregate: transition.nextAggregate,
        },
  transitions: transition.transitionRecords.map((record) => ({
    record,
    transitionType: "conversation",
  })),
  typedDrafts: coreEventDrafts(
    transition.events,
    "conversation",
    transition.nextAggregate.conversationId,
  ),
});

const persistNewContactProvenance = async (
  session: TenantDbSession,
  input: PreparedCanonicalInbound,
  contactId: ContactId,
  identityId: ResourceId,
  preferredLocale: "en" | "ru" | "uz",
  context: EventContext,
  identifiers: SecurityIdentifierFactory,
  now: Date,
): Promise<void> => {
  const events = [
    materializeContactEvent(
      "contact.created",
      1,
      Object.freeze({ preferred_locale: preferredLocale }),
      contactId,
      context,
      input.organizationId,
      issueIdentifier<EventId>(EventIdSchema, identifiers, now),
    ),
    materializeContactEvent(
      "contact.identity_added",
      1,
      Object.freeze({
        contact_identity_id: identityId,
        identity_type: input.identity.identityType,
      }),
      contactId,
      context,
      input.organizationId,
      issueIdentifier<EventId>(EventIdSchema, identifiers, now),
    ),
  ];
  for (const event of events) await persistContactOutboxEvent(session, event);
  await persistContactAudit(
    session,
    contactId,
    "contact.created",
    "contact.create",
    context,
    identifiers,
    now,
  );
};

const processInbound = async (
  session: TenantDbSession,
  input: PreparedCanonicalInbound,
  identifiers: SecurityIdentifierFactory,
  clock: () => Date,
): Promise<CanonicalInboundResult> => {
  const lockKeys = [
    `event:${input.event.channel_connection_id}:${input.event.event_id}`,
    `identity:${input.event.channel_connection_id}:${Buffer.from(input.identity.lookupHash).toString("hex")}`,
    `thread:${input.event.channel_connection_id}:${Buffer.from(input.threadHash).toString("hex")}`,
    ...(input.event.external_message_id === undefined || input.event.external_message_id === null
      ? []
      : [`message:${input.event.channel_connection_id}:${input.event.external_message_id}`]),
  ];
  await acquireLocks(session, lockKeys);
  const duplicate = await duplicateReceipt(session, input);
  if (duplicate !== null) return Object.freeze({ ok: true, value: duplicate });

  const configuration = createConfigurationRepository(session);
  const organization = await configuration.getOrganization();
  const channelConnection = await configuration.getChannelConnection(
    input.event.channel_connection_id,
  );
  if (
    organization.status !== "active" ||
    channelConnection.status !== "active" ||
    channelConnection.channelType !== input.event.channel
  ) {
    return failure("channel_unavailable");
  }

  const customerRepository = createCustomerRepository(session);
  const conversationRepository = createConversationRepository(session);
  const identity = await customerRepository.findActiveIdentity({
    channelConnectionId: input.event.channel_connection_id,
    identityType: input.identity.identityType,
    lookupHash: input.identity.lookupHash,
  });
  const activeConversation = await conversationRepository.findActiveConversation(
    input.event.channel_connection_id,
    input.threadHash,
  );
  if (identity === null && activeConversation !== null) return failure("identity_conflict");

  const now = clock();
  const contact: PersistedContact = await (async () => {
    if (identity !== null) {
      const existing = await customerRepository.getContact(identity.contactId);
      if (existing.status !== "active") throw new RepositoryNotFoundError("contact");
      return Object.freeze({
        contact: existing,
        contactId: existing.contactId,
        contactWasCreated: false,
        identityId: identity.contactIdentityId,
        preferredLocale: existing.preferredLocale,
      });
    }
    const contactId = issueIdentifier<ContactId>(ContactIdSchema, identifiers, now);
    const identityId = issueIdentifier<ResourceId>(ResourceIdSchema, identifiers, now);
    const preferredLocale = input.message.localeHint ?? organization.defaultLocale;
    await createContact(session, input, contactId, identityId, preferredLocale);
    return Object.freeze({
      contact: null,
      contactId,
      contactWasCreated: true,
      identityId,
      preferredLocale,
    });
  })();

  if (activeConversation !== null && activeConversation.contactId !== contact.contactId) {
    throw new RepositoryDataIntegrityError();
  }
  await acquireLocks(session, [`contact:${contact.contactId}`]);

  const actorCandidate: unknown = Object.freeze({
    actor_id: contact.contactId,
    actor_type: "customer",
  });
  if (!isSchemaValue(ActorRefSchema, actorCandidate) || actorCandidate.actor_type !== "customer") {
    throw new RepositoryDataIntegrityError();
  }
  const occurredAtCandidate: unknown = input.event.received_at;
  if (!isSchemaValue(UtcTimestampSchema, occurredAtCandidate)) {
    throw new RepositoryDataIntegrityError();
  }
  const actor = actorCandidate;
  const occurredAt = occurredAtCandidate;
  const eventContext: EventContext = Object.freeze({
    actor,
    correlationId: issueIdentifier<CorrelationId>(CorrelationIdSchema, identifiers, now),
    occurredAt,
    requestId: issueIdentifier<RequestId>(RequestIdSchema, identifiers, now),
  });
  const messageId = issueIdentifier<MessageId>(MessageIdSchema, identifiers, now);
  const leadRepository = createLeadRepository(session);
  const activeLead = await leadRepository.findActiveLeadByContact(contact.contactId);
  if (
    activeConversation !== null &&
    (activeLead === null || activeConversation.leadId !== activeLead.leadId)
  ) {
    throw new RepositoryDataIntegrityError();
  }

  let leadId: LeadId;
  let leadWasCreated = false;
  const work: AggregateWork[] = [];
  if (activeConversation !== null) {
    const conversationLead = await leadRepository.getLead(activeConversation.leadId);
    if (conversationLead.contactId !== contact.contactId) throw new RepositoryDataIntegrityError();
    leadId = conversationLead.leadId;
    if (conversationLead.status === "new" && input.message.processingStatus === "accepted") {
      const transition = requireTransition(
        recordEngagement(leadDomainValue(conversationLead, input.organizationId), {
          actor,
          expectedVersion: conversationLead.version,
          occurredAt,
          organizationId: input.organizationId,
          sourceMessage: { messageId, organizationId: input.organizationId },
        }),
      );
      work.push(
        leadWork(transition, "update", input.event.channel_connection_id, conversationLead.version),
      );
    }
  } else if (activeLead !== null) {
    leadId = activeLead.leadId;
    if (activeLead.status === "new" && input.message.processingStatus === "accepted") {
      const transition = requireTransition(
        recordEngagement(leadDomainValue(activeLead, input.organizationId), {
          actor,
          expectedVersion: activeLead.version,
          occurredAt,
          organizationId: input.organizationId,
          sourceMessage: { messageId, organizationId: input.organizationId },
        }),
      );
      work.push(
        leadWork(transition, "update", input.event.channel_connection_id, activeLead.version),
      );
    }
  } else {
    leadWasCreated = true;
    leadId = issueIdentifier<LeadId>(LeadIdSchema, identifiers, now);
    const created = requireTransition(
      createLead({
        actor,
        contact: { contactId: contact.contactId, organizationId: input.organizationId },
        leadId,
        occurredAt,
        organizationId: input.organizationId,
      }),
    );
    const finalTransition =
      input.message.processingStatus === "accepted"
        ? requireTransition(
            recordEngagement(created.nextAggregate, {
              actor,
              expectedVersion: created.nextAggregate.version,
              occurredAt,
              organizationId: input.organizationId,
              sourceMessage: { messageId, organizationId: input.organizationId },
            }),
          )
        : null;
    const combined: Transition<Lead, LeadEventDraft, LeadTransitionRecord> =
      finalTransition === null
        ? created
        : Object.freeze({
            events: Object.freeze([...created.events, ...finalTransition.events]),
            nextAggregate: finalTransition.nextAggregate,
            transitionRecords: Object.freeze([
              ...created.transitionRecords,
              ...finalTransition.transitionRecords,
            ]),
          });
    work.push(leadWork(combined, "create", input.event.channel_connection_id));
  }

  let conversationId: ConversationId;
  let conversationWasCreated = false;
  if (activeConversation === null) {
    conversationWasCreated = true;
    conversationId = issueIdentifier<ConversationId>(ConversationIdSchema, identifiers, now);
    const transition = requireTransition(
      createConversation({
        actor,
        channelConnection: {
          channelConnectionId: input.event.channel_connection_id,
          organizationId: input.organizationId,
        },
        contact: { contactId: contact.contactId, organizationId: input.organizationId },
        conversationId,
        initialMessage: { messageId, organizationId: input.organizationId },
        lead: { leadId, organizationId: input.organizationId },
        occurredAt,
        organizationId: input.organizationId,
      }),
    );
    work.push(
      conversationWork(
        transition,
        "create",
        input,
        contact.preferredLocale ?? input.message.localeHint ?? organization.defaultLocale,
      ),
    );
  } else {
    conversationId = activeConversation.conversationId;
    const domainConversation = await conversationDomainValue(
      session,
      activeConversation,
      input.organizationId,
    );
    const transition = requireTransition(
      acceptCustomerMessage(domainConversation, {
        actor,
        expectedVersion: domainConversation.version,
        message: { messageId, organizationId: input.organizationId },
        occurredAt,
        organizationId: input.organizationId,
      }),
    );
    work.push(
      conversationWork(
        transition,
        "update",
        input,
        activeConversation.preferredLocale,
        domainConversation.version,
      ),
    );
  }

  const eventEntries = work.flatMap(({ typedDrafts }) => typedDrafts);
  const events = eventEntries.map(({ aggregateId, aggregateType, draft }) =>
    materializeCoreEvent(
      draft,
      aggregateType,
      aggregateId,
      eventContext,
      input.organizationId,
      issueIdentifier<EventId>(EventIdSchema, identifiers, now),
    ),
  );
  const audits: TenantMutationAudit[] = work.map(({ mutation }) => ({
    actor,
    actorMembershipId: null,
    auditId: issueIdentifier<ResourceId>(ResourceIdSchema, identifiers, now),
    correlationId: eventContext.correlationId,
    metadataRedacted: Object.freeze({ source: "canonical_inbound" }),
    occurredAt,
    requestId: eventContext.requestId,
    target:
      mutation.aggregateType === "lead"
        ? { targetId: mutation.nextAggregate.leadId, targetType: "lead" }
        : {
            targetId: mutation.nextAggregate.conversationId,
            targetType: "conversation",
          },
  }));
  const plan: DomainMutationPlan = Object.freeze({
    aggregates: requireNonEmpty(work.map(({ mutation }) => mutation)),
    audits: requireNonEmpty(audits),
    events: requireNonEmpty(events),
    transitions: requireNonEmpty(work.flatMap(({ transitions }) => transitions)),
  });
  await persistDomainMutationPlan(session, plan);

  const sequenceNo = await reserveMessageSequence(session, conversationId);
  await persistMessage(session, input, contact.contactId, conversationId, messageId, sequenceNo);
  const contactVersion =
    contact.contactWasCreated && input.consentEvidence === null
      ? 1
      : await updateContactActivity(session, contact.contactId, occurredAt);
  if (contact.contactWasCreated) {
    await persistNewContactProvenance(
      session,
      input,
      contact.contactId,
      contact.identityId,
      contact.preferredLocale ?? organization.defaultLocale,
      eventContext,
      identifiers,
      now,
    );
  }
  await persistConsent(
    session,
    input,
    contact.contactId,
    contact.identityId,
    conversationId,
    messageId,
    contactVersion,
    eventContext,
    identifiers,
    now,
  );

  return Object.freeze({
    ok: true,
    value: Object.freeze({
      contactId: contact.contactId,
      contactWasCreated: contact.contactWasCreated,
      conversationId,
      conversationWasCreated,
      leadId,
      leadWasCreated,
      messageId,
      messageSequenceNo: sequenceNo,
      processingStatus: input.message.processingStatus,
      status: "accepted",
    }),
  });
};

const mapExpectedFailure = (error: unknown): CanonicalInboundResult | null => {
  if (
    error instanceof RepositoryNotFoundError &&
    (error.resource === "channel_connection" || error.resource === "organization")
  ) {
    return failure("channel_unavailable");
  }
  if (error instanceof RepositoryNotFoundError && error.resource === "contact") {
    return failure("contact_unavailable");
  }
  if (
    error instanceof RepositoryStructuralConflictError ||
    error instanceof RepositoryOwnershipValidationError ||
    error instanceof RepositoryVersionConflictError ||
    (error instanceof RepositoryDatabaseError &&
      ["active_record_conflict", "integrity_conflict"].includes(error.classification.code))
  ) {
    return failure("persistence_conflict");
  }
  return null;
};

export const createCanonicalInboundPersistenceStore = (
  runtime: TenantDatabaseRuntime,
  options: Readonly<{
    clock?: () => Date;
    identifierFactory?: SecurityIdentifierFactory;
  }> = {},
): CanonicalInboundPersistenceStore => {
  const clock = options.clock ?? (() => new Date());
  const identifiers = options.identifierFactory ?? createSecurityIdentifierFactory();
  return Object.freeze({
    acceptInbound: async (input: PreparedCanonicalInbound) => {
      try {
        return await runtime.withTenantTransaction(input.organizationId, (session) =>
          processInbound(session, input, identifiers, clock),
        );
      } catch (error) {
        const expected = mapExpectedFailure(error);
        if (expected !== null) return expected;
        throw error;
      }
    },
  });
};
