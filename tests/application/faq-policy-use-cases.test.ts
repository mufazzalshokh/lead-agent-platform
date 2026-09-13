import { describe, expect, it } from "vitest";

import {
  createBusinessPolicyConfigurationUseCases,
  createFaqConfigurationUseCases,
  createFaqPolicyCursorCodec,
  isFaqPolicyMutationReplay,
  type FaqPolicyConfigurationStore,
} from "../../packages/application/src/index.js";
import {
  ConfigurationIdempotencyKeySchema,
  LocationIdSchema,
  MembershipIdSchema,
  OpaqueCursorSchema,
  OrganizationIdSchema,
  ResourceIdSchema,
  ServiceIdSchema,
  UtcTimestampSchema,
  UserIdSchema,
  isSchemaValue,
  type BusinessPolicy,
  type ConfigurationIdempotencyKey,
  type Faq,
  type LocationId,
  type MembershipId,
  type OrganizationId,
  type ResourceId,
  type ServiceId,
  type UtcTimestamp,
  type UserId,
} from "../../packages/contracts/src/index.js";
import {
  resolveAuthorizationContext,
  type AuthenticatedApplicationSession,
  type AuthorizationContext,
  type CurrentMembershipAuthorization,
  type LocationScope,
  type MembershipRole,
} from "../../packages/security/src/index.js";

const USER_VALUE = "0193f1a8-7f65-7c28-a434-a10796c47501";
const MEMBERSHIP_VALUE = "0193f1a8-7f65-7c28-a434-a10796c47502";
const ORGANIZATION_A_VALUE = "0193f1a8-7f65-7c28-a434-a10796c47503";
const ORGANIZATION_B_VALUE = "0193f1a8-7f65-7c28-a434-a10796c47504";
const FAQ_VALUE = "0193f1a8-7f65-7c28-a434-a10796c47505";
const POLICY_VALUE = "0193f1a8-7f65-7c28-a434-a10796c47506";
const LOCATION_A_VALUE = "0193f1a8-7f65-7c28-a434-a10796c47507";
const LOCATION_B_VALUE = "0193f1a8-7f65-7c28-a434-a10796c47508";
const SERVICE_VALUE = "0193f1a8-7f65-7c28-a434-a10796c47509";
const IDEMPOTENCY_VALUE = "s74-idempotency-key";
const NOW_VALUE = "2026-09-15T08:00:00.000Z";

if (
  !isSchemaValue(UserIdSchema, USER_VALUE) ||
  !isSchemaValue(MembershipIdSchema, MEMBERSHIP_VALUE) ||
  !isSchemaValue(OrganizationIdSchema, ORGANIZATION_A_VALUE) ||
  !isSchemaValue(OrganizationIdSchema, ORGANIZATION_B_VALUE) ||
  !isSchemaValue(ResourceIdSchema, FAQ_VALUE) ||
  !isSchemaValue(ResourceIdSchema, POLICY_VALUE) ||
  !isSchemaValue(LocationIdSchema, LOCATION_A_VALUE) ||
  !isSchemaValue(LocationIdSchema, LOCATION_B_VALUE) ||
  !isSchemaValue(ServiceIdSchema, SERVICE_VALUE) ||
  !isSchemaValue(ConfigurationIdempotencyKeySchema, IDEMPOTENCY_VALUE) ||
  !isSchemaValue(UtcTimestampSchema, NOW_VALUE)
) {
  throw new TypeError("Invalid S7.4 application fixture");
}

const USER_ID: UserId = USER_VALUE;
const MEMBERSHIP_ID: MembershipId = MEMBERSHIP_VALUE;
const ORGANIZATION_A: OrganizationId = ORGANIZATION_A_VALUE;
const ORGANIZATION_B: OrganizationId = ORGANIZATION_B_VALUE;
const FAQ_ID: ResourceId = FAQ_VALUE;
const POLICY_ID: ResourceId = POLICY_VALUE;
const LOCATION_A: LocationId = LOCATION_A_VALUE;
const LOCATION_B: LocationId = LOCATION_B_VALUE;
const SERVICE_ID: ServiceId = SERVICE_VALUE;
const IDEMPOTENCY_KEY: ConfigurationIdempotencyKey = IDEMPOTENCY_VALUE;
const NOW_TIMESTAMP: UtcTimestamp = NOW_VALUE;
const NOW = new Date(NOW_TIMESTAMP);

