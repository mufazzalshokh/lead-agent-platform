import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const repositoryFile = (path: string): Promise<string> =>
  readFile(resolve(process.cwd(), path), "utf8");

describe("S22 staging first-owner bootstrap", () => {
  it("keeps the tracked database capability one-time, fixed, and unavailable to app roles", async () => {
    const migration = await repositoryFile(
      "packages/database/drizzle/0030_s22_first_tenant_bootstrap.sql",
    );

    expect(migration).toContain("CREATE ROLE lead_agent_first_tenant_bootstrap_definer NOLOGIN");
    expect(migration).toContain("SECURITY DEFINER");
    expect(migration).toContain("SET search_path = pg_catalog");
    expect(migration).toContain("S22_BOOTSTRAP_NOT_EMPTY");
    expect(migration).toContain("staging_owner_bootstrap");
    expect(migration).toContain("exact_issuer_subject");
    expect(migration).toContain(
      "GRANT lead_agent_first_tenant_bootstrap_definer TO CURRENT_USER WITH SET FALSE",
    );
    expect(migration).toMatch(
      /FROM PUBLIC, lead_agent_runtime, lead_agent_auth, lead_agent_ingress,\s+lead_agent_queue_runtime/u,
    );
    expect(migration).not.toMatch(
      /\b(?:DISABLE ROW LEVEL SECURITY|NO FORCE|BYPASSRLS|SUPERUSER)\b/u,
    );
    expect(migration).not.toMatch(/\bEXECUTE\s+(?:pg_catalog\.)?format\b/iu);
    expect(migration).not.toContain("email@example");
  });

  it("binds only one exact Auth0 subject to one synthetic active owner workspace", async () => {
    const script = await repositoryFile(".github/scripts/s22-staging-owner-bootstrap.mjs");

    expect(script).toContain("STAGING_AUTH0_ISSUER");
    expect(script).toContain("STAGING_OWNER_AUTH0_SUBJECT");
    expect(script).toContain("AUTH_DATABASE_URL");
    expect(script).toContain("^google-oauth2\\|[0-9]{1,128}$");
    expect(script).toContain('await import("pg")');
    expect(script).toContain("withLibpqCompatibleRequireSsl");
    expect(script).not.toMatch(/^import\s/mu);
    expect(script).toContain("bootstrap().catch((error) =>");
    expect(script).not.toContain("await bootstrap()");
    expect(script).toContain("process.exitCode = classifiedExitCode");
    expect(script).toContain("begin isolation level serializable");
    expect(script).toContain("app.bootstrap_first_staging_owner");
    expect(script).toContain('replayCode !== "P0001"');
    expect(script).toContain('replayDetail !== "S22_BOOTSTRAP_NOT_EMPTY"');
    expect(script).toContain('replay_protection: "S22_BOOTSTRAP_NOT_EMPTY"');
    expect(script).toContain("audit_event_id: AUDIT_ID");
    expect(script).toContain('mode !== "apply" && mode !== "verify"');
    expect(script).toContain("begin isolation level serializable read only");
    expect(script).toContain("from public.external_identities");
    expect(script).toContain("from public.memberships");
    expect(script).toContain("from public.platform_audit_events");
    expect(script).toContain("staging_owner_workspace_identity_verify");
    expect(script).toContain("issuer_match");
    expect(script).toContain("subject_match");
    expect(script).toContain('mismatchCode === "S22_ISSUER_MISMATCH"');
    expect(script).toContain('mismatchCode === "S22_SUBJECT_MISMATCH"');
    expect(script).toContain('mismatchCode === "S22_ISSUER_SUBJECT_MISMATCH"');
    expect(script).toContain("staging_owner_auth_role_identity_verify");
    expect(script).toContain("app.resolve_external_identity");
    expect(script).toContain("select set_config('app.organization_id', $1, true)");
    expect(script).not.toContain("row.issuer");
    expect(script).not.toContain("row.subject");
    expect(script).toContain('row.membership_status !== "active"');
    expect(script).toContain('row.membership_role !== "owner"');
    expect(script).not.toMatch(/\binsert\s+into\b/iu);
    expect(script).not.toMatch(
      /\bupdate\s+(?:organizations|users|external_identities|memberships)\b/iu,
    );
    expect(script).not.toMatch(
      /\bdelete\s+from\s+(?:organizations|users|external_identities|memberships)\b/iu,
    );
  });

  it("keeps the workflow keyless, branch-bound, and free of subject output", async () => {
    const workflow = await repositoryFile(".github/workflows/staging-terraform.yml");

    expect(workflow).toContain("google-github-actions/auth@");
    expect(workflow).toContain("refs/heads/verify/s22-staging-recovery-capacity");
    expect(workflow).toContain("secrets.STAGING_OWNER_AUTH0_SUBJECT");
    expect(workflow).toContain("owner-workspace-bootstrap");
    expect(workflow).toContain("owner-workspace-verify");
    expect(workflow).toContain(
      "env.S22_PHASE != 'owner-workspace-bootstrap' && env.S22_ACTION == 'apply'",
    );
    expect(workflow).toContain('[[ "$APPROVAL_TOKEN" == "S22-APPLY-APPROVED" ]]');
    expect(workflow).toContain("lead-agent-staging-migrator");
    expect(workflow).toContain("lastAttemptResult.exitCode");
    expect(workflow).toContain("FAILURE_STAGE=bootstrap_capability");
    expect(workflow).toContain("FAILURE_STAGE=stored_identity_validation");
    expect(workflow).toContain("FAILURE_STAGE=issuer_mismatch");
    expect(workflow).toContain("FAILURE_STAGE=subject_mismatch");
    expect(workflow).toContain("FAILURE_STAGE=issuer_and_subject_mismatch");
    expect(workflow).toContain("FAILURE_STAGE=auth_identity_unmapped");
    expect(workflow).toContain("FAILURE_STAGE=replay_protection");
    expect(workflow).toContain("audit_proof=$BOOTSTRAP_PROOF");
    expect(workflow).toContain("replay_protection=$BOOTSTRAP_PROOF");
    expect(workflow).toContain("database_state_proof=$VERIFY_PROOF");
    expect(workflow).toContain("bootstrap_source_execution_proof=PASS");
    expect(workflow).toContain("S22_OWNER_BOOTSTRAP_MODE=verify");
    expect(workflow).toContain("run.googleapis.com/v2/projects/${PROJECT_ID}");
    expect(workflow).toContain("Array.isArray(tasks?.tasks)");
    expect(workflow).toContain(
      "integration_cards=Website Chat|Telegram Business|Instagram Professional",
    );
    expect(workflow).not.toContain("service_account_key");
    expect(workflow).not.toContain('echo "$OWNER_SUBJECT"');
  });
});
