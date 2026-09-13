import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

import {
  createBusinessPolicyConfigurationUseCases,
  createFaqConfigurationUseCases,
  createFaqPolicyCursorCodec,
  type BusinessPolicyConfigurationUseCases,
  type FaqConfigurationUseCases,
} from "../../packages/application/src/index.js";
import {
  ConfigurationIdempotencyKeySchema,
  LocationIdSchema,
  MembershipIdSchema,
  OrganizationIdSchema,
  ResourceIdSchema,
  ServiceIdSchema,
  UserIdSchema,
  isSchemaValue,
  type ConfigurationIdempotencyKey,
  type LocationId,
  type MembershipId,
  type OrganizationId,
  type ResourceId,
  type ServiceId,
  type UserId,
} from "../../packages/contracts/src/index.js";
import {
  createFaqPolicyConfigurationStore,
  type FaqPolicyConfigurationReplayProtector,
  type TenantDatabaseRuntime,
} from "../../packages/database/src/index.js";
import {
  resolveAuthorizationContext,
  type AuthenticatedApplicationSession,
  type AuthorizationContext,
  type CurrentMembershipAuthorization,
  type LocationScope,
  type MembershipRole,
} from "../../packages/security/src/index.js";
import type { Pool, PoolClient } from "pg";
import { describe, expect, it } from "vitest";

const ORGANIZATION_A_VALUE = "0193f1a8-7f65-7c28-a434-a10796c47601";
const ORGANIZATION_B_VALUE = "0193f1a8-7f65-7c28-a434-a10796c47602";
const OWNER_A_VALUE = "0193f1a8-7f65-7c28-a434-a10796c47603";
const OWNER_B_VALUE = "0193f1a8-7f65-7c28-a434-a10796c47604";
const STAFF_VALUE = "0193f1a8-7f65-7c28-a434-a10796c47605";
const OWNER_A_MEMBERSHIP_VALUE = "0193f1a8-7f65-7c28-a434-a10796c47606";
const OWNER_B_MEMBERSHIP_VALUE = "0193f1a8-7f65-7c28-a434-a10796c47607";
const STAFF_MEMBERSHIP_VALUE = "0193f1a8-7f65-7c28-a434-a10796c47608";
const LOCATION_A_VALUE = "0193f1a8-7f65-7c28-a434-a10796c47609";
const LOCATION_B_VALUE = "0193f1a8-7f65-7c28-a434-a10796c4760a";
const LOCATION_A_VERSION_VALUE = "0193f1a8-7f65-7c28-a434-a10796c4760b";
const LOCATION_B_VERSION_VALUE = "0193f1a8-7f65-7c28-a434-a10796c4760c";
const SERVICE_VALUE = "0193f1a8-7f65-7c28-a434-a10796c4760d";
const SERVICE_VERSION_VALUE = "0193f1a8-7f65-7c28-a434-a10796c4760e";

if (
  !isSchemaValue(OrganizationIdSchema, ORGANIZATION_A_VALUE) ||
  !isSchemaValue(OrganizationIdSchema, ORGANIZATION_B_VALUE) ||
  !isSchemaValue(UserIdSchema, OWNER_A_VALUE) ||
  !isSchemaValue(UserIdSchema, OWNER_B_VALUE) ||
  !isSchemaValue(UserIdSchema, STAFF_VALUE) ||
  !isSchemaValue(MembershipIdSchema, OWNER_A_MEMBERSHIP_VALUE) ||
  !isSchemaValue(MembershipIdSchema, OWNER_B_MEMBERSHIP_VALUE) ||
  !isSchemaValue(MembershipIdSchema, STAFF_MEMBERSHIP_VALUE) ||
  !isSchemaValue(LocationIdSchema, LOCATION_A_VALUE) ||
  !isSchemaValue(LocationIdSchema, LOCATION_B_VALUE) ||
  !isSchemaValue(ResourceIdSchema, LOCATION_A_VERSION_VALUE) ||
  !isSchemaValue(ResourceIdSchema, LOCATION_B_VERSION_VALUE) ||
  !isSchemaValue(ServiceIdSchema, SERVICE_VALUE) ||
  !isSchemaValue(ResourceIdSchema, SERVICE_VERSION_VALUE)
) {
  throw new TypeError("Invalid S7.4 database fixture identifiers");
}

const ORGANIZATION_A: OrganizationId = ORGANIZATION_A_VALUE;
const ORGANIZATION_B: OrganizationId = ORGANIZATION_B_VALUE;
const OWNER_A: UserId = OWNER_A_VALUE;
const OWNER_B: UserId = OWNER_B_VALUE;
const STAFF: UserId = STAFF_VALUE;
const OWNER_A_MEMBERSHIP: MembershipId = OWNER_A_MEMBERSHIP_VALUE;
const OWNER_B_MEMBERSHIP: MembershipId = OWNER_B_MEMBERSHIP_VALUE;
const STAFF_MEMBERSHIP: MembershipId = STAFF_MEMBERSHIP_VALUE;
const LOCATION_A: LocationId = LOCATION_A_VALUE;
const LOCATION_B: LocationId = LOCATION_B_VALUE;
const LOCATION_A_VERSION: ResourceId = LOCATION_A_VERSION_VALUE;
const LOCATION_B_VERSION: ResourceId = LOCATION_B_VERSION_VALUE;
const SERVICE_ID: ServiceId = SERVICE_VALUE;
const SERVICE_VERSION: ResourceId = SERVICE_VERSION_VALUE;
const CLOCK = new Date("2026-09-15T09:00:00.000Z");
const CURSOR_KEY = Buffer.alloc(32, 0x74);
const REPLAY_KEY = Buffer.alloc(32, 0x47);

