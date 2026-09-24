import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  readStagingMigrationManifest,
  stagingRolePasswordFromUrl,
} from "../../apps/migrator/src/migrate.js";

const repositoryFile = (path: string): Promise<string> =>
  readFile(resolve(process.cwd(), path), "utf8");

describe("S22 staging infrastructure boundary", () => {
  it("packages the exact current migration chain for the one-shot migrator", async () => {
    const manifest = await readStagingMigrationManifest();
    expect(manifest.entries).toHaveLength(30);
    expect(manifest.entries.at(-1)?.tag).toBe("0029_s21_thread_automation_controls");
    expect(manifest.entries.every((entry, index) => entry.idx === index)).toBe(true);
  });

  it("accepts only the expected database role and never exposes the password in errors", () => {
    expect(
      stagingRolePasswordFromUrl(
        "postgresql://lead_agent_runtime:synthetic%2Fpassword@10.22.0.2/lead_agent_staging",
        "lead_agent_runtime",
      ),
    ).toBe("synthetic/password");
    expect(() =>
      stagingRolePasswordFromUrl(
        "postgresql://wrong_role:do-not-print-me@10.22.0.2/lead_agent_staging",
        "lead_agent_runtime",
      ),
    ).toThrow("Connection string for lead_agent_runtime is invalid");
  });

  it("keeps the Terraform staging foundation private, bounded and in Doha", async () => {
    const [foundation, runtime, variables] = await Promise.all([
      repositoryFile("infra/deploy/gcp/staging/foundation.tf"),
      repositoryFile("infra/deploy/gcp/staging/runtime.tf"),
      repositoryFile("infra/deploy/gcp/staging/variables.tf"),
    ]);
    expect(variables).toContain('default     = "me-central1"');
    expect(foundation).toContain('database_version    = "POSTGRES_17"');
    expect(foundation).toContain("ipv4_enabled");
    expect(foundation).toMatch(/ipv4_enabled\s+= false/u);
    expect(foundation).toContain("point_in_time_recovery_enabled = true");
    expect(foundation).toContain("transaction_log_retention_days = 7");
    expect(runtime).toContain("manual_instance_count = 1");
    expect(runtime).toContain('egress = "PRIVATE_RANGES_ONLY"');
    expect(runtime).not.toContain(":latest");
  });

  it("requires reviewed-plan integrity and GitHub OIDC instead of service-account keys", async () => {
    const [bootstrap, workflow] = await Promise.all([
      repositoryFile("infra/deploy/gcp/bootstrap/main.tf"),
      repositoryFile(".github/workflows/staging-terraform.yml"),
    ]);
    expect(bootstrap).toContain("assertion.repository == '${var.github_repository}'");
    expect(bootstrap).toContain("assertion.ref == 'refs/heads/main'");
    expect(bootstrap).toContain(
      "assertion.ref == 'refs/heads/verify/s22-staging-recovery-capacity'",
    );
    expect(bootstrap).toContain("/.github/workflows/staging-images.yml@");
    expect(bootstrap).toContain("/.github/workflows/staging-terraform.yml@");
    expect(bootstrap).toContain("assertion.environment == 'staging'");
    expect(workflow).toContain("refs/heads/verify/s22-staging-recovery-capacity");
    expect(workflow).toContain("google-github-actions/auth@");
    expect(workflow).toContain("sha256sum --check s22.tfplan.sha256");
    expect(workflow).not.toMatch(/service[_-]account[_-]key/u);
  });

  it("packages non-root digest-pinned OCI targets without local secret material", async () => {
    const [dockerfile, dockerignore] = await Promise.all([
      repositoryFile("Dockerfile"),
      repositoryFile(".dockerignore"),
    ]);
    expect(dockerfile).toMatch(/node:24\.14\.0-bookworm-slim@sha256:[0-9a-f]{64}/u);
    expect(dockerfile.match(/^USER node$/gmu)).toHaveLength(4);
    expect(dockerfile).not.toContain(":latest");
    expect(dockerignore).toContain(".env");
    expect(dockerignore).toContain("*.tfstate");
  });
});
