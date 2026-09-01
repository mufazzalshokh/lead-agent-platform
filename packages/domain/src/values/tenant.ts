import type { OrganizationId } from "@lead-agent/contracts";

import { tenantScopeViolation, type TenantScopeViolation } from "../foundation/errors.js";
import { failure, success, type Result } from "../foundation/result.js";

/**
 * Enforces aggregate-reference consistency only. Equality is not evidence of
 * authentication, membership, resource visibility, or request authorization.
 */
export const requireSameOrganization = (
  left: OrganizationId,
  right: OrganizationId,
): Result<void, TenantScopeViolation> =>
  left === right ? success(undefined) : failure(tenantScopeViolation());
