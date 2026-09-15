import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import { Client } from "pg";

export const STATEFUL_DATABASE_SUITES = Object.freeze([
  Object.freeze({ databaseKey: "s4a", path: "tests/database/s4a-schema.test.ts" }),
  Object.freeze({
    databaseKey: "s8_pgboss",
    path: "tests/database/s8-pgboss-infrastructure.test.ts",
  }),
  Object.freeze({ databaseKey: "s8_relay", path: "tests/database/s8-outbox-relay.test.ts" }),
  Object.freeze({ databaseKey: "s8_dispatcher", path: "tests/database/s8-dispatcher.test.ts" }),
  Object.freeze({
    databaseKey: "s8_reliability",
    path: "tests/database/s8-handler-reliability.test.ts",
  }),
] as const);

export const ordinaryVitestArguments = Object.freeze([
  "run",
  ...STATEFUL_DATABASE_SUITES.flatMap(({ path: suitePath }) => ["--exclude", suitePath]),
]);

export type DatabaseGatePlanEntry = Readonly<{
  databaseName: string;
  databaseUrl: string;
  suitePath: (typeof STATEFUL_DATABASE_SUITES)[number]["path"];
}>;

export type DatabaseGateLifecycle = Readonly<{
  createDatabase: (databaseName: string) => Promise<void>;
  dropDatabase: (databaseName: string) => Promise<void>;
  runSuite: (suitePath: string, environment: NodeJS.ProcessEnv) => Promise<number>;
}>;

const PROTECTED_DATABASE_NAMES = new Set(["postgres", "template0", "template1"]);
const RUN_ID_PATTERN = /^[a-z0-9]{8,32}$/u;
const GENERATED_DATABASE_NAME_PATTERN =
  /^lead_agent_(?:s4a|s8_pgboss|s8_relay|s8_dispatcher|s8_reliability)_[a-z0-9]{8,32}_test$/u;

const workspaceRoot = process.cwd();
const vitestCliPath = path.resolve(workspaceRoot, "node_modules", "vitest", "vitest.mjs");

const requireAdminUrl = (value: string): URL => {
  const parsed = new URL(value);
  const databaseName = decodeURIComponent(parsed.pathname.slice(1));
  if (
    !["postgres:", "postgresql:"].includes(parsed.protocol) ||
    databaseName.length === 0 ||
    PROTECTED_DATABASE_NAMES.has(databaseName) ||
    !/(^|[_-])test([_-]|$)/iu.test(databaseName)
  ) {
    throw new Error(
      "TEST_DATABASE_ADMIN_URL must identify an explicitly named PostgreSQL test database",
    );
  }
  return parsed;
};

const quoteGeneratedDatabaseName = (databaseName: string): string => {
  if (!GENERATED_DATABASE_NAME_PATTERN.test(databaseName)) {
    throw new Error("Refusing to use an unsafe generated test database name");
  }
  return `"${databaseName}"`;
};

export const createDatabaseGatePlan = (
  adminUrl: string,
  runId: string,
): readonly DatabaseGatePlanEntry[] => {
  if (!RUN_ID_PATTERN.test(runId)) throw new Error("Invalid database-gate run identifier");
  const parsedAdminUrl = requireAdminUrl(adminUrl);
  return Object.freeze(
    STATEFUL_DATABASE_SUITES.map(({ databaseKey, path: suitePath }) => {
      const databaseName = `lead_agent_${databaseKey}_${runId}_test`;
      const databaseUrl = new URL(parsedAdminUrl);
      databaseUrl.pathname = `/${databaseName}`;
      return Object.freeze({ databaseName, databaseUrl: databaseUrl.toString(), suitePath });
    }),
  );
};

export const isSafeCurrentRunDatabase = (
  databaseName: string,
  runId: string,
  createdDatabases: ReadonlySet<string>,
): boolean =>
  !PROTECTED_DATABASE_NAMES.has(databaseName) &&
  RUN_ID_PATTERN.test(runId) &&
  GENERATED_DATABASE_NAME_PATTERN.test(databaseName) &&
  databaseName.includes(`_${runId}_`) &&
  createdDatabases.has(databaseName);

export const createDatabaseSuiteEnvironment = (
  baseEnvironment: NodeJS.ProcessEnv,
  databaseUrl?: string,
): NodeJS.ProcessEnv => {
  const environment = { ...baseEnvironment };
  delete environment["TEST_DATABASE_ADMIN_URL"];
  delete environment["TEST_DATABASE_URL"];
  if (databaseUrl !== undefined) environment["TEST_DATABASE_URL"] = databaseUrl;
  return environment;
};

