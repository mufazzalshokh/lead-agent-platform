# S22 remaining acceptance evidence

This register distinguishes completed deployment/onboarding evidence from remaining
live product and recovery/capacity proof. It does not declare S22 acceptance.

## Preserved evidence

- Staff owner sign-in works in normal Chrome (owner confirmed). Do not reopen Auth0/MFA.
- Instagram Professional is Connected and messaging is active (owner confirmed after
  deployment of `a4fe54eb0c3d3b94df2d289fb917115034291b50`). Do not repeat OAuth.
- That runtime deployment used immutable API/Web/Worker/Migrator digests, had only
  four in-place workload updates, and converged with exit code 0. Runs:
  images `37136380118`, plan `37136692413`, apply `37136820128`, verification
  `37136945055`.
- Migration validation already passed: 32 migrations through
  `0031_s22_widget_inbound_route_management`, 52 tables, FORCE RLS and role isolation.
  Do not rerun migrations for subsequent acceptance checks.
- Read-only inventory run `37138195857` confirmed RUNNABLE/private PostgreSQL 17,
  shared-core tier, backups/PITR enabled, ready worker and both enabled alert policies
  with notification channels. Actual backup `1790989200000` completed at
  `2026-10-03T02:57:03.193Z`. This is backup existence proof, not measured RPO/RTO.
  Its only failed assertion was a verification bug: `/` intentionally redirects to
  `/staff`; the probe now checks the organization-bound staff shell directly.
- Corrected inventory run `37138390710` passed all 12 prerequisites at
  `2026-10-03T16:51:52.016Z`, using evidence-tooling commit
  `d5ae4176e53794b4bb7ea7e829408b9fd43225e0`. API health and the organization-bound
  staff shell both returned HTTP 200. Artifact SHA256:
  `82fecbc2724987e9c72d762a74ec4f3991253a912c88d19359164966ad7dbbe2`.
  The artifact explicitly records no infrastructure mutation, secret payload access,
  restore proof or capacity proof. Runtime images remain on the already-proven
  `a4fe54eb0c3d3b94df2d289fb917115034291b50` deployment.
- Subsequent deployment summary `37188579463` records runtime source
  `61b93093b1a7f28af2060fc1cd2bbe41fba75f54`. Privacy/deletion notices are deployed.
  Instagram is connected and the Meta app is published; do not repeat OAuth.
  The owner reports that a real friend's DM was persisted, automatically replied to,
  and displayed in the staff transcript with a handoff. Claim followed by Resolve
  reduced Inbox to 0. These are owner-observed live results, not independent
  post-action database/history/audit verification. No message content is recorded here.

## Staff conversation workflow milestone — deployed, live proof pending

Customer work and conversation details precede integrations/analytics. Opening a
card focuses and scrolls to the transcript. Inbox and History use the existing
tenant-authorized `/v1/staff/inbox` `view=active|history` contract. History means no
pending staff work, not necessarily a terminal conversation. Inbox 0 never means
messages were deleted.

Claim/Resolve retain the selected conversation, transcript, and explicit feedback.
The client obtains current resource and conversation versions before allowing the
next command. Failed list/detail refreshes pause actions while preserving context;
manual refresh can restore readiness. Late responses from older views, selections,
or an unmounted component cannot overwrite current work. Assigned/in-progress
handoffs display their authoritative states. Backend authorization, CSRF,
idempotency, ETags, privacy eligibility and domain transitions remain unchanged.

Focused verification on `2026-10-04`:

- `node node_modules/vitest/vitest.mjs run apps/web/src/lib/staff-workflow.test.ts apps/web/src/lib/product-ux.test.ts`:
  **35/35 PASS** (19 workflow regressions, 16 existing presentation/integration tests).
- `node node_modules/typescript/bin/tsc -p apps/web/tsconfig.json --noEmit`: PASS.
- Scoped ESLint with `--max-warnings=0` for the component, workflow helper/tests,
  and existing presentation helper/tests: PASS.
- Web production `node node_modules/next/dist/bin/next build` from `apps/web`: PASS.
- Installed Edge against the production localhost Web build, isolated temporary
  profile and mocked tenant API: PASS for actual card focus/scroll, work-before-settings,
  Claim, fresh-version Resolve, preserved transcript/feedback, failed-refresh action
  pause, manual recovery, Inbox 0 and History reopen. No staging/provider requests.
  The sandboxed attempt could not expose its debugging endpoint; the same bounded
  check succeeded outside the sandbox. This is browser interaction proof with mocks,
  not a real authenticated staging mutation or post-action audit proof.
- Scoped Prettier and diff checks: PASS.

This milestone adds no migration, dependency, IAM change, provider authorization,
or personal-DM eligibility change. Local/mock verification is not live staging proof.
Live synthetic Claim/Resolve feedback and fresh-version sequencing now pass, as
recorded below. Direct transition/audit-row proof remains pending.

The milestone is deployed from `a26b28c7da44ae56c32a8d9dc1bac7cc3c06095c` on
`verify/s22-staging-recovery-capacity`. Image build `37200748224` produced four fresh
immutable images; plan `37201067535` was reviewed and owner-approved with saved-plan
SHA256 `de33c4c9aa43e892e0ca163d5861c1d7d036bcf280bd810be8a1b064f6847865`.
Apply `37275743607` succeeded on `2026-10-05`: 0 creates, 4 in-place workload
updates (API, Web, Worker, Migrator), 0 destroys, 0 replacements. Approved provenance
timestamp `2026-10-04T12:07:31Z` was preserved. No SQL, IAM, networking or secret
changes occurred, and migrator execution was skipped. Post-apply API health returned
`status=ok`; the organization-bound Web shell returned HTTP 200. Neither is
authenticated staff workflow proof.

### Authenticated live read-only verification — 2026-10-05

- Windows desktop UI automation opened the exact organization-bound workspace in a
  new tab of the owner's existing normal Chrome profile. The correct staging origin,
  staff path and organization context were independently checked without extracting
  cookies, tokens, credentials or browser profiles.
- The page initially displayed `Sign in securely`. After owner interaction during
  the check, the real workspace became available. Same-origin `/v1/staff/me` returned
  the authorized `owner` role. No authentication configuration or identity binding
  changed, and no provider onboarding/OAuth was repeated.
- Live layout PASS: Inbox/customer work and conversation details appear before the
  settings/integrations/analytics panels. At the observed desktop viewport the work
  heading was near screen Y=231 and settings began at Y=720.
- Actual History button/card interaction PASS: History loaded one conversation,
  opening its card focused the `conversation` region and scrolled its top from
  screen Y=189 to Y=121. The transcript was nonempty and no Claim/Resolve buttons
  were present. Switching History -> Inbox -> History preserved the selected
  transcript; reopening the History card also retained it and focused the region.
- Live Inbox empty-state PASS: `Inbox 0` and the explicit explanation that there
  is no pending staff work and messages remain in History were visible. Navigation
  requests settled without a stuck loading state or visible list/detail failure.
  Transient loading text was not captured; artificial failures/races were not
  induced. Failure/race handling remains covered only by preserved local tests.
- Read-only same-origin GETs used the browser's native authenticated session and
  tenant context. Only allowlisted IDs, states, versions and counts were observed;
  no customer body, provider account identifier, cookie or token was exported.
  Current authoritative reader results:
  - `/v1/staff/inbox?view=active&limit=25`: empty.
  - `/v1/staff/inbox?view=history&limit=25`: one non-actionable conversation,
    `01a1067f-d7d8-7e7e-9fb0-39bfe2f7cdc7`, status `open`, version **6**.
  - `/v2/staff/conversations/:id`: same ID/version, `automation_mode=ai`,
    `active_handoff_id=null`, participant identity type `instagram_user`.
  - `/v1/staff/conversations/:id/messages?limit=100`: **3** nonempty messages,
    **2 inbound / 1 outbound**, sequence numbers **1, 2, 3**. Bodies are omitted.
  - `/v1/staff/handoffs?view=history&limit=25`: the matching handoff
    `01a1067f-e98f-754e-b5ac-94badf1ca03a`, status `resolved`, version **4**,
    conversation version **6**, `actionable=false`.
  - `/v1/staff/handoffs?view=active&limit=25`: empty.
- These live reads independently confirm persisted post-resolution state and
  transcript preservation for the sole historical Instagram conversation. History
  means no actionable staff work, not deletion or a necessarily terminal conversation:
  the conversation remains `open` in AI mode after the earlier owner Resolve.
- At the time of this read-only check there was no fresh active handoff suitable for
  new Claim/Resolve proof. No mutation was performed, message sent, or unrelated
  record used. Live retained mutation
  feedback, assigned/in-progress handoff labels and successive authoritative-version
  sequencing remain pending a clearly identified owner-approved synthetic handoff.
  A friend may send `Salom, operator bilan gaplashmoqchiman. Menga xodim yordam bera
  oladimi?` to the already connected Instagram account; receipt/handoff creation must
  be observed, not fabricated.
- The current staff/API readers do not expose persisted transition/audit rows. The
  mutation implementation persists coupled state, transitions, audit and Outbox,
  but source inspection and prior tests do not prove the friend's live post-action
  audit. Direct audit evidence remains unavailable through these readers/pending;
  no endpoint or privileged database access was invented.
- Prior 35/35 focused tests and local mocked browser proof remain preserved and
  separate from live evidence. No CI, inventory, deployment or migration was rerun
  for this verification. No staff-workflow defect was observed in the read-only
  checks. This evidence-only update does not require runtime deployment.

### Owner-approved synthetic Claim/Resolve — 2026-10-05

The owner confirmed sending the requested synthetic staff-request DM and receiving
an Instagram reply. That received reply is owner-reported delivery evidence, not
an independently inspected provider receipt. No message content/account identifier
is included here and no additional message was sent by automation.

Live authorized readers identified exactly one pending handoff, new resource
`01a10af4-5167-7835-be16-bcd78d90b1e8`, on the already identified Instagram test
conversation `01a1067f-d7d8-7e7e-9fb0-39bfe2f7cdc7`. It was distinct from the earlier
resolved handoff. Private in-browser matching confirmed a new inbound staff-request
intent; it was not a verbatim match to the suggested test sentence. New inbound
sequence 4 was followed by outbound sequence 5 and another inbound sequence 6.
All six message bodies were nonempty; bodies were not exported. Only this explicitly
owner-approved synthetic work was selected for mutations.

Windows desktop automation used the actual Inbox card and clicked Claim once, then
Resolve once after successful refresh. It did not submit replacement commands via
an operator harness or bypass application authorization/CSRF/version handling.
Existing authorized GET readers independently reported:

| Phase | Handoff status/version | Conversation status/version | Automation | Inbox / History count |
| --- | --- | --- | --- | --- |
| Before Claim | requested / 1 | awaiting_staff / 10 | paused | 1 / not sampled |
| After Claim | in_progress / 3 | awaiting_staff / 11 | staff | 1 / 0 |
| After Resolve | resolved / 4 | open / 12 | ai | 0 / 1 |

- Claim PASS: opening the Inbox card focused the transcript. After Claim the same
  transcript remained open, explicit successful Claim feedback was visible, the UI
  showed `Being handled`, Claim was disabled and Resolve became enabled following
  the normal authoritative refresh. The reader confirmed assignment to the current
  owner without exposing the membership identifier. Resource/conversation versions
  **3/11** were independently read before Resolve; the handoff reader's ETag was
  the exact resource ID with version 3. Intermediate `assigned` UI state was not
  separately observed; its label remains supported by preserved local coverage.
- Resolve PASS: explicit successful Resolve feedback remained visible with the
  selected transcript. Completed Claim/Resolve controls disappeared. Inbox became
  0 with its no-pending-work explanation. Reader results showed
  `active_handoff_id=null`, `actionable=false` for the resolved handoff and matching
  conversation version **12**, not stale version 11.
- History PASS: after navigating to History, Resolve feedback and the transcript
  were still retained. Its sole card reopened the persisted conversation, focused
  the details region (observed top Y=121), and showed no completed handoff actions
  or refresh error. The conversation is `open` in AI mode because the real Resolve
  action uses `resume_ai`; no claim of terminal-conversation resolution is made.
- Transcript preservation PASS: message count **6**, nonempty count **6**, sequences
  **1..6** remained unchanged before Claim, after Claim and after Resolve. Mutations
  did not delete messages or create additional messages in the observed reads.
- Safe read correlation: baseline conversation/handoff requests
  `request:req-2r` / `request:req-2t`; post-Claim `request:req-3k` /
  `request:req-3l`; post-Resolve `request:req-42` / `request:req-43`;
  post-Resolve messages `request:req-44`, Inbox `request:req-46`, History
  `request:req-47`. These are read-response IDs, not mutation audit IDs. All were
  HTTP 200; current handoff ETags reflected versions **1 -> 3 -> 4**.
- No live staff-workflow defect was observed. Failure/race handling was not forced;
  accepted local regression evidence remains distinct from these successful live
  actions. Direct persisted transition/audit rows are still unavailable through
  current authorized staff readers and are **not** marked PASS from UI feedback,
  version progression, source inspection or prior tests. The later owner-supplied
  scoped diagnostic below now closes that persisted-row gap independently.

This continuation changes only the evidence register. No runtime/product code,
schema, migration, IAM, privacy eligibility, credentials or infrastructure changed.
No CI, deployment, provider OAuth or local suite was repeated. S22 remains
unaccepted until the remaining gates are proven.

## Scoped persisted Claim/Resolve evidence checkpoint — 2026-10-05

Status: **PASS for this scoped evidence gap, from owner-supplied live diagnostic
evidence**. The initial local checkpoint was BLOCKED on diagnostic execution;
the successful execution reported below supersedes that blocker, not any other
S22 gate.
The accepted live actions above were not repeated. Evidence baseline is
`66405b6e1918b49e148cd8ed9e08aadb90c479ad`; deployed source remains
`a26b28c7da44ae56c32a8d9dc1bac7cc3c06095c` (only this evidence document differs
between those commits).

Exact diagnostic scope:

