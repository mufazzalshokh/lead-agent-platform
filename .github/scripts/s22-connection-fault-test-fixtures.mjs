import { createHash } from "node:crypto";
import { connectionFaultBaseline as baseline } from "./s22-connection-fault-profile-plan-check.mjs";
import { connectionFaultSlot, connectionFaultTarget } from "./s22-connection-fault-profile.mjs";

// Synthetic only: these IDs/window cannot select or authorize a real session.
export const syntheticNow = Date.parse("2030-01-01T00:00:00.000Z");
export const syntheticSession = "0193f1a8-7f65-7c28-a434-000000000001";
export const hash = (value) => createHash("sha256").update(value).digest("hex");
export const syntheticProfile = () => ({
  version: 1,
  exerciseId: "12121212-1212-4121-8121-121212121212",
  ...connectionFaultTarget,
  sessionDigest: hash(syntheticSession),
  baselineAt: new Date(syntheticNow + 60_000).toISOString(),
  faultAt: new Date(syntheticNow + 150_000).toISOString(),
  expiresAt: new Date(syntheticNow + 510_000).toISOString(),
});
export const syntheticRawProfile = () => JSON.stringify(syntheticProfile());
export const provider = "registry.terraform.io/hashicorp/google";
export const api = "google_cloud_run_v2_service.api[0]";
const attr = (type = "string") => ({ type, optional: true });
const nested = (block) => ({ nesting_mode: "list", block });
const template = {
  attributes: {
    service_account: attr(),
    timeout: attr(),
    vpc_access: attr("dynamic"),
    scaling: attr("dynamic"),
  },
  block_types: {
    containers: nested({
      attributes: {
        image: attr(),
        env: attr("dynamic"),
        resources: attr("dynamic"),
        args: attr(["list", "string"]),
        startup_probe: attr("dynamic"),
      },
    }),
  },
};
const runtimeSchema = (job = false) => ({
  block: {
    attributes: {
      name: attr(),
      project: attr(),
      location: attr(),
      labels: { ...attr(["map", "string"]), computed: true },
      latest_ready_revision: { type: "string", computed: true },
    },
    block_types: {
      template: nested(job ? { block_types: { template: nested(template) } } : template),
    },
  },
});
export const syntheticSchema = {
  provider_schemas: {
    [provider]: {
      resource_schemas: {
        google_cloud_run_v2_service: runtimeSchema(),
        google_cloud_run_v2_worker_pool: runtimeSchema(),
        google_cloud_run_v2_job: runtimeSchema(true),
        google_project_iam_member: {
          block: {
            attributes: {
              project: attr(),
              role: attr(),
              member: attr(),
              etag: { type: "string", computed: true },
            },
          },
        },
      },
    },
  },
};
export const apiContainer = (value) => value.template[0].containers[0];
export const apiChange = (plan) => plan.resource_changes.find((row) => row.address === api).change;
export function syncInventories(plan) {
  for (const [property, side] of [
    ["prior_state", "before"],
    ["planned_values", "after"],
  ]) {
    const root = {
      resources: plan.resource_changes
        .filter((row) => row.mode === "managed")
        .map((row) => ({
          address: row.address,
          type: row.type,
          mode: row.mode,
          provider_name: row.provider_name,
          values: structuredClone(row.change[side]),
        })),
    };
    plan[property] =
      property === "prior_state" ? { values: { root_module: root } } : { root_module: root };
  }
  return plan;
}
export function syntheticPlan(mode = "enable", stage = "plan", raw = syntheticRawProfile()) {
  const resource_changes = [];
  for (const [workload, kind] of [
    ["api", "service"],
    ["web", "service"],
    ["worker", "worker_pool"],
    ["migrator", "job"],
  ]) {
    const sha = workload === "api" ? baseline.api_git_commit_sha : baseline.git_commit_sha;
    const entries = {
      APP_ENV: "production",
      DEPLOYMENT_ENVIRONMENT: "staging",
      DEPLOYMENT_GIT_SHA: sha,
      DEPLOYMENT_TIMESTAMP:
        workload === "api" ? baseline.api_deployment_timestamp : baseline.deployment_timestamp,
      DEPLOYMENT_MIGRATION_HEAD: baseline.migration_head,
      ...(["api", "migrator"].includes(workload)
        ? { DEPLOYMENT_IMAGE_DIGEST: baseline[`${workload}_image`] }
        : {}),
      ...(workload === "worker"
        ? {
            AI_JOURNEY_MODE: baseline.ai_journey_mode,
            AI_JOURNEY_WIDGET_SESSION_ID: baseline.ai_journey_widget_session_id,
          }
        : {}),
    };
    const value = (enabled) => {
      const env = Object.entries(entries).map(([name, value]) => ({ name, value }));
      env.push({
        name: "DATABASE_URL",
        value_source: [
          { secret_key_ref: [{ secret: "synthetic-runtime-database", version: "1" }] },
        ],
      });
      if (workload === "api" && enabled)
        env.push(
          ...Object.entries({
            S22_CONNECTION_FAULT_PROFILE: raw,
            GOOGLE_CLOUD_PROJECT: connectionFaultTarget.projectId,
            GOOGLE_CLOUD_REGION: connectionFaultTarget.region,
          }).map(([name, value]) => ({ name, value })),
        );
      const inner = {
        containers: [
          {
            image: baseline[`${workload}_image`],
            env,
            args: [],
            resources: { cpu: "1", memory: "512Mi" },
            startup_probe: { path: "/health" },
          },
        ],
        service_account: `${workload}@synthetic.invalid`,
        timeout: "60s",
        vpc_access: { egress: "PRIVATE_RANGES_ONLY" },
        scaling: { max: 1 },
      };
      return {
        project: baseline.project_id,
        location: baseline.region,
        name: `lead-agent-staging-${workload}`,
        labels: {
          "git-sha": sha.slice(0, 12),
          "migration-head": baseline.migration_head.replaceAll("_", "-"),
        },
        template: workload === "migrator" ? [{ template: [inner] }] : [inner],
        latest_ready_revision: "computed-only",
      };
    };
    resource_changes.push({
      address: `google_cloud_run_v2_${kind}.${workload}[0]`,
      type: `google_cloud_run_v2_${kind}`,
      mode: "managed",
      provider_name: provider,
      change: {
        before: value(stage === "verify" ? mode === "enable" : mode === "remove"),
        after: value(mode === "enable"),
        actions: [workload === "api" && stage === "plan" ? "update" : "no-op"],
        after_unknown: {},
        replace_paths: [],
      },
    });
  }
  for (let index = 0; index < 84; index++) {
    const value = {
      project: baseline.project_id,
      role: "roles/viewer",
      member: "serviceAccount:fixture@synthetic.invalid",
      etag: "computed",
    };
    resource_changes.push({
      address: `google_project_iam_member.preserved_${index}`,
      type: "google_project_iam_member",
      mode: "managed",
      provider_name: provider,
      change: {
        before: value,
        after: structuredClone(value),
        actions: ["no-op"],
        after_unknown: {},
        replace_paths: [],
      },
    });
  }
  resource_changes.push({
    address: "data.google_project.staging",
    type: "google_project",
    mode: "data",
    provider_name: provider,
    change: { actions: ["read"] },
  });
  return syncInventories({
    format_version: "1.2",
    terraform_version: "1.14.7",
    complete: true,
    variables: Object.fromEntries(
      Object.entries({
        ...baseline,
        s22_connection_fault_enabled: mode === "enable" ? "true" : "false",
        s22_connection_fault_profile: mode === "enable" ? raw : "",
      }).map(([key, value]) => [key, { value }]),
    ),
    resource_changes,
  });
}

