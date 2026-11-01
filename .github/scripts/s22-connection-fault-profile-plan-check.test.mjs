import assert from "node:assert/strict";
import test from "node:test";
import { loadS22ConnectionFaultProfile } from "../../packages/config/src/s22-connection-fault.ts";
import {
  connectionFaultProfileReceipt,
  verifyConnectionFaultProfileArtifact,
  verifyConnectionFaultProfilePlan,
} from "./s22-connection-fault-profile-plan-check.mjs";
import {
  validateConnectionFaultProfile,
  runtimeProfileJson,
} from "./s22-connection-fault-profile.mjs";
import {
  api,
  apiChange,
  apiContainer,
  hash,
  syntheticNow,
  syntheticPlan,
  syntheticProfile,
  syntheticRawProfile,
  syntheticSchema,
  syncInventories,
} from "./s22-connection-fault-test-fixtures.mjs";

const options = (mode = "enable", stage = "plan") => ({
  mode,
  stage,
  rawProfile: syntheticRawProfile(),
  activationReceipt: connectionFaultProfileReceipt(syntheticRawProfile()),
  now: syntheticNow,
});
for (const mode of ["enable", "remove"])
  for (const stage of ["plan", "verify"])
    test(`${mode}/${stage}: preserve 88 configurations and current mixed image baseline`, () => {
      const result = verifyConnectionFaultProfilePlan(
        syntheticPlan(mode, stage),
        syntheticSchema,
        options(mode, stage),
      );
      assert.equal(result.managedResources, 88);
      assert.equal(result.changedResources, stage === "plan" ? 1 : 0);
    });
test("expired removal/convergence stays available; expired activation planning does not", () => {
  const expired = syntheticNow + 4_000_000;
  assert.throws(() =>
    verifyConnectionFaultProfilePlan(syntheticPlan(), syntheticSchema, {
      ...options(),
      now: expired,
    }),
  );
  assert.equal(
    verifyConnectionFaultProfilePlan(syntheticPlan("remove"), syntheticSchema, {
      ...options("remove"),
      now: expired,
    }).changedResources,
    1,
  );
  assert.equal(
    verifyConnectionFaultProfilePlan(syntheticPlan("enable", "verify"), syntheticSchema, {
      ...options("enable", "verify"),
      now: expired,
    }).changedResources,
    0,
  );
});
test("deployed loader admits the guard's valid structural contract and hashes normalize exactly", () => {
  const p = syntheticProfile();
  const result = loadS22ConnectionFaultProfile(
    {
      S22_CONNECTION_FAULT_PROFILE: JSON.stringify(p),
      DEPLOYMENT_ENVIRONMENT: "staging",
      GOOGLE_CLOUD_PROJECT: p.projectId,
      GOOGLE_CLOUD_REGION: p.region,
      K_SERVICE: p.service,
      DEPLOYMENT_GIT_SHA: p.sourceSha,
    },
    new Date(syntheticNow),
  );
  assert.equal(result.state, "ready");
  assert.equal(
    JSON.stringify(result.profile),
    runtimeProfileJson(validateConnectionFaultProfile(JSON.stringify(p))),
  );
  assert.notEqual(
    connectionFaultProfileReceipt(JSON.stringify(p)).configuration_sha256,
    connectionFaultProfileReceipt(JSON.stringify(p)).runtime_profile_sha256,
  );
});
for (const [name, mutate] of [
  [
    "version",
    (p) => {
      p.version = 2;
    },
  ],
  [
    "exercise version",
    (p) => {
      p.exerciseId = p.exerciseId.replace("4121", "7121");
    },
  ],
  [
    "foreign project",
    (p) => {
      p.projectId = "foreign";
    },
  ],
  [
    "foreign region",
    (p) => {
      p.region = "foreign";
    },
  ],
  [
    "foreign service",
    (p) => {
      p.service = "foreign";
    },
  ],
  [
    "foreign source",
    (p) => {
      p.sourceSha = "b".repeat(40);
    },
  ],
  [
    "bad digest",
    (p) => {
      p.sessionDigest = "x".repeat(64);
    },
  ],
  [
    "unknown field",
    (p) => {
      p.extra = true;
    },
  ],
  [
    "invalid date",
    (p) => {
      p.baselineAt = "2030-02-31T00:00:00.000Z";
    },
  ],
  [
    "noncanonical UTC",
    (p) => {
      p.baselineAt = p.baselineAt.replace(".000", "");
    },
  ],
  [
    "changed fault schedule",
    (p) => {
      p.faultAt = p.baselineAt;
    },
  ],
  [
    "extended expiry",
    (p) => {
      p.expiresAt = p.faultAt;
    },
  ],
])
  test(`profile denies ${name} without leaking input`, () => {
    const p = syntheticProfile();
    mutate(p);
    assert.throws(() => validateConnectionFaultProfile(JSON.stringify(p), syntheticNow), {
      message: "S22_CONNECTION_FAULT_PROFILE_DENIED",
    });
  });
