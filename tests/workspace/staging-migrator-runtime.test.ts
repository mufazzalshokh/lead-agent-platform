import { describe, expect, it, vi } from "vitest";

import { runStagingMigrator, sanitizedMigrationFailure } from "../../apps/migrator/src/runtime.js";

const environment = Object.freeze({
  AUTH_DATABASE_URL:
    "postgresql://lead_agent_auth:auth-password@10.125.0.3:5432/lead_agent_staging?sslmode=require",
  DATABASE_URL:
    "postgresql://lead_agent_runtime:runtime-password@10.125.0.3:5432/lead_agent_staging?sslmode=require",
  DEPLOYMENT_GIT_SHA: "a".repeat(40),
  DEPLOYMENT_IMAGE_DIGEST: `migrator@sha256:${"b".repeat(64)}`,
  DEPLOYMENT_TIMESTAMP: "2026-09-26T00:00:00Z",
  INGRESS_DATABASE_URL:
    "postgresql://lead_agent_ingress:ingress-password@10.125.0.3:5432/lead_agent_staging?sslmode=require",
  MIGRATION_DATABASE_URL:
    "postgresql://postgres:migration-password@10.125.0.3:5432/lead_agent_staging?sslmode=require",
  QUEUE_DATABASE_URL:
    "postgresql://lead_agent_queue_runtime:queue-password@10.125.0.3:5432/lead_agent_staging?sslmode=require",
} satisfies NodeJS.ProcessEnv);

describe("S22 staging migrator diagnostics", () => {
  it("emits a useful sanitized failure and preserves a non-zero result", async () => {
    const writeError = vi.fn<(message: string) => void>();
    const writeInfo = vi.fn<(message: string) => void>();
    const databaseError = Object.assign(
      new Error(
        `migration 0029_s21_thread_automation_controls failed for ${environment.MIGRATION_DATABASE_URL}; password=migration-password; Authorization: Bearer private-token`,
      ),
      { code: "42501" },
    );

    const result = await runStagingMigrator({
      environment,
      loadMigration: () => Promise.resolve(() => Promise.reject(databaseError)),
      writeError,
      writeInfo,
    });

    expect(result).toBe(1);
    expect(writeInfo).not.toHaveBeenCalled();
    expect(writeError).toHaveBeenCalledOnce();
    const serialized = writeError.mock.calls[0]?.[0] ?? "";
    expect(serialized).not.toContain("migration-password");
    expect(serialized).not.toContain("private-token");
    expect(serialized).not.toContain("postgresql://postgres:");
    expect(JSON.parse(serialized)).toMatchObject({
      error_category: "database_permission",
      error_code: "42501",
      error_type: "Error",
      failure_stage: "apply_migrations",
      migration_identifier: "0029_s21_thread_automation_controls",
      operation: "database_migration",
      outcome: "failed",
    });
  });

  it("reports module-loading failures before migration execution", async () => {
    const writeError = vi.fn<(message: string) => void>();

    const result = await runStagingMigrator({
      environment,
      loadMigration: () => Promise.reject(new Error("Cannot find package @lead-agent/database")),
      writeError,
      writeInfo: vi.fn(),
    });

    expect(result).toBe(1);
    expect(JSON.parse(writeError.mock.calls[0]?.[0] ?? "{}")).toMatchObject({
      error_category: "application_startup",
      failure_stage: "load_migrator",
    });
  });

  it("keeps the successful migration result and structured log unchanged", async () => {
    const writeError = vi.fn<(message: string) => void>();
    const writeInfo = vi.fn<(message: string) => void>();

    const result = await runStagingMigrator({
      environment,
      loadMigration: () =>
        Promise.resolve(() =>
          Promise.resolve({
            migrationCount: 30,
            migrationHead: "0029_s21_thread_automation_controls",
          }),
        ),
      writeError,
      writeInfo,
    });

    expect(result).toBe(0);
    expect(writeError).not.toHaveBeenCalled();
    expect(JSON.parse(writeInfo.mock.calls[0]?.[0] ?? "{}")).toEqual({
      deployment_timestamp: "2026-09-26T00:00:00Z",
      environment: "staging",
      git_commit_sha: "a".repeat(40),
      image_digest: `migrator@sha256:${"b".repeat(64)}`,
      migration_count: 30,
      migration_head: "0029_s21_thread_automation_controls",
      operation: "database_migration",
      outcome: "succeeded",
    });
  });

  it("redacts malformed secret values and token-shaped message fields defensively", () => {
    const failure = sanitizedMigrationFailure(
      new Error("token=abc12345 secret: hidden-value password=top-secret"),
      { MIGRATION_DATABASE_URL: "malformed-secret-value" },
      "apply_migrations",
    );

    expect(failure["error_message"]).toBe(
      "token=[REDACTED] secret: [REDACTED] password=[REDACTED]",
    );
    expect(JSON.stringify(failure)).not.toContain("malformed-secret-value");
  });
});
