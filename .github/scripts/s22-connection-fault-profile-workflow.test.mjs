import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import test from "node:test";
import {
  connectionFaultBaseline,
  connectionFaultProfileReceipt,
} from "./s22-connection-fault-profile-plan-check.mjs";
import {
  verifyProfileActivationReceipt,
  verifyProfileWorkflowRequest,
  verifyProfileWorkflowRun,
  verifyProfileRequestReceipt,
} from "./s22-connection-fault-profile-workflow.mjs";
import { syntheticNow, syntheticRawProfile } from "./s22-connection-fault-test-fixtures.mjs";

const environment = (mode = "enable", action = "plan") => ({
  GITHUB_ACTIONS: "true",
  GITHUB_WORKFLOW: "Staging Terraform",
  GITHUB_REPOSITORY: "mufazzalshokh/lead-agent-platform",
  GITHUB_REF_NAME: "verify/s22-staging-recovery-capacity",
  GITHUB_REF: "refs/heads/verify/s22-staging-recovery-capacity",
  GITHUB_WORKFLOW_REF:
    "mufazzalshokh/lead-agent-platform/.github/workflows/staging-terraform.yml@refs/heads/verify/s22-staging-recovery-capacity",
  GITHUB_SHA: "c".repeat(40),
  S22_COMMIT_SHA: "c".repeat(40),
  GITHUB_RUN_ID: "12345",
  S22_PHASE: `connection-fault-${mode}`,
  S22_ACTION: action,
  S22_AI_JOURNEY_MODE: "preserve",
  S22_AI_JOURNEY_WIDGET_SESSION_ID: "",
  S22_API_GIT_COMMIT_SHA: connectionFaultBaseline.api_git_commit_sha,
  S22_API_DEPLOYMENT_TIMESTAMP: connectionFaultBaseline.api_deployment_timestamp,
  S22_RUNTIME_GIT_COMMIT_SHA: connectionFaultBaseline.git_commit_sha,
  S22_RUNTIME_DEPLOYMENT_TIMESTAMP: connectionFaultBaseline.deployment_timestamp,
  S22_MIGRATOR_GIT_COMMIT_SHA: connectionFaultBaseline.migrator_git_commit_sha,
  S22_MIGRATOR_DEPLOYMENT_TIMESTAMP: connectionFaultBaseline.migrator_deployment_timestamp,
  S22_CONNECTION_FAULT_PROFILE: syntheticRawProfile(),
  S22_CONNECTION_FAULT_ACTIVATION_RUN_ID: mode === "remove" ? "98765" : "",
  S22_APPROVAL_TOKEN: action === "apply" ? "S22-APPLY-APPROVED" : "",
  S22_PLAN_RUN_ID: action === "apply" ? "34567" : "",
  S22_APPROVED_PLAN_SHA256: action === "apply" ? "e".repeat(64) : "",
  ...Object.fromEntries(
    Object.entries(connectionFaultBaseline).map(([key, value]) => [`TF_VAR_${key}`, value]),
  ),
});
const run = (env, id = "34567") => ({
  id: Number(id),
  status: "completed",
  conclusion: "success",
  event: "workflow_dispatch",
  path: ".github/workflows/staging-terraform.yml",
  head_sha: env.S22_COMMIT_SHA,
  head_branch: env.GITHUB_REF_NAME,
  repository: { full_name: env.GITHUB_REPOSITORY },
});
for (const mode of ["enable", "remove"])
  for (const action of ["plan", "apply"])
    test(`${mode}/${action} request preserves pins and bounded authority`, () => {
      assert.equal(verifyProfileWorkflowRequest(environment(mode, action), syntheticNow), mode);
    });
