# S22 Website Chat replacement: exact rollout approval packet

Prepared 11 October 2026. **PREPARED AND REVIEWED; NOT APPLIED; NO SEND.**
Owner approval to continue covers one image build and one saved rollout plan.
It does not authorize deployment, a database/diagnostic job, a new chat frame,
session selection, customer messages or provider calls. S22 remains unaccepted.

## Purpose and release boundary

The [replacement-lane implementation](s22-widget-replacement-plan.md) addresses
the exact expired, consumed, non-recoverable Widget identity. Reopening the old
frame cannot free its used allowance. The new runtime permits one attributed,
audited additive replacement only if the complete frozen retirement evidence
matches; it does not reset historical costs, NULLs, counters or audit history.
No second replacement is permitted. A changed or incomplete baseline fails closed.

Runtime, build and plan tooling source is exactly
`2055ab297fa14549c32cfbae62a094c0dd7ee751`, on
`verify/s22-staging-recovery-capacity`. Its
[clean-checkout CI 38156365923](https://github.com/mufazzalshokh/lead-agent-platform/actions/runs/38156365923)
passed `pnpm ci:verify`: **3,594 ordinary tests**, seven opt-in skips, **542 actual
PostgreSQL tests**, contracts, formatting/lint/boundaries, workspace TypeScript
and production/declaration builds. The preceding `939a72b` CI remains FAIL at
declaration emission; its explicit return-type correction is included in this
green source. No repeated test workflow was dispatched for preparation.

The separately verified [recovery deployment](s22-widget-recovery-rollout-plan.md#application-apply-and-live-verification-receipt--11-october-2026)
is the before-state, not a plan to repeat: runtime source
`19e7f3c33d94b466e1129586b15796f35d5f938b`, timestamp
`2026-10-11T12:34:47Z`, migration head `0032_s22_widget_recovery`.
Its application apply `38150555305` and read-only postflight `38150839125`
remain historical receipts. Neither migration nor validator is rerun here.

## Immutable preparation provenance

| Field | Reviewed value |
| --- | --- |
| Project / region | `lead-agent-stg-739284` / `me-central1` |
| Exact source, all four workloads | `2055ab297fa14549c32cfbae62a094c0dd7ee751` |
| Canonical release timestamp | `2026-10-11T16:49:06Z` |
| Migration head, before and after | `0032_s22_widget_recovery` |
| Image build | [38157001328: PASS](https://github.com/mufazzalshokh/lead-agent-platform/actions/runs/38157001328) |
| Manifest artifact ID | `11708544894` |
| Manifest artifact name | `s22-image-manifest-2055ab297fa14549c32cfbae62a094c0dd7ee751-38157001328` |
| Manifest file SHA256 | `6122a933ebcad954048cbd85f863b7e060b3bfecb94701539cb842d9e55eb718` |
| Saved-plan run | [38157342630: PASS](https://github.com/mufazzalshokh/lead-agent-platform/actions/runs/38157342630) |
| Plan artifact ID | `11708831514` |
| Plan artifact name | `s22-terraform-plan-full-2055ab297fa14549c32cfbae62a094c0dd7ee751` |
| Saved binary SHA256 | `60b97dc5a3a8e752a9d038577f09aee2739536c452207008ff22aa132fa1008e` |
| Plan artifact expiry | `2026-10-18T16:54:16Z` |
| Plan-captured state lineage / serial | `ad1c3000-d52f-06eb-de1b-53ae4d67f63e` / `73` |

Images were built once with scope `all`. The existing pinned workflow enables
SBOM/provenance and pulls each exact digest to verify `linux/amd64`; all four
build/push steps and the architecture/manifest steps succeeded. This is not a
claim of an independently checked image signature or a running deployment.
Only the manifest and saved-plan artifacts were downloaded for review.
Raw plan/state/secret-reference values and credentials were not printed or
committed; local evidence/helpers remain ignored.

## Exact planned actions

**0 creates / 4 in-place updates / 0 destroys / 0 replacements.**

| Resource | Action | Permitted differences |
| --- | --- | --- |
| `google_cloud_run_v2_service.api[0]` | update | Exact new image and source/time provenance with matching labels |
| `google_cloud_run_v2_service.web[0]` | update | Exact new image and source/time provenance with matching labels |
| `google_cloud_run_v2_worker_pool.worker[0]` | update | Exact new image and source/time provenance with matching labels |
| `google_cloud_run_v2_job.migrator[0]` | update | Exact new image and source/time provenance; job definition only, no execution |
| Every other managed resource | no-op | None |

Workflow safety verification and independent installed Terraform **1.14.7** /
locked Google provider **7.46.1** inspection both pass. The existing
`verifyFullRuntimeConfiguration` checked **88/88 managed resources**, all
provider-configurable attributes/nested blocks and configurable unknown masks.
No configurable unknown, unexpected action or unreviewed change is present.

- All before-images/source/time/head match the authenticated prior recovery
  manifest, whose file SHA256 is
  `dc9a0221b1a2383100392402ab1f00ae7dbf1933f1ac13f3a2095fa82c11b759`.
  Every after-image/source/time/head matches this exact build and the inputs below.
- IAM, SQL settings, private VPC/subnet/egress, secret references, service accounts,
  commands, CPU/memory, scaling, parallelism/task count and numeric zero migrator
  retries are unchanged. No SQL or schema mutation is planned.
- Worker `AI_JOURNEY_MODE=widget_booking` and the stable envelope anchor
  `01a11c48-dbc2-76de-a873-f41664da5ccb` are identical before/after.
  This anchor is not the proposed fresh browser identity or Send authority.
- The only refresh drift is Artifact Registry `update_time`. It is
  provider-computed-only; the registry's managed action remains no-op.
- Authenticated plan metadata confirms exactly **15 successful preparation
  steps**, **126 skipped steps** and three skipped evidence jobs. Apply,
  migration, validator, diagnostics, bootstrap/IAM changes, deployment-provenance
  recording and customer/booking evidence execution were skipped.

The first restricted local Terraform read returned
`S22_REPLACEMENT_PLAN_READ_BLOCKED`. The same downloaded artifact passed outside
the local process sandbox using the existing backend-free inspection directory;
this did not regenerate a plan, authenticate to the staging backend, download
providers or change workflow permissions. PowerShell independently reproduced
the binary SHA256. Only lineage/serial were reported from its embedded `tfstate`;
no state payload was printed.

## Preserved lane, accounting and authority

Organization `01a0ee39-91a9-7293-82c0-5b7046c10115`, Widget channel
`01a11771-2c02-7240-86f7-19f95690d22e` and approved-origin record
`01a11771-2c02-7765-b999-7dc9895ee49d` remain fixed. Retired identity is
`01a12a04-d2ae-7cba-aded-0c48a410be0c`; its exact conversation/request/run
and historical ledger are preserved by the implementation, not changed by Terraform.

- Proposed new lane: two customer inbounds, request then confirmation only after
  an actual staff offer; three physical provider attempts maximum, two per message.
- Retained historical snapshot: known cost **USD0.010964**, uncertainty reserve
  **USD1.033396**, combined exposure **USD1.044360**, pending reserve **USD0**.
  Historical NULL costs remain NULL and unknown. No fresh database/accounting
  collection was performed during rollout preparation.
- Per-attempt reserve **USD0.801432**; additional three-attempt reserve bound
  **USD2.404296**; combined planning bound **USD3.448656**. Integer-micro arithmetic
  is fixed by the verified runtime/preparation tests, not a current billing balance.
- Existing combined cap **USD4.247838** and hard ceiling **USD10** are unchanged.
  The retired inbound/attempt still count: Widget totals are at most three customer
  inbounds and four physical slots across the retired and new lanes.
- Deploy first; corroborated owner selection occurs later under separate authority.
  Selection rechecks the locked frozen baseline, retains member attribution/CAS
  and append-only history, and does not authorize Send or renew a session.
  Every physical dispatch independently rechecks current identity and all guards.

## Exact preparation inputs; future apply boundary

Workflow `staging-terraform.yml`, dispatch ref
`verify/s22-staging-recovery-capacity`; both the workflow tooling and checked-out
runtime source are pinned above. No apply token was supplied or persisted.

```json
{
  "action": "plan",
  "phase": "full",
  "commit_sha": "2055ab297fa14549c32cfbae62a094c0dd7ee751",
  "runtime_git_commit_sha": "2055ab297fa14549c32cfbae62a094c0dd7ee751",
  "deployment_timestamp": "2026-10-11T16:49:06Z",
  "migration_head": "0032_s22_widget_recovery",
  "runtime_migration_head": "0032_s22_widget_recovery",
  "api_migration_head": "0032_s22_widget_recovery",
  "api_image": "me-central1-docker.pkg.dev/lead-agent-stg-739284/lead-agent/api@sha256:931232792f296902ba739917f4aa010acefe31f5577c1e5caabfca6fa203d9c8",
  "web_image": "me-central1-docker.pkg.dev/lead-agent-stg-739284/lead-agent/web@sha256:7c9cd68f2bdff3087c48478e362a6ae2e2966c062aa52e77f61c708c09b50eca",
  "worker_image": "me-central1-docker.pkg.dev/lead-agent-stg-739284/lead-agent/worker@sha256:b573351e6dc3b755e9283df9a5b065a5728f27fce48624508bc9d924c7b78a0b",
  "migrator_image": "me-central1-docker.pkg.dev/lead-agent-stg-739284/lead-agent/migrator@sha256:f2f5e6f918296f75c54cc0b91e12d9c2360f5970f99e6f16c84eafe97d9a0b9d",
  "ai_journey_mode": "preserve",
  "ai_journey_widget_session_id": "01a11c48-dbc2-76de-a873-f41664da5ccb"
}
```

Only explicit approval of **plan 38157342630 only** may authorize its application.
Future apply must retain all these inputs, changing `action` to `apply` and adding
`plan_run_id=38157342630`, the exact approved binary SHA256 above and the existing
owner-approval acknowledgement through the actual workflow input. It must first
freshly authenticate/download the unexpired exact artifact, reproduce the approved
hash and recheck its full configurable boundary. The existing saved-plan apply,
state lock and lineage/serial stale-plan protections are mandatory.

At preparation review, authenticated all-branch staging history shows this plan
as newest, with no active/intervening Terraform workflow. The previous apply and
postflight remain `38150555305` / `38150839125`; no direct current-backend state
comparison is claimed. Captured serial 73 is not a promise of indefinite validity.
If the artifact expires, state becomes stale or a guard fails, stop: do not replan,
rebuild, substitute source/digests or replay a migration under this approval.

After a separately approved apply, the existing read-only API/Web metadata and
whole-runtime convergence profile must verify exact images/source/time/head,
private networking, ready services and preserved binding before any fresh frame.
Do not infer paid-test or session-replacement execution authority from deployment.
If release verification fails, stop the paid window; compatible rollback requires
a separately reviewed plan using preserved prior digests. Never downgrade SQL,
delete/reset ledger rows, auto-retry a customer message or claim recovery from an
application rollback. This packet does not execute rollback or change the gate.

## Exact verification and handoff

Preparation commands/results:

```text
gh run view 38156365923 --json status,conclusion,headSha
gh workflow run staging-images.yml --repo mufazzalshokh/lead-agent-platform --ref verify/s22-staging-recovery-capacity --field commit_sha=2055ab297fa14549c32cfbae62a094c0dd7ee751 --field image_scope=all
gh run download 38157001328 --repo mufazzalshokh/lead-agent-platform --name s22-image-manifest-2055ab297fa14549c32cfbae62a094c0dd7ee751-38157001328 --dir .cache/s22-widget-replacement-rollout/build
node --check .cache/s22-widget-replacement-rollout/review.mjs
node --check .cache/s22-widget-replacement-rollout/verify-document.mjs
node .cache/s22-widget-replacement-rollout/review.mjs --inspect
node .cache/s22-widget-replacement-rollout/review.mjs --dispatch
node .cache/s22-widget-replacement-rollout/review.mjs --receipt 38157342630
gh run download 38157342630 --repo mufazzalshokh/lead-agent-platform --name s22-terraform-plan-full-2055ab297fa14549c32cfbae62a094c0dd7ee751 --dir .cache/s22-widget-replacement-rollout/plan-38157342630
node .cache/s22-widget-replacement-rollout/review.mjs --review 38157342630
Get-FileHash -Algorithm SHA256 -LiteralPath .cache/s22-widget-replacement-rollout/plan-38157342630/s22.tfplan
node .cache/s22-widget-replacement-rollout/verify-document.mjs
node node_modules/prettier/bin/prettier.cjs --check docs/architecture/s22-widget-replacement-rollout-plan.md docs/architecture/s22-widget-replacement-plan.md
git diff --check -- docs/architecture/s22-widget-replacement-rollout-plan.md docs/architecture/s22-widget-replacement-plan.md
```

The existing CI, build, source/manifest/input assertions, authenticated artifact/
expiry/step receipt, exact saved-plan/checksum/configuration/action/drift review
pass. Document-to-input/digest/integer-bound assertions, the formatter and scoped
whitespace check also pass. No runtime code/tests, dependencies, public API,
migrations or IAM changed
in this preparation; it reuses the exact green runtime test evidence above.
The final evidence commit changes only this packet and its implementation-document
cross-reference, so runtime/tooling pinning does not follow that later documentation
HEAD. Unrelated README/Instagram/public-notices owner edits remain excluded.

**Exactly one next safe action:** request owner approval to apply **plan
38157342630 only**. No fresh chat frame or Cloud Shell repetition is needed now.
