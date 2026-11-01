import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { comparableResourceConfiguration as configuration } from "./s22-full-runtime-config-check.mjs";
import { monitoringProfile } from "./s22-monitoring-plan-check.mjs";
import {
  connectionFaultTarget,
  runtimeProfileJson,
  validateConnectionFaultProfile,
} from "./s22-connection-fault-profile.mjs";

// Offline library only. Workflow/CLI authority must be wired and reviewed separately.
export const connectionFaultBaseline = Object.freeze({
  ...monitoringProfile,
  api_git_commit_sha: connectionFaultTarget.sourceSha,
  api_deployment_timestamp: "2026-10-31T18:20:23Z",
  api_image:
    "me-central1-docker.pkg.dev/lead-agent-stg-739284/lead-agent/api@sha256:624e2d17ca48394af37bd70ac305e9b3104712afe25c83b3f3e2449711e2e2b9",
  migrator_git_commit_sha: monitoringProfile.git_commit_sha,
  migrator_deployment_timestamp: monitoringProfile.deployment_timestamp,
});
const provider = "registry.terraform.io/hashicorp/google";
const api = "google_cloud_run_v2_service.api[0]";
const workloads = new Map([
  [api, "api"],
  ["google_cloud_run_v2_service.web[0]", "web"],
  ["google_cloud_run_v2_worker_pool.worker[0]", "worker"],
  ["google_cloud_run_v2_job.migrator[0]", "migrator"],
]);
const profileNames = [
  "S22_CONNECTION_FAULT_PROFILE",
  "GOOGLE_CLOUD_PROJECT",
  "GOOGLE_CLOUD_REGION",
];
const safe = (condition) => {
  if (!condition) throw new Error("S22_CONNECTION_FAULT_PROFILE_PLAN_DENIED");
};
const same = (a, b) => safe(isDeepStrictEqual(a, b));
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

export function connectionFaultProfileReceipt(raw) {
  const profile = validateConnectionFaultProfile(raw);
  return Object.freeze({
    configuration_sha256: sha256(raw),
    runtime_profile_sha256: sha256(runtimeProfileJson(profile)),
    exercise_id: profile.exerciseId,
    api_source_sha: profile.sourceSha,
  });
}
function container(value, workload) {
  safe(value.template?.length === 1);
  const templates = workload === "migrator" ? value.template[0].template : value.template;
  safe(templates?.length === 1 && templates[0].containers?.length === 1);
  const current = templates[0].containers[0];
  safe(Array.isArray(current.env));
  const names = current.env.map((entry) => entry.name);
  safe(names.every((name) => typeof name === "string") && new Set(names).size === names.length);
  return current;
}
function runtime(value, workload, raw) {
  safe(
    value.project === connectionFaultTarget.projectId &&
      value.location === connectionFaultTarget.region,
  );
  safe(value.name === `lead-agent-staging-${workload}`);
  const sha =
    workload === "api" ? connectionFaultTarget.sourceSha : connectionFaultBaseline.git_commit_sha;
  const time =
    workload === "api"
      ? connectionFaultBaseline.api_deployment_timestamp
      : connectionFaultBaseline.deployment_timestamp;
  same(value.labels?.["git-sha"], sha.slice(0, 12));
  same(
    value.labels?.["migration-head"],
    connectionFaultBaseline.migration_head.replaceAll("_", "-"),
  );
  const current = container(value, workload);
  same(current.image, connectionFaultBaseline[`${workload}_image`]);
  const entries = new Map(current.env.map((entry) => [entry.name, entry]));
  const expected = {
    DEPLOYMENT_ENVIRONMENT: "staging",
    DEPLOYMENT_GIT_SHA: sha,
    DEPLOYMENT_TIMESTAMP: time,
    DEPLOYMENT_MIGRATION_HEAD: connectionFaultBaseline.migration_head,
    ...(["api", "migrator"].includes(workload) ? { DEPLOYMENT_IMAGE_DIGEST: current.image } : {}),
    ...(workload === "worker"
      ? {
          AI_JOURNEY_MODE: connectionFaultBaseline.ai_journey_mode,
          AI_JOURNEY_WIDGET_SESSION_ID: connectionFaultBaseline.ai_journey_widget_session_id,
        }
      : {}),
  };
  if (workload === "api") {
    expected.APP_ENV = "production";
    if (raw !== null)
      Object.assign(expected, {
        S22_CONNECTION_FAULT_PROFILE: raw,
        GOOGLE_CLOUD_PROJECT: connectionFaultTarget.projectId,
        GOOGLE_CLOUD_REGION: connectionFaultTarget.region,
      });
  }
  for (const [name, expectedValue] of Object.entries(expected)) {
    const entry = entries.get(name);
    safe(
      entry?.value === expectedValue &&
        (entry.value_source == null ||
          (Array.isArray(entry.value_source) && entry.value_source.length === 0)),
    );
  }
  if (workload !== "api" || raw === null) for (const name of profileNames) safe(!entries.has(name));
  safe(!entries.has("K_SERVICE"));
}
function inventory(module, schema, resources, side) {
  safe(module !== null && typeof module === "object");
  const addresses = [];
  for (const row of module.resources ?? []) {
    if (row.mode !== "managed") continue;
    safe(row.provider_name === provider);
    const change = resources.get(row.address);
    safe(change?.type === row.type && schema[row.type]?.block);
    same(
      configuration(row.values, schema[row.type].block),
      configuration(change.change[side], schema[row.type].block),
    );
    addresses.push(row.address);
  }
  for (const child of module.child_modules ?? [])
    addresses.push(...inventory(child, schema, resources, side));
  safe(addresses.length <= 88 && new Set(addresses).size === addresses.length);
  return addresses.sort();
}

