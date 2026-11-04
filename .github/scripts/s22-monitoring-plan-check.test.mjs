import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  monitoringProfile,
  verifyMonitoringPlan,
  verifyMonitoringPlanRun,
  verifyMonitoringRequest,
} from "./s22-monitoring-plan-check.mjs";

const provider = "registry.terraform.io/hashicorp/google";
const target = "google_monitoring_alert_policy.api_errors";
const attr = (type = "string") => ({ type, optional: true });
const nested = (block) => ({ nesting_mode: "list", block });
const aggregation = {
  attributes: {
    alignment_period: attr(),
    cross_series_reducer: attr(),
    group_by_fields: attr(["list", "string"]),
    per_series_aligner: attr(),
  },
};
const schema = {
  provider_schemas: {
    [provider]: {
      resource_schemas: {
        google_monitoring_alert_policy: {
          block: {
            attributes: {
              project: attr(),
              display_name: attr(),
              combiner: attr(),
              enabled: attr("bool"),
              notification_channels: attr(["list", "string"]),
              id: { ...attr(), computed: true },
              name: { type: "string", computed: true },
            },
            block_types: {
              conditions: nested({
                attributes: { display_name: attr(), name: { type: "string", computed: true } },
                block_types: {
                  condition_threshold: nested({
                    attributes: {
                      filter: attr(),
                      denominator_filter: attr(),
                      comparison: attr(),
                      threshold_value: attr("number"),
                      duration: attr(),
                      evaluation_missing_data: attr(),
                    },
                    block_types: {
                      aggregations: nested(aggregation),
                      denominator_aggregations: nested(aggregation),
                    },
                  }),
                },
              }),
              alert_strategy: nested({ attributes: { auto_close: attr() } }),
            },
          },
        },
        ...Object.fromEntries(
          [
            "google_cloud_run_v2_service",
            "google_cloud_run_v2_worker_pool",
            "google_cloud_run_v2_job",
          ].map((type) => [
            type,
            {
              block: {
                attributes: {
                  name: attr(),
                  project: attr(),
                  template: attr(["list", "dynamic"]),
                  latest_revision: { type: "string", computed: true },
                },
              },
            },
          ]),
        ),
        google_project_iam_member: {
          block: {
            attributes: {
              project: attr(),
              role: attr(),
              member: attr(),
              etag: { type: "string", computed: true },
              id: { ...attr(), computed: true },
            },
          },
        },
      },
    },
  },
};
const resource = (address, type, before, after = structuredClone(before), actions = ["no-op"]) => ({
  address,
  type,
  mode: "managed",
  provider_name: provider,
  change: { before, after, after_unknown: {}, actions, replace_paths: [] },
});
const change = (plan, address = target) =>
  plan.resource_changes.find((row) => row.address === address).change;
const corrected = () => ({
  alignment_period: "60s",
  cross_series_reducer: "REDUCE_SUM",
  group_by_fields: ["resource.label.service_name", "resource.label.location"],
  per_series_aligner: "ALIGN_RATE",
});