export const sessionBody = (sessionId = syntheticSession) =>
  JSON.stringify({
    absolute_expires_at: new Date(syntheticNow + 7_200_000).toISOString(),
    assurance: "aal1",
    assurance_fresh: false,
    authenticated: true,
    idle_expires_at: new Date(syntheticNow + 1_800_000).toISOString(),
    session_id: sessionId,
    user_id: "0193f1a8-7f65-7c28-a434-000000000002",
  });
export function fakeBrowser() {
  let now = syntheticNow;
  let mono = 0;
  let next = 0;
  const timers = new Map();
  const calls = [];
  const fake = {
    calls,
    timers,
    wall: () => now,
    monotonic: () => mono,
    setTimer: (callback, delay) => {
      const id = ++next;
      timers.set(id, { callback, at: now + delay });
      return id;
    },
    clearTimer: (id) => timers.delete(id),
    digest: async (value) => hash(value),
    request: async ({ wire, signal }) => {
      calls.push({ wire, at: now, signal });
      if (wire === null) return { status: 200, metadata: null, body: sessionBody() };
      const [, rawSequence, , action] = wire.split(":");
      const sequence = Number(rawSequence);
      const profile = {
        ...syntheticProfile(),
        baselineAt: syntheticNow + 60_000,
        faultAt: syntheticNow + 150_000,
        expiresAt: syntheticNow + 510_000,
      };
      const phase = action === "abort" ? "abort" : connectionFaultSlot(profile, sequence).phase;
      return {
        status: phase === "fault" ? 500 : 200,
        metadata: JSON.stringify({
          phase,
          sequence,
          nonce: "n".repeat(32),
          state:
            phase === "abort"
              ? "retired"
              : phase === "fault"
                ? "dependency_failure"
                : phase === "baseline" && sequence === 4
                  ? "admitted"
                  : sequence === 29
                    ? "recovered"
                    : "healthy",
        }),
        body: phase === "fault" ? null : sessionBody(),
      };
    },
    advance: (at, monoDelta = at - now) => {
      mono += monoDelta;
      now = at;
      for (const [id, timer] of [...timers])
        if (timer.at <= now) {
          timers.delete(id);
          timer.callback();
        }
    },
    flush: async () => {
      for (let index = 0; index < 30; index++) await Promise.resolve();
    },
    drive: async (done, delay = 0) => {
      for (let index = 0; index < 100; index++) {
        await fake.flush();
        if (timers.size === 0) break;
        fake.advance(Math.min(...[...timers.values()].map((timer) => timer.at)) + delay);
      }
      return done;
    },
  };
  return fake;
}
