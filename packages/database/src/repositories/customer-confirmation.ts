import {
  confirmationReplyIntent,
  confirmationLocale,
  confirmationText,
  customerConfirmationExpiry,
  CUSTOMER_CONFIRMATION_PROFILE,
  type CustomerConfirmationStore,
} from "@lead-agent/application";
import {
  ActorRefSchema,
  DomainEventSchema,
  AppointmentRequestConfirmedDomainEventV2Schema,
  DomainEventSchemasByVersion,
  OrganizationIdSchema,
  ConversationIdSchema,
  MessageIdSchema,
  CorrelationIdSchema,
  IanaTimeZoneSchema,
  RequestIdSchema,
  EventIdSchema,
  isSchemaValue,
  type ActorRef,
  type CorrelationId,
  type MessageId,
  type Locale,
} from "@lead-agent/contracts";
import {
  prepareCustomerConfirmation,
  confirmAppointmentRequest,
  cancelAppointmentRequest,
  expireAppointmentRequest,
  convertLead,
  validateAppointmentOfferVersion,
  validateAppointmentRequestReasonCode,
  type AppointmentRequest,
  type AppointmentRequestCommandResult,
  type Lead,
} from "@lead-agent/domain";
import { createSecurityIdentifierFactory, type CustomerDataProtection } from "@lead-agent/security";
import type { TenantDatabaseRuntime, TenantDbSession } from "../runtime/tenant.js";
import { createAppointmentRepository, type AppointmentRequestRecord } from "./appointments.js";
import { createConversationRepository, type ConversationRecord } from "./conversations.js";
import { createLeadRepository } from "./leads.js";
import { localSlotText } from "./staff-domain.js";
import { queueCustomerReply } from "./customer-replies.js";
import { persistDomainMutationPlan } from "./mutations.js";
import type {
  CoreAggregateMutation,
  CoreDomainEventDraft,
  CoreTransitionPersistence,
  DomainEventAppend,
  NonEmptyReadonlyArray,
} from "./mutation-types.js";
import {
  executeTenantRead,
  executeTenantWrite,
  mapAggregateVersion,
  mapAppointmentRequestId,
  mapBytes,
  mapResourceId,
  mapSafeBigInt,
  mapUtcTimestamp,
  RepositoryDataIntegrityError,
} from "./shared.js";

