import { describe, expect, it } from "vitest";
import {
  buildAIProviderInput,
  evaluateGroundedDecision,
  evaluateSalesDecision,
  planAppointmentSubmission,
  EMPTY_SALES_EVIDENCE,
  selectGroundingFacts,
  type AIContextSnapshot,
} from "../../packages/application/src/index.js";
import {
  PublishedBusinessKnowledgeV2Schema,
  isSchemaValue,
  LeadIdSchema,
  ResourceIdSchema,
  type Locale,
  type PublishedBusinessKnowledgeV2,
  type ServicePriceTerms,
} from "../../packages/contracts/src/index.js";
import fixture from "../fixtures/s22-test-clinic.json" with { type: "json" };
import { AI_SNAPSHOT, fixtureId, validDecision } from "./fixtures.js";
import { groundingKnowledge } from "./grounding-fixtures.js";

const knowledge = (): PublishedBusinessKnowledgeV2 => {
  const base = groundingKnowledge();
  const service = base.services[1];
  if (service === undefined) throw new Error("Missing synthetic service");
  const candidate: unknown = {
    ...base,
    faqs: [],
    services: [
      {
        ...service,
        ...fixture.service_publish,
        code: fixture.service_create.code,
        price_resolutions: service.price_resolutions.map((resolution) => ({
          ...resolution,
          prices: resolution.prices.map((price) => ({
            ...price,
            pricing: fixture.price_draft.pricing,
            display_text_i18n: fixture.price_draft.display_text_i18n,
          })),
        })),
      },
    ],
  };
  if (!isSchemaValue(PublishedBusinessKnowledgeV2Schema, candidate))
    throw new Error("Invalid published synthetic projection");
  return candidate;
};
const questions = {
  uz: "Salom, S22 sinov konsultatsiyasi narxi qancha va qancha davom etadi?",
  ru: "Здравствуйте, сколько стоит S22 тестовая консультация и какова длительность?",
  en: "Hello, what is the price and duration of S22 Test Consultation?",
};
const context = (locale: Locale, published = knowledge()): AIContextSnapshot => ({
  ...AI_SNAPSHOT,
  history: [],
  locale,
  message: questions[locale],
  policy: {
    ...AI_SNAPSHOT.policy,
    facts: selectGroundingFacts(published, { message: questions[locale], locale }),
  },
});
const answer = (snapshot: AIContextSnapshot): string => {
  const outcome = evaluateGroundedDecision(
    validDecision({
      intent: "pricing",
      language: snapshot.locale,
      factual_claims: snapshot.policy.facts.map((fact) => fact.reference),
      message: { mode: "send_candidate", draft_text: "SECRET: pay 1 UZS, your slot is confirmed." },
    }),
    snapshot,
  );
  if (outcome.kind !== "decision" || outcome.decision.message.draft_text === null)
    throw new Error("Expected a grounded customer reply");
  return outcome.decision.message.draft_text;
};
const withPrice = (pricing: ServicePriceTerms, qualifier: string): PublishedBusinessKnowledgeV2 => {
  const published = knowledge();
  return {
    ...published,
    services: published.services.map((service) => ({
      ...service,
      price_resolutions: service.price_resolutions.map((resolution) => ({
        ...resolution,
        prices: resolution.prices.map((price) => ({
          ...price,
          pricing,
          display_text_i18n: { ...price.display_text_i18n, uz: qualifier },
        })),
      })),
    })),
  };
};

