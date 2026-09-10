import type { IdentityDatabaseRuntimeConfig } from "@lead-agent/config";
import { UserIdSchema, isSchemaValue, type UserId } from "@lead-agent/contracts";
import type {
  ApplicationSessionStore,
  AuthenticatedApplicationSession,
  SessionCreationPersistence,
  SessionCreationPersistenceResult,
  SessionRotationPersistence,
  UserSessionRevocationReason,
} from "@lead-agent/security";
import { Pool, type PoolClient } from "pg";

const REQUIRED_SESSION_ROLE = "lead_agent_auth";
const SESSION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const AUTHENTICATION_LEVEL_PATTERN = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/u;

export class SessionDatabaseRuntimeClosedError extends Error {
  readonly code = "session_database_runtime_closed" as const;

  constructor() {
    super("Session database runtime is closed");
    this.name = "SessionDatabaseRuntimeClosedError";
  }
}

export class SessionDatabaseRoleError extends Error {
  readonly code = "session_database_role_required" as const;

  constructor() {
    super("Session lifecycle requires the configured authentication role");
    this.name = "SessionDatabaseRoleError";
  }
}

export class SessionDatabaseError extends Error {
  readonly code = "session_database_error" as const;

  constructor() {
    super("Session database operation failed");
    this.name = "SessionDatabaseError";
  }
}

const sessionDatabaseCauses = new WeakMap<SessionDatabaseError, unknown>();

export const readSessionDatabaseCause = (error: SessionDatabaseError): unknown =>
  sessionDatabaseCauses.get(error);

export type SessionDatabaseRuntimeObservability = Readonly<{
  onUnexpectedPoolError: (error: Error) => void;
}>;

export type SessionDatabaseRuntime = ApplicationSessionStore &
  Readonly<{
    close: () => Promise<void>;
  }>;

type DatabaseRoleRow = { database_role: string };

type SessionRow = {
  absolute_expires_at: Date;
  authentication_level: string;
  authentication_time: Date;
  created_at: Date;
  idle_expires_at: Date;
  last_seen_at: Date;
  resolution_state: string;
  rotated_at: Date;
  rotation_due: boolean;
  session_id: string;
  user_id: string;
};

type CreatedSessionRow = SessionRow & { evicted_session_count: number };

const isValidDate = (value: unknown): value is Date =>
  value instanceof Date && Number.isFinite(value.getTime());

const mapSession = (row: SessionRow | undefined): AuthenticatedApplicationSession | null => {
  if (row === undefined) {
    return null;
  }
  if (
    row.resolution_state !== "authenticated" ||
    !SESSION_ID_PATTERN.test(row.session_id) ||
    !isSchemaValue(UserIdSchema, row.user_id) ||
    !AUTHENTICATION_LEVEL_PATTERN.test(row.authentication_level) ||
    row.authentication_level.length > 32 ||
    !isValidDate(row.authentication_time) ||
    !isValidDate(row.created_at) ||
    !isValidDate(row.rotated_at) ||
    !isValidDate(row.last_seen_at) ||
    !isValidDate(row.idle_expires_at) ||
    !isValidDate(row.absolute_expires_at) ||
    typeof row.rotation_due !== "boolean"
  ) {
    throw new SessionDatabaseError();
  }
  return Object.freeze({
    absoluteExpiresAt: row.absolute_expires_at,
    authenticationLevel: row.authentication_level,
    authenticationTime: row.authentication_time,
    createdAt: row.created_at,
    idleExpiresAt: row.idle_expires_at,
    lastSeenAt: row.last_seen_at,
    rotatedAt: row.rotated_at,
    rotationDue: row.rotation_due,
    sessionId: row.session_id,
    userId: row.user_id,
  });
};

const isExpectedRuntimeError = (
  error: unknown,
): error is SessionDatabaseError | SessionDatabaseRoleError | SessionDatabaseRuntimeClosedError =>
  error instanceof SessionDatabaseError ||
  error instanceof SessionDatabaseRoleError ||
  error instanceof SessionDatabaseRuntimeClosedError;

class SessionDatabaseRuntimeImplementation implements SessionDatabaseRuntime {
  readonly #pool: Pool;
  #closed = false;

