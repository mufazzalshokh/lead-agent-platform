import type { AIRunFinish, SalesPlan, SalesResult } from "@lead-agent/application";
import {
  DomainEventSchema,
  RequestIdSchema,
  isSchemaValue,
  type ResourceId,
  type RequestId,
  type UtcTimestamp,
} from "@lead-agent/contracts";
import { qualifyLead, requestHandoffWorkflow, validateHandoffQueueKey } from "@lead-agent/domain";
import type { TenantDbSession } from "../runtime/tenant.js";
import { createConversationRepository } from "./conversations.js";
import { createLeadRepository } from "./leads.js";
import { persistDomainMutationPlan } from "./mutations.js";
import type {
  CoreDomainEventDraft,
  DomainEventAppend,
  CoreTransitionPersistence,
  NonEmptyReadonlyArray,
  TenantMutationAudit,
} from "./mutation-types.js";
import {
  executeTenantRead,
  executeTenantWrite,
  mapAggregateVersion,
  mapHandoffId,
  mapResourceId,
  mapUtcTimestamp,
  RepositoryDataIntegrityError,
} from "./shared.js";

const nonempty = <T>(values: readonly T[]): NonEmptyReadonlyArray<T> => {
  const [first, ...rest] = values;
  if (first === undefined) throw new RepositoryDataIntegrityError();
  return [first, ...rest];
};
const system = Object.freeze({ actor_type: "system", actor_id: null } as const);
const eventAppend = (
  session: TenantDbSession,
  input: AIRunFinish,
  draft: CoreDomainEventDraft,
  id: string,
  aggregateType: "lead" | "conversation" | "handoff",
  nextId: () => string,
  occurredAt: UtcTimestamp,
): DomainEventAppend => {
  const envelope: unknown = {
    ...draft,
    actor: system,
    aggregate_id: id,
    aggregate_type: aggregateType,
    organization_id: session.organizationId,
    event_id: nextId(),
    correlation_id: input.reference.correlationId,
    causation_id: input.reference.causationId,
    occurred_at: occurredAt,
    request_id: null,
  };
  if (
    !isSchemaValue(DomainEventSchema, envelope) ||
    (envelope.aggregate_type !== "lead" &&
      envelope.aggregate_type !== "conversation" &&
      envelope.aggregate_type !== "handoff")
  )
    throw new RepositoryDataIntegrityError();
  return { draft, envelope };
};
const audit = (
  input: AIRunFinish,
  nextId: () => string,
  occurredAt: UtcTimestamp,
  target: TenantMutationAudit["target"],
): TenantMutationAudit => ({
  actor: system,
  actorMembershipId: null,
  auditId: mapResourceId(nextId()),
  correlationId: input.reference.correlationId,
  occurredAt,
  requestId: requestId(input.reservation.runId),
  target,
});
const requestId = (runId: string): RequestId => {
  const value = `s15:${runId}`;
  // Reuse the repository's canonical request identifier validation, not a cast.
  if (!isSchemaValue(RequestIdSchema, value)) throw new RepositoryDataIntegrityError();
  return value;
};

