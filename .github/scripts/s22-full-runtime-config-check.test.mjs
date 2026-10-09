import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { verifyFullRuntimeConfiguration } from "./s22-full-runtime-config-check.mjs";

const provider = "registry.terraform.io/hashicorp/google";
const sessionId = "01923456-1234-7123-8123-123456789abc";
const optional = { type: "string", optional: true };
const required = { type: "string", required: true };
const nested = (block) => ({ nesting_mode: "list", block });
const environment = {
  attributes: { name: required, value: optional },
  block_types: {
    value_source: nested({
      block_types: {
        secret_key_ref: nested({ attributes: { secret: required, version: required } }),
      },
    }),
  },
};
const container = {
  attributes: { image: required, args: { type: ["list", "string"], optional: true } },
  block_types: {
    env: nested(environment),
    resources: nested({
      attributes: {
        limits: { type: ["map", "string"], optional: true },
      },
    }),
  },
};
const template = {
  attributes: { service_account: optional },
  block_types: {
    containers: nested(container),
    vpc_access: nested({
      attributes: {
        egress: optional,
      },
    }),
  },
};
const top = {
  attributes: {
    name: required,
    labels: { type: ["map", "string"], optional: true },
    latest_revision: { type: "string", computed: true },
    optional_computed: { type: "string", optional: true, computed: true },
  },
  block_types: { template: nested(template) },
};
const job = {
  ...top,
  block_types: {
    template: nested({
      block_types: {
        template: nested(template),
      },
    }),
  },
};
const schema = {
  provider_schemas: {
    [provider]: {
      resource_schemas: {
        google_cloud_run_v2_service: { block: top },
        google_cloud_run_v2_worker_pool: { block: top },
        google_cloud_run_v2_job: { block: job },
        google_sql_database_instance: { block: { attributes: { name: required, tier: optional } } },
      },
    },
  },
};
const addresses = {
  api: "google_cloud_run_v2_service.api[0]",
  web: "google_cloud_run_v2_service.web[0]",
  worker: "google_cloud_run_v2_worker_pool.worker[0]",
  migrator: "google_cloud_run_v2_job.migrator[0]",
};
const getContainer = (value, workload = "worker") =>
  workload === "migrator"
    ? value.template[0].template[0].containers[0]
    : value.template[0].containers[0];
const findChange = (plan, workload = "worker") =>
  plan.resource_changes.find((resource) => resource.address === addresses[workload]).change;