  constructor(
    configuration: IdentityDatabaseRuntimeConfig,
    observability: SessionDatabaseRuntimeObservability,
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

  async #withClient<T>(operation: (client: PoolClient) => Promise<T>): Promise<T> {
    if (this.#closed) {
      throw new SessionDatabaseRuntimeClosedError();
    }
    const client = await this.#pool.connect().catch((error: unknown) => {
      const mapped = new SessionDatabaseError();
      sessionDatabaseCauses.set(mapped, error);
      throw mapped;
    });
    try {
      const role = await client.query<DatabaseRoleRow>("select current_user as database_role");
      if (role.rows[0]?.database_role !== REQUIRED_SESSION_ROLE) {
        throw new SessionDatabaseRoleError();
      }
      return await operation(client);
    } catch (error) {
      if (isExpectedRuntimeError(error)) {
        throw error;
      }
      const mapped = new SessionDatabaseError();
      sessionDatabaseCauses.set(mapped, error);
      throw mapped;
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    if (this.#closed) {
      return;
    }
    this.#closed = true;
    await this.#pool.end();
  }

  createSession(
    input: SessionCreationPersistence,
  ): Promise<SessionCreationPersistenceResult | null> {
    return this.#withClient(async (client) => {
      const result = await client.query<CreatedSessionRow>(
        `select * from app.create_application_session(
          $1::uuid, $2::uuid, $3::bytea, $4::bytea, $5::timestamptz,
          $6::varchar, $7::bytea, $8::bytea
        )`,
        [
          input.sessionId,
          input.userId,
          Buffer.from(input.sessionTokenHash),
          Buffer.from(input.csrfSecretHash),
          input.authenticationTime,
          input.authenticationLevel,
          input.sourceIpHash === undefined ? null : Buffer.from(input.sourceIpHash),
          input.userAgentHash === undefined ? null : Buffer.from(input.userAgentHash),
        ],
      );
      const row = result.rows[0];
      const session = mapSession(row);
      if (
        session === null ||
        row === undefined ||
        !Number.isInteger(row.evicted_session_count) ||
        row.evicted_session_count < 0
      ) {
        return null;
      }
      return Object.freeze({ evictedSessionCount: row.evicted_session_count, session });
    });
  }

  resolveSession(sessionTokenHash: Uint8Array): Promise<AuthenticatedApplicationSession | null> {
    return this.#withClient(async (client) => {
      const result = await client.query<SessionRow>(
        "select * from app.resolve_application_session($1::bytea)",
        [Buffer.from(sessionTokenHash)],
      );
      return mapSession(result.rows[0]);
    });
  }

  revokeSession(sessionTokenHash: Uint8Array): Promise<void> {
    return this.#withClient(async (client) => {
      await client.query("select app.revoke_application_session($1::bytea)", [
        Buffer.from(sessionTokenHash),
      ]);
    });
  }

  revokeUserSessions(userId: UserId, reason: UserSessionRevocationReason): Promise<number> {
    return this.#withClient(async (client) => {
      const result = await client.query<{ revoked_count: number }>(
        "select app.revoke_user_application_sessions($1::uuid, $2::varchar) as revoked_count",
        [userId, reason],
      );
      const revokedCount = result.rows[0]?.revoked_count;
      if (!Number.isInteger(revokedCount) || revokedCount === undefined || revokedCount < 0) {
        throw new SessionDatabaseError();
      }
      return revokedCount;
    });
  }

  rotateSession(
    input: SessionRotationPersistence,
  ): Promise<AuthenticatedApplicationSession | null> {
    return this.#withClient(async (client) => {
      const evidence = input.authenticationEvidence;
      const result = await client.query<SessionRow>(
        `select * from app.rotate_application_session(
          $1::bytea, $2::bytea, $3::bytea, $4::uuid, $5::timestamptz, $6::varchar
        )`,
        [
          Buffer.from(input.currentSessionTokenHash),
          Buffer.from(input.replacementSessionTokenHash),
          Buffer.from(input.csrfSecretHash),
          evidence?.userId ?? null,
          evidence?.authenticationTime ?? null,
          evidence?.authenticationLevel ?? null,
        ],
      );
      return mapSession(result.rows[0]);
    });
  }
}

export const createSessionDatabaseRuntime = (
  configuration: IdentityDatabaseRuntimeConfig,
  observability: SessionDatabaseRuntimeObservability,
): SessionDatabaseRuntime => new SessionDatabaseRuntimeImplementation(configuration, observability);
