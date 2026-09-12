import { describe, expect, it } from "vitest";

import {
  BusinessHoursIntervalSchema,
  BusinessPolicyListFilterSchema,
  BusinessPolicySchema,
  BusinessPolicyTypeSchema,
  CreateFaqDraftInputSchema,
  CreateLocationClosureInputSchema,
  CreateServicePriceDraftInputSchema,
  FaqSchema,
  IanaTimeZoneSchema,
  LocalDateSchema,
  LocalTimeSchema,
  LocalizedTextSchema,
  LocationClosureRecordSchema,
  LocationListFilterSchema,
  PaginationRequestSchema,
  PublishLocationInputSchema,
  PublishServiceInputSchema,
  PublishedBusinessKnowledgeRequestSchema,
  PublishedBusinessKnowledgeSchema,
  PublishedConfigurationProvenanceSchema,
  QualificationDisqualificationReasonSchema,
  QualificationEvidenceKeySchema,
  QualificationOutcomeSchema,
  QualificationPolicyV1RulesSchema,
  ServiceListFilterSchema,
  ServicePriceListFilterSchema,
  ServicePriceRecordSchema,
  ServicePriceTermsSchema,
  SupersedeLocationClosureInputSchema,
  isSchemaValue,
} from "../../packages/contracts/src/index.js";

const LOCATION_ID = "0193f1a8-7f65-7c28-a434-a10796c41c2b";
const SERVICE_ID = "0193f1a8-7f65-7c28-a434-a10796c41c2c";
const RECORD_ID = "0193f1a8-7f65-7c28-a434-a10796c41c2d";
const USER_ID = "0193f1a8-7f65-7c28-a434-a10796c41c2e";
const NOW = "2026-09-12T10:30:00Z";
const LATER = "2026-09-13T10:30:00Z";

const DEFAULT_QUALIFICATION_RULES = {
  disqualification_reasons: [
    "service_not_offered",
    "location_not_served",
    "not_interested",
    "outside_business_scope",
    "spam_or_abuse",
  ],
  require_budget: false,
  require_contactability: true,
  require_medical_eligibility: false,
  require_positive_next_step_intent: true,
  require_preferred_time: false,
  require_service_interest: true,
  require_supported_service_location: true,
} as const;

const provenance = {
  content_hash: "a1".repeat(32),
  published_at: NOW,
  published_by_user_id: USER_ID,
  record_id: RECORD_ID,
  version_no: 1,
};

const priceCandidate = (pricing: unknown) => ({
  display_text_i18n: { en: "Consultation price" },
  location_id: null,
  pricing,
});

describe("localized content and local time contracts", () => {
  it.each([{ en: "Dentistry" }, { ru: "Стоматология", uz: "Stomatologiya" }])(
    "accepts supported non-empty maps %#",
    (candidate) => expect(isSchemaValue(LocalizedTextSchema, candidate)).toBe(true),
  );

  it.each([{}, { de: "Zahnmedizin" }, { en: "" }, { en: "safe", fr: "hidden" }])(
    "rejects malformed localized map %#",
    (candidate) => expect(isSchemaValue(LocalizedTextSchema, candidate)).toBe(false),
  );

  it.each(["Asia/Tashkent", "America/New_York", "UTC"])("accepts IANA zone %s", (zone) => {
    expect(isSchemaValue(IanaTimeZoneSchema, zone)).toBe(true);
  });

  it.each(["Mars/Olympus", "+05:00", "GMT+5", "Tashkent", ""])("rejects non-IANA zone %s", (zone) =>
    expect(isSchemaValue(IanaTimeZoneSchema, zone)).toBe(false),
  );

  it.each(["2024-02-29", "2026-09-12"])("accepts valid date %s", (date) => {
    expect(isSchemaValue(LocalDateSchema, date)).toBe(true);
  });

  it.each(["2023-02-29", "2026-04-31", "2026-13-01", "12-09-2026"])(
    "rejects invalid calendar date %s",
    (date) => expect(isSchemaValue(LocalDateSchema, date)).toBe(false),
  );

  it.each(["00:00:00", "23:59:59"])("accepts valid local time %s", (time) => {
    expect(isSchemaValue(LocalTimeSchema, time)).toBe(true);
  });

  it.each(["24:00:00", "09:60:00", "09:30", "9:30:00"])("rejects invalid local time %s", (time) =>
    expect(isSchemaValue(LocalTimeSchema, time)).toBe(false),
  );
});