type Harness = Readonly<{
  privilegedPool: () => Pool;
  runtime: () => TenantDatabaseRuntime;
}>;

const requireIdempotencyKey = (value: string): ConfigurationIdempotencyKey => {
  if (!isSchemaValue(ConfigurationIdempotencyKeySchema, value)) {
    throw new TypeError("Invalid S7.4 idempotency fixture");
  }
  return value;
};

const idempotencyKey = (suffix: string): ConfigurationIdempotencyKey =>
  requireIdempotencyKey(`s74-${suffix}-key`);

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

const replayProtector: FaqPolicyConfigurationReplayProtector = Object.freeze({
  protect: (scope: string, plaintext: Uint8Array): Uint8Array => {
    const nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", REPLAY_KEY, nonce);
    cipher.setAAD(Buffer.from(scope, "utf8"));
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    return Buffer.concat([nonce, cipher.getAuthTag(), ciphertext]);
  },
  reveal: (scope: string, protectedValue: Uint8Array): Uint8Array => {
    if (protectedValue.byteLength < 28) throw new TypeError("Invalid replay fixture");
    const packed = Buffer.from(protectedValue);
    const decipher = createDecipheriv("aes-256-gcm", REPLAY_KEY, packed.subarray(0, 12));
    decipher.setAAD(Buffer.from(scope, "utf8"));
    decipher.setAuthTag(packed.subarray(12, 28));
    return Buffer.concat([decipher.update(packed.subarray(28)), decipher.final()]);
  },
});

const insertOrganization = (
  pool: Pool,
  id: OrganizationId,
  slug: string,
  defaultLocale: "en" | "ru" | "uz" = "en",
): Promise<unknown> =>
  pool.query(
    `insert into organizations
      (id,slug,display_name,status,default_locale,default_time_zone)
     values ($1,$2,'S7.4 Synthetic Clinic','active',$3,'Asia/Tashkent')`,
    [id, slug, defaultLocale],
  );

const insertUser = (pool: Pool, id: UserId): Promise<unknown> =>
  pool.query("insert into users (id,status) values ($1,'active')", [id]);

const insertMembership = (
  pool: Pool,
  id: MembershipId,
  organizationId: OrganizationId,
  userId: UserId,
  role: MembershipRole,
  locationScope: LocationScope,
): Promise<unknown> =>
  pool.query(
    `insert into memberships
      (id,organization_id,user_id,role,status,location_scope,activated_at)
     values ($1,$2,$3,$4,'active',$5,$6)`,
    [id, organizationId, userId, role, locationScope, CLOCK],
  );

const applicationSession = (userId: UserId): AuthenticatedApplicationSession =>
  Object.freeze({
    absoluteExpiresAt: new Date("2026-09-16T09:00:00.000Z"),
    authenticationLevel: "mfa",
    authenticationTime: CLOCK,
    createdAt: CLOCK,
    idleExpiresAt: new Date("2026-09-15T10:00:00.000Z"),
    lastSeenAt: CLOCK,
    rotatedAt: CLOCK,
    rotationDue: false,
    sessionId: "0193f1a8-7f65-7c28-a434-a10796c4760f",
    userId,
  });

const authorizationFor = (
  organizationId: OrganizationId,
  userId: UserId,
  membershipId: MembershipId,
  role: MembershipRole,
  locationScope: LocationScope = "all",
  allowedLocationIds: readonly LocationId[] = [],
): Promise<AuthorizationContext> => {
  const membership: CurrentMembershipAuthorization = Object.freeze({
    allowedLocationIds: Object.freeze([...allowedLocationIds]),
    locationScope,
    membershipId,
    organizationId,
    role,
    status: "active",
    userId,
  });
  return resolveAuthorizationContext(applicationSession(userId), organizationId, {
    resolveCurrentMembership: () => Promise.resolve(membership),
  });
};

const seedOwner = async (
  pool: Pool,
  organizationId: OrganizationId,
  userId: UserId,
  membershipId: MembershipId,
  slug: string,
  defaultLocale: "en" | "ru" | "uz" = "en",
): Promise<AuthorizationContext> => {
  await insertOrganization(pool, organizationId, slug, defaultLocale);
  await insertUser(pool, userId);
  await insertMembership(pool, membershipId, organizationId, userId, "owner", "all");
  return authorizationFor(organizationId, userId, membershipId, "owner");
};

