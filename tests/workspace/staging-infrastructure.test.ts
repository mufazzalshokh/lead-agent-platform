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
    const [foundation, monitoring, runtime, variables, workflow] = await Promise.all([
      repositoryFile("infra/deploy/gcp/staging/foundation.tf"),
      repositoryFile("infra/deploy/gcp/staging/monitoring.tf"),
      repositoryFile("infra/deploy/gcp/staging/runtime.tf"),
      repositoryFile("infra/deploy/gcp/staging/variables.tf"),
      repositoryFile(".github/workflows/staging-terraform.yml"),
    ]);
    expect(variables).toContain('default     = "me-central1"');
    expect(variables).toContain('default     = "db-f1-micro"');
    expect(variables).toContain('default     = "NEVER"');
    expect(variables).toMatch(/variable "worker_instance_count"[\s\S]*?default\s+= 0/u);
    expect(foundation).toContain('database_version    = "POSTGRES_17"');
    expect(foundation).toContain("tier                        = var.cloud_sql_tier");
    expect(foundation).toContain("activation_policy           = var.cloud_sql_activation_policy");
    expect(foundation).toMatch(/disk_size\s+= 10/u);
    expect(foundation).toContain("ipv4_enabled");
    expect(foundation).toMatch(/ipv4_enabled\s+= false/u);
    expect(foundation).toContain("point_in_time_recovery_enabled = true");
    expect(foundation).toContain("transaction_log_retention_days = 7");
    expect(runtime).toContain("manual_instance_count = var.worker_instance_count");
    expect(runtime).toContain('egress = "PRIVATE_RANGES_ONLY"');
    expect(runtime).not.toContain(":latest");
    expect(monitoring).toContain('display_name    = "Lead Agent S22 staging USD 25 target"');
    expect(monitoring).toContain('display_name    = "Lead Agent S22 staging USD 50 hard ceiling"');
    expect(workflow).toContain("SQL_TIER=db-custom-1-3840");
    expect(workflow).toContain("WORKER_COUNT=0");
    expect(workflow).toContain("WORKER_COUNT=1");
    expect(workflow).toContain("dormant)");
  });

  it("requires reviewed-plan integrity and GitHub OIDC instead of service-account keys", async () => {
    const [bootstrap, runtimeIam, workflow] = await Promise.all([
      repositoryFile("infra/deploy/gcp/bootstrap/main.tf"),
      repositoryFile("infra/deploy/gcp/staging/secrets-and-iam.tf"),
      repositoryFile(".github/workflows/staging-terraform.yml"),
    ]);
    const bootstrapVersions = await repositoryFile("infra/deploy/gcp/bootstrap/versions.tf");
    expect(bootstrapVersions).toContain('backend "gcs"');
    expect(bootstrapVersions).toContain('prefix = "lead-agent-platform/bootstrap"');
    expect(bootstrap).toContain("assertion.repository == '${var.github_repository}'");
    expect(bootstrap).toContain("assertion.ref == 'refs/heads/main'");
    expect(bootstrap).toContain(
      "assertion.ref == 'refs/heads/verify/s22-staging-recovery-capacity'",
    );
    expect(bootstrap).toContain("/.github/workflows/staging-images.yml@");
    expect(bootstrap).toContain("/.github/workflows/staging-terraform.yml@");
    expect(bootstrap).toContain("assertion.environment == 'staging'");
    expect(bootstrap).toContain('"cloudbilling.googleapis.com"');
    expect(bootstrap).toContain('"cloudresourcemanager.googleapis.com"');
    expect(bootstrap).toContain('"storage.googleapis.com"');
    expect(bootstrap).toContain('"roles/monitoring.alertPolicyEditor"');
    expect(bootstrap).toContain('"roles/monitoring.notificationChannelViewer"');
    expect(bootstrap).toContain('"roles/servicenetworking.networksAdmin"');
    expect(bootstrap).toContain('"roles/serviceusage.serviceUsageConsumer"');
    expect(bootstrap).not.toContain('"roles/iam.serviceAccountUser"');
    expect(bootstrap).not.toContain('"roles/logging.configWriter"');
    expect(bootstrap).not.toContain('"roles/monitoring.admin"');
    expect(bootstrap).not.toContain('"roles/serviceusage.serviceUsageAdmin"');
    expect(runtimeIam).toContain('resource "google_service_account_iam_member" "deployer_act_as"');
    expect(runtimeIam).toContain('role               = "roles/iam.serviceAccountUser"');
    expect(runtimeIam).toContain(
      'member             = "serviceAccount:${var.deployer_service_account_email}"',
    );
    expect(workflow).toContain("refs/heads/verify/s22-staging-recovery-capacity");
    expect(workflow).not.toMatch(/^  push:/mu);
    expect(workflow).toContain("S22_ACTION: ${{ inputs.action }}");
    expect(workflow).toContain("S22_PHASE: ${{ inputs.phase }}");
    expect(workflow).toContain("approved_plan_sha256:");
    expect(workflow).toContain("working-directory: infra/deploy/gcp/bootstrap");
    expect(workflow).toContain('[[ "$BOOTSTRAP_STATE_COUNT" == "34" ]]');
    expect(workflow).toContain("-target=google_project_iam_member.deployer");
    expect(workflow).toContain("-out=s22-bootstrap-iam.tfplan");
    expect(workflow).toContain("sha256sum s22-bootstrap-iam.tfplan");
    expect(workflow).toContain(
      '[[ "$REQUESTED_SHA" == "87216fcd8d2047e292c398a459e49e40c4ff2b9a" ]]',
    );
    expect(workflow).toContain('[[ "$PLAN_RUN_ID" == "36179081896" ]]');
    expect(workflow).toContain(
      '[[ "$APPROVED_PLAN_SHA256" == "1408052e615385b4a01651a8b64605d13746ddde10a6950f7ba4d380a18c60e0" ]]',
    );
    expect(workflow).toContain(
      "terraform apply -lock-timeout=5m -auto-approve s22-bootstrap-iam.tfplan",
    );
    expect(workflow).toContain("if: env.S22_PHASE == 'bootstrap-iam' && env.S22_ACTION == 'apply'");
    expect(workflow).toContain("POST_APPLY_IAM_PLAN_EXIT_CODE");
    expect(workflow).toContain("terraform plan -refresh=false -detailed-exitcode -lock-timeout=5m");
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain(
      'if [[ "$ACTION" == "apply" && "$APPROVAL_TOKEN" != "S22-APPLY-APPROVED" ]]',
    );
    expect(workflow).toContain(
      'if [[ "$ACTION" == "apply" && ! "$PLAN_RUN_ID" =~ ^[1-9][0-9]*$ ]]',
    );
    expect(workflow).toContain("google-github-actions/auth@");
    expect(workflow).toContain("TF_VAR_deployer_service_account_email");
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
