import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  connectionFaultBaseline,
  connectionFaultProfileReceipt,
  verifyConnectionFaultProfileArtifact,
  verifyConnectionFaultProfilePlan,
} from "./s22-connection-fault-profile-plan-check.mjs";
import { validateConnectionFaultProfile } from "./s22-connection-fault-profile.mjs";
import {
  verifyConnectionFaultCodeManifest,
  verifyConnectionFaultCodeRun,
} from "./s22-connection-fault-code-plan-check.mjs";

const denied = () => {
  throw new Error("S22_CONNECTION_FAULT_PROFILE_WORKFLOW_DENIED");
};
const safe = (condition) => {
  if (!condition) denied();
};
const hash = (value) => createHash("sha256").update(value).digest("hex");
const numeric = (value) => typeof value === "string" && /^[1-9][0-9]*$/u.test(value);
const checksum = (value) => typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
const directory = "infra/deploy/gcp/staging";
const planPath = `${directory}/s22.tfplan`;
const planReceiptPath = `${directory}/s22-connection-fault-profile-plan-evidence.json`;
const applyReceiptPath = `${directory}/s22-connection-fault-profile-apply-evidence.json`;
const requestReceiptPath = `${directory}/s22-connection-fault-profile-request-evidence.json`;
const buildRunId = "41228545634";
const buildToolingSha = "621047b3291e41362dd74266dc1e989f7c763aa9";
class ProfileWorkflowFailure extends Error {
  constructor(stage, status) {
    super("S22_CONNECTION_FAULT_PROFILE_WORKFLOW_DENIED");
    this.stage = stage;
    this.toolExit = Number.isInteger(status) && status >= 0 && status <= 255 ? status : null;
  }
}

export function verifyProfileWorkflowRequest(env, now = Date.now()) {
  try {
    safe(env.GITHUB_ACTIONS === "true" && env.GITHUB_WORKFLOW === "Staging Terraform");
    safe(env.GITHUB_REPOSITORY === "mufazzalshokh/lead-agent-platform");
    safe(numeric(env.GITHUB_RUN_ID));
    safe(["main", "verify/s22-staging-recovery-capacity"].includes(env.GITHUB_REF_NAME));
    safe(env.GITHUB_REF === `refs/heads/${env.GITHUB_REF_NAME}`);
    safe(
      env.GITHUB_WORKFLOW_REF ===
        `${env.GITHUB_REPOSITORY}/.github/workflows/staging-terraform.yml@${env.GITHUB_REF}`,
    );
    safe(/^[a-f0-9]{40}$/u.test(env.S22_COMMIT_SHA ?? "") && env.GITHUB_SHA === env.S22_COMMIT_SHA);
    safe(["plan", "apply"].includes(env.S22_ACTION));
    safe(["connection-fault-enable", "connection-fault-remove"].includes(env.S22_PHASE));
    safe(env.S22_AI_JOURNEY_MODE === "preserve" && !env.S22_AI_JOURNEY_WIDGET_SESSION_ID);
    safe(!env.S22_AUTH_CALLBACK_REQUEST_ID && !env.S22_MIGRATOR_EXECUTION_ID);
    for (const [key, value] of Object.entries(connectionFaultBaseline)) {
      if (key.startsWith("ai_journey_") && env[`TF_VAR_${key}`] === undefined) continue; // Resolved independently from state before planning.
      safe(env[`TF_VAR_${key}`] === value);
    }
    for (const [key, value] of Object.entries({
      S22_API_GIT_COMMIT_SHA: connectionFaultBaseline.api_git_commit_sha,
      S22_API_DEPLOYMENT_TIMESTAMP: connectionFaultBaseline.api_deployment_timestamp,
      S22_RUNTIME_GIT_COMMIT_SHA: connectionFaultBaseline.git_commit_sha,
      S22_RUNTIME_DEPLOYMENT_TIMESTAMP: connectionFaultBaseline.deployment_timestamp,
      S22_MIGRATOR_GIT_COMMIT_SHA: connectionFaultBaseline.migrator_git_commit_sha,
      S22_MIGRATOR_DEPLOYMENT_TIMESTAMP: connectionFaultBaseline.migrator_deployment_timestamp,
    }))
      safe(env[key] === value);
    if (env.S22_ACTION === "plan")
      safe(!env.S22_APPROVAL_TOKEN && !env.S22_PLAN_RUN_ID && !env.S22_APPROVED_PLAN_SHA256);
    else
      safe(
        env.S22_APPROVAL_TOKEN === "S22-APPLY-APPROVED" &&
          numeric(env.S22_PLAN_RUN_ID) &&
          checksum(env.S22_APPROVED_PLAN_SHA256),
      );
    const mode = env.S22_PHASE === "connection-fault-enable" ? "enable" : "remove";
    validateConnectionFaultProfile(
      env.S22_CONNECTION_FAULT_PROFILE,
      mode === "enable" ? now : undefined,
    );
    if (mode === "remove") safe(numeric(env.S22_CONNECTION_FAULT_ACTIVATION_RUN_ID));
    else safe(!env.S22_CONNECTION_FAULT_ACTIVATION_RUN_ID);
    return mode;
  } catch {
    denied();
  }
}

