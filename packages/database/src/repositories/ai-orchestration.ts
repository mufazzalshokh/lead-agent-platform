import { createHash } from "node:crypto";
import {
  AI_CONTEXT_LIMITS,
  aiFallback,
  validateAgentDecision,
  type AIContextSnapshot,
  type AIOrchestrationStore,
  type AIOutcome,
  type AIWorkReference,
  type AIRunFinish,
  type AIFact,
} from "@lead-agent/application";
import {
  AgentFactualClaimSchema,
  ConversationIdSchema,
  CorrelationIdSchema,
  MessageIdSchema,
  OrganizationIdSchema,
  DomainEventSchemasByVersion,
  isSchemaValue,
  type DomainEvent,
} from "@lead-agent/contracts";
import { createSecurityIdentifierFactory, type CustomerDataProtection } from "@lead-agent/security";
import type { QueryResultRow } from "pg";
import type { TenantDatabaseRuntime, TenantDbSession } from "../runtime/tenant.js";
import { createConversationRepository } from "./conversations.js";
import { createCustomerRepository } from "./customers.js";
import { createLeadRepository } from "./leads.js";
import {
  executeTenantRead,
  executeTenantWrite,
  mapBytes,
  mapEnum,
  mapMessageId,
  mapContactId,
  mapChannelConnectionId,
  mapSafeBigInt,
  mapString,
  RepositoryDataIntegrityError,
} from "./shared.js";

type SourceRow = QueryResultRow & {
  id: unknown;
  sequence_no: unknown;
  sender_type: unknown;
  content_type: unknown;
  body_ciphertext: unknown;
  ai_run_id: unknown;
  redacted_at: unknown;
  sender_contact_id: unknown;
  channel_connection_id: unknown;
};
type AIStoreOptions = Readonly<{
  requestedModel: string;
  dataProtection: CustomerDataProtection;
  protectProposal: (
    input: Readonly<{
      organizationId: AIWorkReference["organizationId"];
      runId: string;
      argumentsJSON: string;
    }>,
  ) => Uint8Array;
  /** Optional approved knowledge seam. S12 defaults to no facts; S14 owns grounded product behavior. */
  knowledge?: (
    session: TenantDbSession,
    snapshot: Readonly<{
      conversationId: AIWorkReference["conversationId"];
      locale: AIContextSnapshot["locale"];
    }>,
  ) => Promise<readonly AIFact[]>;
  clock?: () => Date;
}>;
const hash = (value: unknown): Uint8Array =>
  createHash("sha256").update(JSON.stringify(value)).digest();