function fixture(mode = "widget_booking") {
  const commit = "a".repeat(40);
  const timestamp = "2026-10-08T06:00:00Z";
  const variables = Object.fromEntries(
    Object.keys(addresses).map((workload) => [
      `${workload}_image`,
      { value: `image/${workload}@sha256:${"a".repeat(64)}` },
    ]),
  );
  Object.assign(variables, {
    git_commit_sha: { value: commit },
    deployment_timestamp: { value: timestamp },
    ai_journey_mode: { value: mode },
    ai_journey_widget_session_id: { value: mode === "widget_booking" ? sessionId : "" },
  });
  const resource_changes = Object.entries(addresses).map(([workload, address]) => {
    const env = [
      { name: "DEPLOYMENT_GIT_SHA", value: "b".repeat(40) },
      { name: "DEPLOYMENT_TIMESTAMP", value: "2026-10-07T20:22:40Z" },
      { name: "DEPLOYMENT_MIGRATION_HEAD", value: "0031_s22_widget_inbound_route_management" },
      {
        name: "DATABASE_URL",
        value: null,
        value_source: [{ secret_key_ref: [{ secret: "worker-db", version: "latest" }] }],
      },
    ];
    if (["api", "migrator"].includes(workload))
      env.push({ name: "DEPLOYMENT_IMAGE_DIGEST", value: "old-image" });
    if (workload === "worker") env.push({ name: "AI_JOURNEY_MODE", value: "booking" });
    const inner = {
      service_account: `${workload}@staging.example`,
      vpc_access: [{ egress: "PRIVATE_RANGES_ONLY" }],
      containers: [
        {
          image: "old-image",
          args: [],
          env,
          resources: [{ limits: { cpu: "1", memory: "512Mi" } }],
        },
      ],
    };
    const before = {
      name: workload,
      labels: { "git-sha": "b".repeat(12), environment: "staging" },
      latest_revision: "old-revision",
      optional_computed: "stable-provider-default",
      template: workload === "migrator" ? [{ template: [inner] }] : [inner],
    };
    const after = structuredClone(before);
    after.labels["git-sha"] = commit.slice(0, 12);
    after.latest_revision = null;
    const afterContainer = getContainer(after, workload);
    afterContainer.image = variables[`${workload}_image`].value;
    for (const entry of afterContainer.env) {
      if (entry.name === "DEPLOYMENT_GIT_SHA") entry.value = commit;
      if (entry.name === "DEPLOYMENT_TIMESTAMP") entry.value = timestamp;
      if (entry.name === "DEPLOYMENT_IMAGE_DIGEST") entry.value = afterContainer.image;
      if (entry.name === "AI_JOURNEY_MODE") entry.value = mode;
    }
    if (workload === "worker" && mode === "widget_booking")
      afterContainer.env.push({ name: "AI_JOURNEY_WIDGET_SESSION_ID", value: sessionId });
    return {
      address,
      mode: "managed",
      provider_name: provider,
      type: address.split(".")[0],
      change: {
        actions: ["update"],
        before,
        after,
        after_unknown: { latest_revision: true },
        replace_paths: [],
      },
    };
  });
  resource_changes.push({
    address: "google_sql_database_instance.staging",
    mode: "managed",
    provider_name: provider,
    type: "google_sql_database_instance",
    change: {
      actions: ["no-op"],
      before: { name: "staging", tier: "db-f1-micro" },
      after: { name: "staging", tier: "db-f1-micro" },
      after_unknown: {},
      replace_paths: [],
    },
  });
  return { variables, resource_changes };
}
const denied = (plan) =>
  assert.throws(
    () => verifyFullRuntimeConfiguration(plan, schema),
    /S22_FULL_RUNTIME_CONFIGURATION_DENIED/u,
  );

