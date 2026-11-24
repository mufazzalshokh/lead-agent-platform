import type { IdentityDatabaseRuntimeConfig } from "@lead-agent/config";
import {
  OrganizationIdSchema,
  UserIdSchema,
  isSchemaValue,
  type OrganizationId,
  type StaffSignupInput,
  type UserId,
} from "@lead-agent/contracts";
import {
  ExternalIdentityDeniedError,
  ExternalIdentityUnmappedError,
  createSecurityIdentifierFactory,
  type ExternalIdentityResolver,
  type MembershipLifecycleAuditContext,
  type ValidatedOidcIdentity,
} from "@lead-agent/security";
import { Pool, type PoolClient } from "pg";

const REQUIRED_IDENTITY_ROLE = "lead_agent_auth";
const identifiers = createSecurityIdentifierFactory();

export class IdentityResolutionRuntimeClosedError extends Error {
  readonly code = "identity_resolution_runtime_closed" as const;

  constructor() {
    super("Identity resolution runtime is closed");
    this.name = "IdentityResolutionRuntimeClosedError";
  }
}

export class IdentityResolutionRoleError extends Error {
  readonly code = "identity_resolution_role_required" as const;

  constructor() {
    super("Identity resolution requires the configured authentication role");
    this.name = "IdentityResolutionRoleError";
  }
}

export class IdentityResolutionDatabaseError extends Error {
  readonly code = "identity_resolution_database_error" as const;

  constructor() {
    super("Identity resolution database operation failed");
    this.name = "IdentityResolutionDatabaseError";
  }
}

const identityResolutionDatabaseCauses = new WeakMap<IdentityResolutionDatabaseError, unknown>();

export const readIdentityResolutionDatabaseCause = (
  error: IdentityResolutionDatabaseError,
): unknown => identityResolutionDatabaseCauses.get(error);

export type IdentityDatabaseRuntimeObservability = Readonly<{
  onUnexpectedPoolError: (error: Error) => void;
}>;

export type IdentityDatabaseRuntime = ExternalIdentityResolver &
  Readonly<{
    close: () => Promise<void>;
    registerFirstOwner(
      input: Readonly<{
        audit: MembershipLifecycleAuditContext;
        details: StaffSignupInput;
        identity: ValidatedOidcIdentity;
      }>,
    ): Promise<OrganizationId>;
    resolveFirstOwnerWorkspace(identity: ValidatedOidcIdentity): Promise<OrganizationId | null>;
  }>;

type DatabaseRoleRow = {
  database_role: string;
};

type IdentityResolutionRow = {
  resolution_state: string;
  user_id: string | null;
};

const isExpectedResolutionError = (
  error: unknown,
): error is
  | ExternalIdentityDeniedError
  | ExternalIdentityUnmappedError
  | IdentityResolutionRoleError
  | IdentityResolutionRuntimeClosedError =>
  error instanceof ExternalIdentityDeniedError ||
  error instanceof ExternalIdentityUnmappedError ||
  error instanceof IdentityResolutionRoleError ||
  error instanceof IdentityResolutionRuntimeClosedError;

const requireBoundedIdentity = (identity: ValidatedOidcIdentity): void => {
  if (
    identity.issuer.length < 1 ||
    identity.issuer.length > 2048 ||
    identity.subject.length < 1 ||
    identity.subject.length > 512
  ) {
    throw new ExternalIdentityUnmappedError();
  }
};

class IdentityDatabaseRuntimeImplementation implements IdentityDatabaseRuntime {
  readonly #pool: Pool;
  #closed = false;

