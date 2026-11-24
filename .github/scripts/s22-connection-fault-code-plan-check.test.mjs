import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { monitoringProfile as baseline } from "./s22-monitoring-plan-check.mjs";
import {
  connectionFaultCodeSource,
  selectConnectionFaultCodeBuildRun,
  verifyConnectionFaultCodeManifest,
  verifyConnectionFaultCodePlan,
  verifyConnectionFaultCodeRequest,
  verifyConnectionFaultCodeRun,
} from "./s22-connection-fault-code-plan-check.mjs";

const provider = "registry.terraform.io/hashicorp/google";
const api = "google_cloud_run_v2_service.api[0]";
const attr = (type = "string") => ({ type, optional: true });
const nested = (block) => ({ nesting_mode: "list", block });
const template = {
  attributes: { service_account: attr(), timeout: attr(), vpc_access: attr("dynamic") },
  block_types: {
    containers: nested({
      attributes: {
        image: attr(),
        env: attr("dynamic"),
        resources: attr("dynamic"),
        args: attr(["list", "string"]),
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
const schema = {
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
const variables = () => ({
  ...baseline,
  api_image: baseline.api_image.replace(/sha256:.+$/u, `sha256:${"a".repeat(64)}`),
  api_git_commit_sha: connectionFaultCodeSource,
  api_deployment_timestamp: "2026-10-31T12:00:00Z",
  migrator_git_commit_sha: baseline.git_commit_sha,
  migrator_deployment_timestamp: baseline.deployment_timestamp,
});
const row = (address, type, before, after = structuredClone(before), actions = ["no-op"]) => ({
  address,
  type,
  mode: "managed",
  provider_name: provider,
  change: { before, after, actions, after_unknown: {}, replace_paths: [] },
});
const change = (p, address = api) => p.resource_changes.find((r) => r.address === address).change;
const container = (value) => value.template[0].containers[0];
function fixture() {
  const resources = [];
  for (const [workload, type] of [
    ["api", "service"],
    ["web", "service"],
    ["worker", "worker_pool"],
    ["migrator", "job"],
  ]) {
    const env = Object.entries({
      DEPLOYMENT_ENVIRONMENT: "staging",
      DEPLOYMENT_GIT_SHA: baseline.git_commit_sha,
      DEPLOYMENT_TIMESTAMP: baseline.deployment_timestamp,
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
    }).map(([name, value]) => ({ name, value }));
    env.push({
      name: "DATABASE_URL",
      value_source: [{ secret_key_ref: [{ secret: "runtime-database-url", version: "1" }] }],
    });
    const entry = {
      containers: [
        {
          image: baseline[`${workload}_image`],
          env,
          args: [],
          resources: { cpu: "1", memory: "512Mi" },
        },
      ],
      service_account: `${workload}@staging.example`,
      timeout: "60s",
      vpc_access: { egress: "PRIVATE_RANGES_ONLY" },
    };
    const before = {
      project: baseline.project_id,
      location: baseline.region,
      name: `lead-agent-staging-${workload}`,
      labels: {
        "git-sha": baseline.git_commit_sha.slice(0, 12),
        "migration-head": baseline.migration_head.replaceAll("_", "-"),
      },
      template: workload === "migrator" ? [{ template: [entry] }] : [entry],
      latest_ready_revision: "computed",
    };
    const after = structuredClone(before);
    if (workload === "api") {
      after.labels["git-sha"] = connectionFaultCodeSource.slice(0, 12);
      container(after).image = variables().api_image;
      for (const e of container(after).env) {
        if (e.name === "DEPLOYMENT_GIT_SHA") e.value = connectionFaultCodeSource;
        if (e.name === "DEPLOYMENT_IMAGE_DIGEST") e.value = variables().api_image;
        if (e.name === "DEPLOYMENT_TIMESTAMP") e.value = variables().api_deployment_timestamp;
      }
    }
    resources.push(
      row(
        `google_cloud_run_v2_${type}.${workload}[0]`,
        `google_cloud_run_v2_${type}`,
        before,
        after,
        workload === "api" ? ["update"] : ["no-op"],
      ),
    );
  }
  for (let i = 0; i < 84; i++)
    resources.push(
      row(`google_project_iam_member.preserved_${i}`, "google_project_iam_member", {
        project: baseline.project_id,
        role: "roles/viewer",
        member: "serviceAccount:fixture@staging.example",
        etag: "computed",
      }),
    );
  const inventory = { resources: resources.map((r) => ({ address: r.address, mode: r.mode })) };
  return {
    format_version: "1.2",
    terraform_version: "1.14.7",
    variables: Object.fromEntries(
      Object.entries(variables()).map(([key, value]) => [key, { value }]),
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
    prior_state: { values: { root_module: structuredClone(inventory) } },
    planned_values: { root_module: structuredClone(inventory) },
  };
}

test("one API image/provenance update, 88 configurations, fault absent", () => {
  assert.deepEqual(verifyConnectionFaultCodePlan(fixture(), schema), {
    managedResources: 88,
    changedResources: 1,
    mode: "plan",
  });
});
test("post-apply convergence requires the new image, not the old healthy image", () => {
  const p = fixture();
  change(p).before = structuredClone(change(p).after);
  change(p).actions = ["no-op"];
  assert.equal(verifyConnectionFaultCodePlan(p, schema, "verify").changedResources, 0);
  container(change(p).before).image = baseline.api_image;
  assert.throws(() => verifyConnectionFaultCodePlan(p, schema, "verify"));
});
for (const [name, mutate] of [
  [
    "foreign project",
    (p) => {
      change(p).after.project = "foreign";
    },
  ],
  [
    "foreign region",
    (p) => {
      change(p).after.location = "europe-west1";
    },
  ],
  [
    "wrong service",
    (p) => {
      change(p).after.name += "-other";
    },
  ],
  [
    "unreviewed baseline",
    (p) => {
      container(change(p).before).image = variables().api_image;
    },
  ],
  [
    "unknown code source",
    (p) => {
      p.variables.api_git_commit_sha.value = "f".repeat(40);
    },
  ],
  [
    "mutable tag",
    (p) => {
      p.variables.api_image.value = "api:latest";
    },
  ],
  [
    "wrong migration",
    (p) => {
      p.variables.migration_head.value = "0031_s22_widget_inbound_route_management";
    },
  ],
  [
    "invalid date",
    (p) => {
      p.variables.api_deployment_timestamp.value = "2026-99-99T12:00:00Z";
    },
  ],
  [
    "wrong provenance label",
    (p) => {
      change(p).after.labels["git-sha"] = "unreviewed";
    },
  ],
  [
    "secret reference change",
    (p) => {
      container(change(p).after).env.at(-1).value_source[0].secret_key_ref[0].version = "latest";
    },
  ],
  [
    "service account change",
    (p) => {
      change(p).after.template[0].service_account = "owner@example";
    },
  ],
  [
    "VPC change",
    (p) => {
      change(p).after.template[0].vpc_access.egress = "ALL_TRAFFIC";
    },
  ],
  [
    "timeout change",
    (p) => {
      change(p).after.template[0].timeout = "600s";
    },
  ],
  [
    "resource limit change",
    (p) => {
      container(change(p).after).resources.cpu = "2";
    },
  ],
  [
    "command argument change",
    (p) => {
      container(change(p).after).args = ["run-drill"];
    },
  ],
  [
    "extra container",
    (p) => {
      change(p).after.template[0].containers.push(structuredClone(container(change(p).after)));
    },
  ],
  [
    "duplicate environment",
    (p) => {
      container(change(p).after).env.push(structuredClone(container(change(p).after).env[0]));
    },
  ],
  [
    "worker binding",
    (p) => {
      p.variables.ai_journey_widget_session_id.value = "01a12c02-3e50-7663-99f4-c35024796c23";
    },
  ],
  [
    "worker image",
    (p) => {
      container(change(p, "google_cloud_run_v2_worker_pool.worker[0]").after).image = "foreign";
    },
  ],
  [
    "SQL tier",
    (p) => {
      p.variables.cloud_sql_tier.value = "db-custom-1-3840";
    },
  ],
  [
    "IAM action",
    (p) => {
      change(p, "google_project_iam_member.preserved_0").actions = ["update"];
    },
  ],
  [
    "hidden no-op change",
    (p) => {
      change(p, "google_project_iam_member.preserved_0").after.role = "roles/owner";
    },
  ],
  [
    "configurable unknown",
    (p) => {
      change(p).after_unknown = { template: [{ containers: [{ image: true }] }] };
    },
  ],
  [
    "optional computed unknown",
    (p) => {
      change(p).after_unknown = { labels: true };
    },
  ],
  [
    "schema unknown field",
    (p) => {
      change(p).after.unknown_field = "unreviewed";
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
      change(p).replace_paths = [["name"]];
    },
  ],
  [
    "moved address",
    (p) => {
      p.resource_changes[0].previous_address = "other";
    },
  ],
  [
    "foreign provider",
    (p) => {
      p.resource_changes[0].provider_name = "other";
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
    "incomplete prior inventory",
    (p) => {
      p.prior_state.values.root_module.resources.pop();
    },
  ],
  [
    "incomplete planned inventory",
    (p) => {
      p.planned_values.root_module.resources.pop();
    },
  ],
  [
    "secret payload read",
    (p) => {
      p.resource_changes.at(-1).address = "data.google_secret_manager_secret_version.private";
    },
  ],
  [
    "deferred change",
    (p) => {
      p.deferred_changes = [{}];
    },
  ],
  [
    "errored plan",
    (p) => {
      p.errored = true;
    },
  ],
  [
    "wrong Terraform",
    (p) => {
      p.terraform_version = "1.15.0";
    },
  ],
])
  test(`rejects ${name}`, () => {
    const p = fixture();
    mutate(p);
    assert.throws(() => verifyConnectionFaultCodePlan(p, schema));
  });

for (const key of ["S22_CONNECTION_FAULT_PROFILE", "GOOGLE_CLOUD_PROJECT", "GOOGLE_CLOUD_REGION"])
  for (const side of ["before", "after"])
    test(`rejects ${key} even on ${side}`, () => {
      const p = fixture();
      container(change(p)[side]).env.push({ name: key, value: "not-authorized" });
      assert.throws(() => verifyConnectionFaultCodePlan(p, schema));
    });

test("computed-only drift is allowed; configuration drift and duplicate drift are denied", () => {
  const p = fixture();
  p.resource_drift = [structuredClone(p.resource_changes[4])];
  p.resource_drift[0].change.after.etag = "new-computed";
  assert.equal(verifyConnectionFaultCodePlan(p, schema).changedResources, 1);
  p.resource_drift[0].change.after.role = "roles/owner";
  assert.throws(() => verifyConnectionFaultCodePlan(p, schema));
});
test("binary image must match the authenticated manifest request", () => {
  assert.throws(() =>
    verifyConnectionFaultCodePlan(fixture(), schema, "plan", { TF_VAR_api_image: "foreign" }),
  );
});
const request = (action = "plan") => ({
  ...Object.fromEntries(
    Object.entries(variables()).map(([key, value]) => [`TF_VAR_${key}`, String(value)]),
  ),
  S22_PHASE: "connection-fault-code",
  S22_ACTION: action,
  S22_COMMIT_SHA: "f".repeat(40),
  GITHUB_SHA: "f".repeat(40),
  GITHUB_REF_NAME: "verify/s22-staging-recovery-capacity",
  S22_CONNECTION_FAULT_BUILD_RUN_ID: "123",
  S22_RUNTIME_GIT_COMMIT_SHA: baseline.git_commit_sha,
  S22_RUNTIME_DEPLOYMENT_TIMESTAMP: baseline.deployment_timestamp,
  S22_API_GIT_COMMIT_SHA: connectionFaultCodeSource,
  S22_MIGRATOR_GIT_COMMIT_SHA: baseline.git_commit_sha,
  S22_MIGRATOR_DEPLOYMENT_TIMESTAMP: baseline.deployment_timestamp,
  S22_AI_JOURNEY_MODE: "preserve",
  ...(action === "apply"
    ? {
        S22_APPROVAL_TOKEN: "S22-APPLY-APPROVED",
        S22_PLAN_RUN_ID: "456",
        S22_APPROVED_PLAN_SHA256: "b".repeat(64),
      }
    : {}),
});
test("request gate requires bounded exact-source planning and separately approved apply", () => {
  assert.equal(verifyConnectionFaultCodeRequest(request()), true);
  assert.equal(verifyConnectionFaultCodeRequest(request("apply")), true);
  for (const [action, key, value] of [
    ["plan", "S22_APPROVAL_TOKEN", "S22-APPLY-APPROVED"],
    ["plan", "GITHUB_SHA", "a".repeat(40)],
    ["plan", "S22_AI_JOURNEY_MODE", "paused"],
    ["plan", "S22_MIGRATOR_EXECUTION_ID", "some-job"],
    ["plan", "S22_API_GIT_COMMIT_SHA", baseline.git_commit_sha],
    ["apply", "S22_APPROVED_PLAN_SHA256", ""],
    ["apply", "S22_APPROVAL_TOKEN", ""],
    ["apply", "S22_PLAN_RUN_ID", "0"],
  ])
    assert.throws(() => verifyConnectionFaultCodeRequest({ ...request(action), [key]: value }));
});
const manifest = () =>
  Object.entries({
    build_run_id: "123",
    source_commit: connectionFaultCodeSource,
    artifact_registry: "me-central1-docker.pkg.dev/lead-agent-stg-739284/lead-agent",
    architecture: "linux/amd64",
    image_scope: "api",
    api_digest: variables().api_image.split("@")[1],
    api_reference: variables().api_image,
  })
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
test("authenticated API-only build manifest binds exact source/digest/architecture/run", () => {
  assert.equal(verifyConnectionFaultCodeManifest(manifest(), request()), true);
  for (const source of [
    manifest() + "\nimage_scope=api",
    manifest().replace("image_scope=api", "image_scope=all"),
    manifest().replace("linux/amd64", "linux/arm64"),
    manifest().replace(connectionFaultCodeSource, baseline.git_commit_sha),
    manifest().replace("build_run_id=123", "build_run_id=124"),
  ])
    assert.throws(() => verifyConnectionFaultCodeManifest(source, request()));
});
test("build and saved-plan provenance require exact successful authenticated workflow runs", () => {
  for (const kind of ["build", "plan"]) {
    const receipt = {
      id: kind === "build" ? 123 : 456,
      status: "completed",
      conclusion: "success",
      event: "workflow_dispatch",
      head_sha: request().S22_COMMIT_SHA,
      head_branch: request().GITHUB_REF_NAME,
      path: `.github/workflows/staging-${kind === "build" ? "images" : "terraform"}.yml`,
      repository: { full_name: "mufazzalshokh/lead-agent-platform" },
    };
    assert.equal(verifyConnectionFaultCodeRun(receipt, request("apply"), kind), true);
    if (kind === "build") {
      assert.equal(
        selectConnectionFaultCodeBuildRun({ total_count: 1, workflow_runs: [receipt] }, request()),
        "123",
      );
      for (const listing of [
        { total_count: 0, workflow_runs: [] },
        { total_count: 2, workflow_runs: [receipt, receipt] },
        { total_count: 3, workflow_runs: [receipt] },
        { total_count: 1, workflow_runs: [{ ...receipt, head_sha: baseline.git_commit_sha }] },
      ])
        assert.throws(() => selectConnectionFaultCodeBuildRun(listing, request()));
    }
    for (const [key, value] of [
      ["id", 999],
      ["status", "in_progress"],
      ["conclusion", "failure"],
      ["event", "push"],
      ["head_sha", baseline.git_commit_sha],
      ["head_branch", "unreviewed"],
      ["path", "unreviewed.yml"],
      ["repository", { full_name: "other/repo" }],
    ])
      assert.throws(() =>
        verifyConnectionFaultCodeRun({ ...receipt, [key]: value }, request("apply"), kind),
      );
  }
});
test("CLI failure never prints plan contents", () => {
  const result = spawnSync(
    process.execPath,
    [
      ".github/scripts/s22-connection-fault-code-plan-check.mjs",
      "package.json",
      "package.json",
      "plan",
    ],
    { encoding: "utf8", timeout: 5000 },
  );
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr.trim(), "S22_CONNECTION_FAULT_CODE_PLAN_DENIED");
});
test("workflow gates request/build/plan/apply and preserves the legacy guard", () => {
  const source = readFileSync(".github/workflows/staging-terraform.yml", "utf8").replaceAll(
    "\r\n",
    "\n",
  );
  const step = (name) =>
    source.split(`      - name: ${name}\n`)[1]?.split(/\n {6}- (?:name|uses):/u)[0];
  assert.ok(source.includes("- connection-fault-code"));
  const inputs = source.split("\npermissions:")[0].match(/^ {6}[a-z0-9_]+:$/gmu);
  assert.equal(inputs?.length, 25);
  assert.ok(
    source.indexOf("- name: Validate connection-fault code request") <
      source.indexOf("- name: Authenticate to Google Cloud without a key"),
  );
  assert.ok(step("Verify connection-fault code image provenance")?.includes("--build"));
  assert.ok(step("Verify default-off connection-fault code plan")?.includes("s22.tfplan plan"));
  assert.ok(
    source.indexOf("- name: Verify connection-fault code saved-plan provenance") <
      source.indexOf("- name: Download exact owner-reviewed plan"),
  );
  assert.ok(
    step("Verify exact connection-fault code approval boundary")?.includes(
      '"$ACTUAL_PLAN_SHA256" == "$S22_APPROVED_PLAN_SHA256"',
    ),
  );
  assert.ok(
    step("Verify exact connection-fault code approval boundary")?.includes(
      "sha256sum infra/deploy/gcp/staging/s22.tfplan",
    ),
  );
  assert.ok(
    step("Verify default-off connection-fault code convergence")?.includes(
      "s22-connection-fault-code-convergence.tfplan verify",
    ),
  );
  assert.ok(
    readFileSync(".github/scripts/s22-api-image-plan-check.sh", "utf8").includes(
      "0031_s22_widget_inbound_route_management",
    ),
  );
  for (const name of [
    "Execute one-shot migrator",
    "Verify migrated staging database",
    "Run bounded migration failure diagnostics",
  ])
    assert.ok(
      !step(name)
        ?.split("\n")
        .find((line) => line.includes("if:"))
        ?.includes("connection-fault-code"),
    );
});