const system = { actor_type: "system", actor_id: null } as const;
const nonempty = <T>(values: readonly T[]): NonEmptyReadonlyArray<T> => {
  const [first, ...rest] = values;
  if (first === undefined) throw new RepositoryDataIntegrityError();
  return [first, ...rest];
};
const reason = (value: string): import("@lead-agent/domain").AppointmentRequestReasonCode => {
  const parsed = validateAppointmentRequestReasonCode(value);
  if (!parsed.ok) throw new RepositoryDataIntegrityError();
  return parsed.value;
};
const loadRequest = async (
  session: TenantDbSession,
  row: AppointmentRequestRecord,
): Promise<AppointmentRequest> => {
  const preferences = await createAppointmentRepository(session).listPreferences(
    row.appointmentRequestId,
    { limit: 20 },
  );
  const offerVersion = validateAppointmentOfferVersion(row.offerVersion);
  if (
    preferences.next !== null ||
    !offerVersion.ok ||
    row.staffDecidedAt === null ||
    row.staffDecidedByMembershipId === null ||
    row.startAt === null ||
    row.endAt === null ||
    row.offeredTimeZone === null ||
    !isSchemaValue(IanaTimeZoneSchema, row.offeredTimeZone)
  )
    throw new RepositoryDataIntegrityError();
  return {
    appointmentRequestId: row.appointmentRequestId,
    organizationId: session.organizationId,
    leadId: row.leadId,
    contactId: row.contactId,
    conversationId: row.conversationId,
    sourceMessageId: row.sourceMessageId,
    serviceId: row.serviceId,
    serviceVersionId: row.serviceVersionId,
    locationId: row.locationId,
    locationVersionId: row.locationVersionId,
    businessPolicyId: row.businessPolicyId,
    status: row.status,
    version: mapAggregateVersion(row.version),
    createdAt: row.createdAt,
    preferences: preferences.items.map((pref) => {
      if (
        pref.precision !== "exact" ||
        pref.startAt === null ||
        pref.endAt === null ||
        pref.localStart === null ||
        pref.localEnd === null ||
        !isSchemaValue(IanaTimeZoneSchema, pref.timeZone)
      )
        throw new RepositoryDataIntegrityError();
      return {
        ...pref,
        precision: "exact",
        startAt: pref.startAt,
        endAt: pref.endAt,
        localStart: pref.localStart,
        localEnd: pref.localEnd,
        timeZone: pref.timeZone,
      };
    }),
    staffDecision: {
      outcome: "accepted",
      decidedAt: row.staffDecidedAt,
      membershipId: row.staffDecidedByMembershipId,
    },
    offer: {
      startAt: row.startAt,
      endAt: row.endAt,
      localStart: localSlotText(row.startAt, row.offeredTimeZone),
      localEnd: localSlotText(row.endAt, row.offeredTimeZone),
      timeZone: row.offeredTimeZone,
      locationId: row.locationId,
      offerVersion: offerVersion.value,
    },
    confirmationOffer:
      row.confirmationIssuedAt === null || row.offerExpiresAt === null
        ? null
        : {
            issuedAt: row.confirmationIssuedAt,
            expiresAt: row.offerExpiresAt,
            offerVersion: offerVersion.value,
          },
    confirmationEvidence: null,
    confirmedAt: null,
    cancellation: null,
    expiration: null,
  };
};
const lockConversation = async (
  session: TenantDbSession,
  id: string,
): Promise<ConversationRecord | null> => {
  if (!isSchemaValue(ConversationIdSchema, id)) throw new RepositoryDataIntegrityError();
  const rows = await executeTenantRead(
    session,
    `select id from conversations where organization_id=$1 and id=$2 for update`,
    [id],
  );
  return rows.length === 0 ? null : await createConversationRepository(session).getConversation(id);
};
const boundChannel = async (
  session: TenantDbSession,
  conversation: ConversationRecord,
  now: Date,
): Promise<"customer_session" | "telegram" | "instagram" | null> => {
  if (conversation.status === "closed" || conversation.status === "resolved") return null;
  const rows = await executeTenantRead(
    session,
    `select c.channel_type from channel_connections c join contacts p on p.organization_id=c.organization_id and p.id=$3
    where c.organization_id=$1 and c.id=$2 and c.status='active' and p.status='active'`,
    [conversation.channelConnectionId, conversation.contactId],
  );
  const channel = rows[0]?.["channel_type"];
  if (channel === "widget") {
    const bindings = await executeTenantRead(
      session,
      `select id from widget_sessions where organization_id=$1 and channel_connection_id=$2 and conversation_id=$3 and contact_id=$4
      and status='active' and revoked_at is null and expires_at>$5 limit 1`,
      [conversation.channelConnectionId, conversation.conversationId, conversation.contactId, now],
    );
    return bindings.length === 1 ? "customer_session" : null;
  }
  if (channel !== "telegram" && channel !== "instagram") return null;
  const identities = await executeTenantRead(
    session,
    `select id from contact_identities where organization_id=$1 and channel_connection_id=$2 and contact_id=$3
    and identity_type=$4 and status='active' and validation_status in ('valid','verified') limit 1`,
    [conversation.channelConnectionId, conversation.contactId, `${channel}_user`],
  );
  return identities.length === 1 ? channel : null;
};