const qualificationRules = () => ({
  disqualification_reasons: [
    "service_not_offered",
    "location_not_served",
    "not_interested",
    "outside_business_scope",
    "spam_or_abuse",
  ] as [
    "service_not_offered",
    "location_not_served",
    "not_interested",
    "outside_business_scope",
    "spam_or_abuse",
  ],
  require_budget: false as const,
  require_contactability: true as const,
  require_medical_eligibility: false as const,
  require_positive_next_step_intent: true as const,
  require_preferred_time: false as const,
  require_service_interest: true as const,
  require_supported_service_location: true as const,
});

const session = (): AuthenticatedApplicationSession =>
  Object.freeze({
    absoluteExpiresAt: new Date("2026-09-16T08:00:00.000Z"),
    authenticationLevel: "mfa",
    authenticationTime: NOW,
    createdAt: NOW,
    idleExpiresAt: new Date("2026-09-15T09:00:00.000Z"),
    lastSeenAt: NOW,
    rotatedAt: NOW,
    rotationDue: false,
    sessionId: "0193f1a8-7f65-7c28-a434-a10796c4750a",
    userId: USER_ID,
  });

const authorizationFor = async (
  role: MembershipRole,
  locationScope: LocationScope = "all",
  allowedLocationIds: readonly LocationId[] = [],
  organizationId: OrganizationId = ORGANIZATION_A,
): Promise<AuthorizationContext> => {
  const membership: CurrentMembershipAuthorization = Object.freeze({
    allowedLocationIds: Object.freeze([...allowedLocationIds]),
    locationScope,
    membershipId: MEMBERSHIP_ID,
    organizationId,
    role,
    status: "active",
    userId: USER_ID,
  });
  return resolveAuthorizationContext(session(), organizationId, {
    resolveCurrentMembership: () => Promise.resolve(membership),
  });
};

const faq = (overrides: Partial<Faq> = {}): Faq => ({
  answer_i18n: { en: "We offer consultation." },
  content_hash: "ab".repeat(32),
  created_at: NOW_TIMESTAMP,
  effective_from: null,
  effective_to: null,
  faq_id: FAQ_ID,
  faq_key: "implant.consultation",
  location_id: null,
  published_by_user_id: null,
  question_i18n: { en: "Do you offer implant consultation?" },
  service_id: null,
  status: "draft",
  version_no: 1,
  ...overrides,
});

type QualificationBusinessPolicy = Extract<
  BusinessPolicy,
  Readonly<{ policy_type: "qualification" }>
>;

const policy = (
  overrides: Partial<QualificationBusinessPolicy> = {},
): QualificationBusinessPolicy => ({
  content_hash: "cd".repeat(32),
  created_at: NOW_TIMESTAMP,
  effective_from: null,
  effective_to: null,
  policy_id: POLICY_ID,
  policy_key: "lead.qualification",
  policy_type: "qualification",
  published_by_user_id: null,
  rules: qualificationRules(),
  schema_version: 1,
  status: "draft",
  version_no: 1,
  ...overrides,
});

type Calls = {
  createFaq: Parameters<FaqPolicyConfigurationStore["createFaqDraft"]>[0][];
  createPolicy: Parameters<FaqPolicyConfigurationStore["createPolicyDraft"]>[0][];
  listFaqs: Parameters<FaqPolicyConfigurationStore["listFaqs"]>[0][];
  listPolicies: Parameters<FaqPolicyConfigurationStore["listPolicies"]>[0][];
  publishFaq: Parameters<FaqPolicyConfigurationStore["publishFaq"]>[0][];
  publishPolicy: Parameters<FaqPolicyConfigurationStore["publishPolicy"]>[0][];
  updateFaq: Parameters<FaqPolicyConfigurationStore["updateFaqDraft"]>[0][];
  updatePolicy: Parameters<FaqPolicyConfigurationStore["updatePolicyDraft"]>[0][];
};