for (const key of [
  "GITHUB_ACTIONS",
  "GITHUB_WORKFLOW",
  "GITHUB_REPOSITORY",
  "GITHUB_REF_NAME",
  "GITHUB_REF",
  "GITHUB_WORKFLOW_REF",
  "GITHUB_RUN_ID",
  "GITHUB_SHA",
  "S22_COMMIT_SHA",
  "S22_ACTION",
  "S22_PHASE",
  "S22_AI_JOURNEY_MODE",
  "S22_API_GIT_COMMIT_SHA",
  "S22_API_DEPLOYMENT_TIMESTAMP",
  "S22_RUNTIME_GIT_COMMIT_SHA",
  "S22_RUNTIME_DEPLOYMENT_TIMESTAMP",
  "S22_MIGRATOR_GIT_COMMIT_SHA",
  "S22_MIGRATOR_DEPLOYMENT_TIMESTAMP",
  "S22_AI_JOURNEY_WIDGET_SESSION_ID",
  "S22_AUTH_CALLBACK_REQUEST_ID",
  "S22_MIGRATOR_EXECUTION_ID",
  "S22_APPROVAL_TOKEN",
  "S22_PLAN_RUN_ID",
  "S22_APPROVED_PLAN_SHA256",
  "S22_CONNECTION_FAULT_PROFILE",
  "S22_CONNECTION_FAULT_ACTIVATION_RUN_ID",
])
  test(`denies changed plan request ${key}`, () => {
    const env = environment();
    env[key] = "unapproved-private-value";
    assert.throws(() => verifyProfileWorkflowRequest(env, syntheticNow), {
      message: "S22_CONNECTION_FAULT_PROFILE_WORKFLOW_DENIED",
    });
  });
for (const key of Object.keys(connectionFaultBaseline))
  test(`denies changed runtime variable ${key}`, () => {
    const env = environment();
    env[`TF_VAR_${key}`] = "other";
    assert.throws(() => verifyProfileWorkflowRequest(env, syntheticNow));
  });
for (const key of ["S22_APPROVAL_TOKEN", "S22_PLAN_RUN_ID", "S22_APPROVED_PLAN_SHA256"])
  test(`apply requires exact ${key}`, () => {
    const env = environment("enable", "apply");
    delete env[key];
    assert.throws(() => verifyProfileWorkflowRequest(env, syntheticNow));
  });
