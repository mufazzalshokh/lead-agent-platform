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

## Remaining gates

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
