import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { comparableResourceConfiguration } from "./s22-full-runtime-config-check.mjs";
import { monitoringProfile as baseline } from "./s22-monitoring-plan-check.mjs";

export const connectionFaultCodeSource = "7a4201c824be3db2396b51c14d62e6758f43e860";
const provider = "registry.terraform.io/hashicorp/google";
const registry = "me-central1-docker.pkg.dev/lead-agent-stg-739284/lead-agent";
const api = "google_cloud_run_v2_service.api[0]";
const workloads = new Map([
  [api, "api"],
  ["google_cloud_run_v2_service.web[0]", "web"],
  ["google_cloud_run_v2_worker_pool.worker[0]", "worker"],
  ["google_cloud_run_v2_job.migrator[0]", "migrator"],
]);
const safe = (condition) => {
  if (!condition) throw new Error("S22_CONNECTION_FAULT_CODE_PLAN_DENIED");
};
const same = (left, right) => safe(isDeepStrictEqual(left, right));
const timestamp = (value) =>
  typeof value === "string" &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u.test(value) &&
  Number.isFinite(Date.parse(value)) &&
  new Date(value).toISOString() === value.replace("Z", ".000Z");

function releaseVariables(variables) {
  safe(variables.api_git_commit_sha === connectionFaultCodeSource);
  safe(timestamp(variables.api_deployment_timestamp));
  safe(
    new RegExp(`^${registry.replaceAll(".", "\\.")}/api@sha256:[a-f0-9]{64}$`, "u").test(
      variables.api_image,
    ),
  );
  safe(variables.api_image !== baseline.api_image);
  for (const [key, value] of Object.entries(baseline)) {
    if (key === "api_image") continue;
    safe(variables[key] === value);
  }
  safe(variables.migrator_git_commit_sha === baseline.git_commit_sha);
  safe(variables.migrator_deployment_timestamp === baseline.deployment_timestamp);
}

export function verifyConnectionFaultCodeRequest(environment) {
  safe(environment.S22_PHASE === "connection-fault-code");
  safe(["plan", "apply"].includes(environment.S22_ACTION));
  safe(/^[a-f0-9]{40}$/u.test(environment.S22_COMMIT_SHA ?? ""));
  safe(/^[1-9][0-9]*$/u.test(environment.S22_CONNECTION_FAULT_BUILD_RUN_ID ?? ""));
  safe(environment.S22_RUNTIME_GIT_COMMIT_SHA === baseline.git_commit_sha);
  safe(environment.S22_RUNTIME_DEPLOYMENT_TIMESTAMP === baseline.deployment_timestamp);
  safe(environment.S22_API_GIT_COMMIT_SHA === connectionFaultCodeSource);
  safe(environment.S22_MIGRATOR_GIT_COMMIT_SHA === baseline.git_commit_sha);
  safe(environment.S22_MIGRATOR_DEPLOYMENT_TIMESTAMP === baseline.deployment_timestamp);
  safe(environment.S22_AI_JOURNEY_MODE === "preserve");
  safe(!environment.S22_AI_JOURNEY_WIDGET_SESSION_ID);
  safe(!environment.S22_MIGRATOR_EXECUTION_ID && !environment.S22_AUTH_CALLBACK_REQUEST_ID);
  // The AI binding is independently resolved from state after this pre-auth gate.
  releaseVariables({
    ...Object.fromEntries(Object.keys(baseline).map((key) => [key, environment[`TF_VAR_${key}`]])),
    ai_journey_mode: baseline.ai_journey_mode,
    ai_journey_widget_session_id: baseline.ai_journey_widget_session_id,
    api_git_commit_sha: environment.TF_VAR_api_git_commit_sha,
    api_deployment_timestamp: environment.TF_VAR_api_deployment_timestamp,
    migrator_git_commit_sha: environment.TF_VAR_migrator_git_commit_sha,
    migrator_deployment_timestamp: environment.TF_VAR_migrator_deployment_timestamp,
  });
  if (environment.S22_ACTION === "plan") {
    safe(environment.GITHUB_SHA === environment.S22_COMMIT_SHA);
    safe(
      !environment.S22_APPROVAL_TOKEN &&
        !environment.S22_PLAN_RUN_ID &&
        !environment.S22_APPROVED_PLAN_SHA256,
    );
  } else {
    safe(environment.S22_APPROVAL_TOKEN === "S22-APPLY-APPROVED");
    safe(/^[1-9][0-9]*$/u.test(environment.S22_PLAN_RUN_ID ?? ""));
    safe(/^[a-f0-9]{64}$/u.test(environment.S22_APPROVED_PLAN_SHA256 ?? ""));
  }
  return true;
}

