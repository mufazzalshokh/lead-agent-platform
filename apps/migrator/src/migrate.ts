import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { migrationsFolder, runMigrations } from "@lead-agent/database";
import { Pool, type PoolClient } from "pg";

const ADVISORY_LOCK_ID = "721773420220029";
const ROLE_URLS = Object.freeze({
  AUTH_DATABASE_URL: "lead_agent_auth",
  DATABASE_URL: "lead_agent_runtime",
  INGRESS_DATABASE_URL: "lead_agent_ingress",
  QUEUE_DATABASE_URL: "lead_agent_queue_runtime",
} as const);

export type StagingMigrationManifest = Readonly<{
  entries: readonly Readonly<{ idx: number; tag: string; when: number }>[];
}>;

const required = (environment: NodeJS.ProcessEnv, key: string): string => {
  const value = environment[key];
  if (value === undefined || value.length === 0 || value !== value.trim()) {
    throw new TypeError(`${key} is required`);
  }
  return value;
};

export const readStagingMigrationManifest = async (): Promise<StagingMigrationManifest> => {
  const raw: unknown = JSON.parse(
    await readFile(join(migrationsFolder, "meta", "_journal.json"), "utf8"),
  );
  if (typeof raw !== "object" || raw === null) throw new Error("Invalid migration journal");
  const entries: unknown = "entries" in raw ? raw.entries : undefined;
  if (!Array.isArray(entries) || entries.length === 0) throw new Error("Invalid migration journal");
  const parsed = entries.map((entry: unknown) => {
    if (typeof entry !== "object" || entry === null) throw new Error("Invalid migration journal");
    const idx: unknown = "idx" in entry ? entry.idx : undefined;
    const tag: unknown = "tag" in entry ? entry.tag : undefined;
    const when: unknown = "when" in entry ? entry.when : undefined;
    if (
      !Number.isSafeInteger(idx) ||
      typeof tag !== "string" ||
      !/^[0-9]{4}_[a-z0-9_]+$/u.test(tag) ||
      !Number.isSafeInteger(when)
    ) {
      throw new Error("Invalid migration journal");
    }
    return Object.freeze({ idx: idx as number, tag, when: when as number });
  });
  for (const [index, entry] of parsed.entries()) {
    const previous = parsed[index - 1];
    if (entry.idx !== index || (previous !== undefined && entry.when <= previous.when)) {
      throw new Error("Migration journal ordering is invalid");
    }
  }
  return Object.freeze({ entries: Object.freeze(parsed) });
};

export const stagingRolePasswordFromUrl = (
  connectionString: string,
  expectedRole: string,
): string => {
  const parsed = new URL(connectionString);
  if (
    !["postgres:", "postgresql:"].includes(parsed.protocol) ||
    decodeURIComponent(parsed.username) !== expectedRole ||
    parsed.password.length === 0
  ) {
    throw new TypeError(`Connection string for ${expectedRole} is invalid`);
  }
  return decodeURIComponent(parsed.password);
};

const setRolePassword = async (
  client: PoolClient,
  role: string,
  password: string,
): Promise<void> => {
  const generated = await client.query<{ statement: string }>({
    text: "select format('alter role %I password %L', $1::text, $2::text) as statement",
    values: [role, password],
  });
  const statement = generated.rows[0]?.statement;
  if (statement === undefined) throw new Error("Unable to generate role credential statement");
  await client.query(statement);
};

export const migrateStagingDatabase = async (
  environment: NodeJS.ProcessEnv,
): Promise<Readonly<{ migrationCount: number; migrationHead: string }>> => {
  const journal = await readStagingMigrationManifest();
  const migrationHead = journal.entries.at(-1)?.tag;
  if (migrationHead === undefined) throw new Error("Migration head is unavailable");
  const pool = new Pool({
    application_name: "lead-agent-staging-migrator",
    connectionString: required(environment, "MIGRATION_DATABASE_URL"),
    max: 2,
  });
  const lock = await pool.connect();
  try {
    await lock.query("select pg_advisory_lock($1::bigint)", [ADVISORY_LOCK_ID]);
    await runMigrations(pool);
    await lock.query("begin");
    try {
      for (const [key, role] of Object.entries(ROLE_URLS)) {
        await setRolePassword(
          lock,
          role,
          stagingRolePasswordFromUrl(required(environment, key), role),
        );
      }
      await lock.query("commit");
    } catch (error) {
      await lock.query("rollback");
      throw error;
    }
    const applied = await lock.query<{ count: number }>({
      text: "select count(*)::integer as count from drizzle.__drizzle_migrations",
    });
    const migrationCount = applied.rows[0]?.count;
    if (migrationCount !== journal.entries.length) {
      throw new Error("Applied migration count does not match the packaged journal");
    }
    return Object.freeze({ migrationCount, migrationHead });
  } finally {
    await lock.query("select pg_advisory_unlock($1::bigint)", [ADVISORY_LOCK_ID]).catch(() => {});
    lock.release();
    await pool.end();
  }
};
