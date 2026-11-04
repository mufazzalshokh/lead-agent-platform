# S22 owner-selected Website Chat binding: reviewed rollout plan

Prepared 2026-10-09; approved, applied and runtime-verified 2026-10-09.
**APPLIED; LIVE CUSTOMER JOURNEY STILL PENDING.** This packet replaces the
pre-deployment fresh-session binding sequence, not the existing budget controls.
It authorizes neither a customer message nor a model call. S22 remains unaccepted.

## Approved apply and deployed-runtime checkpoint

The owner approved **"Apply plan 37935626931 only."** One apply was dispatched
with the exact preserved inputs below and the repository-required approval
acknowledgement. No images were rebuilt, replacement plan generated or tests rerun.

- [Apply 37938812591: PASS](https://github.com/mufazzalshokh/lead-agent-platform/actions/runs/37938812591),
  completed `2026-10-09T13:44:07Z`. Actual Terraform result:
  **0 added / 4 changed / 0 destroyed**. All four reviewed workloads report
  in-place modifications complete; the reviewed guard reports **0 replacements**.
- Saved-plan integrity and exact full-runtime approval boundary **PASS**:
  the checksum below is unchanged, all **88 managed resources** checked,
  no unreviewed/configurably unknown values or unexpected actions.
  `Create reviewed plan` and `Execute one-shot migrator` were **SKIPPED**.
- [Read-only verification 37939258506: PASS](https://github.com/mufazzalshokh/lead-agent-platform/actions/runs/37939258506),
  completed `2026-10-09T13:47:28Z`. Downloaded sanitized artifact
  `s22-api-image-live-evidence-37939258506` contains **16/16 checks PASS**:
  exact API source/image/timestamp/migration provenance, API/Web ready images,
  runtime identity, private VPC/subnet/egress, secret-reference count and
  whole-runtime Terraform convergence **exit 0**. The Worker/Migrator bindings
  are covered by whole-runtime convergence, not a separate direct metadata report.
- Ready API revision `lead-agent-staging-api-00028-ghh`; ready Web revision
  `lead-agent-staging-web-00024-pmb`. Live source, timestamp and migration head
  match this packet. Preserved gate mode/anchor resolved successfully.
- Independent public HTTP checks at `2026-10-09T13:47:23.872Z`:
  API `/health` **200**, response service `api` / status `ok`; organization-bound
  Web staff entry **200 HTML**. These were unauthenticated reachability checks,
  not proof of the owner's authenticated UI or a customer booking.

The verification phase is the existing `api-image-verify` read-only profile.
Its unsaved Terraform convergence read is not a new rollout plan. Apply, saved-plan
creation and migration execution are **SKIPPED** in that verification run.
No diagnostic execution, session creation/selection/renewal, customer message,
paid call, budget increase, IAM or SQL configuration change was performed here.
Historical NULL costs remain unknown; no new ledger reconciliation/read is claimed.
The authenticated selection/status UI and real Website Chat journey remain pending.

## Purpose and authority

The owner requested rollout preparation for the verified
[owner-selected binding correction](s22-widget-cohort-binding.md). The old process
started the anonymous session's 30-minute idle clock before build, plan, approval,
apply and readiness; completed readiness snapshots could already be obsolete.
This correction deploys the stable envelope first, then lets the authenticated
owner explicitly select one corroborated fresh empty frame in the staff workspace.
It does not renew expired sessions or automatically select the newest session.

The new API and staff UI use existing tenant authorization and append-only audits.
Selection and paid dispatch share the original cohort's transaction mutex.
Compare-and-set/idempotency prevent conflicting selection; an already bound,
consumed or accounting-incomplete lane cannot transfer its allowance to a new SID.
Every physical dispatch still checks the selected session and the monetary guards.
Unknown social-thread eligibility and all Instagram privacy boundaries are unchanged.

**Original preparation authority: preparation only.** One all-runtime image build
and one `full` reconciliation plan were dispatched. No apply, diagnostic execution,
session selection, Send, model call, migration, IAM change or job-command override
was performed. Updating the migrator image is not executing the migrator.

## Exact provenance

| Field                                | Reviewed value                                                                                     |
| ------------------------------------ | -------------------------------------------------------------------------------------------------- |
| Branch                               | `verify/s22-staging-recovery-capacity`                                                             |
| Runtime/build/plan source            | `32e056ab0b33d407df58dc709beef711badcde25`                                                         |
| Dispatch branch HEAD                 | `3f9633b6d4aa4d12fffa6aa52c30ea2999ef9823`                                                         |
| Image build                          | [37934925171: PASS](https://github.com/mufazzalshokh/lead-agent-platform/actions/runs/37934925171) |
| Saved plan                           | [37935626931: PASS](https://github.com/mufazzalshokh/lead-agent-platform/actions/runs/37935626931) |
| Project / region                     | `lead-agent-stg-739284` / `me-central1`                                                            |
| Deployment timestamp                 | `2026-10-09T13:15:13Z` (18:15:13 Asia/Tashkent)                                                    |
| Migration head, all workloads        | `0031_s22_widget_inbound_route_management`                                                         |
| Saved-plan SHA256                    | `1758f17366992068803131415284241f6e288ab1979f3a14c04f2c1922177176`                                 |
| Image-manifest file SHA256           | `859f996a114d536d1746eaee4c206747dcfcd11780ca2cc79687d5284340a685`                                 |
| Plan-captured state lineage / serial | `ad1c3000-d52f-06eb-de1b-53ae4d67f63e` / `66`                                                      |

Both workflows checked out the exact runtime source above, not their dispatch HEAD.
The difference between that source and dispatch HEAD contains only evidence/binding
documentation. Subsequent documentation-only commits do not require rebuilding
these unchanged runtime images. Build scope was `all`; each digest was verified
as `linux/amd64`, with repository SBOM/provenance steps successful.

Authenticated artifacts downloaded and inspected:

- Build artifact ID `11617662702`,
  `s22-image-manifest-32e056ab0b33d407df58dc709beef711badcde25-37934925171`.
- Plan artifact ID `11618760472`,
  `s22-terraform-plan-full-32e056ab0b33d407df58dc709beef711badcde25`.
  It contains `s22.tfplan`, `s22.tfplan.sha256` and
  `s22-full-runtime-plan-evidence.txt`; none is committed to the repository.
- Independent `Get-FileHash -Algorithm SHA256` of the downloaded binary plan
  matches its checksum file and the exact hash in this packet. Saved Terraform
  JSON/state and credentials were not printed or included in documentation.

## Fresh immutable image references

```text
API=me-central1-docker.pkg.dev/lead-agent-stg-739284/lead-agent/api@sha256:db1d121708395d7d44a02a51378c2b2e4f79ff61683740802c8c14d020ebca01
Web=me-central1-docker.pkg.dev/lead-agent-stg-739284/lead-agent/web@sha256:22d0d963aba47d472d3404c8f920b0c2454d397d2cec8706513e3af10c9cc970
Worker=me-central1-docker.pkg.dev/lead-agent-stg-739284/lead-agent/worker@sha256:5f71cc3fe3ce4e4bfdcd75edd0a7774f13e8025e4317aee99562c3d8396cc940
Migrator=me-central1-docker.pkg.dev/lead-agent-stg-739284/lead-agent/migrator@sha256:542f3a040ac15c1331421a79c5d5d1e9f41d6ce141b1d86a5189ebaed5173d4d
```

## Exact planned actions and safeguards

**0 creates / 4 in-place updates / 0 destroys / 0 replacements.**

| Managed resource                            | Action   | Allowed change                                                 |
| ------------------------------------------- | -------- | -------------------------------------------------------------- |
| `google_cloud_run_v2_service.api[0]`        | `update` | Fresh image, source and deployment timestamp                   |
| `google_cloud_run_v2_service.web[0]`        | `update` | Fresh image, source and deployment timestamp                   |
| `google_cloud_run_v2_worker_pool.worker[0]` | `update` | Fresh image, source and deployment timestamp                   |
| `google_cloud_run_v2_job.migrator[0]`       | `update` | Fresh image, source and deployment timestamp; **no execution** |

Workflow `s22-full-runtime-plan-check.sh` **PASS** and independent saved-plan review
**PASS**, using Terraform `1.14.7`, the existing locked Google provider `7.46.1`
and `verifyFullRuntimeConfiguration` from `s22-full-runtime-config-check.mjs`:

- All **88 managed resources** checked against the actual provider schema;
  no unreviewed configurable changes or configurable unknown values.
- Exact source, four images, timestamp, project/region and all migration bindings
  match the reviewed build and inputs. No unexpected actions or data-source reads.
- No SQL, IAM, network, runtime identity, secret-reference, command, scaling,
  CPU/memory or retry configuration changes. Private VPC/egress and explicit
  migrator zero retries remain enforced. No create, destroy or replacement.
- The existing `widget_booking` mode and envelope anchor
  `01a11c48-dbc2-76de-a873-f41664da5ccb` are identical before/after the plan.
  The anchor is not a fresh browser session or Send authority.
- The four before-bindings report source
  `1ecd729d856fdeff22a55cc54e1259c7adcf6472` and timestamp
  `2026-10-08T15:08:01Z`; the after-bindings report the fresh source/timestamp
  in this packet. Migration provenance is unchanged.
- Workflow apply and one-shot migrator steps are **SKIPPED**; booking-evidence
  and inventory jobs are **SKIPPED**. `prepare_migration=true` retains the existing
  job resource; the `full` phase does not execute it.

Terraform refresh reported three metadata-only differences. They were inspected,
not ignored: every changed attribute is provider-computed, not configurable.

| Refreshed resource           | Computed-only metadata                                           | Planned action                |
| ---------------------------- | ---------------------------------------------------------------- | ----------------------------- |
| Artifact Registry repository | `update_time`                                                    | `no-op`                       |
| Existing migrator job        | `execution_count`, latest execution name/create/completion times | Reviewed workload update only |
| Cloud SQL instance           | `settings[0].version`                                            | `no-op`                       |

The SQL setting-version observation is not a SQL configuration change. There are
no extra resource actions to reconcile and no reason to dispatch another plan.

The independent review used an ignored, isolated local Terraform directory with
`init -backend=false -input=false -lockfile=readonly` and the already installed
provider, without connecting the laptop to the staging backend or downloading
new providers. Saved-plan JSON and provider schema were consumed in memory.

### Freshness boundary

At the 2026-10-09 review, authenticated all-branch staging workflow history lists
this completed plan as the newest run and contains no active or intervening
staging workflow. The last apply/verification remain `37809243773` /
`37809490156`. State serial `66` and lineage above were extracted from the saved
plan itself, **not** from a later direct read of current backend state.

Local `gcloud` is unavailable; repository WIF-authenticated build/plan access
succeeded. No direct out-of-band state comparison is claimed. A later apply must
download this exact artifact, independently verify its approved SHA256 and full
configuration boundary, and retain Terraform's state-lock/lineage/serial stale-plan
checks. If rejected as stale or by any safeguard, **stop**: approval cannot extend
to a replacement plan. This packet does not guarantee indefinite plan validity.

## Validation reused; no repeated CI

[CI 37910733207: PASS](https://github.com/mufazzalshokh/lead-agent-platform/actions/runs/37910733207)
checked exact runtime source `32e056ab0b33d407df58dc709beef711badcde25`, completed
`2026-10-09T09:26:57Z`. Its clean-checkout `pnpm ci:verify` passed formatting/lint,
architecture boundaries, **378 contracts**, TypeScript, all ordinary/database
tests and production builds: **3,529 ordinary tests passed, 7 opt-in skipped;
517 PostgreSQL tests passed**. S4a's 461 cases include all five new selection,
locking, RLS, idempotency and unknown-reserve cases. Existing focused local proof
is **188/188 deterministic regressions PASS** plus the production Web build.

Those are local/CI/database proofs, not real Widget-provider booking proof.
The fresh image build and plan passed; no redundant test workflow was dispatched.
This packet and evidence/journey updates are documentation only.

Documentation checks: a local Node subprocess compared the prepared JSON inputs
with the actual workflow input names, downloaded image manifest and saved plan:
source, four image references, timestamp, migration head, stable binding, action
set and both file hashes **PASS**; no approval token is present. The installed
Prettier CLI checked only this new packet **PASS**, and scoped `git diff --check`
passed. A PowerShell launcher/pnpm wrapper could not run that formatter; calling
the already installed formatter directly resolved the local tooling issue without
installing dependencies or changing policy. No runtime tests were added or rerun
for these documentation-only changes.

## Unchanged envelope and accounting

Organization `01a0ee39-91a9-7293-82c0-5b7046c10115`, original cohort conversation
`01a1067f-d7d8-7e7e-9fb0-39bfe2f7cdc7`, Widget channel
`01a11771-2c02-7240-86f7-19f95690d22e` and allowed-origin record
`01a11771-2c02-7765-b999-7dc9895ee49d` remain fixed. There is no fresh SID in
Terraform: the reviewed anchor is preserved while runtime reads the audited
post-deployment owner selection. No owner selection means no paid dispatch.

- Widget allowance: two total customer inbound messages, including confirmation;
  at most four physical calls and two attempts per message.
- Existing per-call reservation: **USD0.801432**; Widget allowance **USD3.205728**;
  maximum combined planning exposure **USD4.247838**.
- Budget-only historical reservation **USD1.033396**; USD5 target and USD10 hard
  ceiling unchanged. Original historical NULL costs remain NULL and unknown.
- Last owner-supplied accounting snapshot: known USD0.008714, combined reserved
  exposure USD1.042110, pending USD0. No new accounting read was run here.
- Timeout, unknown costs, pending reserve, exhaustion and guard failures retain
  their existing stop behavior. Applying this plan does not authorize Send.

## Exact approved apply inputs — preserved from the reviewed packet

Workflow `staging-terraform.yml`, ref `verify/s22-staging-recovery-capacity`.
The inputs below were submitted unchanged in apply `37938812591`; the owner-approved
acknowledgement was supplied using the actual `owner_approval_token` field and is
not persisted in this input block. This is a historical record, **not an instruction
to dispatch apply again**. Do not rebuild, regenerate the plan or replace the anchor.

```json
{
  "action": "apply",
  "phase": "full",
  "commit_sha": "32e056ab0b33d407df58dc709beef711badcde25",
  "deployment_timestamp": "2026-10-09T13:15:13Z",
  "api_image": "me-central1-docker.pkg.dev/lead-agent-stg-739284/lead-agent/api@sha256:db1d121708395d7d44a02a51378c2b2e4f79ff61683740802c8c14d020ebca01",
  "web_image": "me-central1-docker.pkg.dev/lead-agent-stg-739284/lead-agent/web@sha256:22d0d963aba47d472d3404c8f920b0c2454d397d2cec8706513e3af10c9cc970",
  "worker_image": "me-central1-docker.pkg.dev/lead-agent-stg-739284/lead-agent/worker@sha256:5f71cc3fe3ce4e4bfdcd75edd0a7774f13e8025e4317aee99562c3d8396cc940",
  "migrator_image": "me-central1-docker.pkg.dev/lead-agent-stg-739284/lead-agent/migrator@sha256:542f3a040ac15c1331421a79c5d5d1e9f41d6ce141b1d86a5189ebaed5173d4d",
  "api_migration_head": "0031_s22_widget_inbound_route_management",
  "runtime_migration_head": "0031_s22_widget_inbound_route_management",
  "ai_journey_mode": "preserve",
  "ai_journey_widget_session_id": "01a11c48-dbc2-76de-a873-f41664da5ccb",
  "plan_run_id": "37935626931",
  "approved_plan_sha256": "1758f17366992068803131415284241f6e288ab1979f3a14c04f2c1922177176"
}
```

## Exactly one next action

Refresh the authenticated staff workspace and open **Integrations** to check that
**"S22 synthetic Website Chat test"** is visible. Do not create/select a fresh
frame or Send yet. This supplies the missing owner-session/UI evidence without
starting another expiry clock. Subsequent separately approved fresh-frame
selection uses this UI, not another Terraform binding plan or temporary upload.
Live selection, dispatch and complete Website Chat customer-to-confirmed-booking
proof remain pending. The saved plan above has already been applied; do not repeat it.