export function verifyConnectionFaultProfilePlan(plan, providerSchema, options) {
  try {
    const { mode, stage = "plan", rawProfile, activationReceipt, now } = options;
    safe(["enable", "remove"].includes(mode) && ["plan", "verify"].includes(stage));
    // Enable convergence after B remains inspectable; only planning/admission is time gated.
    validateConnectionFaultProfile(
      rawProfile,
      mode === "enable" && stage === "plan" ? now : undefined,
    );
    safe(Number.isFinite(now));
    const receipt = connectionFaultProfileReceipt(rawProfile);
    if (mode === "remove") same(activationReceipt, receipt);
    safe(plan?.format_version === "1.2" && plan.terraform_version === "1.14.7");
    safe(!plan.errored && plan.complete !== false && (plan.deferred_changes?.length ?? 0) === 0);
    safe(!plan.target && !plan.targets && !plan.replace && !plan.replace_addrs);
    const variables = Object.fromEntries(
      Object.entries(plan.variables ?? {}).map(([key, value]) => [key, value.value]),
    );
    for (const [key, value] of Object.entries(connectionFaultBaseline)) same(variables[key], value);
    same(variables.s22_connection_fault_enabled, mode === "enable" ? "true" : "false");
    same(variables.s22_connection_fault_profile, mode === "enable" ? rawProfile : "");
    const schema = providerSchema?.provider_schemas?.[provider]?.resource_schemas;
    safe(schema !== undefined && Array.isArray(plan.resource_changes));
    const managed = new Map();
    const seen = new Set();
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
      managed.set(row.address, row);
      safe(schema[row.type]?.block !== undefined);
      const before = configuration(row.change.before, schema[row.type].block);
      const after = configuration(
        row.change.after,
        schema[row.type].block,
        row.change.after_unknown,
      );
      const workload = workloads.get(row.address);
      const enabledAfter = mode === "enable";
      if (workload) {
        same(
          row.type,
          workload === "worker"
            ? "google_cloud_run_v2_worker_pool"
            : workload === "migrator"
              ? "google_cloud_run_v2_job"
              : "google_cloud_run_v2_service",
        );
        runtime(
          before,
          workload,
          (stage === "verify" ? enabledAfter : !enabledAfter) ? rawProfile : null,
        );
        runtime(after, workload, enabledAfter ? rawProfile : null);
      }
      if (row.address === api && stage === "plan") {
        same(row.change.actions, ["update"]);
        const expected = structuredClone(before);
        const source = container(before, "api");
        const destination = container(expected, "api");
        destination.env = source.env.filter((entry) => !profileNames.includes(entry.name));
        if (enabledAfter) {
          // Reuse the provider-projected entry shape, including its null/empty fields.
          for (const name of profileNames)
            destination.env.push(
              structuredClone(container(after, "api").env.find((entry) => entry.name === name)),
            );
        }
        const sorted = (value) => {
          container(value, "api").env.sort((a, b) => a.name.localeCompare(b.name));
          return value;
        };
        same(sorted(after), sorted(expected));
        changed++;
      } else {
        same(row.change.actions, ["no-op"]);
        same(before, after);
      }
    }
    const addresses = [...managed.keys()].sort();
    safe(addresses.length === 88 && [...workloads.keys()].every((address) => managed.has(address)));
    same(addresses, inventory(plan.prior_state?.values?.root_module, schema, managed, "before"));
    same(addresses, inventory(plan.planned_values?.root_module, schema, managed, "after"));
    const drift = new Set();
    for (const row of plan.resource_drift ?? []) {
      safe(row.mode === "managed" && row.provider_name === provider && !drift.has(row.address));
      safe(
        managed.get(row.address)?.type === row.type &&
          !row.previous_address &&
          (row.change.replace_paths?.length ?? 0) === 0,
      );
      drift.add(row.address);
      same(
        configuration(row.change.before, schema[row.type].block),
        configuration(row.change.after, schema[row.type].block, row.change.after_unknown),
      );
    }
    safe(changed === (stage === "plan" ? 1 : 0));
    return Object.freeze({
      ...receipt,
      mode,
      stage,
      managedResources: 88,
      changedResources: changed,
    });
  } catch {
    throw new Error("S22_CONNECTION_FAULT_PROFILE_PLAN_DENIED");
  }
}