test("allows only exact all-runtime provenance/images and reviewed Widget mode/session changes", () => {
  assert.deepEqual(verifyFullRuntimeConfiguration(fixture(), schema), {
    managedResources: 5,
    changedResources: 4,
  });
  for (const mode of ["paused", "booking"])
    assert.equal(verifyFullRuntimeConfiguration(fixture(mode), schema).changedResources, 4);
});
test("preserves configured secrets, memory, networks, commands, labels, and arbitrary environment", () => {
  for (const mutate of [
    (value) => {
      getContainer(value).env.find(
        (entry) => entry.name === "DATABASE_URL",
      ).value_source[0].secret_key_ref[0].secret = "other-secret";
    },
    (value) => {
      getContainer(value).resources[0].limits.memory = "1Gi";
    },
    (value) => {
      value.template[0].vpc_access[0].egress = "ALL_TRAFFIC";
    },
    (value) => {
      getContainer(value).args = ["run-other-command"];
    },
    (value) => {
      value.labels.environment = "other";
    },
    (value) => {
      getContainer(value).env.push({ name: "UNREVIEWED_FLAG", value: "enabled" });
    },
    (value) => {
      value.optional_computed = "changed-provider-default";
    },
  ]) {
    const plan = fixture();
    mutate(findChange(plan).after);
    denied(plan);
  }
});
test("rejects wrong, duplicate, absent, or inactive Widget session binding and wrong mode", () => {
  for (const mutate of [
    (env) => {
      env.find((entry) => entry.name === "AI_JOURNEY_WIDGET_SESSION_ID").value =
        "01923456-1234-7123-8123-123456789abd";
    },
    (env) => {
      env.push({ name: "AI_JOURNEY_WIDGET_SESSION_ID", value: sessionId });
    },
    (env) => {
      env.splice(
        env.findIndex((entry) => entry.name === "AI_JOURNEY_WIDGET_SESSION_ID"),
        1,
      );
    },
    (env) => {
      env.find((entry) => entry.name === "AI_JOURNEY_MODE").value = "booking";
    },
    (env) => {
      env.find((entry) => entry.name === "AI_JOURNEY_WIDGET_SESSION_ID").value_source = [
        { secret_key_ref: [{ secret: "unreviewed-binding", version: "latest" }] },
      ];
    },
  ]) {
    const plan = fixture();
    mutate(getContainer(findChange(plan).after).env);
    denied(plan);
  }
  const inactive = fixture("booking");
  getContainer(findChange(inactive).after).env.push({
    name: "AI_JOURNEY_WIDGET_SESSION_ID",
    value: sessionId,
  });
  denied(inactive);
  const wrongVersion = fixture();
  wrongVersion.variables.ai_journey_widget_session_id.value = sessionId.replace("-7123-", "-4123-");
  getContainer(findChange(wrongVersion).after).env.find(
    (entry) => entry.name === "AI_JOURNEY_WIDGET_SESSION_ID",
  ).value = wrongVersion.variables.ai_journey_widget_session_id.value;
  denied(wrongVersion);
});
test("binds each after image/provenance and excludes session variables from other workloads", () => {
  for (const workload of Object.keys(addresses)) {
    const plan = fixture();
    getContainer(findChange(plan, workload).after, workload).image = "unapproved-image";
    denied(plan);
  }
  for (const name of ["DEPLOYMENT_GIT_SHA", "DEPLOYMENT_TIMESTAMP", "DEPLOYMENT_MIGRATION_HEAD"]) {
    const plan = fixture();
    getContainer(findChange(plan, "api").after, "api").env.find(
      (entry) => entry.name === name,
    ).value = "wrong";
    denied(plan);
  }
  const apiSession = fixture();
  getContainer(findChange(apiSession, "api").after, "api").env.push({
    name: "AI_JOURNEY_WIDGET_SESSION_ID",
    value: sessionId,
  });
  denied(apiSession);
  const webDigest = fixture();
  getContainer(findChange(webDigest, "web").after, "web").env.push({
    name: "DEPLOYMENT_IMAGE_DIGEST",
    value: "unexpected-new-env",
  });
  denied(webDigest);
});
test("rejects configurable unknowns while allowing computed-only revision unknowns", () => {
  for (const after_unknown of [
    { template: [{ containers: [{ env: true }] }] },
    { template: [{ containers: [{ resources: [{ limits: true }] }] }] },
    { optional_computed: true },
  ]) {
    const plan = fixture();
    findChange(plan).after_unknown = after_unknown;
    denied(plan);
  }
});
test("rejects unrelated/no-op drift, replacement, creation, duplicate, missing, and foreign-provider resources", () => {
  for (const mutate of [
    (plan) => {
      plan.resource_changes.at(-1).change.after.tier = "larger-tier";
    },
    (plan) => {
      plan.resource_changes.at(-1).change.actions = ["update"];
    },
    (plan) => {
      findChange(plan).replace_paths = [["name"]];
    },
    (plan) => {
      findChange(plan).actions = ["delete", "create"];
    },
    (plan) => {
      findChange(plan).actions = ["create"];
    },
    (plan) => {
      plan.resource_changes.push(structuredClone(plan.resource_changes[0]));
    },
    (plan) => {
      plan.resource_changes.splice(0, 1);
    },
    (plan) => {
      plan.resource_changes[0].provider_name = "unapproved/provider";
    },
  ]) {
    const plan = fixture();
    mutate(plan);
    denied(plan);
  }
});
test("finite CLI failure never dumps the input", () => {
  const result = spawnSync(
    process.execPath,
    [".github/scripts/s22-full-runtime-config-check.mjs", "package.json", "package.json"],
    {
      encoding: "utf8",
      timeout: 5000,
    },
  );
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr.trim(), "S22_FULL_RUNTIME_CONFIGURATION_DENIED");
});
