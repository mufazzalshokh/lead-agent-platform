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
    expect(manifest.entries).toHaveLength(31);
    expect(manifest.entries.at(-1)?.tag).toBe("0030_s22_first_tenant_bootstrap");
    expect(manifest.entries.every((entry, index) => entry.idx === index)).toBe(true);
  });

  it("keeps application-role provisioning compatible with non-superuser Cloud SQL", async () => {
    const ownerTransferSpecs = [
      ["0012_s5_inbound_route_resolver.sql", "lead_agent_inbound_route_definer"],
      ["0014_s6_oidc_identity_resolver.sql", "lead_agent_identity_definer"],
      ["0015_s6_session_lifecycle.sql", "lead_agent_identity_definer"],
      ["0016_s6_membership_authorization_resolver.sql", "lead_agent_identity_definer"],
      ["0017_s6_membership_lifecycle.sql", "lead_agent_membership_definer"],
      ["0022_s8_outbox_relay_persistence.sql", "lead_agent_outbox_relay_definer"],
      ["0023_s8_active_route_claim.sql", "lead_agent_outbox_relay_definer"],
      ["0024_s8_handler_reliability.sql", "lead_agent_worker_reliability_definer"],
      ["0024_s8_handler_reliability.sql", "lead_agent_async_maintenance_definer"],
      ["0026_s11_telegram_inbound_route_management.sql", "lead_agent_inbound_route_definer"],
      ["0027_s11_instagram_identity_routing.sql", "lead_agent_inbound_route_definer"],
      ["0030_s22_first_tenant_bootstrap.sql", "lead_agent_first_tenant_bootstrap_definer"],
    ] as const;
    const [roleMigrations, ownerTransferMigrations] = await Promise.all([
      Promise.all(
        [
          "0010_s5_tenant_rls.sql",
          "0014_s6_oidc_identity_resolver.sql",
          "0017_s6_membership_lifecycle.sql",
          "0021_s8_pgboss_infrastructure.sql",
          "0022_s8_outbox_relay_persistence.sql",
          "0024_s8_handler_reliability.sql",
          "0030_s22_first_tenant_bootstrap.sql",
        ].map((name) => repositoryFile(`packages/database/drizzle/${name}`)),
      ),
      Promise.all(
        ownerTransferSpecs.map(async ([name, role]) => ({
          role,
          sql: await repositoryFile(`packages/database/drizzle/${name}`),
        })),
      ),
    ]);
    const roleSql = roleMigrations.join("\n");
    expect(roleSql).not.toMatch(/\b(?:NO)?(?:SUPERUSER|REPLICATION|BYPASSRLS)\b/gu);
    expect(roleSql.match(/rolsuper OR rolreplication OR rolbypassrls/gu)).toHaveLength(7);
    for (const { role, sql: ownerTransferSql } of ownerTransferMigrations) {
      const nonInheritedIndex = ownerTransferSql.indexOf(
        `GRANT ${role} TO CURRENT_USER WITH INHERIT FALSE`,
      );
      const setGrantIndex = ownerTransferSql.indexOf(
        `GRANT ${role} TO CURRENT_USER WITH SET TRUE`,
        nonInheritedIndex,
      );
      const grantIndex = ownerTransferSql.indexOf(`GRANT USAGE, CREATE ON SCHEMA app TO ${role}`);
      const firstOwnerIndex = ownerTransferSql.indexOf(`OWNER TO ${role}`);
      const lastOwnerIndex = ownerTransferSql.lastIndexOf(`OWNER TO ${role}`);
      const revokeIndex = ownerTransferSql.lastIndexOf(`REVOKE CREATE ON SCHEMA app FROM ${role}`);
      const setRevokeIndex = ownerTransferSql.lastIndexOf(
        `GRANT ${role} TO CURRENT_USER WITH SET FALSE`,
      );
      expect(nonInheritedIndex).toBeGreaterThanOrEqual(0);
      expect(setGrantIndex).toBeGreaterThan(nonInheritedIndex);
      expect(grantIndex).toBeGreaterThan(setGrantIndex);
      expect(firstOwnerIndex).toBeGreaterThan(grantIndex);
      expect(revokeIndex).toBeGreaterThan(lastOwnerIndex);
      expect(setRevokeIndex).toBeGreaterThan(revokeIndex);
    }
  });

  it("uses bounded definer role entry when replacing definer-owned functions", async () => {
    for (const [name, role, mutation, privilegeReset] of [
      [
        "0023_s8_active_route_claim.sql",
        "lead_agent_outbox_relay_definer",
        "DROP FUNCTION app.claim_outbox_events",
        "REVOKE ALL PRIVILEGES ON FUNCTION app.claim_outbox_events",
      ],
      [
        "0025_s6_membership_invitation_clock_skew.sql",
        "lead_agent_membership_definer",
        "CREATE OR REPLACE FUNCTION app.accept_membership_invitation",
        "REVOKE ALL PRIVILEGES ON FUNCTION app.accept_membership_invitation",
      ],
      [
        "0027_s11_instagram_identity_routing.sql",
        "lead_agent_inbound_route_definer",
        "CREATE OR REPLACE FUNCTION app.resolve_inbound_route",
        "REVOKE ALL PRIVILEGES ON FUNCTION app.resolve_inbound_route",
      ],
    ] as const) {
      const sql = await repositoryFile(`packages/database/drizzle/${name}`);
      const privilegeResetIndex = sql.indexOf(privilegeReset);
      const setGrantIndex = sql.indexOf(`GRANT ${role} TO CURRENT_USER WITH SET TRUE`);
      const setRoleIndex = sql.indexOf(`SET ROLE ${role}`);
      const mutationIndex = sql.indexOf(mutation);
      const resetRoleIndex = sql.indexOf("RESET ROLE", mutationIndex);
      const setRevokeIndex = sql.lastIndexOf(`GRANT ${role} TO CURRENT_USER WITH SET FALSE`);
      expect(privilegeResetIndex).toBeGreaterThanOrEqual(0);
      expect(setGrantIndex).toBeGreaterThanOrEqual(0);
      expect(setRoleIndex).toBeGreaterThan(setGrantIndex);
      expect(mutationIndex).toBeGreaterThan(setRoleIndex);
      expect(privilegeResetIndex).toBeGreaterThan(setRoleIndex);
      expect(privilegeResetIndex).toBeLessThan(resetRoleIndex);
      expect(resetRoleIndex).toBeGreaterThan(mutationIndex);
      expect(setRevokeIndex).toBeGreaterThan(resetRoleIndex);
    }
  });

  it("records runtime function grants as the bounded definer owner", async () => {
    for (const [name, role, ownerTransfer, runtimeGrant] of [
      [
        "0012_s5_inbound_route_resolver.sql",
        "lead_agent_inbound_route_definer",
        "ALTER FUNCTION app.resolve_inbound_route",
        "GRANT EXECUTE ON FUNCTION app.resolve_inbound_route",
      ],
      [
        "0014_s6_oidc_identity_resolver.sql",
        "lead_agent_identity_definer",
        "ALTER FUNCTION app.resolve_external_identity",
        "GRANT EXECUTE ON FUNCTION app.resolve_external_identity",
      ],
      [
        "0015_s6_session_lifecycle.sql",
        "lead_agent_identity_definer",
        "ALTER FUNCTION app.revoke_user_application_sessions",
        "GRANT EXECUTE ON FUNCTION app.create_application_session",
      ],
      [
        "0016_s6_membership_authorization_resolver.sql",
        "lead_agent_identity_definer",
        "ALTER FUNCTION app.resolve_membership_authorization",
        "GRANT EXECUTE ON FUNCTION app.resolve_membership_authorization",
      ],
      [
        "0017_s6_membership_lifecycle.sql",
        "lead_agent_membership_definer",
        "ALTER FUNCTION app.revoke_membership_user_sessions",
        "GRANT EXECUTE ON FUNCTION app.revoke_membership_user_sessions",
      ],
      [
        "0017_s6_membership_lifecycle.sql",
        "lead_agent_membership_definer",
        "ALTER FUNCTION app.accept_membership_invitation",
        "GRANT EXECUTE ON FUNCTION app.accept_membership_invitation",
      ],
      [
        "0022_s8_outbox_relay_persistence.sql",
        "lead_agent_outbox_relay_definer",
        "ALTER FUNCTION app.mark_outbox_event_dead_lettered",
        "GRANT EXECUTE ON FUNCTION app.claim_outbox_events",
      ],
      [
        "0023_s8_active_route_claim.sql",
        "lead_agent_outbox_relay_definer",
        "ALTER FUNCTION app.claim_outbox_events",
        "GRANT EXECUTE ON FUNCTION app.claim_outbox_events",
      ],
      [
        "0024_s8_handler_reliability.sql",
        "lead_agent_worker_reliability_definer",
        "ALTER FUNCTION app.prepare_worker_job_retry",
        "GRANT EXECUTE ON FUNCTION\n  app.acquire_worker_handler_execution",
      ],
      [
        "0024_s8_handler_reliability.sql",
        "lead_agent_async_maintenance_definer",
        "ALTER FUNCTION app.operator_requeue_dead_outbox_event",
        "GRANT EXECUTE ON FUNCTION\n  app.operator_redrive_worker_dlq_job",
      ],
      [
        "0026_s11_telegram_inbound_route_management.sql",
        "lead_agent_inbound_route_definer",
        "ALTER FUNCTION app.disable_telegram_inbound_route",
        "GRANT EXECUTE ON FUNCTION app.create_telegram_inbound_route",
      ],
      [
        "0027_s11_instagram_identity_routing.sql",
        "lead_agent_inbound_route_definer",
        "ALTER FUNCTION app.disable_instagram_inbound_route",
        "GRANT EXECUTE ON FUNCTION app.create_instagram_inbound_route",
      ],
    ] as const) {
      const sql = await repositoryFile(`packages/database/drizzle/${name}`);
      const ownerIndex = sql.indexOf(ownerTransfer);
      const setRoleIndex = sql.indexOf(`SET ROLE ${role}`, ownerIndex);
      const grantIndex = sql.indexOf(runtimeGrant, setRoleIndex);
      const resetRoleIndex = sql.indexOf("RESET ROLE", grantIndex);
      expect(ownerIndex).toBeGreaterThanOrEqual(0);
      expect(setRoleIndex).toBeGreaterThan(ownerIndex);
      expect(grantIndex).toBeGreaterThan(setRoleIndex);
      expect(resetRoleIndex).toBeGreaterThan(grantIndex);
    }
  });

  it("temporarily grants schema creation only for existing-owner function replacements", async () => {
    for (const [name, role, replacement] of [
      [
        "0025_s6_membership_invitation_clock_skew.sql",
        "lead_agent_membership_definer",
        "CREATE OR REPLACE FUNCTION app.accept_membership_invitation",
      ],
      [
        "0027_s11_instagram_identity_routing.sql",
        "lead_agent_inbound_route_definer",
        "CREATE OR REPLACE FUNCTION app.resolve_inbound_route",
      ],
    ] as const) {
      const sql = await repositoryFile(`packages/database/drizzle/${name}`);
      const createGrantIndex = sql.indexOf(`GRANT USAGE, CREATE ON SCHEMA app TO ${role}`);
      const setRoleIndex = sql.indexOf(`SET ROLE ${role}`, createGrantIndex);
      const replacementIndex = sql.indexOf(replacement, setRoleIndex);
      const resetRoleIndex = sql.indexOf("RESET ROLE", replacementIndex);
      const createRevokeIndex = sql.indexOf(
        `REVOKE CREATE ON SCHEMA app FROM ${role}`,
        resetRoleIndex,
      );
      expect(createGrantIndex).toBeGreaterThanOrEqual(0);
      expect(setRoleIndex).toBeGreaterThan(createGrantIndex);
      expect(replacementIndex).toBeGreaterThan(setRoleIndex);
      expect(resetRoleIndex).toBeGreaterThan(replacementIndex);
      expect(createRevokeIndex).toBeGreaterThan(resetRoleIndex);
    }
  });

  it("keeps queue privilege reset within objects owned by the migration actor", async () => {
    const [queueInfrastructure, relayPersistence, activeRoute, handlerReliability] =
      await Promise.all([
        repositoryFile("packages/database/drizzle/0021_s8_pgboss_infrastructure.sql"),
        repositoryFile("packages/database/drizzle/0022_s8_outbox_relay_persistence.sql"),
        repositoryFile("packages/database/drizzle/0023_s8_active_route_claim.sql"),
        repositoryFile("packages/database/drizzle/0024_s8_handler_reliability.sql"),
      ]);
    expect(queueInfrastructure).toContain(
      "REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public\n  FROM lead_agent_queue_runtime",
    );
    expect(queueInfrastructure).not.toContain(
      "REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public, app",
    );
    expect(relayPersistence).toContain("GRANT USAGE ON SCHEMA app TO lead_agent_queue_runtime");
    for (const functionName of [
      "claim_outbox_events",
      "renew_outbox_event_lease",
      "release_outbox_event_for_retry",
      "mark_outbox_event_published",
      "mark_outbox_event_dead_lettered",
    ]) {
      expect(relayPersistence).toContain(`GRANT EXECUTE ON FUNCTION app.${functionName}`);
    }
    expect(handlerReliability).not.toMatch(
      /REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA[^;]*\bapp\b/iu,
    );
    for (const [sql, grant, ownerTransfer] of [
      [
        relayPersistence,
        "GRANT EXECUTE ON FUNCTION app.claim_outbox_events(character varying, integer, integer)",
        "ALTER FUNCTION app.claim_outbox_events(character varying, integer, integer)",
      ],
      [
        activeRoute,
        "GRANT EXECUTE ON FUNCTION app.claim_outbox_events(character varying, character varying[], character varying[], integer, integer)",
        "ALTER FUNCTION app.claim_outbox_events(character varying, character varying[], character varying[], integer, integer)",
      ],
      [
        handlerReliability,
        "GRANT EXECUTE ON FUNCTION\n  app.acquire_worker_handler_execution",
        "ALTER FUNCTION app.acquire_worker_handler_execution",
      ],
    ] as const) {
      expect(sql.indexOf(grant)).toBeGreaterThanOrEqual(0);
      expect(sql.indexOf(grant)).toBeGreaterThan(sql.indexOf(ownerTransfer));
    }
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
    expect(variables).toContain(
      'can(regex("^https://[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\\\\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\\\\.run\\\\.app$", var.api_public_origin))',
    );
    expect(variables).toContain(
      'can(regex("^https://[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\\\\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\\\\.run\\\\.app$", var.web_public_origin))',
    );
    expect(variables).toMatch(/variable "worker_instance_count"[\s\S]*?default\s+= 0/u);
    expect(variables).toMatch(/variable "runtime_migration_head"[\s\S]*?default\s+= ""/u);
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
    expect(runtime).toContain('HOST                            = "0.0.0.0"');
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
    const [
      bootstrap,
      runtimeIam,
      runtime,
      workflow,
      imagesWorkflow,
      wiringDiagnostic,
      databaseValidator,
      fullRuntimePlanCheck,
      apiImagePlanCheck,
      apiImageLiveVerify,
      migratorImagePlanCheck,
      migratorImageLiveVerify,
      runtimeDiagnostic,
      instagramWebhookVerifier,
      telegramWebhookVerifier,
    ] = await Promise.all([
      repositoryFile("infra/deploy/gcp/bootstrap/main.tf"),
      repositoryFile("infra/deploy/gcp/staging/secrets-and-iam.tf"),
      repositoryFile("infra/deploy/gcp/staging/runtime.tf"),
      repositoryFile(".github/workflows/staging-terraform.yml"),
      repositoryFile(".github/workflows/staging-images.yml"),
      repositoryFile(".github/scripts/s22-migration-wiring-diagnose.sh"),
      repositoryFile(".github/scripts/s22-staging-database-validator.mjs"),
      repositoryFile(".github/scripts/s22-full-runtime-plan-check.sh"),
      repositoryFile(".github/scripts/s22-api-image-plan-check.sh"),
      repositoryFile(".github/scripts/s22-api-image-live-verify.sh"),
      repositoryFile(".github/scripts/s22-migrator-image-plan-check.sh"),
      repositoryFile(".github/scripts/s22-migrator-image-live-verify.sh"),
      repositoryFile(".github/scripts/s22-runtime-diagnose.mjs"),
      repositoryFile(".github/scripts/s22-instagram-webhook-verify.mjs"),
      repositoryFile(".github/scripts/s22-telegram-webhook-verify.mjs"),
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
    expect(runtimeIam).toContain(
      'resource "google_secret_manager_secret_iam_member" "deployer_temporary_instagram_verify_access"',
    );
    expect(runtimeIam).toContain(
      'secret_id = google_secret_manager_secret.runtime["instagram-webhook-verify-token"].secret_id',
    );
    expect(runtimeIam).toContain("count = var.temporary_instagram_verifier_access_enabled ? 1 : 0");
    expect(runtimeIam).toContain(
      'resource "google_secret_manager_secret_iam_member" "deployer_temporary_telegram_verify_access"',
    );
    expect(runtimeIam).toContain('"telegram-bot-token"');
    expect(runtimeIam).toContain('"telegram-webhook-secret"');
    expect(runtimeIam).toContain("var.temporary_telegram_verifier_access_enabled ? toset([");
    expect(workflow).toContain("refs/heads/verify/s22-staging-recovery-capacity");
    expect(imagesWorkflow).toContain("image_scope:");
    expect(imagesWorkflow).toContain("if: inputs.image_scope == 'api'");
    expect(imagesWorkflow).toContain("if: inputs.image_scope == 'migrator'");
    expect(imagesWorkflow.match(/if: inputs\.image_scope == 'all'/gu)).toHaveLength(5);
    expect(imagesWorkflow).toContain(
      "if: inputs.image_scope == 'all' || inputs.image_scope == 'api'",
    );
    expect(imagesWorkflow).toContain(
      "if: inputs.image_scope == 'all' || inputs.image_scope == 'migrator'",
    );
    expect(imagesWorkflow).toContain("Record immutable API image manifest");
    expect(imagesWorkflow).toContain("image_scope=api");
    expect(imagesWorkflow).toContain("Record immutable migrator image manifest");
    expect(imagesWorkflow).toContain("image_scope=migrator");
    expect(wiringDiagnostic).toContain('mode === "migration_failure_index"');
    expect(wiringDiagnostic).toContain('mode === "migration_failure_statement"');
    expect(wiringDiagnostic).toContain('mode === "migration_failure_sqlstate"');
    expect(wiringDiagnostic).toContain('await client.query("rollback").catch(() => {})');
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
    expect(workflow).toContain("- runtime-preflight");
    expect(workflow).toContain('[[ "$PHASE" == "runtime-preflight" ]]');
    expect(workflow).toContain("Verify full runtime configuration metadata");
    expect(workflow).toContain("required_runtime_secrets_ready=true");
    expect(workflow).toContain("application_managed_channel_secret_empty=true");
    expect(workflow).toContain("runtime_nonsecret_configuration_ready=true");
    expect(workflow).toContain("secret_payloads_read=false");
    expect(workflow).toContain("Upload full runtime configuration metadata");
    expect(workflow).toContain("- runtime-diagnose");
    expect(workflow).toContain("Diagnose failed API revision read-only");
    expect(workflow).toContain("Upload sanitized runtime diagnostic evidence");
    expect(runtimeDiagnostic).toContain("secret_payloads_read: false");
    expect(runtimeDiagnostic).toContain("DENIED_OR_UNAVAILABLE");
    expect(workflow).toContain("- instagram-verify-access");
    expect(workflow).toContain("- instagram-verify");
    expect(workflow).toContain("- instagram-verify-access-remove");
    expect(workflow).toContain("Verify Instagram webhook challenge without exposing its token");
    expect(workflow).toContain("::add-mask::$VERIFY_TOKEN");
    expect(workflow).toContain("gcloud secrets versions access latest");
    expect(workflow).toContain("S22I101_INVALID_API_REVISION");
    expect(workflow).toContain("S22I102_API_IMAGE_MISMATCH");
    expect(workflow).toContain("S22I103_SECRET_ACCESS_FAILED");
    expect(workflow).toContain("S22I104_INVALID_SECRET_VALUE");
    expect(workflow).toContain("instagram_verify_access_removal_scope=single_secret_only");
    expect(instagramWebhookVerifier).toContain('correct_token_challenge: "PASS"');
    expect(instagramWebhookVerifier).toContain("secret_value_exposed: false");
    expect(instagramWebhookVerifier).toContain('wrong_token_rejected: "PASS"');
    expect(instagramWebhookVerifier).not.toContain("console.log(verifyToken");
    expect(workflow).toContain("- telegram-verify-access");
    expect(workflow).toContain("- telegram-verify");
    expect(workflow).toContain("- telegram-verify-access-remove");
    expect(workflow).toContain("Verify Telegram webhook without exposing credentials");
    expect(workflow).toContain('echo "::add-mask::$BOT_TOKEN"');
    expect(workflow).toContain('echo "::add-mask::$WEBHOOK_SECRET"');
    expect(workflow).toContain("telegram_verify_access_scope=two_telegram_secrets_only");
    expect(workflow).toContain("telegram_verify_access_removal_scope=two_telegram_secrets_only");
    expect(telegramWebhookVerifier).toContain('webhook_configured: "PASS"');
    expect(telegramWebhookVerifier).toContain('bot_business_capable: "PASS"');
    expect(telegramWebhookVerifier).toContain('wrong_secret_rejected: "PASS"');
    expect(telegramWebhookVerifier).toContain('correct_secret_probe: "PASS"');
    expect(telegramWebhookVerifier).toContain("secret_value_exposed: false");
    expect(telegramWebhookVerifier).not.toContain("console.log(botToken");
    expect(telegramWebhookVerifier).not.toContain("console.log(webhookSecret");
    expect(workflow).toContain("env.S22_PHASE != 'runtime-preflight'");
    expect(workflow).toContain("Verify full runtime plan safety");
    expect(workflow).toContain("Verify exact full runtime approval boundary");
    expect(workflow).toContain("s22-full-runtime-plan-check.sh");
    expect(fullRuntimePlanCheck).toContain("PLAN_MODE=initial");
    expect(fullRuntimePlanCheck).toContain("PLAN_MODE=reconciliation");
    expect(fullRuntimePlanCheck).toContain(
      'RECONCILIATION_ACTIONS=\'["update:google_cloud_run_v2_job.migrator[0]","update:google_cloud_run_v2_service.api[0]","update:google_cloud_run_v2_service.web[0]","update:google_cloud_run_v2_worker_pool.worker[0]"]\'',
    );
    expect(fullRuntimePlanCheck).toContain("full_runtime_plan_creates=$CREATE_COUNT");
    expect(fullRuntimePlanCheck).toContain('terraform -chdir="$PLAN_DIRECTORY" show -json');
    expect(fullRuntimePlanCheck).toContain("full_runtime_plan_changes=$UPDATE_COUNT");
    expect(fullRuntimePlanCheck).toContain("full_runtime_plan_destroys=0");
    expect(fullRuntimePlanCheck).toContain("full_runtime_plan_replacements=0");
    expect(fullRuntimePlanCheck).toContain("full_runtime_public_iam_changes=NONE");
    expect(fullRuntimePlanCheck).toContain("full_runtime_migrator_execution=DISABLED");
    expect(workflow).toContain("Verify migration plan safety");
    expect(workflow).toContain("- migration-resume");
    expect(workflow).toContain("- migration-validate");
    expect(workflow).toContain('[[ "$PHASE" == "migration-validate" ]]');
    expect(workflow).toContain('[[ "$ACTION" == "plan" ]]');
    expect(workflow).toContain("- migrator-image-update");
    expect(workflow).toContain("- migrator-image-verify");
    expect(workflow).toContain("Verify migrator image-only plan safety");
    expect(workflow).toContain("s22-migrator-image-plan-check.sh");
    expect(workflow).toContain("- api-image-update");
    expect(workflow).toContain("Verify API image-only plan safety");
    expect(workflow).toContain("Verify exact API image update approval boundary");
    expect(workflow).toContain("Verify API image update live state and convergence");
    expect(workflow).toContain("s22-api-image-plan-check.sh");
    expect(workflow).toContain("s22-api-image-live-verify.sh");
    expect(workflow).toContain("runtime_git_commit_sha:");
    expect(workflow).toContain("api_git_commit_sha:");
    expect(workflow).toContain("api_migration_head:");
    expect(workflow).toContain("migrator_git_commit_sha:");
    expect(workflow).toContain("runtime_deployment_timestamp:");
    expect(workflow).toContain("runtime_migration_head:");
    expect(workflow).toContain(
      "TF_VAR_runtime_migration_head: ${{ inputs.runtime_migration_head }}",
    );
    expect(workflow).toContain('echo "TF_VAR_git_commit_sha=$S22_RUNTIME_GIT_COMMIT_SHA"');
    expect(workflow).toContain(
      'echo "TF_VAR_migrator_git_commit_sha=$S22_MIGRATOR_GIT_COMMIT_SHA"',
    );
    expect(workflow).toContain(
      'echo "TF_VAR_deployment_timestamp=$S22_RUNTIME_DEPLOYMENT_TIMESTAMP"',
    );
    expect(workflow).toContain(
      '[[ "$TF_VAR_worker_image" =~ ^me-central1-docker\\.pkg\\.dev/lead-agent-stg-739284/lead-agent/worker@sha256:[0-9a-f]{64}$ ]]',
    );
    for (const phase of [
      "api-image-update",
      "migration-resume",
      "migrator-image-update",
      "migrator-image-verify",
    ]) {
      const profile = workflow.match(new RegExp(`${phase}\\)([\\s\\S]*?)\\n\\s*;;`, "u"))?.[1];
      expect(profile).toContain("DEPLOY_RUNTIME=true");
      expect(profile).toContain("PREPARE_MIGRATION=true");
      expect(profile).toContain("WORKER_COUNT=1");
      expect(profile).not.toContain("BOOTSTRAP_RUNTIME=true");
    }
    expect(workflow).toContain("Verify exact migrator image update approval boundary");
    expect(workflow).toContain("Verify migrator image update live state and convergence");
    expect(workflow).toContain("Verify applied migrator image read-only");
    expect(workflow).toContain("s22-migrator-image-live-verify.sh");
    expect(migratorImageLiveVerify).toContain("terraform_convergence_exit_code");
    expect(migratorImageLiveVerify).toContain("migrator_image_live_verification=PASS");
    expect(migratorImageLiveVerify).toContain("'89'");
    expect(migratorImageLiveVerify).toContain("https://run.googleapis.com/v2/projects/");
    expect(runtime).toContain("migrator_provenance_env");
    expect(runtime).toContain("api_provenance_env");
    expect(runtime).toContain("api_deployment_labels");
    expect(runtime).toContain("api_migration_head");
    expect(runtime).toContain("migrator_deployment_labels");
    expect(runtime).toContain("runtime_migration_head");
    expect(runtime).toContain("DEPLOYMENT_MIGRATION_HEAD = var.migration_head");
    expect(migratorImagePlanCheck).toContain('ACTUAL_ACTIONS="$(\n  jq -c');
    expect(migratorImagePlanCheck).toContain(
      '[[ "$ACTUAL_ACTIONS" == \'["update:google_cloud_run_v2_job.migrator[0]"]\' ]]',
    );
    expect(migratorImagePlanCheck).toContain('.variables.bootstrap_runtime.value == "false"');
    expect(migratorImagePlanCheck).toContain('.variables.worker_instance_count.value == "1"');
    expect(apiImagePlanCheck).toContain(
      '[[ "$ACTUAL_ACTIONS" == \'["update:google_cloud_run_v2_service.api[0]"]\' ]]',
    );
    expect(apiImagePlanCheck).toContain('.variables.bootstrap_runtime.value == "false"');
    expect(apiImagePlanCheck).toContain('.variables.worker_instance_count.value == "1"');
    expect(apiImageLiveVerify).toContain("terraform_convergence_exit_code");
    expect(apiImageLiveVerify).toContain("api_image_live_verification=PASS");
    expect(workflow).toContain('"$PHASE" != "migration-resume"');
    expect(workflow).toContain("env.S22_PHASE == 'migration-resume'");
    expect(workflow.match(/env\.S22_PHASE != 'migration-resume'/gu)).toHaveLength(3);
    expect(workflow).toContain(
      'EXPECTED_ACTIONS=\'["create:google_cloud_run_v2_job.migrator[0]","create:google_sql_database.application[0]"]\'',
    );
    expect(workflow).toContain("Verify exact migration plan approval boundary");
    expect(workflow).toContain("Verify migrated staging database");
    expect(workflow).toContain(".github/scripts/s22-staging-database-validator.mjs");
    expect(workflow).toContain("S22V099_VALIDATOR_TIMEOUT");
    expect(workflow).toContain('gcloud run jobs executions cancel "$EXECUTION_ID"');
    expect(workflow).toContain('labels.\\"run.googleapis.com/execution_name\\"');
    expect(workflow).toContain("Upload staging database validator evidence");
    expect(databaseValidator).toContain('const { Pool } = await import("pg");');
    expect(databaseValidator).toContain('await import("./dist/migrate.js")');
    expect(databaseValidator).toContain("withLibpqCompatibleRequireSsl");
    expect(databaseValidator).toContain("staging_database_validation");
    expect(databaseValidator).toContain('assertion: "production_table_count"');
    expect(databaseValidator).toContain('assertion: "force_rls_manifest"');
    expect(databaseValidator).toContain('assertion: "required_nologin_definer_roles"');
    expect(databaseValidator).toContain('assertion: "forbidden_bypassrls_roles"');
    expect(databaseValidator).toContain('assertion: "inbound_route_security_definer_behavior"');
    expect(databaseValidator).toContain('assertion: "ingress_direct_table_denial"');
    expect(databaseValidator).toContain('assertion: "cross_tenant_denial"');
    expect(databaseValidator).not.toMatch(
      /console\.(?:info|error)\([^)]*(?:password|token|secret|authorization|database[_-]?url)/iu,
    );
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
    expect(workflow).toContain("S22_RUN_SQL_PROBE: true");
    expect(workflow).toContain("S22_SKIP_ACTIVE_PROBES: true");
    expect(workflow).toContain("s22-migration-wiring-diagnose.sh");
    expect(wiringDiagnostic).toContain('if [[ "${S22_SKIP_ACTIVE_PROBES:-false}" == "true" ]]');
    expect(wiringDiagnostic).toContain('report "recent_execution_${RECENT_INDEX}"');
    expect(wiringDiagnostic).toContain("live_job_generation_observed");
    expect(wiringDiagnostic).toContain("live_job_terminal_state");
    expect(wiringDiagnostic).toContain("live_job_terminal_revision_reason");
    expect(wiringDiagnostic).toContain("failed_task_image_matches");
    expect(wiringDiagnostic).toContain("failed_task_network_matches");
    expect(wiringDiagnostic).toContain("failed_task_subnetwork_matches");
    expect(wiringDiagnostic).toContain("failed_task_command_matches");
    expect(wiringDiagnostic).toContain("failed_task_args_matches");
    expect(wiringDiagnostic).toContain("failed_task_diagnostic_override_present");
    expect(wiringDiagnostic).toContain("runtime_sql_connectivity");
    expect(wiringDiagnostic).toContain("runtime_normalized_sql_connectivity");
    expect(wiringDiagnostic).toContain(
      "withLibpqCompatibleRequireSsl(process.env.MIGRATION_DATABASE_URL)",
    );
    expect(wiringDiagnostic).toContain("runtime_admin_role_superuser");
    expect(wiringDiagnostic).toContain("runtime_admin_role_bypassrls");
    expect(wiringDiagnostic).toContain("runtime_migration_count_31");
    expect(wiringDiagnostic).toContain("runtime_production_table_count_52");
    expect(wiringDiagnostic).toContain("runtime_required_bypassrls_role_present");
    expect(wiringDiagnostic).toContain("runtime_cloudsql_superuser_role_bypassrls");
    expect(wiringDiagnostic).toContain("runtime_cloudsql_superuser_role_superuser");
    expect(wiringDiagnostic).toContain("runtime_admin_has_cloudsql_superuser_usage");
    expect(wiringDiagnostic).toContain("packaged_manifest_head_0030");
    expect(wiringDiagnostic).toContain("TLS_CERT_ALTNAME_INVALID");
    expect(workflow).toContain("- bootstrap-log-viewer");
    expect(workflow).toContain("- bootstrap-log-viewer-remove");
    expect(workflow).toContain("- migration-error-read");
    expect(workflow).toContain(
      "-target='google_project_iam_member.deployer_temporary_logging_viewer[0]'",
    );
    expect(workflow).toContain(
      '["create:google_project_iam_member.deployer_temporary_logging_viewer[0]"]',
    );
    expect(workflow).toContain(
      '["delete:google_project_iam_member.deployer_temporary_logging_viewer[0]"]',
    );
    expect(workflow).toContain('[[ "$STATE_COUNT" == "35" ]]');
    expect(workflow).toContain('[[ "$STATE_COUNT" == "34" ]]');
    expect(workflow).toContain('[[ "$BOOTSTRAP_STATE_COUNT" == "35" ]]');
    expect(workflow).toContain('[[ "$BOOTSTRAP_STATE_COUNT" == "34" ]]');
    expect(workflow).toContain("Verify temporary logging viewer removal convergence");
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
      /node - "\$LOGS" "\$EXECUTION" "\$TASKS" "\$EXECUTION_ID" <<'NODE' \| tee s22-migrator-root-error\.txt\n([\s\S]*?)\n          NODE/u,
    )?.[1];
    expect(diagnosticScript).toBeDefined();
    expect(() => new Script(diagnosticScript ?? "")).not.toThrow();
    expect(migratorImageLiveVerify).toContain(".template.template.serviceAccount");
    expect(migratorImageLiveVerify).toContain(".template.template.containers[0].image");
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
      'if [[ "$ACTION" == "apply" && "$PHASE" != "migration-resume" && "$PHASE" != "owner-workspace-bootstrap" && ! "$PLAN_RUN_ID" =~ ^[1-9][0-9]*$ ]]',
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