export const createCustomerConfirmationStore = (
  runtime: TenantDatabaseRuntime,
  options: Readonly<{ dataProtection: CustomerDataProtection; clock?: () => Date }>,
): CustomerConfirmationStore => {
  const clock = options.clock ?? (() => new Date()),
    identifiers = createSecurityIdentifierFactory();
  const nextId = (): string => identifiers.issueResourceId(clock());
  const persist = async (
    session: TenantDbSession,
    request: AppointmentRequest,
    result: AppointmentRequestCommandResult,
    actor: Extract<ActorRef, { actor_type: "customer" | "system" }>,
    correlation: CorrelationId,
    causation: string,
    now: Date,
    sourceMessageId: MessageId | null = null,
  ): Promise<void> => {
    if (!result.ok) throw new RepositoryDataIntegrityError();
    const aggregates: CoreAggregateMutation[] = [
      {
        aggregateType: "appointment_request",
        mode: "update",
        expectedVersion: request.version,
        nextAggregate: result.value.nextAggregate,
      },
    ];
    const transitions: CoreTransitionPersistence[] = result.value.transitionRecords.map(
      (record) => ({
        transitionType: "appointment_request",
        record,
        transitionId: mapResourceId(nextId()),
        correlationId: correlation,
        sourceMessageId,
        metadata: { confirmation_profile: CUSTOMER_CONFIRMATION_PROFILE },
      }),
    );
    const drafts: Readonly<{
      draft: CoreDomainEventDraft;
      id: string;
      type: "appointment_request" | "lead";
    }>[] = result.value.events.map((draft) => ({
      draft,
      id: request.appointmentRequestId,
      type: "appointment_request",
    }));
    if (result.value.nextAggregate.status === "confirmed") {
      await executeTenantRead(
        session,
        `select id from leads where organization_id=$1 and id=$2 for update`,
        [request.leadId],
      );
      const leadRow = await createLeadRepository(session).getLead(request.leadId),
        evaluations = await createLeadRepository(session).listQualificationEvaluations(
          request.leadId,
          { limit: 1, result: "qualified", businessPolicyId: request.businessPolicyId },
        );
      const evaluation = evaluations.items[0];
      if (
        leadRow.status !== "booking_requested" ||
        leadRow.qualificationPolicyId !== request.businessPolicyId ||
        evaluation?.result !== "qualified" ||
        evaluation.businessPolicyId !== request.businessPolicyId
      )
        throw new RepositoryDataIntegrityError();
      const lead: Lead = {
        leadId: leadRow.leadId,
        contactId: leadRow.contactId,
        organizationId: session.organizationId,
        status: leadRow.status,
        version: mapAggregateVersion(leadRow.version),
        appointmentRequestId: request.appointmentRequestId,
        qualification: {
          evaluationId: evaluation.evaluationId,
          policyId: evaluation.businessPolicyId,
          result: "qualified",
          reasonCodes: [],
        },
      };
      const converted = convertLead(lead, {
        organizationId: session.organizationId,
        actor,
        expectedVersion: lead.version,
        occurredAt: mapUtcTimestamp(now),
        appointmentRequest: {
          organizationId: session.organizationId,
          appointmentRequestId: request.appointmentRequestId,
        },
      });
      if (!converted.ok) throw new RepositoryDataIntegrityError();
      aggregates.push({
        aggregateType: "lead",
        mode: "update",
        expectedVersion: lead.version,
        nextAggregate: converted.value.nextAggregate,
      });
      transitions.push(
        ...converted.value.transitionRecords.map((record) => ({
          transitionType: "lead" as const,
          record,
        })),
      );
      drafts.push(
        ...converted.value.events.map((draft) => ({
          draft,
          id: request.leadId,
          type: "lead" as const,
        })),
      );
    }
    const events = drafts.map(({ draft, id, type }): DomainEventAppend => {
      const value: unknown = {
        ...draft,
        actor,
        organization_id: session.organizationId,
        aggregate_type: type,
        aggregate_id: id,
        event_id: nextId(),
        occurred_at: now.toISOString(),
        correlation_id: correlation,
        causation_id: causation,
        request_id: null,
      };
      if (isSchemaValue(AppointmentRequestConfirmedDomainEventV2Schema, value))
        return { draft, envelope: value };
      if (
        !isSchemaValue(DomainEventSchema, value) ||
        (value.aggregate_type !== "appointment_request" && value.aggregate_type !== "lead")
      )
        throw new RepositoryDataIntegrityError();
      return { draft, envelope: value };
    });
    const requestId = `s18:${causation}`;
    if (!isSchemaValue(RequestIdSchema, requestId)) throw new RepositoryDataIntegrityError();
    await persistDomainMutationPlan(session, {
      aggregates: nonempty(aggregates),
      transitions: nonempty(transitions),
      events: nonempty(events),
      audits: nonempty(
        aggregates.map((mutation) => ({
          actor,
          actorMembershipId: null,
          auditId: mapResourceId(nextId()),
          correlationId: correlation,
          occurredAt: mapUtcTimestamp(now),
          requestId,
          target:
            mutation.aggregateType === "lead"
              ? { targetType: "lead" as const, targetId: request.leadId }
              : {
                  targetType: "appointment_request" as const,
                  targetId: request.appointmentRequestId,
                },
          metadataRedacted: {
            confirmation_profile: CUSTOMER_CONFIRMATION_PROFILE,
            expected_version: request.version,
          },
        })),
      ),
      ...(result.value.nextAggregate.confirmationEvidence === null
        ? {}
        : {
            confirmationEvidence: [
              {
                evidence: result.value.nextAggregate.confirmationEvidence,
                correlationId: correlation,
              },
            ],
          }),
    });
    // This existing committed fact is the finite durable expiry task, still owned by analytics.
    // The separate message.response_queued intent is deliverable immediately.
    if (result.value.nextAggregate.status === "awaiting_customer_confirmation") {
      await executeTenantWrite(
        session,
        `update outbox_events set available_at=$3 where organization_id=$1 and id=$2 and status='pending'`,
        [events[0]?.envelope.event_id, result.value.nextAggregate.confirmationOffer?.expiresAt],
      );
    }
  };
  const reply = async (
    session: TenantDbSession,
    conversation: ConversationRecord,
    kind: Parameters<typeof confirmationText>[0],
    start: string,
    correlation: CorrelationId,
    causation: string,
    now: Date,
    sourceId: MessageId | null,
    request?: AppointmentRequest,
    locale: Locale = conversation.preferredLocale,
  ): Promise<void> => {
    await queueCustomerReply(
      session,
      {
        conversationId: conversation.conversationId,
        channelConnectionId: conversation.channelConnectionId,
        conversationVersion: conversation.version,
        locale,
        text: confirmationText(kind, locale, start),
        replyToMessageId: sourceId,
        aiRunId: null,
        correlationId: correlation,
        causationId: causation,
        requestId: `s18:${causation}`,
        manifest: {
          sources: [],
          confirmation_profile: CUSTOMER_CONFIRMATION_PROFILE,
          confirmation_kind: kind,
          ...(request === undefined
            ? {}
            : {
                confirmation_request_id: request.appointmentRequestId,
                confirmation_offer_version: request.offer?.offerVersion,
              }),
        },
        updatePreferredLocale: locale !== conversation.preferredLocale,
      },
      options.dataProtection,
      nextId,
      now,
    );
  };
  return {
    prepare: async (event) => {
      if (
        !isSchemaValue(
          DomainEventSchemasByVersion["appointment_request.staff_accepted"]["1"],
          event,
        )
      )
        throw new RepositoryDataIntegrityError();
      return await runtime.withTenantTransaction(event.organization_id, async (session) => {
        const row = await createAppointmentRepository(session).getAppointmentRequest(
            event.aggregate_id,
          ),
          conversation = await lockConversation(session, row.conversationId);
        if (
          conversation === null ||
          row.contactId !== conversation.contactId ||
          row.leadId !== conversation.leadId
        )
          return "unavailable";
        await executeTenantRead(
          session,
          `select id from appointment_requests where organization_id=$1 and id=$2 for update`,
          [row.appointmentRequestId],
        );
        const current = await createAppointmentRepository(session).getAppointmentRequest(
          row.appointmentRequestId,
        );
        if (
          event.actor.actor_type !== "member" ||
          event.actor.actor_id.toString() !== current.staffDecidedByMembershipId ||
          event.payload.location_id !== current.locationId ||
          current.startAt === null ||
          Date.parse(event.payload.scheduled_start_at) !== Date.parse(current.startAt)
        )
          return "unavailable";
        if (current.status === "awaiting_customer_confirmation" || current.status === "confirmed")
          return "already_prepared";
        if (
          current.status !== "staff_accepted" ||
          current.version !== event.aggregate_version ||
          current.offerVersion !== event.payload.offer_version
        )
          return "unavailable";
        const now = clock();
        const request = await loadRequest(session, current),
          expires = customerConfirmationExpiry(now.toISOString(), current.startAt ?? "");
        if (expires === null) {
          await persist(
            session,
            request,
            expireAppointmentRequest(request, {
              actor: system,
              organizationId: session.organizationId,
              expectedVersion: request.version,
              now: mapUtcTimestamp(now),
              reasonCode: reason("confirmation_preparation_expired"),
            }),
            system,
            event.correlation_id,
            event.event_id,
            now,
          );
          return "expired";
        }
        if ((await boundChannel(session, conversation, now)) === null) return "unavailable";
        await persist(
          session,
          request,
          prepareCustomerConfirmation(request, {
            actor: system,
            organizationId: session.organizationId,
            expectedVersion: request.version,
            offerVersion:
              request.offer?.offerVersion ??
              (() => {
                throw new RepositoryDataIntegrityError();
              })(),
            issuedAt: mapUtcTimestamp(now),
            expiresAt: expires,
          }),
          system,
          event.correlation_id,
          event.event_id,
          now,
        );
        await reply(
          session,
          conversation,
          "prompt",
          request.offer?.localStart ?? "",
          event.correlation_id,
          event.event_id,
          now,
          null,
          request,
        );
        return "prepared";
      });
    },
    expire: async (event) => {
      if (
        !isSchemaValue(
          DomainEventSchemasByVersion["appointment_request.customer_confirmation_requested"]["1"],
          event,
        )
      )
        throw new RepositoryDataIntegrityError();
      return await runtime.withTenantTransaction(event.organization_id, async (session) => {
        const row = await createAppointmentRepository(session).getAppointmentRequest(
          event.aggregate_id,
        );
        await lockConversation(session, row.conversationId);
        await executeTenantRead(
          session,
          `select id from appointment_requests where organization_id=$1 and id=$2 for update`,
          [row.appointmentRequestId],
        );
        const current = await createAppointmentRepository(session).getAppointmentRequest(
            row.appointmentRequestId,
          ),
          now = clock();
        if (
          current.status !== "awaiting_customer_confirmation" ||
          current.offerVersion !== event.payload.offer_version ||
          current.version !== event.aggregate_version
        )
          return "obsolete";
        if (current.offerExpiresAt === null) throw new RepositoryDataIntegrityError();
        if (now.getTime() < Date.parse(current.offerExpiresAt)) return "not_due";
        const request = await loadRequest(session, current);
        await persist(
          session,
          request,
          expireAppointmentRequest(request, {
            actor: system,
            organizationId: session.organizationId,
            expectedVersion: request.version,
            now: mapUtcTimestamp(now),
            reasonCode: reason("confirmation_window_expired"),
          }),
          system,
          event.correlation_id,
          event.event_id,
          now,
        );
        return "expired";
      });
    },
    respond: async (reference) => {
      if (
        !isSchemaValue(OrganizationIdSchema, reference.organizationId) ||
        !isSchemaValue(ConversationIdSchema, reference.conversationId) ||
        !isSchemaValue(MessageIdSchema, reference.messageId) ||
        !isSchemaValue(CorrelationIdSchema, reference.correlationId) ||
        !isSchemaValue(EventIdSchema, reference.causationId)
      )
        throw new RepositoryDataIntegrityError();
      return await runtime.withTenantTransaction(reference.organizationId, async (session) => {
        const conversation = await lockConversation(session, reference.conversationId),
          now = clock();
        if (conversation === null) return { kind: "ignored", reason: "customer_binding_invalid" };
        const sources = await executeTenantRead(
          session,
          `select id,sequence_no,sender_contact_id,channel_connection_id,content_type,body_ciphertext,redacted_at,processing_status,ai_run_id,created_at,external_sent_at
          from messages where organization_id=$1 and id=$2 and conversation_id=$3 and direction='inbound' and sender_type='customer' for update`,
          [reference.messageId, conversation.conversationId],
        );
        const source = sources[0];
        if (
          source === undefined ||
          source["sender_contact_id"] !== conversation.contactId ||
          source["channel_connection_id"] !== conversation.channelConnectionId ||
          source["redacted_at"] !== null ||
          source["body_ciphertext"] === null ||
          source["content_type"] !== "text"
        )
          return { kind: "ignored", reason: "customer_binding_invalid" };
        if (
          source["processing_status"] === "processed" ||
          source["processing_status"] === "suppressed" ||
          source["ai_run_id"] !== null
        )
          return { kind: "ignored", reason: "already_processed" };
        const candidates = await executeTenantRead(
          session,
          `select id from appointment_requests where organization_id=$1 and lead_id=$2 and conversation_id=$3 and contact_id=$4
          and status in ('staff_accepted','awaiting_customer_confirmation') order by created_at desc limit 2 for update`,
          [conversation.leadId, conversation.conversationId, conversation.contactId],
        );
        const text = options.dataProtection.revealMessageBody({
          organizationId: session.organizationId,
          channelConnectionId: conversation.channelConnectionId,
          contentType: "text",
          ciphertext: mapBytes(source["body_ciphertext"]),
        });
        if (text === null) return { kind: "ignored", reason: "customer_binding_invalid" };
        const mark = async (): Promise<void> => {
          await executeTenantWrite(
            session,
            `update messages set processing_status='processed' where organization_id=$1 and id=$2 and processing_status in ('accepted','processing')`,
            [reference.messageId],
          );
        };
        const intent = confirmationReplyIntent(text);
        if (intent === "medical") {
          await mark();
          return { kind: "grounding_insufficient", reason: "medical_safety_wording_unapproved" };
        }
        if (candidates.length === 0) {
          const terminal = await executeTenantRead(
            session,
            `select id from appointment_requests where organization_id=$1 and lead_id=$2 and conversation_id=$3 and contact_id=$4 and status in ('confirmed','rejected','cancelled','expired') order by created_at desc limit 1`,
            [conversation.leadId, conversation.conversationId, conversation.contactId],
          );
          if (terminal.length !== 0 && intent !== "clarify") {
            await mark();
            return { kind: "ignored", reason: "terminal_confirmation" };
          }
          return { kind: "not_applicable", reason: null };
        }
        const channel = await boundChannel(session, conversation, now);
        if (channel === null) return { kind: "ignored", reason: "customer_binding_invalid" };
        const newer = await executeTenantRead(
          session,
          `select id from messages where organization_id=$1 and conversation_id=$2 and direction='inbound' and sender_type='customer' and sequence_no>$3 limit 1`,
          [conversation.conversationId, mapSafeBigInt(source["sequence_no"])],
        );
        if (newer.length !== 0) {
          await mark();
          return { kind: "ignored", reason: "stale_customer_message" };
        }
        if (candidates.length !== 1) {
          await reply(
            session,
            conversation,
            "clarify",
            "",
            reference.correlationId,
            reference.causationId,
            now,
            reference.messageId,
            undefined,
            confirmationLocale(text, conversation.preferredLocale),
          );
          await mark();
          return { kind: "clarification", reason: "ambiguous_confirmation" };
        }
        const requestRow = await createAppointmentRepository(session).getAppointmentRequest(
          mapAppointmentRequestId(candidates[0]?.["id"]),
        );
        const prompt = await executeTenantRead(
          session,
          `select m.sequence_no from messages m join appointment_request_transitions t on t.organization_id=m.organization_id and t.appointment_request_id=$3
          and t.command='prepare_customer_confirmation' and t.to_status='awaiting_customer_confirmation' and t.aggregate_version=$4
          where m.organization_id=$1 and m.conversation_id=$2 and m.direction='outbound' and m.created_at=t.occurred_at and m.ai_run_id is null
          and m.knowledge_manifest_jsonb->>'confirmation_profile'=$5 and m.knowledge_manifest_jsonb->>'confirmation_kind'='prompt'
          and m.knowledge_manifest_jsonb->>'confirmation_request_id'=$3::text and t.offer_version=$6
          and m.knowledge_manifest_jsonb->>'confirmation_offer_version'=$6::text order by m.sequence_no desc limit 2`,
          [
            conversation.conversationId,
            requestRow.appointmentRequestId,
            requestRow.version,
            CUSTOMER_CONFIRMATION_PROFILE,
            requestRow.offerVersion,
          ],
        );
        const received = mapUtcTimestamp(source["created_at"]);
        if (Date.parse(received) > now.getTime()) {
          await mark();
          return { kind: "ignored", reason: "invalid_customer_receipt_time" };
        }
        if (
          source["external_sent_at"] === null ||
          requestRow.confirmationIssuedAt === null ||
          Date.parse(mapUtcTimestamp(source["external_sent_at"])) <
            Date.parse(requestRow.confirmationIssuedAt) ||
          Date.parse(mapUtcTimestamp(source["external_sent_at"])) > Date.parse(received)
        ) {
          await mark();
          return { kind: "ignored", reason: "stale_customer_message" };
        }
        if (
          requestRow.status !== "awaiting_customer_confirmation" ||
          requestRow.confirmationIssuedAt === null ||
          prompt.length !== 1 ||
          mapSafeBigInt(source["sequence_no"]) <= mapSafeBigInt(prompt[0]?.["sequence_no"]) ||
          Date.parse(received) < Date.parse(requestRow.confirmationIssuedAt)
        ) {
          await mark();
          return { kind: "ignored", reason: "confirmation_not_requested" };
        }
        const request = await loadRequest(session, requestRow);
        if (
          requestRow.offerExpiresAt === null ||
          Date.parse(received) >= Date.parse(requestRow.offerExpiresAt) ||
          now.getTime() >= Date.parse(requestRow.offerExpiresAt)
        ) {
          await persist(
            session,
            request,
            expireAppointmentRequest(request, {
              actor: system,
              organizationId: session.organizationId,
              expectedVersion: request.version,
              now: mapUtcTimestamp(now),
              reasonCode: reason("confirmation_window_expired"),
            }),
            system,
            reference.correlationId,
            reference.causationId,
            now,
          );
          await reply(
            session,
            conversation,
            "expired",
            request.offer?.localStart ?? "",
            reference.correlationId,
            reference.causationId,
            now,
            reference.messageId,
            undefined,
            confirmationLocale(text, conversation.preferredLocale),
          );
          await mark();
          return { kind: "ignored", reason: "offer_expired" };
        }
        if (intent === "clarify") {
          await reply(
            session,
            conversation,
            "clarify",
            request.offer?.localStart ?? "",
            reference.correlationId,
            reference.causationId,
            now,
            reference.messageId,
            undefined,
            confirmationLocale(text, conversation.preferredLocale),
          );
          await mark();
          return { kind: "clarification", reason: "unproven_customer_intent" };
        }
        const actor: unknown = { actor_type: "customer", actor_id: conversation.contactId };
        if (!isSchemaValue(ActorRefSchema, actor) || actor.actor_type !== "customer")
          throw new RepositoryDataIntegrityError();
        const context = {
          actor,
          organizationId: session.organizationId,
          expectedVersion: request.version,
        };
        const result =
          intent === "decline"
            ? cancelAppointmentRequest(request, {
                ...context,
                occurredAt: mapUtcTimestamp(now),
                initiator: {
                  kind: "customer",
                  contact: {
                    organizationId: session.organizationId,
                    contactId: conversation.contactId,
                  },
                },
                reasonCode: reason("customer_declined"),
              })
            : confirmAppointmentRequest(request, {
                ...context,
                now: mapUtcTimestamp(now),
                evidence: {
                  appointmentRequest: {
                    organizationId: session.organizationId,
                    appointmentRequestId: request.appointmentRequestId,
                  },
                  contact: {
                    organizationId: session.organizationId,
                    contactId: conversation.contactId,
                  },
                  customerActedAt: received,
                  evidence: {
                    organizationId: session.organizationId,
                    evidenceId: mapResourceId(nextId()),
                  },
                  offerVersion:
                    request.confirmationOffer?.offerVersion ??
                    (() => {
                      throw new RepositoryDataIntegrityError();
                    })(),
                  ...(channel === "customer_session"
                    ? { source: channel }
                    : {
                        source: channel,
                        sourceMessage: {
                          organizationId: session.organizationId,
                          messageId: reference.messageId,
                        },
                      }),
                },
              });
        await persist(
          session,
          request,
          result,
          actor,
          reference.correlationId,
          reference.causationId,
          now,
          reference.messageId,
        );
        await reply(
          session,
          conversation,
          intent === "confirm" ? "confirmed" : "declined",
          request.offer?.localStart ?? "",
          reference.correlationId,
          reference.causationId,
          now,
          reference.messageId,
          undefined,
          confirmationLocale(text, conversation.preferredLocale),
        );
        await mark();
        return { kind: intent === "confirm" ? "confirmed" : "declined", reason: null };
      });
    },
  };
};