export function verifyProfileWorkflowRun(run, env, runId, kind = "plan") {
  safe(["plan", "activation", "ci"].includes(kind));
  safe(run.repository?.full_name === env.GITHUB_REPOSITORY);
  safe(run.status === "completed" && String(run.id) === runId);
  safe(
    kind === "activation"
      ? ["success", "failure", "cancelled", "timed_out"].includes(run.conclusion)
      : run.conclusion === "success",
  );
  safe(run.head_sha === env.S22_COMMIT_SHA && run.head_branch === env.GITHUB_REF_NAME);
  safe(run.path === `.github/workflows/${kind === "ci" ? "ci" : "staging-terraform"}.yml`);
  safe(
    kind === "ci"
      ? ["pull_request", "push"].includes(run.event)
      : run.event === "workflow_dispatch",
  );
  return true;
}

export function verifyProfileRequestReceipt(receipt, env, mode) {
  const expected = {
    ...connectionFaultProfileReceipt(env.S22_CONNECTION_FAULT_PROFILE),
    mode,
    tooling_sha: env.S22_COMMIT_SHA,
    workflow_run_id: env.GITHUB_RUN_ID,
  };
  safe(Object.keys(receipt).length === Object.keys(expected).length);
  for (const [key, value] of Object.entries(expected)) safe(receipt[key] === value);
  return true;
}

export function verifyProfileActivationReceipt(run, receipt, env) {
  verifyProfileWorkflowRun(run, env, env.S22_CONNECTION_FAULT_ACTIVATION_RUN_ID, "activation");
  const identity = connectionFaultProfileReceipt(env.S22_CONNECTION_FAULT_PROFILE);
  const expectedKeys = [
    ...Object.keys(identity),
    "mode",
    "stage",
    "managedResources",
    "changedResources",
    "tooling_sha",
    "plan_run_id",
    "binary_sha256",
    "apply_run_id",
  ];
  safe(
    Object.keys(receipt).length === expectedKeys.length &&
      expectedKeys.every((key) => Object.hasOwn(receipt, key)),
  );
  safe(receipt.mode === "enable" && receipt.managedResources === 88);
  safe(
    receipt.stage === "verify"
      ? receipt.changedResources === 0 && run.conclusion === "success"
      : ["attempted", "applied"].includes(receipt.stage) && receipt.changedResources === null,
  );
  safe(
    receipt.tooling_sha === env.S22_COMMIT_SHA &&
      receipt.apply_run_id === env.S22_CONNECTION_FAULT_ACTIVATION_RUN_ID,
  );
  safe(numeric(receipt.plan_run_id) && checksum(receipt.binary_sha256));
  for (const [key, value] of Object.entries(identity)) safe(receipt[key] === value);
  return identity;
}

function maskProfile(raw) {
  const value = JSON.parse(raw); // Already validated; no parser diagnostics are emitted.
  const escape = (text) =>
    text.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A");
  for (const privateValue of [
    raw,
    value.sessionDigest,
    value.baselineAt,
    value.faultAt,
    value.expiresAt,
  ])
    process.stdout.write(`::add-mask::${escape(privateValue)}\n`);
}

