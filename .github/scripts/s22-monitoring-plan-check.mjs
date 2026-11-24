import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { comparableResourceConfiguration } from "./s22-full-runtime-config-check.mjs";

const provider = "registry.terraform.io/hashicorp/google";
const target = "google_monitoring_alert_policy.api_errors";
const registry = "me-central1-docker.pkg.dev/lead-agent-stg-739284/lead-agent";
export const monitoringProfile = Object.freeze({
  project_id: "lead-agent-stg-739284",
  region: "me-central1",
  git_commit_sha: "abc3071fb81777068f5adfb98f6144d9081077eb",
  deployment_timestamp: "2026-10-11T20:27:12Z",
  migration_head: "0032_s22_widget_recovery",
  runtime_migration_head: "0032_s22_widget_recovery",
  api_migration_head: "0032_s22_widget_recovery",
  api_image: `${registry}/api@sha256:f89024dc7406a307c597a7d90ca57c616e2730cb73699733c2f7378216c4941f`,
  web_image: `${registry}/web@sha256:4a57a0d4d80caa0eab3c0efb824aa1f97e33bb7f9d163b31fac129561e8f6dfe`,
  worker_image: `${registry}/worker@sha256:b6d550af4f2c071f00b7ae8388dddd7d8ef7efc3be8923aebd5c168140f75c5a`,
  migrator_image: `${registry}/migrator@sha256:223f1cb22f12a082c147c001d12690c491ca01cf63aa265afeaaa62bd7b69ce5`,
  deploy_runtime: "true",
  bootstrap_runtime: "false",
  prepare_migration: "true",
  cloud_sql_activation_policy: "ALWAYS",
  cloud_sql_tier: "db-f1-micro",
  api_max_instance_count: "1",
  web_max_instance_count: "1",
  worker_instance_count: "1",
  worker_memory: "512Mi",
  ai_journey_mode: "widget_booking",
  ai_journey_widget_session_id: "01a11c48-dbc2-76de-a873-f41664da5ccb",
});
const runtime = new Map([
  ["google_cloud_run_v2_service.api[0]", "api"],
  ["google_cloud_run_v2_service.web[0]", "web"],
  ["google_cloud_run_v2_worker_pool.worker[0]", "worker"],
  ["google_cloud_run_v2_job.migrator[0]", "migrator"],
]);
const safe = (condition) => {
  if (!condition) throw new Error("S22_MONITORING_PLAN_DENIED");
};
const same = (left, right) => safe(isDeepStrictEqual(left, right));

export function verifyMonitoringRequest(environment) {
  safe(environment.S22_PHASE === "monitoring-policy");
  safe(["plan", "apply"].includes(environment.S22_ACTION));
  safe(/^[a-f0-9]{40}$/u.test(environment.S22_COMMIT_SHA ?? ""));
  safe(environment.S22_RUNTIME_GIT_COMMIT_SHA === monitoringProfile.git_commit_sha);
  safe(environment.S22_RUNTIME_DEPLOYMENT_TIMESTAMP === monitoringProfile.deployment_timestamp);
  safe(environment.S22_AI_JOURNEY_MODE === "preserve");
  safe(
    ["", monitoringProfile.ai_journey_widget_session_id].includes(
      environment.S22_AI_JOURNEY_WIDGET_SESSION_ID ?? "",
    ),
  );
  for (const [key, value] of Object.entries(monitoringProfile)) {
    if (key.startsWith("ai_journey_")) continue; // State resolver independently preserves these.
    safe(environment[`TF_VAR_${key}`] === value);
  }
  for (const key of [
    "S22_API_GIT_COMMIT_SHA",
    "S22_API_DEPLOYMENT_TIMESTAMP",
    "S22_MIGRATOR_GIT_COMMIT_SHA",
    "S22_MIGRATOR_DEPLOYMENT_TIMESTAMP",
    "S22_MIGRATOR_EXECUTION_ID",
    "S22_AUTH_CALLBACK_REQUEST_ID",
  ])
    safe(!environment[key]);
  if (environment.S22_ACTION === "apply") {
    safe(environment.S22_APPROVAL_TOKEN === "S22-APPLY-APPROVED");
    safe(/^[1-9][0-9]*$/u.test(environment.S22_PLAN_RUN_ID ?? ""));
    safe(/^[a-f0-9]{64}$/u.test(environment.S22_APPROVED_PLAN_SHA256 ?? ""));
  } else {
    safe(environment.GITHUB_SHA === environment.S22_COMMIT_SHA);
    safe(
      !environment.S22_APPROVAL_TOKEN &&
        !environment.S22_PLAN_RUN_ID &&
        !environment.S22_APPROVED_PLAN_SHA256,
    );
  }
  return true;
}

