import type { OrganizationId } from "../../packages/contracts/src/index.js";
import {
  ConfigurationValidationError,
  createTenantDatabaseRuntimeConfig,
} from "../../packages/config/src/index.js";
import * as databasePackage from "../../packages/database/src/index.js";
import {
  TenantContextMismatchError,
  TenantRuntimeRoleError,
  TenantSessionClosedError,
  classifyPostgreSqlError,
  createTenantDatabaseRuntime,
  withTenantSession,
  withTenantTransaction,
  type TenantDatabaseRuntime,
  type TenantDbSession,
} from "../../packages/database/src/index.js";
import { executeTenantQuery } from "../../packages/database/src/runtime/tenant.js";
import { Pool, type QueryResultRow } from "pg";
import { describe, expect, it } from "vitest";

const LOCATION_A = "0193f1a8-7f65-7c28-a434-a10796c45101";
const LOCATION_B = "0193f1a8-7f65-7c28-a434-a10796c45102";

const syntheticUuid = (suffix: number): string =>
  `0193f1a8-7f65-7c28-a434-${suffix.toString(16).padStart(12, "0")}`;

type TenantSessionTestHarness = Readonly<{
  organizationA: OrganizationId;
  organizationB: OrganizationId;
  privilegedConnectionString: () => string;
  privilegedPool: () => Pool;
  runtime: () => TenantDatabaseRuntime;
  runtimeConnectionString: () => string;
}>;

const insertTenantFixtures = async (harness: TenantSessionTestHarness): Promise<void> => {
  await harness.privilegedPool().query(
    `insert into organizations
      (id, slug, display_name, status, default_locale, default_time_zone)
     values
      ($1, 's53-tenant-a', 'S5.3 Tenant A', 'active', 'en', 'Asia/Tashkent'),
      ($2, 's53-tenant-b', 'S5.3 Tenant B', 'active', 'en', 'Asia/Tashkent')`,
    [harness.organizationA, harness.organizationB],
  );
  await harness.privilegedPool().query(
    `insert into locations (id, organization_id, code, status)
     values
      ($1, $2, 's53-a', 'active'),
      ($3, $4, 's53-b', 'active')`,
    [LOCATION_A, harness.organizationA, LOCATION_B, harness.organizationB],
  );
};

const queryRows = async <Row extends QueryResultRow>(
  session: TenantDbSession,
  text: string,
  values: readonly unknown[] = [],
): Promise<Row[]> =>
  (
    await executeTenantQuery<Row>(session, () => ({
      text,
      values,
    }))
  ).rows;