describe("Location, hours, and closure contracts", () => {
  const interval = {
    closes_at_local: "17:00:00",
    day_of_week: 1,
    opens_at_local: "09:00:00",
    sequence_no: 1,
  };

  it("accepts a non-overnight interval and rejects equal/reversed intervals", () => {
    expect(isSchemaValue(BusinessHoursIntervalSchema, interval)).toBe(true);
    expect(
      isSchemaValue(BusinessHoursIntervalSchema, {
        ...interval,
        closes_at_local: "09:00:00",
      }),
    ).toBe(false);
    expect(
      isSchemaValue(BusinessHoursIntervalSchema, {
        ...interval,
        closes_at_local: "02:00:00",
        opens_at_local: "22:00:00",
      }),
    ).toBe(false);
  });

  it("accepts complete immediate Location publication and rejects schedules", () => {
    const candidate = {
      address_i18n: { en: "1 Clinic Street" },
      business_hours: { intervals: [interval] },
      name_i18n: { en: "Central Clinic" },
      public_contact: { phone: "+998 71 000 00 00" },
      time_zone: "Asia/Tashkent",
    };

    expect(isSchemaValue(PublishLocationInputSchema, candidate)).toBe(true);
    expect(isSchemaValue(PublishLocationInputSchema, { ...candidate, publish_at: LATER })).toBe(
      false,
    );
  });

  it("enforces closed versus override closure shape", () => {
    const closed = {
      kind: "closed",
      local_date: "2026-12-31",
      reason_i18n: { en: "Public holiday" },
    };
    const override = {
      closes_at_local: "13:00:00",
      kind: "override",
      local_date: "2026-12-31",
      opens_at_local: "10:00:00",
      reason_i18n: { en: "Short hours" },
    };

    expect(isSchemaValue(CreateLocationClosureInputSchema, closed)).toBe(true);
    expect(isSchemaValue(SupersedeLocationClosureInputSchema, override)).toBe(true);
    expect(
      isSchemaValue(CreateLocationClosureInputSchema, {
        ...closed,
        opens_at_local: "09:00:00",
      }),
    ).toBe(false);
    expect(
      isSchemaValue(CreateLocationClosureInputSchema, {
        ...override,
        closes_at_local: "09:00:00",
      }),
    ).toBe(false);
  });

  it("accepts immutable closure provenance and rejects unknown lifecycle", () => {
    const closure = {
      closure_id: RECORD_ID,
      created_at: NOW,
      created_by_user_id: USER_ID,
      details: {
        kind: "closed",
        local_date: "2026-12-31",
        reason_i18n: { en: "Public holiday" },
      },
      location_id: LOCATION_ID,
      status: "active",
      supersedes_id: null,
    };
    expect(isSchemaValue(LocationClosureRecordSchema, closure)).toBe(true);
    expect(isSchemaValue(LocationClosureRecordSchema, { ...closure, status: "deleted" })).toBe(
      false,
    );
  });
});

