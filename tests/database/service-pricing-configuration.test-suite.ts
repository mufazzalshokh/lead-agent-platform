import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

import {
  createPriceConfigurationUseCases,
  createServiceConfigurationUseCases,
  createServicePricingCursorCodec,
  type PriceConfigurationUseCases,
  type ServiceConfigurationUseCases,
} from "../../packages/application/src/index.js";
import {
  ConfigurationIdempotencyKeySchema,
  LocationIdSchema,
  MembershipIdSchema,
  OrganizationIdSchema,
  ResourceIdSchema,
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
  createServicePricingConfigurationStore,
  type ServiceConfigurationReplayProtector,
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

const ORGANIZATION_A_VALUE = "0193f1a8-7f65-7c28-a434-a10796c47401";
const ORGANIZATION_B_VALUE = "0193f1a8-7f65-7c28-a434-a10796c47402";
const OWNER_A_VALUE = "0193f1a8-7f65-7c28-a434-a10796c47403";
const OWNER_B_VALUE = "0193f1a8-7f65-7c28-a434-a10796c47404";
const STAFF_VALUE = "0193f1a8-7f65-7c28-a434-a10796c47405";
const OWNER_A_MEMBERSHIP_VALUE = "0193f1a8-7f65-7c28-a434-a10796c47406";
const OWNER_B_MEMBERSHIP_VALUE = "0193f1a8-7f65-7c28-a434-a10796c47407";
const STAFF_MEMBERSHIP_VALUE = "0193f1a8-7f65-7c28-a434-a10796c47408";
const LOCATION_A_VALUE = "0193f1a8-7f65-7c28-a434-a10796c47409";
const LOCATION_B_VALUE = "0193f1a8-7f65-7c28-a434-a10796c4740a";
const LOCATION_A_VERSION_VALUE = "0193f1a8-7f65-7c28-a434-a10796c4740b";
const LOCATION_B_VERSION_VALUE = "0193f1a8-7f65-7c28-a434-a10796c4740c";

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
  !isSchemaValue(ResourceIdSchema, LOCATION_B_VERSION_VALUE)
) {
  throw new TypeError("Invalid S7.3 database fixture identifiers");
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
const CLOCK = new Date("2026-09-14T09:00:00.000Z");
const CURSOR_KEY = Buffer.alloc(32, 0x73);
const REPLAY_KEY = Buffer.alloc(32, 0x37);

type Harness = Readonly<{
  privilegedPool: () => Pool;
  runtime: () => TenantDatabaseRuntime;
}>;

const requireIdempotencyKey = (value: string): ConfigurationIdempotencyKey => {
  if (!isSchemaValue(ConfigurationIdempotencyKeySchema, value)) {
    throw new TypeError("Invalid S7.3 idempotency fixture");
  }
  return value;
};

const idempotencyKey = (suffix: string): ConfigurationIdempotencyKey =>
  requireIdempotencyKey(`s73-${suffix}-key`);

const replayProtector: ServiceConfigurationReplayProtector = Object.freeze({
  protect: (scope: string, plaintext: Uint8Array): Uint8Array => {
    const nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", REPLAY_KEY, nonce);
    cipher.setAAD(Buffer.from(scope, "utf8"));
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    return Buffer.concat([nonce, cipher.getAuthTag(), ciphertext]);
  },
  reveal: (scope: string, protectedValue: Uint8Array): Uint8Array => {
    if (protectedValue.byteLength < 28) throw new TypeError("Invalid protected replay fixture");
    const packed = Buffer.from(protectedValue);
    const decipher = createDecipheriv("aes-256-gcm", REPLAY_KEY, packed.subarray(0, 12));
    decipher.setAAD(Buffer.from(scope, "utf8"));
    decipher.setAuthTag(packed.subarray(12, 28));
    return Buffer.concat([decipher.update(packed.subarray(28)), decipher.final()]);
  },
});

const insertOrganization = (pool: Pool, id: OrganizationId, slug: string): Promise<unknown> =>
  pool.query(
    `insert into organizations
      (id,slug,display_name,status,default_locale,default_time_zone)
     values ($1,$2,'S7.3 Synthetic Clinic','active','en','Asia/Tashkent')`,
    [id, slug],
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
    absoluteExpiresAt: new Date("2026-09-15T09:00:00.000Z"),
    authenticationLevel: "mfa",
    authenticationTime: CLOCK,
    createdAt: CLOCK,
    idleExpiresAt: new Date("2026-09-14T10:00:00.000Z"),
    lastSeenAt: CLOCK,
    rotatedAt: CLOCK,
    rotationDue: false,
    sessionId: "0193f1a8-7f65-7c28-a434-a10796c4740d",
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
): Promise<AuthorizationContext> => {
  await insertOrganization(pool, organizationId, slug);
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
      Buffer.from(`s73-${code}`),
      CLOCK,
      ownerId,
    ],
  );
  await pool.query(
    `update locations
        set status = 'active', current_version_id = $2, version = 2, updated_at = $3
      where id = $1`,
    [locationId, versionId, CLOCK],
  );
};

