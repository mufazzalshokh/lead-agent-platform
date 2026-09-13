import { describe, expect, it } from "vitest";

import {
  createPublishedBusinessKnowledgeReader,
  type PublishedBusinessKnowledgeStore,
  type PublishedBusinessKnowledgeStoreQuery,
} from "../../packages/application/src/index.js";
import {
  LocationIdSchema,
  MembershipIdSchema,
  OrganizationIdSchema,
  ResourceIdSchema,
  ServiceIdSchema,
  UtcTimestampSchema,
  UserIdSchema,
  isSchemaValue,
  type LocationId,
  type MembershipId,
  type OrganizationId,
  type PublishedBusinessKnowledgeV2,
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

const USER_VALUE = "0193f1a8-7f65-7c28-a434-a10796c47601";
const MEMBERSHIP_VALUE = "0193f1a8-7f65-7c28-a434-a10796c47602";
const ORGANIZATION_VALUE = "0193f1a8-7f65-7c28-a434-a10796c47603";
const LOCATION_A_VALUE = "0193f1a8-7f65-7c28-a434-a10796c47604";
const LOCATION_B_VALUE = "0193f1a8-7f65-7c28-a434-a10796c47605";
const SERVICE_VALUE = "0193f1a8-7f65-7c28-a434-a10796c47607";
const RESOURCE_VALUE = "0193f1a8-7f65-7c28-a434-a10796c47608";
const NOW_VALUE = "2026-09-16T08:00:00.000Z";

if (
  !isSchemaValue(UserIdSchema, USER_VALUE) ||
  !isSchemaValue(MembershipIdSchema, MEMBERSHIP_VALUE) ||
  !isSchemaValue(OrganizationIdSchema, ORGANIZATION_VALUE) ||
  !isSchemaValue(LocationIdSchema, LOCATION_A_VALUE) ||
  !isSchemaValue(LocationIdSchema, LOCATION_B_VALUE) ||
  !isSchemaValue(ServiceIdSchema, SERVICE_VALUE) ||
  !isSchemaValue(ResourceIdSchema, RESOURCE_VALUE) ||
  !isSchemaValue(UtcTimestampSchema, NOW_VALUE)
) {
  throw new TypeError("Invalid S7.5 application fixture");
}

const USER_ID: UserId = USER_VALUE;
const MEMBERSHIP_ID: MembershipId = MEMBERSHIP_VALUE;
const ORGANIZATION_ID: OrganizationId = ORGANIZATION_VALUE;
const LOCATION_A: LocationId = LOCATION_A_VALUE;
const LOCATION_B: LocationId = LOCATION_B_VALUE;
const SERVICE_ID: ServiceId = SERVICE_VALUE;
const RESOURCE_ID: ResourceId = RESOURCE_VALUE;
const NOW: UtcTimestamp = NOW_VALUE;

const session = (): AuthenticatedApplicationSession =>
  Object.freeze({
    absoluteExpiresAt: new Date("2026-09-17T08:00:00.000Z"),
    authenticationLevel: "mfa",
    authenticationTime: new Date(NOW),
    createdAt: new Date(NOW),
    idleExpiresAt: new Date("2026-09-16T09:00:00.000Z"),
    lastSeenAt: new Date(NOW),
    rotatedAt: new Date(NOW),
    rotationDue: false,
    sessionId: "0193f1a8-7f65-7c28-a434-a10796c47606",
    userId: USER_ID,
  });

const authorizationFor = async (
  role: MembershipRole = "owner",
  locationScope: LocationScope = "all",
  allowedLocationIds: readonly LocationId[] = [],
): Promise<AuthorizationContext> => {
  const current: CurrentMembershipAuthorization = Object.freeze({
    allowedLocationIds: Object.freeze([...allowedLocationIds]),
    locationScope,
    membershipId: MEMBERSHIP_ID,
    organizationId: ORGANIZATION_ID,
    role,
    status: "active",
    userId: USER_ID,
  });
  return resolveAuthorizationContext(session(), ORGANIZATION_ID, {
    resolveCurrentMembership: () => Promise.resolve(current),
  });
};

const emptyKnowledge = (
  overrides: Partial<PublishedBusinessKnowledgeV2> = {},
): PublishedBusinessKnowledgeV2 => ({
  effective_at: NOW,
  faqs: [],
  locale: "en",
  locations: [],
  policies: [],
  services: [],
  ...overrides,
});

const recordingStore = (
  result: PublishedBusinessKnowledgeV2 = emptyKnowledge(),
): Readonly<{
  calls: PublishedBusinessKnowledgeStoreQuery[];
  store: PublishedBusinessKnowledgeStore;
}> => {
  const calls: PublishedBusinessKnowledgeStoreQuery[] = [];
  return {
    calls,
    store: {
      readPublishedBusinessKnowledge: (query) => {
        calls.push(query);
        return Promise.resolve({ ok: true, value: result });
      },
    },
  };
};

describe("S7.5 published business knowledge application reader", () => {
  it("passes one explicit effective instant and an all-location projection to the store", async () => {
    const fixture = recordingStore();
    const reader = createPublishedBusinessKnowledgeReader(fixture.store);

    await expect(
      reader.getPublishedBusinessKnowledge({
        authorization: await authorizationFor(),
        input: { effective_at: NOW, locale: "en" },
      }),
    ).resolves.toEqual({ ok: true, value: emptyKnowledge() });
    expect(fixture.calls).toHaveLength(1);
    expect(fixture.calls[0]).toMatchObject({ effectiveAt: NOW, locale: "en", locationIds: null });
  });

  it("freezes restricted authorization before calling persistence", async () => {
    const fixture = recordingStore();
    const reader = createPublishedBusinessKnowledgeReader(fixture.store);

    await reader.getPublishedBusinessKnowledge({
      authorization: await authorizationFor("staff", "restricted", [LOCATION_B, LOCATION_A]),
      input: { effective_at: NOW, locale: "en" },
    });
    expect(fixture.calls[0]?.locationIds).toEqual([LOCATION_A, LOCATION_B]);
    expect(Object.isFrozen(fixture.calls[0]?.locationIds)).toBe(true);
  });

  it("rejects an unauthorized requested Location before persistence without leaking it", async () => {
    const fixture = recordingStore();
    const reader = createPublishedBusinessKnowledgeReader(fixture.store);

    await expect(
      reader.getPublishedBusinessKnowledge({
        authorization: await authorizationFor("analyst", "restricted", [LOCATION_A]),
        input: { effective_at: NOW, locale: "en", location_ids: [LOCATION_B] },
      }),
    ).resolves.toEqual({ error: { code: "resource_not_found" }, ok: false });
    expect(fixture.calls).toHaveLength(0);
  });

  it("passes an authorized caller projection without broadening it", async () => {
    const fixture = recordingStore();
    const reader = createPublishedBusinessKnowledgeReader(fixture.store);

    await reader.getPublishedBusinessKnowledge({
      authorization: await authorizationFor("staff", "restricted", [LOCATION_A, LOCATION_B]),
      input: { effective_at: NOW, locale: "en", location_ids: [LOCATION_B] },
    });
    expect(fixture.calls[0]?.locationIds).toEqual([LOCATION_B]);
  });

  it("rejects invalid request additions and timestamps before persistence", async () => {
    const fixture = recordingStore();
    const reader = createPublishedBusinessKnowledgeReader(fixture.store);
    const invalidInput = {
      effective_at: "2026-09-16T08:00:00+05:00",
      locale: "en" as const,
      published_only: true,
    };

    await expect(
      reader.getPublishedBusinessKnowledge({
        authorization: await authorizationFor(),
        input: invalidInput,
      }),
    ).resolves.toEqual({ error: { code: "validation_failed" }, ok: false });
    expect(fixture.calls).toHaveLength(0);
  });

  it("fails closed when persistence returns a different instant or locale", async () => {
    const reader = createPublishedBusinessKnowledgeReader(
      recordingStore(emptyKnowledge({ locale: "ru" })).store,
    );

    await expect(
      reader.getPublishedBusinessKnowledge({
        authorization: await authorizationFor(),
        input: { effective_at: NOW, locale: "en" },
      }),
    ).resolves.toEqual({ error: { code: "business_rule_failed" }, ok: false });
  });

  it("fails closed when a projected read exposes a Service with no visible offering", async () => {
    const reader = createPublishedBusinessKnowledgeReader(
      recordingStore(
        emptyKnowledge({
          services: [
            {
              code: "hidden-service",
              description_i18n: { en: "Hidden" },
              disclaimer_i18n: { en: "Hidden" },
              duration_guidance_minutes: null,
              location_offerings: [],
              name_i18n: { en: "Hidden" },
              price_resolutions: [],
              provenance: {
                content_hash: "ab".repeat(32),
                published_at: NOW,
                published_by_user_id: USER_ID,
                record_id: RESOURCE_ID,
                version_no: 1,
              },
              root_version: 1,
              service_id: SERVICE_ID,
            },
          ],
        }),
      ).store,
    );

    await expect(
      reader.getPublishedBusinessKnowledge({
        authorization: await authorizationFor(),
        input: { effective_at: NOW, locale: "en", location_ids: [LOCATION_A] },
      }),
    ).resolves.toEqual({ error: { code: "business_rule_failed" }, ok: false });
  });
});
