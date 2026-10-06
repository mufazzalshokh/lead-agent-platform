import { describe, expect, it, vi } from "vitest";
import {
  EMPTY_SALES_EVIDENCE,
  confirmationReplyIntent,
  confirmationText,
  createAppointmentSubmissionOrchestrator,
  customerConfirmationExpiry,
  planAppointmentSubmission,
  selectGroundingFacts,
  type AIContextSnapshot,
  type AIHistoryEntry,
  type AIOrchestrationStore,
  type AIProviderInput,
  type AIWorkReference,
} from "../../packages/application/src/index.js";
import { createAppointmentSubmissionAIProvider } from "../../packages/ai/src/production.js";
import { loadCommercialV1AIConfig } from "../../packages/config/src/index.js";
import {
  ActorRefSchema,
  AppointmentRequestIdSchema,
  ContactIdSchema,
  LeadIdSchema,
  MembershipIdSchema,
  MessageIdSchema,
  PublishedBusinessKnowledgeV2Schema,
  ResourceIdSchema,
  UtcTimestampSchema,
  isSchemaValue,
} from "../../packages/contracts/src/index.js";
import {
  confirmAppointmentRequestWorkflow,
  createAppointmentRequestWorkflow,
  createLead,
  prepareCustomerConfirmation,
  qualifyLead,
  recordEngagement,
  staffAcceptAppointmentRequest,
  validateIanaTimeZone,
  type Result,
} from "../../packages/domain/src/index.js";
import fixture from "../fixtures/s22-test-clinic.json" with { type: "json" };
import { AI_REFERENCE, AI_SNAPSHOT, fixtureId, validDecision } from "./fixtures.js";
import { groundingKnowledge } from "./grounding-fixtures.js";

// Connected application/domain rehearsal, NOT live ingress, RLS, SQL, delivery or
// model-quality proof. Only the HTTP boundary and persistence port are simulated.
const requireResult = <Value, Error>(result: Result<Value, Error>): Value => {
  if (!result.ok) throw new Error("Synthetic domain transition rejected");
  return result.value;
};
const timestamp = (value: string) => {
  if (!isSchemaValue(UtcTimestampSchema, value)) throw new Error("Invalid test clock");
  return value;
};
const now = timestamp("2026-10-06T10:00:00.000Z");
const knowledge = (() => {
  const base = groundingKnowledge(),
    service = base.services[1],
    location = base.locations[0];
  if (service === undefined || location === undefined) throw new Error("Missing projection");
  const candidate: unknown = {
    ...base,
    effective_at: now,
    faqs: [],
    services: [
      {
        ...service,
        ...fixture.service_publish,
        code: fixture.service_create.code,
        root_version: 4,
        price_resolutions: service.price_resolutions.map((resolution) => ({
          ...resolution,
          prices: resolution.prices.map((price) => ({
            ...price,
            pricing: fixture.price_draft.pricing,
            display_text_i18n: fixture.price_draft.display_text_i18n,
            location_id: location.location_id,
          })),
        })),
      },
    ],
    locations: [
      {
        ...location,
        ...fixture.location_publish,
        business_hours: fixture.location_publish.business_hours.intervals,
        code: fixture.location_create.code,
      },
    ],
  };
  if (!isSchemaValue(PublishedBusinessKnowledgeV2Schema, candidate))
    throw new Error("Invalid synthetic published projection");
  return candidate;
})();

