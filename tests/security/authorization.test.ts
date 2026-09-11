import {
  LocationIdSchema,
  MembershipIdSchema,
  OrganizationIdSchema,
  UserIdSchema,
  isSchemaValue,
  type LocationId,
  type MembershipId,
  type OrganizationId,
  type UserId,
} from "../../packages/contracts/src/index.js";
import {
  AuthorizationDeniedError,
  AuthorizationStateInvalidError,
  MEMBERSHIP_ROLES,
  ROLE_PERMISSION_BUNDLES,
  TENANT_PERMISSIONS,
  authorizeResource,
  canInviteMembershipRole,
  canManageMembershipTarget,
  createOrganizationResourceScope,
  hasPermission,
  resolveAuthorizationContext,
  resolveLocationResourceScope,
  type AuthenticatedApplicationSession,
  type AuthorizationContext,
  type AuthorizationResourceScope,
  type CurrentMembershipAuthorization,
  type CurrentMembershipAuthorizationResolver,
  type LocationScope,
  type MembershipRole,
  type MembershipStatus,
  type TenantPermission,
} from "../../packages/security/src/index.js";
import { describe, expect, expectTypeOf, it } from "vitest";

const USER_VALUE = "0193f1a8-7f65-7c28-a434-a10796c46401";
const OTHER_USER_VALUE = "0193f1a8-7f65-7c28-a434-a10796c46402";
const ORGANIZATION_A_VALUE = "0193f1a8-7f65-7c28-a434-a10796c46403";
const ORGANIZATION_B_VALUE = "0193f1a8-7f65-7c28-a434-a10796c46404";
const MEMBERSHIP_VALUE = "0193f1a8-7f65-7c28-a434-a10796c46405";
const MEMBERSHIP_B_VALUE = "0193f1a8-7f65-7c28-a434-a10796c46410";
const LOCATION_A_VALUE = "0193f1a8-7f65-7c28-a434-a10796c46406";
const LOCATION_B_VALUE = "0193f1a8-7f65-7c28-a434-a10796c46407";
const FOREIGN_LOCATION_VALUE = "0193f1a8-7f65-7c28-a434-a10796c46408";

if (
  !isSchemaValue(UserIdSchema, USER_VALUE) ||
  !isSchemaValue(UserIdSchema, OTHER_USER_VALUE) ||
  !isSchemaValue(OrganizationIdSchema, ORGANIZATION_A_VALUE) ||
  !isSchemaValue(OrganizationIdSchema, ORGANIZATION_B_VALUE) ||
  !isSchemaValue(MembershipIdSchema, MEMBERSHIP_VALUE) ||
  !isSchemaValue(MembershipIdSchema, MEMBERSHIP_B_VALUE) ||
  !isSchemaValue(LocationIdSchema, LOCATION_A_VALUE) ||
  !isSchemaValue(LocationIdSchema, LOCATION_B_VALUE) ||
  !isSchemaValue(LocationIdSchema, FOREIGN_LOCATION_VALUE)
) {
  throw new TypeError("Invalid synthetic authorization identifiers");
}

const USER_ID: UserId = USER_VALUE;
const OTHER_USER_ID: UserId = OTHER_USER_VALUE;
const ORGANIZATION_A: OrganizationId = ORGANIZATION_A_VALUE;
const ORGANIZATION_B: OrganizationId = ORGANIZATION_B_VALUE;
const MEMBERSHIP_ID: MembershipId = MEMBERSHIP_VALUE;
const MEMBERSHIP_B_ID: MembershipId = MEMBERSHIP_B_VALUE;
const LOCATION_A: LocationId = LOCATION_A_VALUE;
const LOCATION_B: LocationId = LOCATION_B_VALUE;
const FOREIGN_LOCATION: LocationId = FOREIGN_LOCATION_VALUE;
const NOW = new Date("2026-09-11T08:00:00.000Z");

