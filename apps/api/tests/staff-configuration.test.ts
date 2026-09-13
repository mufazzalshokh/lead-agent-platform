import type { ConfigurationFailureCode, ConfigurationResult } from "@lead-agent/application";
import {
  BusinessPolicySchema,
  FaqSchema,
  LocationClosureRecordSchema,
  LocationIdSchema,
  LocationRootSchema,
  MembershipIdSchema,
  OrganizationIdSchema,
  ResourceIdSchema,
  ServiceIdSchema,
  ServiceLocationRecordSchema,
  ServicePriceRecordSchema,
  ServiceRootSchema,
  UserIdSchema,
  isSchemaValue,
  type BusinessPolicy,
  type Faq,
  type LocationClosureRecord,
  type LocationId,
  type LocationRoot,
  type MembershipId,
  type OrganizationId,
  type ResourceId,
  type ServiceId,
  type ServiceLocationRecord,
  type ServicePriceRecord,
  type ServiceRoot,
  type UserId,
} from "@lead-agent/contracts";
import { createStaffWebAuthConfig } from "@lead-agent/config";
import {
  SessionAuthenticationRequiredError,
  createBrowserAuthEnvelopeProtector,
  createOidcIdentityVerifier,
  type AuthenticatedApplicationSession,
  type MembershipRole,
} from "@lead-agent/security";
import { describe, expect, it } from "vitest";

import {
  createApi,
  formatConfigurationEtag,
  STAFF_CONFIGURATION_ROUTE_MANIFEST,
  type StaffAuthDependencies,
  type StaffConfigurationDependencies,
  type StaffConfigurationOperation,
} from "../src/app.js";

const NOW = new Date("2026-09-13T08:00:00.000Z");
const STAFF_ORIGIN = "https://staff.example.test";
const SESSION_TOKEN = "s".repeat(43);
const CSRF = "c".repeat(43);
const IDEMPOTENCY_KEY = "s76-operation-key";

const USER_VALUE = "0193f1a8-7f65-7c28-a434-a10796c47701";
const MEMBERSHIP_VALUE = "0193f1a8-7f65-7c28-a434-a10796c47702";
const ORGANIZATION_VALUE = "0193f1a8-7f65-7c28-a434-a10796c47703";
const OTHER_ORGANIZATION_VALUE = "0193f1a8-7f65-7c28-a434-a10796c47704";
const LOCATION_VALUE = "0193f1a8-7f65-7c28-a434-a10796c47705";
const OTHER_LOCATION_VALUE = "0193f1a8-7f65-7c28-a434-a10796c47706";
const SERVICE_VALUE = "0193f1a8-7f65-7c28-a434-a10796c47707";
const PRICE_VALUE = "0193f1a8-7f65-7c28-a434-a10796c47708";
const FAQ_VALUE = "0193f1a8-7f65-7c28-a434-a10796c47709";
const POLICY_VALUE = "0193f1a8-7f65-7c28-a434-a10796c4770a";
const CLOSURE_VALUE = "0193f1a8-7f65-7c28-a434-a10796c4770b";

if (
  !isSchemaValue(UserIdSchema, USER_VALUE) ||
  !isSchemaValue(MembershipIdSchema, MEMBERSHIP_VALUE) ||
  !isSchemaValue(OrganizationIdSchema, ORGANIZATION_VALUE) ||
  !isSchemaValue(OrganizationIdSchema, OTHER_ORGANIZATION_VALUE) ||
  !isSchemaValue(LocationIdSchema, LOCATION_VALUE) ||
  !isSchemaValue(LocationIdSchema, OTHER_LOCATION_VALUE) ||
  !isSchemaValue(ServiceIdSchema, SERVICE_VALUE) ||
  !isSchemaValue(ResourceIdSchema, PRICE_VALUE) ||
  !isSchemaValue(ResourceIdSchema, FAQ_VALUE) ||
  !isSchemaValue(ResourceIdSchema, POLICY_VALUE) ||
  !isSchemaValue(ResourceIdSchema, CLOSURE_VALUE)
) {
  throw new TypeError("Invalid S7.6 synthetic identifiers");
}

const USER_ID: UserId = USER_VALUE;
const MEMBERSHIP_ID: MembershipId = MEMBERSHIP_VALUE;
const ORGANIZATION_ID: OrganizationId = ORGANIZATION_VALUE;
const OTHER_ORGANIZATION_ID: OrganizationId = OTHER_ORGANIZATION_VALUE;
const LOCATION_ID: LocationId = LOCATION_VALUE;
const OTHER_LOCATION_ID: LocationId = OTHER_LOCATION_VALUE;
const SERVICE_ID: ServiceId = SERVICE_VALUE;
const PRICE_ID: ResourceId = PRICE_VALUE;
const FAQ_ID: ResourceId = FAQ_VALUE;
const POLICY_ID: ResourceId = POLICY_VALUE;
const CLOSURE_ID: ResourceId = CLOSURE_VALUE;