| Field | Value / provenance |
| --- | --- |
| Organization | `01a0ee39-91a9-7293-82c0-5b7046c10115`, existing organization-bound workspace |
| Synthetic handoff | `01a10af4-5167-7835-be16-bcd78d90b1e8`, sole pending synthetic handoff identified before the accepted Claim |
| Conversation | `01a1067f-d7d8-7e7e-9fb0-39bfe2f7cdc7`, existing authorized live readers |
| Lower bound, inclusive | `2026-10-05T07:25:46.215Z`, creation timestamp encoded in the exact handoff UUIDv7; Claim necessarily followed creation |
| Upper bound, exclusive | `2026-10-05T07:36:11.000Z`, end of the second containing evidence commit `66405b6` (`2026-10-05T07:36:10Z`), after both actions were recorded |

This is a derived bounded search window, **not** an observed Claim/Resolve timestamp.
The earlier resolved handoff and any thread-control ID are excluded.

Source review established the actual persistence expectations, not live row proof:

- `staff-domain.ts::persistStaffHandoff` invokes `claim_and_start`, through
  `takeHandoffStaffOwnershipWorkflow`. `claimAndStartHandoff` emits two member
  transition records at one operation time: `requested -> assigned`, handoff version
  **2**, then `assigned -> in_progress`, version **3**. Resolve produces
  `in_progress -> resolved`, version **4**, reason `staff_resolved`, disposition
  `resume_ai`. The expected intermediate records explain why one Claim can advance
  **1 -> 3**; their persistence is now supported by the owner-supplied diagnostic
  below, not by source inspection alone.
- `mutations.ts::persistTransitions` writes handoff records to
  `handoff_transitions` (`aggregate_version`, status/assignee changes, member actor,
  disposition/reason, correlation and operation time). There is **no separate
  conversation-transition/history table** in the deployed schema. Conversation
  transition evidence is the canonical envelope in `outbox_events`: version **11**,
  `conversation.automation_mode_changed`, `paused -> staff` while `awaiting_staff`;
  version **12**, `conversation.status_changed`, `awaiting_staff -> open`.
- Both commands atomically persist aggregate updates, transition records, audit
  rows and Outbox events within the existing tenant transaction. Each command writes
  two `audit_events` rows, targeting the handoff and conversation respectively.
  `event_type` and `action` are `<target_type>.transition`, result `succeeded`.
  Allowlisted JSON fields are `staff_operation` and `expected_version`. The latter
  is the **handoff** expected version for both targets: Claim **1**, Resolve **3**,
  not conversation versions 10/11.
- Actor attribution is membership-based: `actor_id` / `actor_membership_id` match
  the authorized membership, not an Auth0 subject or email. The diagnostic compares
  actors to the persisted assignee and a currently active owner membership, without
  exporting membership/user/provider-account identifiers. Paired audit rows must
  match the corresponding event request ID and handoff transition correlation/time.

| Assertion | Result | Evidence / unresolved requirement |
| --- | --- | --- |
| Runtime role, read-only transaction and RLS guard | PASS, owner-supplied live diagnostic | First of nine successful assertions |
| FORCE RLS and runtime-not-owner guard | PASS, owner-supplied live diagnostic | Second assertion |
| Transaction-local tenant context | PASS, owner-supplied live diagnostic | Third assertion |
| Direct current handoff/conversation snapshot | PASS, owner-supplied live diagnostic | Handoff resolved/4; conversation open/12, AI mode, no active handoff; agrees with preserved authorized API evidence |
| Persisted Claim intermediates | PASS, owner-supplied live diagnostic | `requested -> assigned/2 -> in_progress/3`, same owner/time/correlation; `claim_and_start` persists two transitions, explaining the 1 -> 3 jump |
| Persisted Resolve | PASS, owner-supplied live diagnostic | `in_progress -> resolved/4`, `staff_resolved` / `resume_ai` |
| Persisted conversation events | PASS, owner-supplied live diagnostic | Canonical events at versions 11 and 12 |
| Claim target audits | PASS, owner-supplied live diagnostic | Two successful, owner-attributed, correlated audits targeting handoff and conversation |
| Resolve target audits | PASS, owner-supplied live diagnostic | Two successful, owner-attributed, correlated audits targeting handoff and conversation |

The owner reports execution **`lead-agent-staging-migrator-qdnpn`**, completed
**`2026-10-05T09:25:48.952290Z`**, **`succeededCount=1`**, with all nine assertions
PASS. Provenance is the owner's submitted live diagnostic result for the exact
resource scope above and the prepared read-only reader/launcher below. Codex did
not independently fetch execution logs or raw database rows in this continuation.
No Claim, Resolve, diagnostic, migration, deployment or OAuth was repeated.
This closes only the persisted Claim/Resolve transition/audit gap. It does not
establish knowledge publication, live grounding, booking or general S22 acceptance.

Diagnostic preparation/provenance:

- Existing authorized staff readers expose current resources, Inbox and History,
  but no direct transition/audit ledger reader. Their accepted read-response IDs
  above are not substituted for mutation audit correlations.
- The installed local tools have no `gcloud` command; none exists in the three
  standard Cloud SDK installation locations checked. Process-local runtime database
  and GCP credential variables are absent. GitHub authentication is not GCP
  authentication; existing Staging Terraform inputs expose no scoped handoff-audit
  execution. No workflow was dispatched or repurposed to bypass that limitation.
- Prepared outside-repository reader:
  `C:/Users/Lenovo/AppData/Local/Temp/s22-handoff-audit-readonly.mjs`, SHA256
  `1cc3ae55e39d7406f5288c4285a6ad0f51b6ede25e4a4339acee7957a8121f8c`.
  Prepared launcher: `C:/Users/Lenovo/AppData/Local/Temp/s22-handoff-audit-launch.sh`,
  SHA256 `ecf309b5a87966c1b5fe0c50d97a20f20be90507d2b36f86a5895b862e3d43dd`.
  These local diagnostic files are not repository files or deployed product changes.
- Ready execution path is the **existing authenticated Cloud Shell**, using the
  existing `lead-agent-staging-migrator` job only as an execution container. Upload
  both files into one directory, then run `bash s22-handoff-audit-launch.sh` there.
  The launcher checks the reader hash, deployed immutable image, Node command,
  service identity, runtime secret **reference**, private VPC and zero retries.
  It overrides execution arguments/environment only, never updates the job or
  invokes `dist/index.js` / a migration entrypoint. It reads no secret payload
  through CLI, grants no IAM, and aborts on unavailable access/preflight mismatch.
- The reader uses only `DATABASE_URL` (the existing runtime-role secret reference),
  never `MIGRATION_DATABASE_URL`. It starts an explicit repeatable-read **READ ONLY**
  transaction, requires `lead_agent_runtime`, no SUPERUSER/BYPASSRLS, no inherited
  tenant context, and ENABLE/FORCE RLS on the six narrowly needed tables. It sets
  `app.organization_id` transaction-locally with the exact parameterized tenant.
  Runtime SELECT permissions/RLS derive from `0010_s5_tenant_rls.sql` and current
  `runtime/tenant.ts`; no privileged `SET ROLE` or definer bypass is used.
- Connection/statement timeouts are **5 seconds**, query timeout **6 seconds**, lock
  timeout **1 second**, idle transaction timeout **10 seconds**. All resource reads
  bind organization/resource/window parameters and cap rows at 2, 4, 3 and 5
  respectively (expected count plus one, so unexpected extra rows do not pass).
  Successful and unsuccessful exits attempt rollback and connection cleanup.
  The launcher bounds execution polling to 90 seconds and cancels only its exact
  diagnostic execution if necessary; it never automatically retries.
- Output selects only state/version/time/correlation/request metadata, owner-match
  booleans and explicitly allowlisted JSON scalars. No message table/body, contact
  detail, provider account, credential, ciphertext or full JSON blob is selected.
  Errors expose stage plus sanitized code only. Missing structured log evidence
  remains BLOCKED, including ingestion/read-access failures.
- Local preparation evidence: `node --check`, launcher `bash -n` and the exact
  execution-argument async wrapper check PASS (no live imports/credentials/DB);
  **15/15 mocked diagnostic checks
  PASS** (expected rows, connection/query failures with cleanup, wrong role, missing
  FORCE RLS, wrong intermediate version, wrong actor and millisecond mismatch).
  These are not live PostgreSQL checks. No existing suites or CI were repeated.

Owner Cloud Shell preflight follow-up: the first launcher stopped **before execution**
with `private VPC or zero-retry configuration not proven`. The owner's subsequent
filtered, read-only job description reported explicit numeric `maxRetries=0` at
`spec.template.spec.template.spec.maxRetries`. Its network/subnetwork were the exact
approved project/region-qualified resources, encoded inside the JSON annotation
`spec.template.metadata.annotations[run.googleapis.com/network-interfaces]`;
`run.googleapis.com/vpc-access-egress` was `private-ranges-only`. The old combined
guard searched only structured network fields and uppercase egress. This confirms
a **launcher parsing/schema defect**, not a demonstrated live configuration mismatch.
The corrected launcher reads those exact v1 paths, strictly parses the single
network interface, requires an explicitly present numeric retry value of zero,
and reports network, subnet, egress and retries independently. It uses the existing
Node CLI for this isolated JSON guard and stops if Node is unavailable; it installs
nothing. **31/31 focused guard fixtures and `bash -n` PASS**, including the owner
metadata shape and missing/malformed/mismatched/unsafe values. Only the launcher
needs re-uploading; the reader's bytes/hash remain unchanged. No diagnostic job,
migration, deployment or IAM change occurred during this local correction, and
direct persisted transition/audit proof was still pending at that earlier checkpoint.
The owner-supplied successful execution above now closes that scoped gap.

The diagnostic has executed successfully; do not repeat it. The next milestone
is authoritative synthetic business knowledge and the complete
customer-to-confirmed-booking journey.
S22 remains unaccepted; S23 has not started.

## Synthetic business knowledge and booking preparation — 2026-10-05

The versioned fictional fixture, live publication IDs/versions and authorized
journey sequence are recorded in
[s22-synthetic-booking-journey.md](s22-synthetic-booking-journey.md).
The fixture has one consultation, UZ/RU/EN content, an explicit
**UZS 100,000** test price (`10000000` integer minor units), **30-minute** duration,
**Asia/Tashkent**, **Monday–Saturday 09:00–18:00**, and explicit staff
review/customer confirmation wording. It adds no booking-policy JSON, migration,
dependency or availability claim. All five configuration records are now
authoritatively published at **version 1**, with an active Service/Location offering.

The first live read in the existing staging Chrome session was
`GET /v1/staff/me` with the approved organization context. It returned
**HTTP 401 `authentication_required`**, request **`request:req-7`**. No configuration
write was attempted then. After the owner's signed-in workspace screenshot,
authenticated `/v1/staff/me` proved the exact tenant and **owner** role. Complete
configuration lists (`has_more=false`, limit 100) initially contained **zero**
Locations, Services, Prices, FAQs and Business Policies, so no unrelated business
record was replaced or retired. No auth settings, identity binding, membership,
cookies or social-thread eligibility were changed.

Live publication used the native authenticated browser session, existing CSRF,
tenant authorization, stable operation-specific idempotency keys and fresh GET
ETags. After a browser-result capture failed, read-only reconciliation proved all
five inventories still empty and no publication context existed; no write was
blindly repeated. Fixing exact browser-window targeting allowed the authorized
commands to proceed. This was outside-repository automation, not a runtime change.

Mutation response correlations: Location creation/publication `request:req-2l` /
`request:req-2n`, Service creation/publication `request:req-2o` / `request:req-2q`,
offering `request:req-2s`, Price creation/publication `request:req-35` /
`request:req-37`, Qualification V1 creation/publication `request:req-38` /
`request:req-3a`, FAQ creation/publication `request:req-3b` / `request:req-3d`.
Final read-back checks proved exact fixture content, active offering and all five
publication versions: **7/7 live metadata/content assertions PASS**, correlations
`request:req-3u` through `request:req-3z`. The Service root advanced to **4** after
publication/offering/price changes; its immutable content publication remains **1**.
Price's public contract does not expose a content hash; none is invented.

Focused local proof: **60/60 tests PASS** across the new fixture contract tests
(7), current grounded-answer tests (41), and S21 privacy/medical safety tests (12).
Command: `node node_modules/vitest/vitest.mjs run tests/contracts/s22-business-fixture.test.ts tests/ai/grounded-answers.test.ts tests/ai/privacy-security.test.ts`.
Root test-source TypeScript (`node node_modules/typescript/bin/tsc -p tsconfig.json --noEmit`)
and focused zero-warning ESLint PASS. These are deterministic/local tests, not
live Gemini or booking proof. No full aggregate, CI, build, deployment or migration
was repeated for fixture/evidence-only changes.

Model source/configuration readiness is verified, but current resolved-model and
complete bounded cost-ledger proof remain **pending**: the tenant staff API has no
operator COGS/model reader, and this host has no authenticated GCP/database CLI.
A new, separate read-only readiness packet is prepared for existing authenticated
Cloud Shell. It invokes the **existing conversation knowledge reader** for two
synthetic price/duration queries and reads narrowly scoped model/token/cost
metadata. It does not send a customer message, make a model call, execute the
migration entrypoint, update the job or repeat the accepted handoff diagnostic.
Its output must be obtained before claiming live retrieval/model/cost readiness.
The actual customer-to-confirmed-booking journey remains **PENDING**; no customer
confirmation or staff attestation was fabricated.

## Business-readiness wrapper correction — 2026-10-05

**Owner-supplied failed execution:** `lead-agent-staging-migrator-7xb69`, exit **1**,
Node **v24.14.0**, `SyntaxError: Cannot use 'import.meta' outside a module`, at the
reader's `import.meta.resolve('@lead-agent/database')` statement. No execution logs
were independently fetched in this continuation. The exact original generated
container command and unchanged decoded reader reproduced the error locally.
Classification: **DIAGNOSTIC TOOLING FAILURE**, not a failed database/knowledge
assertion. The original wrapper passed reader text to `eval`; the outer
`--input-type=module` did not make eval's Script parse an ES-module parse. Previous
mocked checks replaced the failing import line and therefore missed the defect.

