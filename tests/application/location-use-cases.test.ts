import { describe, expect, it } from "vitest";

import {
  createLocationConfigurationUseCases,
  createLocationCursorCodec,
  type LocationConfigurationStore,
} from "../../packages/application/src/index.js";
import {
  ConfigurationIdempotencyKeySchema,
  LocationIdSchema,
  MembershipIdSchema,
  OpaqueCursorSchema,
  OrganizationIdSchema,
  ResourceIdSchema,
  UserIdSchema,
  isSchemaValue,
  type ConfigurationIdempotencyKey,
  type LocationId,
  type LocationRoot,
  type MembershipId,
  type OrganizationId,
  type ResourceId,
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

const USER_VALUE = "0193f1a8-7f65-7c28-a434-a10796c47201";
const MEMBERSHIP_VALUE = "0193f1a8-7f65-7c28-a434-a10796c47202";
const ORGANIZATION_A_VALUE = "0193f1a8-7f65-7c28-a434-a10796c47203";
const ORGANIZATION_B_VALUE = "0193f1a8-7f65-7c28-a434-a10796c47204";
const LOCATION_A_VALUE = "0193f1a8-7f65-7c28-a434-a10796c47205";
const LOCATION_B_VALUE = "0193f1a8-7f65-7c28-a434-a10796c47206";
const CLOSURE_VALUE = "0193f1a8-7f65-7c28-a434-a10796c47207";
const IDEMPOTENCY_VALUE = "s72-idempotency-key";

if (
  !isSchemaValue(UserIdSchema, USER_VALUE) ||
  !isSchemaValue(MembershipIdSchema, MEMBERSHIP_VALUE) ||
  !isSchemaValue(OrganizationIdSchema, ORGANIZATION_A_VALUE) ||
  !isSchemaValue(OrganizationIdSchema, ORGANIZATION_B_VALUE) ||
  !isSchemaValue(LocationIdSchema, LOCATION_A_VALUE) ||
  !isSchemaValue(LocationIdSchema, LOCATION_B_VALUE) ||
  !isSchemaValue(ResourceIdSchema, CLOSURE_VALUE) ||
  !isSchemaValue(ConfigurationIdempotencyKeySchema, IDEMPOTENCY_VALUE)
) {
  throw new TypeError("Invalid S7.2 application test fixture");
}

const USER_ID: UserId = USER_VALUE;
const MEMBERSHIP_ID: MembershipId = MEMBERSHIP_VALUE;
const ORGANIZATION_A: OrganizationId = ORGANIZATION_A_VALUE;
const ORGANIZATION_B: OrganizationId = ORGANIZATION_B_VALUE;
const LOCATION_A: LocationId = LOCATION_A_VALUE;
const LOCATION_B: LocationId = LOCATION_B_VALUE;
const CLOSURE_ID: ResourceId = CLOSURE_VALUE;
const IDEMPOTENCY_KEY: ConfigurationIdempotencyKey = IDEMPOTENCY_VALUE;
const NOW = new Date("2026-09-12T08:00:00.000Z");

const session = (): AuthenticatedApplicationSession =>
  Object.freeze({
    absoluteExpiresAt: new Date("2026-09-13T08:00:00.000Z"),
    authenticationLevel: "mfa",
    authenticationTime: NOW,
    createdAt: NOW,
    idleExpiresAt: new Date("2026-09-12T09:00:00.000Z"),
    lastSeenAt: NOW,
    rotatedAt: NOW,
    rotationDue: false,
    sessionId: "0193f1a8-7f65-7c28-a434-a10796c47208",
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

const root = (locationId: LocationId = LOCATION_A): LocationRoot => ({
  code: "central-clinic",
  current_version: null,
  location_id: locationId,
  status: "inactive",
  version: 1,
});

type StoreCalls = {
  create: Parameters<LocationConfigurationStore["createLocation"]>[0][];
  publish: Parameters<LocationConfigurationStore["publishLocation"]>[0][];
  list: Parameters<LocationConfigurationStore["listLocations"]>[0][];
  get: Parameters<LocationConfigurationStore["getLocation"]>[0][];
  closure: Parameters<LocationConfigurationStore["createClosure"]>[0][];
};

const fakeStore = (): Readonly<{ calls: StoreCalls; store: LocationConfigurationStore }> => {
  const calls: StoreCalls = { closure: [], create: [], get: [], list: [], publish: [] };
  const store: LocationConfigurationStore = {
    cancelClosure: (input) =>
      Promise.resolve({
        ok: true,
        value: {
          events: [],
          resource: {
            closure_id: input.closureId,
            created_at: "2026-09-12T08:00:00.000Z",
            created_by_user_id: USER_ID,
            details: { kind: "closed", local_date: "2026-12-25", reason_i18n: { en: "Holiday" } },
            location_id: input.locationId,
            status: "cancelled",
            supersedes_id: null,
          },
        },
      }),
    createClosure: (input) => {
      calls.closure.push(input);
      return Promise.resolve({
        ok: true,
        value: {
          events: [],
          resource: {
            closure_id: input.closureId,
            created_at: input.occurredAt,
            created_by_user_id: USER_ID,
            details: input.value,
            location_id: input.locationId,
            status: "active",
            supersedes_id: null,
          },
        },
      });
    },
    createLocation: (input) => {
      calls.create.push(input);
      return Promise.resolve({
        ok: true,
        value: {
          events: [],
          resource: { ...root(input.locationId), code: input.value.code },
        },
      });
    },
    deactivateLocation: (input) =>
      Promise.resolve({ ok: true, value: { events: [], resource: root(input.locationId) } }),
    getLocation: (input) => {
      calls.get.push(input);
      return Promise.resolve({ ok: true, value: root(input.locationId) });
    },
    listLocations: (input) => {
      calls.list.push(input);
      return Promise.resolve({
        ok: true,
        value: {
          items: [root(LOCATION_A)],
          next: { code: "central-clinic", locationId: LOCATION_A },
        },
      });
    },
    publishLocation: (input) => {
      calls.publish.push(input);
      return Promise.resolve({ ok: true, value: { events: [], resource: root(input.locationId) } });
    },
    supersedeClosure: (input) =>
      Promise.resolve({
        ok: true,
        value: {
          events: [],
          resource: {
            closure_id: input.replacementId,
            created_at: input.occurredAt,
            created_by_user_id: USER_ID,
            details: input.value,
            location_id: input.locationId,
            status: "active",
            supersedes_id: input.closureId,
          },
        },
      }),
  };
  return { calls, store };
};

const validPublication = () => ({
  address_i18n: { en: "1 Clinic Street" },
  business_hours: {
    intervals: [
      { closes_at_local: "18:00:00", day_of_week: 2, opens_at_local: "09:00:00", sequence_no: 1 },
      { closes_at_local: "18:00:00", day_of_week: 1, opens_at_local: "13:00:00", sequence_no: 2 },
      { closes_at_local: "12:00:00", day_of_week: 1, opens_at_local: "09:00:00", sequence_no: 1 },
    ],
  },
  name_i18n: { en: "Central Clinic" },
  public_contact: { phone: "+998901234567" },
  time_zone: "Asia/Tashkent",
});

const useCasesFor = (store: LocationConfigurationStore) =>
  createLocationConfigurationUseCases(store, {
    clock: () => new Date(NOW),
    cursorCodec: createLocationCursorCodec(Buffer.alloc(32, 7)),
  });

describe("S7.2 Location configuration application use cases", () => {
  it("allows Owner and Admin to create only inactive non-authoritative roots", async () => {
    for (const role of ["owner", "admin"] as const) {
      const fixture = fakeStore();
      const result = await useCasesFor(fixture.store).createLocation({
        authorization: await authorizationFor(role),
        idempotencyKey: IDEMPOTENCY_KEY,
        input: { code: "central-clinic" },
      });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("Expected Location root creation to succeed");
      expect(result.value.resource).toMatchObject({
        current_version: null,
        status: "inactive",
        version: 1,
      });
      expect(result.value.events).toEqual([]);
      expect(fixture.calls.create).toHaveLength(1);
    }
  });

  it("denies Staff and Analyst mutations before calling persistence", async () => {
    for (const role of ["staff", "analyst"] as const) {
      const fixture = fakeStore();
      const createResult = await useCasesFor(fixture.store).createLocation({
        authorization: await authorizationFor(role),
        idempotencyKey: IDEMPOTENCY_KEY,
        input: { code: "central-clinic" },
      });
      const publishResult = await useCasesFor(fixture.store).publishLocation({
        authorization: await authorizationFor(role),
        expectedVersion: 1,
        idempotencyKey: IDEMPOTENCY_KEY,
        input: validPublication(),
        target: LOCATION_A,
      });
      expect(createResult).toEqual({ error: { code: "permission_denied" }, ok: false });
      expect(publishResult).toEqual({ error: { code: "permission_denied" }, ok: false });
      expect(fixture.calls.create).toEqual([]);
      expect(fixture.calls.publish).toEqual([]);
    }
  });

  it("requires publish permission and prepares deterministic ordered local hours", async () => {
    const fixture = fakeStore();
    const result = await useCasesFor(fixture.store).publishLocation({
      authorization: await authorizationFor("admin"),
      expectedVersion: 1,
      idempotencyKey: IDEMPOTENCY_KEY,
      input: validPublication(),
      target: LOCATION_A,
    });
    expect(result.ok).toBe(true);
    const prepared = fixture.calls.publish[0];
    expect(prepared?.value.business_hours.intervals).toEqual([
      { closes_at_local: "12:00:00", day_of_week: 1, opens_at_local: "09:00:00", sequence_no: 1 },
      { closes_at_local: "18:00:00", day_of_week: 1, opens_at_local: "13:00:00", sequence_no: 2 },
      { closes_at_local: "18:00:00", day_of_week: 2, opens_at_local: "09:00:00", sequence_no: 1 },
    ]);
    expect(prepared?.hourIds).toHaveLength(3);
    expect(prepared?.contentHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it.each([
    [
      "overlap",
      [
        { closes_at_local: "13:00:00", day_of_week: 1, opens_at_local: "09:00:00", sequence_no: 1 },
        { closes_at_local: "18:00:00", day_of_week: 1, opens_at_local: "12:00:00", sequence_no: 2 },
      ],
    ],
    [
      "sequence gap",
      [{ closes_at_local: "12:00:00", day_of_week: 1, opens_at_local: "09:00:00", sequence_no: 2 }],
    ],
    [
      "overnight",
      [{ closes_at_local: "02:00:00", day_of_week: 1, opens_at_local: "22:00:00", sequence_no: 1 }],
    ],
    [
      "malformed time",
      [{ closes_at_local: "18:00", day_of_week: 1, opens_at_local: "09:00:00", sequence_no: 1 }],
    ],
    [
      "invalid weekday",
      [{ closes_at_local: "18:00:00", day_of_week: 8, opens_at_local: "09:00:00", sequence_no: 1 }],
    ],
  ])("rejects invalid business hours: %s", async (_name, intervals) => {
    const fixture = fakeStore();
    const result = await useCasesFor(fixture.store).publishLocation({
      authorization: await authorizationFor("owner"),
      expectedVersion: 1,
      idempotencyKey: IDEMPOTENCY_KEY,
      input: { ...validPublication(), business_hours: { intervals } },
      target: LOCATION_A,
    });
    expect(result).toEqual({ error: { code: "validation_failed" }, ok: false });
    expect(fixture.calls.publish).toEqual([]);
  });

  it("accepts empty closed weekdays, split intervals, and valid IANA zones without UTC conversion", async () => {
    const fixture = fakeStore();
    const input = validPublication();
    input.time_zone = "America/New_York";
    input.business_hours.intervals = input.business_hours.intervals.filter(
      (interval) => interval.day_of_week === 1,
    );
    const result = await useCasesFor(fixture.store).publishLocation({
      authorization: await authorizationFor("owner"),
      expectedVersion: 1,
      idempotencyKey: IDEMPOTENCY_KEY,
      input,
      target: LOCATION_A,
    });
    expect(result.ok).toBe(true);
    expect(fixture.calls.publish[0]?.value.time_zone).toBe("America/New_York");
    expect(fixture.calls.publish[0]?.value.business_hours.intervals[0]?.opens_at_local).toBe(
      "09:00:00",
    );
    const winterOffset = new Intl.DateTimeFormat("en", {
      timeZone: "America/New_York",
      timeZoneName: "longOffset",
    }).formatToParts(new Date("2026-01-15T14:00:00Z"));
    const summerOffset = new Intl.DateTimeFormat("en", {
      timeZone: "America/New_York",
      timeZoneName: "longOffset",
    }).formatToParts(new Date("2026-07-15T13:00:00Z"));
    expect(winterOffset.find((part) => part.type === "timeZoneName")?.value).not.toBe(
      summerOffset.find((part) => part.type === "timeZoneName")?.value,
    );
  });

  it("rejects invalid IANA time zones and invalid override intervals", async () => {
    const fixture = fakeStore();
    const invalidZone = await useCasesFor(fixture.store).publishLocation({
      authorization: await authorizationFor("owner"),
      expectedVersion: 1,
      idempotencyKey: IDEMPOTENCY_KEY,
      input: { ...validPublication(), time_zone: "UTC+05:00" },
      target: LOCATION_A,
    });
    const invalidOverride = await useCasesFor(fixture.store).createClosure({
      authorization: await authorizationFor("owner"),
      expectedVersion: 1,
      idempotencyKey: IDEMPOTENCY_KEY,
      input: {
        closes_at_local: "09:00:00",
        kind: "override",
        local_date: "2026-12-25",
        opens_at_local: "18:00:00",
        reason_i18n: { en: "Special hours" },
      },
      target: LOCATION_A,
    });
    expect(invalidZone).toEqual({ error: { code: "validation_failed" }, ok: false });
    expect(invalidOverride).toEqual({ error: { code: "validation_failed" }, ok: false });
  });

  it("accepts future closures as immediate knowledge and delegates lifecycle commands", async () => {
    const fixture = fakeStore();
    const useCases = useCasesFor(fixture.store);
    const created = await useCases.createClosure({
      authorization: await authorizationFor("owner"),
      expectedVersion: 2,
      idempotencyKey: IDEMPOTENCY_KEY,
      input: { kind: "closed", local_date: "2026-12-25", reason_i18n: { en: "Holiday" } },
      target: LOCATION_A,
    });
    expect(created.ok).toBe(true);
    expect(fixture.calls.closure[0]?.value.local_date).toBe("2026-12-25");
    const superseded = await useCases.supersedeClosure({
      authorization: await authorizationFor("owner"),
      expectedVersion: 3,
      idempotencyKey: "s72-supersede-key",
      input: { kind: "closed", local_date: "2026-12-25", reason_i18n: { en: "Updated" } },
      target: { closureId: CLOSURE_ID, locationId: LOCATION_A },
    });
    const cancelled = await useCases.cancelClosure({
      authorization: await authorizationFor("owner"),
      expectedVersion: 4,
      idempotencyKey: "s72-cancel-key",
      input: {},
      target: { closureId: CLOSURE_ID, locationId: LOCATION_A },
    });
    expect(superseded.ok).toBe(true);
    expect(cancelled.ok).toBe(true);
  });

  it("blocks restricted out-of-scope reads before persistence", async () => {
    const fixture = fakeStore();
    const result = await useCasesFor(fixture.store).getLocation({
      authorization: await authorizationFor("staff", "restricted", [LOCATION_A]),
      input: { locationId: LOCATION_B },
    });
    expect(result).toEqual({ error: { code: "resource_not_found" }, ok: false });
    expect(fixture.calls.get).toEqual([]);
  });

  it("uses bounded keyset pagination and rejects cursor tampering or scope/filter reuse", async () => {
    const fixture = fakeStore();
    const useCases = useCasesFor(fixture.store);
    const authorization = await authorizationFor("analyst", "restricted", [LOCATION_A]);
    const first = await useCases.listLocations({
      authorization,
      input: { filter: { status: "active" }, pagination: {} },
    });
    expect(first.ok).toBe(true);
    if (!first.ok || first.value.nextCursor === null) throw new Error("Expected signed cursor");
    expect(fixture.calls.list[0]?.limit).toBe(50);
    const validNext = await useCases.listLocations({
      authorization,
      input: {
        filter: { status: "active" },
        pagination: { cursor: first.value.nextCursor, limit: 100 },
      },
    });
    expect(validNext.ok).toBe(true);
    expect(fixture.calls.list[1]?.after).toEqual({
      code: "central-clinic",
      locationId: LOCATION_A,
    });
    const changedFilter = await useCases.listLocations({
      authorization,
      input: { filter: { status: "inactive" }, pagination: { cursor: first.value.nextCursor } },
    });
    const changedTenant = await useCases.listLocations({
      authorization: await authorizationFor("analyst", "all", [], ORGANIZATION_B),
      input: { filter: { status: "active" }, pagination: { cursor: first.value.nextCursor } },
    });
    const tampered = `${first.value.nextCursor.slice(0, -1)}x`;
    if (!isSchemaValue(OpaqueCursorSchema, tampered)) {
      throw new TypeError("Tampered cursor fixture must remain syntactically opaque");
    }
    const tamperedResult = await useCases.listLocations({
      authorization,
      input: { filter: { status: "active" }, pagination: { cursor: tampered } },
    });
    expect(changedFilter).toEqual({ error: { code: "validation_failed" }, ok: false });
    expect(changedTenant).toEqual({ error: { code: "validation_failed" }, ok: false });
    expect(tamperedResult).toEqual({ error: { code: "validation_failed" }, ok: false });
  });

  it("passes deterministic persistence conflicts through the canonical result boundary", async () => {
    const fixture = fakeStore();
    fixture.store.publishLocation = () =>
      Promise.resolve({ error: { code: "version_conflict" }, ok: false });
    const versionConflict = await useCasesFor(fixture.store).publishLocation({
      authorization: await authorizationFor("owner"),
      expectedVersion: 1,
      idempotencyKey: IDEMPOTENCY_KEY,
      input: validPublication(),
      target: LOCATION_A,
    });
    fixture.store.createLocation = () =>
      Promise.resolve({ error: { code: "idempotency_conflict" }, ok: false });
    const idempotencyConflict = await useCasesFor(fixture.store).createLocation({
      authorization: await authorizationFor("owner"),
      idempotencyKey: IDEMPOTENCY_KEY,
      input: { code: "central-clinic" },
    });
    expect(versionConflict).toEqual({ error: { code: "version_conflict" }, ok: false });
    expect(idempotencyConflict).toEqual({ error: { code: "idempotency_conflict" }, ok: false });
  });
});
