import type { LocationId, OrganizationId } from "@lead-agent/contracts";

import { type AuthorizationContext, isAuthorizationContext } from "./context.js";
import { hasPermission } from "./permissions.js";

const resourceScopeBrand: unique symbol = Symbol("AuthorizationResourceScope");

export type AuthorizationResourceScope =
  | Readonly<{
      kind: "organization";
      organizationId: OrganizationId;
      [resourceScopeBrand]: true;
    }>
  | Readonly<{
      kind: "location";
      locationId: LocationId;
      organizationId: OrganizationId;
      [resourceScopeBrand]: true;
    }>;

export interface LocationOwnershipVerifier {
  locationBelongsToOrganization(
    organizationId: OrganizationId,
    locationId: LocationId,
  ): Promise<boolean>;
}

export type AuthorizationDecision =
  | Readonly<{ authorized: true }>
  | Readonly<{
      authorized: false;
      reason: "authorization_context_invalid" | "permission_missing" | "resource_scope_denied";
    }>;

const AUTHORIZED: AuthorizationDecision = Object.freeze({ authorized: true });
const INVALID_CONTEXT: AuthorizationDecision = Object.freeze({
  authorized: false,
  reason: "authorization_context_invalid",
});
const PERMISSION_MISSING: AuthorizationDecision = Object.freeze({
  authorized: false,
  reason: "permission_missing",
});
const RESOURCE_SCOPE_DENIED: AuthorizationDecision = Object.freeze({
  authorized: false,
  reason: "resource_scope_denied",
});

const isTrustedResourceScope = (value: unknown): value is AuthorizationResourceScope =>
  typeof value === "object" && value !== null && Reflect.get(value, resourceScopeBrand) === true;

export const createOrganizationResourceScope = (
  context: AuthorizationContext,
): AuthorizationResourceScope =>
  Object.freeze({
    kind: "organization",
    organizationId: context.organizationId,
    [resourceScopeBrand]: true as const,
  });

export const resolveLocationResourceScope = async (
  context: AuthorizationContext,
  locationId: LocationId,
  verifier: LocationOwnershipVerifier,
): Promise<AuthorizationResourceScope | null> => {
  if (!isAuthorizationContext(context)) {
    return null;
  }
  if (!(await verifier.locationBelongsToOrganization(context.organizationId, locationId))) {
    return null;
  }
  return Object.freeze({
    kind: "location",
    locationId,
    organizationId: context.organizationId,
    [resourceScopeBrand]: true as const,
  });
};

export const authorizeResource = (
  context: AuthorizationContext,
  permission: unknown,
  resourceScope: AuthorizationResourceScope | null | undefined,
): AuthorizationDecision => {
  if (!isAuthorizationContext(context)) {
    return INVALID_CONTEXT;
  }
  if (!hasPermission(context.role, permission)) {
    return PERMISSION_MISSING;
  }
  if (
    !isTrustedResourceScope(resourceScope) ||
    resourceScope.organizationId !== context.organizationId
  ) {
    return RESOURCE_SCOPE_DENIED;
  }
  if (resourceScope.kind === "organization") {
    return context.locationScope === "all" ? AUTHORIZED : RESOURCE_SCOPE_DENIED;
  }
  if (context.locationScope === "all") {
    return AUTHORIZED;
  }
  return context.allowedLocationIds.includes(resourceScope.locationId)
    ? AUTHORIZED
    : RESOURCE_SCOPE_DENIED;
};
