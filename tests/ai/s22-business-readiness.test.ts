import { describe, expect, it, vi } from "vitest";
import {
  buildAIProviderInput,
  createAIOrchestrator,
  evaluateGroundedDecision,
  selectGroundingFacts,
  type AIOrchestrationStore,
} from "../../packages/application/src/index.js";
import {
  PublishedBusinessKnowledgeV2Schema,
  isSchemaValue,
  type PublishedBusinessKnowledgeV2,
} from "../../packages/contracts/src/index.js";
import { parseGeminiUsage } from "../../packages/ai/src/providers/gemini.js";
import { createAppointmentSubmissionOrchestrator } from "../../packages/application/src/ai/appointment-submission.js";
import { estimateAIUsageCost, resolveAIPrice } from "../../packages/observability/src/index.js";
import fixture from "../fixtures/s22-test-clinic.json" with { type: "json" };
import { groundingId, groundingKnowledge } from "./grounding-fixtures.js";
import { AI_REFERENCE, AI_SNAPSHOT, validDecision } from "./fixtures.js";

const message = "S22 sinov konsultatsiyasi necha daqiqa davom etadi?";

// Already tenant-qualified projections, not an RLS implementation or live DB proof.
const publishedFixture = (otherTenant = false): PublishedBusinessKnowledgeV2 => {
  const base = groundingKnowledge();
  const template = base.services[0];
  const location = base.locations[0];
  if (template === undefined || location === undefined) throw new Error("Missing fixture");
  const serviceId = groundingId(otherTenant ? 91 : 90);
  const candidate: unknown = {
    ...base,
    faqs: [],
    services: [
      {
        ...template,
        ...fixture.service_publish,
        code: fixture.service_create.code,
        service_id: serviceId,
        root_version: 4,
        provenance: { ...template.provenance, record_id: groundingId(92), version_no: 1 },
        price_resolutions: [],
      },
      {
        ...template,
        code: "unrelated-massage",
        service_id: groundingId(otherTenant ? 94 : 93),
        name_i18n: { uz: "Massaj", ru: "Массаж", en: "Massage" },
        duration_guidance_minutes: 90,
      },
    ],
  };
  if (!isSchemaValue(PublishedBusinessKnowledgeV2Schema, candidate))
    throw new Error("Invalid published fixture projection");
  return candidate;
};