describe("S22 connected synthetic booking rehearsal", () => {
  it("joins the actual Gemini adapter and application planner to staff acceptance and explicit Instagram confirmation", async () => {
    const service = knowledge.services[0],
      locationRecord = knowledge.locations[0];
    const leadId = fixtureId(51001),
      contactId = fixtureId(51002),
      policyId = fixtureId(51003),
      requestId = fixtureId(51004),
      memberId = fixtureId(51005),
      evidenceId = fixtureId(51006);
    if (
      service === undefined ||
      locationRecord === undefined ||
      !isSchemaValue(LeadIdSchema, leadId) ||
      !isSchemaValue(ContactIdSchema, contactId) ||
      !isSchemaValue(ResourceIdSchema, policyId) ||
      !isSchemaValue(AppointmentRequestIdSchema, requestId) ||
      !isSchemaValue(MembershipIdSchema, memberId) ||
      !isSchemaValue(ResourceIdSchema, evidenceId)
    )
      throw new Error("Invalid rehearsal references");
    const organizationId = AI_REFERENCE.organizationId;
    const contact = { organizationId, contactId };
    const system = { actor_type: "system", actor_id: null };
    const customer = { actor_type: "customer", actor_id: contactId };
    const staff = { actor_type: "member", actor_id: memberId };
    if (
      !isSchemaValue(ActorRefSchema, system) ||
      !isSchemaValue(ActorRefSchema, customer) ||
      !isSchemaValue(ActorRefSchema, staff)
    )
      throw new Error("Invalid rehearsal actors");
    const leadContext = () => ({
      actor: system,
      expectedVersion: lead.version,
      occurredAt: now,
      organizationId,
    });
    let lead = requireResult(
      createLead({ actor: system, contact, leadId, occurredAt: now, organizationId }),
    ).nextAggregate;
    let stored = EMPTY_SALES_EVIDENCE;
    const history: AIHistoryEntry[] = [];
    const replies: string[] = [];
    const processed = new Set<string>();
    const finishes: Parameters<AIOrchestrationStore["finish"]>[0][] = [];
    let current: AIContextSnapshot = AI_SNAPSHOT;
    let suppliedFacts: AIProviderInput["facts"] = [];
    let submission: ReturnType<typeof planAppointmentSubmission>["submission"] = null;
    let calls = 0;
    const config = loadCommercialV1AIConfig({ GEMINI_API_KEY: "synthetic-rehearsal-key" });
    if (config === null) throw new Error("Missing test-only configuration");
    const request = vi.fn<typeof fetch>((_url, options) => {
      calls++;
      expect(options?.body).toContain("Leave ALL extracted_facts fields null");
      expect(options?.body).toContain("Use action=none");
      return Promise.resolve(
        Response.json({
          modelVersion: "gemini-3.8-flash",
          responseId: `synthetic_${calls}`,
          usageMetadata: { promptTokenCount: 520, totalTokenCount: 737 },
          candidates: [
            {
              finishReason: "STOP",
              content: {
                role: "model",
                parts: [
                  {
                    text: JSON.stringify(
                      validDecision({
                        language: "uz",
                        intent: "other",
                        factual_claims: suppliedFacts.map((fact) => fact.reference),
                        message: {
                          mode: "send_candidate",
                          draft_text: "Untrusted model draft: already booked.",
                        },
                      }),
                    ),
                  },
                ],
              },
            },
          ],
        }),
      );
    });
    const adapter = createAppointmentSubmissionAIProvider(config, { fetch: request });
    const authorize = vi.fn(() => Promise.resolve(true));
    const store: AIOrchestrationStore = {
      load: (reference) => Promise.resolve(processed.has(reference.messageId) ? null : current),
      reserve: () => Promise.resolve({ runId: fixtureId(51100 + calls), attemptNo: 1 }),
      authorizeDispatch: authorize,
      finish: (input) => {
        finishes.push(input);
        const plan = planAppointmentSubmission(input.snapshot, input.outcome);
        if (plan.handoffReason !== null || plan.text === null)
          throw new Error("Unexpected rehearsal fallback");
        stored = plan.evidence;
        if (plan.qualification.result.missing.length === 0 && lead.status === "engaged") {
          lead = requireResult(
            qualifyLead(lead, {
              ...leadContext(),
              qualification: {
                evaluationId: evidenceId,
                organizationId,
                policyId,
              },
            }),
          ).nextAggregate;
        }
        submission = plan.submission;
        replies.push(plan.text);
        processed.add(input.reference.messageId);
        return Promise.resolve({
          ...input.outcome,
          salesResult: plan.result,
          replyDisposition: "queued",
        });
      },
    };
    const flow = createAppointmentSubmissionOrchestrator({
      provider: {
        decide: (input) => {
          suppliedFacts = input.facts;
          return adapter.decide(input);
        },
      },
      store,
      timeoutMs: 1000,
    });
    const send = async (text: string, sequence: number) => {
      const messageId = fixtureId(51200 + sequence);
      if (!isSchemaValue(MessageIdSchema, messageId)) throw new Error("Invalid source");
      const reference: AIWorkReference = { ...AI_REFERENCE, messageId };
      if (lead.status === "new") {
        lead = requireResult(
          recordEngagement(lead, {
            ...leadContext(),
            sourceMessage: { organizationId, messageId },
          }),
        ).nextAggregate;
      }
      current = {
        ...AI_SNAPSHOT,
        message: text,
        locale: "uz",
        sourceMessageId: messageId,
        sourceSequence: sequence,
        sourceReceivedAt: now,
        history: [...history],
        sales: {
          leadId,
          leadStatus: lead.status,
          leadVersion: lead.version,
          policy: { id: policyId, version: 1 },
          contactable: true,
          services: [
            {
              id: service.service_id,
              names: Object.values(service.name_i18n).filter(
                (name): name is string => name !== undefined,
              ),
              locationIds: [locationRecord.location_id],
            },
          ],
          locations: [{ id: locationRecord.location_id, names: ["S22 Test Clinic"] }],
          stored,
        },
        booking: { now, knowledge, activeRequestId: null, afterSequence: 0, staffActive: false },
        policy: {
          ...AI_SNAPSHOT.policy,
          contactableWithoutPhone: true,
          facts: selectGroundingFacts(knowledge, {
            message: text,
            locale: "uz",
            serviceId: stored.serviceId,
          }),
        },
      };
      const result = await flow.run(reference);
      history.push({ role: "customer", text, sequence, messageId, receivedAt: now });
      return { result, reference };
    };
    await send("Salom, S22 sinov konsultatsiyasi narxi qancha va qancha davom etadi?", 1);
    expect(replies[0]).toContain("100 000 UZS");
    expect(replies[0]).toContain("30 daqiqa");
    expect(lead.status).toBe("engaged");
    expect((await send("Ertaga yozilmoqchiman", 2)).result).toMatchObject({
      kind: "appointment_incomplete",
      missing: ["time"],
    });
    expect(lead.status).toBe("qualified");
    const last = await send("Soat 17:00", 3);
    expect(last.result.kind).toBe("appointment_requested");
    const planned = planAppointmentSubmission(
      current,
      finishes[2]?.outcome ??
        (() => {
          throw new Error("Missing outcome");
        })(),
    ).submission;
    expect(submission).toEqual(planned);
    if (planned === null) throw new Error("Missing authoritative submission");
    expect(planned.preference.localDate).toBe("2026-10-07");
    expect(planned.preference.endAt).toBe("2026-10-07T12:30:00.000Z");
    expect(replies.join(" ")).not.toMatch(/already booked|bo'sh|tasdiqlandi|telefon/u);
    const timeZone = requireResult(validateIanaTimeZone(planned.location.time_zone));
    const preference = {
      ...planned.preference,
      startAt: timestamp(planned.preference.startAt),
      endAt: timestamp(planned.preference.endAt),
      timeZone,
      preferenceId: evidenceId,
      preferenceOrder: 1,
      precision: "exact" as const,
    };
    const location = {
      organizationId,
      locationId: planned.location.location_id,
      locationVersionId: planned.location.provenance.record_id,
    };
    const pair = requireResult(
      createAppointmentRequestWorkflow(lead, {
        appointmentRequest: {
          actor: customer,
          appointmentRequestId: requestId,
          businessPolicy: { organizationId, businessPolicyId: policyId },
          contact,
          conversation: { organizationId, conversationId: AI_REFERENCE.conversationId },
          initiator: { kind: "customer", contact },
          lead: { organizationId, leadId },
          location,
          occurredAt: now,
          organizationId,
          preferences: [preference],
          service: {
            organizationId,
            serviceId: planned.service.service_id,
            serviceVersionId: planned.service.provenance.record_id,
          },
          sourceMessage: { organizationId, messageId: last.reference.messageId },
        },
        lead: leadContext(),
      }),
    );
    expect(pair.appointmentRequest.status).toBe("requested");
    const accepted = requireResult(
      staffAcceptAppointmentRequest(pair.appointmentRequest, {
        actor: staff,
        expectedVersion: pair.appointmentRequest.version,
        location,
        occurredAt: now,
        offeredSlot: {
          startAt: preference.startAt,
          endAt: preference.endAt,
          localStart: preference.localStart,
          localEnd: preference.localEnd,
          timeZone,
        },
        organizationId,
        staff: { organizationId, membershipId: memberId },
      }),
    ).nextAggregate;
    expect(accepted.status).toBe("staff_accepted");
    expect(pair.lead.status).toBe("booking_requested");
    const offerVersion = accepted.offer?.offerVersion;
    const expiresAt = customerConfirmationExpiry(now, preference.startAt);
    if (offerVersion === undefined || expiresAt === null) throw new Error("Missing current offer");
    const awaiting = requireResult(
      prepareCustomerConfirmation(accepted, {
        actor: system,
        expectedVersion: accepted.version,
        issuedAt: now,
        expiresAt,
        offerVersion,
        organizationId,
      }),
    ).nextAggregate;
    expect(awaiting.status).toBe("awaiting_customer_confirmation");
    expect(confirmationText("prompt", "uz", preference.localStart)).toContain("tasdiqlaysizmi?");
    expect(confirmationReplyIntent("Ha, tasdiqlayman")).toBe("confirm");
    const confirmationMessageId = fixtureId(51204);
    if (!isSchemaValue(MessageIdSchema, confirmationMessageId))
      throw new Error("Invalid confirmation source");
    const confirmed = requireResult(
      confirmAppointmentRequestWorkflow(awaiting, pair.lead, {
        appointmentRequest: {
          actor: customer,
          expectedVersion: awaiting.version,
          now,
          organizationId,
          evidence: {
            appointmentRequest: { organizationId, appointmentRequestId: requestId },
            contact,
            customerActedAt: now,
            evidence: { organizationId, evidenceId },
            offerVersion,
            source: "instagram",
            sourceMessage: { organizationId, messageId: confirmationMessageId },
          },
        },
        lead: { ...leadContext(), expectedVersion: pair.lead.version },
      }),
    );
    expect(confirmed.appointmentRequest.status).toBe("confirmed");
    expect(confirmed.lead.status).toBe("converted");
    expect(
      confirmed.events.some((event) => event.event_type === "appointment_request.confirmed"),
    ).toBe(true);
    expect((await flow.run(last.reference)).reason).toBe("stale_context");
    expect(request).toHaveBeenCalledTimes(3);
    expect(authorize).toHaveBeenCalledTimes(3);
    expect(finishes.every((input) => input.provider?.usage.cachedInput === 0)).toBe(true);
  });
});
