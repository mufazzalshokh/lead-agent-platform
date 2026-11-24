import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { gzipSync } from "node:zlib";
import { databaseValidatorReceipt } from "./s22-database-validator-execution.mjs";

const workflow = readFileSync(".github/workflows/staging-terraform.yml", "utf8");
const validator = readFileSync(".github/scripts/s22-staging-database-validator.mjs", "utf8");
const profile = (head) =>
  runInNewContext(`${validator.split("const main = async () => {")[0]}\nmigrationProfile(head)`, {
    head,
  });

test("runtime provenance checks fetch complete history without relaxing exact commit or ancestry guards", () => {
  const checkout = workflow.match(/- name: Check out exact commit[\s\S]*?(?=\n {6}- name:)/u)?.[0];
  const proof = workflow.match(
    /- name: Prove commit is preserved on the dispatched branch[\s\S]*?(?=\n {6}- name:)/u,
  )?.[0];
  assert.ok(checkout);
  assert.ok(proof);
  assert.ok(checkout.includes("ref: ${{ env.S22_COMMIT_SHA }}"));
  assert.match(checkout, /^\s+fetch-depth:\s+0\s*$/mu);
  assert.ok(proof.includes('test "$(git rev-parse HEAD)" = "$REQUESTED_SHA"'));
  assert.ok(
    proof.includes('git merge-base --is-ancestor "$REQUESTED_SHA" "origin/$DISPATCH_BRANCH"'),
  );
  assert.ok(
    proof.includes('git merge-base --is-ancestor "$S22_RUNTIME_GIT_COMMIT_SHA" "$REQUESTED_SHA"'),
  );
});

