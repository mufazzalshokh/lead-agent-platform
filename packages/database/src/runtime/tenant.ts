import type { TenantDatabaseRuntimeConfig } from "@lead-agent/config";
import type { OrganizationId } from "@lead-agent/contracts";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from "pg";

import * as schema from "../schema/index.js";
import {
  TenantContextInitializationError,
  TenantContextMismatchError,
  TenantDatabaseRuntimeClosedError,
  TenantRuntimeRoleError,
  TenantSessionClosedError,
  TenantTransactionRollbackError,
} from "./errors.js";

const REQUIRED_RUNTIME_ROLE = "lead_agent_runtime";
const tenantDbSessionBrand: unique symbol = Symbol("TenantDbSession");

type TenantDatabase = NodePgDatabase<typeof schema>;

type TenantSessionState = {
  active: boolean;
  readonly client: PoolClient;
  readonly database: TenantDatabase;
};

const tenantSessionStates = new WeakMap<TenantDbSession, TenantSessionState>();

export type TenantDbSession = Readonly<{
  organizationId: OrganizationId;
  [tenantDbSessionBrand]: true;
}>;

export type TenantTransactionCallback<Result> = (
  session: TenantDbSession,
) => Promise<Result> | Result;

export type TenantDatabaseRuntimeObservability = Readonly<{
  onUnexpectedPoolError: (error: Error) => void;
}>;

export type TenantDatabaseRuntime = Readonly<{
  close: () => Promise<void>;
  withTenantTransaction: <Result>(
    organizationId: OrganizationId,
    callback: TenantTransactionCallback<Result>,
  ) => Promise<Result>;
}>;

type TenantContextInitializationRow = {
  database_role: string;
  inherited_context: string | null;
  organization_id: string | null;
};

const requireActiveSession = (session: TenantDbSession): TenantSessionState => {
  const state = tenantSessionStates.get(session);
  if (state === undefined || !state.active) {
    throw new TenantSessionClosedError();
  }
  return state;
};

const createTenantSession = (
  organizationId: OrganizationId,
  client: PoolClient,
): TenantDbSession => {
  const session = Object.freeze({
    organizationId,
    [tenantDbSessionBrand]: true as const,
  });
  tenantSessionStates.set(session, {
    active: true,
    client,
    database: drizzle(client, { schema }),
  });
  return session;
};

const closeTenantSession = (session: TenantDbSession | undefined): void => {
  if (session === undefined) {
    return;
  }
  const state = tenantSessionStates.get(session);
  if (state !== undefined) {
    state.active = false;
  }
};

const initializeTenantContext = async (
  client: PoolClient,
  organizationId: OrganizationId,
): Promise<void> => {
  const context = await client.query<TenantContextInitializationRow>(
    `with inherited as materialized (
       select nullif(current_setting('app.organization_id', true), '') as inherited_context
     ), configured as materialized (
       select case
         when current_user = $2 and inherited.inherited_context is null
           then set_config('app.organization_id', $1::uuid::text, true)
         else null
       end as organization_id
       from inherited
     )
     select current_user as database_role,
            inherited.inherited_context,
            configured.organization_id
       from inherited
       cross join configured`,
    [organizationId, REQUIRED_RUNTIME_ROLE],
  );
  const initialized = context.rows[0];
  if (initialized?.database_role !== REQUIRED_RUNTIME_ROLE) {
    throw new TenantRuntimeRoleError();
  }
  if (initialized.inherited_context !== null || initialized.organization_id !== organizationId) {
    throw new TenantContextInitializationError();
  }
};

class TenantDatabaseRuntimeImplementation implements TenantDatabaseRuntime {
  readonly #pool: Pool;
  #closed = false;

  constructor(
    configuration: TenantDatabaseRuntimeConfig,
    observability: TenantDatabaseRuntimeObservability,
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

  async withTenantTransaction<Result>(
    organizationId: OrganizationId,
    callback: TenantTransactionCallback<Result>,
  ): Promise<Result> {
    if (this.#closed) {
      throw new TenantDatabaseRuntimeClosedError();
    }

    const client = await this.#pool.connect();
    let releaseError: Error | undefined;
    let transactionOpen = false;
    let session: TenantDbSession | undefined;
    try {
      await client.query("begin");
      transactionOpen = true;
      await initializeTenantContext(client, organizationId);
      session = createTenantSession(organizationId, client);

      let result: Result;
      try {
        result = await callback(session);
      } finally {
        closeTenantSession(session);
      }

      await client.query("commit");
      transactionOpen = false;
      return result;
    } catch (primaryError) {
      closeTenantSession(session);
      if (transactionOpen) {
        try {
          await client.query("rollback");
          transactionOpen = false;
        } catch (rollbackError) {
          releaseError =
            rollbackError instanceof Error
              ? rollbackError
              : new Error("Unknown tenant transaction rollback failure");
          throw new TenantTransactionRollbackError(primaryError, rollbackError);
        }
      }
      throw primaryError;
    } finally {
      client.release(releaseError);
    }
  }
}

export const createTenantDatabaseRuntime = (
  configuration: TenantDatabaseRuntimeConfig,
  observability: TenantDatabaseRuntimeObservability,
): TenantDatabaseRuntime => new TenantDatabaseRuntimeImplementation(configuration, observability);

export const withTenantTransaction = <Result>(
  runtime: TenantDatabaseRuntime,
  organizationId: OrganizationId,
  callback: TenantTransactionCallback<Result>,
): Promise<Result> => runtime.withTenantTransaction(organizationId, callback);

export const withTenantSession = async <Result>(
  session: TenantDbSession,
  organizationId: OrganizationId,
  callback: TenantTransactionCallback<Result>,
): Promise<Result> => {
  requireActiveSession(session);
  if (session.organizationId !== organizationId) {
    throw new TenantContextMismatchError();
  }
  return await callback(session);
};

/**
 * Package-internal repository seam. This module is intentionally not a package
 * export; future repositories receive the Drizzle handle only while the tenant
 * transaction is active.
 */
export const useTenantDatabase = async <Result>(
  session: TenantDbSession,
  operation: (database: TenantDatabase, organizationId: OrganizationId) => Promise<Result>,
): Promise<Result> => {
  const state = requireActiveSession(session);
  return await operation(state.database, session.organizationId);
};

export type TenantParameterizedQuery = Readonly<{
  text: string;
  values?: readonly unknown[];
}>;

/** Test/repository-internal parameterized seam; not exported from the package root. */
export const executeTenantQuery = async <Row extends QueryResultRow>(
  session: TenantDbSession,
  createQuery: (organizationId: OrganizationId) => TenantParameterizedQuery,
): Promise<QueryResult<Row>> => {
  const state = requireActiveSession(session);
  const query = createQuery(session.organizationId);
  return await state.client.query<Row>(query.text, [...(query.values ?? [])]);
};