function fixture() {
  const old = {
    project: monitoringProfile.project_id,
    display_name: "Lead Agent staging API server errors",
    combiner: "OR",
    enabled: true,
    notification_channels: ["projects/lead-agent-stg-739284/notificationChannels/123"],
    id: "projects/lead-agent-stg-739284/alertPolicies/456",
    name: "computed-name",
    conditions: [
      {
        display_name: "API 5xx rate exceeds 1%",
        name: "computed-condition",
        condition_threshold: [
          {
            filter:
              'resource.type = "cloud_run_revision" AND resource.label.service_name = "lead-agent-staging-api" AND metric.type = "run.googleapis.com/request_count" AND metric.label.response_code_class = "5xx"',
            denominator_filter: "",
            comparison: "COMPARISON_GT",
            threshold_value: 0.01,
            duration: "300s",
            evaluation_missing_data: "",
            aggregations: [
              {
                alignment_period: "60s",
                cross_series_reducer: "REDUCE_NONE",
                group_by_fields: [],
                per_series_aligner: "ALIGN_RATE",
              },
            ],
            denominator_aggregations: [],
          },
        ],
      },
    ],
    alert_strategy: [{ auto_close: "1800s" }],
  };
  const after = structuredClone(old);
  const requests =
    'resource.type = "cloud_run_revision" AND resource.label.project_id = "lead-agent-stg-739284" AND resource.label.location = "me-central1" AND resource.label.service_name = "lead-agent-staging-api" AND metric.type = "run.googleapis.com/request_count"';
  Object.assign(after.conditions[0].condition_threshold[0], {
    filter: `${requests} AND metric.label.response_code_class = "5xx"`,
    denominator_filter: requests,
    aggregations: [corrected()],
    denominator_aggregations: [corrected()],
  });
  const resources = [resource(target, "google_monitoring_alert_policy", old, after, ["update"])];
  for (const [workload, type] of [
    ["api", "service"],
    ["web", "service"],
    ["worker", "worker_pool"],
    ["migrator", "job"],
  ]) {
    const env = Object.entries({
      DEPLOYMENT_GIT_SHA: monitoringProfile.git_commit_sha,
      DEPLOYMENT_TIMESTAMP: monitoringProfile.deployment_timestamp,
      DEPLOYMENT_MIGRATION_HEAD: monitoringProfile.migration_head,
      ...(["api", "migrator"].includes(workload)
        ? { DEPLOYMENT_IMAGE_DIGEST: monitoringProfile[`${workload}_image`] }
        : {}),
      ...(workload === "worker"
        ? {
            AI_JOURNEY_MODE: monitoringProfile.ai_journey_mode,
            AI_JOURNEY_WIDGET_SESSION_ID: monitoringProfile.ai_journey_widget_session_id,
          }
        : {}),
    }).map(([name, value]) => ({ name, value }));
    const container = { image: monitoringProfile[`${workload}_image`], env };
    resources.push(
      resource(`google_cloud_run_v2_${type}.${workload}[0]`, `google_cloud_run_v2_${type}`, {
        name: `lead-agent-staging-${workload}`,
        project: monitoringProfile.project_id,
        template:
          workload === "migrator"
            ? [{ template: [{ containers: [container] }] }]
            : [{ containers: [container] }],
        latest_revision: "computed",
      }),
    );
  }
  for (let index = 0; index < 83; index++)
    resources.push(
      resource(`google_project_iam_member.preserved_${index}`, "google_project_iam_member", {
        project: monitoringProfile.project_id,
        role: "roles/viewer",
        member: "serviceAccount:synthetic@staging.example",
        etag: "computed",
        id: `preserved-${index}`,
      }),
    );
  const snapshot = {
    resources: resources.map((row) => ({ address: row.address, mode: row.mode })),
  };
  return {
    format_version: "1.2",
    terraform_version: "1.14.7",
    variables: Object.fromEntries(
      Object.entries(monitoringProfile).map(([key, value]) => [key, { value }]),
    ),
    resource_changes: [
      ...resources,
      {
        mode: "data",
        provider_name: provider,
        address: "data.google_project.staging",
        type: "google_project",
        change: { actions: ["read"] },
      },
    ],
    prior_state: { values: { root_module: structuredClone(snapshot) } },
    planned_values: { root_module: structuredClone(snapshot) },
  };
}
const denied = (plan) =>
  assert.throws(
    () => verifyMonitoringPlan(plan, schema),
    /S22_(?:MONITORING_PLAN|FULL_RUNTIME_CONFIGURATION)_DENIED/u,
  );
const threshold = (plan) => change(plan).after.conditions[0].condition_threshold[0];