export function runProfileWorkflow(command, env = process.env) {
  safe(["request", "plan", "apply"].includes(command));
  const mode = verifyProfileWorkflowRequest(env);
  safe(command === "request" || command === env.S22_ACTION);
  maskProfile(env.S22_CONNECTION_FAULT_PROFILE);
  const temporary = mkdtempSync(join(tmpdir(), "s22-profile-"));
  let failureStage = "request";
  try {
    const execute = (program, args, childEnv = env, timeout = 60_000) =>
      execFileSync(program, args, {
        env: childEnv,
        encoding: "utf8",
        stdio: "pipe",
        windowsHide: true,
        timeout,
        maxBuffer: 64 * 1024 * 1024,
      });
    const api = (route) =>
      JSON.parse(execute("gh", ["api", `repos/${env.GITHUB_REPOSITORY}/${route}`]));
    const download = (runId, name, destination) =>
      execute("gh", [
        "run",
        "download",
        runId,
        "--repo",
        env.GITHUB_REPOSITORY,
        "--name",
        name,
        "--dir",
        destination,
      ]);
    if (command === "request") {
      failureStage = "private_repository";
      const repository = JSON.parse(execute("gh", ["api", `repos/${env.GITHUB_REPOSITORY}`]));
      safe(repository.full_name === env.GITHUB_REPOSITORY && repository.private === true);
      failureStage = "source_ci";
      const runs = api(
        `actions/workflows/ci.yml/runs?head_sha=${env.S22_COMMIT_SHA}&per_page=10`,
      ).workflow_runs;
      safe(
        Array.isArray(runs) &&
          runs.some((run) => {
            try {
              return verifyProfileWorkflowRun(run, env, String(run.id), "ci");
            } catch {
              return false;
            }
          }),
      );
      // Reuse the reviewed, already-deployed API build; do not rebuild the app.
      failureStage = "deployed_build";
      const buildEnv = {
        ...env,
        GITHUB_REF_NAME: "verify/s22-staging-recovery-capacity",
        S22_COMMIT_SHA: buildToolingSha,
        S22_CONNECTION_FAULT_BUILD_RUN_ID: buildRunId,
      };
      verifyConnectionFaultCodeRun(api(`actions/runs/${buildRunId}`), buildEnv, "build");
      download(
        buildRunId,
        `s22-image-manifest-${connectionFaultBaseline.api_git_commit_sha}-${buildRunId}`,
        temporary,
      );
      verifyConnectionFaultCodeManifest(
        readFileSync(join(temporary, "s22-image-manifest.txt"), "utf8"),
        buildEnv,
      );
      writeFileSync(
        requestReceiptPath,
        JSON.stringify({
          ...connectionFaultProfileReceipt(env.S22_CONNECTION_FAULT_PROFILE),
          mode,
          tooling_sha: env.S22_COMMIT_SHA,
          workflow_run_id: env.GITHUB_RUN_ID,
        }) + "\n",
        { mode: 0o600 },
      );
      console.log("connection_fault_profile_request=PASS; exact_ci_and_deployed_build=PASS");
      return;
    }
    failureStage = "profile_binding";
    verifyProfileRequestReceipt(JSON.parse(readFileSync(requestReceiptPath, "utf8")), env, mode);
    let activationReceipt;
    if (mode === "remove") {
      failureStage = "activation_receipt";
      const id = env.S22_CONNECTION_FAULT_ACTIVATION_RUN_ID;
      const run = api(`actions/runs/${id}`);
      download(id, `s22-connection-fault-profile-apply-${id}`, temporary);
      activationReceipt = verifyProfileActivationReceipt(
        run,
        JSON.parse(
          readFileSync(join(temporary, "s22-connection-fault-profile-apply-evidence.json"), "utf8"),
        ),
        env,
      );
    }
    const childEnv = {
      ...env,
      TF_VAR_s22_connection_fault_enabled: mode === "enable" ? "true" : "false",
      TF_VAR_s22_connection_fault_profile:
        mode === "enable" ? env.S22_CONNECTION_FAULT_PROFILE : "",
    };
    // No raw profile is written to source files, GITHUB_ENV, step outputs or summaries.
    const terraform = (args, timeout) =>
      execute("terraform", [`-chdir=${directory}`, ...args], childEnv, timeout);
    const inspect = (filename, stage) =>
      verifyConnectionFaultProfilePlan(
        JSON.parse(terraform(["show", "-json", filename])),
        JSON.parse(terraform(["providers", "schema", "-json"])),
        {
          mode,
          stage,
          rawProfile: env.S22_CONNECTION_FAULT_PROFILE,
          activationReceipt,
          now: Date.now(),
        },
      );
    if (command === "plan") {
      failureStage = "plan_create";
      terraform(["plan", "-lock-timeout=5m", "-out=s22.tfplan"], 600_000);
      failureStage = "plan_inspect";
      const result = inspect("s22.tfplan", "plan");
      const binaryHash = hash(readFileSync(planPath));
      safe(numeric(env.GITHUB_RUN_ID));
      writeFileSync(`${planPath}.sha256`, `${binaryHash}  s22.tfplan\n`, { mode: 0o600 });
      writeFileSync(
        planReceiptPath,
        JSON.stringify({
          ...result,
          tooling_sha: env.S22_COMMIT_SHA,
          plan_run_id: env.GITHUB_RUN_ID,
          binary_sha256: binaryHash,
        }) + "\n",
        { mode: 0o600 },
      );
      console.log(
        `connection_fault_profile_plan=PASS; configurations=88; changes=1; sha256=${binaryHash}`,
      );
      return;
    }
    failureStage = "plan_provenance";
    const savedReceipt = JSON.parse(readFileSync(planReceiptPath, "utf8"));
    const planRun = api(`actions/runs/${env.S22_PLAN_RUN_ID}`);
    verifyProfileWorkflowRun(planRun, env, env.S22_PLAN_RUN_ID);
    const binary = readFileSync(planPath);
    failureStage = "binary_approval";
    verifyConnectionFaultProfileArtifact(binary, savedReceipt, planRun, {
      mode,
      approval: env.S22_APPROVAL_TOKEN,
      toolingSha: env.S22_COMMIT_SHA,
      approvedSha256: env.S22_APPROVED_PLAN_SHA256,
      planRunId: env.S22_PLAN_RUN_ID,
      branch: env.GITHUB_REF_NAME,
      rawProfile: env.S22_CONNECTION_FAULT_PROFILE,
    });
    safe(
      savedReceipt.tooling_sha === env.S22_COMMIT_SHA &&
        savedReceipt.plan_run_id === env.S22_PLAN_RUN_ID &&
        savedReceipt.binary_sha256 === env.S22_APPROVED_PLAN_SHA256,
    );
    failureStage = "plan_inspect";
    const inspected = inspect("s22.tfplan", "plan");
    for (const [key, value] of Object.entries(inspected)) safe(savedReceipt[key] === value);
    // No replanning before apply; execute exactly the independently inspected binary.
    // Capture all Terraform diagnostics, which could otherwise include private fragments.
    safe(numeric(env.GITHUB_RUN_ID));
    const applicationReceipt = (stage) => ({
      ...connectionFaultProfileReceipt(env.S22_CONNECTION_FAULT_PROFILE),
      mode,
      stage,
      managedResources: 88,
      changedResources: null,
      tooling_sha: env.S22_COMMIT_SHA,
      plan_run_id: env.S22_PLAN_RUN_ID,
      binary_sha256: hash(binary),
      apply_run_id: env.GITHUB_RUN_ID,
    });
    // Preserve the approved attempt before mutation. A failed/ambiguous apply or
    // failed convergence must not require another activation merely to clean up.
    writeFileSync(applyReceiptPath, JSON.stringify(applicationReceipt("attempted")) + "\n", {
      mode: 0o600,
    });
    failureStage = "apply";
    terraform(["apply", "-lock-timeout=5m", "-auto-approve", "s22.tfplan"], 1_200_000);
    writeFileSync(applyReceiptPath, JSON.stringify(applicationReceipt("applied")) + "\n", {
      mode: 0o600,
    });
    failureStage = "convergence";
    terraform(
      [
        "plan",
        "-detailed-exitcode",
        "-lock-timeout=5m",
        "-out=s22-connection-fault-profile-convergence.tfplan",
      ],
      600_000,
    );
    const result = inspect("s22-connection-fault-profile-convergence.tfplan", "verify");
    safe(numeric(env.GITHUB_RUN_ID));
    writeFileSync(
      applyReceiptPath,
      JSON.stringify({
        ...result,
        tooling_sha: env.S22_COMMIT_SHA,
        plan_run_id: env.S22_PLAN_RUN_ID,
        binary_sha256: hash(binary),
        apply_run_id: env.GITHUB_RUN_ID,
      }) + "\n",
      { mode: 0o600 },
    );
    console.log(
      `connection_fault_profile_${mode}=PASS; configurations=88; remaining_changes=0; live_exercise=NOT_RUN`,
    );
  } catch (error) {
    throw new ProfileWorkflowFailure(failureStage, error?.status);
  } finally {
    // Exact task-owned temp directory only; never touch backend state or artifacts.
    safe(
      dirname(resolve(temporary)) === resolve(tmpdir()) &&
        basename(temporary).startsWith("s22-profile-"),
    );
    rmSync(temporary, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    safe(process.argv.length === 3);
    runProfileWorkflow(process.argv[2]);
  } catch (error) {
    console.error("S22_CONNECTION_FAULT_PROFILE_WORKFLOW_DENIED");
    console.error(
      `failure_stage=${error instanceof ProfileWorkflowFailure ? error.stage : "request"}`,
    );
    if (error instanceof ProfileWorkflowFailure && error.toolExit !== null)
      console.error(`tool_exit_code=${error.toolExit}`);
    process.exitCode = 1;
  }
}