describe("Service and price contracts", () => {
  it("keeps Service publication complete, immediate, and availability-free", () => {
    const candidate = {
      description_i18n: { en: "Professional consultation" },
      disclaimer_i18n: { en: "Assessment required" },
      duration_guidance_minutes: 60,
      name_i18n: { en: "Consultation" },
    };
    expect(isSchemaValue(PublishServiceInputSchema, candidate)).toBe(true);
    expect(isSchemaValue(PublishServiceInputSchema, { ...candidate, available: true })).toBe(false);
    expect(isSchemaValue(PublishServiceInputSchema, { ...candidate, publish_at: LATER })).toBe(
      false,
    );
  });

  it.each([
    { amount: { amount_minor: 10_000, currency: "UZS" }, price_type: "fixed" },
    { minimum: { amount_minor: 10_000, currency: "UZS" }, price_type: "from" },
    {
      maximum: { amount_minor: 20_000, currency: "UZS" },
      minimum: { amount_minor: 10_000, currency: "UZS" },
      price_type: "range",
    },
    { currency: "UZS", price_type: "quote_required" },
  ])("accepts exact price variant %#", (pricing) => {
    expect(isSchemaValue(ServicePriceTermsSchema, pricing)).toBe(true);
    expect(isSchemaValue(CreateServicePriceDraftInputSchema, priceCandidate(pricing))).toBe(true);
  });

  it.each([
    { amount: { amount_minor: 10.5, currency: "UZS" }, price_type: "fixed" },
    { minimum: { amount_minor: -1, currency: "UZS" }, price_type: "from" },
    {
      maximum: { amount_minor: 10_000, currency: "UZS" },
      minimum: { amount_minor: 20_000, currency: "UZS" },
      price_type: "range",
    },
    {
      maximum: { amount_minor: 20_000, currency: "USD" },
      minimum: { amount_minor: 10_000, currency: "UZS" },
      price_type: "range",
    },
    { amount_minor: 0, currency: "UZS", price_type: "quote_required" },
    { amount: { amount_minor: 10_000, currency: "uzs" }, price_type: "fixed" },
    { currency: "UZS", price_type: "hourly" },
  ])("rejects invalid price variant %#", (pricing) => {
    expect(isSchemaValue(ServicePriceTermsSchema, pricing)).toBe(false);
  });

  it("distinguishes an absent price from zero and quote-required records", () => {
    const base = {
      created_at: NOW,
      display_text_i18n: { en: "Free consultation" },
      effective_from: null,
      effective_to: null,
      location_id: null,
      price_id: RECORD_ID,
      published_by_user_id: null,
      service_id: SERVICE_ID,
      status: "draft",
      version_no: 1,
    };
    expect(
      isSchemaValue(ServicePriceRecordSchema, {
        ...base,
        pricing: { amount: { amount_minor: 0, currency: "UZS" }, price_type: "fixed" },
      }),
    ).toBe(true);
    expect(
      isSchemaValue(ServicePriceRecordSchema, {
        ...base,
        pricing: { currency: "UZS", price_type: "quote_required" },
      }),
    ).toBe(true);
    expect(isSchemaValue(ServicePriceRecordSchema, { ...base, pricing: null })).toBe(false);
    expect(
      isSchemaValue(ServicePriceRecordSchema, {
        ...base,
        effective_to: LATER,
        pricing: { currency: "UZS", price_type: "quote_required" },
      }),
    ).toBe(false);
  });
});