const appendEvaluation = async (
  session: TenantDbSession,
  input: AIRunFinish,
  plan: SalesPlan,
  nextId: () => string,
  occurredAt: UtcTimestamp,
): Promise<ResourceId | null> => {
  const context = input.snapshot.sales;
  if (context?.policy === null || context === undefined) return null;
  const evaluationId = mapResourceId(nextId());
  await executeTenantWrite(
    session,
    `insert into lead_qualification_evaluations
    (organization_id,id,lead_id,business_policy_id,result,reason_codes,facts_jsonb,evaluated_by,member_id,occurred_at)
    values ($1,$2,$3,$4,$5,'{}',$6::jsonb,'system',null,$7)`,
    [
      evaluationId,
      context.leadId,
      context.policy.id,
      plan.result.missing.length === 0 ? "qualified" : "incomplete",
      JSON.stringify({
        schema_version: "s15.v1",
        evidence: plan.evidence,
        contactable: context.contactable,
        policy_version: context.policy.version,
      }),
      occurredAt,
    ],
  );
  const sources = [
    { field: "evaluation_source", messageId: input.reference.messageId },
    { field: "service_interest", messageId: plan.evidence.serviceMessageId },
    { field: "service_location_fit", messageId: plan.evidence.locationMessageId },
    { field: "positive_next_step_intent", messageId: plan.evidence.nextStepMessageId },
  ];
  for (const source of sources) {
    if (source.messageId === null) continue;
    const rows = await executeTenantRead(
      session,
      `select id from messages where organization_id=$1 and id=$2 and conversation_id=$3 and sender_type='customer' and direction='inbound' and sequence_no<=$4 and redacted_at is null for share`,
      [source.messageId, input.reference.conversationId, input.snapshot.sourceSequence],
    );
    if (rows.length !== 1) throw new RepositoryDataIntegrityError();
    await executeTenantWrite(
      session,
      `insert into lead_qualification_evidence (organization_id,evaluation_id,message_id,field_key,evidence_kind,created_at) values ($1,$2,$3,$4,'customer_statement',$5)`,
      [evaluationId, source.messageId, source.field, occurredAt],
    );
  }
  await executeTenantWrite(
    session,
    `insert into audit_events (organization_id,id,event_type,actor_type,actor_id,target_type,target_id,action,result,request_id,correlation_id,metadata_redacted_jsonb,occurred_at)
    values ($1,$2,'lead.qualification_evaluated','system',null,'lead',$3,'lead.qualification_evaluated','succeeded',$4,$5,$6::jsonb,$7)`,
    [
      nextId(),
      context.leadId,
      requestId(input.reservation.runId),
      input.reference.correlationId,
      JSON.stringify({
        evaluation_id: evaluationId,
        policy_id: context.policy.id,
        missing: plan.result.missing,
      }),
      occurredAt,
    ],
  );
  return evaluationId;
};