export function verifyConnectionFaultCodeRun(receipt, environment, kind = "plan") {
  safe(["plan", "build"].includes(kind));
  safe(["main", "verify/s22-staging-recovery-capacity"].includes(environment.GITHUB_REF_NAME));
  safe(receipt.status === "completed" && receipt.conclusion === "success");
  safe(receipt.event === "workflow_dispatch");
  safe(receipt.head_sha === environment.S22_COMMIT_SHA);
  safe(receipt.head_branch === environment.GITHUB_REF_NAME);
  safe(
    String(receipt.id) ===
      (kind === "build"
        ? environment.S22_CONNECTION_FAULT_BUILD_RUN_ID
        : environment.S22_PLAN_RUN_ID),
  );
  safe(
    receipt.path === `.github/workflows/staging-${kind === "build" ? "images" : "terraform"}.yml`,
  );
  safe(receipt.repository?.full_name === "mufazzalshokh/lead-agent-platform");
  return true;
}

export function verifyConnectionFaultCodeManifest(source, environment) {
  safe(typeof source === "string" && source.length < 4096);
  const pairs = source
    .trim()
    .split(/\r?\n/u)
    .map((line) => {
      safe(/^[a-z_]+=[^\r\n=]+$/u.test(line));
      return line.split("=");
    });
  same(Object.fromEntries(pairs), {
    build_run_id: environment.S22_CONNECTION_FAULT_BUILD_RUN_ID,
    source_commit: connectionFaultCodeSource,
    artifact_registry: registry,
    architecture: "linux/amd64",
    image_scope: "api",
    api_digest: environment.TF_VAR_api_image?.split("@")[1],
    api_reference: environment.TF_VAR_api_image,
  });
  safe(pairs.length === 7 && new Set(pairs.map(([key]) => key)).size === 7);
  return true;
}

function inventory(module) {
  safe(module !== null && typeof module === "object");
  const result = (module.resources ?? [])
    .filter((row) => row.mode === "managed")
    .map((row) => row.address);
  for (const child of module.child_modules ?? []) result.push(...inventory(child));
  safe(result.length <= 88 && result.every((value) => typeof value === "string"));
  safe(new Set(result).size === result.length);
  return result.sort();
}

function container(value, workload) {
  safe(value.template?.length === 1);
  const template = workload === "migrator" ? value.template[0].template : value.template;
  safe(template?.length === 1 && template[0].containers?.length === 1);
  safe(Array.isArray(template[0].containers[0].env));
  return template[0].containers[0];
}

function runtimePins(value, workload, variables, updated) {
  safe(value.project === baseline.project_id && value.location === baseline.region);
  safe(value.name === `lead-agent-staging-${workload}`);
  const image = workload === "api" && updated ? variables.api_image : baseline[`${workload}_image`];
  const sha = workload === "api" && updated ? connectionFaultCodeSource : baseline.git_commit_sha;
  const time =
    workload === "api" && updated
      ? variables.api_deployment_timestamp
      : baseline.deployment_timestamp;
  safe(value.labels?.["git-sha"] === sha.slice(0, 12));
  safe(value.labels?.["migration-head"] === baseline.migration_head.replaceAll("_", "-"));
  const current = container(value, workload);
  safe(current.image === image);
  const entries = new Map(current.env.map((entry) => [entry.name, entry]));
  safe(entries.size === current.env.length);
  for (const key of ["S22_CONNECTION_FAULT_PROFILE", "GOOGLE_CLOUD_PROJECT", "GOOGLE_CLOUD_REGION"])
    safe(!entries.has(key));
  const expected = {
    DEPLOYMENT_ENVIRONMENT: "staging",
    DEPLOYMENT_GIT_SHA: sha,
    DEPLOYMENT_TIMESTAMP: time,
    DEPLOYMENT_MIGRATION_HEAD: baseline.migration_head,
    ...(["api", "migrator"].includes(workload) ? { DEPLOYMENT_IMAGE_DIGEST: image } : {}),
    ...(workload === "worker"
      ? {
          AI_JOURNEY_MODE: baseline.ai_journey_mode,
          AI_JOURNEY_WIDGET_SESSION_ID: baseline.ai_journey_widget_session_id,
        }
      : {}),
  };
  for (const [key, value] of Object.entries(expected))
    safe(entries.get(key)?.value === value && !entries.get(key)?.value_source?.length);
}

function updatedApi(before, variables) {
  const expected = structuredClone(before);
  expected.labels["git-sha"] = connectionFaultCodeSource.slice(0, 12);
  const current = container(expected, "api");
  current.image = variables.api_image;
  for (const entry of current.env) {
    if (entry.name === "DEPLOYMENT_GIT_SHA") entry.value = connectionFaultCodeSource;
    if (entry.name === "DEPLOYMENT_TIMESTAMP") entry.value = variables.api_deployment_timestamp;
    if (entry.name === "DEPLOYMENT_IMAGE_DIGEST") entry.value = variables.api_image;
  }
  return expected;
}

