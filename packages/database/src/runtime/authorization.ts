import type { IdentityDatabaseRuntimeConfig } from "@lead-agent/config";
import {
  LocationIdSchema,
  MembershipIdSchema,
  OrganizationIdSchema,
  UserIdSchema,
  isSchemaValue,
  type LocationId,
  type OrganizationId,
  type UserId,
} from "@lead-agent/contracts";
import {
  isLocationScope,
  isMembershipRole,
  isMembershipStatus,
  type CurrentMembershipAuthorization,
  type CurrentMembershipAuthorizationResolver,
} from "@lead-agent/security";
import { Pool, type QueryResultRow } from "pg";

const REQUIRED_AUTHORIZATION_ROLE = "lead_agent_auth";

export class AuthorizationResolutionRuntimeClosedError extends Error {
  readonly code = "authorization_resolution_runtime_closed" as const;

  constructor() {
    super("Authorization resolution runtime is closed");
    this.name = "AuthorizationResolutionRuntimeClosedError";
  }
}

export class AuthorizationResolutionRoleError extends Error {
  readonly code = "authorization_resolution_role_required" as const;

  constructor() {
    super("Authorization resolution requires the configured authentication role");
    this.name = "AuthorizationResolutionRoleError";
  }
}

export class AuthorizationResolutionDatabaseError extends Error {
  readonly code = "authorization_resolution_database_error" as const;

  constructor() {
    super("Authorization resolution database operation failed");
    this.name = "AuthorizationResolutionDatabaseError";
  }
}

const authorizationResolutionDatabaseCauses = new WeakMap<
  AuthorizationResolutionDatabaseError,
  unknown
>();

export const readAuthorizationResolutionDatabaseCause = (
  error: AuthorizationResolutionDatabaseError,
): unknown => authorizationResolutionDatabaseCauses.get(error);

export type AuthorizationDatabaseRuntimeObservability = Readonly<{
  onUnexpectedPoolError: (error: Error) => void;
}>;

export type AuthorizationDatabaseRuntime = CurrentMembershipAuthorizationResolver &
  Readonly<{
    close: () => Promise<void>;
  }>;

type DatabaseRoleRow = { database_role: string };

type AuthorizationResolutionRow = QueryResultRow & {
  allowed_location_ids: unknown;
  location_scope: unknown;
  membership_id: unknown;
  organization_id: unknown;
  resolution_state: unknown;
  role: unknown;
  status: unknown;
  user_id: unknown;
};

const mapLocationIds = (value: unknown): readonly LocationId[] => {
  if (!Array.isArray(value) || !value.every((item) => isSchemaValue(LocationIdSchema, item))) {
    throw new AuthorizationResolutionDatabaseError();
  }
  if (new Set(value).size !== value.length) {
    throw new AuthorizationResolutionDatabaseError();
  }
  return Object.freeze([...value]);
};

const mapResolution = (
  row: AuthorizationResolutionRow | undefined,
): CurrentMembershipAuthorization | null => {
  if (row === undefined) {
    return null;
  }
  if (
    row.resolution_state !== "authorized" ||
    !isSchemaValue(MembershipIdSchema, row.membership_id) ||
    !isSchemaValue(OrganizationIdSchema, row.organization_id) ||
    !isSchemaValue(UserIdSchema, row.user_id) ||
    !isMembershipRole(row.role) ||
    !isMembershipStatus(row.status) ||
    !isLocationScope(row.location_scope)
  ) {
    throw new AuthorizationResolutionDatabaseError();
  }
  if ((row.role === "owner" || row.role === "admin") && row.location_scope !== "all") {
    throw new AuthorizationResolutionDatabaseError();
  }
  const allowedLocationIds = mapLocationIds(row.allowed_location_ids);
  if (row.location_scope === "all" && allowedLocationIds.length !== 0) {
    throw new AuthorizationResolutionDatabaseError();
  }
  return Object.freeze({
    allowedLocationIds,
    locationScope: row.location_scope,
    membershipId: row.membership_id,
    organizationId: row.organization_id,
    role: row.role,
    status: row.status,
    userId: row.user_id,
  });
};

const isExpectedResolutionError = (
  error: unknown,
): error is
  | AuthorizationResolutionDatabaseError
  | AuthorizationResolutionRoleError
  | AuthorizationResolutionRuntimeClosedError =>
  error instanceof AuthorizationResolutionDatabaseError ||
  error instanceof AuthorizationResolutionRoleError ||
  error instanceof AuthorizationResolutionRuntimeClosedError;

class AuthorizationDatabaseRuntimeImplementation implements AuthorizationDatabaseRuntime {
  readonly #pool: Pool;
  #closed = false;

  constructor(
    configuration: IdentityDatabaseRuntimeConfig,
    observability: AuthorizationDatabaseRuntimeObservability,
  ) {
    this.#pool = new Pool({
      connectionString: configuration.connectionString,
      connectionTimeoutMillis: configuration.connectionTimeoutMilliseconds,
      idleTimeoutMillis: configuration.idleTimeoutMilliseconds,
      max: configuration.maxConnections,
      statement_timeout: configuration.statementTimeoutMilliseconds,
    });
    this.#pool.on("error", observability.onUnexpectedPoolError);
    Object.freeze(this);
  }

  async close(): Promise<void> {
    if (this.#closed) {
      return;
    }
    this.#closed = true;
    await this.#pool.end();
  }

  async resolveCurrentMembership(
    userId: UserId,
    requestedOrganizationId: OrganizationId,
  ): Promise<CurrentMembershipAuthorization | null> {
    if (this.#closed) {
      throw new AuthorizationResolutionRuntimeClosedError();
    }
    const client = await this.#pool.connect().catch((error: unknown) => {
      const mapped = new AuthorizationResolutionDatabaseError();
      authorizationResolutionDatabaseCauses.set(mapped, error);
      throw mapped;
    });
    try {
      const role = await client.query<DatabaseRoleRow>("select current_user as database_role");
      if (role.rows[0]?.database_role !== REQUIRED_AUTHORIZATION_ROLE) {
        throw new AuthorizationResolutionRoleError();
      }
      const result = await client.query<AuthorizationResolutionRow>(
        `select resolution_state, membership_id::text as membership_id,
                organization_id::text as organization_id, user_id::text as user_id,
                status, role, location_scope, allowed_location_ids::text[] as allowed_location_ids
           from app.resolve_membership_authorization($1::uuid, $2::uuid)`,
        [userId, requestedOrganizationId],
      );
      if (result.rows.length > 1) {
        throw new AuthorizationResolutionDatabaseError();
      }
      return mapResolution(result.rows[0]);
    } catch (error) {
      if (isExpectedResolutionError(error)) {
        throw error;
      }
      const mapped = new AuthorizationResolutionDatabaseError();
      authorizationResolutionDatabaseCauses.set(mapped, error);
      throw mapped;
    } finally {
      client.release();
    }
  }
}

export const createAuthorizationDatabaseRuntime = (
  configuration: IdentityDatabaseRuntimeConfig,
  observability: AuthorizationDatabaseRuntimeObservability,
): AuthorizationDatabaseRuntime =>
  new AuthorizationDatabaseRuntimeImplementation(configuration, observability);