const manifestSources = (snapshot: AIContextSnapshot) => {
  const facts = snapshot.policy.facts;
  if (
    facts.length > AI_CONTEXT_LIMITS.facts ||
    facts.some((fact) => !isSchemaValue(AgentFactualClaimSchema, fact.reference))
  )
    return [];
  return facts.map(({ reference }) => ({
    claim_kind: reference.claim_kind,
    source_type: reference.source_type,
    source_id: reference.source_id,
    source_version: reference.source_version,
  }));
};
const requireReference = (reference: AIWorkReference): void => {
  if (
    !isSchemaValue(OrganizationIdSchema, reference.organizationId) ||
    !isSchemaValue(ConversationIdSchema, reference.conversationId) ||
    !isSchemaValue(MessageIdSchema, reference.messageId) ||
    !isSchemaValue(CorrelationIdSchema, reference.correlationId) ||
    !isSchemaValue(MessageIdSchema, reference.causationId)
  )
    throw new RepositoryDataIntegrityError();
};
const source = async (
  session: TenantDbSession,
  reference: AIWorkReference,
  lock = false,
): Promise<SourceRow | null> => {
  const rows = await executeTenantRead<SourceRow>(
    session,
    `select id,sequence_no,sender_type,content_type,body_ciphertext,ai_run_id,redacted_at,sender_contact_id,channel_connection_id from messages
      where organization_id = $1 and id = $2 and conversation_id = $3
        and direction = 'inbound' and sender_type = 'customer'${lock ? " for update" : ""}`,
    [reference.messageId, reference.conversationId],
  );
  return rows[0] ?? null;
};
export const createAIOrchestrationStore = (
  runtime: TenantDatabaseRuntime,
  options: AIStoreOptions,
): AIOrchestrationStore => {
  if (
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,254}$/u.test(options.requestedModel) ||
    options.requestedModel === "latest"
  )
    throw new TypeError("Invalid requested model");
  const identifiers = createSecurityIdentifierFactory();
  const now = options.clock ?? (() => new Date());
  const nextId = (): string => identifiers.issueResourceId(now());
  const load = async (reference: AIWorkReference): Promise<AIContextSnapshot | null> => {
    requireReference(reference);
    return await runtime.withTenantTransaction(reference.organizationId, async (session) => {
      const message = await source(session, reference);
      if (
        message === null ||
        message.redacted_at !== null ||
        message.body_ciphertext === null ||
        message.ai_run_id !== null
      )
        return null;
      const conversation = await createConversationRepository(session).getConversation(
        reference.conversationId,
      );
      if (
        mapContactId(message.sender_contact_id) !== conversation.contactId ||
        mapChannelConnectionId(message.channel_connection_id) !== conversation.channelConnectionId
      )
        return null;
      if (conversation.status !== "open" || conversation.automationMode !== "ai") return null;
      const contact = await createCustomerRepository(session).getContact(conversation.contactId);
      if (contact.status !== "active") return null;
      const text = options.dataProtection.revealMessageBody({
        organizationId: session.organizationId,
        channelConnectionId: conversation.channelConnectionId,
        contentType: mapEnum(message.content_type, ["text", "attachment", "quick_reply"] as const),
        ciphertext: mapBytes(message.body_ciphertext),
      });
      if (text === null) return null;
      const sequence = mapSafeBigInt(message.sequence_no);
      const historyRows = await executeTenantRead<SourceRow>(
        session,
        `select id,sequence_no,sender_type,content_type,body_ciphertext,ai_run_id,redacted_at from messages
        where organization_id = $1 and conversation_id = $2 and sequence_no < $3 and direction in ('inbound','outbound') and redacted_at is null and body_ciphertext is not null
        order by sequence_no desc limit 12`,
        [reference.conversationId, sequence],
      );
      const history = historyRows.map((row) => ({
        sequence: mapSafeBigInt(row.sequence_no),
        role:
          mapEnum(row.sender_type, ["customer", "member", "system"] as const) === "customer"
            ? ("customer" as const)
            : ("staff" as const),
        text:
          options.dataProtection.revealMessageBody({
            organizationId: session.organizationId,
            channelConnectionId: conversation.channelConnectionId,
            contentType: mapEnum(row.content_type, ["text", "attachment", "quick_reply"] as const),
            ciphertext: mapBytes(row.body_ciphertext),
          }) ?? "",
      }));
      const identityRows = await executeTenantRead(
        session,
        `select identity_type from contact_identities where organization_id = $1 and contact_id = $2 and status = 'active' and validation_status in ('valid','verified') and (channel_connection_id is null or channel_connection_id = $3)`,
        [conversation.contactId, conversation.channelConnectionId],
      );
      const identityTypes = identityRows.map((row) => mapString(row["identity_type"]));
      const widgetBindings = await executeTenantRead(
        session,
        `select id from widget_sessions where organization_id = $1 and contact_id = $2 and conversation_id = $3 and channel_connection_id = $4 and status = 'active' and revoked_at is null and expires_at > $5 limit 1`,
        [
          conversation.contactId,
          conversation.conversationId,
          conversation.channelConnectionId,
          now(),
        ],
      );
      const lead = await createLeadRepository(session).getLead(conversation.leadId);
      const missingFields: AIContextSnapshot["policy"]["missingFields"][number][] = [
        "appointment_time",
      ];
      if (lead.serviceId === null) missingFields.push("service");
      if (lead.locationId === null) missingFields.push("location");
      if (contact.displayNameCiphertext === null) missingFields.push("name");
      if (!identityTypes.includes("phone")) missingFields.push("phone");
      if (!identityTypes.includes("email")) missingFields.push("email");
      const facts =
        (await options.knowledge?.(session, {
          conversationId: reference.conversationId,
          locale: conversation.preferredLocale,
        })) ?? [];
      return Object.freeze({
        conversationId: reference.conversationId,
        sourceMessageId: mapMessageId(message.id),
        channelConnectionId: conversation.channelConnectionId,
        conversationVersion: conversation.version,
        sourceSequence: sequence,
        locale: conversation.preferredLocale,
        message: text,
        history: Object.freeze(history),
        policy: Object.freeze({
          automationMode: conversation.automationMode,
          conversationStatus: conversation.status,
          missingFields: Object.freeze(missingFields),
          contactableWithoutPhone:
            identityTypes.some((type) => ["telegram_user", "instagram_user"].includes(type)) ||
            (identityTypes.includes("widget_participant") && widgetBindings.length === 1),
          facts,
          appointments: [],
        }),
      });
    });
  };
  return Object.freeze<AIOrchestrationStore>({
    load,
    reserve: async (input) => {
      requireReference(input.reference);
      if (
        input.snapshot.conversationId !== input.reference.conversationId ||
        input.snapshot.sourceMessageId !== input.reference.messageId
      )
        throw new RepositoryDataIntegrityError();
      return await runtime.withTenantTransaction(
        input.reference.organizationId,
        async (session) => {
          const message = await source(session, input.reference, true);
          if (message === null || message.ai_run_id !== null || message.redacted_at !== null)
            return null;
          const conversation = await createConversationRepository(session).getConversation(
            input.reference.conversationId,
          );
          if (
            conversation.version !== input.snapshot.conversationVersion ||
            conversation.automationMode !== "ai" ||
            conversation.status !== "open" ||
            mapContactId(message.sender_contact_id) !== conversation.contactId ||
            mapChannelConnectionId(message.channel_connection_id) !==
              conversation.channelConnectionId
          )
            return null;
          const attempts = await executeTenantRead(
            session,
            `select coalesce(max(attempt_no),0) + 1 as attempt from ai_runs where organization_id = $1 and trigger_message_id = $2 and provider_id = 'openai'`,
            [input.reference.messageId],
          );
          const attemptNo = mapSafeBigInt(attempts[0]?.["attempt"]);
          if (attemptNo > 32) return null;
          const runId = nextId();
          await executeTenantWrite(
            session,
            `insert into ai_runs
          (organization_id,id,conversation_id,trigger_message_id,expected_conversation_version,provider_id,requested_model_id,model_profile_version,orchestrator_version,prompt_template_version,decision_schema_version,policy_version,status,cost_currency,cost_catalog_version,attempt_no,knowledge_manifest_jsonb,input_hash,started_at,correlation_id)
          values ($1,$2,$3,$4,$5,'openai',$6,'s12-configured.v1','s12-orchestrator.v1','s12-instructions.v1','1','s12-policy.v1','started','USD','not-priced.v1',$7,$8::jsonb,$9,$10,$11)`,
            [
              runId,
              input.reference.conversationId,
              input.reference.messageId,
              input.snapshot.conversationVersion,
              options.requestedModel,
              attemptNo,
              JSON.stringify({
                sources: manifestSources(input.snapshot),
              }),
              input.inputHash,
              now(),
              input.reference.correlationId,
            ],
          );
          return Object.freeze({ runId, attemptNo });
        },
      );
    },
    finish: async (input): Promise<AIOutcome> => {
      requireReference(input.reference);
      return await runtime.withTenantTransaction(input.reference.organizationId, async (session) =>
        finishAIRun(session, input, options, nextId, now),
      );
    },
  });
};

