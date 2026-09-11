export const TENANT_PERMISSIONS = Object.freeze([
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
] as const);

export type TenantPermission = (typeof TENANT_PERMISSIONS)[number];

export const MEMBERSHIP_ROLES = Object.freeze(["owner", "admin", "staff", "analyst"] as const);
export type MembershipRole = (typeof MEMBERSHIP_ROLES)[number];

export const MEMBERSHIP_STATUSES = Object.freeze([
  "invited",
  "active",
  "suspended",
  "revoked",
] as const);
export type MembershipStatus = (typeof MEMBERSHIP_STATUSES)[number];

export const LOCATION_SCOPES = Object.freeze(["all", "restricted"] as const);
export type LocationScope = (typeof LOCATION_SCOPES)[number];

const freezeUniquePermissions = (
  role: MembershipRole,
  permissions: readonly TenantPermission[],
): readonly TenantPermission[] => {
  if (new Set(permissions).size !== permissions.length) {
    throw new TypeError(`Duplicate permission in ${role} role bundle`);
  }
  return Object.freeze([...permissions]);
};

const ownerPermissions = freezeUniquePermissions("owner", TENANT_PERMISSIONS);
const adminPermissions = freezeUniquePermissions(
  "admin",
  TENANT_PERMISSIONS.filter((permission) => permission !== "ownership.transfer"),
);
const staffPermissions = freezeUniquePermissions("staff", [
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
]);
const analystPermissions = freezeUniquePermissions("analyst", [
  "organization.read",
  "configuration.read",
  "analytics.read",
]);

export const ROLE_PERMISSION_BUNDLES: Readonly<
  Record<MembershipRole, readonly TenantPermission[]>
> = Object.freeze({
  admin: adminPermissions,
  analyst: analystPermissions,
  owner: ownerPermissions,
  staff: staffPermissions,
});

const permissionVocabulary = new Set<string>(TENANT_PERMISSIONS);
const membershipRoles = new Set<string>(MEMBERSHIP_ROLES);
const membershipStatuses = new Set<string>(MEMBERSHIP_STATUSES);
const locationScopes = new Set<string>(LOCATION_SCOPES);
const rolePermissionSets: Readonly<Record<MembershipRole, ReadonlySet<TenantPermission>>> = {
  admin: new Set(adminPermissions),
  analyst: new Set(analystPermissions),
  owner: new Set(ownerPermissions),
  staff: new Set(staffPermissions),
};

export const isTenantPermission = (value: unknown): value is TenantPermission =>
  typeof value === "string" && permissionVocabulary.has(value);

export const isMembershipRole = (value: unknown): value is MembershipRole =>
  typeof value === "string" && membershipRoles.has(value);

export const isMembershipStatus = (value: unknown): value is MembershipStatus =>
  typeof value === "string" && membershipStatuses.has(value);

export const isLocationScope = (value: unknown): value is LocationScope =>
  typeof value === "string" && locationScopes.has(value);

export const hasPermission = (role: unknown, permission: unknown): boolean =>
  isMembershipRole(role) &&
  isTenantPermission(permission) &&
  rolePermissionSets[role].has(permission);