for (const raw of [
  "private malformed {",
  " ".repeat(2049),
  "null",
  "[]",
  syntheticRawProfile().replace('"version":1', '"version":1,"version":1'),
  " " + syntheticRawProfile(),
])
  test(`finite denial for malformed/oversized/noncanonical input ${hash(raw).slice(0, 6)}`, () => {
    assert.throws(() => validateConnectionFaultProfile(raw), {
      message: "S22_CONNECTION_FAULT_PROFILE_DENIED",
    });
  });
for (const [name, mutate] of [
  [
    "target project",
    (p) => {
      apiChange(p).after.project = "foreign";
    },
  ],
  [
    "target region",
    (p) => {
      apiChange(p).after.location = "foreign";
    },
  ],
  [
    "target service",
    (p) => {
      apiChange(p).after.name = "foreign";
    },
  ],
  [
    "API image",
    (p) => {
      apiContainer(apiChange(p).after).image = "api:latest";
    },
  ],
  [
    "baseline substitution on both sides",
    (p) => {
      for (const side of ["before", "after"]) apiContainer(apiChange(p)[side]).image = "other";
    },
  ],
  [
    "source provenance",
    (p) => {
      apiContainer(apiChange(p).after).env.find((e) => e.name === "DEPLOYMENT_GIT_SHA").value =
        "b".repeat(40);
    },
  ],
  [
    "migration head",
    (p) => {
      p.variables.migration_head.value = "0033_unknown";
    },
  ],
  [
    "worker AI binding",
    (p) => {
      p.variables.ai_journey_widget_session_id.value = "replacement";
    },
  ],
  [
    "selector",
    (p) => {
      p.variables.s22_connection_fault_enabled.value = "false";
    },
  ],
  [
    "mutable secret profile",
    (p) => {
      p.variables.s22_connection_fault_profile.value += " ";
    },
  ],
  [
    "env duplicate",
    (p) => {
      apiContainer(apiChange(p).after).env.push({
        name: "GOOGLE_CLOUD_REGION",
        value: "me-central1",
      });
    },
  ],
  [
    "secret reference",
    (p) => {
      apiContainer(apiChange(p).after).env.find(
        (e) => e.name === "DATABASE_URL",
      ).value_source[0].secret_key_ref[0].version = "2";
    },
  ],
  [
    "profile secret reference",
    (p) => {
      apiContainer(apiChange(p).after).env.find(
        (e) => e.name === "S22_CONNECTION_FAULT_PROFILE",
      ).value_source = [{}];
    },
  ],
  [
    "K_SERVICE injection",
    (p) => {
      apiContainer(apiChange(p).after).env.push({
        name: "K_SERVICE",
        value: "lead-agent-staging-api",
      });
    },
  ],
  [
    "command",
    (p) => {
      apiContainer(apiChange(p).after).args.push("different");
    },
  ],
  [
    "probe",
    (p) => {
      apiContainer(apiChange(p).after).startup_probe.path = "/different";
    },
  ],
  [
    "memory",
    (p) => {
      apiContainer(apiChange(p).after).resources.memory = "1Gi";
    },
  ],
  [
    "service identity",
    (p) => {
      apiChange(p).after.template[0].service_account = "other";
    },
  ],
  [
    "network",
    (p) => {
      apiChange(p).after.template[0].vpc_access.egress = "ALL_TRAFFIC";
    },
  ],
  [
    "scaling",
    (p) => {
      apiChange(p).after.template[0].scaling.max = 2;
    },
  ],
  [
    "unrelated update",
    (p) => {
      p.resource_changes[4].change.actions = ["update"];
    },
  ],
  [
    "unrelated no-op config mutation",
    (p) => {
      p.resource_changes[4].change.after.role = "roles/owner";
    },
  ],
  [
    "IAM drift",
    (p) => {
      const r = structuredClone(p.resource_changes[4]);
      r.change.after.role = "roles/owner";
      p.resource_drift = [r];
    },
  ],
  [
    "unknown optional+computed labels",
    (p) => {
      apiChange(p).after_unknown.labels = true;
    },
  ],
  [
    "unknown nested config",
    (p) => {
      apiChange(p).after_unknown.template = [{ containers: [{ args: true }] }];
    },
  ],
  [
    "unknown schema field",
    (p) => {
      apiChange(p).after.not_in_schema = "unknown";
    },
  ],
  [
    "duplicate",
    (p) => {
      p.resource_changes.push(structuredClone(p.resource_changes[4]));
    },
  ],
  [
    "replacement",
    (p) => {
      apiChange(p).actions = ["delete", "create"];
    },
  ],
  [
    "replace path",
    (p) => {
      apiChange(p).replace_paths = [["template"]];
    },
  ],
  [
    "moved address",
    (p) => {
      p.resource_changes[0].previous_address = "old";
    },
  ],
  [
    "partial inventory",
    (p) => {
      p.resource_changes.splice(4, 1);
    },
  ],
  [
    "deferred",
    (p) => {
      p.deferred_changes = [{}];
    },
  ],
  [
    "incomplete",
    (p) => {
      p.complete = false;
    },
  ],
  [
    "targeted",
    (p) => {
      p.targets = [api];
    },
  ],
  [
    "foreign data read",
    (p) => {
      p.resource_changes.at(-1).address = "data.google_secret_manager_secret_version.private";
    },
  ],
])
  test(`complete plan guard denies ${name}`, () => {
    const plan = syntheticPlan();
    mutate(plan);
    syncInventories(plan);
    assert.throws(() => verifyConnectionFaultProfilePlan(plan, syntheticSchema, options()), {
      message: "S22_CONNECTION_FAULT_PROFILE_PLAN_DENIED",
    });
  });
