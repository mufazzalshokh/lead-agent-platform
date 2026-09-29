import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const repositoryFile = (path: string): Promise<string> =>
  readFile(resolve(process.cwd(), path), "utf8");

describe("S22 staging first-owner bootstrap", () => {
  it("binds only one exact Auth0 subject to one synthetic active owner workspace", async () => {
    const script = await repositoryFile(".github/scripts/s22-staging-owner-bootstrap.mjs");

    expect(script).toContain("STAGING_AUTH0_ISSUER");
    expect(script).toContain("STAGING_OWNER_AUTH0_SUBJECT");
    expect(script).toContain("^google-oauth2\\|[0-9]{1,128}$");
    expect(script).toContain('await import("pg")');
    expect(script).toContain("withLibpqCompatibleRequireSsl");
    expect(script).not.toMatch(/^import\s/mu);
    expect(script).toContain("bootstrap().catch((error) =>");
    expect(script).not.toContain("await bootstrap()");
    expect(script).toContain("begin isolation level serializable");
    expect(script).toContain("Conflicting staging tenant or identity data exists");
    expect(script).toContain("role='owner' and status='active' and location_scope='all'");
    expect(script).toContain('identity_binding: "exact_issuer_subject"');
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
    expect(workflow).toContain(
      "env.S22_PHASE != 'owner-workspace-bootstrap' && env.S22_ACTION == 'apply'",
    );
    expect(workflow).toContain('[[ "$APPROVAL_TOKEN" == "S22-APPLY-APPROVED" ]]');
    expect(workflow).toContain("lead-agent-staging-migrator");
    expect(workflow).not.toContain("service_account_key");
    expect(workflow).not.toContain('echo "$OWNER_SUBJECT"');
  });
});
