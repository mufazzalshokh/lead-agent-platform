import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

import {
  ConfigurationValidationError,
  createQueueDatabaseRuntimeConfig,
  loadQueueDatabaseRuntimeConfig,
  QUEUE_DATABASE_URL_ENVIRONMENT_KEY,
} from "../../packages/config/src/index.js";
import {
  PG_BOSS_CONSTRUCTION_PLAN_SHA256,
  PG_BOSS_PACKAGE_VERSION,
  PG_BOSS_SCHEMA,
  PG_BOSS_SCHEMA_VERSION,
  QUEUE_NAMES,
} from "../../apps/worker/src/queue-infrastructure.js";

const workerRequire = createRequire(new URL("../../apps/worker/package.json", import.meta.url));

const isConstructionPlanFactory = (candidate: unknown): candidate is (schema: string) => unknown =>
  typeof candidate === "function";

const loadConstructionPlan = async (): Promise<string> => {
  const moduleValue: unknown = await import(
    pathToFileURL(workerRequire.resolve("pg-boss")).toString()
  );
  if (typeof moduleValue !== "object" || moduleValue === null) {
    throw new Error("pg-boss module has an invalid shape");
  }
  const planFactory =
    "getConstructionPlans" in moduleValue ? moduleValue.getConstructionPlans : undefined;
  if (!isConstructionPlanFactory(planFactory)) {
    throw new Error("pg-boss does not expose getConstructionPlans");
  }
  const plan = planFactory(PG_BOSS_SCHEMA);
  if (typeof plan !== "string") {
    throw new Error("pg-boss construction plan is not SQL text");
  }
  return plan;
};

describe("S8.1 queue infrastructure configuration", () => {
  it("loads one queue-specific database credential without a default", () => {
    const connectionString =
      "postgresql://lead_agent_queue_runtime:synthetic-test-only@127.0.0.1:5432/queue_test";
    const configuration = loadQueueDatabaseRuntimeConfig({
      [QUEUE_DATABASE_URL_ENVIRONMENT_KEY]: connectionString,
    });

    expect(configuration).toMatchObject({
      connectionString,
      connectionTimeoutMilliseconds: 10_000,
      maxConnections: 4,
    });
    expect(Object.isFrozen(configuration)).toBe(true);
  });

  it("fails safely when the queue database credential is missing or invalid", () => {
    for (const environment of [
      {},
      { [QUEUE_DATABASE_URL_ENVIRONMENT_KEY]: "not-a-database-url" },
    ]) {
      let error: unknown;
      try {
        loadQueueDatabaseRuntimeConfig(environment);
      } catch (caught) {
        error = caught;
      }
      expect(error).toBeInstanceOf(ConfigurationValidationError);
      expect(error).toMatchObject({
        code: "configuration_invalid",
        key: QUEUE_DATABASE_URL_ENVIRONMENT_KEY,
        message: `Invalid configuration: ${QUEUE_DATABASE_URL_ENVIRONMENT_KEY}`,
      });
      expect(String(error)).not.toContain("not-a-database-url");
    }
  });

  it("rejects unsafe queue pool settings", () => {
    const connectionString =
      "postgresql://lead_agent_queue_runtime:synthetic-test-only@127.0.0.1:5432/queue_test";

    expect(() =>
      createQueueDatabaseRuntimeConfig({ connectionString, maxConnections: 0 }),
    ).toThrowError(ConfigurationValidationError);
    expect(() =>
      createQueueDatabaseRuntimeConfig({
        connectionString,
        connectionTimeoutMilliseconds: 120_001,
      }),
    ).toThrowError(ConfigurationValidationError);
  });

  it("pins the package, schema version, reviewed SQL plan, and finite queues", async () => {
    const packageMetadataText = await readFile(
      workerRequire.resolve("pg-boss/package.json"),
      "utf8",
    );
    const packageMetadata: unknown = JSON.parse(packageMetadataText);
    expect(packageMetadata).toMatchObject({
      engines: { node: ">=22.12.0" },
      pgboss: { schema: PG_BOSS_SCHEMA_VERSION },
      version: PG_BOSS_PACKAGE_VERSION,
    });

    const plan = await loadConstructionPlan();
    expect(createHash("sha256").update(plan).digest("hex")).toBe(PG_BOSS_CONSTRUCTION_PLAN_SHA256);
    expect(plan).toContain("CREATE SCHEMA IF NOT EXISTS pgboss");
    expect(plan).toContain("INSERT INTO pgboss.version(version) VALUES ('41')");
    expect(plan).toContain("pg_advisory_xact_lock");
    expect(plan).not.toMatch(/CREATE\s+EXTENSION/iu);
    expect(QUEUE_NAMES).toEqual([
      "inbound",
      "ai",
      "outbound_message",
      "staff_notification",
      "analytics",
      "maintenance",
    ]);
    expect(Object.isFrozen(QUEUE_NAMES)).toBe(true);
  });
});