test("permits exactly one API ratio correction and preserves all 88 configurations", () => {
  assert.deepEqual(verifyMonitoringPlan(fixture(), schema), {
    managedResources: 88,
    changedResources: 1,
    mode: "plan",
  });
});
test("convergence requires the corrected ratio and zero changes, not an uncorrected healthy service", () => {
  const plan = fixture();
  change(plan).before = structuredClone(change(plan).after);
  change(plan).actions = ["no-op"];
  assert.deepEqual(verifyMonitoringPlan(plan, schema, "verify"), {
    managedResources: 88,
    changedResources: 0,
    mode: "verify",
  });
  change(plan).before.conditions[0].condition_threshold[0].denominator_filter = "";
  change(plan).after = structuredClone(change(plan).before);
  assert.throws(() => verifyMonitoringPlan(plan, schema, "verify"));
});
for (const [name, mutate] of [
  [
    "missing denominator",
    (p) => {
      threshold(p).denominator_filter = "";
    },
  ],
  [
    "different service",
    (p) => {
      threshold(p).filter = threshold(p).filter.replace("staging-api", "staging-web");
    },
  ],
  [
    "foreign project",
    (p) => {
      threshold(p).denominator_filter = threshold(p).denominator_filter.replace(
        "stg-739284",
        "foreign",
      );
    },
  ],
  [
    "mismatched labels",
    (p) => {
      threshold(p).denominator_aggregations[0].group_by_fields.push("resource.label.revision_name");
    },
  ],
  [
    "mismatched windows",
    (p) => {
      threshold(p).denominator_aggregations[0].alignment_period = "300s";
    },
  ],
  [
    "unweighted average",
    (p) => {
      threshold(p).aggregations[0].cross_series_reducer = "REDUCE_MEAN";
    },
  ],
  [
    "threshold widening",
    (p) => {
      threshold(p).threshold_value = 0.02;
    },
  ],
  [
    "duration widening",
    (p) => {
      threshold(p).duration = "600s";
    },
  ],
  [
    "recipient change",
    (p) => {
      change(p).after.notification_channels = [
        "projects/lead-agent-stg-739284/notificationChannels/999",
      ];
    },
  ],
  [
    "disabled policy",
    (p) => {
      change(p).after.enabled = false;
    },
  ],
  [
    "strategy change",
    (p) => {
      change(p).after.alert_strategy[0].auto_close = "3600s";
    },
  ],
  [
    "unexpected old baseline",
    (p) => {
      change(p).before.conditions[0].condition_threshold[0].denominator_filter = "unreviewed";
    },
  ],
  [
    "IAM update",
    (p) => {
      change(p, "google_project_iam_member.preserved_0").actions = ["update"];
    },
  ],
  [
    "hidden no-op mutation",
    (p) => {
      change(p, "google_project_iam_member.preserved_0").after.role = "roles/owner";
    },
  ],
  [
    "runtime image change",
    (p) => {
      change(p, "google_cloud_run_v2_service.web[0]").after.template[0].containers[0].image =
        "unreviewed";
    },
  ],
  [
    "unreviewed runtime baseline",
    (p) => {
      for (const value of ["before", "after"])
        change(p, "google_cloud_run_v2_service.web[0]")[value].template[0].containers[0].image =
          "unreviewed";
    },
  ],
  [
    "duplicate runtime environment",
    (p) => {
      const c = change(p, "google_cloud_run_v2_worker_pool.worker[0]");
      for (const value of ["before", "after"])
        c[value].template[0].containers[0].env.push(
          structuredClone(c[value].template[0].containers[0].env[0]),
        );
    },
  ],
  [
    "configurable unknown",
    (p) => {
      change(p).after_unknown = { project: true };
    },
  ],
  [
    "optional-computed unknown",
    (p) => {
      change(p).after_unknown = { id: true };
    },
  ],
  [
    "replacement",
    (p) => {
      change(p).actions = ["delete", "create"];
    },
  ],
  [
    "replacement paths",
    (p) => {
      change(p).replace_paths = [["project"]];
    },
  ],
  [
    "duplicate resource",
    (p) => {
      p.resource_changes.push(structuredClone(p.resource_changes[0]));
    },
  ],
  [
    "missing resource",
    (p) => {
      p.resource_changes.splice(1, 1);
    },
  ],
  [
    "targeted plan inventory",
    (p) => {
      p.prior_state.values.root_module.resources.pop();
    },
  ],
  [
    "foreign provider",
    (p) => {
      p.resource_changes[0].provider_name = "foreign/provider";
    },
  ],
  [
    "unexpected data read",
    (p) => {
      p.resource_changes.at(-1).address = "data.google_secret_manager_secret_version.private";
    },
  ],
  [
    "runtime variable change",
    (p) => {
      p.variables.worker_instance_count.value = "2";
    },
  ],
  [
    "wrong Terraform version",
    (p) => {
      p.terraform_version = "1.15.0";
    },
  ],
  [
    "deferred changes",
    (p) => {
      p.deferred_changes = [{}];
    },
  ],
])
  test(`rejects ${name}`, () => {
    const plan = fixture();
    mutate(plan);
    denied(plan);
  });