export function verifyConnectionFaultCodePlan(plan, providerSchema, mode = "plan", environment) {
  safe(["plan", "verify"].includes(mode));
  safe(plan?.format_version === "1.2" && plan.terraform_version === "1.14.7");
  safe(!plan.errored && (plan.deferred_changes?.length ?? 0) === 0);
  const variables = Object.fromEntries(
    Object.entries(plan.variables ?? {}).map(([key, field]) => [key, field.value]),
  );
  releaseVariables(variables);
  // Bind the binary to the request as well as the authenticated image artifact.
  if (environment) {
    for (const key of ["api_image", "api_git_commit_sha", "api_deployment_timestamp"])
      safe(variables[key] === environment[`TF_VAR_${key}`]);
  }
  const schemas = providerSchema?.provider_schemas?.[provider]?.resource_schemas;
  safe(schemas !== undefined && Array.isArray(plan.resource_changes));
  const seen = new Set();
  const managed = [];
  let changed = 0;
  for (const row of plan.resource_changes) {
    safe(row.provider_name === provider && !seen.has(row.address) && !row.previous_address);
    seen.add(row.address);
    if (row.mode === "data") {
      safe(row.address === "data.google_project.staging" && row.type === "google_project");
      safe(["read", "no-op"].some((action) => isDeepStrictEqual(row.change.actions, [action])));
      continue;
    }
    safe(row.mode === "managed" && (row.change.replace_paths?.length ?? 0) === 0);
    managed.push(row.address);
    const block = schemas[row.type]?.block;
    safe(block !== undefined);
    const before = comparableResourceConfiguration(row.change.before, block);
    const after = comparableResourceConfiguration(
      row.change.after,
      block,
      row.change.after_unknown,
    );
    const workload = workloads.get(row.address);
    if (workload) {
      safe(
        row.type ===
          (workload === "worker"
            ? "google_cloud_run_v2_worker_pool"
            : workload === "migrator"
              ? "google_cloud_run_v2_job"
              : "google_cloud_run_v2_service"),
      );
      runtimePins(before, workload, variables, mode === "verify");
      runtimePins(after, workload, variables, true);
    }
    if (row.address === api && mode === "plan") {
      same(row.change.actions, ["update"]);
      same(after, updatedApi(before, variables));
      changed++;
    } else {
      same(row.change.actions, ["no-op"]);
      same(before, after);
    }
  }
  managed.sort();
  safe(managed.length === 88 && [...workloads.keys()].every((address) => seen.has(address)));
  same(managed, inventory(plan.prior_state?.values?.root_module));
  same(managed, inventory(plan.planned_values?.root_module));
  const driftSeen = new Set();
  for (const row of plan.resource_drift ?? []) {
    safe(
      row.mode === "managed" &&
        row.provider_name === provider &&
        managed.includes(row.address) &&
        !driftSeen.has(row.address),
    );
    driftSeen.add(row.address);
    safe(
      plan.resource_changes.find((resource) => resource.address === row.address)?.type === row.type,
    );
    const block = schemas[row.type]?.block;
    safe(block !== undefined && (row.change.replace_paths?.length ?? 0) === 0);
    same(
      comparableResourceConfiguration(row.change.before, block),
      comparableResourceConfiguration(row.change.after, block, row.change.after_unknown),
    );
  }
  safe(changed === (mode === "plan" ? 1 : 0));
  return { managedResources: managed.length, changedResources: changed, mode };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv[2] === "--request") {
      safe(process.argv.length === 3);
      verifyConnectionFaultCodeRequest(process.env);
      console.log("connection_fault_code_request=PASS");
    } else if (process.argv[2] === "--provenance") {
      safe(process.argv.length === 4);
      verifyConnectionFaultCodeRun(JSON.parse(readFileSync(process.argv[3], "utf8")), process.env);
      console.log("connection_fault_code_plan_provenance=PASS");
    } else if (process.argv[2] === "--build") {
      safe(process.argv.length === 5);
      verifyConnectionFaultCodeRun(
        JSON.parse(readFileSync(process.argv[3], "utf8")),
        process.env,
        "build",
      );
      verifyConnectionFaultCodeManifest(readFileSync(process.argv[4], "utf8"), process.env);
      console.log("connection_fault_code_build_provenance=PASS");
    } else {
      safe(process.argv.length === 5);
      const result = verifyConnectionFaultCodePlan(
        JSON.parse(readFileSync(process.argv[2], "utf8")),
        JSON.parse(readFileSync(process.argv[3], "utf8")),
        process.argv[4],
        process.env,
      );
      console.log(`connection_fault_code_configurations=${result.managedResources}`);
      console.log(`connection_fault_code_changes=${result.changedResources}`);
      console.log(`connection_fault_code_mode=${result.mode}`);
      console.log("connection_fault_profile=ABSENT");
      console.log("connection_fault_database_execution=DISABLED");
    }
  } catch {
    console.error("S22_CONNECTION_FAULT_CODE_PLAN_DENIED");
    process.exitCode = 1;
  }
}
