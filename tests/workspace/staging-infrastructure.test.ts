import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Script } from "node:vm";

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
    expect(runtime).toContain('command = ["node"]');
    expect(runtime).toContain('args    = ["dist/index.js"]');
    expect(runtime).not.toContain(":latest");
    expect(monitoring).toContain('display_name    = "Lead Agent S22 staging USD 25 target"');
    expect(monitoring).toContain('display_name    = "Lead Agent S22 staging USD 50 hard ceiling"');
    expect(workflow).toContain("SQL_TIER=db-custom-1-3840");
    expect(workflow).toContain("WORKER_COUNT=0");
    expect(workflow).toContain("WORKER_COUNT=1");
    expect(workflow).toContain("dormant)");
  });

  it("requires reviewed-plan integrity and GitHub OIDC instead of service-account keys", async () => {
    const [bootstrap, runtimeIam, runtime, workflow, imagesWorkflow, wiringDiagnostic] =
      await Promise.all([
        repositoryFile("infra/deploy/gcp/bootstrap/main.tf"),
        repositoryFile("infra/deploy/gcp/staging/secrets-and-iam.tf"),
        repositoryFile("infra/deploy/gcp/staging/runtime.tf"),
        repositoryFile(".github/workflows/staging-terraform.yml"),
        repositoryFile(".github/workflows/staging-images.yml"),
        repositoryFile(".github/scripts/s22-migration-wiring-diagnose.sh"),
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
    expect(bootstrap).toContain(
      'resource "google_project_iam_member" "deployer_temporary_logging_viewer"',
    );
    expect(bootstrap).toContain('role    = "roles/logging.viewer"');
    expect(bootstrap).toContain("var.temporary_logging_viewer_enabled ? 1 : 0");
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
    expect(imagesWorkflow).toContain("image_scope:");
    expect(imagesWorkflow).toContain("if: inputs.image_scope == 'migrator'");
    expect(imagesWorkflow.match(/if: inputs\.image_scope == 'all'/gu)).toHaveLength(4);
    expect(imagesWorkflow).toContain("Record immutable migrator image manifest");
    expect(imagesWorkflow).toContain("image_scope=migrator");
    expect(workflow).not.toMatch(/^  push:/mu);
    expect(workflow).toContain("S22_ACTION: ${{ inputs.action }}");
    expect(workflow).toContain("S22_PHASE: ${{ inputs.phase }}");
    expect(workflow).toContain("- foundation-reconcile");
    expect(workflow).toContain("- foundation-reconcile-verify");
    expect(workflow).toContain("- cloud-sql-start");
    expect(workflow).toContain("- cloud-sql-phase-b");
    expect(workflow).toContain(
      '[[ "$REQUESTED_SHA" == "2396fdf797eb4b19252a34c8b45e93945a8f53a3" ]]',
    );
    expect(workflow).toContain('[[ "$PLAN_RUN_ID" == "36226804148" ]]');
    expect(workflow).toContain(
      '[[ "$APPROVED_PLAN_SHA256" == "ddcf63f2b087c14a4dc7c52aee46e8530f97d7fc05b8ab0c8467eb8526c285f0" ]]',
    );
    expect(workflow).toContain("Verify exact foundation reconciliation approval boundary");
    expect(workflow).toContain(
      'EXPECTED_ACTIONS=\'["create:google_monitoring_alert_policy.database_cpu","create:google_sql_database_instance.staging"]\'',
    );
    expect(workflow).toContain('[[ "$STATE_COUNT" == "80" ]]');
    expect(workflow).toContain("Record Phase A apply start");
    expect(workflow).toContain("Verify reconciliation Phase A live state");
    expect(workflow).toContain('[[ "$STATE_COUNT" == "82" ]]');
    expect(workflow).toContain("Verify reconciliation Phase A Terraform convergence");
    expect(workflow).toContain("Create and verify Cloud SQL Phase B dormant plan");
    expect(workflow).toContain("TF_VAR_cloud_sql_activation_policy=NEVER terraform plan");
    expect(workflow).toContain("phase_b_only_change=activation_policy_ALWAYS_to_NEVER");
    expect(workflow).toContain("Upload exact Cloud SQL Phase B plan");
    expect(workflow).toContain("foundation-reconcile)\n              SQL_POLICY=ALWAYS");
    expect(workflow).toContain("foundation-reconcile-verify)\n              SQL_POLICY=ALWAYS");
    expect(workflow).toContain("Verify Phase A live state with named read-only assertions");
    expect(workflow).toContain('PHASE_A_EXECUTION_RUN: "36228563835"');
    expect(workflow).toContain('PHASE_A_SOURCE_PLAN_RUN: "36226804148"');
    expect(workflow).toContain("ASSERTION|%s|%s|expected=%s|observed=%s");
    expect(workflow).toContain("cloud_sql.activation_policy");
    expect(workflow).toContain("monitoring.notification_channels_resolvable");
    expect(workflow).toContain("terraform_state.no_duplicate_or_ghost_sql_entry");
    expect(workflow).toContain("Verify Phase A Terraform convergence read-only");
    expect(workflow).toContain('terraform plan -detailed-exitcode -lock-timeout=5m -out="$PLAN"');
    expect(workflow).toContain("Create and verify read-only Cloud SQL Phase B dormant plan");
    expect(workflow).toContain("phase_b_workflow_run_id=$GITHUB_RUN_ID");
    expect(workflow).toContain("phase_b_unrelated_actions=NONE");
    expect(workflow).toContain("Upload read-only Cloud SQL Phase B plan");
    expect(workflow).toContain("Download exact owner-approved Cloud SQL Phase B plan");
    expect(workflow).toContain('[[ "$PLAN_RUN_ID" == "36230182001" ]]');
    expect(workflow).toContain(
      '[[ "$APPROVED_PLAN_SHA256" == "2e89253d05281e38af1157e6cf3f1a09740db5572f699f36228606fbbd8a987e" ]]',
    );
    expect(workflow).toContain("Verify exact Cloud SQL Phase B approval boundary");
    expect(workflow).toContain("Apply exact owner-approved Cloud SQL Phase B plan");
    expect(workflow).toContain("Verify Cloud SQL Phase B dormant state");
    expect(workflow).toContain("phase_b_compute_stopped_by_activation_policy=true");
    expect(workflow).toContain("Verify Cloud SQL Phase B Terraform convergence");
    expect(workflow).toContain("Verify health-only bootstrap plan safety");
    expect(workflow).toContain('.mode == "managed" and .change.actions != ["no-op"]');
    expect(workflow).toContain("data.google_project.staging");
    expect(workflow).toContain("as $api");
    expect(workflow).toContain("as $web");
    expect(workflow).toContain("as $bindings");
    expect(workflow).toContain("Health-only plan lifecycle variables");
    expect(workflow).toContain('.variables.deploy_runtime.value == "true"');
    expect(workflow).toContain('.variables.worker_instance_count.value == "0"');
    expect(workflow).toContain("Health-only plan aggregate counts");
    expect(workflow).toContain("always() && env.S22_PHASE == 'bootstrap'");
    expect(workflow).toContain("health_only_cloud_sql_policy=NEVER");
    expect(workflow).toContain("Upload exact health-only bootstrap plan");
    expect(workflow).toContain("s22-health-only-plan-${{ env.S22_COMMIT_SHA }}-$PLAN_RUN_ID");
    expect(workflow).toContain('[[ "$PLAN_RUN_ID" == "36234151332" ]]');
    expect(workflow).toContain(
      '[[ "$APPROVED_PLAN_SHA256" == "4a116fd0d9db69ea821b22c04a1666b1d17f402816f74dde298578ed1d99da96" ]]',
    );
    expect(workflow).toContain("Verify exact health-only runtime approval boundary");
    expect(workflow).toContain("Verify health-only runtime live state");
    expect(workflow).toContain("health.secret_versions");
    expect(workflow).toContain("health.terraform_state_count");
    expect(workflow).toContain("Verify health-only runtime Terraform convergence");
    expect(workflow).toContain("Upload health-only runtime apply evidence");
    expect(workflow).toContain("Verify Cloud SQL start-only plan safety");
    expect(workflow).toContain("cloud_sql_start_only_change=activation_policy_NEVER_to_ALWAYS");
    expect(workflow).toContain("Verify exact Cloud SQL start approval boundary");
    expect(workflow).toContain("Verify Cloud SQL start live state and empty database secrets");
    expect(workflow).toContain("cloud_sql_start_state=RUNNABLE");
    expect(workflow).toContain("cloud_sql_start_enabled_database_secret_versions=0");
    expect(workflow).toContain("Verify Cloud SQL start Terraform convergence");
    expect(workflow).toContain("Upload Cloud SQL start apply evidence");
    expect(workflow).toContain("Verify database secret version metadata");
    expect(workflow).toContain('[[ "$ENABLED_COUNT" == "1" ]]');
    expect(workflow).toContain("Verify migration plan safety");
    expect(workflow).toContain("- migration-resume");
    expect(workflow).toContain("- migrator-image-update");
    expect(workflow).toContain("Verify migrator image-only plan safety");
    expect(workflow).toContain("s22-migrator-image-plan-check.sh");
    expect(workflow).toContain("Verify exact migrator image update approval boundary");
    expect(workflow).toContain("Verify migrator image update live state and convergence");
    expect(workflow).toContain("migrator_image_update_convergence_exit_code=$PLAN_EXIT_CODE");
    expect(runtime).toContain("migrator_provenance_env");
    expect(runtime).toContain("migrator_deployment_labels");
    expect(workflow).toContain('"$PHASE" != "migration-resume"');
    expect(workflow).toContain("env.S22_PHASE == 'migration-resume'");
    expect(workflow.match(/env\.S22_PHASE != 'migration-resume'/gu)).toHaveLength(3);
    expect(workflow).toContain(
      'EXPECTED_ACTIONS=\'["create:google_cloud_run_v2_job.migrator[0]","create:google_sql_database.application[0]"]\'',
    );
    expect(workflow).toContain("Verify exact migration plan approval boundary");
    expect(workflow).toContain("Verify migrated staging database");
    expect(workflow).toContain('const { Pool } = await import("pg");');
    expect(workflow).toContain('await import("./dist/migrate.js")');
    expect(workflow).toContain("staging_database_validation");
    expect(workflow).toContain("production_tables: 52");
    expect(workflow).toContain("force_rls_tables: actualRlsTables.length");
    expect(workflow).toContain("application_roles_verified: 4");
    expect(workflow).toContain("Verify migration Terraform convergence");
    expect(workflow).toContain('[[ "$STATE_COUNT" == "88" ]]');
    expect(workflow).toContain("migration_convergence_exit_code=$PLAN_EXIT_CODE");
    expect(workflow).toContain("- migration-diagnose");
    expect(workflow).toContain("- migration-wiring-diagnose");
    expect(workflow).toContain("Run bounded migration failure diagnostics");
    expect(workflow).toContain("live_vpc_configuration=PASS");
    expect(workflow).toContain("live_vpc_network=PASS");
    expect(workflow).toContain("live_vpc_subnetwork=PASS");
    expect(workflow).toContain("live_vpc_egress=PASS");
    expect(workflow).toContain("live_cloud_sql_endpoint=PASS");
    expect(workflow).toContain("run_probe execution_override");
    expect(workflow).toContain("run_probe secret_protocols");
    expect(workflow).toContain("run_probe secret_roles");
    expect(workflow).toContain("run_probe secret_password_presence");
    expect(workflow).toContain("run_probe secret_endpoint");
    expect(workflow).toContain("run_probe secret_sslmode");
    expect(workflow).toContain("run_probe secret_shape");
    expect(workflow).toContain("run_probe private_tcp_connectivity");
    expect(workflow).toContain("run_probe migration_secret_shape");
    expect(workflow).toContain("run_probe application_secret_shape");
    expect(workflow).toContain("admin_connectivity");
    expect(workflow).toContain("migration_state");
    expect(workflow).toContain("application_role_connectivity");
    expect(workflow).toContain("Diagnose migrator secret and VPC wiring");
    expect(workflow).toContain("FAILED_EXECUTION: ${{ env.S22_MIGRATOR_EXECUTION_ID }}");
    expect(workflow).toContain("S22_SKIP_ACTIVE_PROBES: true");
    expect(workflow).toContain("s22-migration-wiring-diagnose.sh");
    expect(wiringDiagnostic).toContain('if [[ "${S22_SKIP_ACTIVE_PROBES:-false}" == "true" ]]');
    expect(wiringDiagnostic).toContain('report "recent_execution_${RECENT_INDEX}"');
    expect(wiringDiagnostic).toContain("live_job_generation_observed");
    expect(wiringDiagnostic).toContain("live_job_terminal_state");
    expect(wiringDiagnostic).toContain("live_job_terminal_revision_reason");
    expect(workflow).toContain("- bootstrap-log-viewer");
    expect(workflow).toContain("- migration-error-read");
    expect(workflow).toContain(
      "-target='google_project_iam_member.deployer_temporary_logging_viewer[0]'",
    );
    expect(workflow).toContain(
      '["create:google_project_iam_member.deployer_temporary_logging_viewer[0]"]',
    );
    expect(workflow).toContain('[[ "$STATE_COUNT" == "35" ]]');
    expect(workflow).toContain("Read sanitized migrator application error");
    expect(workflow).toContain('payload.operation === "database_migration"');
    expect(workflow).toContain('gcloud beta run jobs executions logs read "$EXECUTION_ID"');
    expect(workflow).toContain('gcloud run jobs executions describe "$EXECUTION_ID"');
    expect(workflow).toContain("Array.isArray(parsedLogs?.entries)");
    expect(workflow).toContain('diagnostic_mode: "sanitized_runtime_fallback"');
    expect(workflow).toContain('diagnostic_mode: "sanitized_execution_status"');
    expect(workflow).toContain('diagnostic_mode: "sanitized_metadata_only"');
    expect(workflow).toContain("diagnosticLogPattern");
    expect(workflow).toContain("usefulErrorPattern");
    const diagnosticScript = workflow.match(
      /node - "\$LOGS" "\$EXECUTION" "\$EXECUTION_ID" <<'NODE' \| tee s22-migrator-root-error\.txt\n([\s\S]*?)\n          NODE/u,
    )?.[1];
    expect(diagnosticScript).toBeDefined();
    expect(() => new Script(diagnosticScript ?? "")).not.toThrow();
    expect(workflow).toContain(".template.template.serviceAccount");
    expect(workflow).toContain(".template.template.containers[0].image == $image");
    expect(workflow).toContain("Inspect partial foundation state and Google Cloud resources");
    expect(workflow).toContain("terraform_managed_resource_count=$STATE_COUNT");
    expect(workflow).toContain('gh run view 36224692606 --repo "$GITHUB_REPOSITORY" --log');
    expect(workflow).toContain("cloud_sql_failed_operation_code=invalidOperation");
    expect(workflow).toContain("cloud_sql_pending_operation_observation=none");
    expect(workflow).toContain("Verify foundation reconciliation plan safety");
    expect(workflow).toContain('.variables.cloud_sql_activation_policy.value == "ALWAYS"');
    expect(workflow).toContain('.address != "google_sql_database_instance.staging"');
    expect(workflow).toContain('.address != "google_monitoring_alert_policy.database_cpu"');
    expect(workflow).toContain("reconciliation_plan_replacements=$REPLACE_COUNT");
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
    expect(workflow).toContain(
      '[[ "$REQUESTED_SHA" == "c4134d2980c7c31653cc6e52dd21173a58297aab" ]]',
    );
    expect(workflow).toContain('[[ "$PLAN_RUN_ID" == "36176635223" ]]');
    expect(workflow).toContain(
      '[[ "$APPROVED_PLAN_SHA256" == "43ebe6df02eb4b693fdc17dfd2dbedf191668e3a1b61ccc4c97fe94d8cf5ad7c" ]]',
    );
    expect(workflow).toContain('[[ "$FOUNDATION_STATE_COUNT" == "0" ]]');
    expect(workflow).toContain('[[ "$FOUNDATION_STATE_COUNT" == "81" ]]');
    expect(workflow).toContain("EXPECTED_TYPE_COUNTS=");
    expect(workflow).toContain("terraform plan -detailed-exitcode -lock-timeout=5m");
    expect(workflow).toContain("Verify actual foundation resources");
    expect(workflow).toContain("gcloud sql instances describe lead-agent-staging-postgres17");
    expect(workflow).toContain("gcloud run services list");
    expect(workflow).toContain("gcloud run jobs list");
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain(
      'if [[ "$ACTION" == "apply" && "$APPROVAL_TOKEN" != "S22-APPLY-APPROVED" ]]',
    );
    expect(workflow).toContain(
      'if [[ "$ACTION" == "apply" && "$PHASE" != "migration-resume" && ! "$PLAN_RUN_ID" =~ ^[1-9][0-9]*$ ]]',
    );
    expect(workflow).toContain("google-github-actions/auth@");
    expect(workflow).toContain("TF_VAR_deployer_service_account_email");
    expect(workflow).toContain("sha256sum --check s22.tfplan.sha256");
    expect(workflow).not.toMatch(/service[_-]account[_-]key/u);
    expect(imagesWorkflow.match(/platforms: linux\/amd64/gu)).toHaveLength(4);
    expect(imagesWorkflow).toContain("Verify Artifact Registry foundation readiness");
    expect(imagesWorkflow).toContain("docker pull --platform=linux/amd64");
    expect(imagesWorkflow).toContain("architecture=linux/amd64");
    expect(imagesWorkflow).toContain("Upload immutable image manifest");
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