describe("FAQ, policy, provenance, trusted-read, and filter contracts", () => {
  it("accepts FAQ drafts and rejects unknown lifecycle", () => {
    const input = {
      answer_i18n: { en: "Please contact the clinic." },
      faq_key: "booking.contact",
      location_id: null,
      question_i18n: { en: "How can I book?" },
      service_id: null,
    };
    expect(isSchemaValue(CreateFaqDraftInputSchema, input)).toBe(true);

    const faq = {
      ...input,
      content_hash: "a1".repeat(32),
      created_at: NOW,
      effective_from: NOW,
      effective_to: null,
      faq_id: RECORD_ID,
      published_by_user_id: USER_ID,
      status: "published",
      version_no: 1,
    };
    expect(isSchemaValue(FaqSchema, faq)).toBe(true);
    expect(isSchemaValue(FaqSchema, { ...faq, status: "archived" })).toBe(false);
  });

  it("freezes all policy, outcome, evidence, and disqualification vocabularies", () => {
    expect(
      ["qualification", "booking", "handoff", "safety", "consent"].every((value) =>
        isSchemaValue(BusinessPolicyTypeSchema, value),
      ),
    ).toBe(true);
    expect(isSchemaValue(BusinessPolicyTypeSchema, "custom")).toBe(false);
    expect(
      [
        "service_interest",
        "service_location_fit",
        "positive_next_step_intent",
        "contactability",
      ].every((value) => isSchemaValue(QualificationEvidenceKeySchema, value)),
    ).toBe(true);
    expect(isSchemaValue(QualificationEvidenceKeySchema, "budget")).toBe(false);
    expect(
      ["qualified", "incomplete", "disqualified", "handoff"].every((value) =>
        isSchemaValue(QualificationOutcomeSchema, value),
      ),
    ).toBe(true);
    expect(isSchemaValue(QualificationOutcomeSchema, "rejected")).toBe(false);
    expect(isSchemaValue(QualificationDisqualificationReasonSchema, "spam_or_abuse")).toBe(true);
    expect(isSchemaValue(QualificationDisqualificationReasonSchema, "budget_not_met")).toBe(false);
  });

  it("accepts only the exact Qualification Policy V1 rules", () => {
    expect(isSchemaValue(QualificationPolicyV1RulesSchema, DEFAULT_QUALIFICATION_RULES)).toBe(true);
    expect(
      isSchemaValue(QualificationPolicyV1RulesSchema, {
        ...DEFAULT_QUALIFICATION_RULES,
        require_medical_eligibility: true,
      }),
    ).toBe(false);
    expect(
      isSchemaValue(QualificationPolicyV1RulesSchema, {
        ...DEFAULT_QUALIFICATION_RULES,
        evaluator: "return customer.budget > 100",
      }),
    ).toBe(false);
    expect(
      isSchemaValue(QualificationPolicyV1RulesSchema, {
        ...DEFAULT_QUALIFICATION_RULES,
        disqualification_reasons: ["budget_not_met"],
      }),
    ).toBe(false);
  });

  it("rejects unknown policy schema versions and executable policy members", () => {
    const policy = {
      content_hash: "a1".repeat(32),
      created_at: NOW,
      effective_from: NOW,
      effective_to: null,
      policy_id: RECORD_ID,
      policy_key: "lead.qualification",
      policy_type: "qualification",
      published_by_user_id: USER_ID,
      rules: DEFAULT_QUALIFICATION_RULES,
      schema_version: 1,
      status: "published",
      version_no: 1,
    };
    expect(isSchemaValue(BusinessPolicySchema, policy)).toBe(true);
    expect(isSchemaValue(BusinessPolicySchema, { ...policy, schema_version: 2 })).toBe(false);
    expect(
      isSchemaValue(BusinessPolicySchema, {
        ...policy,
        rules: { ...DEFAULT_QUALIFICATION_RULES, script: "doUnsafeThing()" },
      }),
    ).toBe(false);

    const bookingMetadata: Record<string, unknown> = {
      ...policy,
      policy_type: "booking",
      schema_version: 1,
    };
    Reflect.deleteProperty(bookingMetadata, "rules");
    expect(isSchemaValue(BusinessPolicySchema, bookingMetadata)).toBe(true);
    expect(isSchemaValue(BusinessPolicySchema, { ...bookingMetadata, rules: {} })).toBe(false);
  });

  it("accepts exact provenance and rejects database/audit leakage", () => {
    expect(isSchemaValue(PublishedConfigurationProvenanceSchema, provenance)).toBe(true);
    expect(
      isSchemaValue(PublishedConfigurationProvenanceSchema, {
        ...provenance,
        organization_id: LOCATION_ID,
      }),
    ).toBe(false);
  });

  it("defines trusted reads at one instant without draft or lifecycle switches", () => {
    const request = { effective_at: NOW, locale: "en", location_ids: [LOCATION_ID] };
    expect(isSchemaValue(PublishedBusinessKnowledgeRequestSchema, request)).toBe(true);
    expect(
      isSchemaValue(PublishedBusinessKnowledgeRequestSchema, {
        ...request,
        published_only: true,
      }),
    ).toBe(false);
    expect(
      isSchemaValue(PublishedBusinessKnowledgeSchema, {
        effective_at: NOW,
        faqs: [],
        locale: "en",
        locations: [],
        policies: [],
        services: [],
      }),
    ).toBe(true);
  });

  it("keeps filters finite and reuses shared pagination bounds", () => {
    expect(isSchemaValue(LocationListFilterSchema, { status: "active" })).toBe(true);
    expect(isSchemaValue(ServiceListFilterSchema, { location_id: LOCATION_ID })).toBe(true);
    expect(
      isSchemaValue(ServicePriceListFilterSchema, {
        location_id: LOCATION_ID,
        price_type: "range",
        status: "published",
      }),
    ).toBe(true);
    expect(isSchemaValue(BusinessPolicyListFilterSchema, { policy_type: "qualification" })).toBe(
      true,
    );
    expect(isSchemaValue(LocationListFilterSchema, { sort: "code desc" })).toBe(false);
    expect(isSchemaValue(ServiceListFilterSchema, { organization_id: LOCATION_ID })).toBe(false);
    expect(isSchemaValue(PaginationRequestSchema, { limit: 50 })).toBe(true);
    expect(isSchemaValue(PaginationRequestSchema, { limit: 101 })).toBe(false);
  });
});
