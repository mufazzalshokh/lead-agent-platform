import type { OrganizationId } from "@lead-agent/contracts";
import {
  AuthorizationDeniedError,
  authorizeResource,
  createOrganizationResourceScope,
  resolveAuthorizationContext,
  type AuthenticatedApplicationSession,
  type AuthorizationContext,
  type CurrentMembershipAuthorizationResolver,
  type TenantPermission,
} from "@lead-agent/security";

export const authorizeOrganizationOperation = async (
  session: AuthenticatedApplicationSession,
  organizationId: OrganizationId,
  permission: TenantPermission,
  resolver: CurrentMembershipAuthorizationResolver,
): Promise<AuthorizationContext> => {
  const context = await resolveAuthorizationContext(session, organizationId, resolver);
  const decision = authorizeResource(context, permission, createOrganizationResourceScope(context));
  if (!decision.authorized) throw new AuthorizationDeniedError();
  return context;
};