const finishAIRun = async (
  session: TenantDbSession,
  input: AIRunFinish,
  options: AIStoreOptions,
  nextId: () => string,
  now: () => Date,
): Promise<AIOutcome> => {
  const message = await source(session, input.reference, true);
  if (message === null) throw new RepositoryDataIntegrityError();
  const runRows = await executeTenantRead(
    session,
    `select status,started_at from ai_runs where organization_id = $1 and id = $2 and trigger_message_id = $3 and conversation_id = $4 for update`,
    [input.reservation.runId, input.reference.messageId, input.reference.conversationId],
  );
  const run = runRows[0];
  if (run === undefined) throw new RepositoryDataIntegrityError();
  if (run["status"] !== "started") return aiFallback("stale_context");
  await executeTenantRead(
    session,
    `select id from conversations where organization_id = $1 and id = $2 for update`,
    [input.reference.conversationId],
  );
  const conversation = await createConversationRepository(session).getConversation(
    input.reference.conversationId,
  );
  const contact = await createCustomerRepository(session).getContact(conversation.contactId);
  const latest = await executeTenantRead(
    session,
    `select max(sequence_no) as sequence_no from messages where organization_id = $1 and conversation_id = $2 and direction = 'inbound'`,
    [input.reference.conversationId],
  );
  let outcome = input.outcome;
  if (
    mapContactId(message.sender_contact_id) !== conversation.contactId ||
    mapChannelConnectionId(message.channel_connection_id) !== conversation.channelConnectionId
  )
    outcome = aiFallback("stale_context");
  if (
    message.ai_run_id !== null ||
    message.redacted_at !== null ||
    contact.status !== "active" ||
    conversation.version !== input.snapshot.conversationVersion ||
    conversation.automationMode !== "ai" ||
    conversation.status !== "open" ||
    mapSafeBigInt(latest[0]?.["sequence_no"]) !== input.snapshot.sourceSequence
  )
    outcome = aiFallback("stale_context");
  if (options.knowledge !== undefined) {
    const currentFacts = await options.knowledge(session, {
      conversationId: conversation.conversationId,
      locale: conversation.preferredLocale,
    });
    if (!Buffer.from(hash(currentFacts)).equals(Buffer.from(hash(input.snapshot.policy.facts))))
      outcome = aiFallback("stale_context");
  }
  const value = input.provider?.kind === "completed" ? input.provider.value : null;
  const schemaValid = input.provider?.kind === "completed" ? validateAgentDecision(value) : null;
  const decision = validateAgentDecision(value) ? value : null;
  const outputHash =
    input.provider?.outputHash ??
    (input.provider?.kind === "completed" ? hash(input.provider.value) : null);
  const schemaRejected =
    outcome.kind === "fallback_required" &&
    outcome.reason === "invalid_output" &&
    input.provider?.model != null &&
    outputHash !== null;
  const policyDenied =
    outcome.kind === "fallback_required" && outcome.reason === "policy_denied" && decision !== null;
  const status =
    outcome.kind === "decision"
      ? "succeeded"
      : outcome.reason === "stale_context"
        ? "stale"
        : schemaRejected
          ? "schema_rejected"
          : policyDenied
            ? "policy_denied"
            : "failed";
  const category = outcome.kind === "fallback_required" ? outcome.reason : null;
  const failureCategory =
    status === "failed" && input.provider?.kind === "provider_error"
      ? `provider_${input.provider.category}`
      : status === "failed" && input.provider?.kind === "incomplete"
        ? `provider_incomplete_${input.provider.reason}`
        : category;
  const finished = now();
  if (!(run["started_at"] instanceof Date)) throw new RepositoryDataIntegrityError();
  const finishedAt = new Date(Math.max(finished.getTime(), run["started_at"].getTime()));
  const usage = input.provider?.usage;
  await executeTenantWrite(
    session,
    `update ai_runs set status=$3,provider_resolved_model_id=$4,input_units=$5,output_units=$6,cached_input_units=$7,reasoning_units=$8,total_units=$9,latency_ms=$10,failure_category=$11,output_hash=$12,schema_valid=$13,policy_allowed=$14,finished_at=$15 where organization_id = $1 and id = $2`,
    [
      input.reservation.runId,
      status,
      input.provider?.model ?? null,
      usage?.input ?? null,
      usage?.output ?? null,
      usage?.cachedInput ?? null,
      usage?.reasoning ?? null,
      usage?.total ?? null,
      finishedAt.getTime() - run["started_at"].getTime(),
      failureCategory,
      outputHash,
      schemaRejected ? false : schemaValid,
      decision === null ? null : outcome.kind === "decision",
      finishedAt,
    ],
  );
  if (decision !== null) {
    const argumentsJSON = JSON.stringify(decision.action);
    await executeTenantWrite(
      session,
      `insert into ai_action_evaluations (organization_id,id,ai_run_id,action_name,action_schema_version,proposal_hash,arguments_ciphertext,validation_status,policy_reason_code,application_status,started_at,finished_at)
      values ($1,$2,$3,$4,'1',$5,$6,$7,$8,'not_applied',$9,$10)`,
      [
        nextId(),
        input.reservation.runId,
        decision.action.type,
        hash(decision.action),
        options.protectProposal({
          organizationId: session.organizationId,
          runId: input.reservation.runId,
          argumentsJSON,
        }),
        outcome.kind === "decision" ? "allowed" : "denied",
        category,
        run["started_at"],
        finishedAt,
      ],
    );
  }
  const eventType =
    status === "succeeded"
      ? "ai_run.completed"
      : status === "schema_rejected"
        ? "ai_run.schema_rejected"
        : status === "policy_denied"
          ? "ai_run.policy_denied"
          : "ai_run.failed";
  const payload =
    eventType === "ai_run.completed"
      ? { ai_run_outcome: "completed", proposed_action: decision?.action.type }
      : eventType === "ai_run.schema_rejected"
        ? {
            ai_run_outcome: "schema_rejected",
            decision_schema_id: "AgentDecision.v1",
            decision_schema_version: "1",
          }
        : eventType === "ai_run.policy_denied"
          ? {
              ai_run_outcome: "policy_denied",
              proposed_action: decision?.action.type,
              reason_code: category,
            }
          : {
              ai_run_outcome: "failed",
              failure_category: failureCategory ?? "provider_unavailable",
            };
  const schemaId: unknown = Reflect.get(DomainEventSchemasByVersion[eventType]["1"], "$id");
  const event: unknown = {
    actor: { actor_type: "system", actor_id: null },
    aggregate_id: input.reservation.runId,
    aggregate_type: "ai_run",
    aggregate_version: 1,
    causation_id: input.reference.causationId,
    correlation_id: input.reference.correlationId,
    event_id: nextId(),
    event_type: eventType,
    occurred_at: finishedAt.toISOString(),
    organization_id: session.organizationId,
    payload,
    request_id: null,
    schema_id: schemaId,
    schema_version: "1",
  };
  if (!isSchemaValue(DomainEventSchemasByVersion[eventType]["1"], event))
    throw new RepositoryDataIntegrityError();
  const envelope: DomainEvent = event;
  await executeTenantWrite(
    session,
    `insert into audit_events (organization_id,id,event_type,actor_type,actor_id,target_type,target_id,action,result,reason_code,request_id,correlation_id,metadata_redacted_jsonb,occurred_at)
    values ($1,$2,$3,'system',null,'ai_run',$4,$3,'succeeded',$5,$6,$7,$8::jsonb,$9)`,
    [
      nextId(),
      eventType,
      input.reservation.runId,
      category,
      `ai-run:${input.reservation.runId}`,
      input.reference.correlationId,
      JSON.stringify({ status, attempt_no: input.reservation.attemptNo }),
      finishedAt,
    ],
  );
  await executeTenantWrite(
    session,
    `insert into outbox_events (organization_id,id,event_type,schema_version,aggregate_type,aggregate_id,aggregate_version,payload_jsonb,correlation_id,causation_id,occurred_at,status,available_at)
    values ($1,$2,$3,'1','ai_run',$4,1,$5::jsonb,$6,$7,$8,'pending',$8)`,
    [
      envelope.event_id,
      eventType,
      input.reservation.runId,
      JSON.stringify(envelope),
      input.reference.correlationId,
      input.reference.causationId,
      finishedAt,
    ],
  );
  // A rejected schema attempt stays eligible for ONE bounded repair. First terminal
  // winner owns the message; other physical calls finalize as stale attempts only.
  if (
    message.ai_run_id === null &&
    !(
      outcome.kind === "fallback_required" &&
      outcome.reason === "invalid_output" &&
      input.allowRepair
    )
  ) {
    await executeTenantWrite(
      session,
      `update messages set ai_run_id=$3,processing_status=$4 where organization_id = $1 and id = $2 and ai_run_id is null`,
      [
        input.reference.messageId,
        input.reservation.runId,
        outcome.kind === "decision" ? "processed" : "suppressed",
      ],
    );
  }
  return outcome;
};