const fakeStore = (): Readonly<{ calls: Calls; store: FaqPolicyConfigurationStore }> => {
  const calls: Calls = {
    createFaq: [],
    createPolicy: [],
    listFaqs: [],
    listPolicies: [],
    publishFaq: [],
    publishPolicy: [],
    updateFaq: [],
    updatePolicy: [],
  };
  const store: FaqPolicyConfigurationStore = {
    createFaqDraft: (input) => {
      calls.createFaq.push(input);
      return Promise.resolve({
        ok: true,
        value: { events: [], resource: faq({ faq_id: input.faqId, ...input.value }) },
      });
    },
    createPolicyDraft: (input) => {
      calls.createPolicy.push(input);
      return Promise.resolve({
        ok: true,
        value: { events: [], resource: policy({ policy_id: input.policyId, ...input.value }) },
      });
    },
    getFaq: () => Promise.resolve({ ok: true, value: faq() }),
    getPolicy: () => Promise.resolve({ ok: true, value: policy() }),
    listFaqs: (input) => {
      calls.listFaqs.push(input);
      return Promise.resolve({
        ok: true,
        value: { items: [faq()], next: { createdAt: NOW_TIMESTAMP, faqId: FAQ_ID } },
      });
    },
    listPolicies: (input) => {
      calls.listPolicies.push(input);
      return Promise.resolve({
        ok: true,
        value: { items: [policy()], next: { createdAt: NOW_TIMESTAMP, policyId: POLICY_ID } },
      });
    },
    publishFaq: (input) => {
      calls.publishFaq.push(input);
      return Promise.resolve({ ok: true, value: { events: [], resource: faq() } });
    },
    publishPolicy: (input) => {
      calls.publishPolicy.push(input);
      return Promise.resolve({ ok: true, value: { events: [], resource: policy() } });
    },
    retireFaq: () => Promise.resolve({ ok: true, value: { events: [], resource: faq() } }),
    retirePolicy: () => Promise.resolve({ ok: true, value: { events: [], resource: policy() } }),
    updateFaqDraft: (input) => {
      calls.updateFaq.push(input);
      return Promise.resolve({ ok: true, value: { events: [], resource: faq(input.value) } });
    },
    updatePolicyDraft: (input) => {
      calls.updatePolicy.push(input);
      return Promise.resolve({ ok: true, value: { events: [], resource: policy(input.value) } });
    },
  };
  return { calls, store };
};

const codecs = () => createFaqPolicyCursorCodec(Buffer.alloc(32, 17));
const faqUseCases = (store: FaqPolicyConfigurationStore) =>
  createFaqConfigurationUseCases(store, { clock: () => new Date(NOW), cursorCodec: codecs() });
const policyUseCases = (store: FaqPolicyConfigurationStore) =>
  createBusinessPolicyConfigurationUseCases(store, {
    clock: () => new Date(NOW),
    cursorCodec: codecs(),
  });

