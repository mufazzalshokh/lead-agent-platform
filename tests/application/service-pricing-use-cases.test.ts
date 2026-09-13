import { describe, expect, it } from "vitest";

import {
  createPriceConfigurationUseCases,
  createServiceConfigurationUseCases,
  createServicePricingCursorCodec,
  type ServicePricingConfigurationStore,
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
  type ConfigurationIdempotencyKey,
  type LocationId,
  type MembershipId,
  type OrganizationId,
  type ResourceId,
  type ServiceId,
  type ServicePriceRecord,
  type ServiceRoot,
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

const USER_VALUE = "0193f1a8-7f65-7c28-a434-a10796c47301";
const MEMBERSHIP_VALUE = "0193f1a8-7f65-7c28-a434-a10796c47302";
const ORGANIZATION_A_VALUE = "0193f1a8-7f65-7c28-a434-a10796c47303";
const ORGANIZATION_B_VALUE = "0193f1a8-7f65-7c28-a434-a10796c47304";
const SERVICE_VALUE = "0193f1a8-7f65-7c28-a434-a10796c47305";
const LOCATION_A_VALUE = "0193f1a8-7f65-7c28-a434-a10796c47306";
const LOCATION_B_VALUE = "0193f1a8-7f65-7c28-a434-a10796c47307";
const PRICE_VALUE = "0193f1a8-7f65-7c28-a434-a10796c47308";
const IDEMPOTENCY_VALUE = "s73-idempotency-key";
const NOW_VALUE = "2026-09-14T08:00:00.000Z";

if (
  !isSchemaValue(UserIdSchema, USER_VALUE) ||
  !isSchemaValue(MembershipIdSchema, MEMBERSHIP_VALUE) ||
  !isSchemaValue(OrganizationIdSchema, ORGANIZATION_A_VALUE) ||
  !isSchemaValue(OrganizationIdSchema, ORGANIZATION_B_VALUE) ||
  !isSchemaValue(ServiceIdSchema, SERVICE_VALUE) ||
  !isSchemaValue(LocationIdSchema, LOCATION_A_VALUE) ||
  !isSchemaValue(LocationIdSchema, LOCATION_B_VALUE) ||
  !isSchemaValue(ResourceIdSchema, PRICE_VALUE) ||
  !isSchemaValue(UtcTimestampSchema, NOW_VALUE) ||
  !isSchemaValue(ConfigurationIdempotencyKeySchema, IDEMPOTENCY_VALUE)
) {
  throw new TypeError("Invalid S7.3 application fixture");
}

const USER_ID: UserId = USER_VALUE;
const MEMBERSHIP_ID: MembershipId = MEMBERSHIP_VALUE;
const ORGANIZATION_A: OrganizationId = ORGANIZATION_A_VALUE;
const ORGANIZATION_B: OrganizationId = ORGANIZATION_B_VALUE;
const SERVICE_ID: ServiceId = SERVICE_VALUE;
const LOCATION_A: LocationId = LOCATION_A_VALUE;
const LOCATION_B: LocationId = LOCATION_B_VALUE;
const PRICE_ID: ResourceId = PRICE_VALUE;
const IDEMPOTENCY_KEY: ConfigurationIdempotencyKey = IDEMPOTENCY_VALUE;
const NOW_TIMESTAMP: UtcTimestamp = NOW_VALUE;
const NOW = new Date(NOW_TIMESTAMP);

const session = (): AuthenticatedApplicationSession =>
  Object.freeze({
    absoluteExpiresAt: new Date("2026-09-15T08:00:00.000Z"),
    authenticationLevel: "mfa",
    authenticationTime: NOW,
    createdAt: NOW,
    idleExpiresAt: new Date("2026-09-14T09:00:00.000Z"),
    lastSeenAt: NOW,
    rotatedAt: NOW,
    rotationDue: false,
    sessionId: "0193f1a8-7f65-7c28-a434-a10796c47309",
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

const root = (): ServiceRoot => ({
  code: "implant-consultation",
  current_version: null,
  service_id: SERVICE_ID,
  status: "inactive",
  version: 1,
});

const price = (overrides: Partial<ServicePriceRecord> = {}): ServicePriceRecord => ({
  created_at: NOW_TIMESTAMP,
  display_text_i18n: { en: "From 100 USD" },
  effective_from: null,
  effective_to: null,
  location_id: null,
  price_id: PRICE_ID,
  pricing: { minimum: { amount_minor: 10_000, currency: "USD" }, price_type: "from" },
  published_by_user_id: null,
  service_id: SERVICE_ID,
  status: "draft",
  version_no: 1,
  ...overrides,
});

type Calls = {
  createPrice: Parameters<ServicePricingConfigurationStore["createPriceDraft"]>[0][];
  createService: Parameters<ServicePricingConfigurationStore["createService"]>[0][];
  listPrices: Parameters<ServicePricingConfigurationStore["listPrices"]>[0][];
  listServices: Parameters<ServicePricingConfigurationStore["listServices"]>[0][];
  publishPrice: Parameters<ServicePricingConfigurationStore["publishPrice"]>[0][];
  publishService: Parameters<ServicePricingConfigurationStore["publishService"]>[0][];
  relation: Parameters<ServicePricingConfigurationStore["changeServiceLocation"]>[0][];
  updatePrice: Parameters<ServicePricingConfigurationStore["updatePriceDraft"]>[0][];
};

const fakeStore = (): Readonly<{ calls: Calls; store: ServicePricingConfigurationStore }> => {
  const calls: Calls = {
    createPrice: [],
    createService: [],
    listPrices: [],
    listServices: [],
    publishPrice: [],
    publishService: [],
    relation: [],
    updatePrice: [],
  };
  const store: ServicePricingConfigurationStore = {
    changeServiceLocation: (input) => {
      calls.relation.push(input);
      return Promise.resolve({
        ok: true,
        value: {
          events: [],
          resource: {
            effective_from: input.occurredAt,
            effective_to: null,
            location_id: input.value.location_id,
            service_id: input.serviceId,
            status: input.value.status,
          },
        },
      });
    },
    createPriceDraft: (input) => {
      calls.createPrice.push(input);
      return Promise.resolve({
        ok: true,
        value: {
          events: [],
          resource: price({
            display_text_i18n: input.value.display_text_i18n,
            location_id: input.value.location_id,
            price_id: input.priceId,
            pricing: input.value.pricing,
          }),
        },
      });
    },
    createService: (input) => {
      calls.createService.push(input);
      return Promise.resolve({
        ok: true,
        value: {
          events: [],
          resource: { ...root(), code: input.value.code, service_id: input.serviceId },
        },
      });
    },
    deactivateService: () => Promise.resolve({ ok: true, value: { events: [], resource: root() } }),
    getPrice: () => Promise.resolve({ ok: true, value: price() }),
    getService: () => Promise.resolve({ ok: true, value: root() }),
    listPrices: (input) => {
      calls.listPrices.push(input);
      return Promise.resolve({
        ok: true,
        value: { items: [price()], next: { createdAt: NOW_TIMESTAMP, priceId: PRICE_ID } },
      });
    },
    listServices: (input) => {
      calls.listServices.push(input);
      return Promise.resolve({
        ok: true,
        value: { items: [root()], next: { code: root().code, serviceId: SERVICE_ID } },
      });
    },
    publishPrice: (input) => {
      calls.publishPrice.push(input);
      return Promise.resolve({ ok: true, value: { events: [], resource: price() } });
    },
    publishService: (input) => {
      calls.publishService.push(input);
      return Promise.resolve({ ok: true, value: { events: [], resource: root() } });
    },
    retirePrice: () => Promise.resolve({ ok: true, value: { events: [], resource: price() } }),
    updatePriceDraft: (input) => {
      calls.updatePrice.push(input);
      return Promise.resolve({ ok: true, value: { events: [], resource: price() } });
    },
  };
  return { calls, store };
};

const codecs = () => createServicePricingCursorCodec(Buffer.alloc(32, 11));
const serviceUseCases = (store: ServicePricingConfigurationStore) =>
  createServiceConfigurationUseCases(store, { clock: () => new Date(NOW), cursorCodec: codecs() });
const priceUseCases = (store: ServicePricingConfigurationStore) =>
  createPriceConfigurationUseCases(store, { clock: () => new Date(NOW), cursorCodec: codecs() });

const publication = () => ({
  description_i18n: { en: "Implant assessment" },
  disclaimer_i18n: { en: "Clinical assessment required" },
  duration_guidance_minutes: 45,
  name_i18n: { en: "Implant consultation" },
});

describe("S7.3 Service and price configuration application use cases", () => {
  it("creates inactive Service roots through write-authorized roles", async () => {
    for (const role of ["owner", "admin"] as const) {
      const fixture = fakeStore();
      const result = await serviceUseCases(fixture.store).createService({
        authorization: await authorizationFor(role),
        idempotencyKey: IDEMPOTENCY_KEY,
        input: { code: "implant-consultation" },
      });
      expect(result.ok).toBe(true);
      expect(fixture.calls.createService).toHaveLength(1);
      expect(fixture.calls.createService[0]?.value).toEqual({ code: "implant-consultation" });
    }
  });

  it("requires publish permission for authoritative Service and offering changes", async () => {
    for (const role of ["staff", "analyst"] as const) {
      const fixture = fakeStore();
      const result = await serviceUseCases(fixture.store).publishService({
        authorization: await authorizationFor(role),
        expectedVersion: 1,
        idempotencyKey: IDEMPOTENCY_KEY,
        input: publication(),
        target: SERVICE_ID,
      });
      expect(result).toEqual({ error: { code: "permission_denied" }, ok: false });
      expect(fixture.calls.publishService).toEqual([]);
    }
  });

  it("prepares immutable publication provenance inputs without changing business facts", async () => {
    const fixture = fakeStore();
    const result = await serviceUseCases(fixture.store).publishService({
      authorization: await authorizationFor("owner"),
      expectedVersion: 1,
      idempotencyKey: IDEMPOTENCY_KEY,
      input: publication(),
      target: SERVICE_ID,
    });
    expect(result.ok).toBe(true);
    const prepared = fixture.calls.publishService[0];
    expect(prepared?.value).toEqual(publication());
    expect(prepared?.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(prepared?.idempotency.scope).toBe("configuration.service.publish");
  });

  it("enforces restricted Location scope before filtered Service reads", async () => {
    const fixture = fakeStore();
    const result = await serviceUseCases(fixture.store).listServices({
      authorization: await authorizationFor("staff", "restricted", [LOCATION_A]),
      input: { filter: { location_id: LOCATION_B }, pagination: {} },
    });
    expect(result).toEqual({ error: { code: "resource_not_found" }, ok: false });
    expect(fixture.calls.listServices).toEqual([]);
  });

  it.each([
    ["fixed", { amount: { amount_minor: 0, currency: "USD" }, price_type: "fixed" }],
    ["from", { minimum: { amount_minor: 10_000, currency: "USD" }, price_type: "from" }],
    [
      "range",
      {
        maximum: { amount_minor: 20_000, currency: "USD" },
        minimum: { amount_minor: 10_000, currency: "USD" },
        price_type: "range",
      },
    ],
    ["quote", { currency: "USD", price_type: "quote_required" }],
  ] as const)("preserves the exact %s price model", async (_name, pricing) => {
    const fixture = fakeStore();
    const result = await priceUseCases(fixture.store).createPriceDraft({
      authorization: await authorizationFor("admin"),
      expectedVersion: 2,
      idempotencyKey: IDEMPOTENCY_KEY,
      input: { display_text_i18n: { en: "Exact terms" }, location_id: null, pricing },
      target: SERVICE_ID,
    });
    expect(result.ok).toBe(true);
    expect(fixture.calls.createPrice[0]?.value.pricing).toEqual(pricing);
  });

  it("does not synthesize a price when only quote-required terms are supplied", async () => {
    const fixture = fakeStore();
    await priceUseCases(fixture.store).createPriceDraft({
      authorization: await authorizationFor("owner"),
      expectedVersion: 2,
      idempotencyKey: IDEMPOTENCY_KEY,
      input: {
        display_text_i18n: { en: "Contact us" },
        location_id: null,
        pricing: { currency: "USD", price_type: "quote_required" },
      },
      target: SERVICE_ID,
    });
    expect(fixture.calls.createPrice[0]?.value.pricing).toEqual({
      currency: "USD",
      price_type: "quote_required",
    });
  });

  it("keeps draft mutation separate from explicit publication", async () => {
    const fixture = fakeStore();
    const useCases = priceUseCases(fixture.store);
    const updated = await useCases.updatePriceDraft({
      authorization: await authorizationFor("admin"),
      expectedVersion: 1,
      idempotencyKey: IDEMPOTENCY_KEY,
      input: {
        display_text_i18n: { en: "200 USD" },
        location_id: LOCATION_A,
        pricing: { amount: { amount_minor: 20_000, currency: "USD" }, price_type: "fixed" },
      },
      target: PRICE_ID,
    });
    const published = await useCases.publishPrice({
      authorization: await authorizationFor("admin"),
      expectedVersion: 2,
      idempotencyKey: "s73-publish-price-key",
      input: {},
      target: PRICE_ID,
    });
    expect(updated.ok).toBe(true);
    expect(published.ok).toBe(true);
    expect(fixture.calls.updatePrice).toHaveLength(1);
    expect(fixture.calls.publishPrice).toHaveLength(1);
  });

  it("rejects malformed price input and cross-scope price filters before persistence", async () => {
    const fixture = fakeStore();
    const useCases = priceUseCases(fixture.store);
    const malformed = await useCases.createPriceDraft({
      authorization: await authorizationFor("owner"),
      expectedVersion: 2,
      idempotencyKey: IDEMPOTENCY_KEY,
      input: {
        display_text_i18n: { en: "Invalid" },
        location_id: null,
        pricing: {
          maximum: { amount_minor: 100, currency: "USD" },
          minimum: { amount_minor: 200, currency: "USD" },
          price_type: "range",
        },
      },
      target: SERVICE_ID,
    });
    const outOfScope = await useCases.listPrices({
      authorization: await authorizationFor("staff", "restricted", [LOCATION_A]),
      input: { filter: { location_id: LOCATION_B }, pagination: {} },
    });
    expect(malformed).toEqual({ error: { code: "validation_failed" }, ok: false });
    expect(outOfScope).toEqual({ error: { code: "resource_not_found" }, ok: false });
    expect(fixture.calls.createPrice).toEqual([]);
  });

  it("binds Service list cursors to tenant, scope, and filters", async () => {
    const fixture = fakeStore();
    const authorization = await authorizationFor("analyst", "restricted", [LOCATION_A]);
    const useCases = serviceUseCases(fixture.store);
    const first = await useCases.listServices({
      authorization,
      input: { filter: { location_id: LOCATION_A, status: "active" }, pagination: {} },
    });
    if (!first.ok || first.value.nextCursor === null) throw new Error("Expected Service cursor");
    const next = await useCases.listServices({
      authorization,
      input: {
        filter: { location_id: LOCATION_A, status: "active" },
        pagination: { cursor: first.value.nextCursor, limit: 100 },
      },
    });
    const changedTenant = await useCases.listServices({
      authorization: await authorizationFor("analyst", "all", [], ORGANIZATION_B),
      input: {
        filter: { location_id: LOCATION_A, status: "active" },
        pagination: { cursor: first.value.nextCursor },
      },
    });
    expect(next.ok).toBe(true);
    expect(fixture.calls.listServices[1]?.after).toEqual({
      code: "implant-consultation",
      serviceId: SERVICE_ID,
    });
    expect(changedTenant).toEqual({ error: { code: "validation_failed" }, ok: false });
  });

  it("binds price cursors to location, price type, status, and authorization scope", async () => {
    const fixture = fakeStore();
    const authorization = await authorizationFor("analyst", "restricted", [LOCATION_A]);
    const useCases = priceUseCases(fixture.store);
    const first = await useCases.listPrices({
      authorization,
      input: {
        filter: { location_id: LOCATION_A, price_type: "from", status: "draft" },
        pagination: {},
      },
    });
    if (!first.ok || first.value.nextCursor === null) throw new Error("Expected price cursor");
    const changedFilter = await useCases.listPrices({
      authorization,
      input: {
        filter: { location_id: LOCATION_A, price_type: "fixed", status: "draft" },
        pagination: { cursor: first.value.nextCursor },
      },
    });
    const tampered = `${first.value.nextCursor.slice(0, -1)}x`;
    if (!isSchemaValue(OpaqueCursorSchema, tampered)) throw new TypeError("Invalid cursor fixture");
    const tamperedResult = await useCases.listPrices({
      authorization,
      input: {
        filter: { location_id: LOCATION_A, price_type: "from", status: "draft" },
        pagination: { cursor: tampered },
      },
    });
    expect(changedFilter).toEqual({ error: { code: "validation_failed" }, ok: false });
    expect(tamperedResult).toEqual({ error: { code: "validation_failed" }, ok: false });
  });

  it("passes deterministic repository conflict results through unchanged", async () => {
    const fixture = fakeStore();
    fixture.store.publishPrice = () =>
      Promise.resolve({ error: { code: "version_conflict" }, ok: false });
    const result = await priceUseCases(fixture.store).publishPrice({
      authorization: await authorizationFor("owner"),
      expectedVersion: 1,
      idempotencyKey: IDEMPOTENCY_KEY,
      input: {},
      target: PRICE_ID,
    });
    expect(result).toEqual({ error: { code: "version_conflict" }, ok: false });
  });
});
