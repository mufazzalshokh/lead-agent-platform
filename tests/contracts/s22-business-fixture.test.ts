import { describe, expect, it } from "vitest";

import {
  ChangeServiceLocationInputSchema,
  CreateBusinessPolicyDraftInputSchema,
  CreateFaqDraftInputSchema,
  CreateLocationInputSchema,
  CreateServiceInputSchema,
  CreateServicePriceDraftInputSchema,
  PublishBusinessPolicyInputSchema,
  PublishFaqInputSchema,
  PublishLocationInputSchema,
  PublishServiceInputSchema,
  PublishServicePriceInputSchema,
  isSchemaValue,
} from "../../packages/contracts/src/index.js";
import fixture from "../fixtures/s22-test-clinic.json" with { type: "json" };

// Offline schema-validation IDs only; live commands must bind returned fixture IDs.
const LOCATION_ID = "0193f1a8-7f65-7c28-a434-a10796c41c2b";
const SERVICE_ID = "0193f1a8-7f65-7c28-a434-a10796c41c2c";

describe("S22 synthetic business fixture", () => {
  it("creates and publishes a synthetic location using existing contracts", () => {
    expect(isSchemaValue(CreateLocationInputSchema, fixture.location_create)).toBe(true);
    expect(isSchemaValue(PublishLocationInputSchema, fixture.location_publish)).toBe(true);
    expect(fixture.synthetic).toBe(true);
    expect(fixture.label).toBe("S22 Test Clinic");
    expect(fixture.location_publish.public_contact).toEqual({});
  });

  it("publishes one consultation with explicit duration in all supported languages", () => {
    expect(isSchemaValue(CreateServiceInputSchema, fixture.service_create)).toBe(true);
    expect(isSchemaValue(PublishServiceInputSchema, fixture.service_publish)).toBe(true);
    expect(fixture.service_publish.duration_guidance_minutes).toBe(30);
    for (const content of [
      fixture.service_publish.name_i18n,
      fixture.service_publish.description_i18n,
      fixture.service_publish.disclaimer_i18n,
    ])
      expect(Object.keys(content).sort()).toEqual([...fixture.supported_languages].sort());
  });

  it("binds the offering and fixed integer-minor-unit price to the returned location", () => {
    expect(
      isSchemaValue(ChangeServiceLocationInputSchema, {
        location_id: LOCATION_ID,
        status: "active",
      }),
    ).toBe(true);
    expect(
      isSchemaValue(CreateServicePriceDraftInputSchema, {
        ...fixture.price_draft,
        location_id: LOCATION_ID,
      }),
    ).toBe(true);
    expect(fixture.price_draft.pricing).toEqual({
      price_type: "fixed",
      amount: { amount_minor: 10_000_000, currency: "UZS" },
    });
  });

  it("uses local business hours, not a slot inventory or an availability promise", () => {
    expect(fixture.location_publish.time_zone).toBe("Asia/Tashkent");
    expect(fixture.location_publish.business_hours.intervals.map((row) => row.day_of_week)).toEqual(
      [1, 2, 3, 4, 5, 6],
    );
    for (const interval of fixture.location_publish.business_hours.intervals) {
      expect(interval.opens_at_local).toBe("09:00:00");
      expect(interval.closes_at_local).toBe("18:00:00");
    }
    expect(fixture.service_publish.disclaimer_i18n.en).toContain(
      "Opening hours do not guarantee appointment availability",
    );
  });

  it("keeps optional qualification requirements separate from S16 booking authority", () => {
    const policy = fixture.qualification_draft_if_none_published;
    expect(isSchemaValue(CreateBusinessPolicyDraftInputSchema, policy)).toBe(true);
    expect(policy.policy_type).toBe("qualification");
    expect(policy.rules.require_contactability).toBe(true);
    expect(policy.rules.require_budget).toBe(false);
    expect(policy.rules.require_medical_eligibility).toBe(false);
    expect(policy.rules.require_preferred_time).toBe(false);
    expect(Object.keys(policy.rules)).not.toContain("require_phone");
  });

  it("scopes the staff-review FAQ and distinguishes acceptance from customer confirmation", () => {
    expect(
      isSchemaValue(CreateFaqDraftInputSchema, {
        ...fixture.faq_draft,
        location_id: LOCATION_ID,
        service_id: SERVICE_ID,
      }),
    ).toBe(true);
    expect(fixture.faq_draft.answer_i18n.en).toContain("closed Sunday");
    expect(fixture.faq_draft.answer_i18n.en).toContain("customer must explicitly confirm");
    expect(Object.keys(fixture.bind_before_submission)).toContain("price_draft.location_id");
  });

  it("publishes through existing explicit empty-body commands", () => {
    for (const schema of [
      PublishServicePriceInputSchema,
      PublishFaqInputSchema,
      PublishBusinessPolicyInputSchema,
    ])
      expect(isSchemaValue(schema, {})).toBe(true);
  });
});