const OWNER_EXPECTED = [
  "organization.read",
  "organization.update",
  "memberships.read",
  "memberships.invite",
  "memberships.manage",
  "ownership.transfer",
  "configuration.read",
  "configuration.write",
  "configuration.publish",
  "integrations.read",
  "integrations.manage",
  "contacts.read",
  "contacts.read_sensitive",
  "leads.read",
  "leads.manage",
  "conversations.read",
  "conversations.manage",
  "appointments.read",
  "appointments.manage",
  "attendance.manage",
  "revenue_attribution.manage",
  "handoffs.read",
  "handoffs.manage",
  "notifications.read",
  "analytics.read",
  "audit.read",
  "privacy.read",
  "privacy.manage",
] as const satisfies readonly TenantPermission[];
const ADMIN_EXPECTED = OWNER_EXPECTED.filter((permission) => permission !== "ownership.transfer");
const STAFF_EXPECTED = [
  "organization.read",
  "configuration.read",
  "contacts.read",
  "contacts.read_sensitive",
  "leads.read",
  "leads.manage",
  "conversations.read",
  "conversations.manage",
  "appointments.read",
  "appointments.manage",
  "attendance.manage",
  "revenue_attribution.manage",
  "handoffs.read",
  "handoffs.manage",
  "notifications.read",
] as const satisfies readonly TenantPermission[];
const ANALYST_EXPECTED = [
  "organization.read",
  "configuration.read",
  "analytics.read",
] as const satisfies readonly TenantPermission[];
const EXPECTED_BY_ROLE: Readonly<Record<MembershipRole, readonly TenantPermission[]>> = {
  admin: ADMIN_EXPECTED,
  analyst: ANALYST_EXPECTED,
  owner: OWNER_EXPECTED,
  staff: STAFF_EXPECTED,
};

const session = (overrides: Partial<AuthenticatedApplicationSession> = {}) =>
  Object.freeze({
    absoluteExpiresAt: new Date(NOW.getTime() + 12 * 60 * 60 * 1_000),
    authenticationLevel: "mfa",
    authenticationTime: NOW,
    createdAt: NOW,
    idleExpiresAt: new Date(NOW.getTime() + 60 * 60 * 1_000),
    lastSeenAt: NOW,
    rotatedAt: NOW,
    rotationDue: false,
    sessionId: "0193f1a8-7f65-7c28-a434-a10796c46409",
    userId: USER_ID,
    ...overrides,
  });

const currentMembership = (
  role: MembershipRole,
  locationScope: LocationScope,
  allowedLocationIds: readonly LocationId[] = [],
  status: MembershipStatus = "active",
): CurrentMembershipAuthorization =>
  Object.freeze({
    allowedLocationIds: Object.freeze([...allowedLocationIds]),
    locationScope,
    membershipId: MEMBERSHIP_ID,
    organizationId: ORGANIZATION_A,
    role,
    status,
    userId: USER_ID,
  });

const resolver = (
  read: () => CurrentMembershipAuthorization | null,
): CurrentMembershipAuthorizationResolver => ({
  resolveCurrentMembership: () => Promise.resolve(read()),
});

const contextFor = (
  role: MembershipRole,
  locationScope: LocationScope,
  allowedLocationIds: readonly LocationId[] = [],
): Promise<AuthorizationContext> =>
  resolveAuthorizationContext(
    session(),
    ORGANIZATION_A,
    resolver(() => currentMembership(role, locationScope, allowedLocationIds)),
  );

