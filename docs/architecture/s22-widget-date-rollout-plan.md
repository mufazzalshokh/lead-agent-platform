# S22 named-date correction: exact rollout approval packet

Prepared and reviewed 11 October 2026 UTC (12 October in Asia/Tashkent).
**PREPARED AND REVIEWED; NOT APPLIED; NO SEND.**
Only saved plan **38165971091**, identified by the binary checksum below, is
offered for review. No apply approval or token was supplied. The previous
[replacement deployment](s22-widget-replacement-rollout-plan.md#exact-apply-and-live-verification-receipt--11-october-2026)
is historical and must not be repeated.

## Purpose and exact source

The real first-message failure was application normalization: the instructed
**12-oktabr kuni soat 17:00** date was not recognized by the deterministic parser.
The [source correction receipt](s22-acceptance-evidence.md#2026-10-11---named-customer-date-rejected-shared-parser-correction)
records its failing reproduction and verified fix. The shared parser now supports
localized full month names, validates calendar dates, retains the receipt's local
year when omitted, and rejects ambiguity instead of reusing stale date evidence.
AI dates do not become authoritative; availability, qualification, tenant scope,
request/offer/customer-confirmation policy and idempotency remain unchanged.

Exact runtime/tooling source:
`1a910f097709a0e20b8d153bf482f470e1d631be`, on
`verify/s22-staging-recovery-capacity`.
It also carries verified parent `ffba726d56c9363ffe43e45160ae9aa897d10cd4`:
the visible **Copy installation code** label followed by a small 16px icon.
This is one consolidated rollout, not a separate cosmetic deployment.
No recovery-code format, automatic browser persistence, provider/prompt profile,
dependency or public API change is included.

[Exact-source CI 38164821614](https://github.com/mufazzalshokh/lead-agent-platform/actions/runs/38164821614)
**PASS**: `pnpm ci:verify` passed **3,658 ordinary tests** and **542 actual
PostgreSQL tests** (4,200 total); seven opt-in live-provider tests were skipped.
Types, formatting/lint, boundaries, 382 canonical contracts and production builds
passed. The earlier focused date/grounding regression passed **163/163**;
these overlapping counts are not additive.

## Immutable provenance

| Field | Reviewed value |
| --- | --- |
| Project / region | `lead-agent-stg-739284` / `me-central1` |
| Before runtime source | `2055ab297fa14549c32cfbae62a094c0dd7ee751` |
| Before release timestamp | `2026-10-11T16:49:06Z` |
| Planned source, all four images | `1a910f097709a0e20b8d153bf482f470e1d631be` |
| Planned release timestamp | `2026-10-11T18:51:44Z` |
| Migration head, before / after | `0032_s22_widget_recovery` |
| Image build | [38165559088: PASS](https://github.com/mufazzalshokh/lead-agent-platform/actions/runs/38165559088) |
| Manifest artifact ID | `11712246157` |
| Manifest artifact name | `s22-image-manifest-1a910f097709a0e20b8d153bf482f470e1d631be-38165559088` |
| Downloaded manifest SHA256 | `4056e50b4bbeb32022bd327a1c66757c0d96cde7639c1d558f0c3122de73054d` |
| Saved plan | [38165971091: PASS](https://github.com/mufazzalshokh/lead-agent-platform/actions/runs/38165971091) |
| Plan artifact ID | `11712061824` |
| Plan artifact name | `s22-terraform-plan-full-1a910f097709a0e20b8d153bf482f470e1d631be` |
| Saved binary SHA256 | `d8cfd8ba5311f5a74becc895562e51271f9f7f036ac054f7c0081f7f913e4a45` |
| Plan artifact expiry | `2026-10-18T18:58:07Z` |
| Captured state lineage / serial | `ad1c3000-d52f-06eb-de1b-53ae4d67f63e` / `74` |

The pinned image workflow built/pushed all four images once, with configured SBOM
and maximal provenance, then pulled each exact digest and verified
`linux/amd64`. All relevant steps passed. Artifact metadata and downloaded
manifest source/run/digest bindings match. This is not an independent image
signature/attestation verification claim. The monitoring client lost a network
connection once; an authenticated read of the same existing build confirmed
success. No build was rerun.

## Reviewed plan boundary

**0 creates / 4 in-place updates / 0 destroys / 0 replacements.**

| Managed resource | Permitted differences |
| --- | --- |
| `google_cloud_run_v2_service.api[0]` | New exact image and source/time provenance with matching labels |
| `google_cloud_run_v2_service.web[0]` | New exact image and source/time provenance with matching labels |
| `google_cloud_run_v2_worker_pool.worker[0]` | New exact image and source/time provenance with matching labels |
| `google_cloud_run_v2_job.migrator[0]` | New exact image and source/time provenance; definition only, no execution |
| Every other managed resource | No-op |

The workflow safety check and separate local inspection of the downloaded binary
passed **88/88 managed resources**, using Terraform **1.14.7** and locked Google
provider **7.46.1**. Every provider-configurable attribute/nested block and
configurable unknown mask was checked. No configurable unknown or unreviewed
configuration change is present. All before images/source/time/head match the
authenticated prior manifest; all after values match the exact inputs below.

IAM, identities, MFA, RLS/security guards, secret references, SQL settings,
private VPC/subnet/egress, ingress, commands, CPU/memory, scaling, task count,
parallelism and explicit numeric zero migrator retries are unchanged.
Only Artifact Registry `update_time` and SQL `settings.0.version` appeared as
refresh drift; both were independently classified from the installed provider
schema as computed-only. Their managed resources remain no-op.

Worker `AI_JOURNEY_MODE=widget_booking` and stable budget-envelope anchor
`01a11c48-dbc2-76de-a873-f41664da5ccb` are identical before/after.
That anchor is not a replacement browser session or Send authorization.
Current owner-selected browser identity
`01a12c02-3e50-7663-99f4-c35024796c23` is not changed by this plan.

Authenticated workflow receipt confirms **15 successful preparation steps**,
**126 skipped steps**, and all three evidence jobs skipped. Apply, migrations,
validator, diagnostic/database jobs, IAM/bootstrap changes and deployment
provenance recording did not run. Local inspection initially failed to start
within the restricted process sandbox; the identical downloaded-plan read
passed outside it using the existing backend-free inspection directory.
No backend authentication, replan, provider installation or permission change
was made by that local inspection. Raw plan/state and credentials were not printed
or committed; only checksum and lineage/serial were reported.

## Exact preparation inputs

Workflow `staging-terraform.yml`, dispatch ref
`verify/s22-staging-recovery-capacity`. Tooling and runtime are pinned to the
exact source above, not a later documentation HEAD.

```json
{
  "action": "plan",
  "phase": "full",
  "commit_sha": "1a910f097709a0e20b8d153bf482f470e1d631be",
  "runtime_git_commit_sha": "1a910f097709a0e20b8d153bf482f470e1d631be",
  "deployment_timestamp": "2026-10-11T18:51:44Z",
  "migration_head": "0032_s22_widget_recovery",
  "runtime_migration_head": "0032_s22_widget_recovery",
  "api_migration_head": "0032_s22_widget_recovery",
  "api_image": "me-central1-docker.pkg.dev/lead-agent-stg-739284/lead-agent/api@sha256:f3f452630deda0accdb9576a209c320d4ca5b979045e2585fc53df58bd0d267a",
  "web_image": "me-central1-docker.pkg.dev/lead-agent-stg-739284/lead-agent/web@sha256:2572341d7728fdb60078e2a1a003f09b9dff02304ee7086b97d1276a23803908",
  "worker_image": "me-central1-docker.pkg.dev/lead-agent-stg-739284/lead-agent/worker@sha256:14b321478506600805bee7a573ccbf0fa86ec5a391b0815d9b2c49976326ed57",
  "migrator_image": "me-central1-docker.pkg.dev/lead-agent-stg-739284/lead-agent/migrator@sha256:c144b3fe2b863dbb02e02e47fb3dc231213630406d7f0c0994ea6ec8c9c99bec",
  "ai_journey_mode": "preserve",
  "ai_journey_widget_session_id": "01a11c48-dbc2-76de-a873-f41664da5ccb"
}
```

No `owner_approval_token`, `plan_run_id`, `approved_plan_sha256` or job execution
ID was supplied during preparation. Apply, if separately approved, must use
this unexpired artifact and exact checksum, preserve these inputs, and use the
existing saved-plan/state-lock/stale-lineage safeguards. If any guard fails,
stop; do not rebuild, replan, substitute images, alter caps or replay a migration
under approval of this plan. A rollback would require its own reviewed compatible
plan; SQL downgrade or ledger reset is not authorized.

## Paid-test and acceptance boundaries

No fresh session, renewal, recovery, selection, replay, message, booking mutation
or provider-test call was initiated. Existing lane limits remain: two customer
messages maximum, request then confirmation only after an actual staff offer;
three physical provider attempts maximum, at most two per message; lane reserve
bound **USD2.404296**, combined cap **USD4.247838**, hard ceiling **USD10**.
Retired usage and historical NULL costs remain preserved and unknown; no fresh
live accounting/request/attempt query was performed for preparation.
The previous known-cost **USD0.010964** / exposure **USD1.044360** / pending
**USD0** snapshot precedes the current first-message response and must not be
presented as a new current balance or remaining allowance.

Deploying this fix does not rewrite or replay the already processed first turn.
The screenshot alone does not establish the current persisted appointment-request
state. The remaining customer turn may not be spent on date clarification or a
style retry under the approval reserving it for confirmation after a staff offer.
A current read-only trace and separately bounded continuation decision are still
needed after an approved, runtime-verified apply. **S22 remains unaccepted.**
Recovery/confirmed-booking acceptance, restore proof and capacity proof are not
established by this plan or CI.

## Exact verification and handoff

```text
gh run view 38164821614 --json status,conclusion,headSha
gh workflow run staging-images.yml --repo mufazzalshokh/lead-agent-platform --ref verify/s22-staging-recovery-capacity --field commit_sha=1a910f097709a0e20b8d153bf482f470e1d631be --field image_scope=all
gh run download 38165559088 --repo mufazzalshokh/lead-agent-platform --name s22-image-manifest-1a910f097709a0e20b8d153bf482f470e1d631be-38165559088 --dir .cache/s22-named-date-rollout/build
node --test .github/scripts/s22-full-runtime-config-check.test.mjs .github/scripts/s22-recovery-rollout.test.mjs
node --check .cache/s22-named-date-rollout/review.mjs
node .cache/s22-named-date-rollout/review.mjs --inspect
node .cache/s22-named-date-rollout/review.mjs --dispatch
node .cache/s22-named-date-rollout/review.mjs --receipt 38165971091
gh run download 38165971091 --repo mufazzalshokh/lead-agent-platform --name s22-terraform-plan-full-1a910f097709a0e20b8d153bf482f470e1d631be --dir .cache/s22-named-date-rollout/plan-38165971091
node .cache/s22-named-date-rollout/review.mjs --review 38165971091
Get-FileHash -Algorithm SHA256 -LiteralPath .cache/s22-named-date-rollout/plan-38165971091/s22.tfplan
node .cache/s22-named-date-rollout/verify-document.mjs
node node_modules/prettier/bin/prettier.cjs --check docs/architecture/s22-widget-date-rollout-plan.md docs/architecture/s22-acceptance-evidence.md
git diff --check -- docs/architecture/s22-widget-date-rollout-plan.md docs/architecture/s22-acceptance-evidence.md
```

Deployment-guard regressions pass **16/16**; exact CI/build/artifact/step,
manifest/input/checksum, saved-plan configuration/action/drift and document
checks pass. The focused evidence commit includes only this packet and its
acceptance-evidence cross-reference. Owner README, Instagram documentation and
public-notices patch edits remain untouched and excluded. No new runtime/tests,
migration, dependency or public contract change is made in this preparation.

The next safe task is owner review/approval of **plan 38165971091 only**,
followed by its exact apply and read-only runtime postflight; not another chat
or a Send instruction. This packet records preparation, not deploy authority.