/** Called inside the AI terminal transaction; no separate pool, retry, or side effect. */
export const persistSalesPlan = async (
  session: TenantDbSession,
  input: AIRunFinish,
  plan: SalesPlan,
  nextId: () => string,
  now: Date,
): Promise<Readonly<{ result: SalesResult; conversationVersion: number }>> => {
  const occurredAt = mapUtcTimestamp(now),
    context = input.snapshot.sales;
  const conversation = await createConversationRepository(session).getConversation(
    input.reference.conversationId,
  );
  if (context === undefined || plan.text === null)
    return { result: plan.result, conversationVersion: conversation.version };
  const lead = await createLeadRepository(session).getLead(conversation.leadId);
  if (lead.version !== context.leadVersion || lead.leadId !== context.leadId)
    throw new RepositoryDataIntegrityError();
  if (plan.handoffReason !== null) {
    const queue = validateHandoffQueueKey("staff");
    if (!queue.ok) throw new RepositoryDataIntegrityError();
    const workflow = requestHandoffWorkflow(
      {
        conversationId: conversation.conversationId,
        contactId: conversation.contactId,
        leadId: conversation.leadId,
        channelConnectionId: conversation.channelConnectionId,
        organizationId: session.organizationId,
        activeHandoff: null,
        automationMode: conversation.automationMode,
        status: conversation.status,
        version: mapAggregateVersion(conversation.version),
      },
      {
        conversation: {
          actor: system,
          organizationId: session.organizationId,
          occurredAt,
          expectedVersion: mapAggregateVersion(conversation.version),
        },
        handoff: {
          actor: system,
          organizationId: session.organizationId,
          occurredAt,
          handoffId: mapHandoffId(nextId()),
          conversation: {
            conversationId: conversation.conversationId,
            organizationId: session.organizationId,
          },
          lead: { leadId: lead.leadId, organizationId: session.organizationId },
          location:
            plan.evidence.locationId === null
              ? null
              : { locationId: plan.evidence.locationId, organizationId: session.organizationId },
          queueKey: queue.value,
          slaDueAt: mapUtcTimestamp(new Date(now.getTime() + 60 * 60 * 1_000)),
          triggerReason: plan.handoffReason,
        },
      },
    );
    if (!workflow.ok) throw new RepositoryDataIntegrityError();
    const value = workflow.value;
    const transitions: CoreTransitionPersistence[] = value.transitionRecords.map((record) =>
      "handoffId" in record
        ? {
            transitionType: "handoff",
            record,
            correlationId: input.reference.correlationId,
            transitionId: mapResourceId(nextId()),
            conversationDisposition: null,
          }
        : { transitionType: "conversation", record },
    );
    await persistDomainMutationPlan(session, {
      aggregates: [
        { aggregateType: "handoff", mode: "create", nextAggregate: value.handoff },
        {
          aggregateType: "conversation",
          mode: "update",
          expectedVersion: mapAggregateVersion(conversation.version),
          nextAggregate: value.conversation,
        },
      ],
      audits: [
        audit(input, nextId, occurredAt, {
          targetType: "handoff",
          targetId: value.handoff.handoffId,
        }),
        audit(input, nextId, occurredAt, {
          targetType: "conversation",
          targetId: conversation.conversationId,
        }),
      ],
      transitions: nonempty(transitions),
      events: nonempty(
        value.events.map((draft) =>
          eventAppend(
            session,
            input,
            draft,
            draft.event_type.startsWith("handoff.")
              ? value.handoff.handoffId
              : conversation.conversationId,
            draft.event_type.startsWith("handoff.") ? "handoff" : "conversation",
            nextId,
            occurredAt,
          ),
        ),
      ),
    });
    return { result: plan.result, conversationVersion: value.conversation.version };
  }
  const evaluationId = await appendEvaluation(session, input, plan, nextId, occurredAt);
  if (evaluationId !== null && plan.result.missing.length === 0 && lead.status === "engaged") {
    if (context.policy === null || plan.evidence.serviceId === null)
      throw new RepositoryDataIntegrityError();
    const transition = qualifyLead(
      {
        leadId: lead.leadId,
        contactId: lead.contactId,
        organizationId: session.organizationId,
        version: mapAggregateVersion(lead.version),
        status: "engaged",
        qualification: null,
        appointmentRequestId: null,
      },
      {
        actor: system,
        organizationId: session.organizationId,
        occurredAt,
        expectedVersion: mapAggregateVersion(lead.version),
        qualification: {
          evaluationId,
          organizationId: session.organizationId,
          policyId: context.policy.id,
        },
      },
    );
    if (!transition.ok) throw new RepositoryDataIntegrityError();
    // These storage facts belong to the SAME locked, audited qualification CAS,
    // never a second transition or an unversioned incomplete Lead update.
    const updated = await executeTenantWrite(
      session,
      `update leads set service_id=$3,location_id=$4 where organization_id=$1 and id=$2 and version=$5`,
      [lead.leadId, plan.evidence.serviceId, plan.evidence.locationId, lead.version],
    );
    if (updated.rowCount !== 1) throw new RepositoryDataIntegrityError();
    await persistDomainMutationPlan(session, {
      aggregates: [
        {
          aggregateType: "lead",
          mode: "update",
          expectedVersion: mapAggregateVersion(lead.version),
          nextAggregate: transition.value.nextAggregate,
        },
      ],
      audits: [audit(input, nextId, occurredAt, { targetType: "lead", targetId: lead.leadId })],
      transitions: nonempty(
        transition.value.transitionRecords.map((record) => ({
          transitionType: "lead" as const,
          record,
        })),
      ),
      events: nonempty(
        transition.value.events.map((draft) =>
          eventAppend(session, input, draft, lead.leadId, "lead", nextId, occurredAt),
        ),
      ),
    });
  }
  return { result: plan.result, conversationVersion: conversation.version };
};
