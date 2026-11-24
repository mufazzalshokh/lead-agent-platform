import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { gzipSync } from "node:zlib";

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