const seedLocation = async (
  pool: Pool,
  organizationId: OrganizationId,
  ownerId: UserId,
  locationId: LocationId,
  versionId: ResourceId,
  code: string,
): Promise<void> => {
  await pool.query(
    `insert into locations
      (id,organization_id,code,status,current_version_id,version,created_at,updated_at)
     values ($1,$2,$3,'inactive',null,1,$4,$4)`,
    [locationId, organizationId, code, CLOCK],
  );
  await pool.query(
    `insert into location_versions
      (id,organization_id,location_id,version_no,name_i18n,address_i18n,
       public_contact_jsonb,time_zone,content_hash,published_at,published_by_user_id,created_at)
     values ($1,$2,$3,1,$4::jsonb,$5::jsonb,$6::jsonb,'Asia/Tashkent',$7,$8,$9,$8)`,
    [
      versionId,
      organizationId,
      locationId,
      JSON.stringify({ en: code }),
      JSON.stringify({ en: "Synthetic address" }),
      JSON.stringify({ phone: "+998901234567" }),
      Buffer.from(`s74-${code}`),
      CLOCK,
      ownerId,
    ],
  );
  await pool.query(
    `update locations set status = 'active', current_version_id = $2,
       version = 2, updated_at = $3 where id = $1`,
    [locationId, versionId, CLOCK],
  );
};

const seedService = async (
  pool: Pool,
  organizationId: OrganizationId,
  ownerId: UserId,
  locationId: LocationId,
): Promise<void> => {
  await pool.query(
    `insert into services
      (id,organization_id,code,status,current_version_id,version,created_at,updated_at)
     values ($1,$2,'implant-consultation','inactive',null,1,$3,$3)`,
    [SERVICE_ID, organizationId, CLOCK],
  );
  await pool.query(
    `insert into service_versions
      (id,organization_id,service_id,version_no,name_i18n,description_i18n,
       duration_guidance_minutes,disclaimer_i18n,content_hash,published_at,
       published_by_user_id,created_at)
     values ($1,$2,$3,1,$4::jsonb,$5::jsonb,45,$6::jsonb,$7,$8,$9,$8)`,
    [
      SERVICE_VERSION,
      organizationId,
      SERVICE_ID,
      JSON.stringify({ en: "Implant consultation" }),
      JSON.stringify({ en: "Assessment" }),
      JSON.stringify({ en: "Clinical assessment required" }),
      Buffer.from("s74-service"),
      CLOCK,
      ownerId,
    ],
  );
  await pool.query(
    `update services set status = 'active', current_version_id = $2,
       version = 2, updated_at = $3 where id = $1`,
    [SERVICE_ID, SERVICE_VERSION, CLOCK],
  );
  await pool.query(
    `insert into service_locations
      (organization_id,service_id,location_id,status,effective_from,effective_to,created_at)
     values ($1,$2,$3,'active',$4,null,$4)`,
    [organizationId, SERVICE_ID, locationId, CLOCK],
  );
};

const applications = (
  runtime: TenantDatabaseRuntime,
  clock: () => Date = () => new Date(CLOCK),
): Readonly<{
  faqs: FaqConfigurationUseCases;
  policies: BusinessPolicyConfigurationUseCases;
}> => {
  const store = createFaqPolicyConfigurationStore(runtime, replayProtector);
  const options = { clock, cursorCodec: createFaqPolicyCursorCodec(CURSOR_KEY) };
  return Object.freeze({
    faqs: createFaqConfigurationUseCases(store, options),
    policies: createBusinessPolicyConfigurationUseCases(store, options),
  });
};

const createFaq = async (
  application: FaqConfigurationUseCases,
  authorization: AuthorizationContext,
  suffix: string,
  input: Parameters<FaqConfigurationUseCases["createFaqDraft"]>[0]["input"] = {
    answer_i18n: { en: "Yes, after consultation." },
    faq_key: "implant.available",
    location_id: null,
    question_i18n: { en: "Is implant treatment available?" },
    service_id: null,
  },
): Promise<ResourceId> => {
  const result = await application.createFaqDraft({
    authorization,
    idempotencyKey: idempotencyKey(`${suffix}-faq-create`),
    input,
  });
  if (!result.ok) throw new Error(`FAQ creation failed: ${result.error.code}`);
  return result.value.resource.faq_id;
};

const createPolicy = async (
  application: BusinessPolicyConfigurationUseCases,
  authorization: AuthorizationContext,
  suffix: string,
): Promise<ResourceId> => {
  const result = await application.createPolicyDraft({
    authorization,
    idempotencyKey: idempotencyKey(`${suffix}-policy-create`),
    input: {
      policy_key: "lead.qualification",
      policy_type: "qualification",
      rules: qualificationRules(),
      schema_version: 1,
    },
  });
  if (!result.ok) throw new Error(`Policy creation failed: ${result.error.code}`);
  return result.value.resource.policy_id;
};

const asResourceId = (value: unknown): ResourceId => {
  if (!isSchemaValue(ResourceIdSchema, value)) throw new TypeError("Invalid resource fixture");
  return value;
};

const withRuntimeRole = async (
  pool: Pool,
  organizationId: OrganizationId,
  operation: (client: PoolClient) => Promise<void>,
): Promise<void> => {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("set local role lead_agent_runtime");
    await client.query("select set_config('app.organization_id',$1::uuid::text,true)", [
      organizationId,
    ]);
    await operation(client);
    await client.query("rollback");
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
};

