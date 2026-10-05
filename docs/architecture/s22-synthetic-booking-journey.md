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

A separate outside-repository readiness packet is prepared for the owner's existing
authenticated Cloud Shell; local GCP/database authentication is unavailable. The
original launcher failed before reader execution; use **v2 only**, as explained below:

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
No corrected live execution has occurred in this continuation. Business readiness
remains pending until v2 returns its actual diagnostic results; no S22 acceptance.

## Journey and current checkpoint

No booking action may target unrelated work. All date/time preferences must come
from the real synthetic customer, in a future open-hours interval; do not invent
one from model output or a staff test harness. Use actual authorized API contracts
and fresh resource/conversation versions at each step. No external calendar write.

| Step | Required live proof | Current result |
| --- | --- | --- |
| Existing business configuration inspection | Authenticated tenant-bound reads, existing policies/languages and safe resource metadata | PASS: owner context, empty complete initial inventory; initial expired-session 401 superseded after owner sign-in |
| Authoritative fixture publication | Exact returned IDs, current published versions/hashes and offering | PASS: five published version-1 records and active offering; exact fixture read-back 7/7 |
| Conversation pipeline retrieval | Real repository reader returns current price/duration references for this exact conversation | PENDING read-only readiness packet; API publication alone is not sufficient |
| Live model/cost readiness | Resolved model and complete internal bounded cohort ledger | PENDING read-only readiness packet; source pin/limits verified |
| Service/price question | Friend sends one natural question in the approved synthetic Instagram DM; grounded reply uses the published fixture price, no availability claim | PENDING retrieval/cost readiness and actual customer message |
| Qualification | Published V1 evidence and eligible bound channel; no mandatory phone or invented evidence | PENDING |
| Booking request | Real customer date/time preference; authoritative `requested` record with S16 profile and Qualification V1 provenance | PENDING |
| Staff acceptance | Synthetic request only; fresh versions; `staff_accepted`, then durable preparation and current confirmation offer | PENDING; never count as confirmed |
| Customer confirmation | Actual customer explicitly confirms the current offer in the same eligible DM | PENDING; no fabricated confirmation/attestation |
| Confirmed booking | Authorized request state `confirmed`, immutable confirmation evidence and same-DM/staff output | PENDING |

After publication and cost readiness, the first natural Uzbek message is:
“Salom, S22 sinov konsultatsiyasi qancha turadi?”
Ask the owner for that one friend-sent message only when preparation is complete;
do not send it yourself, manufacture webhooks or repeat Instagram authorization.

## Deterministic checks versus live evidence

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
