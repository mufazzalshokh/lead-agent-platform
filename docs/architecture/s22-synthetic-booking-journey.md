# S22 synthetic knowledge and customer-to-confirmed-booking journey

## Scope and evidence boundary

This is a fictional staging fixture, not a real clinic, price offer or appointment
availability claim. S22 is **not accepted**. Use only organization
`01a0ee39-91a9-7293-82c0-5b7046c10115` and owner-approved synthetic conversations.
Preserve unrelated tenant records and unknown social-thread privacy eligibility.
The already-tested synthetic Instagram conversation is
`01a1067f-d7d8-7e7e-9fb0-39bfe2f7cdc7`; its prior handoff is resolved/4 and it is
open/12 in AI mode according to the scoped owner-supplied live diagnostic. Do not
repeat the earlier Claim/Resolve actions.

## Fixture facts

Source: [s22-test-clinic.json](../../tests/fixtures/s22-test-clinic.json),
`fixture_id=s22-test-clinic.v1`. Its wrapper and reference-binding instructions are
local test metadata, **not a new public contract**. Submit only each existing
contract payload, after binding the actual returned fixture resource IDs.

Live tenant-authorized publication and exact read-back completed on **2026-10-05**.
The initial authenticated configuration inventory was empty in all five categories;
no unrelated business records were modified. All localized fixture payloads match
their published snapshots, and the offering is active. These are **live API**
results, not fixture-test results.

| Resource | Live ID | Root / publication version | Publication hash / evidence |
| --- | --- | --- | --- |
| Location | `01a10b7c-e2de-7ad1-9201-8fcbe669c396` | 2 / 1 | `9997ad159817ff72f1318d89e04f0db63c432923090816c2c5760feefe20b0c0`; read `request:req-3z` |
| Service | `01a10b7c-e74c-7f75-b8ad-0532729b45db` | 4 / 1 | `67a0504549d100df66782292c40432126c923f70797496969e7ce1c8c2829f83`; read `request:req-3y` |
| Price | `01a10b7e-0da0-7101-bcfb-a157247d27ee` | 1 / 1 | Published `2026-10-05T09:56:13.381Z`; read `request:req-3w`; no hash field in this public contract |
| Qualification V1 | `01a10b7e-10db-74c7-8a74-d028f211fd3b` | 1 / 1 | `83313b04cf9e0504dd3f9e3281d1e98ca47f5f3a29a6678b39af454d5474fe23`; read `request:req-3x` |
| Scoped FAQ | `01a10b7e-14a6-7b8f-8d2c-48777be8f0f4` | 1 / 1 | `d2b6c28bad4731d6dfe935c8124dcbe982e1cd3ab80b52e105d06b5964f9f53a`; read `request:req-3v` |

The Service root's version 4 reflects offering/price mutations; it is not a
fourth content publication. No aggregate knowledge version is claimed.

| Fact | Synthetic value |
| --- | --- |
| Location | S22 Test Clinic; code `s22-test-clinic`; no real address/contact/domain |
| Service | S22 sinov konsultatsiyasi / S22 тестовая консультация / S22 Test Consultation; code `s22-test-consultation` |
| Languages | Uzbek Latin, Russian and English localized content |
| Duration | 30 minutes |
| Test price | UZS 100,000; `amount_minor=10000000`, `currency=UZS`, fixed; bind to the fixture location |
| Hours | Monday–Saturday 09:00–18:00, `Asia/Tashkent`; Sunday explicitly closed in the scoped FAQ |
| Booking | Staff review first, then explicit customer confirmation; staff acceptance alone is not confirmation |
| Availability | No slot inventory or guarantee; opening hours are not appointment availability |
| Clinical guidance | None; synthetic consultation does not authorize medical advice |

Qualification V1 is provenance, not a configurable booking policy. Creation
authority remains the fixed `s16_appointment_submission.v1`, with tenant context,
published service/location/price/duration/hours, customer-provided valid preference,
bound contactability, current-state and idempotency checks. No mandatory phone,
budget or medical eligibility requirement is introduced. S18 confirmation and
expiry rules remain unchanged. Do not reinterpret historical requests.

## Authorized inspection and publication

Use the owner's native authenticated browser session at the existing
organization-bound staff workspace. Credentials and CSRF values stay in-browser.
The browser request includes `x-organization-context`; the API authorizes the active
membership server-side. Mutations require the existing CSRF proof, fresh
`If-Match` and unique `Idempotency-Key`. Never write SQL or manually patch records.

1. Read `/v1/staff/me`, then paginated `/v1/staff/locations`, `/v1/staff/services`,
   `/v1/staff/prices`, `/v1/staff/faqs`, and `/v1/staff/business-policies` through
   their actual supported filters. Record only fixture IDs, status, versions,
   publication hashes and safe metadata; do not export unrelated content or users.
2. Detect exact fixture codes/keys before creating anything. Reuse an identical
   verified fixture; stop on conflicting content instead of overwriting it. Read
   existing Qualification V1 policies. Reuse the unique suitable published policy;
   create/publish the fixture policy **only if none exists**. More than one
   applicable policy is ambiguous; do not retire unrelated policies to force a pass.
3. `POST /v1/staff/locations`, then `POST /v1/staff/locations/{id}/publish` with
   the fixture payload and current ETag.
4. `POST /v1/staff/services`, then `POST /v1/staff/services/{id}/publish`.
5. `PUT /v1/staff/services/{id}/locations`, binding the fixture location and
   `status=active`. Re-read the service and ETag after each mutation.
6. `POST /v1/staff/services/{id}/prices` with the location-bound fixture price,
   then `POST /v1/staff/prices/{price_id}/publish` with `{}` and the price ETag.