const insertUnsupportedPolicy = async (
  pool: Pool,
  organizationId: OrganizationId,
  ownerId: UserId,
  policyType: "booking" | "consent" | "handoff" | "safety",
  id: ResourceId,
): Promise<void> => {
  await pool.query(
    `insert into business_policies
      (organization_id,id,policy_key,version_no,policy_type,schema_version,rules_jsonb,
       status,effective_from,effective_to,content_hash,published_by_user_id,created_at)
     values ($1,$2,$3,1,$4,1,'{"arbitrary":true}'::jsonb,'published',$5,null,$6,$7,$5)`,
    [
      organizationId,
      id,
      `${policyType}.policy`,
      policyType,
      CLOCK,
      Buffer.from("unsupported"),
      ownerId,
    ],
  );
};

export const registerFaqPolicyConfigurationTests = (harness: Harness): void => {
  describe("S7.4 FAQ and Qualification Policy V1 persistence", { timeout: 45_000 }, () => {
    it("creates FAQ drafts idempotently with monotonic versions and audit only", async () => {
      const pool = harness.privilegedPool();
      const owner = await seedOwner(pool, ORGANIZATION_A, OWNER_A, OWNER_A_MEMBERSHIP, "s74-faq");
      const app = applications(harness.runtime()).faqs;
      const input = {
        answer_i18n: { en: "Yes" },
        faq_key: "implant.available",
        location_id: null,
        question_i18n: { en: "Available?" },
        service_id: null,
      };
      const key = idempotencyKey("faq-idempotent-create");
      const first = await app.createFaqDraft({ authorization: owner, idempotencyKey: key, input });
      const replay = await app.createFaqDraft({ authorization: owner, idempotencyKey: key, input });
      const second = await app.createFaqDraft({
        authorization: owner,
        idempotencyKey: idempotencyKey("faq-second-create"),
        input,
      });
      expect(first.ok && first.value.resource).toMatchObject({ status: "draft", version_no: 1 });
      expect(replay).toEqual(first);
      expect(second.ok && second.value.resource).toMatchObject({ status: "draft", version_no: 2 });
      expect(first.ok && first.value.events).toEqual([]);
      expect(await pool.query("select count(*)::int as count from audit_events")).toMatchObject({
        rows: [{ count: 2 }],
      });
      expect(await pool.query("select count(*)::int as count from outbox_events")).toMatchObject({
        rows: [{ count: 0 }],
      });
    });

    it("updates FAQ drafts with CAS and rejects stale or published mutation", async () => {
      const pool = harness.privilegedPool();
      const owner = await seedOwner(pool, ORGANIZATION_A, OWNER_A, OWNER_A_MEMBERSHIP, "s74-cas");
      const app = applications(harness.runtime()).faqs;
      const faqId = await createFaq(app, owner, "cas");
      const stale = await app.updateFaqDraft({
        authorization: owner,
        expectedVersion: 9,
        idempotencyKey: idempotencyKey("faq-stale-update"),
        input: {
          answer_i18n: { en: "Updated" },
          location_id: null,
          question_i18n: { en: "Updated?" },
          service_id: null,
        },
        target: faqId,
      });
      const updated = await app.updateFaqDraft({
        authorization: owner,
        expectedVersion: 1,
        idempotencyKey: idempotencyKey("faq-valid-update"),
        input: {
          answer_i18n: { en: "Updated" },
          location_id: null,
          question_i18n: { en: "Updated?" },
          service_id: null,
        },
        target: faqId,
      });
      expect(stale).toEqual({ error: { code: "version_conflict" }, ok: false });
      expect(updated.ok && updated.value.resource).toMatchObject({
        answer_i18n: { en: "Updated" },
        version_no: 2,
      });
      await app.publishFaq({
        authorization: owner,
        expectedVersion: 2,
        idempotencyKey: idempotencyKey("faq-cas-publish"),
        input: {},
        target: faqId,
      });
      expect(
        await app.updateFaqDraft({
          authorization: owner,
          expectedVersion: 2,
          idempotencyKey: idempotencyKey("faq-published-update"),
          input: {
            answer_i18n: { en: "Forbidden" },
            location_id: null,
            question_i18n: { en: "Forbidden?" },
            service_id: null,
          },
          target: faqId,
        }),
      ).toEqual({ error: { code: "business_rule_failed" }, ok: false });
    });

    it("publishes FAQ authority atomically with the canonical event and exact provenance", async () => {
      const pool = harness.privilegedPool();
      const owner = await seedOwner(
        pool,
        ORGANIZATION_A,
        OWNER_A,
        OWNER_A_MEMBERSHIP,
        "s74-publish",
      );
      const app = applications(harness.runtime()).faqs;
      const faqId = await createFaq(app, owner, "publish");
      const result = await app.publishFaq({
        authorization: owner,
        expectedVersion: 1,
        idempotencyKey: idempotencyKey("faq-publish"),
        input: {},
        target: faqId,
      });
      expect(result.ok && result.value.resource).toMatchObject({
        effective_from: CLOCK.toISOString(),
        published_by_user_id: OWNER_A,
        status: "published",
        version_no: 1,
      });
      expect(result.ok && result.value.events[0]).toMatchObject({
        aggregate_id: faqId,
        aggregate_type: "faq",
        aggregate_version: 1,
        event_type: "faq.published",
        payload: { faq_version: 1 },
      });
      expect(await pool.query("select event_type from outbox_events")).toMatchObject({
        rows: [{ event_type: "faq.published" }],
      });
      expect(
        await pool.query("select action from audit_events order by occurred_at"),
      ).toMatchObject({
        rows: [{ action: "faq.draft_created" }, { action: "faq.published" }],
      });
    });

    it("requires the organization default locale in both FAQ maps at publication", async () => {
      const pool = harness.privilegedPool();
      const owner = await seedOwner(
        pool,
        ORGANIZATION_A,
        OWNER_A,
        OWNER_A_MEMBERSHIP,
        "s74-locale",
        "ru",
      );
      const app = applications(harness.runtime()).faqs;
      const faqId = await createFaq(app, owner, "locale");
      expect(
        await app.publishFaq({
          authorization: owner,
          expectedVersion: 1,
          idempotencyKey: idempotencyKey("faq-locale-publish"),
          input: {},
          target: faqId,
        }),
      ).toEqual({ error: { code: "validation_failed" }, ok: false });
      expect(await pool.query("select status from faqs where id = $1", [faqId])).toMatchObject({
        rows: [{ status: "draft" }],
      });
    });

    it("enforces same-tenant FAQ scope and restricted-reader projections", async () => {
      const pool = harness.privilegedPool();
      const owner = await seedOwner(pool, ORGANIZATION_A, OWNER_A, OWNER_A_MEMBERSHIP, "s74-scope");
      await seedLocation(pool, ORGANIZATION_A, OWNER_A, LOCATION_A, LOCATION_A_VERSION, "scope-a");
      await seedLocation(pool, ORGANIZATION_A, OWNER_A, LOCATION_B, LOCATION_B_VERSION, "scope-b");
      await seedService(pool, ORGANIZATION_A, OWNER_A, LOCATION_A);
      await insertUser(pool, STAFF);
      await insertMembership(pool, STAFF_MEMBERSHIP, ORGANIZATION_A, STAFF, "staff", "restricted");
      await pool.query(
        `insert into membership_location_scopes
          (organization_id,membership_id,location_id,created_by_user_id)
         values ($1,$2,$3,$4)`,
        [ORGANIZATION_A, STAFF_MEMBERSHIP, LOCATION_A, OWNER_A],
      );
      const restricted = await authorizationFor(
        ORGANIZATION_A,
        STAFF,
        STAFF_MEMBERSHIP,
        "staff",
        "restricted",
        [LOCATION_A],
      );
      const app = applications(harness.runtime()).faqs;
      const organizationFaq = await createFaq(app, owner, "scope-org", {
        answer_i18n: { en: "Organization" },
        faq_key: "scope.organization",
        location_id: null,
        question_i18n: { en: "Organization?" },
        service_id: null,
      });
      const locationFaq = await createFaq(app, owner, "scope-location", {
        answer_i18n: { en: "Location" },
        faq_key: "scope.location",
        location_id: LOCATION_A,
        question_i18n: { en: "Location?" },
        service_id: null,
      });
      const serviceFaq = await createFaq(app, owner, "scope-service", {
        answer_i18n: { en: "Service" },
        faq_key: "scope.service",
        location_id: null,
        question_i18n: { en: "Service?" },
        service_id: SERVICE_ID,
      });
      const combinedFaq = await createFaq(app, owner, "scope-combined", {
        answer_i18n: { en: "Combined" },
        faq_key: "scope.combined",
        location_id: LOCATION_B,
        question_i18n: { en: "Combined?" },
        service_id: SERVICE_ID,
      });
      const listed = await app.listFaqs({
        authorization: restricted,
        input: { filter: {}, pagination: { limit: 100 } },
      });
      expect(listed.ok && listed.value.items.map((item) => item.faq_id).sort()).toEqual(
        [locationFaq, serviceFaq].sort(),
      );
      for (const denied of [organizationFaq, combinedFaq]) {
        expect(await app.getFaq({ authorization: restricted, input: { faqId: denied } })).toEqual({
          error: { code: "resource_not_found" },
          ok: false,
        });
      }
    });

    it("serializes same-scope FAQ publication and preserves the losing draft", async () => {
      const pool = harness.privilegedPool();
      const owner = await seedOwner(pool, ORGANIZATION_A, OWNER_A, OWNER_A_MEMBERSHIP, "s74-race");
      const app = applications(harness.runtime()).faqs;
      const faqA = await createFaq(app, owner, "race-a");
      const faqB = await createFaq(app, owner, "race-b");
      const results = await Promise.all([
        app.publishFaq({
          authorization: owner,
          expectedVersion: 1,
          idempotencyKey: idempotencyKey("faq-race-publish-a"),
          input: {},
          target: faqA,
        }),
        app.publishFaq({
          authorization: owner,
          expectedVersion: 2,
          idempotencyKey: idempotencyKey("faq-race-publish-b"),
          input: {},
          target: faqB,
        }),
      ]);
      expect(results.filter((result) => result.ok)).toHaveLength(1);
      expect(results.filter((result) => !result.ok)).toHaveLength(1);
      expect(
        await pool.query(
          "select status,count(*)::int as count from faqs group by status order by status",
        ),
      ).toMatchObject({
        rows: [
          { count: 1, status: "draft" },
          { count: 1, status: "published" },
        ],
      });
    });

    it("retires FAQ history without inventing an event and blocks runtime mutation/deletion", async () => {
      const pool = harness.privilegedPool();
      const owner = await seedOwner(
        pool,
        ORGANIZATION_A,
        OWNER_A,
        OWNER_A_MEMBERSHIP,
        "s74-retire",
      );
      let current = new Date(CLOCK);
      const app = applications(harness.runtime(), () => new Date(current)).faqs;
      const faqId = await createFaq(app, owner, "retire");
      await app.publishFaq({
        authorization: owner,
        expectedVersion: 1,
        idempotencyKey: idempotencyKey("faq-retire-publish"),
        input: {},
        target: faqId,
      });
      current = new Date(CLOCK.getTime() + 60_000);
      const retired = await app.retireFaq({
        authorization: owner,
        expectedVersion: 1,
        idempotencyKey: idempotencyKey("faq-retire"),
        input: {},
        target: faqId,
      });
      expect(retired.ok && retired.value.resource).toMatchObject({
        effective_to: current.toISOString(),
        status: "retired",
      });
      expect(retired.ok && retired.value.events).toEqual([]);
      expect(await pool.query("select event_type from outbox_events")).toMatchObject({
        rows: [{ event_type: "faq.published" }],
      });
      await expect(
        withRuntimeRole(pool, ORGANIZATION_A, async (client) => {
          await client.query(
            `update faqs set answer_i18n = '{"en":"Changed"}'::jsonb
              where organization_id = $1 and id = $2`,
            [ORGANIZATION_A, faqId],
          );
        }),
      ).rejects.toMatchObject({ code: "23514" });
      await expect(
        withRuntimeRole(pool, ORGANIZATION_A, async (client) => {
          await client.query("delete from faqs where organization_id = $1 and id = $2", [
            ORGANIZATION_A,
            faqId,
          ]);
        }),
      ).rejects.toMatchObject({ code: "23514" });
    });

    it("maps cross-tenant FAQ identifiers to tenant-local not found", async () => {
      const pool = harness.privilegedPool();
      const ownerA = await seedOwner(
        pool,
        ORGANIZATION_A,
        OWNER_A,
        OWNER_A_MEMBERSHIP,
        "s74-tenant-a",
      );
      const ownerB = await seedOwner(
        pool,
        ORGANIZATION_B,
        OWNER_B,
        OWNER_B_MEMBERSHIP,
        "s74-tenant-b",
      );
      const apps = applications(harness.runtime()).faqs;
      const faqB = await createFaq(apps, ownerB, "tenant-b");
      expect(await apps.getFaq({ authorization: ownerA, input: { faqId: faqB } })).toEqual({
        error: { code: "resource_not_found" },
        ok: false,
      });
      expect(
        await apps.publishFaq({
          authorization: ownerA,
          expectedVersion: 1,
          idempotencyKey: idempotencyKey("tenant-a-hostile-publish"),
          input: {},
          target: faqB,
        }),
      ).toEqual({ error: { code: "resource_not_found" }, ok: false });
    });

    it("creates, updates, publishes, and retires exact Qualification Policy V1", async () => {
      const pool = harness.privilegedPool();
      const owner = await seedOwner(
        pool,
        ORGANIZATION_A,
        OWNER_A,
        OWNER_A_MEMBERSHIP,
        "s74-policy",
      );
      let current = new Date(CLOCK);
      const app = applications(harness.runtime(), () => new Date(current)).policies;
      const policyId = await createPolicy(app, owner, "lifecycle");
      const updated = await app.updatePolicyDraft({
        authorization: owner,
        expectedVersion: 1,
        idempotencyKey: idempotencyKey("policy-update"),
        input: { policy_type: "qualification", rules: qualificationRules(), schema_version: 1 },
        target: policyId,
      });
      expect(updated.ok && updated.value.resource).toMatchObject({
        policy_type: "qualification",
        rules: qualificationRules(),
        schema_version: 1,
        status: "draft",
        version_no: 2,
      });
      const published = await app.publishPolicy({
        authorization: owner,
        expectedVersion: 2,
        idempotencyKey: idempotencyKey("policy-publish"),
        input: {},
        target: policyId,
      });
      expect(published.ok && published.value.events[0]).toMatchObject({
        aggregate_id: policyId,
        aggregate_type: "business_policy",
        aggregate_version: 2,
        event_type: "business_policy.published",
        payload: { business_policy_version: 2 },
      });
      current = new Date(CLOCK.getTime() + 60_000);
      const retired = await app.retirePolicy({
        authorization: owner,
        expectedVersion: 2,
        idempotencyKey: idempotencyKey("policy-retire"),
        input: {},
        target: policyId,
      });
      expect(retired.ok && retired.value.resource).toMatchObject({
        effective_to: current.toISOString(),
        status: "retired",
      });
      expect(retired.ok && retired.value.events).toEqual([]);
      expect(await pool.query("select event_type from outbox_events")).toMatchObject({
        rows: [{ event_type: "business_policy.published" }],
      });
    });

    it.each(["booking", "handoff", "safety", "consent"] as const)(
      "keeps legacy published %s rows outside trusted reads and rejects publication",
      async (policyType) => {
        const pool = harness.privilegedPool();
        const owner = await seedOwner(
          pool,
          ORGANIZATION_A,
          OWNER_A,
          OWNER_A_MEMBERSHIP,
          `s74-${policyType}`,
        );
        const unsupportedId = asResourceId(
          `0193f1a8-7f65-7c28-a434-a10796c47${
            { booking: "610", consent: "611", handoff: "612", safety: "613" }[policyType]
          }`,
        );
        await insertUnsupportedPolicy(pool, ORGANIZATION_A, OWNER_A, policyType, unsupportedId);
        const app = applications(harness.runtime()).policies;
        expect(
          await app.getPolicy({ authorization: owner, input: { policyId: unsupportedId } }),
        ).toEqual({ error: { code: "resource_not_found" }, ok: false });
        const listed = await app.listPolicies({
          authorization: owner,
          input: { filter: {}, pagination: { limit: 100 } },
        });
        expect(listed.ok && listed.value.items).toEqual([]);
        expect(
          await app.publishPolicy({
            authorization: owner,
            expectedVersion: 1,
            idempotencyKey: idempotencyKey(`${policyType}-publish`),
            input: {},
            target: unsupportedId,
          }),
        ).toEqual({ error: { code: "business_rule_failed" }, ok: false });
      },
    );

    it("rejects arbitrary qualification JSON and unsupported policy insertion by runtime role", async () => {
      const pool = harness.privilegedPool();
      await seedOwner(pool, ORGANIZATION_A, OWNER_A, OWNER_A_MEMBERSHIP, "s74-raw-policy");
      await expect(
        withRuntimeRole(pool, ORGANIZATION_A, async (client) => {
          await client.query(
            `insert into business_policies
              (organization_id,id,policy_key,version_no,policy_type,schema_version,rules_jsonb,
               status,effective_from,effective_to,content_hash,published_by_user_id,created_at)
             values ($1,$2,'booking.raw',1,'booking',1,'{"arbitrary":true}'::jsonb,
               'draft',null,null,$3,null,$4)`,
            [
              ORGANIZATION_A,
              "0193f1a8-7f65-7c28-a434-a10796c47614",
              Buffer.from("unsupported"),
              CLOCK,
            ],
          );
        }),
      ).rejects.toMatchObject({ code: "23514" });
      await expect(
        withRuntimeRole(pool, ORGANIZATION_A, async (client) => {
          await client.query(
            `insert into business_policies
              (organization_id,id,policy_key,version_no,policy_type,schema_version,rules_jsonb,
               status,effective_from,effective_to,content_hash,published_by_user_id,created_at)
             values ($1,$2,'qualification.raw',1,'qualification',1,
               '{"executable_expression":"true"}'::jsonb,'draft',null,null,$3,null,$4)`,
            [
              ORGANIZATION_A,
              "0193f1a8-7f65-7c28-a434-a10796c47615",
              Buffer.from("unsupported"),
              CLOCK,
            ],
          );
        }),
      ).rejects.toMatchObject({ code: "23514" });
    });

    it("serializes qualification-policy publication and preserves the losing draft", async () => {
      const pool = harness.privilegedPool();
      const owner = await seedOwner(
        pool,
        ORGANIZATION_A,
        OWNER_A,
        OWNER_A_MEMBERSHIP,
        "s74-policy-race",
      );
      const app = applications(harness.runtime()).policies;
      const policyA = await createPolicy(app, owner, "race-a");
      const policyB = await createPolicy(app, owner, "race-b");
      const results = await Promise.all([
        app.publishPolicy({
          authorization: owner,
          expectedVersion: 1,
          idempotencyKey: idempotencyKey("policy-race-publish-a"),
          input: {},
          target: policyA,
        }),
        app.publishPolicy({
          authorization: owner,
          expectedVersion: 2,
          idempotencyKey: idempotencyKey("policy-race-publish-b"),
          input: {},
          target: policyB,
        }),
      ]);
      expect(results.filter((result) => result.ok)).toHaveLength(1);
      expect(results.filter((result) => !result.ok)).toHaveLength(1);
      expect(
        await pool.query(
          "select status,count(*)::int as count from business_policies group by status order by status",
        ),
      ).toMatchObject({
        rows: [
          { count: 1, status: "draft" },
          { count: 1, status: "published" },
        ],
      });
    });

    it("enforces all-location policy reads and immutable published policy history", async () => {
      const pool = harness.privilegedPool();
      const owner = await seedOwner(
        pool,
        ORGANIZATION_A,
        OWNER_A,
        OWNER_A_MEMBERSHIP,
        "s74-policy-read",
      );
      await seedLocation(pool, ORGANIZATION_A, OWNER_A, LOCATION_A, LOCATION_A_VERSION, "read-a");
      await insertUser(pool, STAFF);
      await insertMembership(pool, STAFF_MEMBERSHIP, ORGANIZATION_A, STAFF, "staff", "restricted");
      await pool.query(
        `insert into membership_location_scopes
          (organization_id,membership_id,location_id,created_by_user_id)
         values ($1,$2,$3,$4)`,
        [ORGANIZATION_A, STAFF_MEMBERSHIP, LOCATION_A, OWNER_A],
      );
      const restricted = await authorizationFor(
        ORGANIZATION_A,
        STAFF,
        STAFF_MEMBERSHIP,
        "staff",
        "restricted",
        [LOCATION_A],
      );
      const app = applications(harness.runtime()).policies;
      const policyId = await createPolicy(app, owner, "read");
      await app.publishPolicy({
        authorization: owner,
        expectedVersion: 1,
        idempotencyKey: idempotencyKey("policy-read-publish"),
        input: {},
        target: policyId,
      });
      expect(await app.getPolicy({ authorization: restricted, input: { policyId } })).toEqual({
        error: { code: "resource_not_found" },
        ok: false,
      });
      await expect(
        withRuntimeRole(pool, ORGANIZATION_A, async (client) => {
          await client.query(
            `update business_policies set rules_jsonb = '{"arbitrary":true}'::jsonb
              where organization_id = $1 and id = $2`,
            [ORGANIZATION_A, policyId],
          );
        }),
      ).rejects.toMatchObject({ code: "23514" });
      await expect(
        withRuntimeRole(pool, ORGANIZATION_A, async (client) => {
          await client.query(
            "delete from business_policies where organization_id = $1 and id = $2",
            [ORGANIZATION_A, policyId],
          );
        }),
      ).rejects.toMatchObject({ code: "23514" });
    });

    it("rolls back qualification-policy publication if Outbox insertion fails", async () => {
      const pool = harness.privilegedPool();
      const owner = await seedOwner(
        pool,
        ORGANIZATION_A,
        OWNER_A,
        OWNER_A_MEMBERSHIP,
        "s74-rollback",
      );
      const app = applications(harness.runtime()).policies;
      const policyId = await createPolicy(app, owner, "rollback");
      await pool.query(`create or replace function app.s74_injected_failure()
        returns trigger language plpgsql as $body$
        begin raise exception using errcode = '40001', message = 'synthetic S7.4 failure'; end
        $body$`);
      await pool.query(
        `create trigger s74_injected_failure before insert on outbox_events
         for each row execute function app.s74_injected_failure()`,
      );
      try {
        expect(
          await app.publishPolicy({
            authorization: owner,
            expectedVersion: 1,
            idempotencyKey: idempotencyKey("policy-rollback-publish"),
            input: {},
            target: policyId,
          }),
        ).toEqual({ error: { code: "version_conflict" }, ok: false });
      } finally {
        await pool.query("drop trigger if exists s74_injected_failure on outbox_events");
        await pool.query("drop function if exists app.s74_injected_failure()");
      }
      expect(
        await pool.query("select status from business_policies where id = $1", [policyId]),
      ).toMatchObject({
        rows: [{ status: "draft" }],
      });
      expect(await pool.query("select count(*)::int as count from outbox_events")).toMatchObject({
        rows: [{ count: 0 }],
      });
    });

    it("maps conflicting idempotency reuse and cross-tenant policies deterministically", async () => {
      const pool = harness.privilegedPool();
      const ownerA = await seedOwner(
        pool,
        ORGANIZATION_A,
        OWNER_A,
        OWNER_A_MEMBERSHIP,
        "s74-idem-a",
      );
      const ownerB = await seedOwner(
        pool,
        ORGANIZATION_B,
        OWNER_B,
        OWNER_B_MEMBERSHIP,
        "s74-idem-b",
      );
      const app = applications(harness.runtime()).policies;
      const key = idempotencyKey("policy-conflicting-create");
      const first = await app.createPolicyDraft({
        authorization: ownerA,
        idempotencyKey: key,
        input: {
          policy_key: "lead.qualification",
          policy_type: "qualification",
          rules: qualificationRules(),
          schema_version: 1,
        },
      });
      const conflict = await app.createPolicyDraft({
        authorization: ownerA,
        idempotencyKey: key,
        input: {
          policy_key: "lead.qualification.changed",
          policy_type: "qualification",
          rules: qualificationRules(),
          schema_version: 1,
        },
      });
      const policyB = await createPolicy(app, ownerB, "tenant-b");
      expect(first.ok).toBe(true);
      expect(conflict).toEqual({ error: { code: "idempotency_conflict" }, ok: false });
      expect(await app.getPolicy({ authorization: ownerA, input: { policyId: policyB } })).toEqual({
        error: { code: "resource_not_found" },
        ok: false,
      });
    });

    it("keeps 51 tables, FORCE RLS, and the exact S7.4 integrity triggers", async () => {
      const pool = harness.privilegedPool();
      const tables = await pool.query<{ table_name: string }>(
        `select table_name from information_schema.tables
          where table_schema = 'public' and table_type = 'BASE TABLE'`,
      );
      expect(tables.rows).toHaveLength(51);
      const security = await pool.query<{
        relname: string;
        relforcerowsecurity: boolean;
        relrowsecurity: boolean;
      }>(
        `select c.relname,c.relrowsecurity,c.relforcerowsecurity
           from pg_catalog.pg_class c
          where c.oid = any($1::regclass[])
          order by c.relname`,
        [["public.business_policies", "public.faqs"]],
      );
      expect(security.rows).toEqual(
        ["business_policies", "faqs"].map((relname) => ({
          relforcerowsecurity: true,
          relname,
          relrowsecurity: true,
        })),
      );
      const triggers = await pool.query<{ tgname: string }>(
        `select tgname from pg_catalog.pg_trigger
          where not tgisinternal and tgname = any($1::text[]) order by tgname`,
        [["business_policies_history_guard", "faqs_history_guard"]],
      );
      expect(triggers.rows.map((row) => row.tgname)).toEqual([
        "business_policies_history_guard",
        "faqs_history_guard",
      ]);
    });
  });
};
