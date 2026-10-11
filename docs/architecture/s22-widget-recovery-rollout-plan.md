# Website Chat recovery: migration-first rollout packet

Status: **MIGRATION AND APPLICATION DEPLOYMENT VERIFIED; CUSTOMER ACCEPTANCE PENDING**.
The owner approved **plan 38139812141 only** for the migrator job definition,
then separately approved one migration execution and read-only schema/security
validation. The owner subsequently approved application-plan preparation only.
After reviewing the saved application plan, the owner explicitly approved
**plan 38144565508 only**. That exact application deployment and its read-only
postflight are now verified below. Session replacement, customer messages,
provider calls and budget increases remain unapproved and unperformed by this
rollout. S22 as a whole remains unaccepted.

## Release and tooling provenance

Runtime source: `19e7f3c33d94b466e1129586b15796f35d5f938b`.
Its [full CI 38138247096](https://github.com/mufazzalshokh/lead-agent-platform/actions/runs/38138247096)
passed `pnpm ci:verify`, including the clean PostgreSQL gate and production builds.
The [recovery design](s22-widget-recovery.md) records ownership, expiry, replay,
privacy, booking and budget invariants. There are no further application changes
in this preparation; do not rebuild or substitute runtime source for a cosmetic change.

Original release-tooling source: `0949cfdc2a5e541b19366b01fd93bcdf782c808a`.
This descendant adds explicit approved migration-head selection (0031 or 0032),
strict provider-schema configuration comparison for the isolated migrator,
correct migration metadata/validator counts, and the later migration-first
three-workload action set. Existing 0031 defaults remain unchanged. Runtime
images retain their actual `19e7f3c` provenance, not the tooling commit.
Full release-tooling [CI 38139797313](https://github.com/mufazzalshokh/lead-agent-platform/actions/runs/38139797313)
**PASS** on exact `0949cfd`, including `pnpm ci:verify`, all PostgreSQL suites,
contracts, static/type checks and production builds. Local preparation checks
also passed. CI success is not a deployment or customer-journey result.

Application-plan preparation exposed a shallow-checkout provenance failure.
The narrowly scoped history correction is committed as
`bca146092ff3d12c5a4537f32440aef0de24b59b`: the main exact-commit checkout now
uses `fetch-depth: 0`, with one regression test preserving the exact HEAD and
both ancestry guards. The pinned
[checkout action](https://raw.githubusercontent.com/actions/checkout/3d3c42e5aac5ba805825da76410c181273ba90b1/action.yml)
defaults to depth one; zero fetches full history. This changes release tooling
only, not runtime source/images, Terraform configuration, workflow permissions,
WIF, approved phases or the owner-approval boundary.
[Correction CI 38143973430](https://github.com/mufazzalshokh/lead-agent-platform/actions/runs/38143973430)
**PASS** on exact `bca1460`, including the full `pnpm ci:verify` gate. The new
application saved plan and independent configuration review also pass below.
These are preparation results, not deployment or customer-journey acceptance.

Project/region: `lead-agent-stg-739284` / `me-central1`.
Canonical release metadata timestamp: **`2026-10-11T12:34:47Z`**.

## Immutable images: built once; migration-first deployment verified

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

### Stage A apply receipt

[Apply 38140600026](https://github.com/mufazzalshokh/lead-agent-platform/actions/runs/38140600026)
**PASS**. Dispatched once after the owner's exact-plan approval. A fresh
authenticated download reproduced the approved binary/checksum above; local
independent inspection again passed all 88 managed configurable comparisons.
The workflow checked out pinned tooling `0949cfd`, revalidated the exact saved
binary and approval boundary, and applied it without replacement or replanning:
**0 added / 1 changed / 0 destroyed**. The only change is the migrator job.
Dispatched branch head `6d0cbf2` contains only the later packet documentation;
the input checkout and runtime image provenance remain independently pinned.

Apply inputs are the exact preparation inputs above with `action=apply`,
`plan_run_id=38139812141`, `approved_plan_sha256` equal to the approved binary
SHA256, and the repository's explicit owner-approval marker. No other input,
image, journey mode/anchor or budget changed. Terraform accepted the saved plan
against its current state lineage/serial under the state lock.

Authenticated evidence artifact **11703500694**:
`s22-migrator-image-apply-evidence-38140600026`.
Downloaded plaintext SHA256:
`e3202cfb2234da8289c71c800f13ba93dc25547480547b901bbd7064eb7a2375`.
All **15 live assertions PASS**: exact image/source/time/packaged migration head,
service account, command/args, private VPC, five existing secret references,
89 Terraform state entries and whole-configuration convergence exit code **0**.
The strict pre-apply configuration comparison and convergence preserve numeric
zero retries, task/parallelism, resources, IAM, application images/provenance,
route/session binding, scaling and budgets. Packaged head `0032` on the job is
not evidence that `0032` has been applied to the database.

One-shot migration, database validation, bounded diagnostics, acceptance
inventory, booking evidence and Widget progress jobs were explicitly **skipped**.
No customer frame was opened or message/provider call sent by this apply.
Do not reapply this now-consumed saved plan.

## Stage B: migration, then application rollout

Stage A, migration/schema-security verification, application-plan preparation
and the separately approved application deployment/postflight are complete:

1. **Completed:** exact Stage A apply and live job/configuration convergence
   verification are recorded above. Application images remained unchanged at
   that milestone; their later approved update is recorded in step 5.
2. **Completed:** after explicit owner approval, one execution of the reviewed
   job applied `0032`, adding seven nullable recovery/access fields and bounded
   checks. The new SQL has no backfill, customer proof issuance, budget/booking
   change, historical migration edit or RLS/role/grant change. The ordinary
   migrator also synchronizes the four existing application-role passwords from
   their existing secret references; no new secret version or IAM change was
   made. Preserve the recorded execution IDs; do not rerun or reverse migrations.
3. **Completed:** the existing read-only validator passed all **23 assertions**,
   including packaged/applied head `0032`, **33 migrations**, seven nullable
   fields with expected types, four validated Widget constraints, unchanged
   52-table / 48 FORCE-RLS manifest and least-privilege role/connectivity/tenant-
   denial assertions. Result-log access was confirmed in the owner's established
   Cloud Shell before execution. GitHub's separate log-view permission denial
   remains unresolved; the owner collected the existing results without changing
   IAM, sharing credentials or launching another job. Evidence provenance and
   the workflow collection failure are recorded below.
4. **Completed, preparation only:** after migration verification, create the
   fresh full-runtime saved **plan 38144565508** from the updated state. Reuse
   all four immutable images, timestamp and runtime source `19e7f3c`, with pinned
   correction tooling `bca1460`. All three migration-head inputs are `0032`;
   journey mode/anchor and budgets are preserved. The saved binary and exact
   configuration review pass: three in-place API/Web/Worker updates, migrator
   no-op, zero creates/destroys/replacements. The first attempt failed before
   cloud authentication and produced no saved plan; its root cause and the
   deliberately corrected preparation are recorded below.
5. **Completed:** apply only saved plan **38144565508** after explicit owner
   approval. Verify exact deployed API/Web images, source/time/migration metadata,
   ready revisions, public health, Worker readiness and whole-runtime convergence.
   These results are deployment prerequisites, not customer recovery/booking E2E
   acceptance. No migration/validator or customer test was rerun.

### Migration and schema/security receipt — 11 October 2026

[Preflight 38141753783](https://github.com/mufazzalshokh/lead-agent-platform/actions/runs/38141753783)
**PASS**: exact reviewed job/image/source/head, 15 live configuration assertions
and convergence exit **0**. It created no database execution. The owner had
already confirmed authenticated log access with `LOG_ACCESS_EXIT=0`.

[Migration workflow 38141852052](https://github.com/mufazzalshokh/lead-agent-platform/actions/runs/38141852052)
used `action=apply`, `phase=migration-resume`, immutable release-tooling checkout
`0949cfd`, runtime image source `19e7f3c`, the reviewed migrator digest and timestamp
above, and packaged head `0032`. Dispatched branch head was
`93e19b06825bb87bdd63270c2ac007fb01e2b772`. Application inputs, stable journey
anchor and budgets were preserved. This phase skipped Terraform apply.

- Migration execution **`lead-agent-staging-migrator-6n5xg`** successfully
  completed; the one-shot migration workflow step is **SUCCESS**.
- Read-only validator **`lead-agent-staging-migrator-qv6bn`** was launched once
  by that workflow. The owner supplied its existing structured check results:
  **23 individual PASS assertions**, a **PASS summary / total 23 / failures 0**,
  and **`LOG_READ_EXIT=0`**. All check names match the pinned validator, including
  ingress direct-table denial, cross-tenant denial and FORCE RLS. This evidence
  is owner-supplied authenticated Cloud Shell output, not a GitHub log artifact
  independently downloaded by the agent.
- Immutable validator source SHA256:
  **`b99adf59aea13bd97f958a465a9b7c99f22c8f690f4b83715ab1afccce697d1c`**.
  It performs metadata/connectivity checks and a read-only tenant-denial
  transaction with rollback; no customer/provider action is invoked.
- Workflow conclusion remains **FAILURE** because GitHub's deployer received
  `PERMISSION_DENIED` while reading Cloud Logging. Its artifact **11702404852**,
  `s22-database-validator-evidence-38141852052`, contains the finite
  `S22V096_VALIDATOR_HARNESS` missing-evidence fallback, **not a failed database
  assertion**. The owner-supplied validator results close the schema/security
  evidence gap without changing that historical workflow conclusion.

The first owner result read timed out after 25 seconds. Its `--freshness` flag
does not bound ascending reads, as specified by the
[Google CLI reference](https://docs.cloud.google.com/sdk/gcloud/reference/logging/read).
The corrected read below explicitly bounded the existing execution's timestamps
and succeeded. No migration or validator was rerun:

```bash
timeout 55s gcloud logging read 'resource.type="cloud_run_job" AND resource.labels.job_name="lead-agent-staging-migrator" AND labels."run.googleapis.com/execution_name"="lead-agent-staging-migrator-qv6bn" AND timestamp>="2026-10-11T13:07:00Z" AND timestamp<="2026-10-11T13:15:00Z" AND jsonPayload.operation="staging_database_validation"' --project=lead-agent-stg-739284 --limit=100 --order=asc --format='table(jsonPayload.assertion:label=CHECK,jsonPayload.outcome:label=RESULT,jsonPayload.assertion_count:label=TOTAL,jsonPayload.failure_count:label=FAILURES)'
printf 'LOG_READ_EXIT=%s\n' "$?"
```

[Postflight 38142095801](https://github.com/mufazzalshokh/lead-agent-platform/actions/runs/38142095801)
**PASS**, using `action=plan`, `phase=migrator-image-verify` and the same pinned
inputs. Authenticated artifact **11703427190**:
`s22-migrator-image-live-evidence-38142095801`; downloaded plaintext SHA256:
**`e3202cfb2234da8289c71c800f13ba93dc25547480547b901bbd7064eb7a2375`**.
Its fresh **15/15 live assertions PASS**, state resource count is **89**, and
whole-configuration convergence exit is **0**. The receipt matches the earlier
Stage A configuration receipt byte-for-byte: migration changed the database,
not managed deployment configuration. This check created no database execution
and does not itself prove the SQL assertions.

Exactly **one migration and one validator** were launched. Diagnostics,
booking/Widget progress and acceptance executions were skipped; API/Web/Worker
images and configuration, IAM, private networking, numeric zero retries, secret
references, route/session binding and budgets are unchanged. No frame, message,
provider call, replacement binding or application deployment occurred. This
receipt completes only the migration/schema-security gate, not live recovery
or S22 acceptance.

### Application-plan preparation: preserved failure and tooling correction

The owner separately approved preparation only after the verified migration.
[Initial attempt 38143519097](https://github.com/mufazzalshokh/lead-agent-platform/actions/runs/38143519097)
failed at the Git ancestry check with
`fatal: Not a valid commit name 19e7f3c33d94b466e1129586b15796f35d5f938b`.
The runner's depth-one checkout of original tooling `0949cfd` could not see its
older runtime ancestor. Local `git merge-base` returns that exact runtime source;
this was unavailable history, not evidence of an unauthorized source commit.

Cloud authentication, Terraform setup/plan, apply, migration/validator,
diagnostic and acceptance steps were skipped. The attempted artifact upload
failed because no saved plan existed. Do not apply or rerun this failed attempt.
The new regression test fails against the old checkout and passes after the
single history-setting correction; the ancestry guards are retained unchanged.
After full correction CI passed, preparation used pinned tooling `bca1460`,
the same runtime source `19e7f3c`, four original immutable images and canonical
timestamp. The corrected runner's exact HEAD and both ancestry checks pass.
No rebuild, application change, IAM change or database execution was required.

### Application saved-plan receipt — 11 October 2026

[Plan 38144565508](https://github.com/mufazzalshokh/lead-agent-platform/actions/runs/38144565508)
**PASS**. This is the single valid saved application plan produced after the
preserved pre-authentication failure. It uses `action=plan`, `phase=full`, exact
tooling checkout `bca146092ff3d12c5a4537f32440aef0de24b59b`, and runtime provenance
`19e7f3c33d94b466e1129586b15796f35d5f938b`. Authenticated artifact **11704038565**:
`s22-terraform-plan-full-bca146092ff3d12c5a4537f32440aef0de24b59b`.
The artifact was verified unexpired; its retention ends **2026-10-18T13:47:51Z**.
Downloaded saved binary SHA256, independently recomputed against its checksum:
**`5e9e87a6cefec66d7618148cf509c04660d6f23633d49c9bd79b5c76e1caef84`**.

Installed Terraform **1.14.7** and locked Google provider **7.46.1** independently
inspected the binary and provider schema. All **88 managed configurable resource
comparisons PASS**, including every unchanged resource and nested configuration.
Workflow safety evidence matches the independent review exactly:

| Resource | Action | Permitted differences |
| --- | --- | --- |
| `google_cloud_run_v2_service.api[0]` | in-place update | Reviewed recovery image and matching source/time/migration provenance |
| `google_cloud_run_v2_service.web[0]` | in-place update | Reviewed recovery image and matching source/time/migration provenance |
| `google_cloud_run_v2_worker_pool.worker[0]` | in-place update | Reviewed recovery image and matching source/time/migration provenance |
| Migrator and all other managed resources | no-op | None |

**0 creates / 3 updates / 0 destroys / 0 replacements.** Before-state application
images/provenance match the verified wording release `68b3011`, canonical old
timestamp `2026-10-11T09:26:04Z`, head `0031` and authenticated manifest recorded
above. After-state images/source/time/head match the original recovery manifest.
Migrator image/provenance is already the reviewed recovery release and is no-op.

IAM, secret references, private networking, service accounts, commands, task
counts/parallelism, numeric zero retries, resources, scaling, staff access,
journey mode/anchor and budgets are unchanged. No configurable unknowns or
unreviewed changes are present. Refreshed drift is computed-only migrator
execution-count/latest-execution metadata from the previously preserved jobs;
it is not a new execution or permission to change configuration.

Authenticated workflow metadata confirms all 15 non-skipped steps succeeded;
every other step was skipped, including apply, migration, database validator,
diagnostics, bootstrap/IAM changes and deployment-provenance recording. All
three separate acceptance/Widget/booking evidence jobs were skipped. No cloud
deployment, frame, message, provider call or budget increase occurred.

Exact preparation inputs, excluding any apply token:

```json
{
  "action": "plan",
  "phase": "full",
  "commit_sha": "bca146092ff3d12c5a4537f32440aef0de24b59b",
  "runtime_git_commit_sha": "19e7f3c33d94b466e1129586b15796f35d5f938b",
  "deployment_timestamp": "2026-10-11T12:34:47Z",
  "migration_head": "0032_s22_widget_recovery",
  "runtime_migration_head": "0032_s22_widget_recovery",
  "api_migration_head": "0032_s22_widget_recovery",
  "api_image": "me-central1-docker.pkg.dev/lead-agent-stg-739284/lead-agent/api@sha256:7174fb8ce3a5599da76d5e2a77aab68a8bbcecc473e9ff4eebc0b814ddc119b4",
  "web_image": "me-central1-docker.pkg.dev/lead-agent-stg-739284/lead-agent/web@sha256:cc7dc7f7f819054b3c0ba1fd5796a1dea53f8ae45a402eadaadfc62513b95800",
  "worker_image": "me-central1-docker.pkg.dev/lead-agent-stg-739284/lead-agent/worker@sha256:90b4dcebfdd9bc59fee6b5f270c81469df8cb23da36caf0afbbcfebebc8dd6b6",
  "migrator_image": "me-central1-docker.pkg.dev/lead-agent-stg-739284/lead-agent/migrator@sha256:cb3c6fc6c6f943b9d9457179e70627a1fe7dc2a59f3de91989bc7d5be7ac2919",
  "ai_journey_mode": "preserve",
  "ai_journey_widget_session_id": "01a11c48-dbc2-76de-a873-f41664da5ccb"
}
```

Applying requires explicit approval of **plan 38144565508 only**, a fresh
authenticated download reproducing the exact binary/checksum above, and current
state lineage/serial compatibility under the existing state lock. Revalidate
the exact saved plan and owner-approval boundary using pinned tooling `bca1460`.
Do not replan, substitute an expired/stale artifact, execute migration/validation
again or transfer old plan/customer-test approval to this plan. If the state or
artifact is stale, stop and obtain approval for a separately reviewed plan.

No Stage B saved binary was prepared against the pre-migration state: Stage A
changes its serial and would make such a plan stale. No new application queries
may be deployed before successful migration verification. If migration or
verification fails, keep the old application running and investigate the exact
preserved failure. Compatible application rollback uses previously recorded
digests under a new reviewed plan, not SQL downgrade or blind replay.

### Application apply and live-verification receipt — 11 October 2026

[Apply 38150555305](https://github.com/mufazzalshokh/lead-agent-platform/actions/runs/38150555305)
**PASS**. It was dispatched once after the owner's **“apply plan 38144565508
only”** approval. A fresh authenticated artifact download reproduced the exact
approved SHA256 `5e9e87a6cefec66d7618148cf509c04660d6f23633d49c9bd79b5c76e1caef84`.
Independent pre-apply inspection again passed **88/88** configuration comparisons
and the exact three-update action set. The runner checked out pinned tooling
`bca1460`, verified the downloaded checksum and exact full-runtime approval
boundary, and applied the saved binary without generating a replacement plan.

Authenticated job metadata and allowlisted log inspection confirm:
**0 added / 3 changed / 0 destroyed**. The completed updates are only API, Web and
Worker; migrator is no-op. Terraform accepted the approved saved binary against
the current state lineage/serial under its state lock. No plan substitution,
IAM change or separately authorized application-source change occurred.
Dispatched branch head was `53e751e2591acff4c9571d035a234f231e723966`, which differs
from pinned tooling only by the verified plan receipt document. Runtime image
provenance remains `19e7f3c`, not the later tooling/documentation source.

Apply inputs are the application preparation inputs above with `action=apply`,
`plan_run_id=38144565508`, `approved_plan_sha256` equal to the approved binary
SHA256, and the existing explicit owner-approval marker. All images, migration
heads, canonical timestamp, journey mode/anchor and budgets are unchanged.
All **17** non-skipped workflow steps succeeded. Replanning, migration, database
validator, Cloud Run diagnostic executions, bootstrap/IAM changes and the three
customer/booking evidence jobs were skipped. The existing migration and validator
executions were preserved; neither was rerun.

[Read-only API/Web postflight 38150839125](https://github.com/mufazzalshokh/lead-agent-platform/actions/runs/38150839125)
**PASS**, using the same pinned tooling/images/source/time/head/binding with
`action=plan`, `phase=api-image-verify`. The phase-specific API/Migrator/runtime
provenance inputs all resolve to the reviewed recovery release; it does not
create or apply a saved plan or execute a database job. Authenticated artifact
**11705553850**: `s22-api-image-live-evidence-38150839125`.
Downloaded plaintext SHA256:
**`b9687846364dc5d133892f91632f287b03f493ef764c84205a67cf37d69c278a`**.

Independent receipt inspection passes all **16/16** live assertions: exact
API/Web images, API source/time/image-digest/migration provenance, existing API
service account, private VPC/egress, 15 secret references and ready revisions.
Ready API revision is **`lead-agent-staging-api-00033-ldh`**; ready Web revision is
**`lead-agent-staging-web-00029-jtg`**. Whole-runtime Terraform convergence exit
code is **0**, covering the unchanged configuration and declared recovery
images/provenance for API, Web, Worker and Migrator. Apply, migration, database
validator, diagnostics and customer/booking evidence jobs were skipped.

[Read-only readiness inventory 38150872765](https://github.com/mufazzalshokh/lead-agent-platform/actions/runs/38150872765)
**PASS**. This existing workflow reads Cloud Run/SQL/backup/alert metadata and
public HTTP status only; it does not connect to the database, launch a Cloud Run job,
access secret payloads or run Terraform. Its tooling source is `bca1460` and
dispatched head is the same `53e751e`; `evidence_commit` identifies evidence
tooling, not image source. Authenticated artifact **11706234595**:
`s22-acceptance-inventory-38150872765`. Downloaded plaintext SHA256:
**`59dee9209bac2c648cbfa1103c8de35e1c6ff39b59ffdd566c30d3718b5ba366`**.

All **12/12** allowlisted prerequisite assertions pass, including explicit
**Worker readiness**, API health HTTP **200**, Web staff HTTP **200**, private
shared-core PostgreSQL, enabled backup/PITR metadata, one successful backup and
existing enabled alert policies with notification channels. These are metadata
prerequisites: `restore_proven=false` and `capacity_proven=false` remain explicit.
The workflow's Terraform and customer/booking evidence jobs were skipped.

Independent public GETs also pass: API `/health` returns HTTP **200** with its
finite expected service/status contract; Web `/` returns the implemented **307
redirect to `/staff`**, and `/staff` returns HTTP **200**. The first supplemental
probe incorrectly required the root to return 200 without redirect; inspecting
the existing `page.tsx` established the intentional redirect, and the corrected
bounded probe verifies it without changing application code. No cookie,
credential or widget frame is used by these checks.

No chat/session selection, customer message, provider request, booking mutation,
budget increase, migration or validator was initiated by this deployment or
postflight. Worker readiness and HTTP/convergence results are not provider-work
or customer E2E proof. Do not reapply this now-consumed saved plan or transfer
historical paid-test approval to a replacement session. Live customer-owned
recovery and completion of the booking journey remain separate acceptance work.

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
revalidate the selected migration head. At preparation time the 0032 database
observations were prepared validators, not live executed assertions; the later
verified execution and owner-supplied results are recorded separately above.

Independent saved-plan inspection requires local provider-plugin execution
permissions; the restricted attempt returned a finite denial and the authorized
inspection passed. Raw plan/state/provider JSON stay in memory or ignored local
artifacts, not chat, Git or public documentation. Build/plan receipts and
head SHA verification are authenticated GitHub reads.

Exact-apply verification additionally passed:

```text
gh run download 38139812141 --repo mufazzalshokh/lead-agent-platform --name s22-terraform-plan-migrator-image-update-0949cfdc2a5e541b19366b01fd93bcdf782c808a --dir .cache/s22-recovery-rollout/pre-apply-38139812141
node .cache/s22-recovery-rollout/review.mjs .cache/s22-recovery-rollout/pre-apply-38139812141/s22.tfplan
node --test .github/scripts/s22-full-runtime-config-check.test.mjs .github/scripts/s22-recovery-rollout.test.mjs
node .cache/s22-recovery-rollout/apply.mjs --dispatch
gh run download 38140600026 --repo mufazzalshokh/lead-agent-platform --name s22-migrator-image-apply-evidence-38140600026 --dir .cache/s22-recovery-rollout/applied-38140600026
node .cache/s22-recovery-rollout/verify-apply.mjs
```

Result: approved checksum and exact configuration PASS; 15/15 native rollout
guard tests PASS; one successful apply; authenticated receipt digest, 15/15 live
assertions, convergence and skipped-execution boundaries PASS. No new application
code/tests or SQL changes were needed for this apply. Only this rollout receipt
document is changed in the apply milestone; temporary helpers remain ignored.

Migration-receipt verification additionally passed:

```text
gh run view 38142095801 --repo mufazzalshokh/lead-agent-platform --json status,conclusion,headSha,jobs
gh api repos/mufazzalshokh/lead-agent-platform/actions/runs/38142095801/artifacts
gh run download 38142095801 --repo mufazzalshokh/lead-agent-platform --name s22-migrator-image-live-evidence-38142095801 --dir .cache/s22-recovery-rollout/postflight-38142095801
node .cache/s22-recovery-rollout/verify-migration-receipt.mjs
node --test .github/scripts/s22-full-runtime-config-check.test.mjs .github/scripts/s22-recovery-rollout.test.mjs
node node_modules/vitest/vitest.mjs run tests/workspace/staging-infrastructure.test.ts tests/workspace/staging-journey-mode.test.ts --maxWorkers=1 --testTimeout=30000
git diff --check -- docs/architecture/s22-widget-recovery-rollout-plan.md
```

Result: owner-supplied **23/23** database assertions and zero-failure summary
match the immutable validator; authenticated workflow/execution provenance,
postflight receipt SHA256, **15/15** live configuration assertions and convergence
**0** pass. Native rollout guards pass **15/15**, and workspace checks pass
**28/28** (their wrapper also reruns native guards, so counts are not disjoint).
No new application/SQL changes or tests were required. Only this receipt document
is changed; ignored owner-output copies and temporary verification helpers are
not committed. The three unrelated owner files remain byte-for-byte unchanged.

Application-plan preparation verification additionally passed:

```text
node --test .github/scripts/s22-full-runtime-config-check.test.mjs .github/scripts/s22-recovery-rollout.test.mjs
node node_modules/vitest/vitest.mjs run tests/workspace/staging-infrastructure.test.ts tests/workspace/staging-journey-mode.test.ts --maxWorkers=1 --testTimeout=30000
node node_modules/eslint/bin/eslint.js .github/scripts/s22-recovery-rollout.test.mjs --max-warnings=0
node node_modules/prettier/bin/prettier.cjs --check .github/workflows/staging-terraform.yml .github/scripts/s22-recovery-rollout.test.mjs
gh run view 38143973430 --repo mufazzalshokh/lead-agent-platform --json status,conclusion,headSha,jobs
node .cache/s22-recovery-rollout/prepare-runtime-plan.mjs --dispatch
gh run download 38144565508 --repo mufazzalshokh/lead-agent-platform --name s22-terraform-plan-full-bca146092ff3d12c5a4537f32440aef0de24b59b --dir .cache/s22-recovery-rollout/full-plan-38144565508
node .cache/s22-recovery-rollout/review-runtime-plan.mjs 38144565508
node .cache/s22-recovery-rollout/verify-plan-workflow.mjs
git diff --check -- docs/architecture/s22-widget-recovery-rollout-plan.md
```

Results: **16/16** native guards, **28/28** Vitest workspace cases (including a
native-wrapper rerun), lint, workflow/test formatting and full correction CI
**PASS**. The new history regression was verified red against the previous
checkout and green against `fetch-depth: 0`; exact HEAD and both ancestry guards
remain required. Independent binary/checksum, **88/88** configuration comparisons,
exact three-update action set, manifest/source/time/head/binding checks and
authenticated artifact/workflow skipped-execution boundaries **PASS**.

This milestone changes only `.github/workflows/staging-terraform.yml`,
`.github/scripts/s22-recovery-rollout.test.mjs` and this packet. The two-file
correction is committed and pushed as `bca146092ff3d12c5a4537f32440aef0de24b59b`.
No application source or SQL changed; no migration, validator or paid test was
rerun. Temporary helpers, owner-output copies and saved plan stay ignored.

Application exact-apply verification additionally passed. Dispatch commands
below are historical receipts, not instructions to rerun the consumed apply:

```text
node .cache/s22-recovery-rollout/verify-plan-workflow.mjs
gh run download 38144565508 --repo mufazzalshokh/lead-agent-platform --name s22-terraform-plan-full-bca146092ff3d12c5a4537f32440aef0de24b59b --dir .cache/s22-recovery-rollout/pre-apply-38144565508
node .cache/s22-recovery-rollout/review-runtime-plan.mjs 38144565508 --pre-apply
node --test .github/scripts/s22-full-runtime-config-check.test.mjs .github/scripts/s22-recovery-rollout.test.mjs
node .cache/s22-recovery-rollout/apply-runtime.mjs --inspect
node .cache/s22-recovery-rollout/apply-runtime.mjs --dispatch
node .cache/s22-recovery-rollout/verify-application-apply.mjs
node .cache/s22-recovery-rollout/postflight-api.mjs --dispatch
gh workflow run staging-terraform.yml --repo mufazzalshokh/lead-agent-platform --ref verify/s22-staging-recovery-capacity --field action=plan --field phase=acceptance-inventory --field commit_sha=bca146092ff3d12c5a4537f32440aef0de24b59b
gh run download 38150839125 --repo mufazzalshokh/lead-agent-platform --name s22-api-image-live-evidence-38150839125 --dir .cache/s22-recovery-rollout/postflight-api-38150839125
gh run download 38150872765 --repo mufazzalshokh/lead-agent-platform --name s22-acceptance-inventory-38150872765 --dir .cache/s22-recovery-rollout/postflight-inventory-38150872765
node .cache/s22-recovery-rollout/check-public-health.mjs
node .cache/s22-recovery-rollout/verify-application-postflight.mjs
git diff --check -- docs/architecture/s22-widget-recovery-rollout-plan.md docs/architecture/s22-widget-recovery.md
```

Results: authenticated approved artifact/source/expiry/checksum **PASS**;
fresh saved-binary configuration review **88/88 PASS**; existing native guards
**16/16 PASS**; exact apply **0 added / 3 changed / 0 destroyed PASS**, with no
replan or database execution. Independent postflight checks validate authenticated
receipt provenance/digests, **16/16** API/Web assertions, **12/12** inventory
assertions including Worker readiness, convergence **0**, and public HTTP
contracts **PASS**. No new tests, application code or SQL edits were required.
Only this receipt and the recovery design's current-status text change in this
apply milestone. Temporary dispatch/review/probe helpers and downloaded artifacts
remain ignored, and the three unrelated owner files remain unchanged.

Historical in-scope release-tooling files (no application or SQL edits):

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

**Exactly one next safe action:** prepare one controlled customer-owned
recovery/booking verification plan against this verified deployment. Preserve
the existing budgets and consumed counts; identify required session/binding
and paid-test authority explicitly. Preparation alone must not open/select a new
chat, send messages, invoke a provider or increase a budget. Do not reapply the
consumed application plan or repeat migration/validation.