test("database validator accepts only the exact approved packaged heads and their journal counts", () => {
  assert.equal(profile("0031_s22_widget_inbound_route_management").count, 32);
  assert.equal(profile("0032_s22_widget_recovery").count, 33);
  assert.equal(profile("0033_first_owner_signup").count, 34);
  for (const head of [undefined, "", "0030_s22_first_tenant_bootstrap", "0033_unreviewed"])
    assert.throws(() => profile(head), /Unreviewed migration head/u);
  assert.match(validator, /migrationProfile\(required\("DEPLOYMENT_MIGRATION_HEAD"\)\)/u);
  assert.match(validator, /observed === profile\.count/u);
  assert.match(validator, /observed === packaged\.count/u);
  assert.match(validator, /default_transaction_read_only=on/u);
  assert.match(validator, /head\?\.tag === profile\.head/u);
});
test("signup migration uses the isolated migrator and reviewed application rollout phases", () => {
  const signupBoundary = workflow.match(
    /if \[\[ "\$TF_VAR_migration_head" == "0033_first_owner_signup" \]\]; then([\s\S]*?)\n\s*fi/u,
  )?.[1];
  assert.ok(signupBoundary);
  assert.deepEqual(
    [...signupBoundary.matchAll(/"\$PHASE" == "([a-z-]+)"/gu)].map(([, phase]) => phase),
    [
      "runtime-preflight",
      "migrator-image-update",
      "migrator-image-verify",
      "migration-resume",
      "migration-validate",
      "full",
    ],
  );
  assert.match(validator, /if \(profile\.count >= 33\)/u);
  assert.match(validator, /assertion: "first_owner_signup_boundary"/u);
  assert.match(validator, /grant_entry\.grantee = 0/u);
});
test("transports the validator within the Cloud Run environment value limit", () => {
  const args = workflow.match(/--args='\^\|\^(--input-type=module\|-e\|[^'\r\n]+)'/u)?.[1];
  assert.ok(args);
  assert.ok(Buffer.byteLength(gzipSync(validator).toString("base64")) < 32_000);
  const receipt = execFileSync(process.execPath, args.split("|"), {
    encoding: "utf8",
    env: {
      ...process.env,
      S22_VALIDATOR_GZIP_B64: gzipSync('process.stdout.write("validator ✓")').toString("base64"),
    },
  });
  assert.equal(receipt, "validator ✓");
});
test("validates pinned Cloud Run task status and emits only the approved database receipt", () => {
  const packagedHead = "0033_first_owner_signup";
  const expected = {
    executionId: "lead-agent-staging-migrator-run12",
    projectNumber: "123456",
    image: `me-central1-docker.pkg.dev/lead-agent-stg-739284/lead-agent/migrator@sha256:${"a".repeat(64)}`,
    source: "b".repeat(40),
    packagedHead,
    schemaHead: packagedHead,
    validatorSha: createHash("sha256").update(validator).digest("hex"),
  };
  const fixture = {
    name: `projects/${expected.projectNumber}/locations/me-central1/jobs/lead-agent-staging-migrator/executions/${expected.executionId}`,
    taskCount: 1,
    succeededCount: 1,
    completionTime: "2026-11-24T18:00:00Z",
    conditions: [{ type: "Completed", state: "CONDITION_SUCCEEDED", message: "sensitive data" }],
    template: {
      maxRetries: 0,
      serviceAccount: "lead-agent-staging-migrator@lead-agent-stg-739284.iam.gserviceaccount.com",
      containers: [
        {
          image: expected.image,
          command: ["node"],
          args: workflow
            .match(/--args='\^\|\^(--input-type=module\|-e\|[^'\r\n]+)'/u)[1]
            .split("|"),
          env: [
            { name: "DEPLOYMENT_ENVIRONMENT", value: "staging" },
            { name: "DEPLOYMENT_GIT_SHA", value: expected.source },
            { name: "DEPLOYMENT_MIGRATION_HEAD", value: packagedHead },
            { name: "S22_VALIDATOR_SCHEMA_HEAD", value: packagedHead },
            { name: "S22_VALIDATOR_GZIP_B64", value: gzipSync(validator).toString("base64") },
            { name: "DATABASE_URL", value: "sensitive data" },
          ],
        },
      ],
    },
  };
  const receipt = databaseValidatorReceipt(fixture, expected);
  assert.equal(receipt.outcome, "PASS");
  assert.equal(receipt.applied_migration_count, 34);
  assert.equal(receipt.first_owner_signup_boundary, "PASS");
  assert.doesNotMatch(JSON.stringify(receipt), /sensitive data|DATABASE_URL/u);
  const omittedRetryLimit = structuredClone(fixture);
  delete omittedRetryLimit.template.maxRetries;
  assert.equal(databaseValidatorReceipt(omittedRetryLimit, expected).retry_limit_reported, false);
  assert.throws(
    () => databaseValidatorReceipt({ ...omittedRetryLimit, retriedCount: 1 }, expected),
    {
      message: /^S22V095/u,
    },
  );

  for (const [patch, code] of [
    [{ name: fixture.name.replace("123456", "111111") }, /^S22V091/u],
    [{ taskCount: 2 }, /^S22V092/u],
    [{ succeededCount: 0 }, /^S22V095/u],
    [{ failedCount: 1 }, /^S22V095/u],
    [{ retriedCount: 1 }, /^S22V095/u],
    [{ conditions: [{ type: "Completed", state: "CONDITION_PENDING" }] }, /^S22V095/u],
  ]) {
    assert.throws(() => databaseValidatorReceipt({ ...fixture, ...patch }, expected), {
      message: code,
    });
  }
  assert.throws(
    () => databaseValidatorReceipt(fixture, { ...expected, validatorSha: "d".repeat(64) }),
    {
      message: /^S22V094/u,
    },
  );
  const schemaHead = "0032_s22_widget_recovery";
  const baseline = { ...expected, schemaHead };
  assert.throws(() => databaseValidatorReceipt(fixture, baseline), { message: /^S22V093/u });
  fixture.template.containers[0].env.find(
    (entry) => entry.name === "S22_VALIDATOR_SCHEMA_HEAD",
  ).value = schemaHead;
  const baselineReceipt = databaseValidatorReceipt(fixture, baseline);
  assert.equal(baselineReceipt.applied_migration_count, 33);
  assert.equal(baselineReceipt.first_owner_signup_boundary, undefined);

  const step = workflow.match(
    /- name: Verify migrated staging database[\s\S]*?(?=\n {6}- name:)/u,
  )[0];
  assert.match(step, /run\.googleapis\.com\/v2\/projects/u);
  assert.doesNotMatch(step, /gcloud logging|executions logs/u);
  assert.ok(
    step.indexOf('EXECUTION_ID="$S22_MIGRATOR_EXECUTION_ID"') < step.indexOf("jobs execute"),
  );
  assert.ok(
    workflow.indexOf("Reverify the installed migrator") <
      workflow.indexOf("Execute one-shot migrator"),
  );
});
test("upgrade preflight inventories existing versions and initial setup still requires zero", () => {
  const readVersions = (head, versions) =>
    spawnSync(process.execPath, [".github/scripts/s22-channel-credential-preflight.mjs", head], {
      encoding: "utf8",
      input: JSON.stringify(versions),
    });
  const initial = "0031_s22_widget_inbound_route_management";
  const upgrade = "0033_first_owner_signup";
  const version = {
    name: "projects/123/secrets/lead-agent-staging-channel-credentials/versions/2",
    state: "ENABLED",
    createTime: "2026-10-02T00:00:00.123456789Z",
    payload: "must-not-appear",
  };
  const preflight = readVersions(upgrade, [version]);
  assert.equal(preflight.status, 0);
  assert.match(preflight.stdout, /^channel_credential_version=2 .* state=ENABLED$/mu);
  assert.doesNotMatch(preflight.stdout, /must-not-appear|secret_empty=true/u);
  assert.equal(readVersions(upgrade, [version, version]).status, 1);
  assert.equal(readVersions(upgrade, [{ ...version, state: "DISABLED" }]).status, 1);
  assert.equal(readVersions(upgrade, [{ ...version, name: "foreign" }]).status, 1);
  assert.equal(readVersions(initial, [version]).status, 1);
  assert.match(readVersions(initial, []).stdout, /application_managed_channel_secret_empty=true/u);
});
test("migration head is explicit, defaults preserve 0031, and recovery cannot use the bootstrap migration phase", () => {
  assert.match(
    workflow,
    /migration_head:[\s\S]*?default: 0031_s22_widget_inbound_route_management/u,
  );
  const recoveryBoundary = workflow.match(
    /if \[\[ "\$TF_VAR_migration_head" == "0032_s22_widget_recovery" \]\]; then([\s\S]*?)\n\s*fi/u,
  )?.[1];
  assert.ok(recoveryBoundary);
  assert.match(recoveryBoundary, /"\$PHASE" == "migration-resume"/u);
  assert.doesNotMatch(recoveryBoundary, /"\$PHASE" == "migration"/u);
  assert.match(
    workflow,
    /git merge-base --is-ancestor "\$S22_RUNTIME_GIT_COMMIT_SHA" "\$REQUESTED_SHA"/u,
  );
});
test("both saved-plan preparation and apply revalidate the explicit migrator head", () => {
  const calls = [
    ...workflow.matchAll(
      /bash \.github\/scripts\/s22-migrator-image-plan-check\.sh \\([\s\S]*?)(?:\n\s*\| tee|\n\n)/gu,
    ),
  ];
  assert.equal(calls.length, 2);
  for (const [, call] of calls) assert.match(call, /"\$TF_VAR_migration_head"/u);
});
test("recovery schema validator observes columns and validated constraints without issuing proof or backfill", () => {
  assert.match(validator, /assertion: "widget_recovery_columns"/u);
  assert.match(validator, /assertion: "widget_recovery_constraints"/u);
  assert.match(validator, /row\.convalidated === true/u);
  assert.match(validator, /row\.is_nullable === "YES"/u);
  const checks = validator.slice(
    validator.indexOf("if (profile.count >= 33)"),
    validator.indexOf('assertion: "production_table_count"'),
  );
  assert.doesNotMatch(checks, /\b(?:update|insert|delete|alter)\s/iu);
});
