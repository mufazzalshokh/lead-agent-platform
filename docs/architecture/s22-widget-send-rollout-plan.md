# S22 Website Chat wording and send rollout approvals

## Latest rollout - shared customer wording deployed and verified, 2026-10-11

**APPLIED ONCE AND RUNTIME VERIFIED.** The owner's explicit
"Apply plan 38128355452 only" approval is fulfilled by
[apply 38129053516 PASS](https://github.com/mufazzalshokh/lead-agent-platform/actions/runs/38129053516)
and read-only
[verification 38129147318 PASS](https://github.com/mufazzalshokh/lead-agent-platform/actions/runs/38129147318).
The saved plan is consumed; do not reapply it. Current verified runtime source is
`68b3011`. No replacement plan/build, customer message or paid call was initiated
by this rollout.

The shared application renderer combines approved price/duration facts without
repeating the service name or equivalent price header, keeps all non-redundant
conditions and the synthetic notice, and uses a brief greeting plus a separate
staff-review request acknowledgment. It affects the common Widget/Instagram
path without changing prompts, models, routing, domain actions or tenant policy.
The copy icon, explicit Send handler and larger composer remain unchanged.

Runtime/build/plan source: **`68b3011d26afe1bbb8ef0a32c4efd8f66df7c819`**.
The implementation is `9e0e6a1`; follow-up `68b3011` changes only one integration
assertion and its evidence. Relative to live source `1210c25`, there are five
application files, wording tests, that integration assertion and S22 documents;
no infrastructure/workflow or migration change. Unrelated local owner edits are
not packaged. The existing coherent four-image pipeline is retained.

Exact-source [CI 38127776639 PASS](https://github.com/mufazzalshokh/lead-agent-platform/actions/runs/38127776639),
immutable [build 38128063935 PASS](https://github.com/mufazzalshokh/lead-agent-platform/actions/runs/38128063935)
and saved [plan 38128355452 PASS](https://github.com/mufazzalshokh/lead-agent-platform/actions/runs/38128355452)
are separate proofs. CI completed clean-checkout `pnpm ci:verify`: static checks,
types, **3564 ordinary tests / 7 skipped**, all **517 PostgreSQL tests** across
five isolated suites, and production builds. Total **4081 PASS / 7 skipped**.
The initial `9e0e6a1` CI failure was a literal assertion for the old passive
sentence; it was corrected to verify date/time, request and staff-review meaning
without removing any persisted-state, tenant, outbox, audit or no-confirmation
checks. Fresh CI passed the formerly failing suite **461/461**. No failed-source
build or blind workflow rerun was used.

Project/region: `lead-agent-stg-739284` / `me-central1`. Release metadata
timestamp: **`2026-10-11T09:26:04Z`** (14:26:04 Asia/Tashkent), retained exactly
from the approved plan. Apply completed **`2026-10-11T09:38:48Z`**; read-only
verification completed **`2026-10-11T09:40:13Z`**. Migration provenance remains
`0031_s22_widget_inbound_route_management`.

All references use registry
`me-central1-docker.pkg.dev/lead-agent-stg-739284/lead-agent`:

```text
api@sha256:8ee2a518dfdeda34dc8eff02283f660a1a3735332484c925df0623201e774ca9
web@sha256:62a9672a56c2ccde54a54cae230f87f918d8e15bd061acfd7403eb5c698e530a
worker@sha256:d3fa54d67b455b9287e453c6dd1d111f336d7c2e609aea39857d32bbfaeb50b9
migrator@sha256:95841b30404b3605b3cee9a457bb83b0d29731c5ab3b97aac5dfd78c35c8e260
```

Authenticated build manifest artifact **11698590185**:
`s22-image-manifest-68b3011d26afe1bbb8ef0a32c4efd8f66df7c819-38128063935`.
Plaintext manifest SHA256:
`a8bc612d1e388306c1bd0d8e9e5c1259d605d5cc78ffbbbbbcde7fca7c097bc0`.
The exact-source build enabled OCI provenance/SBOM and pulled all four digest
references to verify `linux/amd64` before publishing this manifest.

Authenticated plan artifact **11697975717**:
`s22-terraform-plan-full-68b3011d26afe1bbb8ef0a32c4efd8f66df7c819`.
Saved binary SHA256:
**`5adf180dfd64fe5ec73290b3ccb9213a5ca1fd4a8761a146a39b6035751508a8`**.
The downloaded binary matches its recorded checksum. Local Terraform **1.14.7**
with locked Google provider **7.46.1** inspected plan/schema in memory using the
existing backend-free directory and `verifyFullRuntimeConfiguration` guard.
Raw plan/state/schema and generated tooling/artifacts are ignored, not committed
or printed. The guard passed **88 managed configurations**, no configurable
unknowns, and exactly the following action set:

| Resource                                    | Action | Permitted changes                                   |
| ------------------------------------------- | ------ | --------------------------------------------------- |
| `google_cloud_run_v2_service.api[0]`         | update | Image and source/timestamp provenance               |
| `google_cloud_run_v2_service.web[0]`         | update | Image and source/timestamp provenance               |
| `google_cloud_run_v2_worker_pool.worker[0]`  | update | Image and source/timestamp provenance               |
| `google_cloud_run_v2_job.migrator[0]`        | update | Image and source/timestamp provenance; no execution |

**0 creates / 4 in-place updates / 0 destroys / 0 replacements.** Independent
before-image/provenance comparisons match the last verified `1210c25` rollout,
timestamp `2026-10-11T08:15:07Z`. After-image/source/time comparisons match this
manifest and packet. Only refreshed drift is Artifact Registry `update_time`,
verified computed-only with planned action `no-op`. Before apply, authenticated
workflow history showed no intervening apply; a fresh download again matched
the approved checksum, and independent review again passed all 88 configurations.
Seven existing configuration-guard tests passed. Preparation passed plan safety
and upload and skipped apply/migrator execution. The authorized apply then passed
download, integrity and exact full-runtime approval guards and completed
**0 added / 4 changed / 0 destroyed**, with no replacements. It skipped creating
another plan and executing the migrator. Both apply and verification skipped
inventory/booking-evidence jobs. No database diagnostic, session mutation or
provider call was initiated by either workflow.

Read-only artifact **11698956388**, `s22-api-image-live-evidence-38129147318`,
has plaintext SHA256
`0e019fdbcf7a78dff763e3c348db9c9906c67b643749c1b1a4bb27fa0abd7056`.
All **16 assertions PASS**, including exact API/Web images, API source/time and
migration provenance, identity, private VPC/egress, secret-reference count and
ready revisions. Whole-runtime Terraform convergence is **exit 0**. Independent
receipt validation matches the approved source, time and digests. API ready:
**`lead-agent-staging-api-00032-zfj`**; Web ready:
**`lead-agent-staging-web-00028-7rh`**. Worker/Migrator desired bindings are covered
by saved-plan inspection, successful apply and whole-runtime convergence, not a
separate direct ready-revision assertion. No provider/message endpoint or private
database was queried by this release verification.

Mode request **preserve** resolves from authoritative state to unchanged
`widget_booking`; before/after deployment-envelope anchor remains
`01a11c48-dbc2-76de-a873-f41664da5ccb`. This is not a new browser session or a
renewal. The owner-selected session that already received the first reply is
`01a12a04-d2ae-7cba-aded-0c48a410be0c`; it is not replaced by this plan.
No selection, counter, budget, grant, session TTL, IAM, identity, private VPC,
secret reference, command, retry, scaling or resource-limit change is permitted.

The existing test envelope is unchanged: two total customer messages (request,
then confirmation only after a genuine staff offer), four physical attempts,
maximum two per message, additional reserve at most USD3.205728, combined planning
exposure at most USD4.247838 and existing USD10 ceiling. This does not renew an
expired session or transfer its approval. Post-Send accounting/eligibility have
not been reread; the older owner-UI costs are not a current balance. Historical
NULL costs remain unknown. Do not resend the request for a style comparison.
Existing delivered/persisted wording is not rewritten; only future replies change.

Recorded plan inputs (no apply token or approval authority is embedded):

```json
{
  "action": "plan",
  "phase": "full",
  "commit_sha": "68b3011d26afe1bbb8ef0a32c4efd8f66df7c819",
  "deployment_timestamp": "2026-10-11T09:26:04Z",
  "api_image": "me-central1-docker.pkg.dev/lead-agent-stg-739284/lead-agent/api@sha256:8ee2a518dfdeda34dc8eff02283f660a1a3735332484c925df0623201e774ca9",
  "web_image": "me-central1-docker.pkg.dev/lead-agent-stg-739284/lead-agent/web@sha256:62a9672a56c2ccde54a54cae230f87f918d8e15bd061acfd7403eb5c698e530a",
  "worker_image": "me-central1-docker.pkg.dev/lead-agent-stg-739284/lead-agent/worker@sha256:d3fa54d67b455b9287e453c6dd1d111f336d7c2e609aea39857d32bbfaeb50b9",
  "migrator_image": "me-central1-docker.pkg.dev/lead-agent-stg-739284/lead-agent/migrator@sha256:95841b30404b3605b3cee9a457bb83b0d29731c5ab3b97aac5dfd78c35c8e260",
  "api_migration_head": "0031_s22_widget_inbound_route_management",
  "runtime_migration_head": "0031_s22_widget_inbound_route_management",
  "ai_journey_mode": "preserve",
  "ai_journey_widget_session_id": "01a11c48-dbc2-76de-a873-f41664da5ccb"
}
```

The one approved saved-binary apply and read-only verification are complete.
Dispatch ran from documentation-only branch HEAD `39196ad`; the workflow's
validated exact checkout and all runtime provenance remain source `68b3011`.
Do not reapply, rebuild or substitute a plan. A rollback would require a newly
reviewed plan using the retained prior digests; no automatic rollback, replay,
budget/session reset or migration is authorized.

**Next safe step: read-only correlation of the already received booking request
with its persisted booking, delivery/provider trace and staff-review path.**
Do not resend the request or spend the remaining confirmation message on style.
Source/CI/build/apply/runtime proof does not establish live fluent-language,
Instagram reply, customer-confirmation or post-Send accounting acceptance.
**S22 remains unaccepted.**

## Latest rollout - compact copy icon deployed and verified, 2026-10-11

The owner explicitly authorized deployment with "okay you can deploy". The
small copy-icon presentation update is deployed at runtime source
`1210c253f1d2909c9e92c6b4892cd76503c9fb74`, project
`lead-agent-stg-739284`, region `me-central1`, deployment timestamp
`2026-10-11T08:15:07Z` (13:15:07 Asia/Tashkent). Relative to the previously
deployed `084cb5a`, application changes are only
`apps/web/src/app/staff/CopyWidgetCodeButton.tsx` and
`apps/web/src/app/styles.css`; the remaining source changes are S22 documentation.
The confirmed Send correction and larger composer are retained unchanged.

Exact-source [CI 38123453058 PASS](https://github.com/mufazzalshokh/lead-agent-platform/actions/runs/38123453058),
immutable [build 38123758852 PASS](https://github.com/mufazzalshokh/lead-agent-platform/actions/runs/38123758852),
saved [plan 38124183094 PASS](https://github.com/mufazzalshokh/lead-agent-platform/actions/runs/38124183094),
[apply 38124295117 PASS](https://github.com/mufazzalshokh/lead-agent-platform/actions/runs/38124295117)
and read-only [verification 38124393676 PASS](https://github.com/mufazzalshokh/lead-agent-platform/actions/runs/38124393676)
are distinct evidence. Apply completed `2026-10-11T08:18:44Z`; verification
completed `2026-10-11T08:20:26Z`. No replacement build, plan or apply was run.

All image references share registry
`me-central1-docker.pkg.dev/lead-agent-stg-739284/lead-agent`:

```text
api@sha256:ae05d393a11366c8b6c9fffd914cada915748627d9e35d6d00a2ab8dc0ad0256
web@sha256:5dc8eb3dc538311a1c38237efc22220607bd61d16801c206267d129bc2fb8757
worker@sha256:9156628bdca7b903f6fd27f319dc42918fb77a41fe8232c179b9be4f70575611
migrator@sha256:0a91feb13834a9712bc3c657e89113e42de8d9b2c8ea9e8c0d7cff9e4e35810b
```

Authenticated manifest artifact `11696113030` is
`s22-image-manifest-1210c253f1d2909c9e92c6b4892cd76503c9fb74-38123758852`;
SHA256 `ba5b357747246b6465724558e83606705fe050977ab44334526227f69be70b35`.
Saved-plan artifact `11696163296` is
`s22-terraform-plan-full-1210c253f1d2909c9e92c6b4892cd76503c9fb74`;
binary SHA256 `8a3f9717a415838d838ea310caf711c1c59c239dfe73fbd2a856bdd72b409197`.
The binary matched its checksum and was inspected independently using installed
Terraform 1.14.7 / locked Google provider 7.46.1, with raw plan/state/schema kept
in memory. The existing guard passed **88 managed configurations** and exactly
**0 creates / 4 in-place updates / 0 destroys / 0 replacements**. All before
bindings matched the prior live rollout; after bindings matched this manifest.
The only refreshed drift was computed-only registry `update_time`, with planned
action `no-op`. Workflow history showed no intervening apply before dispatch.

The existing coherent four-workload release workflow was used. Only image and
source/timestamp provenance were permitted to change. Request mode `preserve`
resolved to unchanged `widget_booking`, with unchanged deployment-envelope anchor
`01a11c48-dbc2-76de-a873-f41664da5ccb`. Migration provenance remains
`0031_s22_widget_inbound_route_management`. No IAM, identity, networking, secret
reference, command, retry, scaling, resource-limit, database, budget, ledger or
session-lifetime change. The apply's exact full-runtime approval guard and saved
plan apply passed; plan creation and one-shot migrator execution were skipped.
This saved plan is consumed and must not be reapplied.

Sanitized verification artifact `11696965253`,
`s22-api-image-live-evidence-38124393676`, independently yields **16/16 PASS**:
exact API source/image/timestamp/migration, identity/private VPC/subnet/egress,
15 secret references, API/Web images and ready revisions, and whole-runtime
Terraform convergence **exit 0**. API ready revision is
**lead-agent-staging-api-00031-4fm**; Web is
**lead-agent-staging-web-00027-htx**. Worker/Migrator desired bindings are covered
by refreshed convergence, not separate direct ready-revision assertions. This
verification created no saved deployment plan or database diagnostic.

Bounded public reads confirm API `api/ok`; the served Widget loader exactly equals
reviewed source, SHA256
`9174e16a48d3bb1620d20e8854a774f78daac22d5d917b8ea7744cc2f7eaea0a`,
with unchanged sandbox. Eight staff scripts and one stylesheet contain the new
copy icon, tooltip, clipboard handler, stable 44px size and copied-state styles.
This is served-asset proof, not authenticated live clipboard interaction or a
real customer message/provider/booking journey. No grant/frame/session/message
or model endpoint was called by release verification. Previously recorded local
browser/component regressions and exact-source CI were reused, not rerun.

The owner supplied a screenshot of selected empty session
`01a12a04-d2ae-7cba-aded-0c48a410be0c`, opened **13:12 Asia/Tashkent**,
idle deadline **13:42**, absolute expiry **15:12**, all October 11. Times have
screenshot minute precision. The owner UI reports budget ready, known cost
USD0.008714, combined exposure USD1.042110 and pending reserve USD0.000000.
This is a server-backed owner-UI snapshot, not an independent atomic database
trace or lifetime renewal. The owner separately approved this exact session's
bounded test conditional on verification passing: two total customer messages
(request, then confirmation only after a staff offer), four provider attempts,
at most two per message, additional reserve at most USD3.205728 and combined
exposure at most USD4.247838, no budget increase. Existing USD10 ceiling and all
stop guards remain. No expired session's authority is transferred; historical
NULL costs remain unknown. Runtime guards must revalidate actual dispatch.

Next acceptance item: send the first approved synthetic booking request once in
this same selected chat before its idle deadline, then inspect the response and
trace the persisted journey. Do not resend, reload or create another chat after
an error. Staff acceptance is not customer confirmation. **S22 is unaccepted.**

## Previous consumed Send-correction packet

The following records retain the earlier rollout, not the current image binding.

Prepared and applied 2026-10-11, Asia/Tashkent. **APPLY AND LIVE RUNTIME
VERIFICATION PASS; SAVED PLAN CONSUMED.**

Plan **38121689049** packages the confirmed Send-button correction, the larger
auto-growing composer, and the previously requested installation-code **Copied!**
feedback. The owner's exact approval permitted its saved four-workload update. It does
not authorize a migration, another chat session, a customer message, or a paid AI
call. Historical NULL costs remain unknown; S22 remains unaccepted.

## Applied result

The owner approved **"Apply plan 38121689049 only."** Single apply
[38122198305 PASS](https://github.com/mufazzalshokh/lead-agent-platform/actions/runs/38122198305)
completed `2026-10-11T07:42:11Z`. The artifact was freshly downloaded and its
binary checksum matched the approved value before dispatch. Workflow history
showed no intervening apply. Dispatch HEAD `0a58414` contains only the approval
documentation after runtime source `084cb5a`; workflow, tooling and infrastructure
were unchanged. Actual result: **0 added / 4 changed / 0 destroyed**, with
**0 replacements** and the full-runtime configuration guard passing. Plan
creation and one-shot migrator execution were skipped.

Single read-only verification
[38122313367 PASS](https://github.com/mufazzalshokh/lead-agent-platform/actions/runs/38122313367)
completed `2026-10-11T07:44:00Z`. Authenticated sanitized artifact
`11695452839`, `s22-api-image-live-evidence-38122313367`, independently collected
**16/16 PASS**: exact API source/image/timestamp/migration provenance, API/Web
images and ready revisions, API identity/private VPC/subnet/egress, 15 secret
references and whole-runtime Terraform convergence **exit 0**. Ready revisions:
**lead-agent-staging-api-00030-rr8** and **lead-agent-staging-web-00026-gp8**.
Worker/Migrator desired bindings are covered by refreshed whole-runtime
convergence rather than separate direct revision assertions. The verification
created no saved deployment plan, apply, database diagnostic or migration.

Public reads confirmed API `/health` reports `api` / `ok`; the served loader
exactly equals the reviewed `buildWidgetLoader` output, SHA256
`9174e16a48d3bb1620d20e8854a774f78daac22d5d917b8ea7744cc2f7eaea0a`.
Its sandbox remains `allow-scripts allow-same-origin`. Reading the staff entry
and its eight public script assets found the Copied feedback and clipboard
handler in exactly one bundle. These are public asset checks, not authenticated
clipboard interaction or a rendered real customer frame. No grant/frame/session,
message or model endpoint was called. The local Node Web connection timed out;
one bounded IPv4 curl alternative completed these Web checks.

No customer test authority was transferred. The previous selected session's
recorded idle deadline was 12:23 Asia/Tashkent; deployment completed at 12:42.
Current database eligibility was not reread. The next acceptance item is one
fresh eligible, owner-confirmed Website Chat booking journey, with separate
session-specific paid approval before Send and unchanged budget limits.

## Change and scope

The owner's browser confirmed that the sandbox blocked native form submission
before the arrow reached the message handler. The correction uses a normal button
and its explicit JavaScript click handler, retains the sandbox/CSP, and guards
concurrent arrow, Enter and Retry actions. Composer text uses the UI font at 16px;
the input grows from 52px to 160px, then scrolls without displacing the conversation.
The copy button acknowledges success only after the clipboard write resolves.

Source comparison against deployed `c687dcf` contains three Web implementation
files, regression tests and S22 documentation only. No API, Worker, database,
infrastructure or workflow implementation changed. The existing release workflow
builds a coherent four-image bundle, so all four workloads receive updated image
and source/timestamp provenance without changing their other configuration.

## Exact provenance

| Field                          | Reviewed value                                                                                    |
| ------------------------------ | ------------------------------------------------------------------------------------------------- |
| Branch                         | `verify/s22-staging-recovery-capacity`                                                            |
| Runtime, build and plan source | `084cb5a4cf719092345ae336fd6f01554258ae46`                                                        |
| Source CI                      | [38121100842 PASS](https://github.com/mufazzalshokh/lead-agent-platform/actions/runs/38121100842) |
| Immutable image build          | [38121367839 PASS](https://github.com/mufazzalshokh/lead-agent-platform/actions/runs/38121367839) |
| Saved plan                     | [38121689049 PASS](https://github.com/mufazzalshokh/lead-agent-platform/actions/runs/38121689049) |
| Project and region             | `lead-agent-stg-739284` / `me-central1`                                                           |
| Deployment timestamp           | `2026-10-11T07:31:30Z` (12:31:30 Asia/Tashkent)                                                   |
| Migration provenance           | `0031_s22_widget_inbound_route_management`, unchanged                                             |
| Saved-plan SHA256              | `7e17a4da491de83471b56e23cca2a217b53d8111bb3aefbaf02f1392ec115eee`                                |
| Image-manifest SHA256          | `b26ea9d96d3af4a328c415ca0b6f2466fb7b7c6b1e09861eeeebde30ae7800b5`                                |
| Plan-captured state lineage    | `ad1c3000-d52f-06eb-de1b-53ae4d67f63e`                                                            |
| Plan-captured state serial     | `68`                                                                                              |

Authenticated artifacts:

- Build artifact `11695906359`,
  `s22-image-manifest-084cb5a4cf719092345ae336fd6f01554258ae46-38121367839`.
- Plan artifact `11694784963`,
  `s22-terraform-plan-full-084cb5a4cf719092345ae336fd6f01554258ae46`.
  It contains the binary saved plan, checksum and sanitized safety evidence.

The build checked out the exact source, built with that commit's `GIT_SHA`,
enabled OCI provenance/SBOM and verified every digest's `linux/amd64` image.
All build/manifest steps passed. The downloaded manifest and saved binary were
independently hashed; the binary matches its recorded checksum. Artifacts and raw
plan/state JSON are not committed or printed. The embedded state supplied only
the lineage/serial above, not a later read of the backend state.

## Exact planned actions

**0 creates / 4 in-place updates / 0 destroys / 0 replacements.**

| Resource                                    | Action | Permitted changes                                   |
| ------------------------------------------- | ------ | --------------------------------------------------- |
| `google_cloud_run_v2_service.api[0]`        | update | Image and source/timestamp provenance               |
| `google_cloud_run_v2_service.web[0]`        | update | Image and source/timestamp provenance               |
| `google_cloud_run_v2_worker_pool.worker[0]` | update | Image and source/timestamp provenance               |
| `google_cloud_run_v2_job.migrator[0]`       | update | Image and source/timestamp provenance; no execution |

Workflow safety checks and independent local inspection both **PASS**. The
installed Terraform 1.14.7 and locked Google provider 7.46.1 were reused in an
existing backend-free inspection directory. The repository's
`verifyFullRuntimeConfiguration` checked **88 managed resource configurations**,
with no configurable unknowns or unreviewed changes. Additional comparisons
matched all four before-images to the last reviewed rollout, and all after-images
to the new manifest, exact source, timestamp and unchanged migration provenance.

Before-provenance is `c687dcfb82da64a26d981d793d1611d44c49c593` /
`2026-10-09T15:43:53Z`. This match comes from the refreshed saved plan, not merely
from historical deployment success. No SQL, IAM, networking, identity, secret
reference, command, retry, scaling or resource-limit change is planned. Private
VPC/egress and migrator zero retries remain intact.

Refresh recorded Artifact Registry `update_time` and Cloud SQL
`settings.0.version` differences. Independent provider-schema inspection
classifies both as **computed-only**; both resources have planned action `no-op`.
They are not extra updates or configurable drift.

During plan preparation, `Create reviewed plan`, `Verify full runtime plan safety` and `Upload exact reviewed
plan` passed. `Apply exact reviewed plan` and `Execute one-shot migrator` were
**SKIPPED**; booking evidence and inventory jobs were also skipped. There was no
database diagnostic, session mutation or paid customer execution.

## Preserved test boundary

Mode remains `widget_booking`. The before/after deployment envelope anchor is
`01a11c48-dbc2-76de-a873-f41664da5ccb`; request mode `preserve` was resolved from
authoritative Terraform state. This is not a fresh browser session or a renewal.
Owner selection remains a separate authenticated and audited post-deployment
action. No selection, ledger counter or session lifetime is reset by this plan.

The existing allowance remains two total Widget inbound messages including
confirmation, four physical attempts and at most two attempts per message.
Per-call reserve USD0.801432, Widget allowance USD3.205728, combined planning
exposure USD4.247838, historical budget-only reserve USD1.033396, USD5 target and
USD10 ceiling are unchanged. Historical NULL costs remain unknown.

The latest owner screenshot reported known cost USD0.008714, reserved exposure
USD1.042110 and no pending reserve. That snapshot is not a new ledger read.
The owner's October 11 paid approval was specific to the 11:53 selected session;
this rollout does not transfer that authority or renew its lifetime. Unknown cost,
pending reserve, timeout, exhaustion or any guard failure still blocks dispatch.

## Verification and proof limits

Exact-source CI **38121100842 PASS** completed clean-checkout `pnpm ci:verify`,
including formatting/lint, boundaries/contracts, TypeScript, ordinary and real
PostgreSQL test gates, and production builds. Its completed result is reused,
not rerun for this preparation.

Focused source verification is **124/124 PASS**, including generated client,
frame bootstrap, product UX and gateway regression coverage. Five opt-in real
headless Edge scenarios passed with synthetic APIs: arrow, phone layout,
keyboard/composition, same-request retry and expired-session refusal. The original
arrow behavior failed the browser test before the correction. Copy feedback has
its previously recorded local verification. Exact commands and failure mechanism
are in the [investigation record](s22-acceptance-evidence.md#2026-10-11---website-chat-arrow-blocked-before-the-send-handler).

These are source/CI/build/plan proofs. They do not establish deployed readiness,
live customer message persistence, provider completion, booking confirmation,
delivery or exact historical accounting. No new application tests or migrations
were added in this plan-preparation milestone.

## Recorded inputs for the approved apply

Workflow `staging-terraform.yml`, ref `verify/s22-staging-recovery-capacity`.
The approval acknowledgement is deliberately absent from this recorded packet.
It was supplied to the apply only after the owner's exact approval. The saved
plan is consumed; these inputs are retained as evidence and must not be rerun.

```json
{
  "action": "apply",
  "phase": "full",
  "commit_sha": "084cb5a4cf719092345ae336fd6f01554258ae46",
  "deployment_timestamp": "2026-10-11T07:31:30Z",
  "api_image": "me-central1-docker.pkg.dev/lead-agent-stg-739284/lead-agent/api@sha256:f628ade5f098cd7598a24048c6d5bb20b5561f753a669560782ab07f694643d1",
  "web_image": "me-central1-docker.pkg.dev/lead-agent-stg-739284/lead-agent/web@sha256:c3bfd8d40bf8aca72444d2c414952253b7b09d4bc97e0747dea3b3bb1b34d80d",
  "worker_image": "me-central1-docker.pkg.dev/lead-agent-stg-739284/lead-agent/worker@sha256:5b3dae488226bf5722036c8fe196b4e431f182ed3e9005776fd329342c07e076",
  "migrator_image": "me-central1-docker.pkg.dev/lead-agent-stg-739284/lead-agent/migrator@sha256:e052bc49776ea738c390937e7d1ba5ead78239dad8837989c28c32ca8c436c19",
  "api_migration_head": "0031_s22_widget_inbound_route_management",
  "runtime_migration_head": "0031_s22_widget_inbound_route_management",
  "ai_journey_mode": "preserve",
  "ai_journey_widget_session_id": "01a11c48-dbc2-76de-a873-f41664da5ccb",
  "plan_run_id": "38121689049",
  "approved_plan_sha256": "7e17a4da491de83471b56e23cca2a217b53d8111bb3aefbaf02f1392ec115eee"
}
```

## Approval and next step

The exact owner approval has been fulfilled and the runtime verification passed.
Artifact checksum and workflow history were checked before dispatch; Terraform's
state lock and stale-plan lineage/serial guard remained enabled. No replacement
plan or rebuild was made. Do not apply this consumed plan again.

Next: prepare one fresh eligible test session and confirm its exact owner
selection before a separately approved bounded booking journey. Source tests,
deployment and runtime readiness do not replace customer Send, persistence,
reply, staff acceptance, customer confirmation and delivery evidence. If those
checks fail, trace the first failed boundary before another attempt. Rollback
would require a newly reviewed plan.