describe("S6.4 finite tenant authorization policy", () => {
  it("freezes one unique 28-permission vocabulary and exact role bundles", () => {
    expect(TENANT_PERMISSIONS).toEqual(OWNER_EXPECTED);
    expect(TENANT_PERMISSIONS).toHaveLength(28);
    expect(new Set(TENANT_PERMISSIONS).size).toBe(28);
    expect(Object.isFrozen(TENANT_PERMISSIONS)).toBe(true);
    for (const role of MEMBERSHIP_ROLES) {
      expect(ROLE_PERMISSION_BUNDLES[role]).toEqual(EXPECTED_BY_ROLE[role]);
      expect(Object.isFrozen(ROLE_PERMISSION_BUNDLES[role])).toBe(true);
    }
    expect(ROLE_PERMISSION_BUNDLES.owner).toHaveLength(28);
    expect(ROLE_PERMISSION_BUNDLES.admin).toHaveLength(27);
    expect(ROLE_PERMISSION_BUNDLES.staff).toHaveLength(15);
    expect(ROLE_PERMISSION_BUNDLES.analyst).toHaveLength(3);
  });

  it("proves every pair in the complete 4 by 28 permission matrix", () => {
    for (const role of MEMBERSHIP_ROLES) {
      const expected = new Set(EXPECTED_BY_ROLE[role]);
      for (const permission of TENANT_PERMISSIONS) {
        expect(hasPermission(role, permission), `${role} ${permission}`).toBe(
          expected.has(permission),
        );
      }
    }
    expect(hasPermission("manager", "organization.read")).toBe(false);
    expect(hasPermission("owner", "organization.delete")).toBe(false);
    expect(hasPermission(undefined, undefined)).toBe(false);
  });

  it("keeps owner-target and invitation role policy distinct from memberships.manage", () => {
    for (const targetRole of MEMBERSHIP_ROLES) {
      expect(canInviteMembershipRole("owner", targetRole)).toBe(true);
      expect(canManageMembershipTarget("owner", targetRole, targetRole)).toBe(true);
      expect(canInviteMembershipRole("admin", targetRole)).toBe(targetRole !== "owner");
      expect(canManageMembershipTarget("admin", targetRole, targetRole)).toBe(
        targetRole !== "owner",
      );
    }
    expect(canManageMembershipTarget("admin", "staff", "owner")).toBe(false);
    expect(canManageMembershipTarget("admin", "owner", "staff")).toBe(false);
    expect(canInviteMembershipRole("staff", "staff")).toBe(false);
    expect(canManageMembershipTarget("analyst", "staff")).toBe(false);
    expect(canManageMembershipTarget("manager", "staff")).toBe(false);
  });

  it("constructs an immutable context only from the current exact Membership", async () => {
    const forgedSessionInput = Object.freeze({
      ...session(),
      allowedLocationIds: [FOREIGN_LOCATION],
      organizationId: ORGANIZATION_B,
      permissions: TENANT_PERMISSIONS,
      providerOrganization: ORGANIZATION_B,
      providerRole: "owner",
      role: "owner",
    });
    let receivedUser: UserId | undefined;
    let receivedOrganization: OrganizationId | undefined;
    const context = await resolveAuthorizationContext(forgedSessionInput, ORGANIZATION_A, {
      resolveCurrentMembership: (userId, organizationId) => {
        receivedUser = userId;
        receivedOrganization = organizationId;
        return Promise.resolve(currentMembership("staff", "restricted", [LOCATION_A]));
      },
    });

    expect(receivedUser).toBe(USER_ID);
    expect(receivedOrganization).toBe(ORGANIZATION_A);
    expect(context).toMatchObject({
      allowedLocationIds: [LOCATION_A],
      locationScope: "restricted",
      membershipId: MEMBERSHIP_ID,
      organizationId: ORGANIZATION_A,
      role: "staff",
      userId: USER_ID,
    });
    expect(context).not.toHaveProperty("permissions");
    expect(context).not.toHaveProperty("providerRole");
    expect(context).not.toHaveProperty("sessionToken");
    expect(Object.isFrozen(context)).toBe(true);
    expect(Object.isFrozen(context.allowedLocationIds)).toBe(true);
    expectTypeOf(context).toEqualTypeOf<AuthorizationContext>();
    expectTypeOf(forgedSessionInput).not.toMatchTypeOf<AuthorizationContext>();
  });

  it.each(["invited", "suspended", "revoked"] as const)(
    "denies a %s Membership and never treats session identity as tenant authority",
    async (status) => {
      await expect(
        resolveAuthorizationContext(
          session(),
          ORGANIZATION_A,
          resolver(() => currentMembership("staff", "all", [], status)),
        ),
      ).rejects.toBeInstanceOf(AuthorizationDeniedError);
    },
  );

  it("defaults to denial for missing, unknown, mismatched, and corrupt Membership facts", async () => {
    await expect(
      resolveAuthorizationContext(
        session(),
        ORGANIZATION_A,
        resolver(() => null),
      ),
    ).rejects.toBeInstanceOf(AuthorizationDeniedError);

    const invalidRole = { ...currentMembership("staff", "all"), role: "manager" };
    await expect(
      resolveAuthorizationContext(
        session(),
        ORGANIZATION_A,
        resolver(() => invalidRole as unknown as CurrentMembershipAuthorization),
      ),
    ).rejects.toBeInstanceOf(AuthorizationDeniedError);

    const mismatchedOrganization = {
      ...currentMembership("staff", "all"),
      organizationId: ORGANIZATION_B,
    };
    await expect(
      resolveAuthorizationContext(
        session(),
        ORGANIZATION_A,
        resolver(() => mismatchedOrganization),
      ),
    ).rejects.toBeInstanceOf(AuthorizationStateInvalidError);

    const mismatchedUser = { ...currentMembership("staff", "all"), userId: OTHER_USER_ID };
    await expect(
      resolveAuthorizationContext(
        session(),
        ORGANIZATION_A,
        resolver(() => mismatchedUser),
      ),
    ).rejects.toBeInstanceOf(AuthorizationStateInvalidError);

    await expect(
      resolveAuthorizationContext(
        session(),
        ORGANIZATION_A,
        resolver(() => currentMembership("admin", "restricted", [LOCATION_A])),
      ),
    ).rejects.toBeInstanceOf(AuthorizationStateInvalidError);
  });

  it("reloads role, status, and location scope for every new context resolution", async () => {
    let current = currentMembership("admin", "all");
    const dynamicResolver = resolver(() => current);
    await expect(
      resolveAuthorizationContext(session(), ORGANIZATION_A, dynamicResolver),
    ).resolves.toMatchObject({ role: "admin", locationScope: "all" });

    current = currentMembership("staff", "restricted", [LOCATION_A]);
    await expect(
      resolveAuthorizationContext(session(), ORGANIZATION_A, dynamicResolver),
    ).resolves.toMatchObject({ role: "staff", allowedLocationIds: [LOCATION_A] });

    current = currentMembership("staff", "restricted", [LOCATION_B]);
    await expect(
      resolveAuthorizationContext(session(), ORGANIZATION_A, dynamicResolver),
    ).resolves.toMatchObject({ allowedLocationIds: [LOCATION_B] });

    current = currentMembership("staff", "restricted", [], "suspended");
    await expect(
      resolveAuthorizationContext(session(), ORGANIZATION_A, dynamicResolver),
    ).rejects.toBeInstanceOf(AuthorizationDeniedError);
  });

  it("enforces organization-wide and exact trusted location resource scope", async () => {
    const restricted = await contextFor("staff", "restricted", [LOCATION_A]);
    const all = await contextFor("staff", "all");
    const owner = await contextFor("owner", "all");
    const ownership = {
      locationBelongsToOrganization: (organizationId: OrganizationId, locationId: LocationId) =>
        Promise.resolve(
          organizationId === ORGANIZATION_A &&
            (locationId === LOCATION_A || locationId === LOCATION_B),
        ),
    };
    const locationA = await resolveLocationResourceScope(restricted, LOCATION_A, ownership);
    const locationB = await resolveLocationResourceScope(restricted, LOCATION_B, ownership);
    const foreign = await resolveLocationResourceScope(restricted, FOREIGN_LOCATION, ownership);

    expect(authorizeResource(restricted, "leads.read", locationA)).toEqual({ authorized: true });
    expect(authorizeResource(restricted, "leads.read", locationB)).toEqual({
      authorized: false,
      reason: "resource_scope_denied",
    });
    expect(authorizeResource(restricted, "leads.read", foreign)).toEqual({
      authorized: false,
      reason: "resource_scope_denied",
    });
    expect(
      authorizeResource(
        restricted,
        "organization.read",
        createOrganizationResourceScope(restricted),
      ),
    ).toEqual({
      authorized: false,
      reason: "resource_scope_denied",
    });
    expect(
      authorizeResource(
        all,
        "leads.read",
        await resolveLocationResourceScope(all, LOCATION_B, ownership),
      ),
    ).toEqual({
      authorized: true,
    });
    expect(
      authorizeResource(owner, "privacy.manage", createOrganizationResourceScope(owner)),
    ).toEqual({
      authorized: true,
    });
  });

  it("denies empty restricted scope, absent ownership, unknown permissions, and forged scopes", async () => {
    const restricted = await contextFor("staff", "restricted", []);
    const ownership = {
      locationBelongsToOrganization: () => Promise.resolve(true),
    };
    const location = await resolveLocationResourceScope(restricted, LOCATION_A, ownership);
    expect(authorizeResource(restricted, "leads.read", location)).toEqual({
      authorized: false,
      reason: "resource_scope_denied",
    });
    expect(authorizeResource(restricted, "leads.read", undefined)).toEqual({
      authorized: false,
      reason: "resource_scope_denied",
    });
    expect(authorizeResource(restricted, "leads.delete", location)).toEqual({
      authorized: false,
      reason: "permission_missing",
    });
    const forged = {
      kind: "location",
      locationId: LOCATION_A,
      organizationId: ORGANIZATION_A,
    } as unknown as AuthorizationResourceScope;
    expect(authorizeResource(restricted, "leads.read", forged)).toEqual({
      authorized: false,
      reason: "resource_scope_denied",
    });
    expect(
      authorizeResource(
        { role: "owner", organizationId: ORGANIZATION_A } as unknown as AuthorizationContext,
        "ownership.transfer",
        createOrganizationResourceScope(await contextFor("owner", "all")),
      ),
    ).toEqual({ authorized: false, reason: "authorization_context_invalid" });
  });

  it("keeps multi-organization contexts independent with no permission or scope union", async () => {
    const membershipB = Object.freeze({
      ...currentMembership("analyst", "restricted", [LOCATION_B]),
      membershipId: MEMBERSHIP_B_ID,
      organizationId: ORGANIZATION_B,
    });
    const multiOrganizationResolver: CurrentMembershipAuthorizationResolver = {
      resolveCurrentMembership: (_userId, organizationId) =>
        Promise.resolve(
          organizationId === ORGANIZATION_A
            ? currentMembership("staff", "restricted", [LOCATION_A])
            : membershipB,
        ),
    };
    const contextA = await resolveAuthorizationContext(
      session(),
      ORGANIZATION_A,
      multiOrganizationResolver,
    );
    const contextB = await resolveAuthorizationContext(
      session(),
      ORGANIZATION_B,
      multiOrganizationResolver,
    );
    expect(contextA).toMatchObject({
      organizationId: ORGANIZATION_A,
      role: "staff",
      allowedLocationIds: [LOCATION_A],
    });
    expect(contextB).toMatchObject({
      organizationId: ORGANIZATION_B,
      role: "analyst",
      allowedLocationIds: [LOCATION_B],
    });
    expect(hasPermission(contextA.role, "analytics.read")).toBe(false);
    expect(hasPermission(contextB.role, "leads.read")).toBe(false);
  });
});
