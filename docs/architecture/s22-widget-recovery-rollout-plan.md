# Website Chat recovery: migration-first rollout packet

Status: PREPARED ONLY. No apply, migration execution, session replacement, customer
message, provider call or budget increase is authorized by this packet. The owner
approved preparation after the local recovery milestone, not deployment or paid
execution. S22 as a whole remains unaccepted.

## Release and tooling provenance

Runtime source: `19e7f3c33d94b466e1129586b15796f35d5f938b`.
Its [full CI 38138247096](https://github.com/mufazzalshokh/lead-agent-platform/actions/runs/38138247096)
passed `pnpm ci:verify`, including the clean PostgreSQL gate and production builds.
The [recovery design](s22-widget-recovery.md) records ownership, expiry, replay,
privacy, booking and budget invariants. There are no further application changes
in this preparation; do not rebuild or substitute runtime source for a cosmetic change.

Release-tooling source: `0949cfdc2a5e541b19366b01fd93bcdf782c808a`.
This descendant adds explicit approved migration-head selection (0031 or 0032),
strict provider-schema configuration comparison for the isolated migrator,
correct migration metadata/validator counts, and the later migration-first
three-workload action set. Existing 0031 defaults remain unchanged. Runtime
images retain their actual `19e7f3c` provenance, not the tooling commit.
Full release-tooling [CI 38139797313](https://github.com/mufazzalshokh/lead-agent-platform/actions/runs/38139797313)
**PASS** on exact `0949cfd`, including `pnpm ci:verify`, all PostgreSQL suites,
contracts, static/type checks and production builds. Local preparation checks
also passed. CI success is not a deployment or customer-journey result.

Project/region: `lead-agent-stg-739284` / `me-central1`.
Canonical release metadata timestamp: **`2026-10-11T12:34:47Z`**.

## Immutable images: built once, not deployed

[Build 38139271816](https://github.com/mufazzalshokh/lead-agent-platform/actions/runs/38139271816)
passed for the exact runtime source above. OCI provenance/SBOM and pulled
`linux/amd64` verification are enabled in the existing image workflow.
Authenticated manifest artifact: **11702269162**,
`s22-image-manifest-19e7f3c33d94b466e1129586b15796f35d5f938b-38139271816`.
Downloaded plaintext manifest SHA256:
`dc9a0221b1a2383100392402ab1f00ae7dbf1933f1ac13f3a2095fa82c11b759`.

Registry: `me-central1-docker.pkg.dev/lead-agent-stg-739284/lead-agent`.

```text
api@sha256:7174fb8ce3a5599da76d5e2a77aab68a8bbcecc473e9ff4eebc0b814ddc119b4
web@sha256:cc7dc7f7f819054b3c0ba1fd5796a1dea53f8ae45a402eadaadfc62513b95800
worker@sha256:90b4dcebfdd9bc59fee6b5f270c81469df8cb23da36caf0afbbcfebebc8dd6b6
migrator@sha256:cb3c6fc6c6f943b9d9457179e70627a1fe7dc2a59f3de91989bc7d5be7ac2919
```

## Stage A: exact saved migrator-only plan

[Plan 38139812141](https://github.com/mufazzalshokh/lead-agent-platform/actions/runs/38139812141)
passed. Authenticated artifact **11702259751**:
`s22-terraform-plan-migrator-image-update-0949cfdc2a5e541b19366b01fd93bcdf782c808a`.
Saved binary SHA256, verified against the downloaded checksum:
**`9423caa41c8c641ec34e5d72fc55e8f274876df60519036529e13a9d79a1d02e`**.

Independent installed Terraform 1.14.7 / locked Google provider 7.46.1 inspection
passed all **88 managed configurable resource comparisons**. Exact action set:

| Resource | Action | Permitted differences |
| --- | --- | --- |
| `google_cloud_run_v2_job.migrator[0]` | one in-place update | Reviewed image, source/time/migration provenance and matching labels |
| API / Web / Worker and all other managed resources | no-op | None |

**0 creates / 1 update / 0 destroys / 0 replacements.** Application images,
staff access, route/session binding, IAM, secret references, VPC, job command,
task/parallelism, resources, numeric zero retries, scaling and budget are preserved.
This updates the job definition only; it does **not** execute the migrator.
Both workflow safety validation and independent local comparison passed.
Apply, one-shot migration, database validator, booking evidence and Widget
evidence execution were all explicitly skipped by the preparation workflow.

The before-state matches the verified wording deployment `68b3011`, timestamp
`2026-10-11T09:26:04Z`, migration provenance `0031_s22_widget_inbound_route_management`,
and its authenticated image manifest SHA256
`a8bc612d1e388306c1bd0d8e9e5c1259d605d5cc78ffbbbbbcde7fca7c097bc0`.
Refreshed drift is computed-only: Artifact Registry `update_time` and the
migrator's execution-count/latest-execution metadata. No configurable drift
is authorized by that observation; prior diagnostic execution metadata is not
a new execution initiated by this preparation.

Exact preparation inputs, excluding any apply token:

```json
{
  "action": "plan",
  "phase": "migrator-image-update",
  "commit_sha": "0949cfdc2a5e541b19366b01fd93bcdf782c808a",
  "deployment_timestamp": "2026-10-11T12:34:47Z",
  "migration_head": "0032_s22_widget_recovery",
  "migrator_image": "me-central1-docker.pkg.dev/lead-agent-stg-739284/lead-agent/migrator@sha256:cb3c6fc6c6f943b9d9457179e70627a1fe7dc2a59f3de91989bc7d5be7ac2919",
  "migrator_git_commit_sha": "19e7f3c33d94b466e1129586b15796f35d5f938b",
  "runtime_git_commit_sha": "68b3011d26afe1bbb8ef0a32c4efd8f66df7c819",
  "runtime_deployment_timestamp": "2026-10-11T09:26:04Z",
  "runtime_migration_head": "0031_s22_widget_inbound_route_management",
  "api_git_commit_sha": "68b3011d26afe1bbb8ef0a32c4efd8f66df7c819",
  "api_deployment_timestamp": "2026-10-11T09:26:04Z",
  "api_migration_head": "0031_s22_widget_inbound_route_management",
  "api_image": "me-central1-docker.pkg.dev/lead-agent-stg-739284/lead-agent/api@sha256:8ee2a518dfdeda34dc8eff02283f660a1a3735332484c925df0623201e774ca9",
  "web_image": "me-central1-docker.pkg.dev/lead-agent-stg-739284/lead-agent/web@sha256:62a9672a56c2ccde54a54cae230f87f918d8e15bd061acfd7403eb5c698e530a",
  "worker_image": "me-central1-docker.pkg.dev/lead-agent-stg-739284/lead-agent/worker@sha256:d3fa54d67b455b9287e453c6dd1d111f336d7c2e609aea39857d32bbfaeb50b9",
  "ai_journey_mode": "preserve",
  "ai_journey_widget_session_id": "01a11c48-dbc2-76de-a873-f41664da5ccb"
}
```

Applying requires explicit approval of **plan 38139812141 only**, fresh
authenticated binary/checksum receipt, unchanged state lineage/serial and
revalidation of the exact plan using the pinned tooling. Never replace a stale
or expired saved plan under the old approval. A separately approved replacement
is necessary if state or artifact freshness changes.

## Stage B: migration, then application rollout

These are conditional steps, **not executed or implicitly authorized**:

1. After exact Stage A approval/apply, verify the job image/provenance, private
   VPC, unchanged secret references, zero retries and Terraform convergence.
   Current application images remain unchanged throughout this stage.
2. Obtain explicit authority for **one migration execution** of the reviewed
   job. `0032` adds seven nullable recovery/access fields and bounded checks;
   no backfill, customer proof issuance, budget/booking changes, historical
   migration edit or RLS/role/grant change. Preserve the execution ID on failure
   or timeout; do not blindly rerun or reverse SQL migrations.
3. Verify packaged/applied head `0032`, **33 migrations**, seven nullable fields
   with the expected types, four validated Widget shape/lifetime/revocation
   constraints, and the unchanged 52-table / 48 FORCE-RLS manifest and least-
   privilege role/connectivity/tenant-denial assertions. Verify authenticated
   result-log access **before** launching validation. Prior GitHub logging
   denial is not resolved by CI: use the owner's established Cloud Shell
   authentication where necessary, without broadening IAM or sharing credentials.
   Missing results block the application rollout, not permission to repeat jobs.
4. Only after migration verification, create **one fresh full-runtime saved
   plan** from the updated state. Reuse the four immutable images above, timestamp
   and runtime source `19e7f3c`; use the pinned release tooling separately. Select
   `migration_head`, `api_migration_head` and `runtime_migration_head` as `0032`;
   preserve journey mode/anchor and all budgets. Expected application action set
   is three in-place API/Web/Worker updates with the reviewed migrator already
   no-op. A fourth migrator update is permitted only for exact reviewed release
   provenance, never unreviewed configuration drift. Review its new saved binary,
   digest and action/configuration set before requesting its specific apply.
5. After that separately approved apply, verify exact deployed API/Web images,
   source/time/migration metadata, ready revisions, public health and whole-
   runtime convergence. Worker/Migrator require their own descriptor/readiness
   evidence when not independently covered by the convergence result.

No Stage B saved binary is prepared against the pre-migration state: Stage A
changes its serial and would make such a plan stale. No new application queries
may be deployed before successful migration verification. If migration or
verification fails, keep the old application running and investigate the exact
preserved failure. Compatible application rollback uses previously recorded
digests under a new reviewed plan, not SQL downgrade or blind replay.

## Customer and acceptance boundary

Do not create a test frame during build/plan/apply preparation. After verified
application rollout, plan one controlled browser recovery/booking check. A saved
customer code must be issued while the chat is accessible and retained privately.
Recovery must preserve the same conversation/request, rotate proof once and
not send or replay a message automatically. Staff acceptance remains distinct
from actual customer confirmation. Original expired chat
`01a12a04-d2ae-7cba-aded-0c48a410be0c` has no previously saved ownership code;
this release cannot retroactively restore it. Its persisted conversation/request
is not deleted. Do not fabricate an attestation or silently transfer its paid
test approval to a new session.

Existing `widget_booking` anchor `01a11c48-dbc2-76de-a873-f41664da5ccb`, ledger,
consumed counts, historical NULL costs and the USD10 ceiling remain unchanged.
Last owner-supplied Widget trace was one customer inbound / one provider
reservation, known cost USD0.010964, exposure USD1.044360, pending USD0; it is
historical evidence, **not** a current balance or new Send authorization.
Previously pinned 0031/original-expiry diagnostic readers are not recovery-aware
readiness evidence. A future paid test requires correct deployed-revision/session
evidence and explicit bounded execution approval, with no inferred budget increase.
The already completed original Instagram booking journey must not be repeated.
Telegram Business, operational restore/capacity/failure and other documented S22
acceptance gaps remain separate; this packet does not claim S22 completion.

## Verification and changed files

Preparation verification:

```text
node --test .github/scripts/s22-full-runtime-config-check.test.mjs .github/scripts/s22-recovery-rollout.test.mjs
node node_modules/vitest/vitest.mjs run tests/workspace/staging-infrastructure.test.ts tests/workspace/staging-journey-mode.test.ts --maxWorkers=1 --testTimeout=30000
node node_modules/eslint/bin/eslint.js .github/scripts/s22-full-runtime-config-check.mjs .github/scripts/s22-full-runtime-config-check.test.mjs .github/scripts/s22-staging-database-validator.mjs .github/scripts/s22-recovery-rollout.test.mjs tests/workspace/staging-journey-mode.test.ts --max-warnings=0
node node_modules/prettier/bin/prettier.cjs --check .github/workflows/staging-terraform.yml .github/scripts/s22-full-runtime-config-check.mjs .github/scripts/s22-full-runtime-config-check.test.mjs .github/scripts/s22-staging-database-validator.mjs .github/scripts/s22-recovery-rollout.test.mjs tests/workspace/staging-journey-mode.test.ts
bash -n .github/scripts/s22-full-runtime-plan-check.sh
bash -n .github/scripts/s22-migrator-image-plan-check.sh
bash -n .github/scripts/s22-migrator-image-live-verify.sh
node --check .github/scripts/s22-staging-database-validator.mjs
terraform fmt -check infra/deploy/gcp/staging
node .cache/s22-recovery-rollout/review.mjs
```

All listed checks PASS: **15 native Node cases** and **28 Vitest cases**;
the Vitest wrapper reruns native boundaries, so these counts are not claimed
as disjoint coverage. Tests deny arbitrary/mismatched heads, hidden config or
secret changes, configurable unknowns, unrelated/no-op drift, replay-like scope
changes and an incorrectly preserved migrator. Both preparation and apply
revalidate the selected migration head. The 0032 database observations are
prepared validators, not live executed assertions in this turn.

Independent saved-plan inspection requires local provider-plugin execution
permissions; the restricted attempt returned a finite denial and the authorized
inspection passed. Raw plan/state/provider JSON stay in memory or ignored local
artifacts, not chat, Git or public documentation. Build/plan receipts and
head SHA verification are authenticated GitHub reads.

In-scope release-tooling files (no application or SQL edits):

```text
.github/scripts/s22-full-runtime-config-check.mjs
.github/scripts/s22-full-runtime-config-check.test.mjs
.github/scripts/s22-full-runtime-plan-check.sh
.github/scripts/s22-migrator-image-live-verify.sh
.github/scripts/s22-migrator-image-plan-check.sh
.github/scripts/s22-staging-database-validator.mjs
.github/scripts/s22-recovery-rollout.test.mjs
.github/workflows/staging-terraform.yml
infra/deploy/gcp/staging/variables.tf
tests/workspace/staging-journey-mode.test.ts
docs/architecture/s22-widget-recovery-rollout-plan.md
docs/architecture/s22-widget-recovery.md
```

Existing owner edits in `README.md`, `docs/architecture/s11-instagram-business.md`
and `s22-public-notices.patch` are preserved and excluded. Temporary reviewers,
dispatch helpers, downloaded manifests and Terraform binaries remain ignored.

**Exactly one next safe action:** approve the exact Stage A migrator-only saved
plan **38139812141**. Its release-tooling CI gate is verified PASS. This
approval does not authorize migration execution, application deployment or Send.