export const executeDatabaseGatePlan = async (
  plan: readonly DatabaseGatePlanEntry[],
  runId: string,
  baseEnvironment: NodeJS.ProcessEnv,
  lifecycle: DatabaseGateLifecycle,
): Promise<void> => {
  const createdDatabases = new Set<string>();
  let executionFailed = false;
  let executionError: unknown;

  try {
    for (const entry of plan) {
      await lifecycle.createDatabase(entry.databaseName);
      createdDatabases.add(entry.databaseName);
      const exitCode = await lifecycle.runSuite(
        entry.suitePath,
        createDatabaseSuiteEnvironment(baseEnvironment, entry.databaseUrl),
      );
      if (exitCode !== 0) {
        throw new Error(`Database gate suite failed: ${entry.suitePath}`);
      }
    }
  } catch (error) {
    executionFailed = true;
    executionError = error;
  }

  const cleanupErrors: unknown[] = [];
  for (const entry of [...plan].reverse()) {
    if (!createdDatabases.has(entry.databaseName)) continue;
    if (!isSafeCurrentRunDatabase(entry.databaseName, runId, createdDatabases)) {
      cleanupErrors.push(new Error("Refusing to drop a database outside the current gate run"));
      continue;
    }
    try {
      await lifecycle.dropDatabase(entry.databaseName);
    } catch (error) {
      cleanupErrors.push(error);
    }
  }

  if (executionFailed) {
    if (cleanupErrors.length > 0) {
      throw new AggregateError(
        [executionError, ...cleanupErrors],
        "Database gate and cleanup failed",
      );
    }
    throw executionError;
  }
  if (cleanupErrors.length > 0) {
    throw new AggregateError(cleanupErrors, "Database gate cleanup failed");
  }
};

const runVitest = (arguments_: readonly string[], environment: NodeJS.ProcessEnv): number => {
  const result = spawnSync(process.execPath, [vitestCliPath, ...arguments_], {
    cwd: workspaceRoot,
    env: environment,
    stdio: "inherit",
  });
  if (result.error !== undefined) throw result.error;
  return result.status ?? 1;
};

const runOrdinaryTests = (): number => runVitest(ordinaryVitestArguments, process.env);

const runFallbackDatabaseGate = (): number => {
  const environment = createDatabaseSuiteEnvironment(process.env);
  for (const { path: suitePath } of STATEFUL_DATABASE_SUITES) {
    const exitCode = runVitest(["run", suitePath], environment);
    if (exitCode !== 0) return exitCode;
  }
  return 0;
};

const runExternalDatabaseGate = async (adminUrl: string): Promise<void> => {
  const parsedAdminUrl = requireAdminUrl(adminUrl);
  const expectedAdminDatabase = decodeURIComponent(parsedAdminUrl.pathname.slice(1));
  const adminClient = new Client({ connectionString: parsedAdminUrl.toString() });
  await adminClient.connect();
  try {
    await adminClient.query("set statement_timeout = 30000");
    await adminClient.query("set lock_timeout = 10000");
    const proof = await adminClient.query<{
      current_database: string;
      server_version: string;
      server_version_num: string;
    }>(
      `select current_database(),
              current_setting('server_version') as server_version,
              current_setting('server_version_num') as server_version_num`,
    );
    const row = proof.rows[0];
    const versionNumber = Number(row?.server_version_num);
    if (
      row?.current_database !== expectedAdminDatabase ||
      versionNumber < 170_000 ||
      versionNumber >= 180_000
    ) {
      throw new Error("Database gate requires its explicit test admin database on PostgreSQL 17");
    }

    const runId = `${Date.now().toString(36)}${randomUUID().replaceAll("-", "").slice(0, 8)}`;
    const plan = createDatabaseGatePlan(parsedAdminUrl.toString(), runId);
    await executeDatabaseGatePlan(plan, runId, process.env, {
      createDatabase: async (databaseName) => {
        await adminClient.query(`create database ${quoteGeneratedDatabaseName(databaseName)}`);
      },
      dropDatabase: async (databaseName) => {
        await adminClient.query(
          `drop database ${quoteGeneratedDatabaseName(databaseName)} with (force)`,
        );
      },
      runSuite: (suitePath, environment) =>
        Promise.resolve(runVitest(["run", suitePath], environment)),
    });
  } finally {
    await adminClient.end();
  }
};

const main = async (): Promise<number> => {
  const mode = process.argv[2];
  if (mode === "ordinary") return runOrdinaryTests();
  if (mode !== "database") throw new Error("Expected test orchestration mode: ordinary|database");

  const adminUrl = process.env["TEST_DATABASE_ADMIN_URL"]?.trim();
  if (adminUrl === undefined || adminUrl.length === 0) return runFallbackDatabaseGate();
  await runExternalDatabaseGate(adminUrl);
  return 0;
};

const entrypoint = process.argv[1];
if (entrypoint !== undefined && import.meta.url === pathToFileURL(path.resolve(entrypoint)).href) {
  try {
    process.exitCode = await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Database test gate failed");
    process.exitCode = 1;
  }
}