  constructor(
    configuration: IdentityDatabaseRuntimeConfig,
    observability: IdentityDatabaseRuntimeObservability,
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

  async resolve(identity: ValidatedOidcIdentity): Promise<UserId> {
    requireBoundedIdentity(identity);
    return this.#asAuthRole(async (client) => {
      const result = await client.query<IdentityResolutionRow>(
        "select resolution_state, user_id::text as user_id from app.resolve_external_identity($1::varchar, $2::varchar)",
        [identity.issuer, identity.subject],
      );
      const resolution = result.rows[0];
      if (resolution === undefined) throw new ExternalIdentityUnmappedError();
      if (resolution.resolution_state === "denied" && resolution.user_id === null) {
        throw new ExternalIdentityDeniedError();
      }
      if (
        resolution.resolution_state !== "authenticated" ||
        !isSchemaValue(UserIdSchema, resolution.user_id)
      ) {
        throw new IdentityResolutionDatabaseError();
      }
      return resolution.user_id;
    });
  }

  async registerFirstOwner({
    audit,
    details,
    identity,
  }: Parameters<IdentityDatabaseRuntime["registerFirstOwner"]>[0]): Promise<OrganizationId> {
    requireBoundedIdentity(identity);
    const now = new Date();
    return this.#asAuthRole(async (client) => {
      const result = await client.query<{ organization_id: string | null }>(
        `select app.register_first_owner($1::varchar, $2::varchar, $3::varchar, $4::varchar, $5::varchar,
          $6::uuid, $7::uuid, $8::uuid, $9::uuid, $10::uuid, $11::varchar, $12::uuid) as organization_id`,
        [
          identity.issuer,
          identity.subject,
          details.display_name,
          details.default_locale,
          details.default_time_zone,
          identifiers.issueResourceId(now),
          identifiers.issueUserId(now),
          identifiers.issueResourceId(now),
          identifiers.issueMembershipId(now),
          identifiers.issueResourceId(now),
          audit.requestId,
          audit.correlationId,
        ],
      );
      const organizationId = result.rows[0]?.organization_id;
      if (organizationId === null) throw new ExternalIdentityDeniedError();
      if (!isSchemaValue(OrganizationIdSchema, organizationId)) {
        throw new IdentityResolutionDatabaseError();
      }
      return organizationId;
    });
  }

  async resolveFirstOwnerWorkspace(
    identity: ValidatedOidcIdentity,
  ): Promise<OrganizationId | null> {
    requireBoundedIdentity(identity);
    return this.#asAuthRole(async (client) => {
      const result = await client.query<{ organization_id: string | null }>(
        `select app.register_first_owner($1::varchar, $2::varchar, null, null, null,
          null, null, null, null, null, null, null) as organization_id`,
        [identity.issuer, identity.subject],
      );
      const organizationId = result.rows[0]?.organization_id;
      if (organizationId === null || isSchemaValue(OrganizationIdSchema, organizationId)) {
        return organizationId;
      }
      throw new IdentityResolutionDatabaseError();
    });
  }

  async #asAuthRole<T>(operation: (client: PoolClient) => Promise<T>): Promise<T> {
    if (this.#closed) {
      throw new IdentityResolutionRuntimeClosedError();
    }
    const client = await this.#pool.connect().catch((error: unknown) => {
      const mapped = new IdentityResolutionDatabaseError();
      identityResolutionDatabaseCauses.set(mapped, error);
      throw mapped;
    });
    try {
      const role = await client.query<DatabaseRoleRow>("select current_user as database_role");
      if (role.rows[0]?.database_role !== REQUIRED_IDENTITY_ROLE) {
        throw new IdentityResolutionRoleError();
      }

      return await operation(client);
    } catch (error) {
      if (isExpectedResolutionError(error) || error instanceof IdentityResolutionDatabaseError) {
        throw error;
      }
      const mapped = new IdentityResolutionDatabaseError();
      identityResolutionDatabaseCauses.set(mapped, error);
      throw mapped;
    } finally {
      client.release();
    }
  }
}

export const createIdentityDatabaseRuntime = (
  configuration: IdentityDatabaseRuntimeConfig,
  observability: IdentityDatabaseRuntimeObservability,
): IdentityDatabaseRuntime =>
  new IdentityDatabaseRuntimeImplementation(configuration, observability);
