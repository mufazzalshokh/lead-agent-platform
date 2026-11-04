# S22 bounded connection-fault exercise preparation

Status: **DEFAULT-OFF TOOLING WIRED; LIVE PREPARATION NOT AUTHORIZED;
NO LIVE AUTHORITY**. This is not a saved Terraform rollout plan. There is no
real exercise ID, session digest, UTC window, configuration-plan ID or approved
activation checksum yet. Do not invent those values or start session setup.

The [mechanism](s22-connection-fault-plan.md) is implemented and
[deployed default-off](s22-connection-fault-code-rollout-plan.md). This packet
specifies the remaining tooling/authority/evidence boundary for C2 in the
[completion checklist](s22-completion-checklist.md); it closes no live gate.

## Fixed deployed baseline

Target is `lead-agent-stg-739284` / `me-central1` /
`google_cloud_run_v2_service.api[0]` (`lead-agent-staging-api`).
API source is `7a4201c824be3db2396b51c14d62e6758f43e860`, image
`me-central1-docker.pkg.dev/lead-agent-stg-739284/lead-agent/api@sha256:624e2d17ca48394af37bd70ac305e9b3104712afe25c83b3f3e2449711e2e2b9`,
provenance timestamp `2026-10-31T18:20:23Z`. Web/worker/migrator retain source
`abc3071fb81777068f5adfb98f6144d9081077eb`, timestamp `2026-10-11T20:27:12Z`
and their immutable pins from the consumed deployment packet. All migration heads
remain `0032_s22_widget_recovery`; inventory is 88 managed resources.

No application image rebuild is needed for this configuration-only exercise.
If fresh state differs, stop and review the difference; do not edit the baseline
to make a check pass. Consumed plans `41228923359`, `39650372329` and historical
application plans must not be reused. Rejected SQL-stop/watchdog adapters remain
unavailable for live use; do not add SQL Admin permissions or provision them.

## One immutable private profile — not populated during preparation

Use exactly the deployed loader's ten keys:
`version`, `exerciseId`, `projectId`, `region`, `service`, `sourceSha`,
`sessionDigest`, `baselineAt`, `faultAt`, `expiresAt`.
`version=1`; exercise ID is a fresh UUIDv4; source/target match the fixed baseline.
The session digest is SHA256 of the exact authenticated application-session ID,
not a cookie/token or tenant identifier. Unknown keys and profiles over 2 KiB
are denied. UTC strings include milliseconds and a final `Z`.

Let `B=baselineAt`, `S=faultAt=B+90 seconds`, `E=expiresAt=S+360 seconds`.
The loader must initialize **before B**, with B no more than one hour away.
Prepare/test all tooling and confirm the private delivery/authority path before
choosing real times or making the single setup request. A late startup/apply is
NOT_ADMITTED, not permission to shift B, refresh a session or retry the run.
Do not assume Cloud Run is sticky or that a prepared plan keeps an instance warm.

Proposed delivery avoids the workflow's 25-input ceiling: one staging-environment
Actions secret, `S22_CONNECTION_FAULT_PROFILE`, containing the fixed profile,
read only by the new scoped profile steps in the existing Terraform workflow.
It is **not created or changed by this preparation**. Verify owner/API write
authority before use; do not expand OAuth scopes or WIF/IAM automatically.
Use stdin rather than a command-line body, source file, chat or screenshot.
The installed `gh secret set --env` supports this delivery; GitHub documents
[environment secret access](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets).
Do not add another workflow input, overload a historical diagnostic input, create
a different WIF-trusted workflow or expose the profile through step outputs.
Do not rely on whole-string secret masking to hide parsed fields: no raw profile,
session digest, partial JSON or parser exception may be printed. Mask derived
private values before any tool can emit them and test finite error/receipt output.