describe("S7.4 FAQ and qualification-policy application use cases", () => {
  it("creates bounded multilingual FAQ drafts for Owner and Admin without publishing", async () => {
    for (const role of ["owner", "admin"] as const) {
      const fixture = fakeStore();
      const result = await faqUseCases(fixture.store).createFaqDraft({
        authorization: await authorizationFor(role),
        idempotencyKey: IDEMPOTENCY_KEY,
        input: {
          answer_i18n: { en: "Yes", ru: "Да", uz: "Ha" },
          faq_key: "implant.available",
          location_id: LOCATION_A,
          question_i18n: { en: "Available?", ru: "Доступно?", uz: "Mavjudmi?" },
          service_id: SERVICE_ID,
        },
      });
      expect(result.ok).toBe(true);
      expect(fixture.calls.createFaq[0]).toMatchObject({
        value: { faq_key: "implant.available", location_id: LOCATION_A, service_id: SERVICE_ID },
      });
      expect(fixture.calls.createFaq[0]?.contentHash).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("keeps FAQ write and publish permissions separate", async () => {
    for (const role of ["staff", "analyst"] as const) {
      const fixture = fakeStore();
      const created = await faqUseCases(fixture.store).createFaqDraft({
        authorization: await authorizationFor(role),
        idempotencyKey: IDEMPOTENCY_KEY,
        input: {
          answer_i18n: { en: "Yes" },
          faq_key: "implant.available",
          location_id: null,
          question_i18n: { en: "Available?" },
          service_id: null,
        },
      });
      const published = await faqUseCases(fixture.store).publishFaq({
        authorization: await authorizationFor(role),
        expectedVersion: 1,
        idempotencyKey: "s74-faq-publish-key",
        input: {},
        target: FAQ_ID,
      });
      expect(created).toEqual({ error: { code: "permission_denied" }, ok: false });
      expect(published).toEqual({ error: { code: "permission_denied" }, ok: false });
      expect(fixture.calls.createFaq).toEqual([]);
      expect(fixture.calls.publishFaq).toEqual([]);
    }
  });

  it("rejects malformed locale maps and out-of-scope FAQ locations before persistence", async () => {
    const fixture = fakeStore();
    const useCases = faqUseCases(fixture.store);
    const malformed = await useCases.createFaqDraft({
      authorization: await authorizationFor("owner"),
      idempotencyKey: IDEMPOTENCY_KEY,
      input: {
        answer_i18n: { en: "Answer", fr: "Réponse" },
        faq_key: "bad.locale",
        location_id: null,
        question_i18n: { en: "Question" },
        service_id: null,
      } as never,
    });
    const outOfScope = await useCases.listFaqs({
      authorization: await authorizationFor("staff", "restricted", [LOCATION_A]),
      input: {
        filter: { location_id: LOCATION_B },
        pagination: {},
      },
    });
    expect(malformed).toEqual({ error: { code: "validation_failed" }, ok: false });
    expect(outOfScope).toEqual({ error: { code: "resource_not_found" }, ok: false });
    expect(fixture.calls.createFaq).toEqual([]);
  });

  it("prepares explicit FAQ draft update and publication commands with CAS provenance", async () => {
    const fixture = fakeStore();
    const useCases = faqUseCases(fixture.store);
    const updated = await useCases.updateFaqDraft({
      authorization: await authorizationFor("admin"),
      expectedVersion: 3,
      idempotencyKey: "s74-faq-update-key",
      input: {
        answer_i18n: { en: "Updated" },
        location_id: null,
        question_i18n: { en: "Updated?" },
        service_id: SERVICE_ID,
      },
      target: FAQ_ID,
    });
    const published = await useCases.publishFaq({
      authorization: await authorizationFor("admin"),
      expectedVersion: 4,
      idempotencyKey: "s74-faq-publish-key",
      input: {},
      target: FAQ_ID,
    });
    expect(updated.ok).toBe(true);
    expect(published.ok).toBe(true);
    expect(fixture.calls.updateFaq[0]?.expectedVersion).toBe(3);
    expect(fixture.calls.publishFaq[0]?.expectedVersion).toBe(4);
    expect(fixture.calls.publishFaq[0]?.eventId).toBeDefined();
  });

  it("binds FAQ cursors to tenant, authorization scope, and exact filters", async () => {
    const fixture = fakeStore();
    const authorization = await authorizationFor("staff", "restricted", [LOCATION_A]);
    const useCases = faqUseCases(fixture.store);
    const first = await useCases.listFaqs({
      authorization,
      input: {
        filter: { location_id: LOCATION_A, service_id: SERVICE_ID, status: "published" },
        pagination: {},
      },
    });
    if (!first.ok || first.value.nextCursor === null) throw new Error("Expected FAQ cursor");
    const next = await useCases.listFaqs({
      authorization,
      input: {
        filter: { location_id: LOCATION_A, service_id: SERVICE_ID, status: "published" },
        pagination: { cursor: first.value.nextCursor },
      },
    });
    const changedTenant = await useCases.listFaqs({
      authorization: await authorizationFor("staff", "all", [], ORGANIZATION_B),
      input: { filter: { status: "published" }, pagination: { cursor: first.value.nextCursor } },
    });
    expect(next.ok).toBe(true);
    expect(fixture.calls.listFaqs[1]?.after).toEqual({ createdAt: NOW_TIMESTAMP, faqId: FAQ_ID });
    expect(changedTenant).toEqual({ error: { code: "validation_failed" }, ok: false });
  });

  it("rejects tampered FAQ cursors", async () => {
    const fixture = fakeStore();
    const authorization = await authorizationFor("analyst");
    const useCases = faqUseCases(fixture.store);
    const first = await useCases.listFaqs({
      authorization,
      input: { filter: {}, pagination: {} },
    });
    if (!first.ok || first.value.nextCursor === null) throw new Error("Expected FAQ cursor");
    const tampered = `${first.value.nextCursor.slice(0, -1)}x`;
    if (!isSchemaValue(OpaqueCursorSchema, tampered)) throw new Error("Invalid cursor fixture");
    expect(
      await useCases.listFaqs({
        authorization,
        input: { filter: {}, pagination: { cursor: tampered } },
      }),
    ).toEqual({ error: { code: "validation_failed" }, ok: false });
  });

  it("accepts only the exact Qualification Policy V1 rule shape", async () => {
    const fixture = fakeStore();
    const result = await policyUseCases(fixture.store).createPolicyDraft({
      authorization: await authorizationFor("owner"),
      idempotencyKey: IDEMPOTENCY_KEY,
      input: {
        policy_key: "lead.qualification",
        policy_type: "qualification",
        rules: qualificationRules(),
        schema_version: 1,
      },
    });
    expect(result.ok).toBe(true);
    expect(fixture.calls.createPolicy[0]?.value).toEqual({
      policy_key: "lead.qualification",
      policy_type: "qualification",
      rules: qualificationRules(),
      schema_version: 1,
    });
    expect(fixture.calls.createPolicy[0]?.contentHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it.each(["booking", "handoff", "safety", "consent"] as const)(
    "fails closed for reserved but unsupported %s mutable policy rules",
    async (policyType) => {
      const fixture = fakeStore();
      const result = await policyUseCases(fixture.store).createPolicyDraft({
        authorization: await authorizationFor("owner"),
        idempotencyKey: IDEMPOTENCY_KEY,
        input: {
          policy_key: `${policyType}.policy`,
          policy_type: policyType,
          rules: { arbitrary: true },
          schema_version: 1,
        } as never,
      });
      expect(result).toEqual({ error: { code: "validation_failed" }, ok: false });
      expect(fixture.calls.createPolicy).toEqual([]);
    },
  );

  it.each([
    ["schema version", { schema_version: 2 }],
    ["arbitrary rule", { rules: { ...qualificationRules(), executable_expression: "true" } }],
    [
      "medical evaluator",
      { rules: { ...qualificationRules(), require_medical_eligibility: true } },
    ],
    ["budget evaluator", { rules: { ...qualificationRules(), require_budget: true } }],
    [
      "unsupported reason",
      {
        rules: {
          ...qualificationRules(),
          disqualification_reasons: [
            "service_not_offered",
            "location_not_served",
            "not_interested",
            "budget_not_met",
            "ai_uncertain",
          ],
        },
      },
    ],
  ])("rejects Qualification Policy V1 %s changes", async (_label, override) => {
    const fixture = fakeStore();
    const result = await policyUseCases(fixture.store).createPolicyDraft({
      authorization: await authorizationFor("owner"),
      idempotencyKey: IDEMPOTENCY_KEY,
      input: {
        policy_key: "lead.qualification",
        policy_type: "qualification",
        rules: qualificationRules(),
        schema_version: 1,
        ...override,
      } as never,
    });
    expect(result).toEqual({ error: { code: "validation_failed" }, ok: false });
    expect(fixture.calls.createPolicy).toEqual([]);
  });

  it("denies Qualification Policy mutation and publication to read-only roles", async () => {
    for (const role of ["staff", "analyst"] as const) {
      const fixture = fakeStore();
      const created = await policyUseCases(fixture.store).createPolicyDraft({
        authorization: await authorizationFor(role),
        idempotencyKey: IDEMPOTENCY_KEY,
        input: {
          policy_key: "lead.qualification",
          policy_type: "qualification",
          rules: qualificationRules(),
          schema_version: 1,
        },
      });
      const published = await policyUseCases(fixture.store).publishPolicy({
        authorization: await authorizationFor(role),
        expectedVersion: 1,
        idempotencyKey: "s74-policy-publish-key",
        input: {},
        target: POLICY_ID,
      });
      expect(created).toEqual({ error: { code: "permission_denied" }, ok: false });
      expect(published).toEqual({ error: { code: "permission_denied" }, ok: false });
    }
  });

  it("fails closed for organization-wide policy reads under restricted Location scope", async () => {
    const fixture = fakeStore();
    const authorization = await authorizationFor("analyst", "restricted", [LOCATION_A]);
    expect(
      await policyUseCases(fixture.store).getPolicy({
        authorization,
        input: { policyId: POLICY_ID },
      }),
    ).toEqual({ error: { code: "resource_not_found" }, ok: false });
    expect(
      await policyUseCases(fixture.store).listPolicies({
        authorization,
        input: { filter: {}, pagination: {} },
      }),
    ).toEqual({ error: { code: "resource_not_found" }, ok: false });
  });

  it("binds policy cursors to tenant, type, and status", async () => {
    const fixture = fakeStore();
    const authorization = await authorizationFor("owner");
    const useCases = policyUseCases(fixture.store);
    const first = await useCases.listPolicies({
      authorization,
      input: { filter: { policy_type: "qualification", status: "published" }, pagination: {} },
    });
    if (!first.ok || first.value.nextCursor === null) throw new Error("Expected policy cursor");
    const changedFilter = await useCases.listPolicies({
      authorization,
      input: {
        filter: { policy_type: "qualification", status: "draft" },
        pagination: { cursor: first.value.nextCursor },
      },
    });
    expect(changedFilter).toEqual({ error: { code: "validation_failed" }, ok: false });
  });

  it("prepares policy CAS, idempotency, and publication event provenance", async () => {
    const fixture = fakeStore();
    const useCases = policyUseCases(fixture.store);
    const updated = await useCases.updatePolicyDraft({
      authorization: await authorizationFor("admin"),
      expectedVersion: 1,
      idempotencyKey: "s74-policy-update-key",
      input: { policy_type: "qualification", rules: qualificationRules(), schema_version: 1 },
      target: POLICY_ID,
    });
    const published = await useCases.publishPolicy({
      authorization: await authorizationFor("admin"),
      expectedVersion: 2,
      idempotencyKey: "s74-policy-publish-key",
      input: {},
      target: POLICY_ID,
    });
    expect(updated.ok).toBe(true);
    expect(published.ok).toBe(true);
    expect(fixture.calls.updatePolicy[0]?.idempotency.scope).toBe(
      "configuration.business_policy.update",
    );
    expect(fixture.calls.publishPolicy[0]?.eventId).toBeDefined();
  });

  it("accepts only schema-valid FAQ/policy idempotency replay payloads", () => {
    expect(isFaqPolicyMutationReplay({ events: [], resource: faq() }, "faq")).toBe(true);
    expect(isFaqPolicyMutationReplay({ events: [], resource: policy() }, "policy")).toBe(true);
    expect(
      isFaqPolicyMutationReplay(
        { events: [], resource: { ...policy(), rules: { executable_expression: "true" } } },
        "policy",
      ),
    ).toBe(false);
  });
});