describe("shared grounded customer wording", () => {
  it.each(["uz", "ru", "en"] as const)(
    "states each synthetic fact once in %s, retaining the test notice",
    (locale) => {
      const published = knowledge();
      const name = published.services[0]?.name_i18n[locale];
      if (name === undefined) throw new Error("Missing localized service name");
      const text = answer(context(locale, published));
      expect(text.split(name)).toHaveLength(2);
      expect(text.match(/100[ ,]000/gu)).toHaveLength(1);
      expect(text).toMatch(/30 (daqiqa|минут|minutes)/u);
      expect(text).toMatch(/sintetik|синтетическая|Synthetic/u);
      expect(text).not.toMatch(/SECRET|1 UZS|confirmed|tasdiqlandi|подтвержден/u);
    },
  );

  it("keeps price conditions verbatim after removing only an exact redundant header", () => {
    const published = knowledge();
    const conditions =
      "Faqat sintetik sinov narxi. Bir seans uchun; qo'shimcha xizmatlar kiritilmagan.";
    const scoped: PublishedBusinessKnowledgeV2 = {
      ...published,
      services: published.services.map((service) => ({
        ...service,
        price_resolutions: service.price_resolutions.map((resolution) => ({
          ...resolution,
          prices: resolution.prices.map((price) => ({
            ...price,
            display_text_i18n: {
              ...price.display_text_i18n,
              uz: `${service.name_i18n.uz}: 100 000 so'm. ${conditions}`,
            },
          })),
        })),
      })),
    };
    const text = answer(context("uz", scoped));
    expect(text).toContain(conditions);
    expect(text.match(/100 000/gu)).toHaveLength(1);
  });

  it("never projects application presentation metadata into provider input", () => {
    const input = buildAIProviderInput(context("uz"), new AbortController().signal);
    expect(input?.facts.every((fact) => Object.keys(fact).join(",") === "reference,text")).toBe(
      true,
    );
  });

  it.each([
    [
      { price_type: "fixed", amount: { amount_minor: 10_000_000, currency: "UZS" } },
      ["100 000 UZS"],
    ],
    [
      { price_type: "from", minimum: { amount_minor: 10_000_000, currency: "UZS" } },
      ["100 000 UZS dan boshlab"],
    ],
    [
      {
        price_type: "range",
        minimum: { amount_minor: 10_000_000, currency: "UZS" },
        maximum: { amount_minor: 15_000_000, currency: "UZS" },
      },
      ["100 000 UZS", "150 000 UZS"],
    ],
    [
      { price_type: "quote_required", currency: "UZS" },
      ["Aniq narx uchun tasdiqlangan taklif kerak"],
    ],
    [{ price_type: "fixed", amount: { amount_minor: 10_005, currency: "USD" } }, ["100.05 USD"]],
  ] satisfies readonly (readonly [ServicePriceTerms, readonly string[]])[])(
    "preserves authoritative %j pricing, currency/precision and conditions",
    (pricing, expected) => {
      const qualifier = "Bir seans uchun; qo'shimcha xizmatlar kiritilmagan.";
      const text = answer(context("uz", withPrice(pricing, qualifier)));
      expected.forEach((value) => expect(text).toContain(value));
      expect(text).toContain(qualifier);
      expect(text).not.toMatch(/SECRET|1 UZS|confirmed/u);
      if (pricing.price_type === "quote_required") expect(text).not.toMatch(/100 000|150 000/u);
    },
  );

  it.each([
    "S22 sinov konsultatsiyasi: 150 000 so'm. Bir seans uchun.",
    "S22 sinov konsultatsiyasi: 100 000 USD. Bir seans uchun.",
    "Faqat ayrim holatlarda. S22 sinov konsultatsiyasi: 100 000 so'm.",
    "S22 sinov konsultatsiyasi: 100 000 so'mdan boshlab. Qo'shimcha shartlar bor.",
  ])("never strips unrecognized or non-equivalent published wording: %s", (qualifier) => {
    const text = answer(
      context(
        "uz",
        withPrice(
          { price_type: "fixed", amount: { amount_minor: 10_000_000, currency: "UZS" } },
          qualifier,
        ),
      ),
    );
    expect(text).toContain(qualifier);
    expect(text).toContain("100 000 UZS");
  });

  it("does not repeat a greeting once conversation history exists", () => {
    const snapshot = context("uz");
    expect(answer(snapshot)).toMatch(/^Salom! /u);
    expect(
      answer({ ...snapshot, history: [{ role: "customer", sequence: 1, text: "Salom" }] }),
    ).not.toMatch(/^Salom!/u);
    expect(answer(snapshot)).toBe(answer(snapshot));
  });

  it("keeps different services' prices and durations paired, without repeating names", () => {
    const base = groundingKnowledge();
    const published: PublishedBusinessKnowledgeV2 = {
      ...base,
      services: base.services.map((service, index) => ({
        ...service,
        duration_guidance_minutes: index === 0 ? 30 : 45,
      })),
    };
    const message = "Lazer va konsultatsiya narxi qancha va qancha davom etadi?";
    const text = answer({
      ...context("uz"),
      message,
      policy: {
        ...AI_SNAPSHOT.policy,
        facts: selectGroundingFacts(published, { message, locale: "uz" }),
      },
    });
    expect(text).toMatch(/Lazer[^\n]*250 000 UZS[^\n]*30 daqiqa/u);
    expect(text).toMatch(/Konsultatsiya[^\n]*100 000 UZS[^\n]*45 daqiqa/u);
    expect(text.split("Lazer")).toHaveLength(2);
    expect(text.split("Konsultatsiya")).toHaveLength(2);
  });

  it.each([
    ["S22 sinov konsultatsiyasi narxi qancha?", "100 000 UZS", "30 daqiqa"],
    ["S22 sinov konsultatsiyasi qancha davom etadi?", "30 daqiqa", "100 000"],
  ])("answers only the requested fact: %s", (message, expected, absent) => {
    const published = knowledge();
    const text = answer({
      ...context("uz", published),
      message,
      policy: {
        ...AI_SNAPSHOT.policy,
        facts: selectGroundingFacts(published, { message, locale: "uz" }),
      },
    });
    expect(text).toContain(expected);
    expect(text).not.toContain(absent);
  });

  it("retains exact approved language fallback rather than inventing a translation", () => {
    const published = knowledge();
    const service = published.services[0];
    if (service?.name_i18n.en === undefined) throw new Error("Missing approved English name");
    const englishOnly: PublishedBusinessKnowledgeV2 = {
      ...published,
      services: [{ ...service, name_i18n: { en: service.name_i18n.en } }],
    };
    const snapshot = context("uz");
    const facts = selectGroundingFacts(englishOnly, {
      message: snapshot.message,
      locale: "uz",
      defaultLocale: "en",
    });
    const text = answer({ ...snapshot, policy: { ...snapshot.policy, facts } });
    expect(text).toContain("Tasdiqlangan ma'lumot boshqa tilda (en)");
    expect(text).toContain("S22 Test Consultation");
    expect(text).not.toContain("S22 sinov konsultatsiyasi");
  });

  it("composes the reported booking question as one factual paragraph plus a safe request acknowledgment", () => {
    const published = knowledge();
    const service = published.services[0];
    const location = published.locations[0];
    const leadId = fixtureId(52_100),
      policyId = fixtureId(52_101);
    if (
      service === undefined ||
      location === undefined ||
      !isSchemaValue(LeadIdSchema, leadId) ||
      !isSchemaValue(ResourceIdSchema, policyId)
    )
      throw new Error("Missing synthetic booking context");
    const message = `${questions.uz} Ertaga soat 17:00 ga yozilmoqchiman.`;
    const now = "2026-10-11T08:29:00.000Z";
    const snapshot: AIContextSnapshot = {
      ...context("uz", published),
      message,
      sourceReceivedAt: now,
      sales: {
        leadId,
        leadVersion: 2,
        leadStatus: "engaged",
        policy: { id: policyId, version: 1 },
        contactable: true,
        stored: EMPTY_SALES_EVIDENCE,
        services: [
          {
            id: service.service_id,
            names: Object.values(service.name_i18n).filter(
              (name): name is string => name !== undefined,
            ),
            locationIds: [location.location_id],
          },
        ],
        locations: [{ id: location.location_id, names: ["Synthetic test location"] }],
      },
      booking: {
        now,
        knowledge: published,
        activeRequestId: null,
        afterSequence: 0,
        staffActive: false,
      },
    };
    const outcome = evaluateSalesDecision(
      validDecision({
        language: "uz",
        intent: "pricing",
        factual_claims: snapshot.policy.facts.map((fact) => fact.reference),
      }),
      snapshot,
    );
    const plan = planAppointmentSubmission(snapshot, outcome);
    expect(plan.result.kind).toBe("appointment_requested");
    expect(plan.submission?.preference.localDate).toBe("2026-10-12");
    expect(plan.submission?.preference.localStart).toContain("17:00");
    expect(plan.text?.match(/100 000/gu)).toHaveLength(1);
    expect(plan.text?.split("S22 sinov konsultatsiyasi")).toHaveLength(2);
    expect(plan.text?.split("\n\n")).toHaveLength(2);
    expect(plan.text).toContain("Xodim ko'rib chiqqach");
    expect(plan.text).not.toMatch(/tasdiqlandi|qabul qilindi|bo'sh|confirmed/u);
  });
});