export const registerTenantSessionTests = (harness: TenantSessionTestHarness): void => {
  describe("S5.3 tenant transaction runtime", () => {
    it("validates runtime configuration without exposing connection values", () => {
      const configuration = createTenantDatabaseRuntimeConfig({
        connectionString: harness.runtimeConnectionString(),
        maxConnections: 1,
      });
      expect(Object.isFrozen(configuration)).toBe(true);
      expect(configuration.maxConnections).toBe(1);

      let validationError: unknown;
      try {
        createTenantDatabaseRuntimeConfig({ connectionString: "not-a-database-url" });
      } catch (error) {
        validationError = error;
      }
      expect(validationError).toBeInstanceOf(ConfigurationValidationError);
      expect(validationError).toMatchObject({
        code: "configuration_invalid",
        key: "connectionString",
        message: "Invalid configuration: connectionString",
      });
      expect(String(validationError)).not.toContain("password");
    });

    it("keeps the raw tenant runtime pool and database handle outside public exports", async () => {
      expect("executeTenantQuery" in databasePackage).toBe(false);
      expect("useTenantDatabase" in databasePackage).toBe(false);
      expect("Pool" in databasePackage).toBe(false);
      expect("drizzle" in databasePackage).toBe(false);
      expect("pool" in harness.runtime()).toBe(false);
      expect("client" in harness.runtime()).toBe(false);
      expect("database" in harness.runtime()).toBe(false);

      await insertTenantFixtures(harness);
      await withTenantTransaction(harness.runtime(), harness.organizationA, (session) => {
        expect(Object.keys(session)).toEqual(["organizationId"]);
        expect(Object.isFrozen(session)).toBe(true);
      });
    });

    it("binds Tenant A and Tenant B symmetrically before broad or qualified queries", async () => {
      await insertTenantFixtures(harness);

      const verifyTenant = async (
        organizationId: OrganizationId,
        expectedLocationId: string,
      ): Promise<void> => {
        await withTenantTransaction(harness.runtime(), organizationId, async (session) => {
          expect(session.organizationId).toBe(organizationId);
          const helper = await queryRows<{ organization_id: string }>(
            session,
            "select app.current_organization_id()::text as organization_id",
          );
          expect(helper).toEqual([{ organization_id: organizationId }]);

          const broadRows = await queryRows<{ id: string }>(
            session,
            "select id::text as id from locations order by id",
          );
          expect(broadRows).toEqual([{ id: expectedLocationId }]);

          const qualifiedRows = await executeTenantQuery<{ id: string }>(
            session,
            (boundOrganizationId) => ({
              text: `select id::text as id
                       from locations
                      where organization_id = $1
                      order by id`,
              values: [boundOrganizationId],
            }),
          );
          expect(qualifiedRows.rows).toEqual([{ id: expectedLocationId }]);
        });
      };

      await verifyTenant(harness.organizationA, LOCATION_A);
      await verifyTenant(harness.organizationB, LOCATION_B);
    });

    it("preserves missing-context fail-closed behavior on a raw runtime-role connection", async () => {
      await insertTenantFixtures(harness);
      const unexpectedErrors: Error[] = [];
      const rawRuntimePool = new Pool({
        connectionString: harness.runtimeConnectionString(),
        max: 1,
      });
      rawRuntimePool.on("error", (error) => unexpectedErrors.push(error));
      try {
        expect((await rawRuntimePool.query("select id from locations")).rows).toEqual([]);
        await expect(
          rawRuntimePool.query(
            `insert into locations (id, organization_id, code, status)
             values ($1, $2, 'raw-context', 'active')`,
            [syntheticUuid(0x1510), harness.organizationA],
          ),
        ).rejects.toMatchObject({ code: "42501" });
      } finally {
        await rawRuntimePool.end();
      }
      expect(unexpectedErrors).toEqual([]);
    });

    it("commits success, closes escaped sessions, and safely reuses its one-connection pool", async () => {
      await insertTenantFixtures(harness);
      let escapedSession: TenantDbSession | undefined;
      const committedLocationId = syntheticUuid(0x1511);

      await withTenantTransaction(harness.runtime(), harness.organizationA, async (session) => {
        escapedSession = session;
        await executeTenantQuery(session, (organizationId) => ({
          text: `insert into locations (id, organization_id, code, status)
                 values ($1, $2, 'committed-a', 'active')`,
          values: [committedLocationId, organizationId],
        }));
      });
      expect(
        (
          await harness
            .privilegedPool()
            .query<{ count: number }>(
              "select count(*)::integer as count from locations where id = $1",
              [committedLocationId],
            )
        ).rows[0]?.count,
      ).toBe(1);

      if (escapedSession === undefined) {
        throw new Error("Expected the transaction callback to expose its scoped session");
      }
      await expect(queryRows(escapedSession, "select id from locations")).rejects.toBeInstanceOf(
        TenantSessionClosedError,
      );
      await expect(
        withTenantSession(escapedSession, harness.organizationA, () => undefined),
      ).rejects.toBeInstanceOf(TenantSessionClosedError);

      await withTenantTransaction(harness.runtime(), harness.organizationB, async (session) => {
        expect(
          await queryRows<{ id: string }>(
            session,
            "select id::text as id from locations order by id",
          ),
        ).toEqual([{ id: LOCATION_B }]);
      });
    });

    it("rolls back callback failures, preserves the primary error, and safely reuses the pool", async () => {
      await insertTenantFixtures(harness);
      const primaryError = new Error("synthetic application failure");
      const rolledBackLocationId = syntheticUuid(0x1512);
      let escapedSession: TenantDbSession | undefined;

      await expect(
        withTenantTransaction(harness.runtime(), harness.organizationA, async (session) => {
          escapedSession = session;
          await executeTenantQuery(session, (organizationId) => ({
            text: `insert into locations (id, organization_id, code, status)
                   values ($1, $2, 'rolled-back-a', 'active')`,
            values: [rolledBackLocationId, organizationId],
          }));
          throw primaryError;
        }),
      ).rejects.toBe(primaryError);
      expect(
        (
          await harness
            .privilegedPool()
            .query<{ count: number }>(
              "select count(*)::integer as count from locations where id = $1",
              [rolledBackLocationId],
            )
        ).rows[0]?.count,
      ).toBe(0);

      if (escapedSession === undefined) {
        throw new Error("Expected the failing callback to expose its scoped session");
      }
      await expect(queryRows(escapedSession, "select id from locations")).rejects.toBeInstanceOf(
        TenantSessionClosedError,
      );

      await withTenantTransaction(harness.runtime(), harness.organizationB, async (session) => {
        expect(
          await queryRows<{ organization_id: string }>(
            session,
            "select app.current_organization_id()::text as organization_id",
          ),
        ).toEqual([{ organization_id: harness.organizationB }]);
      });
    });

    it("reuses the exact same session for same-tenant nesting and shares outer rollback", async () => {
      await insertTenantFixtures(harness);
      const nestedLocationId = syntheticUuid(0x1513);
      const outerFailure = new Error("synthetic outer failure");

      await expect(
        withTenantTransaction(harness.runtime(), harness.organizationA, async (outerSession) => {
          await withTenantSession(outerSession, harness.organizationA, async (nestedSession) => {
            expect(nestedSession).toBe(outerSession);
            await executeTenantQuery(nestedSession, (organizationId) => ({
              text: `insert into locations (id, organization_id, code, status)
                       values ($1, $2, 'nested-a', 'active')`,
              values: [nestedLocationId, organizationId],
            }));
          });
          throw outerFailure;
        }),
      ).rejects.toBe(outerFailure);

      expect(
        (
          await harness
            .privilegedPool()
            .query<{ count: number }>(
              "select count(*)::integer as count from locations where id = $1",
              [nestedLocationId],
            )
        ).rows[0]?.count,
      ).toBe(0);
    });

    it("rejects a nested tenant switch before its callback or tenant SQL can run", async () => {
      await insertTenantFixtures(harness);
      const committedLocationId = syntheticUuid(0x1514);
      let conflictingCallbackRan = false;

      await withTenantTransaction(harness.runtime(), harness.organizationA, async (session) => {
        let mismatch: unknown;
        try {
          await withTenantSession(session, harness.organizationB, () => {
            conflictingCallbackRan = true;
          });
        } catch (error) {
          mismatch = error;
        }
        expect(mismatch).toBeInstanceOf(TenantContextMismatchError);
        expect(mismatch).toMatchObject({ code: "tenant_context_mismatch" });
        expect(String(mismatch)).not.toContain(harness.organizationA);
        expect(String(mismatch)).not.toContain(harness.organizationB);
        expect(conflictingCallbackRan).toBe(false);
        expect(
          await queryRows<{ organization_id: string }>(
            session,
            "select app.current_organization_id()::text as organization_id",
          ),
        ).toEqual([{ organization_id: harness.organizationA }]);
        await executeTenantQuery(session, (organizationId) => ({
          text: `insert into locations (id, organization_id, code, status)
                 values ($1, $2, 'after-mismatch-a', 'active')`,
          values: [committedLocationId, organizationId],
        }));
      });

      expect(
        (
          await harness
            .privilegedPool()
            .query("select organization_id::text from locations where id = $1", [
              committedLocationId,
            ])
        ).rows,
      ).toEqual([{ organization_id: harness.organizationA }]);
    });

    it("rolls back all earlier writes when a later statement fails", async () => {
      await insertTenantFixtures(harness);
      const firstLocationId = syntheticUuid(0x1515);
      const secondLocationId = syntheticUuid(0x1516);
      let databaseFailure: unknown;

      try {
        await withTenantTransaction(harness.runtime(), harness.organizationA, async (session) => {
          for (const [id, code] of [
            [firstLocationId, "atomic-a-1"],
            [secondLocationId, "atomic-a-2"],
          ] as const) {
            await executeTenantQuery(session, (organizationId) => ({
              text: `insert into locations (id, organization_id, code, status)
                     values ($1, $2, $3, 'active')`,
              values: [id, organizationId, code],
            }));
          }
          await executeTenantQuery(session, (organizationId) => ({
            text: `insert into locations (id, organization_id, code, status)
                   values ($1, $2, 'atomic-invalid', 'unknown')`,
            values: [syntheticUuid(0x1517), organizationId],
          }));
        });
      } catch (error) {
        databaseFailure = error;
      }
      expect(databaseFailure).toMatchObject({ code: "23514" });
      expect(classifyPostgreSqlError(databaseFailure)).toEqual({
        code: "integrity_conflict",
        violation: "check",
      });
      expect(
        (
          await harness
            .privilegedPool()
            .query<{ count: number }>(
              "select count(*)::integer as count from locations where id = any($1::uuid[])",
              [[firstLocationId, secondLocationId]],
            )
        ).rows[0]?.count,
      ).toBe(0);
    });

    it("classifies only narrow PostgreSQL failures without exposing raw messages", () => {
      expect(
        classifyPostgreSqlError({
          code: "23505",
          constraint: "leads_one_active_per_contact_unique",
          detail: "sensitive raw detail",
        }),
      ).toEqual({ code: "active_record_conflict", resource: "lead" });
      expect(
        classifyPostgreSqlError({
          code: "23505",
          constraint: "conversations_one_active_per_thread_unique",
        }),
      ).toEqual({ code: "active_record_conflict", resource: "conversation" });
      expect(classifyPostgreSqlError({ code: "23503" })).toEqual({
        code: "integrity_conflict",
        violation: "foreign_key",
      });
      expect(classifyPostgreSqlError({ code: "40001" })).toEqual({
        code: "transaction_conflict",
        reason: "serialization_failure",
      });
      expect(classifyPostgreSqlError({ code: "40P01" })).toEqual({
        code: "transaction_conflict",
        reason: "deadlock",
      });
      expect(classifyPostgreSqlError({ code: "XX000", message: "raw internal error" })).toEqual({
        code: "unclassified_database_error",
      });
    });

    it("rejects migration-owner connections at the tenant runtime boundary", async () => {
      const ownerRuntime = createTenantDatabaseRuntime(
        createTenantDatabaseRuntimeConfig({
          connectionString: harness.privilegedConnectionString(),
          maxConnections: 1,
        }),
        { onUnexpectedPoolError: () => undefined },
      );
      let callbackRan = false;
      try {
        await expect(
          withTenantTransaction(ownerRuntime, harness.organizationA, () => {
            callbackRan = true;
          }),
        ).rejects.toBeInstanceOf(TenantRuntimeRoleError);
        expect(callbackRan).toBe(false);
      } finally {
        await ownerRuntime.close();
      }
    });
  });
};
