import type { IdentityDatabaseRuntimeConfig } from "@lead-agent/config";
import { UserIdSchema, isSchemaValue, type UserId } from "@lead-agent/contracts";
import {
  ExternalIdentityDeniedError,
  ExternalIdentityUnmappedError,
  type ExternalIdentityResolver,
  type ValidatedOidcIdentity,
} from "@lead-agent/security";
import { Pool } from "pg";

const REQUIRED_IDENTITY_ROLE = "lead_agent_auth";

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
    if (this.#closed) {
      throw new IdentityResolutionRuntimeClosedError();
    }
    requireBoundedIdentity(identity);

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

      const result = await client.query<IdentityResolutionRow>(
        "select resolution_state, user_id::text as user_id from app.resolve_external_identity($1::varchar, $2::varchar)",
        [identity.issuer, identity.subject],
      );
      const resolution = result.rows[0];
      if (resolution === undefined) {
        throw new ExternalIdentityUnmappedError();
      }
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