const locationValue = {
  code: "tashkent-clinic",
  current_version: null,
  location_id: LOCATION_ID,
  status: "inactive",
  version: 2,
};
const serviceValue = {
  code: "implant-consultation",
  current_version: null,
  service_id: SERVICE_ID,
  status: "inactive",
  version: 3,
};
const serviceLocationValue = {
  effective_from: NOW.toISOString(),
  effective_to: null,
  location_id: LOCATION_ID,
  service_id: SERVICE_ID,
  status: "active",
};
const priceValue = {
  created_at: NOW.toISOString(),
  display_text_i18n: { en: "Consultation price" },
  effective_from: null,
  effective_to: null,
  location_id: null,
  price_id: PRICE_ID,
  pricing: { amount: { amount_minor: 150_000, currency: "UZS" }, price_type: "fixed" },
  published_by_user_id: null,
  service_id: SERVICE_ID,
  status: "draft",
  version_no: 4,
};
const faqValue = {
  answer_i18n: { en: "Yes" },
  content_hash: "aa",
  created_at: NOW.toISOString(),
  effective_from: null,
  effective_to: null,
  faq_id: FAQ_ID,
  faq_key: "parking",
  location_id: LOCATION_ID,
  published_by_user_id: null,
  question_i18n: { en: "Is parking available?" },
  service_id: null,
  status: "draft",
  version_no: 5,
};
const qualificationRules = {
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
const policyValue = {
  content_hash: "bb",
  created_at: NOW.toISOString(),
  effective_from: null,
  effective_to: null,
  policy_id: POLICY_ID,
  policy_key: "lead-qualification",
  policy_type: "qualification",
  published_by_user_id: null,
  rules: qualificationRules,
  schema_version: 1,
  status: "draft",
  version_no: 6,
};
const closureValue = {
  closure_id: CLOSURE_ID,
  created_at: NOW.toISOString(),
  created_by_user_id: USER_ID,
  details: {
    kind: "closed",
    local_date: "2026-12-25",
    reason_i18n: { en: "Holiday" },
  },
  location_id: LOCATION_ID,
  status: "active",
  supersedes_id: null,
};

if (
  !isSchemaValue(LocationRootSchema, locationValue) ||
  !isSchemaValue(ServiceRootSchema, serviceValue) ||
  !isSchemaValue(ServiceLocationRecordSchema, serviceLocationValue) ||
  !isSchemaValue(ServicePriceRecordSchema, priceValue) ||
  !isSchemaValue(FaqSchema, faqValue) ||
  !isSchemaValue(BusinessPolicySchema, policyValue) ||
  !isSchemaValue(LocationClosureRecordSchema, closureValue)
) {
  throw new TypeError("Invalid S7.6 response fixture");
}

const LOCATION: LocationRoot = locationValue;
const SERVICE: ServiceRoot = serviceValue;
const SERVICE_LOCATION: ServiceLocationRecord = serviceLocationValue;
const PRICE: ServicePriceRecord = priceValue;
const FAQ: Faq = faqValue;
const POLICY: BusinessPolicy = policyValue;
const CLOSURE: LocationClosureRecord = closureValue;

type RecordedCall = Readonly<{ input: unknown; operation: string }>;
type FixtureControls = {
  calls: RecordedCall[];
  failure: ConfigurationFailureCode | null;
  role: MembershipRole;
  sessionValid: boolean;
  throwUnexpected: boolean;
  locationScope: "all" | "restricted";
};

const success = <Value>(value: Value): ConfigurationResult<Value> => ({ ok: true, value });
const mutation = <Value>(resource: Value) => ({ events: [], resource });

const createFixture = () => {
  const controls: FixtureControls = {
    calls: [],
    failure: null,
    locationScope: "all",
    role: "owner",
    sessionValid: true,
    throwUnexpected: false,
  };

  const outcome = <Value>(operation: string, input: unknown, value: Value) => {
    controls.calls.push({ input, operation });
    if (controls.throwUnexpected) return Promise.reject(new Error("internal fixture detail"));
    if (controls.failure !== null) {
      return Promise.resolve({ error: { code: controls.failure }, ok: false } as const);
    }
    return Promise.resolve(success(value));
  };

  const configuration: StaffConfigurationDependencies = {
    faqs: {
      createFaqDraft: (input) => outcome("createFaqDraft", input, mutation(FAQ)),
      getFaq: (input) => outcome("getFaq", input, FAQ),
      listFaqs: (input) => outcome("listFaqs", input, { items: [FAQ], nextCursor: null }),
      publishFaq: (input) => outcome("publishFaq", input, mutation(FAQ)),
      retireFaq: (input) => outcome("retireFaq", input, mutation(FAQ)),
      updateFaqDraft: (input) => outcome("updateFaqDraft", input, mutation(FAQ)),
    },
    locations: {
      cancelClosure: (input) => outcome("cancelClosure", input, mutation(CLOSURE)),
      createClosure: (input) => outcome("createClosure", input, mutation(CLOSURE)),
      createLocation: (input) => outcome("createLocation", input, mutation(LOCATION)),
      deactivateLocation: (input) => outcome("deactivateLocation", input, mutation(LOCATION)),
      getLocation: (input) => outcome("getLocation", input, LOCATION),
      listLocations: (input) =>
        outcome("listLocations", input, { items: [LOCATION], nextCursor: null }),
      publishLocation: (input) => outcome("publishLocation", input, mutation(LOCATION)),
      supersedeClosure: (input) => outcome("supersedeClosure", input, mutation(CLOSURE)),
    },
    policies: {
      createPolicyDraft: (input) => outcome("createPolicyDraft", input, mutation(POLICY)),
      getPolicy: (input) =>
        controls.locationScope === "restricted"
          ? Promise.resolve({ error: { code: "resource_not_found" }, ok: false })
          : outcome("getPolicy", input, POLICY),
      listPolicies: (input) =>
        controls.locationScope === "restricted"
          ? Promise.resolve({ error: { code: "resource_not_found" }, ok: false })
          : outcome("listPolicies", input, { items: [POLICY], nextCursor: null }),
      publishPolicy: (input) => outcome("publishPolicy", input, mutation(POLICY)),
      retirePolicy: (input) => outcome("retirePolicy", input, mutation(POLICY)),
      updatePolicyDraft: (input) => outcome("updatePolicyDraft", input, mutation(POLICY)),
    },
    prices: {
      createPriceDraft: (input) => outcome("createPriceDraft", input, mutation(PRICE)),
      getPrice: (input) => outcome("getPrice", input, PRICE),
      listPrices: (input) => outcome("listPrices", input, { items: [PRICE], nextCursor: null }),
      publishPrice: (input) => outcome("publishPrice", input, mutation(PRICE)),
      retirePrice: (input) => outcome("retirePrice", input, mutation(PRICE)),
      updatePriceDraft: (input) => outcome("updatePriceDraft", input, mutation(PRICE)),
    },
    services: {
      changeServiceLocation: (input) =>
        outcome("changeServiceLocation", input, mutation(SERVICE_LOCATION)),
      createService: (input) => outcome("createService", input, mutation(SERVICE)),
      deactivateService: (input) => outcome("deactivateService", input, mutation(SERVICE)),
      getService: (input) => outcome("getService", input, SERVICE),
      listServices: (input) =>
        outcome("listServices", input, { items: [SERVICE], nextCursor: null }),
      publishService: (input) => outcome("publishService", input, mutation(SERVICE)),
    },
  };

  const web = createStaffWebAuthConfig({
    browserEnvelopeKey: Buffer.alloc(32, 31).toString("base64url"),
    callbackUri: "https://api.example.test/v1/staff/auth/callback",
    clientId: "staff-client",
    clientSecret: "synthetic-test-value",
    environment: "production",
    invitationTargetEncryptionKey: Buffer.alloc(32, 32).toString("base64url"),
    invitationTargetLookupKey: Buffer.alloc(32, 33).toString("base64url"),
    issuer: "https://tenant.auth0.example/",
    requireMfa: true,
    staffAllowedOrigins: [STAFF_ORIGIN],
    staffApplicationOrigin: STAFF_ORIGIN,
  });
  const protector = createBrowserAuthEnvelopeProtector(web.browserEnvelopeKey);
  const session: AuthenticatedApplicationSession = Object.freeze({
    absoluteExpiresAt: new Date("2026-09-14T08:00:00.000Z"),
    authenticationLevel: "mfa",
    authenticationTime: NOW,
    createdAt: NOW,
    idleExpiresAt: new Date("2026-09-13T09:00:00.000Z"),
    lastSeenAt: NOW,
    rotatedAt: NOW,
    rotationDue: false,
    sessionId: "0193f1a8-7f65-7c28-a434-a10796c4770c",
    userId: USER_ID,
  });
  const sealedSession = protector.sealSession({
    csrfSecret: CSRF,
    expiresAt: session.absoluteExpiresAt,
    sessionToken: SESSION_TOKEN,
  });
  const auth: StaffAuthDependencies = {
    authorizationResolver: {
      resolveCurrentMembership: (userId, organizationId) =>
        organizationId !== ORGANIZATION_ID
          ? Promise.resolve(null)
          : Promise.resolve({
              allowedLocationIds: controls.locationScope === "restricted" ? [LOCATION_ID] : [],
              locationScope: controls.locationScope,
              membershipId: MEMBERSHIP_ID,
              organizationId,
              role: controls.role,
              status: "active",
              userId,
            }),
    },
    clock: () => NOW,
    config: web,
    envelopeProtector: protector,
    identityResolver: { resolve: () => Promise.resolve(USER_ID) },
    invitationAcceptance: {
      accept: () =>
        Promise.resolve({
          externalIdentityCreated: false,
          membershipActivated: true,
          membershipId: MEMBERSHIP_ID,
          outcome: "activated",
          userCreated: false,
          userId: USER_ID,
        }),
    },
    oidcClient: {
      begin: () =>
        Promise.resolve({
          authorizationUrl: "https://tenant.auth0.example/authorize",
          codeVerifier: "v".repeat(43),
          nonce: "n".repeat(43),
          state: "x".repeat(43),
        }),
      complete: () =>
        Promise.resolve({
          authenticationLevel: "mfa",
          authenticationTime: NOW,
          idToken: "synthetic.token.value",
          verifiedEmailTarget: "person@example.test",
        }),
    },
    oidcVerifier: createOidcIdentityVerifier({
      verifyEvidence: () =>
        Promise.resolve({ issuer: "https://tenant.auth0.example/", subject: "auth0|person" }),
    }),
    sessions: {
      createSession: () => Promise.reject(new Error("not used")),
      resolveSession: () =>
        controls.sessionValid
          ? Promise.resolve(session)
          : Promise.reject(new SessionAuthenticationRequiredError()),
      revokeSession: () => Promise.resolve(),
      revokeUserSessions: () => Promise.resolve(0),
      rotateSession: () => Promise.reject(new Error("not used")),
    },
  };
  const api = createApi({ staffAuth: auth, staffConfiguration: configuration });
  const cookie = `__Host-lead-session=${sealedSession}; __Host-lead-csrf=${CSRF}`;
  const readHeaders = (organizationId: OrganizationId = ORGANIZATION_ID) => ({
    cookie,
    "x-organization-context": organizationId,
  });
  const mutationHeaders = (targetId: LocationId | ResourceId | ServiceId, version: number) => ({
    ...readHeaders(),
    "idempotency-key": IDEMPOTENCY_KEY,
    "if-match": formatConfigurationEtag(targetId, version),
    origin: STAFF_ORIGIN,
    "sec-fetch-site": "same-origin",
    "x-csrf-token": CSRF,
  });
  return { api, configuration, controls, mutationHeaders, readHeaders };
};

const routeUrl = (path: string): string =>
  path
    .replaceAll("{closure_id}", CLOSURE_ID)
    .replaceAll("{price_id}", PRICE_ID)
    .replaceAll(
      "{id}",
      path.includes("/services/")
        ? SERVICE_ID
        : path.includes("/faqs/")
          ? FAQ_ID
          : path.includes("/business-policies/")
            ? POLICY_ID
            : LOCATION_ID,
    );

const mutationBody = (operation: StaffConfigurationOperation): Record<string, unknown> => {
  switch (operation) {
    case "createLocation":
      return { code: "tashkent-clinic" };
    case "publishLocation":
      return {
        address_i18n: { en: "Tashkent" },
        business_hours: { intervals: [] },
        name_i18n: { en: "Clinic" },
        public_contact: {},
        time_zone: "Asia/Tashkent",
      };
    case "createClosure":
    case "supersedeClosure":
      return {
        kind: "closed",
        local_date: "2026-12-25",
        reason_i18n: { en: "Holiday" },
      };
    case "createService":
      return { code: "implant-consultation" };
    case "publishService":
      return {
        description_i18n: { en: "Consultation" },
        disclaimer_i18n: { en: "Clinical assessment required" },
        duration_guidance_minutes: 45,
        name_i18n: { en: "Implant consultation" },
      };
    case "changeServiceLocation":
      return { location_id: LOCATION_ID, status: "active" };
    case "createPriceDraft":
    case "updatePriceDraft":
      return {
        display_text_i18n: { en: "Request a quote" },
        location_id: null,
        pricing: { currency: "UZS", price_type: "quote_required" },
      };
    case "createFaqDraft":
      return {
        answer_i18n: { en: "Yes" },
        faq_key: "parking",
        location_id: null,
        question_i18n: { en: "Is parking available?" },
        service_id: null,
      };
    case "updateFaqDraft":
      return {
        answer_i18n: { en: "Yes" },
        location_id: null,
        question_i18n: { en: "Is parking available?" },
        service_id: null,
      };
    case "createPolicyDraft":
      return {
        policy_key: "lead-qualification",
        policy_type: "qualification",
        rules: qualificationRules,
        schema_version: 1,
      };
    case "updatePolicyDraft":
      return {
        policy_type: "qualification",
        rules: qualificationRules,
        schema_version: 1,
      };
    case "cancelClosure":
    case "deactivateLocation":
    case "deactivateService":
    case "publishFaq":
    case "publishPolicy":
    case "publishPrice":
    case "retireFaq":
    case "retirePolicy":
    case "retirePrice":
      return {};
    case "getFaq":
    case "getLocation":
    case "getPolicy":
    case "getPrice":
    case "getService":
    case "listFaqs":
    case "listLocations":
    case "listPolicies":
    case "listPrices":
    case "listServices":
      throw new TypeError(`Not a mutation operation: ${operation}`);
  }
};

const mutationVersion = (path: string): number =>
  path.includes("/prices/")
    ? 4
    : path.includes("/faqs/")
      ? 5
      : path.includes("/business-policies/")
        ? 6
        : path.includes("/services/")
          ? 3
          : 2;

const mutationTarget = (path: string): LocationId | ResourceId | ServiceId =>
  path.includes("/prices/")
    ? PRICE_ID
    : path.includes("/faqs/")
      ? FAQ_ID
      : path.includes("/business-policies/")
        ? POLICY_ID
        : path.includes("/services/")
          ? SERVICE_ID
          : LOCATION_ID;

const withoutHeader = (
  headers: Readonly<Record<string, string>>,
  omittedName: string,
): Readonly<Record<string, string>> =>
  Object.fromEntries(Object.entries(headers).filter(([name]) => name !== omittedName));

describe("S7.6 private staff configuration API", { timeout: 30_000 }, () => {
  it("freezes the exact 32-route metadata matrix", () => {
    expect(STAFF_CONFIGURATION_ROUTE_MANIFEST).toHaveLength(32);
    expect(
      new Set(STAFF_CONFIGURATION_ROUTE_MANIFEST.map(({ method, path }) => `${method} ${path}`))
        .size,
    ).toBe(32);
    expect(
      STAFF_CONFIGURATION_ROUTE_MANIFEST.filter(
        ({ permission }) => permission === "configuration.read",
      ),
    ).toHaveLength(10);
    expect(
      STAFF_CONFIGURATION_ROUTE_MANIFEST.filter(
        ({ permission }) => permission === "configuration.write",
      ),
    ).toHaveLength(8);
    expect(
      STAFF_CONFIGURATION_ROUTE_MANIFEST.filter(
        ({ permission }) => permission === "configuration.publish",
      ),
    ).toHaveLength(14);
    expect(STAFF_CONFIGURATION_ROUTE_MANIFEST.filter(({ ifMatch }) => ifMatch)).toHaveLength(18);
    expect(
      STAFF_CONFIGURATION_ROUTE_MANIFEST.filter(({ idempotencyKey }) => idempotencyKey),
    ).toHaveLength(22);
    expect(
      STAFF_CONFIGURATION_ROUTE_MANIFEST.filter(
        ({ method }) => method === "PUT" || method === "PATCH",
      )
        .filter(({ idempotencyKey, ifMatch }) => idempotencyKey && ifMatch)
        .map(({ method, path }) => `${method} ${path}`),
    ).toEqual([
      "PUT /v1/staff/services/{id}/locations",
      "PATCH /v1/staff/prices/{price_id}",
      "PATCH /v1/staff/faqs/{id}",
      "PATCH /v1/staff/business-policies/{id}",
    ]);
  });

  it("registers every frozen route and no removed, stale, trusted-read, or v2 route", async () => {
    const fixture = createFixture();
    try {
      for (const route of STAFF_CONFIGURATION_ROUTE_MANIFEST) {
        const response = await fixture.api.inject({
          method: route.method,
          url: routeUrl(route.path),
        });
        expect(response.statusCode, `${route.method} ${route.path}`).toBe(401);
      }
      for (const [method, url] of [
        ["PATCH", `/v1/staff/locations/${LOCATION_ID}`],
        ["GET", `/v1/staff/locations/${LOCATION_ID}/business-hours`],
        ["GET", `/v1/staff/locations/${LOCATION_ID}/closures`],
        ["PATCH", `/v1/staff/services/${SERVICE_ID}`],
        ["GET", `/v1/staff/services/${SERVICE_ID}/locations`],
        ["GET", "/v1/staff/knowledge"],
        ["GET", "/v1/staff/published-business-knowledge"],
        ["GET", `/v1/staff/services/${SERVICE_ID}/prices/${PRICE_ID}`],
        ["GET", "/v2/staff/locations"],
      ] as const) {
        expect((await fixture.api.inject({ method, url })).statusCode, `${method} ${url}`).toBe(
          404,
        );
      }
    } finally {
      await fixture.api.close();
    }
  });

  it("requires staff authentication and authoritative organization membership", async () => {
    const fixture = createFixture();
    try {
      expect(
        (await fixture.api.inject({ method: "GET", url: "/v1/staff/locations" })).statusCode,
      ).toBe(401);
      fixture.controls.sessionValid = false;
      expect(
        (
          await fixture.api.inject({
            headers: fixture.readHeaders(),
            method: "GET",
            url: "/v1/staff/locations",
          })
        ).statusCode,
      ).toBe(401);
      fixture.controls.sessionValid = true;
      expect(
        (
          await fixture.api.inject({
            headers: fixture.readHeaders(OTHER_ORGANIZATION_ID),
            method: "GET",
            url: "/v1/staff/locations",
          })
        ).statusCode,
      ).toBe(403);
    } finally {
      await fixture.api.close();
    }
  });

  it("lets Staff and Analyst read but denies every write and publish permission", async () => {
    for (const role of ["staff", "analyst"] as const) {
      const fixture = createFixture();
      fixture.controls.role = role;
      try {
        expect(
          (
            await fixture.api.inject({
              headers: fixture.readHeaders(),
              method: "GET",
              url: "/v1/staff/locations",
            })
          ).statusCode,
        ).toBe(200);
        for (const route of STAFF_CONFIGURATION_ROUTE_MANIFEST.filter(
          ({ mutation: isMutation }) => isMutation,
        )) {
          const response = await fixture.api.inject({
            body: {},
            headers: fixture.mutationHeaders(
              mutationTarget(route.path),
              mutationVersion(route.path),
            ),
            method: route.method,
            url: routeUrl(route.path),
          });
          expect(response.statusCode, `${role}: ${route.method} ${route.path}`).toBe(403);
        }
      } finally {
        await fixture.api.close();
      }
    }
  });

  it("passes the verified location scope and finite keyset query to the application", async () => {
    const fixture = createFixture();
    fixture.controls.role = "analyst";
    fixture.controls.locationScope = "restricted";
    try {
      const response = await fixture.api.inject({
        headers: fixture.readHeaders(),
        method: "GET",
        url: `/v1/staff/services?location_id=${LOCATION_ID}&status=active&limit=25`,
      });
      expect(response.statusCode).toBe(200);
      expect(fixture.controls.calls).toHaveLength(1);
      expect(fixture.controls.calls[0]).toMatchObject({
        input: {
          authorization: {
            allowedLocationIds: [LOCATION_ID],
            locationScope: "restricted",
            organizationId: ORGANIZATION_ID,
            role: "analyst",
          },
          input: {
            filter: { location_id: LOCATION_ID, status: "active" },
            pagination: { limit: 25 },
          },
        },
        operation: "listServices",
      });
      const denied = await fixture.api.inject({
        headers: fixture.readHeaders(),
        method: "GET",
        url: "/v1/staff/business-policies",
      });
      expect(denied.statusCode).toBe(404);
    } finally {
      await fixture.api.close();
    }
  });

  it("maps create metadata, success envelopes, request IDs, and deterministic ETags", async () => {
    const fixture = createFixture();
    try {
      const response = await fixture.api.inject({
        body: { code: "tashkent-clinic" },
        headers: {
          ...fixture.mutationHeaders(LOCATION_ID, 2),
          "x-request-id": "request:s76-create-location",
        },
        method: "POST",
        url: "/v1/staff/locations",
      });
      expect(response.statusCode).toBe(201);
      expect(response.headers.etag).toBe(formatConfigurationEtag(LOCATION_ID, 2));
      expect(response.headers["x-request-id"]).toBe("request:s76-create-location");
      expect(response.json()).toMatchObject({
        data: { location_id: LOCATION_ID, version: 2 },
        meta: { request_id: "request:s76-create-location" },
      });
      expect(fixture.controls.calls[0]).toMatchObject({
        input: {
          authorization: { organizationId: ORGANIZATION_ID, userId: USER_ID },
          idempotencyKey: IDEMPOTENCY_KEY,
          input: { code: "tashkent-clinic" },
        },
        operation: "createLocation",
      });
    } finally {
      await fixture.api.close();
    }
  });

  it("enforces the common session-bound CSRF, exact Origin, and Fetch Metadata guard", async () => {
    const fixture = createFixture();
    const valid = fixture.mutationHeaders(LOCATION_ID, 2);
    try {
      for (const headers of [
        withoutHeader(valid, "x-csrf-token"),
        { ...valid, "x-csrf-token": "x".repeat(43) },
        { ...valid, origin: "https://attacker.test" },
        { ...valid, "sec-fetch-site": "cross-site" },
      ]) {
        const response = await fixture.api.inject({
          body: {},
          headers,
          method: "POST",
          url: `/v1/staff/locations/${LOCATION_ID}/deactivate`,
        });
        expect(response.statusCode).toBe(403);
        expect(fixture.controls.calls).toHaveLength(0);
      }
      expect(
        (
          await fixture.api.inject({
            body: {},
            headers: valid,
            method: "POST",
            url: `/v1/staff/locations/${LOCATION_ID}/deactivate`,
          })
        ).statusCode,
      ).toBe(200);
    } finally {
      await fixture.api.close();
    }
  });

  it("enforces common CSRF and every declared concurrency header on all 22 mutations", async () => {
    const fixture = createFixture();
    try {
      for (const route of STAFF_CONFIGURATION_ROUTE_MANIFEST.filter(
        ({ mutation: isMutation }) => isMutation,
      )) {
        const target = mutationTarget(route.path);
        const allHeaders = fixture.mutationHeaders(target, mutationVersion(route.path));
        const headers = route.ifMatch ? allHeaders : withoutHeader(allHeaders, "if-match");
        const request = {
          body: mutationBody(route.operation),
          method: route.method,
          url: routeUrl(route.path),
        } as const;

        fixture.controls.calls.length = 0;
        const missingCsrf = await fixture.api.inject({
          ...request,
          headers: withoutHeader(headers, "x-csrf-token"),
        });
        expect(missingCsrf.statusCode, `CSRF: ${route.method} ${route.path}`).toBe(403);
        expect(fixture.controls.calls).toHaveLength(0);

        const missingIdempotency = await fixture.api.inject({
          ...request,
          headers: withoutHeader(headers, "idempotency-key"),
        });
        expect(
          missingIdempotency.statusCode,
          `Idempotency-Key: ${route.method} ${route.path}`,
        ).toBe(400);
        expect(fixture.controls.calls).toHaveLength(0);

        if (route.ifMatch) {
          const missingIfMatch = await fixture.api.inject({
            ...request,
            headers: withoutHeader(headers, "if-match"),
          });
          expect(missingIfMatch.statusCode, `If-Match: ${route.method} ${route.path}`).toBe(400);
          expect(fixture.controls.calls).toHaveLength(0);
        }

        const valid = await fixture.api.inject({ ...request, headers });
        expect(valid.statusCode, `valid: ${route.method} ${route.path}`).toBeLessThan(400);
        expect(fixture.controls.calls.map(({ operation }) => operation)).toEqual([route.operation]);
      }
    } finally {
      await fixture.api.close();
    }
  });

  it("requires exact resource-bound If-Match and maps stale versions safely", async () => {
    const fixture = createFixture();
    const headers = fixture.mutationHeaders(PRICE_ID, 4);
    const body = {
      display_text_i18n: { en: "Updated" },
      location_id: null,
      pricing: { currency: "UZS", price_type: "quote_required" },
    };
    try {
      const missing = await fixture.api.inject({
        body,
        headers: withoutHeader(headers, "if-match"),
        method: "PATCH",
        url: `/v1/staff/prices/${PRICE_ID}`,
      });
      expect(missing.statusCode).toBe(400);
      for (const ifMatch of ["4", "*", 'W/"4"', formatConfigurationEtag(FAQ_ID, 4)]) {
        const response = await fixture.api.inject({
          body,
          headers: { ...headers, "if-match": ifMatch },
          method: "PATCH",
          url: `/v1/staff/prices/${PRICE_ID}`,
        });
        expect(response.statusCode).toBe(400);
      }
      const valid = await fixture.api.inject({
        body,
        headers,
        method: "PATCH",
        url: `/v1/staff/prices/${PRICE_ID}`,
      });
      expect(valid.statusCode).toBe(200);
      expect(fixture.controls.calls.at(-1)).toMatchObject({
        input: { expectedVersion: 4, idempotencyKey: IDEMPOTENCY_KEY, target: PRICE_ID },
        operation: "updatePriceDraft",
      });
      fixture.controls.failure = "version_conflict";
      const stale = await fixture.api.inject({
        body,
        headers,
        method: "PATCH",
        url: `/v1/staff/prices/${PRICE_ID}`,
      });
      expect(stale.statusCode).toBe(409);
      expect(stale.json()).toMatchObject({ code: "version_conflict", status: 409 });
    } finally {
      await fixture.api.close();
    }
  });

  it("requires and preserves Idempotency-Key on the explicit PATCH exception", async () => {
    const fixture = createFixture();
    const body = {
      display_text_i18n: { en: "Updated" },
      location_id: null,
      pricing: { currency: "UZS", price_type: "quote_required" },
    };
    try {
      const missing = await fixture.api.inject({
        body,
        headers: withoutHeader(fixture.mutationHeaders(PRICE_ID, 4), "idempotency-key"),
        method: "PATCH",
        url: `/v1/staff/prices/${PRICE_ID}`,
      });
      expect(missing.statusCode).toBe(400);
      fixture.controls.failure = "idempotency_conflict";
      const conflict = await fixture.api.inject({
        body,
        headers: fixture.mutationHeaders(PRICE_ID, 4),
        method: "PATCH",
        url: `/v1/staff/prices/${PRICE_ID}`,
      });
      expect(conflict.statusCode).toBe(409);
      expect(conflict.json()).toMatchObject({ code: "idempotency_conflict", status: 409 });
    } finally {
      await fixture.api.close();
    }
  });

  it("keeps ISO LocalDate and IANA time zones canonical at the HTTP boundary", async () => {
    const fixture = createFixture();
    const headers = fixture.mutationHeaders(LOCATION_ID, 2);
    try {
      for (const localDate of ["25-12-2026", "2026-02-30"]) {
        const response = await fixture.api.inject({
          body: { kind: "closed", local_date: localDate, reason_i18n: { en: "Holiday" } },
          headers,
          method: "POST",
          url: `/v1/staff/locations/${LOCATION_ID}/closures`,
        });
        expect(response.statusCode).toBe(400);
      }
      const validDate = await fixture.api.inject({
        body: { kind: "closed", local_date: "2026-12-25", reason_i18n: { en: "Holiday" } },
        headers,
        method: "POST",
        url: `/v1/staff/locations/${LOCATION_ID}/closures`,
      });
      expect(validDate.statusCode).toBe(201);

      const publication = (timeZone: string) => ({
        address_i18n: { en: "Tashkent" },
        business_hours: { intervals: [] },
        name_i18n: { en: "Clinic" },
        public_contact: {},
        time_zone: timeZone,
      });
      expect(
        (
          await fixture.api.inject({
            body: publication("UTC+5"),
            headers,
            method: "POST",
            url: `/v1/staff/locations/${LOCATION_ID}/publish`,
          })
        ).statusCode,
      ).toBe(400);
      expect(
        (
          await fixture.api.inject({
            body: publication("Asia/Tashkent"),
            headers,
            method: "POST",
            url: `/v1/staff/locations/${LOCATION_ID}/publish`,
          })
        ).statusCode,
      ).toBe(200);
    } finally {
      await fixture.api.close();
    }
  });

  it("rejects fractional money before the application operation", async () => {
    const fixture = createFixture();
    try {
      const response = await fixture.api.inject({
        body: {
          display_text_i18n: { en: "Price" },
          location_id: null,
          pricing: {
            amount: { amount_minor: 10.5, currency: "UZS" },
            price_type: "fixed",
          },
        },
        headers: fixture.mutationHeaders(SERVICE_ID, 3),
        method: "POST",
        url: `/v1/staff/services/${SERVICE_ID}/prices`,
      });
      expect(response.statusCode).toBe(400);
      expect(fixture.controls.calls).toHaveLength(0);
    } finally {
      await fixture.api.close();
    }
  });

  it("allows only qualification-v1 mutable policy bodies", async () => {
    const fixture = createFixture();
    const headers = fixture.mutationHeaders(POLICY_ID, 6);
    try {
      for (const policyType of ["booking", "handoff", "safety", "consent"]) {
        const response = await fixture.api.inject({
          body: { policy_key: "reserved", policy_type: policyType, rules: {}, schema_version: 1 },
          headers,
          method: "POST",
          url: "/v1/staff/business-policies",
        });
        expect(response.statusCode).toBe(400);
      }
      const valid = await fixture.api.inject({
        body: {
          policy_key: "lead-qualification",
          policy_type: "qualification",
          rules: qualificationRules,
          schema_version: 1,
        },
        headers,
        method: "POST",
        url: "/v1/staff/business-policies",
      });
      expect(valid.statusCode).toBe(201);
    } finally {
      await fixture.api.close();
    }
  });

  it("maps all application failures and unexpected exceptions to safe canonical problems", async () => {
    const fixture = createFixture();
    try {
      for (const [code, status] of [
        ["validation_failed", 400],
        ["permission_denied", 403],
        ["resource_not_found", 404],
        ["version_conflict", 409],
        ["idempotency_conflict", 409],
        ["business_rule_failed", 422],
        ["rate_limited", 429],
      ] as const) {
        fixture.controls.failure = code;
        const response = await fixture.api.inject({
          headers: fixture.readHeaders(),
          method: "GET",
          url: `/v1/staff/locations/${OTHER_LOCATION_ID}`,
        });
        expect(response.statusCode).toBe(status);
        expect(response.headers["content-type"]).toContain("application/problem+json");
        expect(response.json()).toMatchObject({ code, status });
        expect(response.body).not.toContain(OTHER_ORGANIZATION_ID);
      }
      fixture.controls.failure = null;
      fixture.controls.throwUnexpected = true;
      const unexpected = await fixture.api.inject({
        headers: fixture.readHeaders(),
        method: "GET",
        url: `/v1/staff/locations/${LOCATION_ID}`,
      });
      expect(unexpected.statusCode).toBe(500);
      expect(unexpected.json()).toMatchObject({ code: "internal_error", status: 500 });
      expect(unexpected.body).not.toContain("internal fixture detail");
    } finally {
      await fixture.api.close();
    }
  });

  it("rejects offset/arbitrary filters and pagination above 100", async () => {
    const fixture = createFixture();
    try {
      for (const query of ["?offset=1", "?sort=code", "?limit=101"]) {
        const response = await fixture.api.inject({
          headers: fixture.readHeaders(),
          method: "GET",
          url: "/v1/staff/locations" + query,
        });
        expect(response.statusCode).toBe(400);
      }
    } finally {
      await fixture.api.close();
    }
  });

  it("advertises only the exact trusted staff mutation headers and methods", async () => {
    const fixture = createFixture();
    try {
      const response = await fixture.api.inject({
        headers: { origin: STAFF_ORIGIN },
        method: "OPTIONS",
        url: "/v1/staff/locations",
      });
      expect(response.statusCode).toBe(204);
      expect(response.headers["access-control-allow-origin"]).toBe(STAFF_ORIGIN);
      expect(response.headers["access-control-allow-methods"]).toBe("GET, HEAD, POST, PUT, PATCH");
      expect(response.headers["access-control-allow-headers"]).toContain("Idempotency-Key");
      expect(response.headers["access-control-allow-headers"]).toContain("If-Match");
      expect(response.headers["access-control-allow-headers"]).toContain("X-Organization-Context");
    } finally {
      await fixture.api.close();
    }
  });

  it("refuses configuration registration without the accepted authentication boundary", async () => {
    const fixture = createFixture();
    try {
      expect(() => createApi({ staffConfiguration: fixture.configuration })).toThrow(
        /authentication boundary/u,
      );
    } finally {
      await fixture.api.close();
    }
  });
});