const applications = (
  runtime: TenantDatabaseRuntime,
  clock: () => Date = () => new Date(CLOCK),
): Readonly<{ prices: PriceConfigurationUseCases; services: ServiceConfigurationUseCases }> => {
  const store = createServicePricingConfigurationStore(runtime, replayProtector);
  const options = { clock, cursorCodec: createServicePricingCursorCodec(CURSOR_KEY) };
  return Object.freeze({
    prices: createPriceConfigurationUseCases(store, options),
    services: createServiceConfigurationUseCases(store, options),
  });
};

const createService = async (
  application: ServiceConfigurationUseCases,
  authorization: AuthorizationContext,
  code: string,
  key: ConfigurationIdempotencyKey,
): Promise<ServiceId> => {
  const result = await application.createService({
    authorization,
    idempotencyKey: key,
    input: { code },
  });
  if (!result.ok) throw new Error(`Service root creation failed: ${result.error.code}`);
  return result.value.resource.service_id;
};

const publishService = (
  application: ServiceConfigurationUseCases,
  authorization: AuthorizationContext,
  serviceId: ServiceId,
  expectedVersion: number,
  key: ConfigurationIdempotencyKey,
  name = "Implant consultation",
) =>
  application.publishService({
    authorization,
    expectedVersion,
    idempotencyKey: key,
    input: {
      description_i18n: { en: `${name} description` },
      disclaimer_i18n: { en: "Clinical assessment required" },
      duration_guidance_minutes: 45,
      name_i18n: { en: name },
    },
    target: serviceId,
  });

const createPublishedService = async (
  application: ServiceConfigurationUseCases,
  authorization: AuthorizationContext,
  code: string,
  suffix: string,
): Promise<ServiceId> => {
  const serviceId = await createService(
    application,
    authorization,
    code,
    idempotencyKey(`${suffix}-root`),
  );
  const published = await publishService(
    application,
    authorization,
    serviceId,
    1,
    idempotencyKey(`${suffix}-publish`),
  );
  if (!published.ok) throw new Error(`Service publication failed: ${published.error.code}`);
  return serviceId;
};