describe("S22 business-readiness evidence regressions", () => {
  it.each([
    ["uz", message, "30 daqiqa"],
    ["ru", "Сколько минут длится S22 тестовая консультация?", "30 минут"],
    ["en", "What is the duration of S22 Test Consultation?", "30 minutes"],
  ] as const)(
    "retrieves the published duration in %s with root, not publication, provenance",
    (locale, question, expected) => {
      const knowledge = publishedFixture();
      const service = knowledge.services[0];
      if (service === undefined) throw new Error("Missing service");
      expect(service.provenance.version_no).toBe(1);
      expect(service.duration_guidance_minutes).toBe(30);
      const facts = selectGroundingFacts(knowledge, { message: question, locale });
      expect(facts).toHaveLength(1);
      expect(facts[0]).toMatchObject({
        reference: {
          claim_kind: "service",
          source_type: "service",
          source_id: service.service_id,
          source_version: 4,
        },
        grounding: { need: "duration", locale, subject: service.service_id },
      });
      expect(facts[0]?.text).toContain(expected);
      expect(facts[0]?.text).not.toContain("90");
    },
  );

  it("does not borrow a different service's duration when the selected duration is missing", () => {
    const knowledge = publishedFixture();
    const facts = selectGroundingFacts(
      {
        ...knowledge,
        services: knowledge.services.map((service, index) =>
          index === 0 ? { ...service, duration_guidance_minutes: null } : service,
        ),
      },
      { message, locale: "uz" },
    );
    expect(facts).toEqual([]);
  });

  it("does not invent unpublished or unknown service facts", () => {
    expect(
      selectGroundingFacts({ ...publishedFixture(), services: [] }, { message, locale: "uz" }),
    ).toEqual([]);
    expect(
      selectGroundingFacts(publishedFixture(), { message: "implant duration", locale: "en" }),
    ).toEqual([]);
  });

  it("tenant-qualified projections have disjoint citations; foreign/stale citations fail symmetrically", () => {
    const scopes = [publishedFixture(), publishedFixture(true)];
    const facts = scopes.map((knowledge) =>
      selectGroundingFacts(knowledge, { message, locale: "uz" }),
    );
    expect(facts[0]?.[0]?.reference.source_id).not.toBe(facts[1]?.[0]?.reference.source_id);
    for (const index of [0, 1]) {
      const own = facts[index];
      const foreign = facts[1 - index];
      if (own?.[0] === undefined || foreign === undefined) throw new Error("Missing scope facts");
      const snapshot = {
        ...AI_SNAPSHOT,
        message,
        locale: "uz" as const,
        policy: { ...AI_SNAPSHOT.policy, facts: own },
      };
      const proposed = validDecision({
        intent: "service_inquiry",
        language: "uz",
        factual_claims: own.map((entry) => entry.reference),
      });
      expect(evaluateGroundedDecision(proposed, snapshot).kind).toBe("decision");
      expect(
        evaluateGroundedDecision(
          { ...proposed, factual_claims: foreign.map((entry) => entry.reference) },
          snapshot,
        ),
      ).toMatchObject({ reason: "stale_context" });
      expect(
        evaluateGroundedDecision(
          { ...proposed, factual_claims: [{ ...own[0].reference, source_version: 1 }] },
          snapshot,
        ),
      ).toMatchObject({ reason: "stale_context" });
    }
  });

  it("prices valid omitted-cache ProtoJSON without rewriting unknown historical usage", () => {
    const price = resolveAIPrice("gemini", "gemini-3.8-flash", new Date("2026-10-05T00:00:00Z"));
    if (price === null) throw new Error("Missing approved catalog entry");
    const usage = parseGeminiUsage({ promptTokenCount: 520, totalTokenCount: 737 });
    expect(usage).toMatchObject({ input: 520, output: 217, total: 737, cachedInput: 0 });
    // Controlled raw-response fixture only; NOT a reconciliation of either live run.
    expect(estimateAIUsageCost(price, usage)).toBe(1204n);
    expect(estimateAIUsageCost(price, { ...usage, cachedInput: null })).toBeNull();
    expect(
      estimateAIUsageCost(
        price,
        parseGeminiUsage({
          promptTokenCount: 520,
          totalTokenCount: 737,
          cachedContentTokenCount: null,
        }),
      ),
    ).toBeNull();
    expect(resolveAIPrice("gemini", "unknown-model", new Date("2026-10-05"))).toBeNull();
  });

  it("NULL usage remains unknown even though a grouped COALESCE sum displays zero", () => {
    const price = resolveAIPrice("gemini", "gemini-3.8-flash", new Date("2026-10-05"));
    if (price === null) throw new Error("Missing price");
    const usage = parseGeminiUsage(undefined);
    expect(usage.input ?? 0).toBe(0);
    expect(usage.input).toBeNull();
    expect(estimateAIUsageCost(price, usage)).toBeNull();
  });

  it("proves the context-too-large pre-dispatch branch by observing zero provider calls, not token counts", async () => {
    const snapshot = { ...AI_SNAPSHOT, message: "x".repeat(4001) };
    expect(buildAIProviderInput(snapshot, new AbortController().signal)).toBeNull();
    const decide = vi.fn();
    const finish = vi.fn<AIOrchestrationStore["finish"]>((input) => Promise.resolve(input.outcome));
    const result = await createAIOrchestrator({
      provider: { decide },
      store: {
        load: () => Promise.resolve(snapshot),
        reserve: () => Promise.resolve({ runId: AI_REFERENCE.messageId, attemptNo: 1 }),
        finish,
      },
      timeoutMs: 1000,
    }).run(AI_REFERENCE);
    expect(result).toMatchObject({ reason: "context_too_large" });
    expect(decide).not.toHaveBeenCalled();
    expect(finish.mock.calls[0]?.[0]).toMatchObject({ provider: null });
  });

  it("the supported staff-request preflight also skips the provider, without classifying the live masked run", async () => {
    const snapshot = { ...AI_SNAPSHOT, message: "Xodim bilan gaplashmoqchiman." };
    const decide = vi.fn();
    const finish = vi.fn<AIOrchestrationStore["finish"]>((input) => Promise.resolve(input.outcome));
    const result = await createAppointmentSubmissionOrchestrator({
      provider: { decide },
      store: {
        load: () => Promise.resolve(snapshot),
        reserve: () => Promise.resolve({ runId: AI_REFERENCE.messageId, attemptNo: 1 }),
        finish,
      },
      timeoutMs: 1000,
    }).run(AI_REFERENCE);
    expect(result).toMatchObject({ reason: "staff_requested" });
    expect(decide).not.toHaveBeenCalled();
    expect(finish.mock.calls[0]?.[0]).toMatchObject({
      provider: null,
      outcome: { kind: "fallback_required", reason: "staff_requested" },
    });
  });
});