// The caller must obtain run metadata through authenticated Actions APIs. This
// pure verifier never fetches metadata or treats a user-supplied JSON as authority.
export function verifyConnectionFaultProfileArtifact(binary, receipt, authenticatedRun, request) {
  try {
    safe(["enable", "remove"].includes(request.mode));
    safe(request.approval === "S22-APPLY-APPROVED");
    safe(
      /^[a-f0-9]{40}$/u.test(request.toolingSha) && /^[a-f0-9]{64}$/u.test(request.approvedSha256),
    );
    safe(/^[1-9][0-9]*$/u.test(request.planRunId));
    safe(["main", "verify/s22-staging-recovery-capacity"].includes(request.branch));
    safe(authenticatedRun.repository?.full_name === "mufazzalshokh/lead-agent-platform");
    safe(authenticatedRun.path === ".github/workflows/staging-terraform.yml");
    safe(
      authenticatedRun.status === "completed" &&
        authenticatedRun.conclusion === "success" &&
        authenticatedRun.event === "workflow_dispatch",
    );
    safe(
      String(authenticatedRun.id) === request.planRunId &&
        authenticatedRun.head_sha === request.toolingSha &&
        authenticatedRun.head_branch === request.branch,
    );
    safe(
      receipt.mode === request.mode &&
        receipt.stage === "plan" &&
        receipt.managedResources === 88 &&
        receipt.changedResources === 1,
    );
    const expected = connectionFaultProfileReceipt(request.rawProfile);
    for (const [key, value] of Object.entries(expected)) same(receipt[key], value);
    safe(Buffer.isBuffer(binary) && binary.length > 0 && sha256(binary) === request.approvedSha256);
    return true;
  } catch {
    throw new Error("S22_CONNECTION_FAULT_PROFILE_ARTIFACT_DENIED");
  }
}