test("allows computed-only revisions/drift but rejects configurable drift", () => {
  const plan = fixture();
  const row = plan.resource_changes.find((r) => r.type === "google_project_iam_member");
  row.change.after_unknown = { etag: true };
  plan.resource_drift = [structuredClone(row)];
  plan.resource_drift[0].change.after.etag = "new-computed";
  assert.equal(verifyMonitoringPlan(plan, schema).changedResources, 1);
  plan.resource_drift[0].change.after.role = "roles/owner";
  denied(plan);
});
const request = (action) => ({
  ...Object.fromEntries(
    Object.entries(monitoringProfile).map(([key, value]) => [`TF_VAR_${key}`, value]),
  ),
  S22_PHASE: "monitoring-policy",
  S22_ACTION: action,
  S22_COMMIT_SHA: "f".repeat(40),
  GITHUB_SHA: "f".repeat(40),
  S22_RUNTIME_GIT_COMMIT_SHA: monitoringProfile.git_commit_sha,
  S22_RUNTIME_DEPLOYMENT_TIMESTAMP: monitoringProfile.deployment_timestamp,
  S22_AI_JOURNEY_MODE: "preserve",
  ...(action === "apply"
    ? {
        S22_APPROVAL_TOKEN: "S22-APPLY-APPROVED",
        S22_PLAN_RUN_ID: "123",
        S22_APPROVED_PLAN_SHA256: "a".repeat(64),
      }
    : {}),
});
test("planning has no authority token; apply requires exact saved-plan fields", () => {
  assert.equal(verifyMonitoringRequest(request("plan")), true);
  assert.equal(verifyMonitoringRequest(request("apply")), true);
  for (const [action, key, value] of [
    ["plan", "S22_APPROVAL_TOKEN", "S22-APPLY-APPROVED"],
    ["plan", "S22_PLAN_RUN_ID", "123"],
    ["plan", "GITHUB_SHA", "a".repeat(40)],
    ["apply", "S22_APPROVED_PLAN_SHA256", ""],
    ["apply", "S22_PLAN_RUN_ID", "0"],
    ["apply", "S22_APPROVAL_TOKEN", ""],
    ["plan", "S22_AI_JOURNEY_MODE", "paused"],
    ["plan", "TF_VAR_api_image", "foreign"],
    ["plan", "S22_MIGRATOR_EXECUTION_ID", "some-job"],
    ["plan", "S22_RUNTIME_GIT_COMMIT_SHA", "a".repeat(40)],
  ])
    assert.throws(() => verifyMonitoringRequest({ ...request(action), [key]: value }));
});
test("CLI failure emits only the finite denial code", () => {
  const result = spawnSync(
    process.execPath,
    [".github/scripts/s22-monitoring-plan-check.mjs", "package.json", "package.json", "plan"],
    { encoding: "utf8", timeout: 5000 },
  );
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr.trim(), "S22_MONITORING_PLAN_DENIED");
});

test("saved plan must come from the successful exact-source workflow on the approved branch", () => {
  const branch = "verify/s22-staging-recovery-capacity";
  const source = "f".repeat(40);
  const receipt = {
    status: "completed",
    conclusion: "success",
    event: "workflow_dispatch",
    head_sha: source,
    head_branch: branch,
    path: ".github/workflows/staging-terraform.yml",
    repository: { full_name: "mufazzalshokh/lead-agent-platform" },
  };
  assert.equal(verifyMonitoringPlanRun(receipt, source, branch), true);
  for (const [key, value] of [
    ["status", "in_progress"],
    ["conclusion", "failure"],
    ["event", "push"],
    ["head_sha", "a".repeat(40)],
    ["head_branch", "unreviewed"],
    ["path", ".github/workflows/staging-images.yml"],
    ["repository", { full_name: "other/repository" }],
  ])
    assert.throws(() => verifyMonitoringPlanRun({ ...receipt, [key]: value }, source, branch));
});

test("workflow gates monitoring before cloud auth, checks the saved hash, and never executes a DB job", () => {
  const source = readFileSync(".github/workflows/staging-terraform.yml", "utf8").replaceAll(
    "\r\n",
    "\n",
  );
  const step = (name) =>
    source.split(`      - name: ${name}\n`)[1]?.split(/\n {6}- (?:name|uses):/u)[0];
  assert.ok(source.includes("- monitoring-policy"));
  assert.ok(
    source.indexOf("- name: Validate monitoring request") <
      source.indexOf("- name: Authenticate to Google Cloud without a key"),
  );
  assert.ok(step("Validate monitoring request")?.includes("--request"));
  assert.ok(step("Verify monitoring-only plan safety")?.includes("s22.tfplan plan"));
  assert.ok(
    source.indexOf("- name: Verify monitoring saved-plan provenance") <
      source.indexOf("- name: Download exact owner-reviewed plan"),
  );
  assert.ok(step("Verify monitoring saved-plan provenance")?.includes("--provenance"));
  assert.ok(
    step("Verify exact monitoring approval boundary")?.includes(
      '"$ACTUAL_PLAN_SHA256" == "$S22_APPROVED_PLAN_SHA256"',
    ),
  );
  assert.ok(step("Verify exact monitoring approval boundary")?.includes("s22.tfplan plan"));
  assert.ok(
    step("Verify monitoring policy convergence")?.includes(
      "s22-monitoring-convergence.tfplan verify",
    ),
  );
  assert.ok(step("Record deployment provenance")?.includes("env.S22_PHASE != 'monitoring-policy'"));
  for (const name of [
    "Execute one-shot migrator",
    "Verify migrated staging database",
    "Run bounded migration failure diagnostics",
  ]) {
    const block = step(name);
    assert.ok(block);
    assert.ok(
      !block
        .split(/\r?\n/u)
        .find((line) => line.includes("if:"))
        ?.includes("monitoring-policy"),
    );
  }
});
