import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import {
  STATEFUL_DATABASE_SUITES,
  createDatabaseGatePlan,
  createDatabaseSuiteEnvironment,
  executeDatabaseGatePlan,
  isSafeCurrentRunDatabase,
  ordinaryVitestArguments,
  type DatabaseGateLifecycle,
} from "../../scripts/test/run-database-gate.js";

const RUN_ID = "s87gate1234";
const ADMIN_URL = "postgresql://test-owner:test-password@localhost/codex_admin_test";
const EXPECTED_SUITES = [
  "tests/database/s4a-schema.test.ts",
  "tests/database/s8-pgboss-infrastructure.test.ts",
  "tests/database/s8-outbox-relay.test.ts",
  "tests/database/s8-dispatcher.test.ts",
  "tests/database/s8-handler-reliability.test.ts",
] as const;

describe("database gate orchestration", () => {
  it("keeps the ordinary and stateful database selections exact and disjoint", () => {
    expect(STATEFUL_DATABASE_SUITES.map(({ path: suitePath }) => suitePath)).toEqual(
      EXPECTED_SUITES,
    );
    expect(ordinaryVitestArguments[0]).toBe("run");
    for (const suitePath of EXPECTED_SUITES) {
      expect(ordinaryVitestArguments).toContain(suitePath);
    }
    expect(ordinaryVitestArguments.some((value) => value.endsWith(".test-suite.ts"))).toBe(false);

    const manifest = JSON.parse(readFileSync(path.resolve("package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    expect(manifest.scripts["test:ordinary"]).toBe(
      "tsx scripts/test/run-database-gate.ts ordinary",
    );
    expect(manifest.scripts["test:database"]).toBe(
      "tsx scripts/test/run-database-gate.ts database",
    );
    expect(manifest.scripts["test:run"]).toBe("pnpm test:ordinary && pnpm test:database");
  });

  it("creates exactly five unique guarded test databases for one run", () => {
    const plan = createDatabaseGatePlan(ADMIN_URL, RUN_ID);
    expect(plan.map(({ suitePath }) => suitePath)).toEqual(EXPECTED_SUITES);
    expect(new Set(plan.map(({ databaseName }) => databaseName))).toHaveLength(5);
    for (const entry of plan) {
      expect(entry.databaseName).toContain(`_${RUN_ID}_`);
      expect(entry.databaseName).toMatch(/_test$/u);
      expect(new URL(entry.databaseUrl).pathname).toBe(`/${entry.databaseName}`);
    }
  });

  it("refuses protected, user-supplied, or non-current-run database drops", () => {
    const [entry] = createDatabaseGatePlan(ADMIN_URL, RUN_ID);
    if (entry === undefined) throw new Error("Expected database gate plan entry");
    const created = new Set([entry.databaseName]);
    expect(isSafeCurrentRunDatabase(entry.databaseName, RUN_ID, created)).toBe(true);
    expect(isSafeCurrentRunDatabase("postgres", RUN_ID, created)).toBe(false);
    expect(isSafeCurrentRunDatabase("customer_database", RUN_ID, created)).toBe(false);
    expect(isSafeCurrentRunDatabase(entry.databaseName, "another123", created)).toBe(false);
    expect(isSafeCurrentRunDatabase(entry.databaseName, RUN_ID, new Set())).toBe(false);
    expect(() => createDatabaseGatePlan("postgresql://localhost/postgres", RUN_ID)).toThrow(
      /explicitly named PostgreSQL test database/u,
    );
  });

  it("passes a native TEST_DATABASE_URL to each sequential child and cleans every database", async () => {
    const plan = createDatabaseGatePlan(ADMIN_URL, RUN_ID);
    const calls: string[] = [];
    const environments: NodeJS.ProcessEnv[] = [];
    const lifecycle: DatabaseGateLifecycle = {
      createDatabase: (databaseName) => {
        calls.push(`create:${databaseName}`);
        return Promise.resolve();
      },
      dropDatabase: (databaseName) => {
        calls.push(`drop:${databaseName}`);
        return Promise.resolve();
      },
      runSuite: (suitePath, environment) => {
        calls.push(`run:${suitePath}`);
        environments.push(environment);
        return Promise.resolve(0);
      },
    };

    await executeDatabaseGatePlan(
      plan,
      RUN_ID,
      {
        TEST_DATABASE_ADMIN_URL: ADMIN_URL,
        TEST_DATABASE_URL: "postgresql://localhost/shared_test",
      },
      lifecycle,
    );

    expect(calls.filter((call) => call.startsWith("run:"))).toEqual(
      EXPECTED_SUITES.map((suitePath) => `run:${suitePath}`),
    );
    expect(environments.map((environment) => environment["TEST_DATABASE_URL"])).toEqual(
      plan.map(({ databaseUrl }) => databaseUrl),
    );
    expect(
      environments.every((environment) => environment["TEST_DATABASE_ADMIN_URL"] === undefined),
    ).toBe(true);
    expect(calls.filter((call) => call.startsWith("drop:"))).toHaveLength(5);
  });

  it("fails the gate on a failed child and still drops every database it created", async () => {
    const plan = createDatabaseGatePlan(ADMIN_URL, RUN_ID).slice(0, 2);
    const dropped: string[] = [];
    const lifecycle: DatabaseGateLifecycle = {
      createDatabase: () => Promise.resolve(),
      dropDatabase: (databaseName) => {
        dropped.push(databaseName);
        return Promise.resolve();
      },
      runSuite: vi.fn().mockResolvedValueOnce(0).mockResolvedValueOnce(1),
    };

    await expect(executeDatabaseGatePlan(plan, RUN_ID, {}, lifecycle)).rejects.toThrow(
      `Database gate suite failed: ${EXPECTED_SUITES[1]}`,
    );
    expect(dropped.toSorted()).toEqual(plan.map(({ databaseName }) => databaseName).toSorted());
  });

  it("removes shared/admin routing and contains no process.env Proxy workaround", () => {
    expect(
      createDatabaseSuiteEnvironment(
        { TEST_DATABASE_ADMIN_URL: ADMIN_URL, TEST_DATABASE_URL: "shared" },
        "postgresql://localhost/isolated_test",
      ),
    ).toMatchObject({ TEST_DATABASE_URL: "postgresql://localhost/isolated_test" });
    const source = readFileSync(path.resolve("scripts/test/run-database-gate.ts"), "utf8");
    expect(source).not.toMatch(/new\s+Proxy|process\.env\s*=/u);
  });
});
