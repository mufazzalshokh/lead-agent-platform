# S22 Website Chat selection UI rollout approval

Prepared 2026-10-09; applied and verified 2026-10-10 (Asia/Tashkent).
**EXACT APPROVED PLAN APPLIED; RUNTIME VERIFICATION PASS.**
Apply is not permission to Send, renew a chat or run a model call.
Historical NULL costs remain unknown; S22 remains unaccepted.

## Applied result

The owner approved **"Apply plan 37954005150 only."** One
[apply 37987684500](https://github.com/mufazzalshokh/lead-agent-platform/actions/runs/37987684500)
passed, completed `2026-10-09T20:33:46Z` (01:33:46 on 2026-10-10 Asia/Tashkent).
It used the exact source, timestamp, four images and saved-plan hash below.
Dispatch HEAD `79f26579c60c5559f7ed407a77920f3cbed57514` differs from runtime
source only by the already-reviewed evidence documents.

Actual Terraform result: **0 creates / 4 in-place workload updates / 0 destroys**.
All four reviewed workloads completed their modifications. The full approval
guard passed for 88 managed configurations, zero configurable unknowns,
**0 replacements**, no IAM or unexpected actions. Integrity and approval checks
passed; plan creation, one-shot migrator, inventory and booking evidence were
skipped. No image rebuild, replacement plan, migration or paid call was initiated.

One existing read-only
[verification 37987879930](https://github.com/mufazzalshokh/lead-agent-platform/actions/runs/37987879930)
passed, completed `2026-10-09T20:35:17Z`. Authenticated artifact
`11644046849`, `s22-api-image-live-evidence-37987879930`, records **16/16 checks
PASS**: API image/source/timestamp/migration provenance, API/Web ready images and
revisions, API runtime identity/private VPC/subnet/egress, 15 secret references,
and whole-runtime convergence **exit 0**. Ready revisions are
`lead-agent-staging-api-00029-pwp` and `lead-agent-staging-web-00025-jxr`.
Worker/Migrator bindings are covered by refreshed whole-runtime convergence,
not separate direct descriptor assertions. Preserved `widget_booking` mode and
stable anchor were also corroborated from sanitized verification log fields.
Verification created no saved deployment plan and skipped apply/migration.

Bounded public HTTP reads at `2026-10-09T20:34:48.517Z` returned API `/health`
**200**, service `api`, status `ok`, and organization-bound Web staff entry
**200 HTML**. These are runtime/readiness/reachability proofs, not an authenticated
browser observation of the corrected UI, persisted owner-selection audit, fresh
session readiness, current ledger read or customer booking proof.

The deployment preserves the existing monetary controls, mode and envelope;
it does not renew the owner's old browser selection or change historical costs.
No new chat, diagnostic execution, customer/provider call, ledger reset, budget
increase or IAM change ran. The source CI and focused checks below were reused,
not repeated. **Live corrected UI and Website Chat booking proof remain pending.**

## Change and scope

The owner's screenshot showed successful selection; the remaining confusion was
presentation. An unchosen radio disabled the confirmation checkbox, and a saved
selection deliberately disabled the same action without changing its label.
The unstyled fieldset and prominent UUID made that expected state look broken.

Source `c687dcfb82da64a26d981d793d1611d44c49c593` numbers the two steps, uses
styled accessible cards/larger controls, explains disabled states, displays the
selection deadline separately from session lifetime, labels an already-selected
chat, and labels retained failed-refresh budget data as stale.
Runtime changes are confined to Web presentation. Node test configuration enables
actual React component rendering without changing Next configuration/dependencies.
The controller, commands, API/application/Worker behavior and all safeguards are
unchanged. The source/evidence commit and unrelated local edits are not conflated.

The existing full-runtime workflow packages a coherent four-image provenance
bundle, so this plan updates all four workload image/source/timestamp bindings.
It does not change the budget, stable envelope anchor, persisted owner selection,
session lifetime, runtime permissions, migration head or architecture.

## Exact provenance

| Field                                       | Reviewed value                                                                                     |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Branch                                      | `verify/s22-staging-recovery-capacity`                                                             |
| Runtime/build/plan source and dispatch HEAD | `c687dcfb82da64a26d981d793d1611d44c49c593`                                                         |
| Completed source CI                         | [37948879698: PASS](https://github.com/mufazzalshokh/lead-agent-platform/actions/runs/37948879698) |
| Immutable image build                       | [37953132266: PASS](https://github.com/mufazzalshokh/lead-agent-platform/actions/runs/37953132266) |
| Saved plan                                  | [37954005150: PASS](https://github.com/mufazzalshokh/lead-agent-platform/actions/runs/37954005150) |
| Project / region                            | `lead-agent-stg-739284` / `me-central1`                                                            |
| Deployment timestamp                        | `2026-10-09T15:43:53Z` (20:43:53 Asia/Tashkent)                                                    |
| Migration head, all workloads               | `0031_s22_widget_inbound_route_management`                                                         |
| Saved-plan SHA256                           | `82e8062d7e9f8271a91f7b313a5d2f3cc135c642affe75c45f9316a4854f6948`                                 |
| Image-manifest file SHA256                  | `227482b565238489ede0391fc1aa27c50ac9a4274ee9cf14c28f49a3905afc90`                                 |
| Plan-captured state lineage / serial        | `ad1c3000-d52f-06eb-de1b-53ae4d67f63e` / `67`                                                      |

Authenticated artifact retrieval and independent inspection:

- Build artifact ID `11627406411`,
  `s22-image-manifest-c687dcfb82da64a26d981d793d1611d44c49c593-37953132266`.
- Plan artifact ID `11627950197`,
  `s22-terraform-plan-full-c687dcfb82da64a26d981d793d1611d44c49c593`.
  It contains `s22.tfplan`, its checksum and sanitized full-runtime safety evidence.
- Both runs checked out the exact source. The manifest names that source/run and
  four digest references; every build target uses that GIT_SHA and OCI revision
  label, with provenance/SBOM enabled. The completed manifest step pulls each
  exact digest and verifies `linux/amd64`. Manifest/provenance steps passed.
- `Get-FileHash -Algorithm SHA256` independently matches the downloaded plan's
  checksum. The local Node review independently recomputed both file hashes and
  matched source, build, references, timestamp, migration and gate bindings.
- Lineage/serial above were read from the binary plan's embedded `tfstate` only;
  raw Terraform state/JSON and sensitive configuration values were not printed.
  Neither binary artifact is committed. Later documentation-only commits do not
  justify rebuilding this unchanged runtime source.

## Four immutable image references

```text
API=me-central1-docker.pkg.dev/lead-agent-stg-739284/lead-agent/api@sha256:7baeec5f9e5c10b3d6b7bd68066f74fdac105635ed94c51a27131dea3ffa4023
Web=me-central1-docker.pkg.dev/lead-agent-stg-739284/lead-agent/web@sha256:3930cca3b9845cba8873492fae2096eed87a181e8e71fe2f724c475b1d729cd7
Worker=me-central1-docker.pkg.dev/lead-agent-stg-739284/lead-agent/worker@sha256:e8468c9e767ae23936aaab3425150f607c71296ccf3b828da05907b2a5cf7698
Migrator=me-central1-docker.pkg.dev/lead-agent-stg-739284/lead-agent/migrator@sha256:e5d922127d3993ffa896d7ee8a6dc88f9d682f1d6d8d2b9f1aa3140c5302265f
```

## Exact resource actions and safety review

**0 creates / 4 in-place updates / 0 destroys / 0 replacements.**

| Managed resource                            | Action   | Permitted difference                                |
| ------------------------------------------- | -------- | --------------------------------------------------- |
| `google_cloud_run_v2_service.api[0]`        | `update` | Image and source/timestamp provenance               |
| `google_cloud_run_v2_service.web[0]`        | `update` | Image and source/timestamp provenance               |
| `google_cloud_run_v2_worker_pool.worker[0]` | `update` | Image and source/timestamp provenance               |
| `google_cloud_run_v2_job.migrator[0]`       | `update` | Image and source/timestamp provenance; no execution |

Workflow safety check **PASS**. Independent downloaded-plan inspection **PASS**,
using installed Terraform `1.14.7`, the existing locked Google provider `7.46.1`
and `verifyFullRuntimeConfiguration` from the repository's reviewed guard:

- All **88 managed resources** checked against the actual provider schema, with
  no configurable unknowns or unreviewed configurable changes. Exactly the four
  actions above; no unexpected actions or data-source changes.
- All four before-bindings match the previously reviewed images/source
  `32e056ab0b33d407df58dc709beef711badcde25` and timestamp
  `2026-10-09T13:15:13Z`; all after-bindings match this manifest/source/timestamp.
  Migration provenance is unchanged across all four workloads.
- No SQL, IAM, network, runtime identity, secret-reference, command, retry,
  scaling, CPU/memory, tenant/channel/origin or monetary-control changes.
  Private VPC/egress and explicit migrator zero retries are preserved.
- Actual mode is `widget_booking`; before/after envelope anchor is
  `01a11c48-dbc2-76de-a873-f41664da5ccb`. Request mode is `preserve`, independently
  resolved from authoritative state. No fresh browser SID is put into Terraform.
- `Apply exact reviewed plan` and `Execute one-shot migrator` **SKIPPED**;
  inventory and booking-evidence jobs **SKIPPED**. The existing job is retained,
  not executed. Full-phase future apply also does not execute migrations.
- One refresh drift: Artifact Registry repository `update_time`. Actual provider
  schema classifies it as computed-only; no configurable drift was found.
  Its planned action is `no-op`, not a fifth resource change.

The independent review used the existing backend-free inspection directory and
installed provider. Saved-plan JSON/schema stayed in memory; there was no new
provider/dependency, backend state write or safeguard relaxation.

### Saved plan freshness and apply boundary

At review, authenticated all-branch staging workflow history contained no active
or intervening staging run; this completed plan was newest. The last apply and
runtime verification remain `37938812591` and `37939258506`. Refreshed before-image
bindings match that reviewed rollout, rather than assuming historical success
establishes the current state.

Serial `67` and lineage are the plan-captured snapshot, not a later independent
read of current backend state. Before dispatch, authenticated history still
contained no intervening staging run and the artifact was unexpired. The exact
saved binary independently matched the approved hash again. The authorized apply
retained the artifact/configuration checks and Terraform's state-lock/lineage/
serial stale-plan protection and succeeded without a replacement plan.
This saved plan is now consumed; **do not apply it again**. The owner approval
does not extend to any replacement or subsequent plan.

## Validation reused

CI **37948879698 PASS**, exact source `c687dcf`, completed
`2026-10-09T15:09:03Z`. Authenticated run/step metadata and bounded log summaries
confirm completed clean-checkout `pnpm ci:verify`: formatting/lint, 326-source
dependency boundaries, unchanged 378-contract snapshot, TypeScript, ordinary/
database tests and production builds. **3,541 ordinary cases PASS / 7 opt-in
skipped; 517 PostgreSQL cases PASS** (461 + 9 + 21 + 12 + 14).
The real database selection/CAS/idempotency/RLS/locking and unknown-reserve
regressions are included. No new CI or live-model evaluation was dispatched.

Existing focused local proof is **37/37 PASS**: 12 component render regressions
and 25 controller/security cases. Nine component cases failed before the UI
correction, then passed after it; three additional replacement/lifetime cases
also passed. Local source-aware root/Web types, scoped lint/format, dependency
boundaries and production Web build passed. These are local/mocked/CI/database
proofs, not proof of the new UI in the live owner's browser or customer booking.
See the [correction evidence](s22-acceptance-evidence.md).

This preparation's documentation checks compare the exact JSON input names
against the workflow and source/images/timestamp/hash against the authenticated
manifest/saved plan; no approval field is supplied. New-packet formatting and
scoped `git diff --check` pass. No runtime tests are repeated for documentation.

## Unchanged accounting and customer boundary

The same synthetic tenant, original cohort, Widget channel and allowed-origin
record remain fixed. Selection stays an explicitly owner-confirmed, audited
post-deployment action under the shared cohort mutex; no auto-selection/renewal
or duplicate paid allowance is added.

- Existing Widget allowance: two total inbound customer messages including
  confirmation, at most four physical calls and two attempts per message.
- Per-call reservation **USD0.801432**, Widget allowance **USD3.205728**, combined
  planning exposure **USD4.247838**; historical budget-only reserve **USD1.033396**.
  USD5 target and USD10 ceiling unchanged. Historical costs remain NULL/unknown.
- Owner's last screenshot reported known USD0.008714, exposure USD1.042110 and
  pending USD0. That is completed owner-supplied UI evidence, not a new ledger read.
- The 19:40 selection screenshot is not continuing lifetime or Send authority.
  Any later fresh-frame preparation uses the authenticated UI after deployment,
  not another SID-binding plan. Do not create/select/reload a fresh chat now.
- Timeout, unknown cost, pending reserve, exhaustion and any guard failure stop
  paid dispatch. Apply approval remains separate from paid-test approval.

## Applied exact inputs

Workflow `staging-terraform.yml`, ref `verify/s22-staging-recovery-capacity`.
The approval acknowledgement is deliberately absent from this stored record;
the workflow's required acknowledgement was supplied only for the owner's exact
authorized apply. These inputs are retained as execution evidence, not another
dispatch request. Do not rebuild/replan or reuse this consumed plan.

```json
{
  "action": "apply",
  "phase": "full",
  "commit_sha": "c687dcfb82da64a26d981d793d1611d44c49c593",
  "deployment_timestamp": "2026-10-09T15:43:53Z",
  "api_image": "me-central1-docker.pkg.dev/lead-agent-stg-739284/lead-agent/api@sha256:7baeec5f9e5c10b3d6b7bd68066f74fdac105635ed94c51a27131dea3ffa4023",
  "web_image": "me-central1-docker.pkg.dev/lead-agent-stg-739284/lead-agent/web@sha256:3930cca3b9845cba8873492fae2096eed87a181e8e71fe2f724c475b1d729cd7",
  "worker_image": "me-central1-docker.pkg.dev/lead-agent-stg-739284/lead-agent/worker@sha256:e8468c9e767ae23936aaab3425150f607c71296ccf3b828da05907b2a5cf7698",
  "migrator_image": "me-central1-docker.pkg.dev/lead-agent-stg-739284/lead-agent/migrator@sha256:e5d922127d3993ffa896d7ee8a6dc88f9d682f1d6d8d2b9f1aa3140c5302265f",
  "api_migration_head": "0031_s22_widget_inbound_route_management",
  "runtime_migration_head": "0031_s22_widget_inbound_route_management",
  "ai_journey_mode": "preserve",
  "ai_journey_widget_session_id": "01a11c48-dbc2-76de-a873-f41664da5ccb",
  "plan_run_id": "37954005150",
  "approved_plan_sha256": "82e8062d7e9f8271a91f7b313a5d2f3cc135c642affe75c45f9316a4854f6948"
}
```

## Exactly one next action

Refresh the signed-in staff Integrations page and provide a screenshot of the
**S22 synthetic Website Chat test** section. This establishes whether the corrected
selection UI is visible in the owner's actual browser. Do not open/select a fresh
chat, Send or run a Cloud Shell diagnostic yet. Customer-to-confirmed Website Chat
booking, delivery/accounting and the other actual S22 acceptance requirements
remain pending.