Treat the profile as private correlation configuration, not an authentication
credential. Protect its digest/window from logs and ordinary summaries; retain
only the profile hash/exercise correlation in finite evidence. Freeze the same
profile through planning/apply/exercise/removal; mutation or hash mismatch stops
the workflow. Separate exact-plan checksum approval remains mandatory.
Use a sensitive Terraform value and a separate non-secret enable selector;
never declassify the profile or iterate over sensitive values to form resource
keys. Sensitive values still exist in plan/state and control-plane environment:
[Terraform sensitivity is redaction, not storage omission](https://developer.hashicorp.com/terraform/language/manage-sensitive-data).
Keep actual profiles and raw plans out of Git/chat; use the existing private
backend/artifact access and retention. Removal does not erase historical copies.

## Narrow enable/remove guard specification

Add separate phase choices to the existing `phase` input, not new inputs or a
new workflow trust path. The historical code/monitoring/SQL-stop guards retain
their original behavior. Implement a dedicated profile guard with explicit
enable and remove modes; the current default-off code guard must continue to
reject any profile. Do not reinterpret its consumed binary as activation authority.

Enable permits only one in-place API update adding these three existing-process
environment names:

- `S22_CONNECTION_FAULT_PROFILE`: the exact fixed validated private JSON.
- `GOOGLE_CLOUD_PROJECT`: `lead-agent-stg-739284`.
- `GOOGLE_CLOUD_REGION`: `me-central1`.

`K_SERVICE` remains Cloud Run's own metadata, not a new user-supplied env entry.
Bind declarations to actual resource project/location/name and immutable image;
env equality alone is not Google identity proof. Preserve `APP_ENV=production`,
`DEPLOYMENT_ENVIRONMENT=staging`, all image/provenance/label/head values, every
other environment/secret reference, service identity, VPC, commands, probes,
scaling, concurrency, resources, SQL, worker/AI binding, monitoring and money caps.

Both full inventories must contain the same 88 addresses. Reuse provider-schema
configuration comparison, rejecting configurable unknowns/drift, moved/duplicate
addresses, partial/targeted plans, create/delete/replacement and unrelated data
reads. Require authenticated source/plan provenance, immutable profile hash,
actual binary SHA256 against exact approval, and zero-change convergence after
apply. Do not accept a mutable Actions secret as a substitute for the saved binary.

Removal permits only those same three names to be removed from the exact
approved profile state, preserving the new API image and all other settings.
Bind the before-profile to the retained activation receipt/hash; do not require
an expired profile to pass the loader's startup-time admission test. Use a fresh
reviewed removal plan and applicable exact-plan approval. Expiry stops cuts
independently of configuration removal. Remove private delivery configuration
only after the authorized cleanup is verified; do not reset accounting/history.

## Bounded browser controller specification

Use the existing staff tab on the authoritative same-origin Web gateway, not
the customer Widget frame, a Cloud Shell HTTP client or an exported cookie.
The only request path is `GET /v1/staff/auth/session`, with normal browser
credentials and existing Fetch Metadata/envelope checks. Its resolver can update
security metadata/last-seen state: live authority must acknowledge those writes.
No customer message, AI call, booking action, arbitrary URL/method, SQL or provider
fault is permitted. The old SQL-stop controller is not a browser controller.

One normal setup GET, before enabling, computes the session digest locally and
discards the response/raw ID. Never read an HttpOnly cookie or export a bearer.
Check absolute/idle expiry from the normal response; it does not expose a
rotation deadline, so do not claim it guarantees a stable credential horizon.
The server rejects rotation-due baseline sessions; the controller must stop on
retired/missing metadata or changed session binding, including rotation during
the exercise. Do not add polling, read cookies or infer rotation time from an ID.
Missing readiness is a stop, not another fresh-session loop.

The tagged stream uses exactly `x-s22-connection-fault` with deployed wire format
`exerciseId:sequence:nonce:read`; sequence 1 supplies `-` for nonce. Parse only
bounded exact metadata, discard bodies, and keep nonce ephemeral. Reuse the same
nonce after sequence 1; any missing/changed context, rotation, source or phase
disagreement ends the run. HTTP 200/500 alone is not sufficient evidence.

| Class         | Max GETs | Actual sequence / schedule                                                                                        |
| ------------- | -------- | ----------------------------------------------------------------------------------------------------------------- |
| Binding setup | 1        | Normal path before enabling; local digest only                                                                    |
| Baseline      | 4        | 1–4 at B, B+15, B+30, B+45 seconds; fourth must report admitted                                                   |
| Fault         | 23       | 5–27 at S through S+330, every 15 seconds; matching transport-cut evidence                                        |
| Recovery      | 16       | 28–43 at E through E+450, every 30 seconds; stop after two consecutive healthy resolutions and recovered metadata |
| Total         | 44       | One request in flight, deadline ≤15 seconds; failed/ambiguous/abort requests consume slots                        |

Anchor to the absolute schedule; no catch-up, overlapping fetch, retry, new nonce,
rearm, window extension or replacement run. Background timer delay, clock skew,
restart/cold start, malformed/oversized metadata, wrong session or deadline miss
must stop rather than manufacture fault responses. The deployed server enforces
a 2-second margin and at least 15 seconds left before a new cut; preserve it.
Retain the design's outer recovery bound E+600 seconds; the fixed slot allocation
is tighter and must not be stretched to fill that bound.

An abort uses `:abort` in an unused scheduled slot and normal resolution; no
extra 45th request. Stop local fault requests even if its response is lost.
Do not claim browser cancellation proves a database operation was cancelled.
If no scheduled abort slot remains, expiry/default-normal behavior remains the
safety mechanism; do not improvise an extra request. New processes cannot inherit
admission. No arbitrary pause/resume feature is introduced.

## Evidence and finite observation budget

Require sanitized server transport receipts, same-process four-read admission,
actual connection-cut failures and two real normal-path recovery reads. Keep
UTC/duration, exercise/profile/source hashes, phase/sequence, intended-cut flag,
finite counts and conclusion. Do not retain cookies, raw session IDs, response
bodies, full headers, SQL, addresses, message content or credentials.

The existing `.github/scripts/s22-monitoring-evidence.mjs` validates the unchanged
policy/target, not an old API image; reuse it unchanged if its checks still match.
Do not run the historical `monitoring-policy` plan guard or rebuild old image-
pinned diagnostics. For this exercise allow at most two monitoring-reader runs
(≤11 GETs each), plus one matching incident/inbox inspection by the existing
recipient owner. One channel was observed historically; revalidate, do not assume
it remains unchanged or add an automatic grant/channel-test notification.

Read after metric visibility delay so the fixed ten-minute window covers the
fault interval; the existing reader ends its window two minutes before observation.
Choose those observation times once in the future authority packet. Missing
buckets remain unknown, not zero. The collector deliberately reports
`sustained_condition_proven=false` and `notification_delivery_proven=false`:
attach separate actual incident/evaluation and recipient observations instead
of editing those fields to true. The unchanged threshold is >1% for 300 seconds;
23 client failures do not guarantee incident creation or email receipt.

Grade connection failure/recovery and alert delivery separately. No incident or
receipt means that alert gate stays open; do not manufacture traffic, lower the
threshold, trigger a test email or automatically repeat the exercise. Transaction
rollback, full Cloud SQL outage, worker/channel drain, PITR and capacity remain
separate evidence, even if every probe and email succeeds.

## Readiness and implementation gates — before any real binding

1. Offline-implement the narrow Terraform/profile phases and guard plus the
   bounded browser controller. No real profile/secret/window or cloud dispatch.
2. Test enable/remove complete-config preservation, profile/runtime parity,
   source/image/target/head mismatches, secret changes, expired/late schedules,
   configurable unknowns/drift, duplicates/replacements/partial inventories and
   saved-plan/checksum/provenance authority. Keep all historical guard regressions.
3. Controller fixtures must prove the 44-request cap, exact slots, no retry or
   catch-up, 4/23/16 maxima, one in flight, strict nonce/metadata, rotation, abort,
   cold start/restart, clock drift, delayed callbacks, missing responses and finite
   cleanup. Fixtures are not live evidence. Require focused checks and one full
   exact-tooling CI; no application rebuild unless an actual app defect is found.
4. Only with later authority, confirm the private delivery path, quiet window,
   operator/browser availability, normal session/clock and no-dispatch readiness.
   Make one setup GET, freeze the exact profile/window and prepare the saved
   configuration plan. No real binding now, and no silent baseline substitution.
5. Obtain exact activation-plan approval and live authority naming setup/security
   writes, fixed window, the 44-GET cap, actual notification observation and stop
   rules. Apply/inspect once before B; no fault traffic while readiness is uncertain.
6. Run once, grade finite evidence, verify expiry/normal recovery, then separately
   review/apply removal and confirm zero-change convergence. Preserve all failed
   or inconclusive execution IDs. Do not call S22 complete from this one gate.

## Offline implementation checkpoint — 1 November 2026

Historical checkpoint; the wiring status below is superseded by the
[2 November checkpoint](#default-off-workflow-wiring--2-november-2026).

The following are inert libraries, not a workflow dispatch path or customer UI:

- `.github/scripts/s22-connection-fault-profile.mjs`: exact compact ten-key
  validation, structural versus startup-time admission, fixed slots and deployed
  normalized profile representation. Compact JSON is deliberately stricter than
  the loader: duplicate keys and whitespace are denied during preparation.
- `.github/scripts/s22-connection-fault-profile-plan-check.mjs`: dedicated
  enable/remove and convergence verifiers. Both complete inventories and their
  configuration values must match all 88 resource changes; provider-schema
  projection preserves every unrelated configurable value. The current mixed
  image/source baseline is fixed; the historical code guard remains unchanged.
  The artifact helper checks actual binary bytes, exact checksum approval and
  supplied authenticated Actions run metadata. It does not authenticate a JSON
  object itself: the future workflow must fetch provenance through its existing
  authenticated API and independently inspect the same binary with Terraform.
- `.github/scripts/s22-connection-fault-browser.mjs`: explicit setup/run methods,
  fixed authoritative top-level `/staff` browser context and GET path, ordinary
  credentials, bounded body/header parsing, absolute slots and local deadlines,
  one in flight, no retry/catch-up, finite stop/abort and no storage or logging.
  It is not served to a browser or auto-executed. Do not paste/run it yet.

The future Terraform contract is a non-sensitive selector
`s22_connection_fault_enabled` plus sensitive `s22_connection_fault_profile`.
Those variables and workflow phases do **not yet exist**. The verifier currently
expects their raw plan-variable inputs as strings, like the retained real plan;
the wiring milestone must test actual Terraform-generated enable/remove plans
and sensitivity, not infer the final encoding from fixtures. No sensitive value
may become a `for_each` key.

Receipts distinguish `configuration_sha256` (exact raw JSON) from
`runtime_profile_sha256` (the deployed loader's normalized object hash). They are
not interchangeable. Removal takes the retained four-field profile-identity
receipt, not an expired startup admission. Browser metadata contains no source
or cut flag; browser observations therefore always retain
`transport_cut_proven=false` and `notification_delivery_proven=false`. Deployment
provenance and matching sanitized server transport receipts are still required.

Offline fixtures cover both verifiers, the deployed loader/admission contract,
44-GET ceiling, exact timing, nonce/session changes, late callbacks, clock skew,
timeouts, overlap prevention and lost abort responses. A locally transformed
historical plan with the locked real provider schema also passes enable/remove
preservation (88 configurations, one synthetic change each). That is format
compatibility only, not a fresh saved plan or live evidence.

Progress within C2 tooling: **2 of 3 implementation substeps are implemented**
(guard libraries; browser controller). The third is safe Terraform/workflow
wiring with regression/full-CI verification. All **eight acceptance gate groups
remain open**; no live profile, secret, setup GET, activation, fault, notification,
AI/provider request or deployment was made by this implementation.

## Default-off workflow wiring — 2 November 2026

All **three C2 tooling implementation substeps are implemented**: profile guards,
bounded browser controller, and Terraform/workflow wiring. Eight acceptance gate
groups remain open. Exact-source CI must pass before any later live preparation;
local fixtures do not replace that check or create live authority.

The existing `staging-terraform.yml` now has `connection-fault-enable` and
`connection-fault-remove` phase choices, still **25 dispatch inputs**, using the
same staging environment/WIF path. No new trust path or IAM permission is added.
The historical code/monitoring guards retain their original semantics. API source,
timestamp and immutable digest stay at the fixed deployed baseline; no new image
build is performed. Generic plan/apply and application-release summaries exclude
the two new phases.

Terraform defines `s22_connection_fault_enabled=false` and an empty sensitive
`s22_connection_fault_profile`. Only the non-sensitive selector controls three
constant environment keys; the raw profile never becomes an iteration key.
Actual TF_VAR input encoding was checked in an isolated built-in-provider fixture.
The real module's mock-provider tests check default-off, enable, removal,
convergence, sensitivity and invalid combinations. The generated plans pass the
same guard: **88/0, 88/1, 88/1, 88/0** configurations/changes. Mock state is not a
saved deployment binary or evidence that Google accepted a live configuration.
See HashiCorp's [mock-provider contract](https://developer.hashicorp.com/terraform/language/tests/mocking).
CI initializes with `-backend=false`, without Google authentication or secrets.

`.github/scripts/s22-connection-fault-profile-workflow.mjs` is the narrow adapter:
it validates the exact dispatch/workflow/source, private repository, successful
source CI and the retained deployed API build before Google authentication.
The existing build artifact must remain available; expiry/missing provenance
stops preparation, not triggers an automatic rebuild. Only three phase-scoped
steps receive `secrets.S22_CONNECTION_FAULT_PROFILE`; no private value is written
to GITHUB_ENV, step outputs or summaries. The Terraform output wrapper is disabled
for these phases, and raw child diagnostics are captured rather than printed.
Failures report a finite stage/exit code, not private parser/provider fragments.
A finite per-run profile-hash receipt rejects a change between steps.

Later removal also needs a **non-secret staging environment variable**
`S22_CONNECTION_FAULT_ACTIVATION_RUN_ID`, pointing to the retained activation
apply run. Neither this variable nor the private secret was created or changed
here. Their owner/API write authority must be confirmed in the future preparation
packet, without scope expansion. The same exact tooling commit must be frozen
through activation and removal. The authenticated activation artifact must bind
its profile hashes, source, apply ID and original approved plan checksum.

The adapter preserves a finite `attempted` receipt before apply and an `applied`
receipt before convergence. Failed/cancelled/timed-out activation can therefore
be referenced for cleanup without calling it successful. Removal still requires
a fresh complete plan proving that its actual before-profile matches exactly,
followed by separate exact-plan approval. A missing attempt artifact, different
profile or unreviewed drift stops for investigation. A `verify` receipt requires
successful full 88-resource no-op convergence. Expiry stops cuts independently;
no cleanup path rearms or extends the exercise.

Plan artifacts retain the exact binary, checksum and finite profile receipt;
apply artifacts retain only the finite attempt/convergence receipt for seven
days. No live exercise, browser GET, notification observation, provider call,
migration, budget change or deployment occurred during implementation. Delivery
configuration is removed only after separately authorized verified cleanup;
historical plan/state copies and accounting are not erased.

Next is the bounded **live-preparation authority/readiness packet** in gates 4–5:
private delivery permissions, quiet window, operator/browser availability and
the single setup GET/security writes must be explicitly in scope before choosing
a real session/window or preparing the first saved activation plan. This document
itself authorizes none of those actions.