test("late enable is denied, but expired removal remains structurally available", () => {
  assert.throws(() => verifyProfileWorkflowRequest(environment(), syntheticNow + 4_000_000));
  assert.equal(
    verifyProfileWorkflowRequest(environment("remove"), syntheticNow + 4_000_000),
    "remove",
  );
  const missing = environment("remove");
  delete missing.S22_CONNECTION_FAULT_ACTIVATION_RUN_ID;
  assert.throws(() => verifyProfileWorkflowRequest(missing, syntheticNow));
});
test("plan provenance rejects unsuccessful, foreign-source and other-workflow runs", () => {
  const env = environment();
  const receipt = run(env);
  assert.equal(verifyProfileWorkflowRun(receipt, env, "34567"), true);
  for (const key of [
    "id",
    "status",
    "conclusion",
    "event",
    "path",
    "head_sha",
    "head_branch",
    "repository",
  ])
    assert.throws(() => verifyProfileWorkflowRun({ ...receipt, [key]: "other" }, env, "34567"));
});
test("the same private profile is frozen across steps within one workflow run", () => {
  const env = environment();
  const receipt = {
    ...connectionFaultProfileReceipt(env.S22_CONNECTION_FAULT_PROFILE),
    mode: "enable",
    tooling_sha: env.S22_COMMIT_SHA,
    workflow_run_id: env.GITHUB_RUN_ID,
  };
  assert.equal(verifyProfileRequestReceipt(receipt, env, "enable"), true);
  for (const key of Object.keys(receipt))
    assert.throws(() =>
      verifyProfileRequestReceipt({ ...receipt, [key]: "changed" }, env, "enable"),
    );
  assert.throws(() => verifyProfileRequestReceipt({ ...receipt, private: "no" }, env, "enable"));
});
const activation = () => {
  const env = environment("remove");
  return {
    env,
    run: run(env, env.S22_CONNECTION_FAULT_ACTIVATION_RUN_ID),
    receipt: {
      ...connectionFaultProfileReceipt(env.S22_CONNECTION_FAULT_PROFILE),
      mode: "enable",
      stage: "verify",
      managedResources: 88,
      changedResources: 0,
      tooling_sha: env.S22_COMMIT_SHA,
      plan_run_id: "34567",
      binary_sha256: "e".repeat(64),
      apply_run_id: env.S22_CONNECTION_FAULT_ACTIVATION_RUN_ID,
    },
  };
};
test("retained activation receipt binds removal to its profile, exact source and authenticated apply run", () => {
  const f = activation();
  assert.deepEqual(
    verifyProfileActivationReceipt(f.run, f.receipt, f.env),
    connectionFaultProfileReceipt(f.env.S22_CONNECTION_FAULT_PROFILE),
  );
  for (const key of Object.keys(f.receipt))
    assert.throws(() =>
      verifyProfileActivationReceipt(f.run, { ...f.receipt, [key]: "other" }, f.env),
    );
  assert.throws(() => verifyProfileActivationReceipt(f.run, { ...f.receipt, extra: true }, f.env));
});
test("failed or interrupted activation does not deadlock exact-profile removal", () => {
  for (const conclusion of ["failure", "cancelled", "timed_out"])
    for (const stage of ["attempted", "applied"]) {
      const f = activation();
      f.run.conclusion = conclusion;
      f.receipt.stage = stage;
      f.receipt.changedResources = null;
      assert.deepEqual(
        verifyProfileActivationReceipt(f.run, f.receipt, f.env),
        connectionFaultProfileReceipt(f.env.S22_CONNECTION_FAULT_PROFILE),
      );
      f.receipt.configuration_sha256 = "0".repeat(64);
      assert.throws(() => verifyProfileActivationReceipt(f.run, f.receipt, f.env));
    }
  const f = activation();
  f.run.conclusion = "failure";
  assert.throws(() => verifyProfileActivationReceipt(f.run, f.receipt, f.env)); // Never call a failed run converged.
});
test("CLI invalid private input emits only finite denial and never starts tooling", () => {
  const env = {
    ...process.env,
    ...environment(),
    S22_CONNECTION_FAULT_PROFILE: "private malformed secret",
  };
  const result = spawnSync(
    process.execPath,
    [".github/scripts/s22-connection-fault-profile-workflow.mjs", "request"],
    { env, encoding: "utf8", timeout: 5000 },
  );
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.equal(
    result.stderr.trim(),
    "S22_CONNECTION_FAULT_PROFILE_WORKFLOW_DENIED\nfailure_stage=request",
  );
});
test("workflow preserves 25 inputs, scopes the secret, and separates profile apply from generic apply", () => {
  const workflow = readFileSync(".github/workflows/staging-terraform.yml", "utf8").replaceAll(
    "\r\n",
    "\n",
  );
  const step = (name) =>
    workflow.split(`      - name: ${name}\n`)[1]?.split(/\n {6}- (?:name|uses):/u)[0];
  assert.equal(workflow.split("\npermissions:")[0].match(/^ {6}[a-z0-9_]+:$/gmu)?.length, 25);
  assert.equal((workflow.match(/secrets\.S22_CONNECTION_FAULT_PROFILE/gu) ?? []).length, 3);
  assert.ok(
    step("Set up Terraform")?.includes(
      "terraform_wrapper: ${{ inputs.phase != 'connection-fault-enable' && inputs.phase != 'connection-fault-remove' }}",
    ),
  );
  for (const name of [
    "Validate connection-fault profile request and provenance",
    "Create bounded connection-fault profile plan",
    "Apply bounded connection-fault profile and verify convergence",
  ]) {
    const text = step(name);
    assert.ok(text?.includes("env.S22_PHASE == 'connection-fault-enable'"));
    assert.ok(text?.includes("secrets.S22_CONNECTION_FAULT_PROFILE"));
  }
  assert.ok(
    workflow.indexOf("- name: Validate connection-fault profile request and provenance") <
      workflow.indexOf("- name: Authenticate to Google Cloud without a key"),
  );
  assert.ok(
    step("Set up Node.js for connection-fault profile tooling")?.includes(
      "node-version-file: .node-version",
    ),
  );
  assert.ok(
    workflow.indexOf("- name: Set up Node.js for connection-fault profile tooling") <
      workflow.indexOf("- name: Validate connection-fault profile request and provenance"),
  );
  for (const name of [
    "Create reviewed plan",
    "Apply exact reviewed plan",
    "Record deployment provenance",
  ]) {
    assert.ok(
      step(name)?.includes(
        "env.S22_PHASE != 'connection-fault-enable' && env.S22_PHASE != 'connection-fault-remove'",
      ),
    );
  }
  for (const name of [
    "Execute one-shot migrator",
    "Verify migrated staging database",
    "Run bounded migration failure diagnostics",
  ]) {
    assert.ok(
      !step(name)
        ?.split("\n")
        .find((line) => line.includes("if:"))
        ?.includes("connection-fault-enable"),
    );
  }
  const code = readFileSync(".github/scripts/s22-connection-fault-profile-workflow.mjs", "utf8");
  assert.ok(code.includes('"-auto-approve", "s22.tfplan"'));
  assert.ok(code.indexOf('inspect("s22.tfplan", "plan")') < code.indexOf('terraform(["apply"'));
  assert.ok(code.indexOf('applicationReceipt("attempted")') < code.indexOf('terraform(["apply"'));
  assert.ok(!code.includes("GITHUB_ENV="));
});
test("the actual workflow boundary/resolver produces the pinned profile request without exporting private data", () => {
  const workflow = readFileSync(".github/workflows/staging-terraform.yml", "utf8").replaceAll(
    "\r\n",
    "\n",
  );
  const terraformJob = workflow.split("  terraform:\n")[1];
  assert.ok(terraformJob);
  const boundary = terraformJob
    .split("      - name: Validate request boundary\n")[1]
    .split("      - name: Check out exact commit\n")[0];
  const script = boundary
    .split("        run: |\n")[1]
    .split("\n")
    .map((line) => (line.startsWith("          ") ? line.slice(10) : line))
    .join("\n");
  const temporary = mkdtempSync(join(tmpdir(), "s22-profile-boundary-"));
  try {
    for (const mode of ["enable", "remove"])
      for (const action of ["plan", "apply"]) {
        const env = { ...process.env, ...environment(mode, action) };
        const exportPath = join(temporary, `${mode}-${action}.env`);
        Object.assign(env, {
          ACTION: action,
          PHASE: env.S22_PHASE,
          REQUESTED_SHA: env.S22_COMMIT_SHA,
          DISPATCH_REF: env.GITHUB_REF,
          APPROVAL_TOKEN: env.S22_APPROVAL_TOKEN,
          PLAN_RUN_ID: env.S22_PLAN_RUN_ID,
          APPROVED_PLAN_SHA256: env.S22_APPROVED_PLAN_SHA256,
          GITHUB_ENV: exportPath.replaceAll("\\", "/"),
          TF_VAR_git_commit_sha: env.S22_COMMIT_SHA,
          TF_VAR_deployment_timestamp: "",
        });
        const result = spawnSync(
          process.platform === "win32" ? "C:/Program Files/Git/bin/bash.exe" : "bash",
          ["--noprofile", "--norc", "-s"],
          { env, input: script, encoding: "utf8", timeout: 10_000 },
        );
        assert.equal(result.status, 0, result.stderr);
        const exported = readFileSync(exportPath, "utf8");
        for (const line of exported.trim().split(/\r?\n/u)) {
          const split = line.indexOf("=");
          env[line.slice(0, split)] = line.slice(split + 1);
        }
        assert.equal(verifyProfileWorkflowRequest(env, syntheticNow), mode);
        assert.equal(exported.includes(env.S22_CONNECTION_FAULT_PROFILE), false);
        assert.equal(exported.includes("sessionDigest"), false);
      }
  } finally {
    assert.equal(dirname(resolve(temporary)), resolve(tmpdir()));
    assert.ok(basename(temporary).startsWith("s22-profile-boundary-"));
    rmSync(temporary, { recursive: true, force: true });
  }
});
test("Terraform keeps sensitive values out of iteration keys and CI has no cloud authentication", () => {
  const runtime = readFileSync("infra/deploy/gcp/staging/runtime.tf", "utf8");
  assert.ok(
    runtime.includes(
      'for_each = var.s22_connection_fault_enabled ? toset(["S22_CONNECTION_FAULT_PROFILE", "GOOGLE_CLOUD_PROJECT", "GOOGLE_CLOUD_REGION"]) : toset([])',
    ),
  );
  assert.ok(runtime.includes("value = local.connection_fault_env[env.value]"));
  assert.ok(!runtime.includes("nonsensitive("));
  const ci = readFileSync(".github/workflows/ci.yml", "utf8");
  assert.ok(ci.includes("init -backend=false -input=false -lockfile=readonly"));
  assert.ok(ci.includes("s22-connection-fault-terraform-check.mjs"));
  assert.ok(!ci.includes("google-github-actions/auth") && !ci.includes("id-token: write"));
});