Prepared uniquely named outside-repository launcher:
`C:/Users/Lenovo/AppData/Local/Temp/s22-business-readiness-launch-v2.sh`, SHA256
`d3efe2a0acb6c8895e05e43531a3a520b1f33a601acf8128d2de71f01779d464`.
Reader **unchanged**, SHA256
`70209e45b8dafe2e3e6652cf9daae7c84792288e7f8c4e802f043f551663ae1c`.
V2 feeds decoded UTF-8 bytes to a real `node --input-type=module` stdin subprocess,
with the inherited deployed `/app` working directory and package resolution base.
No eval, temporary `/tmp` module or `data:` module is used. Commas in the bootstrap
remain inside the third Node argument via gcloud's documented custom list delimiter.
The child has a 60-second bound and propagates its status/sanitized bootstrap errors.
All existing image/identity/secret-reference, VPC/subnet/egress, explicit zero-retry,
execution-poll/log and reader transaction/RLS/query/rollback safeguards are preserved.

**7/7 exact-bootstrap subprocess checks PASS** on the same **Node v24.14.0** as the
failed container: reproduce the original parse failure; run the **unmodified reader**
against controlled application packages with actual Node bare/package-relative
module resolution; verify static/dynamic imports, top-level await, `import.meta.resolve`,
module base, UTF-8 and native environment assignment; fail read-only guard with
rollback/close; fail missing-package resolution without fallback; propagate child
exit 7; propagate a module execution error. V2 shell syntax PASS; exact old/v2 diff
contains only the new bootstrap and its argument transport/comments. These are
local controlled subprocess tests, not live database/provider readiness evidence.
Harness path/hash and the one v2 upload/run instruction are recorded in
[s22-synthetic-booking-journey.md](s22-synthetic-booking-journey.md).

Only evidence documents changed in the repository. The reader, deployed source,
images, job configuration, IAM, secrets, migrations and provider settings did not
change. No old/corrected launcher or live migration was executed, no deployment,
paid call, unrelated suite or CI was repeated. **Business readiness remains PENDING**
until the corrected live diagnostic returns results. S22 remains unaccepted.

## Business-readiness result and provenance correction — 2026-10-05

**Owner-supplied** execution **`lead-agent-staging-migrator-xz9mz`** successfully
ran the corrected ESM reader. Runtime/read-only/tenant/RLS and FORCE-RLS/not-owner
guards **PASS**, manifest **12 tables**. Knowledge assertion **FAIL**: price facts
**2**, price retrieved **true**; duration facts **1**, duration retrieved **false**.
Ledger assertion **FAIL**: known subset **0** USD micros, unknown-cost runs **2**,
unfinished runs **0**. The diagnostic itself made **no model calls**. The failed
assertions are not erased; execution logs/raw records were not independently read.

Source and focused reproduction confirm a **diagnostic provenance mismatch**:
Service grounding references use the current **root version**, while the assertion
used publication version **1**. Preserved live fixture metadata records root **4**,
publication **1**, duration **30 minutes**. V3 checks the exact current tenant-bound
publication/hash, duration, offering and Lead selectors independently, then requires
the actual retrieved duration fact to cite that same current Service/root, locale,
need, subject and 30-minute value. No publisher, selector, retrieval, tenant or RLS
boundary was relaxed; no runtime/product code was changed. Expanded live retrieval
proof remains **PENDING** until V3 executes.