export function verifyMonitoringPlanRun(receipt, source, branch) {
  safe(/^[a-f0-9]{40}$/u.test(source ?? ""));
  safe(["main", "verify/s22-staging-recovery-capacity"].includes(branch));
  safe(receipt.status === "completed" && receipt.conclusion === "success");
  safe(receipt.event === "workflow_dispatch");
  safe(receipt.head_sha === source && receipt.head_branch === branch);
  safe(receipt.path === ".github/workflows/staging-terraform.yml");
  safe(receipt.repository?.full_name === "mufazzalshokh/lead-agent-platform");
  return true;
}

function inventory(module) {
  safe(module !== null && typeof module === "object");
  const addresses = [];
  for (const resource of module.resources ?? []) {
    if (resource.mode === "managed") addresses.push(resource.address);
  }
  for (const child of module.child_modules ?? []) addresses.push(...inventory(child));
  safe(addresses.length <= 88 && addresses.every((address) => typeof address === "string"));
  safe(new Set(addresses).size === addresses.length);
  return addresses.sort();
}

const requests =
  'resource.type = "cloud_run_revision" AND resource.label.project_id = "lead-agent-stg-739284" AND resource.label.location = "me-central1" AND resource.label.service_name = "lead-agent-staging-api" AND metric.type = "run.googleapis.com/request_count"';
const errors = ' AND metric.label.response_code_class = "5xx"';
const oldRequests =
  'resource.type = "cloud_run_revision" AND resource.label.service_name = "lead-agent-staging-api" AND metric.type = "run.googleapis.com/request_count"';
export { requests as monitoringRequestFilter };
const aggregation = () => ({
  alignment_period: "60s",
  cross_series_reducer: "REDUCE_SUM",
  group_by_fields: ["resource.label.service_name", "resource.label.location"],
  per_series_aligner: "ALIGN_RATE",
});

function correctedPolicy(before, mode) {
  safe(before.project === monitoringProfile.project_id);
  safe(
    before.display_name === "Lead Agent staging API server errors" &&
      before.combiner === "OR" &&
      before.enabled === true,
  );
  safe(Array.isArray(before.notification_channels) && before.notification_channels.length > 0);
  safe(
    before.notification_channels.every((value) =>
      /^projects\/lead-agent-stg-739284\/notificationChannels\/[0-9]+$/u.test(value),
    ),
  );
  safe(before.conditions?.length === 1);
  const condition = before.conditions[0];
  safe(condition.display_name === "API 5xx rate exceeds 1%");
  safe(condition.condition_threshold?.length === 1);
  const threshold = condition.condition_threshold[0];
  safe(
    threshold.comparison === "COMPARISON_GT" &&
      threshold.threshold_value === 0.01 &&
      threshold.duration === "300s",
  );
  if (mode === "plan") {
    safe(threshold.filter === oldRequests + errors);
    safe(!threshold.denominator_filter && (threshold.denominator_aggregations?.length ?? 0) === 0);
    safe(threshold.aggregations?.length === 1);
    const old = threshold.aggregations[0];
    safe(old.alignment_period === "60s" && old.per_series_aligner === "ALIGN_RATE");
    safe(!old.cross_series_reducer || old.cross_series_reducer === "REDUCE_NONE");
    safe((old.group_by_fields?.length ?? 0) === 0);
  }
  const expected = structuredClone(before);
  Object.assign(expected.conditions[0].condition_threshold[0], {
    filter: requests + errors,
    denominator_filter: requests,
    aggregations: [aggregation()],
    denominator_aggregations: [aggregation()],
  });
  return expected;
}

function runtimePins(value, workload) {
  const container =
    workload === "migrator"
      ? value.template?.[0]?.template?.[0]?.containers?.[0]
      : value.template?.[0]?.containers?.[0];
  safe(container?.image === monitoringProfile[`${workload}_image`] && Array.isArray(container.env));
  const environment = new Map(container.env.map((entry) => [entry.name, entry]));
  safe(environment.size === container.env.length);
  const expected = {
    DEPLOYMENT_GIT_SHA: monitoringProfile.git_commit_sha,
    DEPLOYMENT_TIMESTAMP: monitoringProfile.deployment_timestamp,
    DEPLOYMENT_MIGRATION_HEAD: monitoringProfile.migration_head,
  };
  if (["api", "migrator"].includes(workload)) expected.DEPLOYMENT_IMAGE_DIGEST = container.image;
  if (workload === "worker") {
    expected.AI_JOURNEY_MODE = monitoringProfile.ai_journey_mode;
    expected.AI_JOURNEY_WIDGET_SESSION_ID = monitoringProfile.ai_journey_widget_session_id;
  }
  for (const [key, expectedValue] of Object.entries(expected)) {
    const entry = environment.get(key);
    safe(entry?.value === expectedValue && !entry.value_source?.length);
  }
}

