import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

import {
  createLocationConfigurationUseCases,
  createLocationCursorCodec,
  type LocationConfigurationUseCases,
} from "../../packages/application/src/index.js";
import {
  ConfigurationIdempotencyKeySchema,
  MembershipIdSchema,
  OrganizationIdSchema,
  PublishLocationInputSchema,
  ResourceIdSchema,
  UserIdSchema,
  isSchemaValue,
  type ConfigurationIdempotencyKey,
  type LocationId,
  type MembershipId,
  type OrganizationId,
  type PublishLocationInput,
  type ResourceId,
  type UserId,
} from "../../packages/contracts/src/index.js";
import {
  createLocationConfigurationStore,
  type LocationConfigurationReplayProtector,
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

const ORGANIZATION_A_VALUE = "0193f1a8-7f65-7c28-a434-a10796c47301";
const ORGANIZATION_B_VALUE = "0193f1a8-7f65-7c28-a434-a10796c47302";
const OWNER_A_VALUE = "0193f1a8-7f65-7c28-a434-a10796c47303";
const OWNER_B_VALUE = "0193f1a8-7f65-7c28-a434-a10796c47304";
const STAFF_VALUE = "0193f1a8-7f65-7c28-a434-a10796c47305";
const ANALYST_VALUE = "0193f1a8-7f65-7c28-a434-a10796c47306";
const OWNER_A_MEMBERSHIP_VALUE = "0193f1a8-7f65-7c28-a434-a10796c47307";
const OWNER_B_MEMBERSHIP_VALUE = "0193f1a8-7f65-7c28-a434-a10796c47308";
const STAFF_MEMBERSHIP_VALUE = "0193f1a8-7f65-7c28-a434-a10796c47309";
const ANALYST_MEMBERSHIP_VALUE = "0193f1a8-7f65-7c28-a434-a10796c4730a";

if (
  !isSchemaValue(OrganizationIdSchema, ORGANIZATION_A_VALUE) ||
  !isSchemaValue(OrganizationIdSchema, ORGANIZATION_B_VALUE) ||
  !isSchemaValue(UserIdSchema, OWNER_A_VALUE) ||
  !isSchemaValue(UserIdSchema, OWNER_B_VALUE) ||
  !isSchemaValue(UserIdSchema, STAFF_VALUE) ||
  !isSchemaValue(UserIdSchema, ANALYST_VALUE) ||
  !isSchemaValue(MembershipIdSchema, OWNER_A_MEMBERSHIP_VALUE) ||
  !isSchemaValue(MembershipIdSchema, OWNER_B_MEMBERSHIP_VALUE) ||
  !isSchemaValue(MembershipIdSchema, STAFF_MEMBERSHIP_VALUE) ||
  !isSchemaValue(MembershipIdSchema, ANALYST_MEMBERSHIP_VALUE)
) {
  throw new TypeError("Invalid S7.2 database fixture identifiers");
}

const ORGANIZATION_A: OrganizationId = ORGANIZATION_A_VALUE;
const ORGANIZATION_B: OrganizationId = ORGANIZATION_B_VALUE;
const OWNER_A: UserId = OWNER_A_VALUE;
const OWNER_B: UserId = OWNER_B_VALUE;
const STAFF: UserId = STAFF_VALUE;
const ANALYST: UserId = ANALYST_VALUE;
const OWNER_A_MEMBERSHIP: MembershipId = OWNER_A_MEMBERSHIP_VALUE;
const OWNER_B_MEMBERSHIP: MembershipId = OWNER_B_MEMBERSHIP_VALUE;
const STAFF_MEMBERSHIP: MembershipId = STAFF_MEMBERSHIP_VALUE;
const ANALYST_MEMBERSHIP: MembershipId = ANALYST_MEMBERSHIP_VALUE;
const CLOCK = new Date("2026-09-12T09:00:00.000Z");
const CURSOR_KEY = Buffer.alloc(32, 0x72);
const REPLAY_KEY = Buffer.alloc(32, 0x27);

type LocationConfigurationHarness = Readonly<{
  privilegedPool: () => Pool;
  runtime: () => TenantDatabaseRuntime;
}>;

const requireIdempotencyKey = (value: string): ConfigurationIdempotencyKey => {
  if (!isSchemaValue(ConfigurationIdempotencyKeySchema, value)) {
    throw new TypeError("Invalid S7.2 idempotency key fixture");
  }
  return value;
};

const idempotencyKey = (suffix: string): ConfigurationIdempotencyKey =>
  requireIdempotencyKey(`s72-${suffix}-key`);

const publication = (name = "Central Clinic", timeZone = "Asia/Tashkent"): PublishLocationInput => {
  const value: unknown = {
    address_i18n: { en: "1 Clinic Street", ru: "Klinika 1" },
    business_hours: {
      intervals: [
        {
          closes_at_local: "12:00:00",
          day_of_week: 1,
          opens_at_local: "09:00:00",
          sequence_no: 1,
        },
        {
          closes_at_local: "18:00:00",
          day_of_week: 1,
          opens_at_local: "13:00:00",
          sequence_no: 2,
        },
        {
          closes_at_local: "17:00:00",
          day_of_week: 3,
          opens_at_local: "10:00:00",
          sequence_no: 1,
        },
      ],
    },
    name_i18n: { en: name, ru: name },
    public_contact: { email: "public@example.test", phone: "+998901234567" },
    time_zone: timeZone,
  };
  if (!isSchemaValue(PublishLocationInputSchema, value)) {
    throw new TypeError("Invalid S7.2 publication fixture");
  }
  return value;
};

const replayProtector: LocationConfigurationReplayProtector = Object.freeze({
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

const insertOrganization = (
  pool: Pool,
  id: OrganizationId,
  slug: string,
  defaultLocale = "en",
): Promise<unknown> =>
  pool.query(
    `insert into organizations
      (id, slug, display_name, status, default_locale, default_time_zone)
     values ($1, $2, 'S7.2 Synthetic Clinic', 'active', $3, 'Asia/Tashkent')`,
    [id, slug, defaultLocale],
  );

const insertUser = (pool: Pool, id: UserId): Promise<unknown> =>
  pool.query("insert into users (id, status) values ($1, 'active')", [id]);

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
      (id, organization_id, user_id, role, status, location_scope, activated_at)
     values ($1, $2, $3, $4, 'active', $5, $6)`,
    [id, organizationId, userId, role, locationScope, CLOCK],
  );

const sessionFor = (userId: UserId): AuthenticatedApplicationSession =>
  Object.freeze({
    absoluteExpiresAt: new Date("2026-09-13T09:00:00.000Z"),
    authenticationLevel: "mfa",
    authenticationTime: CLOCK,
    createdAt: CLOCK,
    idleExpiresAt: new Date("2026-09-12T10:00:00.000Z"),
    lastSeenAt: CLOCK,
    rotatedAt: CLOCK,
    rotationDue: false,
    sessionId: "0193f1a8-7f65-7c28-a434-a10796c4730b",
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
  return resolveAuthorizationContext(sessionFor(userId), organizationId, {
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

const useCases = (runtime: TenantDatabaseRuntime): LocationConfigurationUseCases =>
  createLocationConfigurationUseCases(createLocationConfigurationStore(runtime, replayProtector), {
    clock: () => new Date(CLOCK),
    cursorCodec: createLocationCursorCodec(CURSOR_KEY),
  });

const createRoot = async (
  application: LocationConfigurationUseCases,
  authorization: AuthorizationContext,
  code: string,
  key: ConfigurationIdempotencyKey,
): Promise<LocationId> => {
  const result = await application.createLocation({
    authorization,
    idempotencyKey: key,
    input: { code },
  });
  if (!result.ok) throw new Error(`Location root creation failed: ${result.error.code}`);
  return result.value.resource.location_id;
};

const publishRoot = async (
  application: LocationConfigurationUseCases,
  authorization: AuthorizationContext,
  locationId: LocationId,
  expectedVersion: number,
  key: ConfigurationIdempotencyKey,
  value = publication(),
) =>
  application.publishLocation({
    authorization,
    expectedVersion,
    idempotencyKey: key,
    input: value,
    target: locationId,
  });

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
    await client.query("select set_config('app.organization_id', $1::uuid::text, true)", [
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

export const registerLocationConfigurationTests = (harness: LocationConfigurationHarness): void => {
  describe("S7.2 Location configuration persistence", { timeout: 45_000 }, () => {
    it("creates an inactive root idempotently and enforces tenant-scoped code races", async () => {
      const pool = harness.privilegedPool();
      const ownerA = await seedOwner(
        pool,
        ORGANIZATION_A,
        OWNER_A,
        OWNER_A_MEMBERSHIP,
        "s72-root-a",
      );
      const ownerB = await seedOwner(
        pool,
        ORGANIZATION_B,
        OWNER_B,
        OWNER_B_MEMBERSHIP,
        "s72-root-b",
      );
      const application = useCases(harness.runtime());
      const first = await application.createLocation({
        authorization: ownerA,
        idempotencyKey: idempotencyKey("root-replay"),
        input: { code: "central-clinic" },
      });
      const replay = await application.createLocation({
        authorization: ownerA,
        idempotencyKey: idempotencyKey("root-replay"),
        input: { code: "central-clinic" },
      });
      expect(first).toEqual(replay);
      expect(first.ok && first.value.resource).toMatchObject({
        current_version: null,
        status: "inactive",
        version: 1,
      });
      const mismatch = await application.createLocation({
        authorization: ownerA,
        idempotencyKey: idempotencyKey("root-replay"),
        input: { code: "different-clinic" },
      });
      expect(mismatch).toEqual({ error: { code: "idempotency_conflict" }, ok: false });

      const raced = await Promise.all([
        application.createLocation({
          authorization: ownerA,
          idempotencyKey: idempotencyKey("root-race-a"),
          input: { code: "race-clinic" },
        }),
        application.createLocation({
          authorization: ownerA,
          idempotencyKey: idempotencyKey("root-race-b"),
          input: { code: "race-clinic" },
        }),
      ]);
      expect(raced.filter((result) => result.ok)).toHaveLength(1);
      expect(
        raced.filter((result) => !result.ok && result.error.code === "business_rule_failed"),
      ).toHaveLength(1);
      await expect(
        createRoot(application, ownerB, "central-clinic", idempotencyKey("root-tenant-b")),
      ).resolves.toBeDefined();
      expect(
        await pool.query("select organization_id, code, status, current_version_id from locations"),
      ).toMatchObject({ rowCount: 3 });
    });

    it("publishes version, hours, audit, idempotency, and canonical event atomically", async () => {
      const pool = harness.privilegedPool();
      const owner = await seedOwner(
        pool,
        ORGANIZATION_A,
        OWNER_A,
        OWNER_A_MEMBERSHIP,
        "s72-publish",
      );
      const application = useCases(harness.runtime());
      const locationId = await createRoot(
        application,
        owner,
        "publication-clinic",
        idempotencyKey("publication-root"),
      );
      const result = await publishRoot(
        application,
        owner,
        locationId,
        1,
        idempotencyKey("publication"),
      );
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("Expected Location publication to succeed");
      expect(result.value.resource).toMatchObject({ status: "active", version: 2 });
      expect(result.value.resource.current_version?.business_hours.intervals).toEqual(
        publication().business_hours.intervals,
      );
      expect(result.value.events).toHaveLength(1);
      expect(result.value.events[0]).toMatchObject({
        aggregate_id: locationId,
        aggregate_version: 2,
        event_type: "location.changed",
        organization_id: ORGANIZATION_A,
      });
      expect(
        await pool.query(
          `select l.status, l.version::int as version, count(distinct lv.id)::int as versions,
                  count(lbh.id)::int as hours
             from locations l
             join location_versions lv on lv.id = l.current_version_id
             join location_business_hours lbh on lbh.location_version_id = lv.id
            where l.id = $1
            group by l.status, l.version`,
          [locationId],
        ),
      ).toMatchObject({ rows: [{ hours: 3, status: "active", version: 2, versions: 1 }] });
      expect(
        await pool.query(
          "select event_type from audit_events where organization_id = $1 order by event_type",
          [ORGANIZATION_A],
        ),
      ).toMatchObject({
        rows: [{ event_type: "location.created" }, { event_type: "location.published" }],
      });
      const outbox = await pool.query<{ payload_jsonb: unknown }>(
        "select payload_jsonb from outbox_events where organization_id = $1",
        [ORGANIZATION_A],
      );
      expect(outbox.rows).toHaveLength(1);
      expect(outbox.rows[0]?.payload_jsonb).toMatchObject({ event_type: "location.changed" });
      expect(
        await pool.query(
          "select status, response_ciphertext is not null as protected from idempotency_keys where organization_id = $1",
          [ORGANIZATION_A],
        ),
      ).toMatchObject({
        rows: [
          { protected: true, status: "succeeded" },
          { protected: true, status: "succeeded" },
        ],
      });
    });

    it("republishes without changing prior version or local wall-clock hours", async () => {
      const pool = harness.privilegedPool();
      const owner = await seedOwner(
        pool,
        ORGANIZATION_A,
        OWNER_A,
        OWNER_A_MEMBERSHIP,
        "s72-republish",
      );
      const application = useCases(harness.runtime());
      const locationId = await createRoot(
        application,
        owner,
        "republish-clinic",
        idempotencyKey("republish-root"),
      );
      await publishRoot(application, owner, locationId, 1, idempotencyKey("republish-v1"));
      const before = await pool.query(
        `select lv.id, lv.name_i18n, lbh.opens_at_local::text, lbh.closes_at_local::text
           from location_versions lv
           join location_business_hours lbh on lbh.location_version_id = lv.id
          where lv.location_id = $1 order by lv.version_no, lbh.day_of_week, lbh.sequence_no`,
        [locationId],
      );
      const second = await publishRoot(
        application,
        owner,
        locationId,
        2,
        idempotencyKey("republish-v2"),
        publication("Central Clinic Updated", "America/New_York"),
      );
      expect(second.ok).toBe(true);
      if (!second.ok) throw new Error("Expected republish to succeed");
      expect(second.value.resource.current_version).toMatchObject({
        name_i18n: { en: "Central Clinic Updated" },
        time_zone: "America/New_York",
      });
      expect(
        await pool.query(
          "select count(*)::int as count from location_versions where location_id = $1",
          [locationId],
        ),
      ).toMatchObject({ rows: [{ count: 2 }] });
      const firstVersionAfter = await pool.query(
        `select lv.id, lv.name_i18n, lbh.opens_at_local::text, lbh.closes_at_local::text
           from location_versions lv
           join location_business_hours lbh on lbh.location_version_id = lv.id
          where lv.location_id = $1 and lv.version_no = 1
          order by lbh.day_of_week, lbh.sequence_no`,
        [locationId],
      );
      expect(firstVersionAfter.rows).toEqual(before.rows);
      expect(firstVersionAfter.rows[0]).toMatchObject({
        closes_at_local: "12:00:00",
        opens_at_local: "09:00:00",
      });
    });

    it("enforces default locale and deterministic publication CAS including races", async () => {
      const pool = harness.privilegedPool();
      const owner = await seedOwner(pool, ORGANIZATION_A, OWNER_A, OWNER_A_MEMBERSHIP, "s72-cas");
      const application = useCases(harness.runtime());
      const locationId = await createRoot(
        application,
        owner,
        "cas-clinic",
        idempotencyKey("cas-root"),
      );
      const missingDefaultLocale = publication();
      const localeResult = await publishRoot(
        application,
        owner,
        locationId,
        1,
        idempotencyKey("cas-locale"),
        { ...missingDefaultLocale, address_i18n: { ru: "Adres" }, name_i18n: { ru: "Klinika" } },
      );
      expect(localeResult).toEqual({ error: { code: "validation_failed" }, ok: false });

      const raced = await Promise.all([
        publishRoot(application, owner, locationId, 1, idempotencyKey("cas-race-a")),
        publishRoot(
          application,
          owner,
          locationId,
          1,
          idempotencyKey("cas-race-b"),
          publication("Competing Version"),
        ),
      ]);
      expect(raced.filter((result) => result.ok)).toHaveLength(1);
      expect(
        raced.filter((result) => !result.ok && result.error.code === "version_conflict"),
      ).toHaveLength(1);
      const stale = await publishRoot(
        application,
        owner,
        locationId,
        1,
        idempotencyKey("cas-stale"),
      );
      expect(stale).toEqual({ error: { code: "version_conflict" }, ok: false });
      expect(
        await pool.query(
          "select count(*)::int as count from location_versions where location_id = $1",
          [locationId],
        ),
      ).toMatchObject({ rows: [{ count: 1 }] });
    });

    it("deactivates by CAS while retaining current and historical published knowledge", async () => {
      const pool = harness.privilegedPool();
      const owner = await seedOwner(
        pool,
        ORGANIZATION_A,
        OWNER_A,
        OWNER_A_MEMBERSHIP,
        "s72-deactivate",
      );
      const application = useCases(harness.runtime());
      const locationId = await createRoot(
        application,
        owner,
        "inactive-clinic",
        idempotencyKey("inactive-root"),
      );
      await publishRoot(application, owner, locationId, 1, idempotencyKey("inactive-publish"));
      const stale = await application.deactivateLocation({
        authorization: owner,
        expectedVersion: 1,
        idempotencyKey: idempotencyKey("inactive-stale"),
        input: {},
        target: locationId,
      });
      expect(stale).toEqual({ error: { code: "version_conflict" }, ok: false });
      const result = await application.deactivateLocation({
        authorization: owner,
        expectedVersion: 2,
        idempotencyKey: idempotencyKey("inactive-success"),
        input: {},
        target: locationId,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("Expected deactivation to succeed");
      expect(result.value.resource).toMatchObject({ status: "inactive", version: 3 });
      expect(result.value.resource.current_version).not.toBeNull();
      expect(
        await pool.query(
          `select l.status, l.current_version_id is not null as retained,
                  count(lv.id)::int as version_count
             from locations l join location_versions lv on lv.location_id = l.id
            where l.id = $1 group by l.status, l.current_version_id`,
          [locationId],
        ),
      ).toMatchObject({ rows: [{ retained: true, status: "inactive", version_count: 1 }] });
    });

    it("creates, supersedes, and cancels immutable future closure knowledge", async () => {
      const pool = harness.privilegedPool();
      const owner = await seedOwner(
        pool,
        ORGANIZATION_A,
        OWNER_A,
        OWNER_A_MEMBERSHIP,
        "s72-closures",
      );
      const application = useCases(harness.runtime());
      const locationId = await createRoot(
        application,
        owner,
        "closure-clinic",
        idempotencyKey("closure-root"),
      );
      await publishRoot(application, owner, locationId, 1, idempotencyKey("closure-publish"));
      const created = await application.createClosure({
        authorization: owner,
        expectedVersion: 2,
        idempotencyKey: idempotencyKey("closure-create"),
        input: { kind: "closed", local_date: "2026-12-25", reason_i18n: { en: "Holiday" } },
        target: locationId,
      });
      expect(created.ok).toBe(true);
      if (!created.ok) throw new Error("Expected closure creation to succeed");
      const oldClosureId = created.value.resource.closure_id;
      expect(created.value.resource).toMatchObject({ status: "active", supersedes_id: null });

      const replaced = await application.supersedeClosure({
        authorization: owner,
        expectedVersion: 3,
        idempotencyKey: idempotencyKey("closure-supersede"),
        input: {
          closes_at_local: "14:00:00",
          kind: "override",
          local_date: "2026-12-25",
          opens_at_local: "10:00:00",
          reason_i18n: { en: "Reduced holiday hours" },
        },
        target: { closureId: oldClosureId, locationId },
      });
      expect(replaced.ok).toBe(true);
      if (!replaced.ok) throw new Error("Expected closure supersession to succeed");
      expect(replaced.value.resource).toMatchObject({
        status: "active",
        supersedes_id: oldClosureId,
      });
      const newClosureId = replaced.value.resource.closure_id;
      const closureRows = await pool.query<{ id: string; status: string }>(
        "select id, status from location_closures order by created_at, id",
      );
      expect(closureRows.rows).toContainEqual({ id: oldClosureId, status: "superseded" });

      const cancelled = await application.cancelClosure({
        authorization: owner,
        expectedVersion: 4,
        idempotencyKey: idempotencyKey("closure-cancel"),
        input: {},
        target: { closureId: newClosureId, locationId },
      });
      expect(cancelled.ok).toBe(true);
      if (!cancelled.ok) throw new Error("Expected closure cancellation to succeed");
      expect(cancelled.value.resource.status).toBe("cancelled");
      expect(
        await pool.query(
          "select count(*)::int as count from location_closures where location_id = $1",
          [locationId],
        ),
      ).toMatchObject({ rows: [{ count: 2 }] });
      const replay = await application.cancelClosure({
        authorization: owner,
        expectedVersion: 4,
        idempotencyKey: idempotencyKey("closure-cancel"),
        input: {},
        target: { closureId: newClosureId, locationId },
      });
      expect(replay).toEqual(cancelled);
    });

    it("serializes competing closure writers and leaves only one active date record", async () => {
      const pool = harness.privilegedPool();
      const owner = await seedOwner(
        pool,
        ORGANIZATION_A,
        OWNER_A,
        OWNER_A_MEMBERSHIP,
        "s72-closure-race",
      );
      const application = useCases(harness.runtime());
      const locationId = await createRoot(
        application,
        owner,
        "closure-race-clinic",
        idempotencyKey("closure-race-root"),
      );
      await publishRoot(application, owner, locationId, 1, idempotencyKey("closure-race-publish"));
      const raced = await Promise.all([
        application.createClosure({
          authorization: owner,
          expectedVersion: 2,
          idempotencyKey: idempotencyKey("closure-race-a"),
          input: { kind: "closed", local_date: "2027-01-01", reason_i18n: { en: "New Year" } },
          target: locationId,
        }),
        application.createClosure({
          authorization: owner,
          expectedVersion: 2,
          idempotencyKey: idempotencyKey("closure-race-b"),
          input: {
            closes_at_local: "13:00:00",
            kind: "override",
            local_date: "2027-01-01",
            opens_at_local: "10:00:00",
            reason_i18n: { en: "New Year hours" },
          },
          target: locationId,
        }),
      ]);
      expect(raced.filter((result) => result.ok)).toHaveLength(1);
      expect(
        raced.filter((result) => !result.ok && result.error.code === "version_conflict"),
      ).toHaveLength(1);
      expect(
        await pool.query(
          "select count(*)::int as count from location_closures where location_id = $1 and local_date = '2027-01-01' and status = 'active'",
          [locationId],
        ),
      ).toMatchObject({ rows: [{ count: 1 }] });
    });

    it("non-enumerates cross-tenant and mixed Location/closure identifiers", async () => {
      const pool = harness.privilegedPool();
      const ownerA = await seedOwner(
        pool,
        ORGANIZATION_A,
        OWNER_A,
        OWNER_A_MEMBERSHIP,
        "s72-hostile-a",
      );
      const ownerB = await seedOwner(
        pool,
        ORGANIZATION_B,
        OWNER_B,
        OWNER_B_MEMBERSHIP,
        "s72-hostile-b",
      );
      const application = useCases(harness.runtime());
      const locationA = await createRoot(
        application,
        ownerA,
        "hostile-a",
        idempotencyKey("hostile-root-a"),
      );
      const locationB = await createRoot(
        application,
        ownerB,
        "hostile-b",
        idempotencyKey("hostile-root-b"),
      );
      await publishRoot(application, ownerA, locationA, 1, idempotencyKey("hostile-publish-a"));
      await publishRoot(application, ownerB, locationB, 1, idempotencyKey("hostile-publish-b"));
      const closureB = await application.createClosure({
        authorization: ownerB,
        expectedVersion: 2,
        idempotencyKey: idempotencyKey("hostile-closure-b"),
        input: { kind: "closed", local_date: "2026-12-31", reason_i18n: { en: "Closed" } },
        target: locationB,
      });
      if (!closureB.ok) throw new Error("Expected tenant B closure fixture");
      const hostileResults = await Promise.all([
        application.getLocation({ authorization: ownerA, input: { locationId: locationB } }),
        publishRoot(application, ownerA, locationB, 2, idempotencyKey("hostile-cross-publish")),
        application.deactivateLocation({
          authorization: ownerA,
          expectedVersion: 2,
          idempotencyKey: idempotencyKey("hostile-cross-deactivate"),
          input: {},
          target: locationB,
        }),
        application.createClosure({
          authorization: ownerA,
          expectedVersion: 2,
          idempotencyKey: idempotencyKey("hostile-cross-closure"),
          input: { kind: "closed", local_date: "2026-12-31", reason_i18n: { en: "Closed" } },
          target: locationB,
        }),
        application.supersedeClosure({
          authorization: ownerA,
          expectedVersion: 2,
          idempotencyKey: idempotencyKey("hostile-mixed-closure"),
          input: { kind: "closed", local_date: "2026-12-31", reason_i18n: { en: "Changed" } },
          target: { closureId: closureB.value.resource.closure_id, locationId: locationA },
        }),
      ]);
      expect(hostileResults).toEqual(
        hostileResults.map(() => ({ error: { code: "resource_not_found" }, ok: false })),
      );
    });

    it("applies restricted scope in SQL before Location get/list projection", async () => {
      const pool = harness.privilegedPool();
      const owner = await seedOwner(pool, ORGANIZATION_A, OWNER_A, OWNER_A_MEMBERSHIP, "s72-scope");
      const application = useCases(harness.runtime());
      const locationA = await createRoot(
        application,
        owner,
        "scope-a",
        idempotencyKey("scope-root-a"),
      );
      const locationB = await createRoot(
        application,
        owner,
        "scope-b",
        idempotencyKey("scope-root-b"),
      );
      await insertUser(pool, STAFF);
      await insertMembership(pool, STAFF_MEMBERSHIP, ORGANIZATION_A, STAFF, "staff", "restricted");
      await pool.query(
        `insert into membership_location_scopes
          (organization_id, membership_id, location_id, created_by_user_id)
         values ($1, $2, $3, $4)`,
        [ORGANIZATION_A, STAFF_MEMBERSHIP, locationA, OWNER_A],
      );
      const restricted = await authorizationFor(
        ORGANIZATION_A,
        STAFF,
        STAFF_MEMBERSHIP,
        "staff",
        "restricted",
        [locationA],
      );
      const allowed = await application.getLocation({
        authorization: restricted,
        input: { locationId: locationA },
      });
      const denied = await application.getLocation({
        authorization: restricted,
        input: { locationId: locationB },
      });
      const listed = await application.listLocations({
        authorization: restricted,
        input: { filter: {}, pagination: { limit: 100 } },
      });
      expect(allowed.ok).toBe(true);
      expect(denied).toEqual({ error: { code: "resource_not_found" }, ok: false });
      expect(listed.ok && listed.value.items.map((item) => item.location_id)).toEqual([locationA]);

      await insertUser(pool, ANALYST);
      await insertMembership(
        pool,
        ANALYST_MEMBERSHIP,
        ORGANIZATION_A,
        ANALYST,
        "analyst",
        "restricted",
      );
      const emptyScope = await authorizationFor(
        ORGANIZATION_A,
        ANALYST,
        ANALYST_MEMBERSHIP,
        "analyst",
        "restricted",
      );
      const emptyList = await application.listLocations({
        authorization: emptyScope,
        input: { filter: {}, pagination: {} },
      });
      expect(emptyList).toEqual({ ok: true, value: { items: [], nextCursor: null } });
    });

    it.each([
      ["version insert", "location_versions", "insert"],
      ["current pointer update", "locations", "update"],
      ["audit insert", "audit_events", "insert"],
      ["outbox insert", "outbox_events", "insert"],
      ["idempotency finalization", "idempotency_keys", "update"],
    ] as const)("rolls back publication when %s fails", async (_label, table, operation) => {
      const pool = harness.privilegedPool();
      const owner = await seedOwner(
        pool,
        ORGANIZATION_A,
        OWNER_A,
        OWNER_A_MEMBERSHIP,
        `s72-failure-${table.replaceAll("_", "-")}`,
      );
      const application = useCases(harness.runtime());
      const locationId = await createRoot(
        application,
        owner,
        "failure-clinic",
        idempotencyKey(`failure-root-${table.slice(0, 12)}`),
      );
      await pool.query(`create or replace function app.s72_injected_failure()
        returns trigger language plpgsql as $body$
        begin raise exception using errcode = '40001', message = 'synthetic S7.2 failure'; end
        $body$`);
      await pool.query(
        `create trigger s72_injected_failure before ${operation} on ${table}
         for each row execute function app.s72_injected_failure()`,
      );
      try {
        expect(
          await publishRoot(
            application,
            owner,
            locationId,
            1,
            idempotencyKey(`failure-publish-${table.slice(0, 12)}`),
          ),
        ).toEqual({ error: { code: "version_conflict" }, ok: false });
      } finally {
        await pool.query(`drop trigger if exists s72_injected_failure on ${table}`);
        await pool.query("drop function if exists app.s72_injected_failure()");
      }
      expect(
        await pool.query(
          "select status, version::int as version, current_version_id from locations where id = $1",
          [locationId],
        ),
      ).toMatchObject({
        rows: [{ current_version_id: null, status: "inactive", version: 1 }],
      });
      expect(
        await pool.query(
          "select count(*)::int as count from location_versions where location_id = $1",
          [locationId],
        ),
      ).toMatchObject({ rows: [{ count: 0 }] });
      expect(
        await pool.query(
          "select count(*)::int as count from idempotency_keys where organization_id = $1",
          [ORGANIZATION_A],
        ),
      ).toMatchObject({ rows: [{ count: 1 }] });
    });

    it("prevents runtime mutation/deletion of published version, hours, and closure facts", async () => {
      const pool = harness.privilegedPool();
      const owner = await seedOwner(
        pool,
        ORGANIZATION_A,
        OWNER_A,
        OWNER_A_MEMBERSHIP,
        "s72-history",
      );
      const application = useCases(harness.runtime());
      const locationId = await createRoot(
        application,
        owner,
        "history-clinic",
        idempotencyKey("history-root"),
      );
      const published = await publishRoot(
        application,
        owner,
        locationId,
        1,
        idempotencyKey("history-publish"),
      );
      if (!published.ok || published.value.resource.current_version === null) {
        throw new Error("Expected published history fixture");
      }
      const versionId = published.value.resource.current_version.provenance.record_id;
      const hour = await pool.query<{ id: unknown }>(
        "select id from location_business_hours where location_version_id = $1 limit 1",
        [versionId],
      );
      const hourId = asResourceId(hour.rows[0]?.id);
      const closure = await application.createClosure({
        authorization: owner,
        expectedVersion: 2,
        idempotencyKey: idempotencyKey("history-closure"),
        input: { kind: "closed", local_date: "2027-02-01", reason_i18n: { en: "Closed" } },
        target: locationId,
      });
      if (!closure.ok) throw new Error("Expected closure history fixture");

      await expect(
        withRuntimeRole(pool, ORGANIZATION_A, async (client) => {
          await client.query(
            'update location_versions set name_i18n = \'{"en":"Changed"}\'::jsonb where organization_id = $1 and id = $2',
            [ORGANIZATION_A, versionId],
          );
        }),
      ).rejects.toMatchObject({ code: "23514" });
      await expect(
        withRuntimeRole(pool, ORGANIZATION_A, async (client) => {
          await client.query(
            "delete from location_business_hours where organization_id = $1 and id = $2",
            [ORGANIZATION_A, hourId],
          );
        }),
      ).rejects.toMatchObject({ code: "23514" });
      await expect(
        withRuntimeRole(pool, ORGANIZATION_A, async (client) => {
          await client.query(
            "delete from location_closures where organization_id = $1 and id = $2",
            [ORGANIZATION_A, closure.value.resource.closure_id],
          );
        }),
      ).rejects.toMatchObject({ code: "23514" });
      expect(
        await pool.query("select count(*)::int as count from location_versions where id = $1", [
          versionId,
        ]),
      ).toMatchObject({ rows: [{ count: 1 }] });
    });

    it("keeps the 51-table manifest and FORCE RLS protections unchanged", async () => {
      const pool = harness.privilegedPool();
      const tables = await pool.query<{ table_name: string }>(
        `select table_name from information_schema.tables
          where table_schema = 'public' and table_type = 'BASE TABLE'`,
      );
      expect(tables.rows).toHaveLength(51);
      const rls = await pool.query<{ relforcerowsecurity: boolean; relrowsecurity: boolean }>(
        `select relrowsecurity, relforcerowsecurity
           from pg_catalog.pg_class
          where oid = 'public.locations'::regclass`,
      );
      expect(rls.rows).toEqual([{ relforcerowsecurity: true, relrowsecurity: true }]);
      const migration = await pool.query<{ count: number }>(
        `select count(*)::int as count
           from pg_catalog.pg_trigger
          where not tgisinternal
            and tgname in ('location_versions_immutable_history',
                           'location_business_hours_immutable_history',
                           'location_closures_history_guard')`,
      );
      expect(migration.rows).toEqual([{ count: 3 }]);
      const localeMapPrivilege = await pool.query<{ allowed: boolean }>(
        `select has_function_privilege(
                  'lead_agent_runtime',
                  'public.is_bounded_locale_map(jsonb, integer)',
                  'EXECUTE'
                ) as allowed`,
      );
      expect(localeMapPrivilege.rows).toEqual([{ allowed: true }]);
    });
  });
};