const asResourceId = (value: unknown): ResourceId => {
  if (!isSchemaValue(ResourceIdSchema, value)) throw new TypeError("Invalid persisted resource ID");
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

const createPriceDraft = async (
  application: PriceConfigurationUseCases,
  authorization: AuthorizationContext,
  serviceId: ServiceId,
  key: ConfigurationIdempotencyKey,
  input: Parameters<PriceConfigurationUseCases["createPriceDraft"]>[0]["input"] = {
    display_text_i18n: { en: "From 100 USD" },
    location_id: null,
    pricing: { minimum: { amount_minor: 10_000, currency: "USD" }, price_type: "from" },
  },
  expectedVersion = 2,
): Promise<ResourceId> => {
  const result = await application.createPriceDraft({
    authorization,
    expectedVersion,
    idempotencyKey: key,
    input,
    target: serviceId,
  });
  if (!result.ok) throw new Error(`Price draft creation failed: ${result.error.code}`);
  return result.value.resource.price_id;
};

export const registerServicePricingConfigurationTests = (harness: Harness): void => {
  describe("S7.3 Service and price configuration persistence", { timeout: 45_000 }, () => {
    it("creates inactive roots idempotently and protects normalized codes under concurrency", async () => {
      const pool = harness.privilegedPool();
      const ownerA = await seedOwner(
        pool,
        ORGANIZATION_A,
        OWNER_A,
        OWNER_A_MEMBERSHIP,
        "s73-root-a",
      );
      const ownerB = await seedOwner(
        pool,
        ORGANIZATION_B,
        OWNER_B,
        OWNER_B_MEMBERSHIP,
        "s73-root-b",
      );
      const application = applications(harness.runtime()).services;
      const first = await application.createService({
        authorization: ownerA,
        idempotencyKey: idempotencyKey("root-replay"),
        input: { code: "implant-consultation" },
      });
      const replay = await application.createService({
        authorization: ownerA,
        idempotencyKey: idempotencyKey("root-replay"),
        input: { code: "implant-consultation" },
      });
      expect(first).toEqual(replay);
      expect(first.ok && first.value.resource).toMatchObject({
        current_version: null,
        status: "inactive",
        version: 1,
      });
      const mismatch = await application.createService({
        authorization: ownerA,
        idempotencyKey: idempotencyKey("root-replay"),
        input: { code: "different-service" },
      });
      expect(mismatch).toEqual({ error: { code: "idempotency_conflict" }, ok: false });

      const raced = await Promise.all([
        application.createService({
          authorization: ownerA,
          idempotencyKey: idempotencyKey("root-race-a"),
          input: { code: "race-service" },
        }),
        application.createService({
          authorization: ownerA,
          idempotencyKey: idempotencyKey("root-race-b"),
          input: { code: "race-service" },
        }),
      ]);
      expect(raced.filter((result) => result.ok)).toHaveLength(1);
      expect(
        raced.filter((result) => !result.ok && result.error.code === "business_rule_failed"),
      ).toHaveLength(1);
      await expect(
        createService(application, ownerB, "implant-consultation", idempotencyKey("root-b")),
      ).resolves.toBeDefined();
    });

    it("publishes immutable Service facts with audit and one canonical outbox event", async () => {
      const pool = harness.privilegedPool();
      const owner = await seedOwner(
        pool,
        ORGANIZATION_A,
        OWNER_A,
        OWNER_A_MEMBERSHIP,
        "s73-publish",
      );
      const application = applications(harness.runtime()).services;
      const serviceId = await createService(
        application,
        owner,
        "implant-consultation",
        idempotencyKey("publish-root"),
      );
      const result = await publishService(
        application,
        owner,
        serviceId,
        1,
        idempotencyKey("publish-version"),
      );
      expect(result.ok).toBe(true);
      if (!result.ok || result.value.resource.current_version === null) {
        throw new Error("Expected published Service fixture");
      }
      expect(result.value.resource).toMatchObject({ status: "active", version: 2 });
      expect(result.value.resource.current_version).toMatchObject({
        duration_guidance_minutes: 45,
        name_i18n: { en: "Implant consultation" },
        provenance: { version_no: 1 },
      });
      expect(result.value.events).toHaveLength(1);
      expect(result.value.events[0]).toMatchObject({
        aggregate_id: serviceId,
        aggregate_type: "service",
        aggregate_version: 2,
        event_type: "service.published",
        payload: { service_version: 1 },
      });
      expect(
        await pool.query(
          "select event_type,aggregate_version::int as aggregate_version from outbox_events",
        ),
      ).toMatchObject({
        rows: [{ aggregate_version: 2, event_type: "service.published" }],
      });
      expect(
        await pool.query("select action,target_type from audit_events order by occurred_at"),
      ).toMatchObject({
        rows: [
          { action: "service.created", target_type: "service" },
          { action: "service.published", target_type: "service" },
        ],
      });
    });

    it("rejects stale concurrent Service publication before a second version is persisted", async () => {
      const pool = harness.privilegedPool();
      const owner = await seedOwner(
        pool,
        ORGANIZATION_A,
        OWNER_A,
        OWNER_A_MEMBERSHIP,
        "s73-publish-race",
      );
      const application = applications(harness.runtime()).services;
      const serviceId = await createService(
        application,
        owner,
        "race-publication",
        idempotencyKey("publish-race-root"),
      );
      const raced = await Promise.all([
        publishService(application, owner, serviceId, 1, idempotencyKey("publish-race-a"), "A"),
        publishService(application, owner, serviceId, 1, idempotencyKey("publish-race-b"), "B"),
      ]);
      expect(raced.filter((result) => result.ok)).toHaveLength(1);
      expect(
        raced.filter((result) => !result.ok && result.error.code === "version_conflict"),
      ).toHaveLength(1);
      expect(
        await pool.query(
          "select count(*)::int as count from service_versions where service_id = $1",
          [serviceId],
        ),
      ).toMatchObject({ rows: [{ count: 1 }] });
    });

    it("serializes offering activation and never represents appointment availability", async () => {
      const pool = harness.privilegedPool();
      const owner = await seedOwner(
        pool,
        ORGANIZATION_A,
        OWNER_A,
        OWNER_A_MEMBERSHIP,
        "s73-offering-race",
      );
      await seedLocation(pool, ORGANIZATION_A, OWNER_A, LOCATION_A, LOCATION_A_VERSION, "clinic-a");
      const application = applications(harness.runtime()).services;
      const serviceId = await createPublishedService(
        application,
        owner,
        "offering-service",
        "offering",
      );
      const raced = await Promise.all([
        application.changeServiceLocation({
          authorization: owner,
          expectedVersion: 2,
          idempotencyKey: idempotencyKey("offering-race-a"),
          input: { location_id: LOCATION_A, status: "active" },
          target: serviceId,
        }),
        application.changeServiceLocation({
          authorization: owner,
          expectedVersion: 2,
          idempotencyKey: idempotencyKey("offering-race-b"),
          input: { location_id: LOCATION_A, status: "active" },
          target: serviceId,
        }),
      ]);
      expect(raced.filter((result) => result.ok)).toHaveLength(1);
      expect(
        raced.filter((result) => !result.ok && result.error.code === "version_conflict"),
      ).toHaveLength(1);
      expect(
        await pool.query(
          `select status,count(*)::int as count
             from service_locations where service_id = $1 group by status`,
          [serviceId],
        ),
      ).toMatchObject({ rows: [{ count: 1, status: "active" }] });
    });

    it("persists all four exact money models and keeps missing price distinct from quote required", async () => {
      const pool = harness.privilegedPool();
      const owner = await seedOwner(
        pool,
        ORGANIZATION_A,
        OWNER_A,
        OWNER_A_MEMBERSHIP,
        "s73-price-shapes",
      );
      const app = applications(harness.runtime());
      const serviceId = await createPublishedService(
        app.services,
        owner,
        "price-shapes",
        "price-shapes",
      );
      const before = await app.prices.listPrices({
        authorization: owner,
        input: { filter: {}, pagination: {} },
      });
      expect(before).toEqual({ ok: true, value: { items: [], nextCursor: null } });
      const values = [
        {
          display_text_i18n: { en: "Free" },
          location_id: null,
          pricing: { amount: { amount_minor: 0, currency: "USD" }, price_type: "fixed" },
        },
        {
          display_text_i18n: { en: "From 100 USD" },
          location_id: null,
          pricing: { minimum: { amount_minor: 10_000, currency: "USD" }, price_type: "from" },
        },
        {
          display_text_i18n: { en: "100-200 USD" },
          location_id: null,
          pricing: {
            maximum: { amount_minor: 20_000, currency: "USD" },
            minimum: { amount_minor: 10_000, currency: "USD" },
            price_type: "range",
          },
        },
        {
          display_text_i18n: { en: "Request a quote" },
          location_id: null,
          pricing: { currency: "USD", price_type: "quote_required" },
        },
      ] as const;
      for (const [index, input] of values.entries()) {
        await createPriceDraft(
          app.prices,
          owner,
          serviceId,
          idempotencyKey(`price-shape-${index}`),
          input,
        );
      }
      const rows = await pool.query<{
        max_amount_minor: string | null;
        min_amount_minor: string | null;
        price_type: string;
        version_no: number;
      }>(
        `select price_type,min_amount_minor::text,max_amount_minor::text,version_no
           from service_prices order by version_no`,
      );
      expect(rows.rows).toEqual([
        { max_amount_minor: "0", min_amount_minor: "0", price_type: "fixed", version_no: 1 },
        { max_amount_minor: null, min_amount_minor: "10000", price_type: "from", version_no: 2 },
        {
          max_amount_minor: "20000",
          min_amount_minor: "10000",
          price_type: "range",
          version_no: 3,
        },
        {
          max_amount_minor: null,
          min_amount_minor: null,
          price_type: "quote_required",
          version_no: 4,
        },
      ]);
    });

    it("updates only drafts with CAS, then publishes exact accepted content atomically", async () => {
      const pool = harness.privilegedPool();
      const owner = await seedOwner(
        pool,
        ORGANIZATION_A,
        OWNER_A,
        OWNER_A_MEMBERSHIP,
        "s73-price-lifecycle",
      );
      const app = applications(harness.runtime());
      const serviceId = await createPublishedService(
        app.services,
        owner,
        "price-lifecycle",
        "price-lifecycle",
      );
      const priceId = await createPriceDraft(
        app.prices,
        owner,
        serviceId,
        idempotencyKey("price-lifecycle-draft"),
      );
      const stale = await app.prices.updatePriceDraft({
        authorization: owner,
        expectedVersion: 9,
        idempotencyKey: idempotencyKey("price-lifecycle-stale"),
        input: {
          display_text_i18n: { en: "200 USD" },
          location_id: null,
          pricing: { amount: { amount_minor: 20_000, currency: "USD" }, price_type: "fixed" },
        },
        target: priceId,
      });
      expect(stale).toEqual({ error: { code: "version_conflict" }, ok: false });
      const updated = await app.prices.updatePriceDraft({
        authorization: owner,
        expectedVersion: 1,
        idempotencyKey: idempotencyKey("price-lifecycle-update"),
        input: {
          display_text_i18n: { en: "200 USD" },
          location_id: null,
          pricing: { amount: { amount_minor: 20_000, currency: "USD" }, price_type: "fixed" },
        },
        target: priceId,
      });
      expect(updated.ok && updated.value.resource).toMatchObject({
        pricing: { amount: { amount_minor: 20_000, currency: "USD" }, price_type: "fixed" },
        status: "draft",
        version_no: 2,
      });
      const published = await app.prices.publishPrice({
        authorization: owner,
        expectedVersion: 2,
        idempotencyKey: idempotencyKey("price-lifecycle-publish"),
        input: {},
        target: priceId,
      });
      expect(published.ok && published.value.resource).toMatchObject({
        effective_from: CLOCK.toISOString(),
        status: "published",
        version_no: 2,
      });
      expect(published.ok && published.value.events[0]).toMatchObject({
        aggregate_id: serviceId,
        aggregate_version: 3,
        event_type: "service_price.published",
        payload: { price_type: "fixed", service_price_id: priceId },
      });
      const forbidden = await app.prices.updatePriceDraft({
        authorization: owner,
        expectedVersion: 2,
        idempotencyKey: idempotencyKey("price-lifecycle-forbidden"),
        input: {
          display_text_i18n: { en: "Changed" },
          location_id: null,
          pricing: { currency: "USD", price_type: "quote_required" },
        },
        target: priceId,
      });
      expect(forbidden).toEqual({ error: { code: "business_rule_failed" }, ok: false });
      expect(
        await pool.query("select event_type from outbox_events order by aggregate_version"),
      ).toMatchObject({
        rows: [{ event_type: "service.published" }, { event_type: "service_price.published" }],
      });
    });

    it("rejects same-instant concurrent publications for one scope without overlap", async () => {
      const pool = harness.privilegedPool();
      const owner = await seedOwner(
        pool,
        ORGANIZATION_A,
        OWNER_A,
        OWNER_A_MEMBERSHIP,
        "s73-price-race",
      );
      const app = applications(harness.runtime());
      const serviceId = await createPublishedService(
        app.services,
        owner,
        "price-race",
        "price-race",
      );
      const priceA = await createPriceDraft(
        app.prices,
        owner,
        serviceId,
        idempotencyKey("price-race-draft-a"),
      );
      const priceB = await createPriceDraft(
        app.prices,
        owner,
        serviceId,
        idempotencyKey("price-race-draft-b"),
      );
      const raced = await Promise.all([
        app.prices.publishPrice({
          authorization: owner,
          expectedVersion: 1,
          idempotencyKey: idempotencyKey("price-race-publish-a"),
          input: {},
          target: priceA,
        }),
        app.prices.publishPrice({
          authorization: owner,
          expectedVersion: 2,
          idempotencyKey: idempotencyKey("price-race-publish-b"),
          input: {},
          target: priceB,
        }),
      ]);
      expect(raced.filter((result) => result.ok)).toHaveLength(1);
      expect(raced.filter((result) => !result.ok)).toHaveLength(1);
      expect(
        await pool.query(
          `select status,count(*)::int as count
             from service_prices group by status order by status`,
        ),
      ).toMatchObject({
        rows: [
          { count: 1, status: "draft" },
          { count: 1, status: "published" },
        ],
      });
    });

    it("retires published prices without inventing a domain event", async () => {
      const pool = harness.privilegedPool();
      const owner = await seedOwner(
        pool,
        ORGANIZATION_A,
        OWNER_A,
        OWNER_A_MEMBERSHIP,
        "s73-price-retire",
      );
      let current = new Date(CLOCK);
      const app = applications(harness.runtime(), () => new Date(current));
      const serviceId = await createPublishedService(
        app.services,
        owner,
        "price-retire",
        "price-retire",
      );
      const priceId = await createPriceDraft(
        app.prices,
        owner,
        serviceId,
        idempotencyKey("price-retire-draft"),
      );
      await app.prices.publishPrice({
        authorization: owner,
        expectedVersion: 1,
        idempotencyKey: idempotencyKey("price-retire-publish"),
        input: {},
        target: priceId,
      });
      current = new Date(CLOCK.getTime() + 60_000);
      const retired = await app.prices.retirePrice({
        authorization: owner,
        expectedVersion: 1,
        idempotencyKey: idempotencyKey("price-retire-retire"),
        input: {},
        target: priceId,
      });
      expect(retired.ok && retired.value.resource).toMatchObject({
        effective_to: current.toISOString(),
        status: "retired",
      });
      expect(retired.ok && retired.value.events).toEqual([]);
      expect(
        await pool.query("select event_type from outbox_events order by aggregate_version"),
      ).toMatchObject({
        rows: [{ event_type: "service.published" }, { event_type: "service_price.published" }],
      });
    });

    it("maps hostile cross-tenant Service and price identifiers to tenant-local not found", async () => {
      const pool = harness.privilegedPool();
      const ownerA = await seedOwner(
        pool,
        ORGANIZATION_A,
        OWNER_A,
        OWNER_A_MEMBERSHIP,
        "s73-hostile-a",
      );
      const ownerB = await seedOwner(
        pool,
        ORGANIZATION_B,
        OWNER_B,
        OWNER_B_MEMBERSHIP,
        "s73-hostile-b",
      );
      const app = applications(harness.runtime());
      const serviceB = await createPublishedService(
        app.services,
        ownerB,
        "tenant-b-service",
        "hostile-b",
      );
      const priceB = await createPriceDraft(
        app.prices,
        ownerB,
        serviceB,
        idempotencyKey("hostile-price-b"),
      );
      const results = await Promise.all([
        app.services.getService({ authorization: ownerA, input: { serviceId: serviceB } }),
        publishService(app.services, ownerA, serviceB, 2, idempotencyKey("hostile-publish")),
        app.prices.getPrice({ authorization: ownerA, input: { priceId: priceB } }),
        app.prices.publishPrice({
          authorization: ownerA,
          expectedVersion: 1,
          idempotencyKey: idempotencyKey("hostile-price-publish"),
          input: {},
          target: priceB,
        }),
      ]);
      expect(results).toEqual(
        results.map(() => ({ error: { code: "resource_not_found" }, ok: false })),
      );
    });

    it("applies restricted Location scope in SQL to Service and price projections", async () => {
      const pool = harness.privilegedPool();
      const owner = await seedOwner(pool, ORGANIZATION_A, OWNER_A, OWNER_A_MEMBERSHIP, "s73-scope");
      await seedLocation(pool, ORGANIZATION_A, OWNER_A, LOCATION_A, LOCATION_A_VERSION, "scope-a");
      await seedLocation(pool, ORGANIZATION_A, OWNER_A, LOCATION_B, LOCATION_B_VERSION, "scope-b");
      const app = applications(harness.runtime());
      const serviceA = await createPublishedService(
        app.services,
        owner,
        "scope-service-a",
        "scope-a",
      );
      const serviceB = await createPublishedService(
        app.services,
        owner,
        "scope-service-b",
        "scope-b",
      );
      await app.services.changeServiceLocation({
        authorization: owner,
        expectedVersion: 2,
        idempotencyKey: idempotencyKey("scope-relation-a"),
        input: { location_id: LOCATION_A, status: "active" },
        target: serviceA,
      });
      await app.services.changeServiceLocation({
        authorization: owner,
        expectedVersion: 2,
        idempotencyKey: idempotencyKey("scope-relation-b"),
        input: { location_id: LOCATION_B, status: "active" },
        target: serviceB,
      });
      const priceA = await createPriceDraft(
        app.prices,
        owner,
        serviceA,
        idempotencyKey("scope-price-a"),
        undefined,
        3,
      );
      const priceB = await createPriceDraft(
        app.prices,
        owner,
        serviceB,
        idempotencyKey("scope-price-b"),
        undefined,
        3,
      );
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
      const serviceList = await app.services.listServices({
        authorization: restricted,
        input: { filter: {}, pagination: { limit: 100 } },
      });
      const priceList = await app.prices.listPrices({
        authorization: restricted,
        input: { filter: {}, pagination: { limit: 100 } },
      });
      expect(serviceList.ok && serviceList.value.items.map((item) => item.service_id)).toEqual([
        serviceA,
      ]);
      expect(priceList.ok && priceList.value.items.map((item) => item.price_id)).toEqual([priceA]);
      expect(
        await app.services.getService({
          authorization: restricted,
          input: { serviceId: serviceB },
        }),
      ).toEqual({ error: { code: "resource_not_found" }, ok: false });
      expect(
        await app.prices.getPrice({ authorization: restricted, input: { priceId: priceB } }),
      ).toEqual({ error: { code: "resource_not_found" }, ok: false });
    });

    it.each([
      ["version insert", "service_versions", "insert"],
      ["root update", "services", "update"],
      ["audit insert", "audit_events", "insert"],
      ["outbox insert", "outbox_events", "insert"],
      ["idempotency finalization", "idempotency_keys", "update"],
    ] as const)(
      "rolls back Service publication when %s fails",
      async (_label, table, operation) => {
        const pool = harness.privilegedPool();
        const owner = await seedOwner(
          pool,
          ORGANIZATION_A,
          OWNER_A,
          OWNER_A_MEMBERSHIP,
          `s73-failure-${table.replaceAll("_", "-")}`,
        );
        const application = applications(harness.runtime()).services;
        const serviceId = await createService(
          application,
          owner,
          "failure-service",
          idempotencyKey(`failure-root-${table.slice(0, 12)}`),
        );
        await pool.query(`create or replace function app.s73_injected_failure()
        returns trigger language plpgsql as $body$
        begin raise exception using errcode = '40001', message = 'synthetic S7.3 failure'; end
        $body$`);
        await pool.query(
          `create trigger s73_injected_failure before ${operation} on ${table}
         for each row execute function app.s73_injected_failure()`,
        );
        try {
          expect(
            await publishService(
              application,
              owner,
              serviceId,
              1,
              idempotencyKey(`failure-publish-${table.slice(0, 12)}`),
            ),
          ).toEqual({ error: { code: "version_conflict" }, ok: false });
        } finally {
          await pool.query(`drop trigger if exists s73_injected_failure on ${table}`);
          await pool.query("drop function if exists app.s73_injected_failure()");
        }
        expect(
          await pool.query(
            "select status,version::int as version,current_version_id from services where id = $1",
            [serviceId],
          ),
        ).toMatchObject({ rows: [{ current_version_id: null, status: "inactive", version: 1 }] });
        expect(
          await pool.query(
            "select count(*)::int as count from service_versions where service_id = $1",
            [serviceId],
          ),
        ).toMatchObject({ rows: [{ count: 0 }] });
      },
    );

    it("keeps tenant-wide prices and exact Location overrides as distinct scopes", async () => {
      const pool = harness.privilegedPool();
      const owner = await seedOwner(
        pool,
        ORGANIZATION_A,
        OWNER_A,
        OWNER_A_MEMBERSHIP,
        "s73-overrides",
      );
      await seedLocation(
        pool,
        ORGANIZATION_A,
        OWNER_A,
        LOCATION_A,
        LOCATION_A_VERSION,
        "override-a",
      );
      const app = applications(harness.runtime());
      const serviceId = await createPublishedService(
        app.services,
        owner,
        "override-service",
        "override",
      );
      await app.services.changeServiceLocation({
        authorization: owner,
        expectedVersion: 2,
        idempotencyKey: idempotencyKey("override-relation"),
        input: { location_id: LOCATION_A, status: "active" },
        target: serviceId,
      });
      const tenantWide = await createPriceDraft(
        app.prices,
        owner,
        serviceId,
        idempotencyKey("override-tenant-draft"),
        undefined,
        3,
      );
      const exactLocation = await createPriceDraft(
        app.prices,
        owner,
        serviceId,
        idempotencyKey("override-location-draft"),
        {
          display_text_i18n: { en: "Location price" },
          location_id: LOCATION_A,
          pricing: { minimum: { amount_minor: 12_000, currency: "USD" }, price_type: "from" },
        },
        3,
      );
      await app.prices.publishPrice({
        authorization: owner,
        expectedVersion: 1,
        idempotencyKey: idempotencyKey("override-tenant-publish"),
        input: {},
        target: tenantWide,
      });
      await app.prices.publishPrice({
        authorization: owner,
        expectedVersion: 1,
        idempotencyKey: idempotencyKey("override-location-publish"),
        input: {},
        target: exactLocation,
      });
      const listed = await app.prices.listPrices({
        authorization: owner,
        input: { filter: { location_id: LOCATION_A, status: "published" }, pagination: {} },
      });
      expect(
        listed.ok &&
          listed.value.items
            .map((item) => item.location_id)
            .sort((left, right) => (left ?? "").localeCompare(right ?? "")),
      ).toEqual([null, LOCATION_A]);
    });

    it("blocks runtime mutation or deletion of published Service, offering, and price history", async () => {
      const pool = harness.privilegedPool();
      const owner = await seedOwner(
        pool,
        ORGANIZATION_A,
        OWNER_A,
        OWNER_A_MEMBERSHIP,
        "s73-history",
      );
      await seedLocation(
        pool,
        ORGANIZATION_A,
        OWNER_A,
        LOCATION_A,
        LOCATION_A_VERSION,
        "history-a",
      );
      const app = applications(harness.runtime());
      const serviceId = await createPublishedService(
        app.services,
        owner,
        "history-service",
        "history",
      );
      const relation = await app.services.changeServiceLocation({
        authorization: owner,
        expectedVersion: 2,
        idempotencyKey: idempotencyKey("history-relation"),
        input: { location_id: LOCATION_A, status: "active" },
        target: serviceId,
      });
      if (!relation.ok) throw new Error("Expected offering fixture");
      const priceId = await createPriceDraft(
        app.prices,
        owner,
        serviceId,
        idempotencyKey("history-price"),
        undefined,
        3,
      );
      const published = await app.prices.publishPrice({
        authorization: owner,
        expectedVersion: 1,
        idempotencyKey: idempotencyKey("history-price-publish"),
        input: {},
        target: priceId,
      });
      if (!published.ok) throw new Error("Expected published price fixture");
      const version = await pool.query<{ id: unknown }>(
        "select id from service_versions where service_id = $1",
        [serviceId],
      );
      const versionId = asResourceId(version.rows[0]?.id);
      await expect(
        withRuntimeRole(pool, ORGANIZATION_A, async (client) => {
          await client.query(
            `update service_versions set name_i18n = '{"en":"Changed"}'::jsonb
              where organization_id = $1 and id = $2`,
            [ORGANIZATION_A, versionId],
          );
        }),
      ).rejects.toMatchObject({ code: "23514" });
      await expect(
        withRuntimeRole(pool, ORGANIZATION_A, async (client) => {
          await client.query(
            `delete from service_locations
              where organization_id = $1 and service_id = $2 and location_id = $3`,
            [ORGANIZATION_A, serviceId, LOCATION_A],
          );
        }),
      ).rejects.toMatchObject({ code: "23514" });
      await expect(
        withRuntimeRole(pool, ORGANIZATION_A, async (client) => {
          await client.query(
            `update service_prices set display_text_i18n = '{"en":"Changed"}'::jsonb
              where organization_id = $1 and id = $2`,
            [ORGANIZATION_A, priceId],
          );
        }),
      ).rejects.toMatchObject({ code: "23514" });
    });

    it("keeps the 51-table manifest and FORCE RLS protections unchanged", async () => {
      const pool = harness.privilegedPool();
      const tables = await pool.query<{ table_name: string }>(
        `select table_name from information_schema.tables
          where table_schema = 'public' and table_type = 'BASE TABLE'`,
      );
      expect(tables.rows).toHaveLength(51);
      const security = await pool.query<{
        rel: string;
        relforcerowsecurity: boolean;
        relrowsecurity: boolean;
      }>(
        `select c.relname,c.relrowsecurity,c.relforcerowsecurity
           from pg_catalog.pg_class c
          where c.oid = any($1::regclass[])
          order by c.relname`,
        [
          [
            "public.service_locations",
            "public.service_prices",
            "public.service_versions",
            "public.services",
          ],
        ],
      );
      expect(security.rows).toEqual(
        ["service_locations", "service_prices", "service_versions", "services"].map((relname) => ({
          relforcerowsecurity: true,
          relname,
          relrowsecurity: true,
        })),
      );
      const triggers = await pool.query<{ tgname: string }>(
        `select tgname from pg_catalog.pg_trigger
          where not tgisinternal and tgname = any($1::text[]) order by tgname`,
        [
          [
            "service_locations_history_guard",
            "service_prices_history_guard",
            "service_versions_immutable_history",
          ],
        ],
      );
      expect(triggers.rows.map((row) => row.tgname)).toEqual([
        "service_locations_history_guard",
        "service_prices_history_guard",
        "service_versions_immutable_history",
      ]);
    });
  });
};