7. If required by step 2, `POST /v1/staff/business-policies`, then
   `POST /v1/staff/business-policies/{policy_id}/publish` with `{}`.
8. `POST /v1/staff/faqs` with **both** returned fixture service/location IDs,
   then `POST /v1/staff/faqs/{faq_id}/publish` with `{}`.
9. Read the exact resources again. Verify active/published snapshots, offering,
   price and policy. Record each immutable publication version/hash separately;
   do not invent an aggregate knowledge revision or an unsupported HTTP reader.

The existing pipeline uses `createConversationKnowledgeReader` and
`readConversationPublishedKnowledge` within a `TenantDbSession`, selecting current
published facts for the conversation/Lead context and supported locale. Source
inspection proves that path exists; publication GETs alone do **not** prove this
specific live conversation retrieved the fixture. Capture that proof from the
subsequent grounded answer and authorized provenance/state reads.

## Model and cost readiness

### First paid turn: terminal policy denial, rollout complete; journey pending

The first authorized price/duration message was persisted on 2026-10-05 at
17:23:28.698Z, but its schema-valid Gemini handoff proposal was rejected and the
old terminal fallback silently suppressed the inbound. The existing read-only
execution `lead-agent-staging-migrator-mqfd8` supplies the persisted proof in the
[evidence register](s22-acceptance-evidence.md#first-turn-root-cause-proven-from-the-existing-execution).
Recorded cost is USD0.001950; one of the three messages and six physical slots is
consumed. Do not refund, replay or resend it. Historical NULL costs remain NULL.

The focused application fix retains the model denial and uses only the existing
deterministic policy-blocked staff fallback, with correlated disposition metadata.
It does not manufacture a grounded answer, request, staff acceptance or customer
confirmation for this old turn. Further paid customer messages stay paused until
current conversation/cohort readiness is checked and the remaining bounded journey can
proceed with current authoritative state. Staff acceptance is still not booking
confirmation. No additional paid allowance is approved by this correction.

Focused fix source `da9d609b4831d041aef71b271cc6994b3df74cf8` is pushed.
Fresh four-image build **37358285290 PASS** and full-runtime plan
**37359246514 PASS**, with exactly four in-place image/provenance updates and
no create/destroy/replacement, SQL, IAM, network, scaling or migration execution.
Saved-plan SHA256:
`dc4613637939f7857dfc28e6169190bf4c525bb8eebec6f7d226f8de620ca3a4`.
Timestamp `2026-10-05T18:46:33Z`; migration head remains
`0031_s22_widget_inbound_route_management`. The
[exact rollout packet](s22-acceptance-evidence.md#rejected-proposal-fallback-exact-rollout-approval-packet)
contains immutable references, inspected safeguards and prepared apply inputs.
This packet was prepared before owner approval. The owner subsequently approved
it: exact saved-plan **apply 37360464046 PASS**, actual **0 added / 4 changed /
0 destroyed**, no replacements or migration execution. Existing read-only
**verification 37360711370 PASS**, whole-runtime convergence exit 0, exact API/Web
image bindings and API source/timestamp/head, ready revisions, API `/health` and
Web `/staff` HTTP 200. Worker/Migrator binding is corroborated by whole-runtime
refresh/convergence, not separate direct assertion artifacts. No paid call or
customer event was replayed. Retain the first-turn cost and original historical
NULLs. Next check current conversation/cohort readiness before the second
already-authorized paid message; live booking and S22 acceptance are still pending.

The source-approved Commercial V1 profile is Gemini API `gemini-3.8-flash`, paid
tier, low thinking, stateless `AgentDecision.v1` structured JSON, maximum output
4,000 tokens. Deterministic policy is authoritative; no generic tools, provider
conversation state or silent OpenAI fallback. Runtime Terraform sets provider
`gemini`, this model and a 15,000 ms request deadline. This source evidence is
not a fresh live resolved-model or paid-account entitlement observation.

S22's approved small live cohort has USD 5 target / USD 10 hard ceiling. Load tests
use fake AI. The existing S20 machinery persists provider-reported token units,
resolved model, cost-catalog version and integer USD-micro estimates in `ai_runs`.
Unknown usage or an unmatched catalog remains unknown, not zero. The repository
catalog is frozen S13 evidence; it is not a current provider invoice. Raw provider
costs remain internal, not part of customer analytics.

No aggregate S22 spend ledger or live provider metadata is exposed by the authorized
tenant staff readers. Do not claim current spend or an enforced aggregate budget
from the presence of token/deadline limits. Before requesting a new paid customer
message, establish the bounded cohort ledger and account for attempts/repairs and
unresolved usage; stop if the projected total cannot be shown below the ceiling.
Do not change billing, budgets, model settings or provider keys.

Historical wrapper-correction packet for the owner's existing authenticated Cloud
Shell (local GCP/database authentication is unavailable). V2 executed as
`lead-agent-staging-migrator-xz9mz`; V3 subsequently executed as
`lead-agent-staging-migrator-snf6q`. **Do not rerun either packet** to retrieve logs.
The following preserves the earlier wrapper correction and its provenance:

- `C:/Users/Lenovo/AppData/Local/Temp/s22-business-readiness-readonly.mjs`, SHA256
  `70209e45b8dafe2e3e6652cf9daae7c84792288e7f8c4e802f043f551663ae1c`.
- **New upload:** `C:/Users/Lenovo/AppData/Local/Temp/s22-business-readiness-launch-v2.sh`,
  SHA256 `d3efe2a0acb6c8895e05e43531a3a520b1f33a601acf8128d2de71f01779d464`.

The reader is unchanged; reuse its existing exact-named Cloud Shell upload if its
hash matches. Upload only the uniquely named **v2** launcher into that same directory,
then run `bash s22-business-readiness-launch-v2.sh`. Its existing hash preflight
rejects a missing/different reader rather than using a duplicate-upload filename.
The launcher preserves the proven exact image/identity/runtime-secret-reference,
private VPC, explicit zero-retry and bounded execution/log safeguards. It executes a
new read-only payload, **not the old handoff diagnostic or migrator entrypoint**.
There is no job update, IAM grant, deployment, secret access via CLI or paid call.

The owner reports original execution `lead-agent-staging-migrator-7xb69`, exit 1,
with `SyntaxError: Cannot use 'import.meta' outside a module` on Node 24.14.0.
Confirmed tooling cause: the original generated command was
`node --input-type=module -e 'eval("(async()=>{"+atob(process.env.S22_BUSINESS_READ_B64)+"})()")'`.
Its outer bootstrap is a module, but the decoded reader is parsed by **eval as
Script**, before any imports, transaction or database checks can run. The prior
six mocks replaced the `import.meta.resolve` line and did not cover this path.
This is a diagnostic-wrapper defect, not a failed business/schema assertion.

V2 keeps the decoded reader bytes intact and passes their UTF-8 Buffer to a Node
subprocess's stdin with `--input-type=module`. The child inherits the deployed
application working directory `/app`, native environment and stdout/stderr.
Its module base therefore supports bare `@lead-agent/*` package imports,
`import.meta.resolve('@lead-agent/database')`, and the package-relative
`./runtime/tenant.js` file URL. It writes no temporary module under `/app` or `/tmp`
and does not use eval or a `data:` module with a different resolution base.
The child is bounded at 60 seconds and propagates its exit status; bootstrap
timeout/signal failures emit only a finite sanitized failure code. The existing
90-second execution poll/cancellation limit is unchanged. The argument list uses
the [documented gcloud custom delimiter](https://docs.cloud.google.com/sdk/gcloud/reference/topic/escaping)
`^~^` so commas inside the JavaScript bootstrap remain inside its one `-e` argument.

The payload uses the real `TenantDbSession` runtime with READ ONLY enabled before
transaction initialization, exact tenant context, 5-second connection/statement
timeouts, 1-second lock timeout, 10-second idle timeout, FORCE RLS/not-owner checks
and rollback/connection cleanup. It invokes the existing conversation reader for
two fictional price/duration queries, without printing fact/customer text. It reads
at most 11 grouped metadata rows (more than 10 fails closed) from tenant-scoped
`ai_runs`. Only provider/model/profile, cost-catalog/currency, aggregate token/cost,
unknown and unfinished counts are reported. No credentials, account IDs,
ciphertext, message body or whole JSON metadata is selected.

Zero existing runs is **not** live provider proof; null cost remains unknown.
Readiness output is scoped to this synthetic tenant, not an invoice, promotional
credit balance or proof that unrelated/unrecorded paid calls did not occur.
Obtain and reconcile the result before a bounded customer/provider cohort.
Preserved local packet checks: `node --check`, `bash -n` and six mocked readiness
guard/cleanup scenarios. Those alone did **not** prove the original bootstrap.
V2 adds **7/7 exact-bootstrap Node subprocess checks PASS** on **v24.14.0**, using
controlled application packages outside the repository and the **unmodified reader**:
original error reproduction; successful complete reader execution with actual
bare/relative ESM imports; static/dynamic imports, top-level await, module-base
resolution, UTF-8 and native environment assignment; read-only denial with
rollback/close; missing-package fail-closed behavior; exact nonzero exit propagation;
and module-execution failure propagation. No database connection, paid call or
live job was used. V2 `bash -n` PASS; diff review confirms only bootstrap comments,
definition and `--args` changed, with all existing safeguards otherwise unchanged.

Reproducible outside-repository test command:
`node "C:/Users/Lenovo/AppData/Local/Temp/s22 ESM wrapper proof 239acac5c8364e8e971974f96cad5162/verify-bootstrap.mjs"`.
Harness SHA256 `b63e1a4718bc8da0b00229b63a5aa3bc2718c685fe492be777b6c3e9e5465baa`.
At that wrapper-correction checkpoint no corrected live execution had occurred.
The owner-supplied V2 result below now supersedes that pending diagnostic status;
business readiness is still blocked, and S22 is not accepted.

## Readiness failures and scoped follow-up — 2026-10-05

Owner-supplied execution **`lead-agent-staging-migrator-xz9mz`** reached the reader.
Read-only/runtime/tenant/RLS and FORCE-RLS/not-owner guards **PASS** (12 tables).
Price retrieval **PASS** (two facts), but the combined knowledge assertion **FAIL**:
one duration fact was returned, yet `duration_retrieved=false`. Cohort ledger
**FAIL**: known subset `0` USD micros, two unknown-cost runs, zero unfinished runs.
This is not evidence of zero spend. No provider call was made by the diagnostic.
No raw logs or per-run records were independently retrieved in this continuation.

### Duration: diagnostic provenance mismatch, not a demonstrated retrieval defect

`grounding-facts.ts` creates a Service citation using **`service.root_version`**;
the knowledge SQL separately supplies **`provenance.version_no`** from the current
Service publication. The original diagnostic incorrectly required source version
**1**. Preserved live publication/read-back records root **4**, publication **1**,
duration **30 minutes**. A publication number is not the citation's root version.
The exact query already selects a duration need (`davom`) and Uzbek output uses
`daqiqa`; local retrieval returns the correct service/root and `30 daqiqa`.
There is no proven publication, language/unit or service-selector defect.

V3 does not simply replace 1 with 4. A bounded, parameterized tenant read verifies
the exact current Service/ServiceVersion join, original publication **1/hash**,
**30 minutes**, active location offering and compatible Lead service/location
selectors. The real conversation reader must then return exactly one duration
fact, with the same service ID, **current root version**, `claim_kind=service`,
`need=duration`, `locale=uz`, matching subject and `30 daqiqa`. It prints references
and numeric/boolean metadata, never fact or customer text. Live confirmation of
these expanded checks is still pending; the original returned fact's exact
reference was not included in the owner's output.

### Costs: rates verified; historical usage/classification still incomplete

Official [Google model documentation](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash)
confirms the exact approved model and low thinking. Official
[standard paid pricing](https://ai.google.dev/gemini-api/docs/pricing#gemini-3.8-flash)
checked on **2026-10-05** confirms **USD 0.75 input / 0.075 cached input / 3.75 output
per million tokens through 2026-12-31**, including thinking in output. The existing
`ai-provider-prices.2026-09-17.v1` effective interval/rates match; no catalog or
production model change is justified. These are list-price estimates, not billing
or account-entitlement evidence; no free/promotion credit is deducted.

| Historical group | Proven evidence | Classification / missing evidence |
| --- | --- | --- |
| Resolved `gemini-3.8-flash`, approved profile/catalog, input 520 / output 217 | Provider usage was recorded; estimated cost is NULL | Provider-response evidence, not pre-dispatch/free. Exact run ID/time, cached input and total units/validation are absent from the grouped report. Source reproduction shows missing cache usage prevents pricing despite a matched catalog; the actual per-run cause needs read-back. |
| Requested model approved; resolved model NULL; `not-priced.v1`; grouped recorded units zero | Run finished, but no resolved-model or known-cost proof | Dispatch/billing **UNPROVEN**. Old `coalesce(sum(...),0)` conceals NULL usage. Require actual nullable units, run/failure/status/time/correlation and dispatch evidence. Timeout/network/missing units do not prove no charge. |

Adapter path: `parseGeminiUsage` validates reported counts and derives billable
output from total minus input; omitted cached usage remains NULL. The
[usage reference](https://ai.google.dev/api/generate-content#UsageMetadata) distinguishes
prompt, cached, candidate, thinking and total counts. `finishAIRun` resolves the
exact **resolved** model and started-at catalog, then `estimateAIUsageCost` rejects
missing/invalid input/output/cache or inconsistent totals. Missing resolved model
becomes `not-priced.v1`; neither path invents cost. A finished run is not necessarily
a successful provider call. No original units/catalog/provenance were modified.

There is **no existing audited historical AI-cost reconciliation interface** in
the inspected application/database implementation. Do not use the run-finishing
path as a backfill or write ad-hoc SQL. The source's `context_too_large` branch
uniquely precedes `decide`; V3 only marks that path proven when the exact failure,
orchestrator/status and absent provider/usage/output evidence agree. It does **not**
apply that classification to either live run without their records, or assign even
such a run a zero historical cost. Provider response/billing evidence is required
where usage cannot be recovered. The two costs remain **unknown**, and all new paid
calls remain **PAUSED**, target USD 5 / hard USD 10 unchanged.

### Historical V3 packet (executed; do not rerun)

The owner uploaded these **two uniquely named files** to authenticated Cloud Shell
and ran `bash s22-business-readiness-launch-v3.sh`:

- `C:/Users/Lenovo/AppData/Local/Temp/s22-business-readiness-readonly-v3.mjs`, SHA256
  `14fcdc1dd39e464ab926184e3e0e08d10014edb93eeba502cd98eb707df15f73`.
- `C:/Users/Lenovo/AppData/Local/Temp/s22-business-readiness-launch-v3.sh`, SHA256
  `f3e36b3379dd7ccdae1142f03a8263593ed3b59f2855f10a108c192c4a692b4a`.

V3 keeps V2's actual ESM bootstrap, reviewed immutable image, runtime secret
reference, identity, private VPC/subnet/egress, explicit zero retries, hash
preflight, 60-second child / 90-second polling bounds and rollback/close safeguards.
The launcher diff changes only reader filename/hash. No job configuration/IAM or
deployment changes. Per-run metadata is tenant-qualified, capped at **21 rows**
(more than 20 fails closed), retains NULL counts, and selects no message/contact
data, provider account/credential, payload, ciphertext or whole audit blob.
Both unknown and unfinished attempts block the cohort. This packet is read-only,
does not execute the migrator, and cannot reconcile/write historical costs.

Verification: **9/9 focused repository tests PASS** in
`tests/ai/s22-business-readiness.test.ts`: exact fixture duration UZ/RU/EN,
root-versus-publication provenance, cross-service missing-duration/nonexistent
facts, symmetric disjoint tenant-qualified citations/stale rejection, missing
usage remains unknown, and zero provider calls on a real pre-dispatch code path.
These are local projection/citation tests, **not new live cross-tenant RLS proof**.
Root TypeScript, scoped zero-warning ESLint, formatting and diff checks PASS.
**13/13 exact V3 ESM-bootstrap subprocess scenarios PASS** with controlled packages:
current fixture; preserved unknown runs; stale/foreign service reference; wrong
published/retrieved duration; wrong publication/selector; timeout remains ambiguous;
unique pre-dispatch path; read-only denial; row bound; unfinished run; rollback/close.
No live database or paid call. Command:
`node "C:/Users/Lenovo/AppData/Local/Temp/s22 readiness v3 proof 1791202675466/verify-v3.mjs"`,
harness SHA256 `27c154af75877fddb710b4090d6d7bf48fbba576c5ffa6dcf567603c44627c9d`.
No runtime source changed, so no image build/deployment plan or unrelated CI is
required. S22 readiness/booking remain pending, not accepted.

### V3 live read-back and remaining cost evidence — 2026-10-05

**Owner-supplied** log read-back for `lead-agent-staging-migrator-snf6q`:
`GCLOUD_EXIT=0`, `SANITIZER_EXIT=0`, eight entries, six structured payloads and six
diagnostic assertions. Runtime/read-only/tenant guards and FORCE-RLS/not-owner
**PASS**, manifest **12 tables**. Current published fixture **PASS**: one row,
Service root **4**, publication **1**, duration **30 minutes**, compatible selectors
and active offering. The real conversation reader's combined knowledge assertion
**PASS**: price retrieved **true**, two price facts; duration retrieved **true**, one
duration fact. This closes the scoped duration/provenance gap without any runtime
retrieval, publication or selector change. It is not a live model/customer reply.

Provider/model consistency **PASS**, bounded **two runs**; the sanitizer did not
return their individual rows. Cohort ledger remains **FAIL**: known-cost subset
**0 USD micros**, **two unknown-cost runs**, **zero unfinished runs**, paid calls
**PAUSED**. Unknown spend is not zero. The returned reader assertions explain the
diagnostic's nonzero exit; the finite `CONTAINER_EXIT` log tag is not a separate
proven application failure. Earlier empty reads lacked captured exit status and
have no proven timeout/payload-format cause. No diagnostic rerun is justified.

At that checkpoint, the next action was a bounded **Cloud Logging read of this existing
execution**, selecting only `provider_and_cost_metadata` and its reader's allowlisted
`observed.rows`. Obtain the two exact run IDs/times, failure/status, nullable usage,
resolved model/catalog and dispatch classification before attributing either unknown
cost. These fields contain no message/contact text, provider account identifier,
credential or payload. No new job, database transaction, migration or provider call
is needed. Do not invent a zero cost, overwrite historical records, or use the
run-finishing mutation as reconciliation. The original unknowns and provenance
remain preserved; no existing audited historical cost-reconciliation interface was
found. Booking and new paid calls stay blocked pending that evidence and reconciliation.

### Exact historical rows and narrow cache parser correction — 2026-10-05

The owner returned the existing `snf6q` execution's allowlisted per-run records;
`GCLOUD_EXIT=0`. No new diagnostic/database execution or paid call occurred.

| Exact run | Persisted evidence | Cost conclusion |
| --- | --- | --- |
| `01a1067f-dfc8-7e14-9e12-89a0e30fd27e` | Succeeded; 2026-10-04T10:40:06.088Z to 10:40:08.585Z; requested/resolved approved Gemini; schema/policy true; input 520/output 217/total 737; cached/reasoning NULL; approved catalog; cost NULL | Confirmed pricing blocker: cached usage NULL. Provider ran; this is not a pre-dispatch/free result. |
| `01a10af4-5126-7ce8-ab52-0424e07ab3d9` | Failed; 2026-10-05T07:25:46.150Z to 07:25:46.210Z; resolved model/schema/policy/output hash absent; all usage/cost NULL; `not-priced.v1`; diagnostic failure category `unrecognized` | Dispatch/billing still unproven. 60 ms and NULL usage do not prove no call/no charge. |

Both are attempt 1 for the exact synthetic conversation, with the approved
`s13-commercial-v1.v1`, `s12-orchestrator.v1` and `s16-appointment-submission.v1`.
Original records/provenance remain untouched. No historical cost is backfilled.

Confirmed **forward-looking adapter defect**: Google's
[API proto](https://github.com/googleapis/googleapis/blob/master/google/ai/generativelanguage/v1beta/generative_service.proto)
declares cached-token count as an implicit-presence `int32`;
[ProtoJSON](https://protobuf.dev/programming-guides/json/#presence-and-default-values)
omits default zero scalars. The old parser turned a legitimate omitted cache count
into NULL, preventing the existing estimator from pricing otherwise valid usage.
The correction normalizes **only an absent cache field with valid reported input
and total** to zero. Missing/incomplete usage and explicit null/malformed cache
values remain unknown; counts, consistency and model/tenant policy checks remain.
The approved model, thinking/output settings, pricing catalog and S12 retry policy
are unchanged. Reasoning is not billed twice; total minus input remains output.

This protocol correction does **not** recover the first historical raw field:
the old parser stored the same NULL for omission and explicit invalid/null values.
That distinction is lost in the database and the diagnostic. With the existing
official rates, a controlled valid omitted-cache fixture yields **1,204 USD micros**;
it is **not** that historical run's reconciled cost or provider invoice. Obtain the
original allowlisted usage metadata or authoritative billing evidence before
reconciliation. No existing audited historical cost-reconciliation interface exists.

The diagnostic also masked valid source categories: `staff_requested`,
`provider_incomplete_content_filter` and `provider_incomplete_unknown` were absent
from its finite allowlist. A deterministic S16 preflight test proves an explicit
staff request can finish with zero provider invocations, but does **not** identify
the masked live failure. A new outside-repository **cost-origin-only** packet reads
only the two exact run IDs/conversation/tenant, with a complete canonical category
allowlist, strict row bound, runtime/read-only/FORCE-RLS guards and rollback/cleanup.
It repeats no knowledge retrieval and performs no reconciliation/migration/write.

Prepared files (not committed):

- `C:/Users/Lenovo/AppData/Local/Temp/s22-cost-origin-readonly-v1.mjs`, SHA256
  `833fe31500a1e6a930b0ad690826177294be590945e98cb2e26efb16a282192c`.
- `C:/Users/Lenovo/AppData/Local/Temp/s22-cost-origin-launch-v1.sh`, SHA256
  `3fc6cf7e692e721200ed0fe81d3fca96e255b28384ccff1140e3f6d6ac3ccf5b`.

The launcher retains the reviewed deployed immutable image/identity/secret reference,
private network/subnet/egress and explicit zero retries, with actual ESM subprocess
and bounded execution. Its bounded log read captures exit status; an unavailable
log read is not permission to rerun the diagnostic. At preparation the packet had
not executed; the owner subsequently ran it successfully as recorded below.
Never replace its expected digest with an unreviewed image. Do not rerun this
packet now that the scoped masked-category gap is closed.

Local affected verification: Gemini adapter **47/47**, readiness **10/10** PASS;
AI package typecheck/production declarations, root TypeScript and scoped lint PASS.
The new packet's exact ESM bootstrap has **7/7 controlled subprocess checks PASS**:
canonical staff/network categories; unknown category; missing/extra exact IDs;
read-only/RLS denial; NULL preservation, query scoping, rollback/close. Command:
`node "C:/Users/Lenovo/AppData/Local/Temp/s22-cost-origin-proof/verify.mjs"`, SHA256
`01e7cb4b0467d129001077fe6c8391d6c852f8196c2752792c0506a6fd42382b`.
These are local fixtures, not new live database/provider evidence. Historical costs
remain unknown; paid calls remain paused, budgets unchanged. The runtime parser
requires fresh immutable images and an exact reviewed deployment plan before rollout;
no apply, migration, OAuth, Claim/Resolve or unrelated CI is authorized by this fix.

### Cost-origin live read-back — 2026-10-05

**Owner-supplied** `lead-agent-staging-migrator-dlts6` reports completed condition
`True` and log-read exit **0**. All private-network/explicit-zero-retry preflight
guards and all three reader assertions **PASS**: runtime/read-only/tenant guard;
FORCE-RLS/not-owner guard (12 tables); exact historical rows (two exact IDs,
unchanged records, paid calls paused). This is live diagnostic evidence supplied
by the owner, not an independently retrieved execution or billing attestation.

| Exact run | New observed evidence | Current classification |
| --- | --- | --- |
| `01a1067f-dfc8-7e14-9e12-89a0e30fd27e` | Input 520/output 217/total 737; cached input NULL, original raw field unavailable; cost NULL | Provider call with incomplete historical accounting; cost unknown |
| `01a10af4-5126-7ce8-ab52-0424e07ab3d9` | Actual persisted category `staff_requested`; no resolved model/output/schema/policy/usage; cost NULL | Source-corroborated deterministic pre-dispatch staff handoff; not a provider outage/quality failure; stored cost still NULL |

Deployed source `a26b28c7da44ae56c32a8d9dc1bac7cc3c06095c` uses the S16
appointment-submission orchestrator in the Worker. The human-request predicate
sets `staff_requested` in preflight **before** provider `decide`; finish checks
the same snapshot message/predicate. Those files match the reviewed parser-fix
source, and the accepted zero-invocation focused test covers this path. This
source-correlated classification does not rewrite the row or pretend to be a
provider invoice. `finishAIRun` records NULL cost without resolved model/usage,
even for the legitimate no-provider preflight. No audited historical reconciliation
interface exists; no ad-hoc write or invented zero cost is performed.

The unresolved provider-call evidence is the original allowlisted cache usage
metadata or authoritative billing evidence. The ledger still contains **two
NULL-cost rows**, so it is not ready under the current rules; paid calls remain
paused, USD 5 target / USD 10 hard ceiling unchanged. No diagnostic, OAuth,
Claim/Resolve or accepted tests need repeating. The forward parser fix has fresh
build **37313624020 PASS** and saved plan **37314501163 PASS**. The owner-approved
exact plan was subsequently applied in **37321048848 PASS** (0 added / 4 changed /
0 destroyed / 0 replacements), with **37321407052 PASS** for existing read-only
deployment checks and whole-runtime convergence exit code 0;
[applied rollout evidence](s22-acceptance-evidence.md#exact-parser-rollout-applied-and-verified--2026-10-05).
Runtime source remains `3b73fdd1c38c98be3f02821902914e1c707d0054`, timestamp
`2026-10-05T13:02:55Z`, migration provenance
`0031_s22_widget_inbound_route_management`; no migration or new paid call ran.
Historical accounting reconciliation remains separately blocked. Do not treat
deployment of the parser as reconciliation of these rows or S22 acceptance.

## Journey and current checkpoint

No booking action may target unrelated work. All date/time preferences must come
from the real synthetic customer, in a future open-hours interval; do not invent
one from model output or a staff test harness. Use actual authorized API contracts
and fresh resource/conversation versions at each step. No external calendar write.

| Step | Required live proof | Current result |
| --- | --- | --- |
| Existing business configuration inspection | Authenticated tenant-bound reads, existing policies/languages and safe resource metadata | PASS: owner context, empty complete initial inventory; initial expired-session 401 superseded after owner sign-in |
| Authoritative fixture publication | Exact returned IDs, current published versions/hashes and offering | PASS: five published version-1 records and active offering; exact fixture read-back 7/7 |
| Conversation pipeline retrieval | Real repository reader returns current price/duration references for this exact conversation | PASS (owner-supplied V3): current fixture root 4/publication 1, 30 minutes; two price facts and one duration fact retrieved |
| Live model/cost readiness | Resolved model and complete internal bounded cohort ledger | One provider call with missing historical cache usage; one source-corroborated pre-dispatch staff request. Stored ledger still has two NULL-cost rows; paid calls PAUSED; authoritative accounting/reconciliation remains blocked |
| Service/price question | Friend sends one natural question in the approved synthetic Instagram DM; grounded reply uses the published fixture price, no availability claim | PENDING cost readiness and actual customer message; authoritative retrieval PASS |
| Qualification | Published V1 evidence and eligible bound channel; no mandatory phone or invented evidence | PENDING |
| Booking request | Real customer date/time preference; authoritative `requested` record with S16 profile and Qualification V1 provenance | PENDING |
| Staff acceptance | Synthetic request only; fresh versions; `staff_accepted`, then durable preparation and current confirmation offer | PENDING; never count as confirmed |
| Customer confirmation | Actual customer explicitly confirms the current offer in the same eligible DM | PENDING; no fabricated confirmation/attestation |
| Confirmed booking | Authorized request state `confirmed`, immutable confirmation evidence and same-DM/staff output | PENDING |

After publication and cost readiness, the first natural Uzbek message is:
“Salom, S22 sinov konsultatsiyasi qancha turadi?”
Ask the owner for that one friend-sent message only when preparation is complete;
do not send it yourself, manufacture webhooks or repeat Instagram authorization.

## Prepared next live booking milestone — 2026-10-05

Preparation only; no paid message or booking mutation executed in this task.
The finite accounting conclusion, proposed one-time historical reserve decision
and complete remaining-work map are in the
[evidence register](s22-acceptance-evidence.md#finite-historical-accounting-and-completion-audit--2026-10-05).
Both historical costs remain NULL. Exact accounting is not reconstructed by the
parser deployment, a token-cost bound, or source-corroborated preflight handling.
Paid calls remain paused until the applicable decision and cohort control gates
are actually satisfied. No accounting/confirmation attestation is fabricated.

Reused authority is the five existing published version-1 fixture records above,
service root 4, **30 minutes / UZS 100,000**, Asia/Tashkent Monday–Saturday
09:00–18:00, and Qualification V1 requiring contactability, service interest,
supported service/location and positive intent. It does not impose a mandatory
phone, budget or clinical-eligibility field. Hours are not available slots.
Existing price/duration retrieval PASS from `lead-agent-staging-migrator-snf6q`
is preserved; no publication or successful inventory is rerun.

The current API/source contracts support the following bounded path:

1. In the owner's existing organization-bound workspace, read
   `GET /v1/staff/me` to verify active membership/organization and owner capability.
   Then read `GET /v2/staff/conversations/01a1067f-d7d8-7e7e-9fb0-39bfe2f7cdc7`
   for current authorized state/versions before using that approved synthetic
   thread. Prior open/12, AI mode and resolved handoff/4 are historical proof,
   not substitutes for this fresh check. Never re-enable unknown personal DMs.
2. Read `GET /v1/staff/appointment-requests?view=active&limit=100` through the
   existing `StaffWorkListQuery` contract. Its supported filters are cursor,
   limit, view and location_id, **not conversation_id**. Filter returned safe
   metadata by the exact synthetic conversation locally; honor bounded pagination
   before claiming absence. Do not alter an unrelated request or create a duplicate
   booking to sidestep an existing synthetic one.
3. After the paid-cohort gate, the friend sends only:
   **“Salom, S22 sinov konsultatsiyasi qancha turadi?”**
   Verify the real grounded reply, approved resolved model, supported usage/cost,
   publication references and meaningful-response timing. Do not treat an old
   handoff message as this new grounding test or send a message on the friend's behalf.
4. The same synthetic customer supplies actual service interest and a chosen
   future date/time preference, e.g. the template
   **“S22 sinov konsultatsiyasiga [mijoz tanlagan kelajak sana] kuni [vaqt]da,
   Toshkent vaqti bilan yozilmoqchiman.”** The brackets are instructions to fill
   with the customer's real choice, not test evidence. Verify authoritative Lead
   qualification and exactly one `requested` AppointmentRequest, including same
   tenant/service/location and fixed S16/Qualification provenance.
5. Read `GET /v1/staff/appointment-requests/{exact_returned_id}`. Use the real
   staff UI's acceptance command, implemented by
   `POST /v1/staff/appointment-requests/{id}/accept`, with only the actual
   `start_at`/`end_at` fields. The authorized owner chooses a supported offered
   time, converts Asia/Tashkent to UTC and preserves the 30-minute duration;
   never infer guaranteed availability. Existing server tenant authorization,
   CSRF, a freshly read ETag/If-Match and unique Idempotency-Key remain required.
   Re-read current request/conversation versions after the command before another
   action; do not reuse obsolete UI versions on refresh failure.
6. Verify `staff_accepted`, then durable downstream confirmation preparation and
   `awaiting_customer_confirmation`, current offer and same-DM delivery. The
   existing staff-accepted analytics event is preparation intent, not delivery
   or confirmed status. S18 expires the offer at
   `min(issued_at + 24 hours, accepted_start_at)` with no implicit renewal.
7. Only after receiving that actual current offer, the customer explicitly replies
   **“Ha, shu vaqtni tasdiqlayman.”** if that is their intended synthetic decision.
   Trusted channel evidence must match tenant/contact/conversation/request and
   current aggregate/offer versions within `[issued_at, expires_at)`. Verify the
   persisted `confirmed` state and customer/staff output. Staff acceptance,
   generic earlier intent, a prompt or a fabricated staff attestation cannot
   substitute for this reply.

Source: `apps/api/src/staff/plugin.ts`,
`packages/contracts/src/staff/operations.ts`,
`packages/application/src/staff/operations.ts`,
`packages/application/src/appointments/customer-confirmation.ts`,
`packages/database/src/repositories/appointment-submission.ts`,
`packages/database/src/repositories/customer-confirmation.ts` and
`apps/worker/src/customer-confirmation.ts`.

The authorized staff projection reports request state/versions, conversation
version and offered start/end, but does not expose immutable offer-version,
issued/expiry, confirmation-source, transition or audit records. Do not invent
an audit/offer endpoint. Consolidate any necessary narrowly scoped persisted
booking evidence through an existing authorized reader after the journey;
public state alone does not prove all immutable confirmation assertions.

A new local desktop reader passed syntax validation but its live attempt stopped
on the exact workspace/context guard **before API requests**; a subsequent
metadata-only attempt could not activate the exact Chrome window. No cookies,
tokens, messages or provider identifiers were exported, and no further browser,
OAuth or authentication attempt was made. Consequently no fresh session, fixture,
conversation or appointment state read is claimed from this task. This is a
tool-access limitation, not evidence that the accepted Auth0 flow broke.

## Deterministic checks versus live evidence

### Owner-approved activation checkpoint — 2026-10-05

The owner has approved the one-time historical budget reserve and bounded
allowance (USD1.033396 + USD4.808592, combined USD5.841988), explicitly accepting
the USD5 target overage without changing USD10. Historical NULLs/exact accounting
remain unresolved. This supersedes only the earlier pending-approval wording;
it does not authorize another cohort or optional paid tests.

Exact saved-plan apply **37342528348 PASS**, deployed source
`f523ba330c7b1dcffe8a18d22a65d0dea6d7b40d`, 0 creates / 4 in-place updates /
0 destroys; no replacements, migration execution or IAM change. Post-apply
read-only verification **37342852295 PASS**, whole-runtime convergence exit 0,
API/Web reviewed provenance and HTTP200 health/reachability. No rebuild or
replacement deployment plan.

The initial live `booking-evidence` read still needs to prove the deployed gate's
exact binding, preserved two historical NULLs and no new paid slots/reservations
or existing synthetic request. Do not ask the friend to send the next message
until that check passes. Then give only the next single natural Uzbek action,
observe delivery/accounting before another paid turn, and stop on unknown cost,
timeout, exhausted allowance or guard failure. A staff acceptance is never the
actual customer's confirmation.

Read-only run **37345335247** subsequently verified the deployed Worker
`booking` mode, reviewed source/image, one instance and private networking, plus
the diagnostic image/runtime-secret/private-network/zero-retry prerequisites.
Execution **`lead-agent-staging-migrator-vlcsh` SUCCESS** made no provider call
or database mutation. The workflow could not read its exact result logs
(`EXACT_EXECUTION_LOG_READ_BLOCKED`); no individual observed cohort counters are
claimed yet. Recover only the existing execution's `s22_booking_readonly`
structured rows using owner-authenticated Cloud Logging. No uploads, rerun,
deployment or IAM change. Do not send a paid message until those rows prove the
initial readiness assertions. S22 remains unaccepted.

### Bounded money-control preparation — 2026-10-05

See the exact [booking-readiness packet](s22-acceptance-evidence.md#bounded-booking-readiness-packet--2026-10-05).
The live Worker previously had token/time/repair caps but no durable cohort money
gate. Source `f523ba330c7b1dcffe8a18d22a65d0dea6d7b40d` passed the three
focused real PostgreSQL 17.11 cases in run **37340223769**. New code remains
paused by default and still requires owner approval of the historical
reserve/allowance and a fresh reviewed saved deployment plan before activation.
It is not deployed by this document.

The fresh [reviewed rollout packet](s22-acceptance-evidence.md#fresh-reviewed-rollout-packet--not-applied)
records build **37340460397**, plan **37341267014**, the four exact images and
saved-plan SHA256. The actual plan is 0 creates / 4 in-place workload updates /
0 destroys / 0 replacements, no SQL/IAM/network/scaling/secret change and no
migration execution. Historical-reserve/allowance and exact-plan approvals are
still pending; paid calls stay paused. No rebuild is needed for this later
evidence-only update.

Future slots reserve **USD0.801432**: the documented input maximum and enforced
4,000 output tokens including thinking, one candidate and no extra tools/storage.
Three distinct paid messages / six slots / two per message give **USD4.808592**
additional allowance and **USD5.841988** combined with the pending historical
USD1.033396. The USD5 target may be exceeded at worst case; USD10 is unchanged.
Unknown cost/timeout/crash retains its full slot and prevents another paid call.
The internal tenant-authorized reader never assigns zero to the historical NULLs.
Application character limits are not a proven token conversion. This exact
single-Instagram-thread guard does not authorize Widget/other-provider samples.

After all gates, the next customer message remains:
**“Salom, S22 sinov konsultatsiyasi qancha turadi?”**
Then one real chosen future preference (clarification only if required within the
three-message allowance), fresh staff acceptance and actual delivered-offer
confirmation. Confirmation is handled deterministically before AI, not an
optional fourth paid turn. No actions should be requested from the friend yet.

The completion map now separates S22 M1–M4, initial-launch L1–L3/S23 and later
P1/P2, attaching exact source criteria. No larger launch target, privacy decision,
accounting threshold or uninspected control is silently marked satisfied/missing.

Focused fixture tests validate the exact configuration payloads against existing
contracts, integer pricing, UZ/RU/EN content, reference binding, hours and booking
wording. Existing focused grounding/medical tests check missing/ambiguous facts,
unpublished pricing, unsupported guarantees/availability and medical fail-closed
policy. The current S21 owner-approved safety text supersedes the historical S14
wording deferral: deterministic policy may emit that exact locale-specific text,
but cannot diagnose, recommend treatment or execute a protected action.

These local/mocked checks are not live Gemini, Instagram, RLS or booking-journey
proof. **60/60 focused repository tests PASS**: fixture contracts 7, grounding 41,
S21 privacy/medical safety 12. Root test-source TypeScript and scoped ESLint PASS.
No migration, infrastructure, IAM, social eligibility, runtime deployment
or CI rerun is needed for this fixture/evidence preparation. Any later necessary
runtime change requires fresh reviewed images/plans and exact-plan approval.