test("inventories must also match actual before/after configuration values", () => {
  const plan = syntheticPlan();
  plan.planned_values.root_module.resources[0].values.project = "foreign";
  assert.throws(() => verifyConnectionFaultProfilePlan(plan, syntheticSchema, options()));
});
test("computed-only revision changes are allowed; removed/changed profile receipt is not", () => {
  const plan = syntheticPlan();
  apiChange(plan).after.latest_ready_revision = "new-computed-value";
  syncInventories(plan);
  assert.equal(
    verifyConnectionFaultProfilePlan(plan, syntheticSchema, options()).changedResources,
    1,
  );
  assert.throws(() =>
    verifyConnectionFaultProfilePlan(syntheticPlan("remove"), syntheticSchema, {
      ...options("remove"),
      activationReceipt: {
        ...connectionFaultProfileReceipt(syntheticRawProfile()),
        configuration_sha256: "0".repeat(64),
      },
    }),
  );
});
const artifactFixture = () => {
  const binary = Buffer.from("synthetic saved binary, not a Terraform activation plan");
  const request = {
    mode: "enable",
    approval: "S22-APPLY-APPROVED",
    toolingSha: "c".repeat(40),
    approvedSha256: hash(binary),
    planRunId: "12345",
    branch: "verify/s22-staging-recovery-capacity",
    rawProfile: syntheticRawProfile(),
  };
  const run = {
    id: 12345,
    repository: { full_name: "mufazzalshokh/lead-agent-platform" },
    path: ".github/workflows/staging-terraform.yml",
    status: "completed",
    conclusion: "success",
    event: "workflow_dispatch",
    head_sha: request.toolingSha,
    head_branch: request.branch,
  };
  return {
    binary,
    request,
    run,
    receipt: verifyConnectionFaultProfilePlan(syntheticPlan(), syntheticSchema, options()),
  };
};
test("saved binary approval, authenticated provenance and fixed profile bind together", () => {
  const f = artifactFixture();
  assert.equal(verifyConnectionFaultProfileArtifact(f.binary, f.receipt, f.run, f.request), true);
});
for (const key of [
  "mode",
  "approval",
  "toolingSha",
  "approvedSha256",
  "planRunId",
  "branch",
  "rawProfile",
])
  test(`artifact denies changed request ${key}`, () => {
    const f = artifactFixture();
    f.request[key] = "changed";
    assert.throws(
      () => verifyConnectionFaultProfileArtifact(f.binary, f.receipt, f.run, f.request),
      { message: "S22_CONNECTION_FAULT_PROFILE_ARTIFACT_DENIED" },
    );
  });
for (const key of [
  "id",
  "path",
  "status",
  "conclusion",
  "event",
  "head_sha",
  "head_branch",
  "repository",
])
  test(`artifact denies mismatched run ${key}`, () => {
    const f = artifactFixture();
    f.run[key] = "changed";
    assert.throws(() =>
      verifyConnectionFaultProfileArtifact(f.binary, f.receipt, f.run, f.request),
    );
  });
test("artifact denies changed actual bytes even with an unchanged receipt", () => {
  const f = artifactFixture();
  assert.throws(() =>
    verifyConnectionFaultProfileArtifact(Buffer.from("different"), f.receipt, f.run, f.request),
  );
});