One reported run has resolved **`gemini-3.8-flash`**, profile
**`s13-commercial-v1.v1`**, catalog **`ai-provider-prices.2026-09-17.v1`**, input
**520**, output **217**, cost **unknown**. Another has requested model approved,
resolved model **NULL**, catalog **`not-priced.v1`**, grouped units **0**, cost
**unknown**. Grouped COALESCE zero does not prove zero usage, zero cost or no dispatch.
Google's [official model](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash)
and [standard paid rates](https://ai.google.dev/gemini-api/docs/pricing#gemini-3.8-flash)
were checked on **2026-10-05**: USD **0.75 input / 0.075 cached input / 3.75 output**
per million tokens through **2026-12-31**. Existing catalog interval/rates match.
No model, rates, paid tier or budget changes; promotional credits are not spend.

The adapter/parser, `finishAIRun`, catalog and estimator trace is recorded in
[s22-synthetic-booking-journey.md](s22-synthetic-booking-journey.md). Missing cache
usage can reproduce the first unknown cost, but grouped evidence does not expose
its actual cache/total/nulls or individual IDs/time/failure. The second run's dispatch
is **UNPROVEN**, not free. No existing audited historical cost-reconciliation
interface was found; no units, provenance or cost record was overwritten/backfilled.
Both costs remain **unknown**; the cohort is **BLOCKED**, paid calls **PAUSED** under
unchanged USD 5 target / USD 10 hard ceiling.

Prepared outside-repository **V3 reader + launcher**, exact paths/hashes and one
Cloud Shell instruction in the companion document. Reader adds bounded, parameterized
fixture/provenance and per-physical-run nullable metadata reads only. The exact V2
ESM bootstrap and image/identity/secret-reference, VPC/subnet/egress/zero-retry,
tenant/RLS/read-only/timeouts/rollback/cleanup safeguards remain. No migration,
deployment, IAM, job update, secret access via CLI or paid call occurred. Local GCP/
DB access is unavailable; the existing authenticated Cloud Shell is the next
evidence mechanism. No new diagnostic was executed in this continuation.

Local verification: **9/9 new repository regressions PASS**, including UZ/RU/EN
30-minute retrieval with root-version citations, cross-service fail-closed behavior,
symmetrically rejected foreign/stale citations and unknown-usage/pre-dispatch proof.
These are deterministic projection/citation checks, not live RLS/paid-provider proof.
**13/13 exact V3-bootstrap controlled subprocess scenarios PASS**, including incorrect
published/retrieved values, stale/foreign references/selectors, preserved NULL costs,
timeout versus pre-dispatch distinction, unfinished/bound failures and rollback/close.
Root TypeScript, scoped ESLint, formatting, syntax and diff checks PASS. Only focused
tests/evidence changed in the repository; temporary packets/fixtures are untracked
outside it. No unrelated tests, inventory, Claim/Resolve, OAuth or CI were repeated.
S22 remains unaccepted; S23 not started.

## V3 live knowledge PASS; cost ledger remains blocked — 2026-10-05

**Owner-supplied** existing-execution log read-back:
`lead-agent-staging-migrator-snf6q`, `GCLOUD_EXIT=0`, `SANITIZER_EXIT=0`.
Eight log entries contained six structured payloads and six reader assertions:

| Assertion | Result | Safe observed metadata |
| --- | --- | --- |
| Runtime / read-only / tenant guard | PASS | All six booleans true |
| FORCE RLS / runtime not owner | PASS | 12 tables; safe true |
| Current published fixture | PASS | One row; Service root 4/publication 1; duration 30 minutes; selectors/offering true |
| Published conversation knowledge | PASS | Price retrieved true, two facts; duration retrieved true, one fact; root 4/publication 1 |
| Provider/model consistency | PASS | Bounded two runs; individual rows not included in this sanitized read-back |
| Cohort ledger readiness | FAIL | Known-cost subset 0 USD micros; unknown runs 2; unfinished runs 0; paid calls paused |

This closes **only** the scoped live duration/provenance evidence gap. The original
V2 failure remains recorded above; V3 proves the actual reader retrieves the current
authoritative 30-minute Service fact. No runtime, publication, selector or tenant
boundary changed. Provider/model consistency does not prove complete usage, pricing
or invoice/account evidence for both runs.

The failed ledger assertion explains this diagnostic's nonzero exit; the returned
`CONTAINER_EXIT` tag alone is not another proven wrapper/database failure. Earlier
empty queries did not capture their exit status, so their precise cause remains
unproven. Do **not** rerun the reader, migrator or deployment. The next narrowly scoped
read selects only the existing execution's `provider_and_cost_metadata` allowlisted
rows from Cloud Logging, not a new database execution. Exact per-run evidence and
any authoritative reconciliation remain pending; neither cost is assigned zero.

Only these two evidence documents changed. Scoped Prettier and `git diff --check`
PASS; accepted behavioral tests remain unchanged and are not repeated.
No message/contact data, provider account identifier, secret or raw log is recorded.
No paid call, SQL write, migration, job/IAM change, build, deployment, OAuth,
Claim/Resolve or CI run occurred. Unrelated working-tree edits remain untouched.
S22 remains unaccepted; the booking journey is pending and S23 is not started.

## Exact cost-origin evidence and forward parser fix — 2026-10-05

**Owner-supplied**, existing `snf6q` logs, `GCLOUD_EXIT=0`: the two exact runs are
`01a1067f-dfc8-7e14-9e12-89a0e30fd27e` (succeeded, input 520/output 217/total 737,
cache NULL, approved resolved model/profile/catalog) and
`01a10af4-5126-7ce8-ab52-0424e07ab3d9` (failed, all units NULL, resolved model NULL,
`not-priced.v1`, masked `unrecognized` category). Both costs remain **unknown**.
The successful run's exact estimator blocker is cached usage NULL. The failed run's
60 ms elapsed time is not proof of zero dispatch/spend. No record is overwritten.

The first NULL cannot distinguish absent cache field from explicit invalid/null
provider data under the old parser. Google's official
[API proto](https://github.com/googleapis/googleapis/blob/master/google/ai/generativelanguage/v1beta/generative_service.proto)
and [ProtoJSON rules](https://protobuf.dev/programming-guides/json/#presence-and-default-values)
prove legitimate omitted implicit-presence zero counts. The narrow runtime parser
fix handles only **absent** cache with valid reported input/total. Explicit invalid
cache, missing usage and incomplete counts still produce unknown cost. No model,
budget, catalog, retry policy, public contract, SQL write or migration changes.
This fixes future parsing, not historical billing: original allowlisted usage or
authoritative billing evidence and an audited reconciliation path remain missing.
The controlled 1,204-micro fixture result is not assigned to a live run.

Source inspection confirms the diagnostic category allowlist missed `staff_requested`
and two supported incomplete-output categories. A tested, outside-repository packet
now reads **only the two exact historical runs**, preserving runtime/tenant/RLS,
read-only/timeouts/bounds/rollback and image/identity/private-VPC/zero-retry guards.
Paths, SHA256 and provenance are in the companion journey document. It is prepared,
**not executed**; it performs no cost write or paid call and repeats no knowledge
retrieval. The new S16 staff-preflight test proves zero mocked provider calls for
that known source path, **not** that the masked historical run took that path.

Affected local checks: **47 Gemini + 10 readiness tests PASS**, AI typecheck and
production/declaration build, root TypeScript, scoped ESLint PASS; exact new packet
bootstrap **7/7 controlled subprocess scenarios PASS** with NULL preservation and
fail-closed exact-ID/read-only/RLS checks. No live DB, paid call or full CI repeated.
Runtime rollout must use fresh images and a reviewed exact saved plan; no apply yet.
Unrelated README/Instagram edits remain preserved. Paid calls remain paused;
historical ledger/booking/S22 acceptance remain blocked; S23 is not started.

## Cache parser rollout preparation — 2026-10-05

The runtime correction is committed and remotely preserved as
`3b73fdd1c38c98be3f02821902914e1c707d0054` on
`verify/s22-staging-recovery-capacity`. At this plan-preparation checkpoint it was
**not deployed**; the subsequent approved apply is recorded below. Documentation-only
evidence commits do not change this reviewed image source.

One fresh [immutable image build](https://github.com/mufazzalshokh/lead-agent-platform/actions/runs/37313624020)
**37313624020 PASS** for that exact source produced the downloaded manifest below.
All references use `me-central1-docker.pkg.dev/lead-agent-stg-739284/lead-agent/`,
the matching workload name, and `@` followed by the digest:

| Workload | Immutable digest |
| --- | --- |
| API | `sha256:e8593c62f0a4299e94fd45a0f17e5105e619466003cb52de4354ffce345e1707` |
| Web | `sha256:f5850667867a458aea3123ebf6abd2236e1197292b3461a8f92bb3a69a8965b7` |
| Worker | `sha256:f314397aa6c1f4a7b5bad21814be6cf5cb370fa6f0f1fbccb9a74866526f4d18` |
| Migrator | `sha256:fed9986bb4c409c8c821bae0b11b20013c9fa4bc9724441adb47b035c0b3f9f5` |

One [plan-only full-runtime reconciliation](https://github.com/mufazzalshokh/lead-agent-platform/actions/runs/37314501163)
**37314501163 PASS**, source SHA matching, preserved the chosen deployment timestamp
`2026-10-05T13:02:55Z` and migration head
`0031_s22_widget_inbound_route_management`. This is configuration provenance, not
a new migration execution or new independent database inventory proof.

Downloaded artifact:
`s22-terraform-plan-full-3b73fdd1c38c98be3f02821902914e1c707d0054`.
The locally hashed saved binary matches its artifact SHA256:
`443c63a7153df607963b7c8101123d1c89209aab5c4001356ce8251be8345f82`.
Only the sanitized reconciliation summary was printed; raw Terraform content and
secret-bearing state were not dumped.

| Saved-plan action | Exact resource |
| --- | --- |
| In-place update | `google_cloud_run_v2_job.migrator[0]` |
| In-place update | `google_cloud_run_v2_service.api[0]` |
| In-place update | `google_cloud_run_v2_service.web[0]` |
| In-place update | `google_cloud_run_v2_worker_pool.worker[0]` |

Actual counts: **0 creates / 4 changes / 0 destroys / 0 replacements**.
The repository's full-runtime safety gate **PASS**: reconciliation mode, exact
source/images/profile, unchanged identities/private networking/security/scaling
boundaries; public IAM changes **NONE**, unexpected actions **NONE**, migrator
execution **DISABLED**. The exhaustive action allowlist contains no SQL, IAM,
network or secret resource change. GitHub explicitly reports **Apply exact
reviewed plan SKIPPED** and **Execute one-shot migrator SKIPPED**. No infrastructure
was applied and no migration was run.

Exact subsequent apply inputs are prepared outside Git at
`C:/Users/Lenovo/AppData/Local/Temp/s22-cost-origin-rollout-37313624020/apply-inputs-without-approval.json`:
same source, images, timestamp and heads; `action=apply`, `phase=full`,
`plan_run_id=37314501163`, and the exact SHA256 above. No owner approval token is
included in that file. At this checkpoint the inputs had **not been submitted**.
The subsequent apply below used the owner's exact-plan approval, adding the
workflow's approval token only in memory. Never reuse an earlier approval or
regenerate and silently apply a replacement.

Historical costs are still **unknown**; no backfill or paid call occurred. The
cost-origin-only packet was pending when this plan was prepared; its subsequent
owner-supplied live result is recorded below. The reviewed plan was **not applied
at this checkpoint**; the subsequent approved apply is recorded below. Never
bypass a diagnostic's immutable-image guard. S22 is unaccepted;
no S23 work or final aggregate CI was started.

## Cost-origin live diagnostic PASS; accounting gap retained — 2026-10-05

**Owner-supplied** execution `lead-agent-staging-migrator-dlts6`:
`DIAGNOSTIC_STATE=True`, `DIAGNOSTIC_LOG_READ_EXIT=0`. The exact reviewed packet
from the preceding checkpoint passed the image/runtime-secret-reference/identity,
private VPC/subnet/egress and explicit zero-retry preflight. All three reported
reader assertions **PASS**:

| Assertion | Safe observed result |
| --- | --- |
| Runtime / read-only / tenant guard | Least privilege, read-only, row security, runtime, staging database and tenant match all true |
| FORCE RLS / runtime not owner | 12 tables; safe true |
| Exact historical rows | Two exact requested IDs; historical records unchanged; paid calls paused |

The successful run `01a1067f-dfc8-7e14-9e12-89a0e30fd27e` still has input 520,
output 217, total 737 and **cached input NULL**, approved resolved model/profile/
catalog, schema/policy true and cost NULL. No original raw cache-field evidence
was recovered; its cost remains **unknown**. The forward parser correction does
not authorize assigning the controlled 1,204-micro estimate to this historical run.

The failed run `01a10af4-5126-7ce8-ab52-0424e07ab3d9` has the now-unmasked
persisted category **`staff_requested`**, not a provider transport/error category.
Resolved model, schema/policy, output hash and all usage remain absent; cost remains
NULL and catalog remains `not-priced.v1`. This closes the masked-category gap.

Classification: **source-corroborated deterministic pre-dispatch staff request**,
not a demonstrated provider outage or quality failure. Inspection of deployed
source `a26b28c7da44ae56c32a8d9dc1bac7cc3c06095c` confirms Worker uses
`createAppointmentSubmissionOrchestrator` with the recorded S16 prompt. Its
`appointmentSubmissionPreflight` obtains `staff_requested` from the deterministic
human-request predicate; `createAIOrchestrator` evaluates it before `decide` and
finishes with `provider=null`. The finish-time recheck uses that same snapshot
message/predicate; it is not a separate model-derived staff-request classification.
These composition/preflight/orchestrator/persistence files are unchanged between
the deployed source and reviewed parser-fix source. The accepted focused test also
observes zero mocked provider calls for this path. This is a source-correlated
classification of the live record, **not an independent provider billing record**.

The persistence implementation records NULL cost when no resolved model/usage is
available, including this legitimate preflight. No existing audited reconciliation
interface can update this historical accounting safely. Neither historical row,
usage, catalog nor provenance was overwritten. The stored cohort therefore still
has **two NULL-cost rows**; no ledger-ready claim, zero-cost backfill, budget increase
or new paid call is justified. Missing evidence for the real provider call is its
original allowlisted usage metadata or authoritative billing evidence; a historical
reconciliation capability would require a deliberate separately scoped decision.

No further diagnostic rerun is needed. Only the two S22 evidence/journey documents
changed for this result; scoped formatting and diff checks PASS. Existing parser/
preflight tests and build/plan evidence are unchanged and not repeated. No runtime
deployment, migration, IAM/job configuration change, OAuth, Claim/Resolve or CI
occurred at this diagnostic checkpoint. Exact-plan approval was still required
then; the subsequent approved rollout is recorded below.
S22 remains unaccepted; paid calls stay paused and S23 is not started.

## Exact parser rollout applied and verified — 2026-10-05

The owner approved only saved plan **37314501163**, SHA256
`443c63a7153df607963b7c8101123d1c89209aab5c4001356ce8251be8345f82`,
runtime source `3b73fdd1c38c98be3f02821902914e1c707d0054`, the four immutable
images above, deployment timestamp `2026-10-05T13:02:55Z` and migration provenance
`0031_s22_widget_inbound_route_management`. The owner-supplied pre-apply GCS state
comparison reported matching lineage and observed/expected serial **54**.

[Exact saved-plan apply](https://github.com/mufazzalshokh/lead-agent-platform/actions/runs/37321048848)
**37321048848 PASS** completed at `2026-10-05T13:59:57.879157Z`:
**0 added / 4 changed / 0 destroyed / 0 replacements**. The four resources are
exactly those listed in the saved-plan action table above. Saved-plan checksum and
full-runtime scope safeguards PASS; unexpected actions NONE. The dispatch used the
prepared inputs with the workflow's `owner_approval_token` supplied only in memory.
The workflow ran from documentation-only descendant `aa9629ea758e3abd2e40a48390e45a270116cd82`
and checked out the exact approved runtime source; it did not build new images or
generate a replacement saved plan. **Execute one-shot migrator SKIPPED**.

One existing [read-only deployment verification](https://github.com/mufazzalshokh/lead-agent-platform/actions/runs/37321407052)
**37321407052 PASS** used the same source, all four images and reviewed provenance
inputs through `api-image-verify`. Its downloaded artifact
`s22-api-image-live-evidence-37321407052/s22-api-image-live-evidence.txt` has SHA256
`a35f55fb26f542fa873717f677002b78e904effd8e753de8be4322912d5b350e`.

| Post-apply assertion | Verified result |
| --- | --- |
| Live API image and deployment bindings | Exact approved digest, source, timestamp and migration head PASS |
| API security/readiness metadata | Expected identity, private VPC/subnet/egress, 15 secret references and ready revision `lead-agent-staging-api-00017-n9w` PASS |
| Live Web image/readiness | Exact approved digest and ready revision `lead-agent-staging-web-00013-bcz` PASS |
| Whole runtime Terraform convergence | `terraform plan -detailed-exitcode -lock-timeout=5m`, without a saved output plan, returned **0** |
| API health | Bounded `curl.exe` GET `/health` returned `{"service":"api","status":"ok"}` |
| Web reachability | Bounded `curl.exe` GET of the organization-bound staff URL returned **HTTP 200** |

API/Web bindings were read directly from authenticated live service metadata;
Worker/Migrator desired image/provenance bindings are covered by whole-runtime
Terraform refresh/convergence, not a separately reported live descriptor check.
The verification run reports **Create reviewed plan SKIPPED**, **Apply exact
reviewed plan SKIPPED** and **Execute one-shot migrator SKIPPED**. No SQL, IAM,
network or scaling change occurred; no migration or paid model call was executed.
Web HTTP 200 proves shell reachability, not a new authenticated owner/channel or
booking-journey E2E result.

Only this evidence register and the synthetic journey document are updated for
the rollout. No accepted tests/CI, OAuth, Claim/Resolve or diagnostic execution was
repeated. Unrelated user edits remain preserved. Historical NULL costs remain
unchanged; no reconciliation or ledger-ready claim is made. **Paid calls remain
paused; S22 remains unaccepted; S23 is not started.**

## Finite historical accounting and completion audit — 2026-10-05

This checkpoint closes the investigation, **not** the two NULL-cost records or
S22 acceptance. Runtime source remains `3b73fdd1c38c98be3f02821902914e1c707d0054`;
apply **37321048848** and verification **37321407052**, convergence **0**, are
preserved. No image build, deployment, migration, IAM change, model call, OAuth,
Claim/Resolve, inventory or accepted verification is repeated.

### Exact accounting versus budget safety

The authoritative [S20 cost policy](24-s20-analytics-observability-cost.md#cost-policy)
requires complete supported usage and dated exact-model pricing; otherwise cost
stays NULL and derived unit costs stay unavailable. [NFR-017](01-product-and-journeys.md#9-non-functional-requirements-and-initial-slos)
requires at least 99% usage/cost coverage before launch. A conservative reservation
protects a budget; it is not a provider invoice, reconstructed usage, or accounting
coverage. The approved S22 paid cohort remains **USD 5 target / USD 10 hard ceiling**.

For successful run `01a1067f-dfc8-7e14-9e12-89a0e30fd27e`, the original cache
field cannot be recovered from the application record. The old parser collapsed
absent and explicit invalid/NULL cache fields to the same stored NULL. `ai_runs`
retains parsed counters and hashes, not the original usage object/provider response
ID. The hashes cannot recover that field. The forward parser rollout does not
change this historical record. Input **520**, output **217**, total **737** and
resolved model `gemini-3.8-flash` remain the accepted owner-supplied evidence.
The adapter derives output from total minus input, including thinking once; missing
separate reasoning metadata does not justify an extra thinking charge.

Official [Standard Gemini 3.8 Flash pricing](https://ai.google.dev/gemini-api/docs/pricing#gemini-3.8-flash),
checked 2026-10-05, gives USD **0.75 input / 0.075 cached input / 3.75 output** per
million tokens for this run's effective period. [UsageMetadata](https://ai.google.dev/api/generate-content#UsageMetadata)
includes cached tokens within prompt tokens. For any valid cache count from 0 to
520, the recorded token charge is therefore at most **1,204 USD micros
(USD 0.001204)**, rounded upward. This treats all input as uncached only for the
bound; it does **not** assert historical cache usage was zero. The bound covers
this Standard text-only request's recorded token usage, not tax, infrastructure,
other account traffic or an actual invoice. The request supplies no tools,
Search/Maps grounding or explicit cache creation/storage.

For run `01a10af4-5126-7ce8-ab52-0424e07ab3d9`, owner-supplied exact live rows
confirm `staff_requested`, no resolved model/output hash/schema/policy/usage and
NULL cost. The deployed S16 preflight runs before `provider.decide`; its
human-request predicate and finish path agree with the same snapshot and the
accepted zero-provider-invocation test. This is **source-corroborated pre-dispatch
handling**, not an independently persisted dispatch marker or billing proof of
zero charge. It is not a provider outage/model-quality failure. No historical row
is rewritten or classified as exact zero cost.

Read-only recovery availability was checked without exposing credentials:
authenticated GitHub access exists; local `gcloud`, a GCP access-token/credential
path and a runtime DB connection are unavailable. Existing deployment WIF workflows
do not expose an authorized per-request provider billing/usage reader. Google
[request logs](https://ai.google.dev/gemini-api/docs/logs-datasets) are not stored
by default; historical recovery requires logging already enabled for the correct
paid project. Its existence is unverified, not assumed absent. Cloud Billing/
AI Studio [usage and billing](https://ai.google.dev/gemini-api/docs/billing) can lag
and account totals alone do not establish this request's cache split or absence of
another request. No new logging, credential access, permission grant or diagnostic
execution is justified. **Exact reconstruction is unavailable from current
evidence/access; application metadata is irreversibly lossy, while external
historical evidence remains unverified.** Do not continue the same DB diagnostic
or upload loop to seek data the application did not retain.

### Concrete owner decision — proposed, not approved

Permit a **one-time S22 historical budget-reserve exception** for only the two
named runs, without changing their original usage, costs or provenance:

- Carry **1,204 micros** for the successful run's conservative token-cost bound.
- Do not require the second run to be assigned zero. Carry **1,032,192 micros**
  as an uncertainty reservation for one possible Standard text call, using the
  official [model limits](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash)
  of 1,048,576 input / 65,536 output tokens and the dated rates above. This is
  deliberately looser than the application's 4,000-output-token/context/deadline
  caps. It is conditional on the reviewed single physical attempt, exact model,
  Standard text-only path and absence of additional unrecorded cohort traffic;
  it is neither observed usage nor evidence that dispatch happened.
- The historical budget envelope is consequently **1,033,396 micros
  (USD 1.033396)**, not an accounting estimate written to `ai_runs`. Keep both
  NULL rows visible; retain **accounting completeness FAIL** and unavailable
  derived unit costs. Do not reset or move the cohort to conceal them.
- Allow the next synthetic journey only after an accessible, authoritative cohort
  reader and dynamic per-physical-call reservation/stop mechanism are verified.
  Proposed initial bound: at most **three new logical AI turns / six physical
  calls**, counting the existing single schema repair, with no optional calls or
  new transport retries. At the deliberately loose model cap this projects
  **USD 7.226548**, below USD 10 but not a promise to meet the USD 5 target.
  Reserve before each actual physical call, account for all other cohort calls,
  repairs and unresolved usage, and stop rather than exceed the ceiling. A future
  missing-cost result retains its reservation and pauses further paid calls.
- This exception does not approve launch accounting coverage, bypass monetary
  controls, raise budgets, reconcile an invoice, or establish S22 acceptance.
  Source inspection currently proves token/time/attempt limits, **not** aggregate
  monetary enforcement. Owner approval alone does not make that missing gate PASS.

Without this explicit exception or newly available authoritative historical
evidence, **paid calls remain PAUSED**. Current evidence cannot satisfy the strict
zero-unknown cohort gate merely by calculating a bound. The proposed exception is
not automatically applied by this documentation checkpoint.

New local numerical proof used the existing compiled price resolver/estimator,
integer arithmetic and the run date. All **521** valid cache splits were checked;
each is bounded by 1,204 micros, NULL cache still prices to NULL, and the full-model
reservation/projection above was checked. **PASS; zero paid calls/live DB access.**
Temporary proof/desktop-reader files are not versioned. Accepted parser/fixture
tests were not rerun.

### Complete remaining-work map

Sources: [P0 scope/roadmap and release gates](11-adrs-roadmap-risks.md),
[FR/NFR requirements](01-product-and-journeys.md), [release test matrix](09-test-strategy.md),
[S22 freeze](26-s22-staging-recovery-capacity.md), [S21 controls](25-s21-privacy-security.md)
and the [prepared booking journey](s22-synthetic-booking-journey.md#prepared-next-live-booking-milestone--2026-10-05).
Accepted earlier-stage implementation/tests remain valid where unchanged. The
table identifies missing release evidence or a concrete source finding; it does
not reopen those stages or require every local case to be repeated live/paid.
Effort is approximate **active engineering time**, excluding external waiting,
and overlapping rows share one set of observations/tests rather than add up.

| Class / milestone | Exact criterion / repository reference | Requirement / gate | Existing proof | Exact remaining work | Dependency | Active effort | Owner / external action |
| --- | --- | --- | --- | --- | --- | --- | --- |
| S22 blocker · M1 | 26 small paid cohort; [26 paid/load/recovery gates](26-s22-staging-recovery-capacity.md#recovery-and-capacity-gates); [24 NULL-cost policy](24-s20-analytics-observability-cost.md#cost-policy) | Historical accounting and small paid cohort; NFR-017 | Two exact live rows; current forward parser deployed; 521-split bound PASS; new durable guard's three PostgreSQL cases PASS | Approve/reject the narrow reserve exception or obtain actual historical provider evidence; review/apply the new guard's exact deployment plan; retain NULL/coverage FAIL | Before paid journey | 0.5–1 h decision/evidence; control work in row below | One explicit historical-exception/allowance decision and exact-plan approval; billing/logs only if genuinely available |
| S22 blocker · M1 | FR-004–010/012–017/021; [FR/NFR](01-product-and-journeys.md#8-functional-requirements); [09 E2E matrix](09-test-strategy.md#end-to-end-journeys) | Grounded customer-to-confirmed booking; FR-004–010, 012–017, 021 | Five version-1 synthetic publications; duration/price retrieval PASS; approved Gemini profile; Instagram connected | Actual price reply, qualification, one requested appointment, staff acceptance, delivered current offer, explicit customer reply and persisted confirmed evidence; fresh versions after commands | Accounting/controls, existing eligible thread | 1–3 h | Friend's natural question and chosen future date/time; owner acceptance; friend's actual confirmation |
| Retained PASS · M1 request review only | FR-018/020; [FR/NFR](01-product-and-journeys.md#8-functional-requirements); [09 E2E matrix](09-test-strategy.md#end-to-end-journeys) | Staff review/handoff/history; FR-018, 020 | Normal Chrome owner access; Claim 1→3/Resolve 4; conversation 10→11→12; six messages preserved; nine persisted assertions PASS | Preserve scoped PASS; exercise request review/acceptance in booking row and collect only its new evidence; no repeat Claim/Resolve | Booking | Shared with journey | Owner reviews only synthetic work |
| S22 blocker · M2 | FR-001–004/011–017; [FR/NFR](01-product-and-journeys.md#8-functional-requirements); [09 E2E matrix](09-test-strategy.md#end-to-end-journeys) | Widget live embedding/customer journey; FR-001–004, 011–017; S19b | S10/S19 security contracts/regressions and existing UI | Real allowed/disallowed cross-origin host; opaque session, host-token isolation, no third-party-cookie dependence; actual response/request/confirmation/degraded UI | Live origin fixture; M1 allows only the exact Instagram thread; any Widget paid turn needs its own bounded authorization | 2–4 h | Access to approved synthetic embed origin/browser if needed |
| S22 blocker · M2, may run last | [26 real Telegram evidence](26-s22-staging-recovery-capacity.md#explicit-non-goals-and-pending-evidence); [S11 mandatory Business scope](s11-telegram-business.md) | Telegram Business real DM; S11/S22 | Webhook/onboarding security and connected-bot path implementation | Trusted business connection with can_reply, tenant binding, business_message and same business-DM reply; no standalone bot-chat substitution | Product flow first; may run last | 1–2 h plus provider wait | Owner connected-bot authorization and synthetic sender; unresolved provider/UI constraint requires explicit re-scope, not silent PASS |
| S22 blocker · M2/M4 | FR-001–004/013, NFR-001/007/010; [FR/NFR](01-product-and-journeys.md#8-functional-requirements); [09 cross-tenant matrix](09-test-strategy.md#cross-tenant-matrix) | Routing/eligibility, hostile tenancy and webhook integrity; FR-001–004, 013; NFR-001, 007, 010 | FORCE RLS/runtime roles and accepted S5/S11/S21 hostile suites; scoped synthetic guard PASS | Attach live channel binding/eligibility metadata; final release regressions for signatures, replay/reorder, cross-tenant IDs/cursors/pools; unknown/personal traffic remains disabled | Channel evidence + final gate | 1–2 h, shared | None unless a second approved synthetic tenant is needed |
| S22 blocker · M2/M4 | FR-009/011/013–019/025; [FR/NFR](01-product-and-journeys.md#8-functional-requirements); [09 E2E matrix](09-test-strategy.md#end-to-end-journeys) | Remaining P0 state/contact/confirmation edges; FR-009, 011, 013–019, 025 | Existing domain/PostgreSQL/idempotency/consent/S18 regression evidence | Map current deterministic E2E evidence for contact consent/normalization, reject/decline/cancel, fixed expiry boundaries, offline attestation, stale/racing offers, disabled channel, duplicate/reordered effects and knowledge changes; fill actual gaps only | Final coherent release matrix | 1–3 h | Synthetic-only contact/attestation inputs when a live case is necessary; no invented attestation |
| S22 blocker · M2 | FR-022/028; [FR/NFR](01-product-and-journeys.md#8-functional-requirements); 11 S20 source-event reconciliation; [11 S22a/b/S23 criteria](11-adrs-roadmap-risks.md#codex-sized-implementation-roadmap) | Attendance/revenue/funnel; FR-022, 028 | S17 exact-money commands; S20 canonical analytics implementation | Synthetic manual outcome and recorded revenue/correction reconcile to source and funnel; unknown revenue/allocation remains unavailable; no COGS/margin leakage to tenant | Confirmed synthetic appointment | 1–2 h | Explicit synthetic outcome; no claim that a real visit/revenue occurred |
| S22 blocker · M2/M4 | FR-005–008, NFR-012/014; [NFR](01-product-and-journeys.md#9-non-functional-requirements-and-initial-slos); [09 eval gates](09-test-strategy.md#evaluation-records-and-gates) | AI grounding/medical/language safety; FR-005–008; NFR-012, 014 | S13 full 560/model and native review; accepted S14–S21 checks; 60 fixture/grounding/medical tests | Retain unchanged evals; current policy/prompt release regression, schema/unsupported-information/injection/medical tests and channel language samples; accepted wording only, no clinical action | Final matrix; bounded live samples | 1–2 h, shared | No new model evaluation/Claude approval required |
| S22 blocker · M3 staging measurements | NFR-003–006/008; [NFR](01-product-and-journeys.md#9-non-functional-requirements-and-initial-slos); [24 response clocks](24-s20-analytics-observability-cost.md#response-time-semantics); [26 paid/load/recovery gates](26-s22-staging-recovery-capacity.md#recovery-and-capacity-gates) | Meaningful response and staff/ingress SLIs; NFR-003–006, 008 | S20 definitions/instrumentation; provider-only S13 latency | Record counts and p50/p75/p90/p95/p99/max; separate acknowledgment/platform/provider-accepted/render clocks. Test webhook p95≤500 ms, Widget ingress p95≤750 ms, healthy send p50≤4 s/p95≤10 s, staff read p95≤500 ms/p99≤1 s, mutations p95≤800 ms and terminal delivery 99%≤60 s; commercial typical 3–10 s/future meaningful p99≤60 s | Journey + load; raw outage view retained | 2–4 h, shared | No owner timing attestation substitutes for instrumented samples |
| S22 blocker · M3 | NFR-008/011; [NFR](01-product-and-journeys.md#9-non-functional-requirements-and-initial-slos); 11 S20 acceptance; [11 S22a/b/S23 criteria](11-adrs-roadmap-risks.md#codex-sized-implementation-roadmap); [inspected alert source](../../infra/deploy/gcp/staging/monitoring.tf) | Alerts/operational observability/privacy; NFR-008, 011 | Live alert prerequisites; content-free telemetry/tenant projection; current deployments healthy | Actual notification/backlog/DLQ/provider metrics and redaction proof. Concrete source finding: api_errors labels a 1% threshold but uses only 5xx ALIGN_RATE>0.01, without a total-request denominator; correct the ratio semantics before claiming that policy PASS | Scoped alert correction, fresh reviewed plan later | 1–3 h correction; 1–2 h proof | Existing notification recipient verifies delivery if required |
| S22 blocker · M3 | FR-019; [FR/NFR](01-product-and-journeys.md#8-functional-requirements); 11 S22b failure/drain; [11 S22a/b/S23 criteria](11-adrs-roadmap-risks.md#codex-sized-implementation-roadmap) | Outage/degradation/backlog drain | S8/S12/S21 deterministic failure/crash/idempotency suites | Bounded staging provider/channel/DB/worker interruption, no lost/duplicate effects, queue recovery/fairness/pool safety; fake provider for infrastructure stress | Controlled synthetic workload; reviewed changes if needed | 3–6 h | Approved test window; no paid failure calls needed |
| S22 blocker · M3 | 11 S22a; [11 S22a/b/S23 criteria](11-adrs-roadmap-risks.md#codex-sized-implementation-roadmap); [26 rollback](26-s22-staging-recovery-capacity.md#release-and-rollback) | Deploy interruption/rollback/drain; S22a | Immutable current rollout, health and convergence PASS | Actual compatible previous-digest rollback/return, revision readiness and shutdown/drain evidence; do not reverse migrations or reuse old saved plans | Reviewed exact temporary workload plan(s) | 2–4 h | Exact-plan approval only where repository policy requires it |
| S22 blocker · M3 | NFR-009; [NFR](01-product-and-journeys.md#9-non-functional-requirements-and-initial-slos); [26 paid/load/recovery gates](26-s22-staging-recovery-capacity.md#recovery-and-capacity-gates) | Backup/isolated restore; NFR-009 | Completed backup/PITR prerequisites and 52-table/RLS manifest | Separate restored target; representative aggregates/encryption/audit/Outbox/eligibility integrity; measure RPO≤5 min and RTO≤60 min; reviewed cleanup | Fresh isolated recovery plan, current synthetic records | 4–8 h | Exact recovery/cleanup plan approval; no shared DB reset |
| S22 blocker · M3 approved small profile | 26 normal/burst/stress; [26 paid/load/recovery gates](26-s22-staging-recovery-capacity.md#recovery-and-capacity-gates); 11 S22b; [11 S22a/b/S23 criteria](11-adrs-roadmap-risks.md#codex-sized-implementation-roadmap) | Capacity/fairness/storage; NFR-015 | Approved S22 normal 10 tenants/1 msg/s/15 min and burst 25/5 msg/s/5 min; runbook/stop rules | Executable synthetic fake-AI driver, normal/burst/bounded stress, queue/DB/CPU/memory/duplicate/noisy-tenant data and safe envelope. The larger launch target is separated below; this owner-frozen S22 profile does not prove it. | Harness + temporary capacity profile/exact plan | 8–16 h | Approved targets/test window; explicit target revision if measurements require it |
| Initial-launch blocker · L2 (conditional control audit) | NFR-017; [NFR](01-product-and-journeys.md#9-non-functional-requirements-and-initial-slos); [11 production budgets/kill switches](11-adrs-roadmap-risks.md#model-selection-and-operating-budgets) | Monetary/abuse controls; NFR-017 and roadmap budgets | Context/output/deadline/attempt caps; S20 integer cost/NULL handling; staging budget resources | Prove platform/tenant daily/period/velocity and run/conversation monetary warning/hard limits, audited global/tenant kill switches and safe fallback; ≥99% coverage with legitimate preflight accounting semantics. The original staging path lacked this check; new M1 code is a narrow, not-yet-deployed guard. Wider production implementation remains uninspected/conditional, not asserted absent. | Owner budget values + exact scoped control gap; cohort subset before paid work | 4–12 h if implementation missing | Set required production budget/limit values; no budget expansion in S22 |
| Initial-launch blocker · L3 | FR-030, NFR-011; [FR/NFR](01-product-and-journeys.md#8-functional-requirements); [11 counsel/retention deadlines](11-adrs-roadmap-risks.md#open-questions-and-decision-deadlines) | Privacy/provider/legal and subject-right operations; FR-030; NFR-011 | S21 controls/approved UZ-RU-EN medical text; deployed public notices | Retain accepted tests; confirm actual paid Gemini project, processor/DPA/region/health-data suitability, launch law/retention/legal holds and verified audited synthetic subject-request procedure; record whether counsel elevates FR-023 automation | Owner/legal review; synthetic operational drill where not already proven | 2–4 h engineering; external review separate | Product/privacy/legal decisions; no secrets requested or health-data claims inferred |
| S22 blocker · M3/M4 (uninspected gaps conditional) | NFR-010/011; [NFR](01-product-and-journeys.md#9-non-functional-requirements-and-initial-slos); [25 S22 threat delta](25-s21-privacy-security.md#s21-threat-model-delta); [11 S10 aggregate-rate deferral](11-adrs-roadmap-risks.md#s10-approved-widget-trust-decisions) | Rotation/revocation/rates/operator security; NFR-010 | Accepted S6/S10/S21 auth/RBAC/security regressions; distinct runtime identities | Current-release secret/dependency/container scans, operational rotation/revocation/break-glass/DLQ controls and shared-instance rate-limit proof; no unresolved critical/high finding; first verify whether logging.viewer still exists; only an exact isolated removal if present/unneeded. Other uninspected operational gaps are conditional | Final scans and bounded operator exercise | 2–6 h, shared | Operator test window; repository-required exact-plan approval if removal needed |
| S22 blocker · M2 | NFR-013/014; [NFR](01-product-and-journeys.md#9-non-functional-requirements-and-initial-slos); [09 E2E matrix](09-test-strategy.md#end-to-end-journeys) | Accessibility/localization/current UI; NFR-013, 014 | Accepted S19/S13 tests and live staff history/action feedback | Targeted keyboard/screen-reader/approved-browser EN/RU/UZ staff/Widget journey smoke for changed surface; no client-only authority | Booking/Widget workflows | 1–3 h, shared | Supported test browser/device access |
| S22 blocker · M4 | 11 S22a/b gates; [11 S22a/b/S23 criteria](11-adrs-roadmap-risks.md#codex-sized-implementation-roadmap); [09 release gates](09-test-strategy.md#ci-and-release-gates); NFR-016; [NFR](01-product-and-journeys.md#9-non-functional-requirements-and-initial-slos) | Final authoritative gate/promotion; NFR-016; S22 completion | Earlier-stage CI preserved; current rollout/provenance PASS | One pnpm ci:verify on coherent final tree, real PostgreSQL/builds/contracts/boundaries, affected security/privacy audit; exact verified fast-forward/main equality/local cleanup, remote cleanup best-effort | All actual S22 gates above | 1–2 h plus CI runtime | Repository access; no ceremonial repeat aggregate |
| Initial-launch blocker · S23 (not started) | 11 named S23 go/no-go; [11 S22a/b/S23 criteria](11-adrs-roadmap-risks.md#codex-sized-implementation-roadmap); NFR-002; [NFR](01-product-and-journeys.md#9-non-functional-requirements-and-initial-slos); [11 ROI/cohort/placement decisions](11-adrs-roadmap-risks.md#open-questions-and-decision-deadlines) | Initial-launch go/no-go and claims; S23 review only, NFR-002 | S22 isolated Doha staging freeze and planning SLOs; no production readiness claim | Named release approval/on-call/runbooks, production region/residency/HA/provider/retention decisions, monthly 99.9% availability/error-budget measurement model, defensible cohort/baseline/sample-size ROI and cost evidence. Brief staging samples do not prove monthly availability or commercial ROI | S22 accepted and all P0/NFR evidence; S23 separately authorized | 2–4 h review; external decisions separate | Owner + security/privacy/SRE/product sign-off; S23 is not started |
| S22 blocker · M2 provider evidence | [25 paid Gemini controls](25-s21-privacy-security.md#gemini-paid-api-data-controls-checked-2026-09-19); [26 real provider evidence](26-s22-staging-recovery-capacity.md#explicit-non-goals-and-pending-evidence) | Actual paid-project/privacy eligibility | Approved model/profile and S21 data controls retained | Verify existing owner approval provenance for the actual paid project/processor where required; absence is not assumed. Synthetic data never establishes clinical-data readiness | Before applicable live use | 0.5–1 h if evidence missing | Only a specific genuinely missing provider/privacy decision |
| Initial-launch blocker · L1 sizing | NFR-015; [NFR](01-product-and-journeys.md#9-non-functional-requirements-and-initial-slos); [09 performance/load](09-test-strategy.md#performance-load-and-recovery-tests) | Larger launch capacity/storage assumptions | Targets, not measured capacity | Measure 100 organizations / 1,000 concurrent conversations / 50 msg/s burst before production sizing; annual message-growth assumptions remain planning inputs. Explicit owner revision if changed | S22 small profile reused | 4–8 h additional if distinct | Production sizing/target decision; no silent downgrade |
| S22 blocker · M3 infrastructure cost envelope | [26 cost envelope/OFF procedure](26-s22-staging-recovery-capacity.md#pre-apply-cost-envelope) | USD25 target / below USD50 hard ceiling | Dormant/active estimates, configured alerts | Attributable actual test-window usage, OFF procedure and bounded schedule; Terraform budget alerts only notify, never prove an enforced dollar cap | Shared M3 window | 0.5–1 h | Approved test window, no budget expansion |
| Later improvements · separately approved P1/P2 | FR-023/024/027/029; [01 priorities](01-product-and-journeys.md#11-priorities-beyond-mvp); [11 future seams](11-adrs-roadmap-risks.md#future-integration-seams) | Productized rights UX, expanded operator tooling, reminders, billing, calendars, configurable booking policies/read receipts | Accepted audited manual rights path and fixed S18 expiry retained | Not S22 blockers and not implemented here; rights automation priority changes only if the documented counsel gate requires it | Future approved scope | None now | Separate future authorization |

The older roadmap P2 Instagram wording is superseded by the accepted mandatory
S11 Instagram decision, not permission to omit its S22 proof. WhatsApp, external
calendars, subscription billing/invoices, reminders and new configurable booking
policies are not introduced here. FR-023/024/029 productized extras remain deferred
unless the already documented legal gate changes that priority. Fixed S18 expiry
is the accepted P0 policy, not a new configurable-policy request.

### Shortest execution sequence and evidence limits

The corrected table above assigns each gate to its actual repository criterion.
M1 is bounded synthetic booking; M2 is the remaining customer/channel/P0 matrix;
M3 is operational rehearsal; M4 is final verification/promotion. L1–L3 and S23
are initial-launch evidence/decisions, not new work silently added to S22. Later
P1/P2 improvements are not blockers. The owner-frozen small S22 capacity profile
does not replace or prove the larger NFR-015 launch target. Uninspected findings
remain conditional; existing accepted evidence is retained.

1. Settle the narrow historical decision and verify the accessible cohort
   reservation/reader gate. In parallel prepare the fake-provider load/restore
   work from existing tools; do not manufacture historical accounting or ask for
   another temporary upload merely to read the same NULLs.
2. Complete one synthetic Instagram booking using the already published fixture
   and eligible thread. Collect timing, current versions and funnel metadata
   during it; consolidate any necessary immutable booking/audit evidence read
   after completion rather than one diagnostic per transition.
3. Complete Widget and remaining deterministic P0/language/permission cases,
   recorded outcome/funnel and operational telemetry. Batch actual discovered
   runtime defects into one coherent milestone with focused checks and one fresh
   reviewed rollout, if needed; no repeat Auth0/OAuth/fixture publication/S13 eval.
4. Reuse one fake-provider workload for latency/capacity/noisy-tenant and bounded
   failure/drain proof. Complete isolated restore and compatible workload rollback
   under their actual exact-plan approvals; collect the common metrics once.
5. Finish real Telegram Business DM last if externally blocked. Then one final
   authoritative CI/promotion when the complete evidence is ready. S23/launch
   review requires separate authorization, not automatic progression.

No existing PASS is broadened: source corroboration is not a persisted no-dispatch
event; a reserve is not exact cost; Web 200 is not owner E2E; provider latency is
not channel TTFR; queued/published Outbox is not customer delivery; configured
alerts/backup are not notification/restore proof; convergence is not rollback;
small-profile capacity is not the initial-launch profile; public notices are not
legal/processor approval. Scoped Claim/Resolve evidence is already closed and
must not be repeated. Historical pending headings are chronological checkpoints,
superseded only by the later explicitly scoped PASS results.

Fresh read-only desktop preparation in this task failed closed before any API
request because the script's exact workspace/context guard could not match;
the subsequent metadata-only attempt could not activate the exact existing
Chrome window. No further desktop retry or authentication diagnosis was performed.
This is **fresh browser-access BLOCKED**, not a new Auth0 regression or evidence
that the fixture changed. Existing publication/retrieval/owner-session evidence
is preserved; the actual next live execution still needs an accessible owner
workspace and fresh authorized resource reads.

## Bounded booking-readiness packet — 2026-10-05

Preparation from `94a27b2d5632f488d35baf5fe33e8c3ce022880f`. The completed
parser rollout/verification and original historical NULLs are preserved. This
milestone changes the missing dispatch control, not model selection, pricing
semantics, social eligibility, or protected booking authority. No paid calls,
staging deployment, live migrations or IAM changes are authorized by this packet.

### Existing enforcement and the actual gap

The opt-in evaluation ledger in `tests/ai-evals/budget.ts` is process-local and
not the live Worker's gate. Before this change, the live orchestrator enforced
finite text/context/output/deadline and one schema repair, but its `ai_runs`
reservation was an attempt record, **not a monetary reservation**. Queue retries
and different workers could therefore create further calls without an aggregate
ceiling check. The repository's 32 stored-attempt ceiling is not a paid-cohort
money limit. No production-wide budget/kill-switch absence is inferred from
that narrower inspection.

New private `s22-synthetic-booking.v1` configuration gates the actual Worker
composition and exact approved organization/conversation only. All new staging
images default to **paused**. Deployment alone cannot enable calls. Non-staging
behavior/transport retries remain unchanged; explicit journey activation outside
staging fails configuration validation. There is no new public API, table,
dependency, billable tool, tenant-supplied budget or booking policy.

The guard uses the existing runtime role, transaction-local tenant context and
RLS. It locks the same conversation row across workers/processes, reads bounded
tenant metadata, and commits an immutable `ai_run.dispatch_reserved` audit marker
before `provider.decide`. No DB lock remains held through the provider request.
`ai_run.journey_started` and finish `dispatch_authorized` record new execution-path
provenance; they never manufacture historical no-dispatch evidence. The safe
private reader reports counters, integer cost/reserve totals and stop reasons,
without bodies/provider account IDs/secrets. It always retains
`accountingComplete=false` for the historical exception.

- At most one unsettled authorization; concurrent contenders cannot reserve a
  second call while the first is in flight.
- At most three distinct paid trigger messages, six committed physical call
  slots, and two slots per message, across restarts, queue retries and repairs.
  A slot is conservative authorization, not proof a request reached/billed at
  the provider; even an abort after reservation cannot silently refund it.
- Before each slot: historical reserve + known subsequent cost + retained
  unresolved reservations + next reservation must be **strictly below USD 10**.
- Timeout, missing usage/cost, unknown commit/provider outcome, crash, deleted
  run with a durable marker, duplicate/lost markers, unexpected history/model,
  wrong tenant/thread, stale conversation or unavailable dated pricing fail
  closed. Unknown dispatched cost retains the entire reservation and pauses
  further paid calls. No timeout refund or blind paid retry is introduced.
- Schema repair requires a separately committed slot, and only known complete
  first-attempt cost can release its unresolved reserve. Original provider
  counters/provenance and historical NULL cost columns are never reconciled or
  overwritten by the reader/guard.

### Enforced limits and monetary bound

| Quantity | Bound / evidence |
| --- | --- |
| Provider/config | Google Gemini API, paid Standard text path, `gemini-3.8-flash`, low thinking, stateless AgentDecision.v1 JSON |
| Input | Application context ≤20,000 characters, message ≤4,000, ≤12 history entries/24 facts; these do **not** prove a character/token conversion. Reserve using the provider-enforced documented 1,048,576 input-token maximum, including request/schema overhead |
| Output | Explicit one candidate, maxOutputTokens=4,000. Google's hard cutoff includes thinking; do not add a second 65,536-token reasoning allowance |
| Deadline / attempts | Exact staging 15,000 ms application deadline; zero transport retries; at most one separately authorized schema repair and two paid slots per message across jobs |
| Enabled extras | No Search/Maps/tools, media, priority, explicit cache creation/storage or provider conversation state. Implicit cached input is included in prompt count; full uncached input pricing upper-bounds it |
| Dated rates | USD0.75 input / USD3.75 output per million; cached input USD0.075. Exact model/rates and valid-through gate checked; no authorization at/after 2027-01-01T00:00:00Z |
| Per-physical-slot reservation | (1,048,576 × 750,000 + 4,000 × 3,750,000) / 1,000,000 = **801,432 micros / USD0.801432**, integer arithmetic/round upward |
| Historical reserve (unapproved) | **1,033,396 micros / USD1.033396** for the two named runs, unchanged from the owner's pending proposal; not exact cost or permission to spend |
| Additional maximum journey allowance (unapproved) | 6 × 801,432 = **4,808,592 micros / USD4.808592** |
| Maximum combined token exposure | **5,841,988 micros / USD5.841988**, below the existing USD10 hard ceiling; above the USD5 target at worst case, not expected typical spend |

Official sources checked 2026-10-05: [model input limits](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash),
[dated Standard pricing](https://ai.google.dev/gemini-api/docs/pricing#gemini-3.8-flash),
[thinking/output hard cutoff](https://ai.google.dev/gemini-api/docs/generate-content/thinking),
[cache/total usage semantics](https://ai.google.dev/api/generate-content#UsageMetadata).
This tighter future-call bound supersedes only the earlier deliberately loose
future allowance/projection. The historical USD1.033396 proposal remains intact.
Reservations are bounds, not invoices/accounting estimates, and exclude tax,
infrastructure and unrelated provider-account activity. This is one identified
staging cohort, not account-wide billing enforcement or production NFR-017 PASS.

### Exact decisions, checks and rollout boundary

Owner decision still required: approve or reject carrying USD1.033396 as the
historical uncertainty reserve **while both original costs remain NULL and exact
accounting remains FAIL**, plus at most three new logical AI messages/six paid
slots (USD4.808592 additional bound, combined USD5.841988). Accept the disclosed
worst-case target overage without increasing USD10, or explicitly choose a tighter
allowance before activation. This does not waive launch accounting/kill switches,
authorize Widget/another thread/optional calls, or establish S22 acceptance.

Local completed evidence: 105 affected dispatch/orchestration/production-config/
Gemini request tests PASS; final modeled-ledger/state-selector group **19/19 PASS**
(14 ledger, five actual Node subprocess state-selector tests); root TypeScript
PASS after correcting branded fixtures and the Uint8Array output-hash fixture.
The modeled transport exercises actual tenant/session/query guards, but is NOT
PostgreSQL row-lock/RLS proof. Three focused PostgreSQL cases are registered for
real serialization/audit persistence, unknown-cost retention and separately
priced repair/cross-tenant denial.

Local PG17 proof was unavailable: no test DB URL, Linux engine did not return
metadata in its bounded check. The single installed-Docker startup caused host
memory-allocation failures. Only the task-started Docker processes/VM were stopped;
no installation, update, repair or configuration change. Interrupted OOM checks
are not PASS. The narrow `s22-booking-budget.yml` push job runs only the three new
cases on a disposable PostgreSQL 17.11 service, no staging environment/WIF/provider
credentials and no `ci:verify`; database creation/migrations are test-only.
Focused GitHub run **37340223769**, source
`f523ba330c7b1dcffe8a18d22a65d0dea6d7b40d`, completed successfully. The exact
`S22 durable synthetic booking budget` group passed **3/3** on PostgreSQL 17.11
(447 unrelated master-suite cases skipped): independent guards serialize one
committed reservation; timeout/unknown cost retains the reservation and prevents
a new-process retry; schema repair reserves its separate slot and cross-tenant
dispatch/read is denied. This proves the scoped persisted control, not a live
staging booking or the full PostgreSQL aggregate. No final aggregate is consumed.

Completed local checks: the final three new groups **30/30 PASS** (14 modeled
ledger, 11 orchestration/request/config, five deployment-state Node subprocess
cases); scoped ESLint **zero warnings/errors**, Prettier and Terraform formatting,
changed-shell `bash -n`, root TypeScript and affected production/declaration builds
for config, application, AI, database and Worker **PASS**. The final changed DB
build also PASS. Scoped diff check is clean; the unrelated existing trailing space
in `s11-instagram-business.md` remains untouched. This does not waive real
PostgreSQL or claim a deployment result.

Tracked deployment input `ai_journey_mode` defaults to **preserve**; Terraform/new
runtime default is **paused**. The workflow reads only the safe mode from current
authoritative remote state, preserving it in unrelated API/migrator/load phases.
An explicit mode change is full-runtime-only. The saved-plan checker binds the
chosen mode and exact Worker environment. Invalid/foreign/duplicate state fails
closed without dumping state. Planning cannot act as historical approval.

### Fresh reviewed rollout packet — not applied

Source **`f523ba330c7b1dcffe8a18d22a65d0dea6d7b40d`** is pushed to
`verify/s22-staging-recovery-capacity`. Image build **37340460397 PASS**, scope
`all`, checked out this exact source and verified four immutable linux/amd64
references. Later evidence-only commits do not change this runtime source.

All image references use
`me-central1-docker.pkg.dev/lead-agent-stg-739284/lead-agent/<workload>@sha256:<digest>`:

| Workload | Fresh immutable digest |
| --- | --- |
| API | `62f0cce724667068d106ef94e0636b388cec7c63a48acbe7da7e80b52a895359` |
| Web | `ba4e89f3b73788b91b1768a7db7486386df4b6f69711d590f40eb5802e666b41` |
| Worker | `ebdd10763876631af48baea838814a37f7cc397088a1810991f4f36b52509669` |
| Migrator | `612db330f27d25a9b6c92c05d361bee86ba59e6ff03e0e61c646eef4d1b476fd` |

Exactly one fresh **plan-only** full reconciliation run **37341267014 PASS**:

- Timestamp: **`2026-10-05T16:28:09Z`**; migration provenance remains
  **`0031_s22_widget_inbound_route_management`**.
- Saved plan SHA256, independently recomputed from the downloaded binary:
  **`08aaf4d68fa2c46a7f3130961ddd9c46b83492b7b8b7b32f07d97bcec65503d3`**.
- GCS staging backend; saved-plan state lineage
  `ad1c3000-d52f-06eb-de1b-53ae4d67f63e`, serial **55**. Native saved-plan
  staleness/lineage checks still apply at execution; this review does not approve
  a replacement plan if state changes.
- Actual **0 creates / 4 in-place updates / 0 destroys / 0 replacements**:
  `google_cloud_run_v2_job.migrator[0]`,
  `google_cloud_run_v2_service.api[0]`,
  `google_cloud_run_v2_service.web[0]`,
  `google_cloud_run_v2_worker_pool.worker[0]`.
- Full-runtime safety checker PASS. Independent local JSON review kept raw
  secret-bearing plan content internal and confirmed the four source/image
  bindings, timestamp, migration head and proposed `ai_journey_mode=booking`.
  Every known changed field is an image/provenance label/environment binding
  or the Worker's new `AI_JOURNEY_MODE`; computed fields were excluded. No SQL,
  IAM, networking, scaling, secret references/values or security-boundary change.
- Every apply step and one-shot migrator execution **SKIPPED**. No new migration,
  runtime deployment, OAuth, paid model call or IAM change occurred.

Prepared subsequent apply inputs, **not dispatched**:

| Input | Exact prepared value |
| --- | --- |
| Workflow / ref | `staging-terraform.yml` / `verify/s22-staging-recovery-capacity` |
| action / phase | `apply` / `full`, only after both decisions below |
| commit_sha | `f523ba330c7b1dcffe8a18d22a65d0dea6d7b40d` |
| deployment_timestamp | `2026-10-05T16:28:09Z` |
| api_image / web_image / worker_image / migrator_image | Exact four references above, from build 37340460397 |
| api_git_commit_sha / migrator_git_commit_sha / runtime_git_commit_sha | Same exact source `f523ba330c7b1dcffe8a18d22a65d0dea6d7b40d` |
| api_deployment_timestamp / migrator_deployment_timestamp / runtime_deployment_timestamp | Same preserved timestamp `2026-10-05T16:28:09Z` |
| api_migration_head / runtime_migration_head | `0031_s22_widget_inbound_route_management` |
| ai_journey_mode | `booking`, a proposal until the pending historical-reserve/allowance decision is approved |
| plan_run_id | `37341267014` |
| approved_plan_sha256 | `08aaf4d68fa2c46a7f3130961ddd9c46b83492b7b8b7b32f07d97bcec65503d3` |
| owner_approval_token | **Withheld; no approval token supplied** |

Owner must explicitly decide on (1) the USD1.033396 historical uncertainty reserve
plus USD4.808592 additional six-slot allowance, combined USD5.841988 and disclosed
USD5 target overage while exact historical accounting stays FAIL/NULL; and
(2) applying only this exact saved plan/source/hash with booking mode. No
replacement plan, broader cohort or extra spend is covered. This rollout does
not reconcile historical costs, satisfy production accounting, or accept S22.

Before enabling booking, verify a single new-image Worker, no legacy in-flight
paid activity, and a fresh safe cohort snapshot with exactly the reviewed history.
Owner/customer actions remain in the [prepared journey](s22-synthetic-booking-journey.md#prepared-next-live-booking-milestone--2026-10-05):
fresh authorized tenant/conversation/request read; friend asks the natural price
question, supplies an actual future preference; owner accepts only the resulting
synthetic request; after receiving the actual offer the friend explicitly confirms.
Deterministic confirmation itself does not consume a model slot. Never repeat the
closed Claim/Resolve or OAuth work, impersonate a customer or fabricate attestation.

## Approved bounded booking activation — 2026-10-05

Owner explicitly approved the one-time **USD1.033396** historical budget reserve,
**USD4.808592** additional six-slot allowance and **USD5.841988** combined bound,
including the USD5 target overage; USD10 remains unchanged. The two historical
costs remain NULL and exact accounting/coverage is not waived. Only the named
synthetic Instagram conversation, three paid messages and at most six physical
slots are authorized, after live readiness verification. No extra paid tests.

The owner also approved only source `f523ba330c7b1dcffe8a18d22a65d0dea6d7b40d`,
saved plan **37341267014**, SHA256
`08aaf4d68fa2c46a7f3130961ddd9c46b83492b7b8b7b32f07d97bcec65503d3`,
timestamp `2026-10-05T16:28:09Z`. Exact apply **37342528348 PASS**:
checksum/full-plan approval guards PASS; **0 added / 4 changed / 0 destroyed**,
no replacements; migration execution SKIPPED. No rebuild, replacement plan,
OAuth, migrations or IAM change. The prepared packet above is retained as the
chronological pre-approval checkpoint, not a statement that approval is still
missing after this section.

Read-only post-apply verification **37342852295 PASS**: API/Web reviewed images,
source/timestamp/migration provenance, runtime identity/private VPC, readiness
and **whole-runtime Terraform convergence exit 0**. New ready revisions:
API `lead-agent-staging-api-00018-zmv`, Web `lead-agent-staging-web-00014-tcz`.
Independent API `/health` and organization-bound Web reachability both HTTP200;
this is not a fresh authenticated browser proof or a completed booking.

The remaining live cohort snapshot is not substituted by source/unit tests.
Read-only `booking-evidence` tooling is prepared in the existing WIF-allowlisted
staging workflow, not a new identity/trust grant. It checks reviewed Worker/
Migrator metadata and runs only an ES-module reader override in the existing
immutable diagnostic image. No job configuration change or migration entrypoint;
runtime DB role, default read-only transaction, transaction-local tenant/RLS,
FORCE RLS/not-owner checks, parameterized bounded metadata queries, short timeouts,
rollback on every transaction exit and pool cleanup. It uses the deployed
`createAIJourneyBudgetGuard.read`, never its reservation/write methods and never
constructs a model provider. Original historical NULLs are checked independently.

Only allowlisted state/version, offer/delivery metadata and integer ledger
counters/totals are retained; no message bodies, provider account identifiers,
secrets, ciphertext or complete audit blobs. Existing logging permission must
suffice; failure is BLOCKED and cannot justify IAM broadening. The exact existing
execution/log read is the recovery path, never a blind diagnostic rerun.
Initial stage additionally requires zero new paid slots/pending reservations and
no existing synthetic request; observe stage permits subsequent scoped progress
reads but still fails on unknown cost, timeout/reservation or exhausted gate.

Local new-tool verification: **6/6 focused Node tests PASS**, including exact
Node subprocess ES-module/bare-package/relative-runtime resolution with controlled
application fixtures, fail-closed missing/string retries, identity/secret/network/
source/gate checks and safe-output projection. No DB or model call in these tests.
A preliminary all-package Windows import probe exceeded its 15-second host window
and is not claimed as a PASS; fixture resolution is separate from live validation.
Prior runtime/PostgreSQL evidence is reused, not rerun. The live cohort result and
first customer action remain pending until this new read completes.

Initial read-only run **37344869596** stopped with `WORKER_SCALING_MISMATCH`
before a diagnostic execution or paid call. Confirmed tooling/REST-schema defect:
the verifier incorrectly expected the service-only `scalingMode` in Worker Pool
v2 metadata. Google's [WorkerPoolScaling contract](https://docs.cloud.google.com/run/docs/reference/rest/v2/projects.locations.workerPools#WorkerPoolScaling)
contains only `manualInstanceCount`. Corrected to require an explicit numeric
one and reject unexpected scaling fields; absence, zero, string one and count two
remain failures. Original explicit-zero-retry, identity/image/VPC and read-only
safeguards are unchanged. The actual deployment is not changed or repeated.

Corrected read-only run **37345335247**, tooling source
`5bb12816f783f6416c7d88276eaffd4cb2720c1b`, verified the deployed Worker image/
runtime source, `booking` mode, explicit `manualInstanceCount: 1` and private VPC.
The reviewed Migrator image, runtime-database secret reference, private VPC and
explicit numeric zero retries also passed. Only the read-only execution override
ran: **`lead-agent-staging-migrator-vlcsh` SUCCESS**. Reader SHA256:
`8b3cef6cea0306510eb5ed63737608f59998dda139b100204c0beec1f25d36e7`.
No paid calls, migration execution, job configuration change or IAM change.

The workflow then stopped with **`EXACT_EXECUTION_LOG_READ_BLOCKED`**. Its
sanitized artifact contains `execution_succeeded: true` but an empty assertion
list: individual observed database/gate counters have not been collected. An
execution exit code is not substituted for those persisted results. The tooling
does not expose the failed logging command's raw stderr, so no specific permission
or transport cause is inferred. The only next operation is an owner-authenticated,
bounded Cloud Logging read for this exact existing execution and operation
`s22_booking_readonly`; no file upload, diagnostic rerun or permission grant.
The first paid customer message remains paused until those assertions are read
and checked. Historical NULL costs and the accounting gap remain visible.

The Worker metadata correction passed two focused Node cases (positive actual
REST shape and strict invalid/missing scaling cases), scoped lint, formatting
and diff checks. These overlap the earlier six-case run: seven distinct cases
are covered, not eight. No broad CI, runtime rebuild or deployment was repeated.

## Remaining gates

### First authorized booking turn investigation — 2026-10-05

Owner reports all seven baseline assertions, including `first_turn_readiness`,
PASS in `lead-agent-staging-migrator-vlcsh`. This closes only the previously
missing baseline result collection as **owner-supplied live evidence**; it is not
an independently retrieved snapshot. Original historical NULL costs remain.

The same approved friend sent the synthetic service price/duration question at
**2026-10-05 22:23 Asia/Tashkent / 17:23 UTC** in the exact cohort conversation
`01a1067f-d7d8-7e7e-9fb0-39bfe2f7cdc7`, organization
`01a0ee39-91a9-7293-82c0-5b7046c10115`. No reply was observed by 17:25 UTC
(owner-reported observation, not a persisted delivery result). No second message,
replay, provider test or paid retry is requested.

Existing read-only `booking-evidence`/`observe` run **37348693103**, tooling source
`dd9ae224af49cf54d19be26ff9c1f03711de8d5c`, verified the reviewed Worker source,
image, `booking` mode, one instance/private network and diagnostic safeguards.
Reader SHA256 remains
`8b3cef6cea0306510eb5ed63737608f59998dda139b100204c0beec1f25d36e7`.
Read-only execution **`lead-agent-staging-migrator-ncxqw` SUCCESS**; result
collection **BLOCKED: `EXACT_EXECUTION_LOG_READ_BLOCKED`**, assertion list empty.
The artifact's `paid_calls: 0` describes the diagnostic, not the customer's turn.
Webhook persistence, eligibility/queue processing, actual dispatch slots, new
usage/cost and outbound state/error are therefore not yet independently proven.
No specific product root cause is asserted and no runtime correction is made.

Next: owner-authenticated, bounded Cloud Logging read for this exact execution's
`s22_booking_readonly` rows and only relevant webhook/tenant Worker log metadata
in 17:22–17:27 UTC. Do not print message bodies, raw provider/error payloads,
headers, account details or credentials. No uploads, rerun, permission expansion,
deployment, migrations or unrelated tests. Further paid messages remain paused
until the first-turn accounting/stop conditions and actual delivery are known.

Owner subsequently supplied the live observer/worker results: inbound persisted
`2026-10-05T17:23:28.698Z`, message
`01a10d17-89b6-7c09-8d19-8bbaacec8979`, correlation
`01a10d17-89b6-7d26-a4c5-cd14151eaeb4`, outbox/physical job
`01a10d17-89b6-77b6-8365-99f28ec3c2b1`; dispatch 103 ms / AI handler 3,677 ms.
Conversation open/13, AI mode, no active handoff. Ledger: one logical message,
one physical slot, known cost **1,950 micros / USD0.001950**, zero unresolved
reserve, `blocked=false`. Delivery metadata at 17:29 UTC had only the inbound
message. These are **owner-supplied live results**, not newly retrieved raw rows;
timing/priced usage do not prove schema validity, permitted output or reply
persistence. The first paid turn remains counted, not refunded/replayed.

The repository-backed `first-turn` reader now collects the exact run terminal
status/schema/policy/error/usage fields, action name/validation/application codes,
message processing and outbound linkage, allowlisted AI/reply audits and Outbox
disposition together. All reads bind the authorized organization, exact
conversation/message/correlation and 17:22–17:37 UTC; strict row/time limits,
runtime/read-only/tenant/FORCE-RLS checks, rollback/cleanup and immutable-job
prerequisites remain. No arguments ciphertext, bodies, raw provider output,
account IDs or whole audit/event payload is selected. Metadata collection PASS
does not mean the underlying AI result/delivery passed.

Private `app.worker_handler_executions`/`pgboss.job` access is explicitly revoked
from `lead_agent_runtime` by migration 0024. Only catalog privilege flags are
read; retry/DLQ records are not fabricated or obtained through a permission
bypass. Exact tenant/correlation worker logs are the existing authorized proof
path for that gap. Logging permission errors now get a distinct stable sanitized
tag without printing stderr/credentials or broadening IAM.

Local preparation: six new focused Node cases PASS, plus the directly affected
existing redaction case PASS. Controlled Node subprocess executes the complete
actual bootstrap/main reader/helper with bare-package and relative runtime
resolution, all twelve metadata assertions, read-only guards, rollback and pool
cleanup; no DB/provider call. This fixture result is not a live AI result or
production defect reproduction. Scoped ESLint/Prettier/diff checks PASS; no
runtime source/build/deployment change or broad CI. A dedicated
`yaml` import was unavailable locally; Prettier's existing YAML parser is used,
not an installed dependency. The underlying runtime path is unchanged from
deployed `f523ba330c7b1dcffe8a18d22a65d0dea6d7b40d`.

Combined read **37351929187**, tooling source
`25b1e66e42fbe44e4d96f1e2d9896a3b19ec03f2`: reviewed Worker/job prerequisites
PASS; execution **`lead-agent-staging-migrator-mqfd8` SUCCESS**. Main reader
SHA256 `04a3488a3eaf9e620bbe7e92fa5b618db99c0f4ef50938231bc4906b8fe28941`,
trace module SHA256
`adc5a1c2aad930cd75d120480718b5a6c721ca8f094c445cf1197fdaa2079529`.
The saved sanitized artifact proves **`EXACT_EXECUTION_LOG_PERMISSION_DENIED`**,
not merely an inferred transport/permission failure. All scoped metadata reads
completed, but their observed values remain unavailable to this deployment
identity; the assertion list in the retrieved artifact is empty. No persisted
run/action/outbound value or earliest product failure is guessed from execution
success. No extra paid call, refund, replay, job configuration change, migration,
runtime build/deployment or IAM change occurred.

Recover the already-produced structured rows from this exact execution with the
owner's existing Cloud Shell log-read access, together with exact
organization/correlation Worker span/failure metadata in the same bounded window.
One command, no file upload or diagnostic rerun. This is a genuine access blocker
to the next investigation step, not a completed runtime correction. Further paid
messages stay paused; a runtime fix/deployment packet must wait for the actual
terminal result, validation/policy codes and persisted reply/Outbox disposition.

### First-turn root cause proven from the existing execution

The owner supplied the bounded Cloud Logging read of **`lead-agent-staging-migrator-mqfd8`**:
14 log entries, 12 diagnostic rows, `GCLOUD_EXIT=0`, `SANITIZER_EXIT=0`.
This closes the scoped result-collection gap above as **owner-supplied persisted
live evidence**, not an independently authenticated database read by Codex.
No diagnostic, paid invocation or customer action was repeated.

- Exact AI run **`01a10d17-8eea-745c-b2a0-4097e351f696`**, attempt 1, expected
  conversation version 13: terminal **`policy_denied`**, `schema_valid=true`,
  `policy_allowed=false`, output hash present, resolved `gemini-3.8-flash`.
  Started `2026-10-05T17:23:30.154Z`, finished `17:23:33.528Z`.
- Proposed action **`request_handoff`**, validation denied, reason `policy_denied`,
  application `not_applied`. The encrypted proposal/draft was not retrieved.
  Exact finer rejection branch was not persisted historically; a handoff proposal
  is independently sufficient for rejection in the deployed evaluator, but other
  failed output checks cannot be excluded from this metadata alone.
- Exact inbound is linked to that run and **`suppressed`**, sequence 7. No
  outbound message or `message.response_queued` intent exists in the bounded read.
  Conversation remains open/13, AI, no Handoff or AppointmentRequest.
- Dispatch reservation audit is **801,432 micros**; terminal policy-denial audit
  records dispatch authorized. Provider usage: input 770, cached input 0, output
  366, total 1,136; recorded known cost **1,950 micros**. Current cohort: one
  logical message/physical slot, zero unresolved reserve, `blocked=false`, combined
  exposure **1,035,346 micros**, original historical NULLs preserved.
- `message.received` is published with attempt 1/no relay error; terminal
  `ai_run.policy_denied` intent is pending. There is no outbound delivery attempt
  to blame. Runtime cannot read private queue/handler tables; retry/DLQ details
  are not claimed from their absent privilege. They are not needed to identify
  the earlier, persisted terminal suppression.

**Earliest proven failing stage:** deterministic policy rejected a schema-valid
model result, then `planSalesFlow` returned `text=null`/no Handoff for that
fallback; `planAppointmentSubmission` preserved it and `finishAIRun` committed
suppression without scheduling a response. Policy rejection itself is correct;
silently consuming a current, eligible customer message is the product defect.
This is not provider/network timeout, stale-version rejection, a reply INSERT
failure or an Instagram send error.

The focused correction preserves rejection and all provider usage/provenance.
Internal finite rejection codes distinguish untrusted extraction/citation,
unsafe response, unauthorized handoff and confirmation proposals. Only a current,
trusted contactable sales context with a **model-output** rejection receives the
application's existing `policy_blocked` Handoff and approved localized template;
no rejected model text, fact, citation, requested reason or booking action is used.
Injection/preflight denial, stale state, medical handling, unbound contactability
and budget dispatch denial cannot enter this fallback. Existing transactional
Handoff/audit/reply/Outbox persistence remains authoritative and idempotent.

Terminal audits add allowlisted `policy_rejection_code`, `sales_result_kind` and
`reply_disposition`; structured `worker.ai.outcome` logs bind tenant/conversation/
message/correlation/run/attempt to schema, proposed action, rejection and queued/
suppressed disposition. Safe model/token metadata remains internal. `queued`
means committed response intent, not provider delivery or customer receipt;
`messages.processing_status` and proposal `not_applied` are not delivery flags.

Local failure-before proof: the exact synthetic price/duration question plus a
schema-valid handoff proposal reproduced the previous silent plan. It is a
controlled reproduction of the proven branch, not recovery of the encrypted live
output. After correction, **200 focused AI/planner tests PASS** and **four new
structured disposition/telemetry tests PASS**. A new PostgreSQL persistence case
checks one safe Handoff/reply, unchanged run denial/cost, audit disposition and
duplicate suppression; it is **registered, not locally executed** because the
existing Docker Linux engine is unavailable. No Docker/WSL repair or aggregate
CI was attempted. Root test-source TypeScript and Application/Database declaration
builds plus Worker production build **PASS**. Scoped production lint and corrected
test/telemetry lint **PASS**, all 13 touched files' formatting and scoped diff
checks **PASS**. One incorrectly rooted local compiler invocation emitted 148
untracked compiler artifacts alongside TypeScript; only those proven generated
files were removed, preserving source and unrelated edits. The final **204/204**
focused regressions PASS against tracked TypeScript, not those artifacts; counts
are unique cases, not added across repeated runs.
Fresh plan provenance is recorded in the rollout packet. No migration/public schema, IAM, channel
eligibility, model settings or budget limit changes. No live-fix/booking/S22 PASS
is asserted before deployment and subsequent authorized evidence.

### Rejected-proposal fallback: exact rollout approval packet

**Source:** `da9d609b4831d041aef71b271cc6994b3df74cf8`, preserved on
`verify/s22-staging-recovery-capacity`. This fixes terminal handling of rejected
model output, not the original model proposal or historical accounting.
The already-consumed first paid turn remains counted; no replay or new paid
message ran. Further paid messages remain operationally paused.

One fresh [image build 37358285290](https://github.com/mufazzalshokh/lead-agent-platform/actions/runs/37358285290)
**PASS**. Authenticated manifest download binds all four Linux/amd64 images to
the exact source and build run; the fresh saved plan independently matches each
reference. No older image, timestamp, approval hash or plan is reused.

| Image | Exact immutable reference |
| --- | --- |
| API | `me-central1-docker.pkg.dev/lead-agent-stg-739284/lead-agent/api@sha256:4b9fabe32ba26025357f604e1107090ac105112a6a654568958192705cd29399` |
| Web | `me-central1-docker.pkg.dev/lead-agent-stg-739284/lead-agent/web@sha256:1e650251f7c1f720c15153e2cd8b2245d60afba15888325d764fd03151e86ea0` |
| Worker | `me-central1-docker.pkg.dev/lead-agent-stg-739284/lead-agent/worker@sha256:9013c4f4303255678151bd5ab6907da3877bc7e76fe80c81ad554b50b4845beb` |
| Migrator | `me-central1-docker.pkg.dev/lead-agent-stg-739284/lead-agent/migrator@sha256:fc9d7e383d7ae569546a383266919ee49a65c41e2a09078e4cad9f86cd68fe0c` |

One fresh [full-runtime plan 37359246514](https://github.com/mufazzalshokh/lead-agent-platform/actions/runs/37359246514)
**PASS**. Saved binary SHA256, independently computed after authenticated download
and matched to `s22.tfplan.sha256`:

`dc4613637939f7857dfc28e6169190bf4c525bb8eebec6f7d226f8de620ca3a4`

| Plan binding / safeguard | Verified result |
| --- | --- |
| Project / region | `lead-agent-stg-739284` / `me-central1` |
| Source | `da9d609b4831d041aef71b271cc6994b3df74cf8` |
| Chosen timestamp, preserved in all planned workload provenance | `2026-10-05T18:46:33Z` |
| Existing migration head, unchanged in all four workloads | `0031_s22_widget_inbound_route_management` |
| Creates / changes / destroys / replacements | **0 / 4 / 0 / 0** |
| Intended actions | `update:google_cloud_run_v2_service.api[0]`; `update:google_cloud_run_v2_service.web[0]`; `update:google_cloud_run_v2_worker_pool.worker[0]`; `update:google_cloud_run_v2_job.migrator[0]` |
| Independent private saved-plan inspection | Only images, Git labels and deployment SHA/image/timestamp provenance change; computed revision fields are not new configuration |
| SQL / IAM / network / scaling / secret binding changes | **NONE** |
| Runtime identity / VPC / resources / entrypoints | Unchanged before/after |
| AI gate | `preserve` resolves from authoritative state to existing `booking`; mode, cohort limits and history remain unchanged |
| Unexpected / deferred resource actions | **NONE** |
| Apply / one-shot migrator / database validator execution | **SKIPPED** in this plan run; full reconciliation does not execute migrations |
| Runtime before-source | `f523ba330c7b1dcffe8a18d22a65d0dea6d7b40d` |

The saved plan also records three **refresh metadata** entries: registry
`update_time`; migrator `execution_count` and latest-execution name/timestamps;
Cloud SQL `settings.version`. These are not additional apply actions. Registry
and Cloud SQL have explicit planned `no-op`; the migrator's planned configuration
change remains only image/provenance. No SQL configuration difference is accepted
or hidden. Raw Terraform JSON/state and environment contents were not printed.

Prepared exact subsequent inputs for `staging-terraform.yml` on the same branch:

| Input | Exact value |
| --- | --- |
| action / phase | `apply` / `full` |
| commit_sha | `da9d609b4831d041aef71b271cc6994b3df74cf8` |
| plan_run_id | `37359246514` |
| approved_plan_sha256 | `dc4613637939f7857dfc28e6169190bf4c525bb8eebec6f7d226f8de620ca3a4` |
| api_image / web_image / worker_image / migrator_image | Exact respective immutable references in the image table above |
| deployment_timestamp / api_deployment_timestamp / migrator_deployment_timestamp / runtime_deployment_timestamp | `2026-10-05T18:46:33Z` |
| api_git_commit_sha / migrator_git_commit_sha / runtime_git_commit_sha | `da9d609b4831d041aef71b271cc6994b3df74cf8` |
| api_migration_head / runtime_migration_head | `0031_s22_widget_inbound_route_management` |
| ai_journey_mode | `preserve` |
| owner_approval_token | **Not supplied; exact-plan owner approval required before dispatch** |

No apply was dispatched. Terraform must reject a stale saved plan rather than
silently replan. Current GCS serial was not independently re-read after plan
creation; no claim of post-plan live convergence is made. Documentation-only
follow-up commits do not change the reviewed runtime source or require rebuilding.

Validation remains the focused **204/204** local regressions, root TypeScript,
Application/Database declaration builds, Worker production build, scoped lint,
format and diff checks recorded above, plus the completed four-image build and
plan checks. The new real-PostgreSQL persistence case is registered but still
unexecuted locally; final authoritative CI and subsequent live fallback/delivery
proof remain pending. No historical NULL reconciliation, grounded-answer PASS,
booking confirmation or S22 acceptance follows from this packet.

| Gate | Evidence still required |
| --- | --- |
| Instagram DM / staff workflow | Deployment, authenticated History/transcript/navigation/current-state and fresh synthetic Claim/Resolve feedback/version sequencing PASS; scoped persisted transition/audit diagnostic PASS (owner-supplied); tenant-routing/eligibility proof remains pending |
| Website Widget | Real allowed/disallowed cross-origin embed, meaningful response, session and token isolation |
| Gemini and business journey | Approved live model, bounded cost ledger, grounding/qualification/request/staff acceptance/customer confirmation, deterministic medical safety |
| Observability | Actual meaningful-response TTFR, queue/provider/channel failures and cost without message content |
| Recovery | Actual completed backup, isolated restore, representative data/encryption/RLS validation, measured RPO/RTO, rollback and queue drain |
| Capacity | Fake-provider normal/burst/bounded stress traffic, error/latency/resource measurements and safe operating envelope |
| Telegram Business (may run last) | Real business connection with `can_reply`, tenant binding, inbound business DM and same-DM reply; no standalone bot-chat substitute |
| Final gate | One authoritative `pnpm ci:verify` on the final coherent S22 tree, then exact verified promotion |

The `acceptance-inventory` phase of Staging Terraform is strictly read-only. It lists
live backup/PITR, worker readiness, public health and configured alert prerequisites
using existing WIF permissions. It reads no secret values, does not initialize or
apply Terraform, does not redeploy services or execute the migrator. Its allowlisted
artifact is prerequisite evidence only: it never claims restore or capacity PASS.

Keep Cloud SQL running during active DB-dependent S22 work. S23 remains out of scope.