export function verifyMonitoringPlan(plan, providerSchema, mode = "plan") {
  safe(["plan", "verify"].includes(mode));
  safe(plan?.format_version === "1.2" && plan.terraform_version === "1.14.7");
  safe(!plan.errored && (plan.deferred_changes?.length ?? 0) === 0);
  safe(Array.isArray(plan.resource_changes));
  for (const [key, value] of Object.entries(monitoringProfile))
    safe(plan.variables?.[key]?.value === value);
  const schemas = providerSchema?.provider_schemas?.[provider]?.resource_schemas;
  safe(schemas !== undefined);
  const seen = new Set();
  let changed = 0;
  for (const resource of plan.resource_changes) {
    safe(resource.provider_name === provider && !seen.has(resource.address));
    seen.add(resource.address);
    if (resource.mode === "data") {
      safe(
        resource.address === "data.google_project.staging" && resource.type === "google_project",
      );
      safe(
        ["read", "no-op"].some((action) => isDeepStrictEqual(resource.change.actions, [action])),
      );
      continue;
    }
    safe(resource.mode === "managed");
    const change = resource.change;
    safe((change.replace_paths?.length ?? 0) === 0);
    const block = schemas[resource.type]?.block;
    safe(block !== undefined);
    const before = comparableResourceConfiguration(change.before, block);
    const after = comparableResourceConfiguration(change.after, block, change.after_unknown);
    if (resource.address === target) {
      safe(resource.type === "google_monitoring_alert_policy");
      same(change.actions, [mode === "plan" ? "update" : "no-op"]);
      same(after, correctedPolicy(before, mode));
      if (mode === "verify") same(before, after);
      else changed++;
    } else {
      same(change.actions, ["no-op"]);
      same(before, after);
      const workload = runtime.get(resource.address);
      if (workload) runtimePins(after, workload);
    }
  }
  const managed = plan.resource_changes
    .filter((resource) => resource.mode === "managed")
    .map((resource) => resource.address)
    .sort();
  safe(
    managed.length === 88 &&
      seen.has(target) &&
      [...runtime.keys()].every((address) => seen.has(address)),
  );
  same(managed, inventory(plan.prior_state?.values?.root_module));
  same(managed, inventory(plan.planned_values?.root_module));
  for (const drift of plan.resource_drift ?? []) {
    safe(
      drift.mode === "managed" &&
        drift.provider_name === provider &&
        managed.includes(drift.address),
    );
    const block = schemas[drift.type]?.block;
    safe(block !== undefined);
    same(
      comparableResourceConfiguration(drift.change.before, block),
      comparableResourceConfiguration(drift.change.after, block, drift.change.after_unknown),
    );
  }
  safe(changed === (mode === "plan" ? 1 : 0));
  return { managedResources: managed.length, changedResources: changed, mode };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv[2] === "--request") {
      safe(process.argv.length === 3);
      verifyMonitoringRequest(process.env);
      console.log("monitoring_request_boundary=PASS");
    } else if (process.argv[2] === "--provenance") {
      safe(process.argv.length === 4);
      verifyMonitoringPlanRun(
        JSON.parse(readFileSync(process.argv[3], "utf8")),
        process.env.S22_COMMIT_SHA,
        process.env.GITHUB_REF_NAME,
      );
      console.log("monitoring_plan_provenance=PASS");
    } else {
      safe(process.argv.length === 5);
      const result = verifyMonitoringPlan(
        JSON.parse(readFileSync(process.argv[2], "utf8")),
        JSON.parse(readFileSync(process.argv[3], "utf8")),
        process.argv[4],
      );
      for (const [key, value] of Object.entries({
        monitoring_configuration_verified: result.managedResources,
        monitoring_plan_mode: result.mode,
        monitoring_plan_changes: result.changedResources,
        monitoring_plan_creates: 0,
        monitoring_plan_destroys: 0,
        monitoring_plan_replacements: 0,
        monitoring_configurable_unknowns: "NONE",
        monitoring_unreviewed_configuration_changes: "NONE",
        monitoring_runtime_mutations: "NONE",
        monitoring_database_execution: "DISABLED",
      }))
        console.log(`${key}=${value}`);
    }
  } catch {
    console.error("S22_MONITORING_PLAN_DENIED");
    process.exitCode = 1;
  }
}
