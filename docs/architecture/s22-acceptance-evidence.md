# S22 remaining acceptance evidence

This register distinguishes completed deployment/onboarding evidence from remaining
live product and recovery/capacity proof. It does not declare S22 acceptance.

## Current checkpoint — 2026-10-08

**Active milestone:** the owner approved preparation of the separately bounded
Website Chat customer-to-confirmed-booking test. Its proposed two messages/four
physical attempts reserve USD3.205728; combined maximum exposure including the
retained historical reservation and original known cost is USD4.247838. This
is not approval to apply an unidentified plan or send now. See the
[current preparation and limits](s22-synthetic-booking-journey.md#current-preparation--separate-website-chat-journey-2026-10-08).
Local implementation/tests, isolated PostgreSQL proof, immutable build and exact
session-bound plan are preparation gates; none substitutes for deployed/live
customer evidence. S22 remains unaccepted.

The original eligible Instagram synthetic journey has scoped live proof of
grounded price/duration, staff acceptance, actual customer confirmation and the
persisted confirmed booking. Owner-supplied execution
`lead-agent-staging-migrator-8qlzd` passed the seven booking assertions; the
subsequent dispatch/accounting-only execution
`lead-agent-staging-migrator-f5cpf` passed all four of its assertions and closed
the missing non-dispatch audit classification. Neither result establishes the
other channel, recovery/capacity or release gates. Historical NULL costs remain
unknown under the approved budget-only exception; further paid dispatch is
blocked. Do not repeat this journey or its completed diagnostic reads.

The current milestone is non-paid Website Chat embedding/session proof. Initial
owner setup on the controlled distinct-origin Cloud Shell host now succeeded,
but the real frame returned 400 after a successful policy lookup. The bounded
[proxy-origin investigation and correction](s22-widget-embedding-proof.md#2026-10-07--live-frame-rejection-and-bounded-correction)
has an actual installed-framework before/after reproduction. The owner-approved
exact rollout **37672530149** and read-only verification **37672800406** now
passed for runtime source `65b6c906f3a3433a1093abcf1aada4b0f2f00423`, with
whole-runtime convergence exit **0**. Real frame/session proof remains pending;
deployment/readiness is not authenticated browser or customer E2E proof. Do not
replace unrelated setup or send a Widget message under the exhausted Instagram
allowance.

The previous owner browser test showed the genuine frame opens and reports
successful close/reopen, but its launcher retained `Opening…`. The
[focused launcher lifecycle correction](#2026-10-08--widget-launcher-lifecycle-correction-checkpoint)
has generated-script behavioral proof and is now deployed in approved apply
**37735083627**, verified read-only by **37735337876** with whole-runtime
convergence exit **0**. The served loader matches committed corrected source
exactly. The [refreshed owner test](#2026-10-08--owner-confirms-corrected-widget-launcher)
now confirms **Chat with us** and successful close/reopen: launcher UX **PASS**.
Independent session/security proof and Widget customer E2E remain pending;
owner-observed open/reopen alone does not establish those assertions.
The owner also reports successful fresh opening after selecting **Block
third-party cookies**, with no covering site exception: owner-observed cookie
bootstrap **PASS**. The owner has now explicitly confirmed restoring the original
cookie setting, closing cleanup in the
[cookie checkpoint](#2026-10-08--widget-cookie-block-setting-checkpoint).
The subsequent Widget-specific `contentDocument === null` check returned
**true**: [owner-reported host DOM denial](#2026-10-08--widget-host-document-denial)
**PASS**. This closes only that scoped browser assertion, not token isolation,
disallowed-origin denial, direct session traces or Widget customer E2E.
The subsequent [live actual-request origin check](#2026-10-08--widget-live-actual-request-origin-denial)
is now **PASS**, paired with the owner's working public installation. It does
not close independent token/session traces or actual Widget customer E2E.

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
| Scoped reserve/dispatch PASS · M1; historical exact-accounting gap retained | 26 small paid cohort; [26 paid/load/recovery gates](26-s22-staging-recovery-capacity.md#recovery-and-capacity-gates); [24 NULL-cost policy](24-s20-analytics-observability-cost.md#cost-policy) | Historical accounting and small paid cohort; NFR-017 | Owner approved the budget-only historical exception and bounded continuation; deployed durable guard; f5cpf dispatch/accounting assertions PASS, no unresolved reserve, message-limit stop | None for this approved cohort's reservation proof; preserve historical NULL/coverage gap and the explicit exception. Wider NFR-017 accounting coverage is not waived | Other paid cohorts need their own applicable controls/authorization | 0 h for the closed scoped check | No repeated diagnostic or paid message; no new spend authorized |
| Scoped original Instagram journey PASS · M1 | FR-004–010/012–017/021; [FR/NFR](01-product-and-journeys.md#8-functional-requirements); [09 E2E matrix](09-test-strategy.md#end-to-end-journeys) | Grounded customer-to-confirmed booking; FR-004–010, 012–017, 021 | Authoritative synthetic knowledge; owner-reported grounded reply and actual offer/confirmation receipt; 8qlzd seven booking assertions PASS, confirmed/4, offer1; f5cpf dispatch/accounting PASS | None for this original eligible Instagram happy path; other channels, languages and P0 edges remain in the rows below | Preserve exact synthetic source/offer/evidence bindings | 0 h for this completed journey | No repeated friend message, staff acceptance or confirmation |
| Retained scoped PASS · M1 | FR-018/020; [FR/NFR](01-product-and-journeys.md#8-functional-requirements); [09 E2E matrix](09-test-strategy.md#end-to-end-journeys) | Staff review/handoff/history; FR-018, 020 | Normal Chrome owner access; Claim 1→3/Resolve 4; conversation 10→11→12; six messages preserved; nine persisted assertions PASS; synthetic booking acceptance and persisted audit proof PASS | Preserve scoped PASS; remaining state/race/authorization edges are tracked separately, not silently generalized from this journey | Final coherent release matrix | 0 h for these completed actions | Do not repeat Claim/Resolve or synthetic booking acceptance |
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

At packet preparation, no apply was dispatched. Terraform must reject a stale saved plan rather than
silently replan. Current GCS serial was not independently re-read after plan
creation; no claim of post-plan live convergence is made. Documentation-only
follow-up commits do not change the reviewed runtime source or require rebuilding.
The subsequent owner-approved apply and post-apply proof are recorded below.

Validation remains the focused **204/204** local regressions, root TypeScript,
Application/Database declaration builds, Worker production build, scoped lint,
format and diff checks recorded above, plus the completed four-image build and
plan checks. The new real-PostgreSQL persistence case is registered but still
unexecuted locally; final authoritative CI and subsequent live fallback/delivery
proof remain pending. No historical NULL reconciliation, grounded-answer PASS,
booking confirmation or S22 acceptance follows from this packet.

### Rejected-proposal fallback: approved rollout complete

The owner approved the exact packet above. [Apply 37360464046](https://github.com/mufazzalshokh/lead-agent-platform/actions/runs/37360464046)
**PASS**, applying only saved plan **37359246514** with SHA256
`dc4613637939f7857dfc28e6169190bf4c525bb8eebec6f7d226f8de620ca3a4`.
Local independent checksum recheck and workflow saved-plan integrity/scope checks
PASS. Actual Terraform result: **0 added / 4 changed / 0 destroyed**; approved
replacement count **0**. Completion logs identify exactly API, Web, Worker and
Migrator workload updates. `Create reviewed plan` and `Execute one-shot migrator`
were **SKIPPED**. No images were rebuilt, migrations executed or paid calls made.

Existing read-only [verification 37360711370](https://github.com/mufazzalshokh/lead-agent-platform/actions/runs/37360711370)
**PASS**. Authenticated allowlisted artifact download verifies the exact API/Web
images, API source `da9d609b4831d041aef71b271cc6994b3df74cf8`, preserved timestamp
`2026-10-05T18:46:33Z`, migration head
`0031_s22_widget_inbound_route_management`, runtime identity/private VPC/subnet/
egress and 15 API secret references. API revision `lead-agent-staging-api-00019-r2c`
and Web revision `lead-agent-staging-web-00015-vnd` are ready. Whole-runtime
Terraform refresh/convergence returns **exit 0**, corroborating the planned
Worker/Migrator images and preserved configuration; these two workloads did not
receive separate direct Cloud Run assertion artifacts in this check.

Public bounded `curl.exe --max-time 20 --output NUL --write-out` checks: exact
staging API `/health` **HTTP 200** and Web `/staff` **HTTP 200**. This proves health/
reachability, not an authenticated owner interaction or customer receipt.

The approved rollout milestone is complete. The original USD0.001950 turn remains
counted and is not replayed; historical NULL costs remain untouched. Further paid
messages remain paused pending current conversation/cohort readiness for the
second already-authorized turn. The new PostgreSQL persistence regression, live
safe-fallback delivery and complete booking journey remain unproven. S22 is not
accepted; no S23 work. Only these evidence documents changed after deployment;
unrelated owner edits are preserved.

### Post-rollout second-turn readiness: diagnostic preparation

The owner requested continuation with the read-only readiness check. Before
dispatch, source inspection found that `s22-booking-evidence.mjs` still pinned
the previous `f523ba3` Worker/Migrator images and timestamp. Those guards would
correctly reject the new live deployment; no failed live run was consumed to
discover this. Only the reviewed diagnostic pins now reference the exact
`da9d609b4831d041aef71b271cc6994b3df74cf8` manifest, approved apply **37360464046**
and verified timestamp **2026-10-05T18:46:33Z**. Runtime code/configuration, reader
queries, RLS, identity/VPC/explicit-zero-retry checks, timeouts, rollback/cleanup
and redaction are unchanged. This does not require or authorize another image
build/deployment, migration, paid message or IAM change.

The exact new pin assertion failed before correction and passed afterward;
separate tests prove both old Worker and old Migrator digests remain rejected.
`node --test .github/scripts/s22-booking-evidence.test.mjs
.github/scripts/s22-booking-first-turn.test.mjs`: **15/15 PASS** including the
actual ES-module subprocess/relative-package resolution, complete controlled
reader, rollback/cleanup, security guards and output redaction. Scoped script
lint, formatting and diff checks PASS. These are local diagnostic-tool tests,
not a fresh live ledger/conversation observation. The existing `observe` phase
will collect current synthetic state/requests/delivery and budget metadata;
paid messages remain paused until those observed values satisfy readiness.

Live read [37362528025](https://github.com/mufazzalshokh/lead-agent-platform/actions/runs/37362528025),
tooling commit **`80ee53a0620579b5c3f7d3518d0fbdaea464a8a8`**, `observe` stage:
Worker's exact new source/image/`booking` mode, single-instance/private-network
checks **PASS**. Diagnostic immutable image/runtime-secret-reference/private-VPC/
explicit-zero-retry checks **PASS**. Unchanged main reader SHA256:
`04a3488a3eaf9e620bbe7e92fa5b618db99c0f4ef50938231bc4906b8fe28941`.
Execution **`lead-agent-staging-migrator-h6zpt` SUCCESS**. The sanitized artifact
reports **`EXACT_EXECUTION_LOG_PERMISSION_DENIED`**, assertion list empty; the
current conversation/request/ledger values are therefore not claimed from this
identity. Paid calls **0**, migration execution **false**, job configuration
changed **false** refer to this diagnostic, not the historical paid turn.

The initial dispatch had a transient `api.github.com` connectivity error. A
successful run-list read proved no run was created, and a bounded credential-free
API check returned HTTP200 before one dispatch retry created this single run.
It then waited for an unassigned `ubuntu-latest` runner (`runner_id=0`, no steps,
no pending environment review); GitHub's official status API contemporaneously
reported Actions `degraded_performance`. The existing run subsequently started
and completed; no duplicate diagnostic, code workaround, IAM grant, deployment,
migration or paid call was used to compensate for that delay.

Only one owner-authenticated Cloud Shell read of this exact execution's existing
`s22_booking_readonly` structured rows is now needed. Retrieve only assertion,
outcome, safe observed metadata and stable code. No upload, launcher, new job or
permission broadening. Do not send the second paid message until those values
prove current open/AI/no-active-handoff state, no duplicate synthetic request,
settled known first-turn spend, zero unresolved reservation and remaining
authorized message/call allowance. Original historical NULLs remain visible;
execution success alone is not the missing observed readiness evidence.

### Second-turn readiness: owner-supplied results received 2026-10-06

The owner retrieved the existing `lead-agent-staging-migrator-h6zpt` structured
logs through authenticated Cloud Shell; the final bounded read returned
`LOG_READ_EXIT=0`. These are owner-supplied live diagnostic results from the
completed observation above, not a new database execution or a new current-time
snapshot. They supersede the pending-result-access wording for this checkpoint.

| Assertion | Observed result |
| --- | --- |
| `synthetic_conversation` | PASS: exact approved conversation, `open`, version **13**, automation `ai`, no active handoff |
| `synthetic_requests` | PASS: empty bounded request list for that exact tenant/conversation |
| `synthetic_delivery_metadata` | PASS: only the previously counted inbound message at `2026-10-05T17:23:28.698Z`; no delivered assistant reply is claimed |
| `deployed_cohort_binding` | PASS: exact approved organization/conversation, `s22-synthetic-booking.v1`, 3 logical messages, 6 physical calls, at most 2 calls per message, USD10 hard ceiling |
| `cohort_reservation_accounting` | PASS under the approved budget-only exception: 1 logical message / 1 physical call, known cost **USD0.001950**, historical reserve **USD1.033396**, combined exposure **USD1.035346**, unresolved reservation **0**, `blocked=false`, per-call reserve **USD0.801432** |

`accountingComplete=false` remains explicit: neither the historical NULL costs
nor the exact-accounting gap are reconciled by this budget check. Original
USD5.841988 maximum approved exposure and the owner's target-overage exception
remain unchanged. No diagnostic retry, migration, runtime deployment, CI, paid
call, historical rewrite or permission grant was performed to obtain these logs.

The second already-authorized customer turn may now proceed in this same
synthetic Instagram conversation. Two logical-message slots and five overall
physical-call slots remain, still subject to the per-message cap and all
timeout/unknown-cost/allowance guards. Combine the price/duration question with
the synthetic customer's own future date/time preference rather than replaying
the first event or consuming an extra exploratory message. Observe actual reply,
request state and settled cost before requesting any subsequent customer action.
Actual delivered-offer confirmation remains mandatory; staff acceptance alone
is not confirmation. Grounded answer, booking journey and S22 acceptance remain
pending. The readiness diagnostic does not need to be repeated.

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

### Second paid turn: extraction rejection and bounded correction — 2026-10-06

Owner-supplied Cloud Logging result, `LOG_READ_EXIT=0`: at
`2026-10-06T11:37:09.563965Z`, message
`01a11100-ba01-7c22-8e2f-6c55c2f4760b`, correlation
`01a11100-ba01-72ec-b8fc-509a1edec5da`, in the approved synthetic cohort:
`fallback_required`, `policy_denied`, `untrusted_extraction`,
`handoff_requested`, reply disposition `queued`. The owner separately reports
receiving the deterministic staff-escalation reply. These establish application
rejection and fallback receipt, not a grounded price answer or booking creation.
The earlier readiness snapshot is not current post-turn accounting or state.

The earliest proven failure is sales extraction validation. Its five predicates
check service/location IDs against trusted customer selection and require name,
phone and email candidates to appear verbatim in the current message. The old
code collapsed all five into one rejection code. It persisted an output hash
and encrypted action arguments, **not extracted-fact values**. Therefore the
exact historical offending field/value cannot be reconstructed from these
records; a claim that it was specifically the service or location would be a
guess. No raw provider response, customer content or ciphertext is requested.

Source inspection confirms a prompt/policy contract mismatch: the S16 prompt
encouraged reuse/extraction from history although that model extraction is not
the qualification/booking authority. The corrected product prompt is
`s16-appointment-submission.v2`: all extracted fields remain null and action
is `none`; application-owned customer evidence still selects entities,
qualifies, parses preferences and authorizes any request. The immutable
`s16_appointment_submission.v1` submission profile, Qualification V1 provenance,
AgentDecision V1 schema and S13 model/configuration are unchanged. This is a
locally verified contract correction, **not proof that the historical model
followed this path or that a new live response will pass**.

Rejection diagnostics now carry only finite field names through evaluation,
post-commit Worker telemetry and the existing redacted audit metadata. Every
previous rejection predicate remains enforced; policy-denied proposals still
receive only the safe application fallback. No extracted values are logged.

A separate deterministic reproduction found that an explicit price-and-duration
question selected only duration. The bounded correction retrieves both from the
same already tenant-authorized published projection and renders both approved
facts. Missing either fact fails closed; unrelated services, stale/foreign
citations, locale restrictions and context/transport limits are preserved.
Duration-only questions do not acquire a pricing requirement. This related
defect is not claimed as the cause of the live `untrusted_extraction` event.

Focused regression tests failed before these corrections and passed afterwards.
Verification uses installed tools directly; no dependency installation or host
repair. `node node_modules/vitest/vitest.mjs run` for sales-flow,
appointment-submission, grounded-answers, grounded-provider, production-config
and policy-fallback-telemetry: **226/226 PASS**. The additional
s22-business-readiness group: **11/11 PASS** (237 distinct focused tests total).
The production-config rerun after replacing an unsafe test matcher: **28/28
PASS**, not another distinct test group. Root `node
node_modules/typescript/bin/tsc -p tsconfig.json --noEmit` **PASS**. Production/
declaration builds for Application, AI and Database, and the Worker production
build **PASS**; Database build and root TypeScript were rechecked after the
final metadata/test changes. No local full aggregate or paid evaluation.
Scoped ESLint for all 17 touched TypeScript files **PASS**, zero warnings.
Prettier checks **PASS** for the 19-file milestone after correcting the DB test's
formatting. Scoped `git diff --check` and added-line secret-pattern screening
are required before staging; fresh image/plan provenance remains pending.
The PostgreSQL audit/fallback case now
covers extraction rejection as well as handoff rejection; it is registered,
not claimed executed locally. No full CI, provider call, event replay, OAuth,
migration, IAM change or runtime apply is performed by this correction.

Paid customer turns remain paused operationally. Before resumption, obtain
post-turn authoritative handoff/conversation/request state and settled cohort
accounting through existing readers. Do not reuse the old remaining-slot
numbers, replay either consumed message, resolve a handoff automatically,
expand the approved allowance or overwrite historical NULL costs. Runtime
deployment requires fresh immutable images and a newly reviewed exact plan;
previous hashes/approvals cannot authorize this correction. S22 is unaccepted.

Keep Cloud SQL running during active DB-dependent S22 work. S23 remains out of scope.

### Extraction correction: immutable build, plan and test expectations — 2026-10-06

Runtime source `3f6dee297bbae03be46ec2a418c6adec329a698f` is preserved on the
S22 verification branch. Image build
[`37475611241`](https://github.com/mufazzalshokh/lead-agent-platform/actions/runs/37475611241)
passed for all four Linux/amd64 images. Full reconciliation **plan only**
[`37476369479`](https://github.com/mufazzalshokh/lead-agent-platform/actions/runs/37476369479)
passed: zero creates, four in-place workload updates, zero destroys/replacements;
migrator execution disabled. Deployment timestamp `2026-10-06T14:07:45Z`,
migration provenance `0031_s22_widget_inbound_route_management`. The downloaded
saved-plan SHA256 independently matches
`ef479d3ec09ca493e18ad462f52cd46db6bdf825c3796f3590c35d15bc8c88b4`.
No apply or paid call occurred.

The push automatically triggered CI
[`37475505872`](https://github.com/mufazzalshokh/lead-agent-platform/actions/runs/37475505872):
3,223 ordinary tests passed; the primary PostgreSQL suite reached 449/452 PASS.
Both S22 persisted fallback/audit cases passed. Three older S16 assertions failed
because they expected `grounding_insufficient/policy_denied` and no outbound,
where the approved fallback introduced by deployed commit `da9d609` returns
`handoff_requested/policy_blocked`. Git history confirms these stale assertions
already existed in that earlier source; no production change is justified by
this test failure.

The three test expectations are corrected together. They now also verify the
exact persisted denial/rejection audit, no AppointmentRequest/preference/booking
transition or booking event, and no foreign-tenant handoff, reply, qualification
or appointment. This does not permit the rejected model proposal: only the
already-approved application-owned fallback is expected. Runtime source and
the built images/saved plan are unchanged by this test-only follow-up.

Focused root TypeScript, changed-file ESLint/formatting and diff checks passed.
Local PostgreSQL execution is unavailable: the existing Docker Linux-engine
pipe is absent. Docker was not started, repaired or reconfigured; no host
maintenance or local aggregate was attempted. The corrected PostgreSQL
assertions still require remote execution before claiming their PASS. The
existing push-triggered budget proof `37475496694` passed; it is not evidence
that these three corrected assertions executed. No manual aggregate rerun is
dispatched. Keep paid turns paused and do not apply this plan until the exact
plan is approved and outstanding verification concerns are resolved.

The test-only follow-up `de8139279a11ee2320d9d9f65d589065d1a5421a`
triggered CI `37477320572`. Its first failure was an incorrect **new test
expectation**, not a production defect: `submissionCounts.staff_tasks` counts
appointment notifications, whereas a safe Handoff fallback creates no
AppointmentRequest or appointment notification. Actual count zero is correct;
the test incorrectly expected one. All three cases are corrected to require
zero appointment tasks and separately require exactly one Handoff/event/reply,
the persisted denial audit and no foreign-tenant effects. The previous runtime
images and saved plan remain unchanged. This failure is not recorded as PASS.

### Extraction correction: approved rollout and post-apply proof — 2026-10-06

The final test-only follow-up `d37897a54ef63fa78efb91e4c2cdc0e419abb07e`
passed authoritative CI
[`37478331777`](https://github.com/mufazzalshokh/lead-agent-platform/actions/runs/37478331777):
3,223 ordinary tests, all five real PostgreSQL groups (452 + 9 + 21 + 12 + 14 =
508 tests), and formatting/lint/boundaries/contracts/typechecks/production builds.
Seven intentional ordinary skips are not counted as PASS. The separate focused
budget proof `37478323819` also passed. These completed checks are reused; no new
aggregate or paid evaluation was dispatched for rollout verification.

The owner approved only saved plan `37476369479`, SHA256
`ef479d3ec09ca493e18ad462f52cd46db6bdf825c3796f3590c35d15bc8c88b4`.
Exact-plan apply
[`37480351865`](https://github.com/mufazzalshokh/lead-agent-platform/actions/runs/37480351865)
**PASS**: 0 creates / 4 in-place changes / 0 destroys / 0 replacements. The
changed resources were only API, Web, Worker and Migrator; no SQL, IAM, network,
scaling, secret-resource or public-security-boundary change. Migrator execution
was disabled. Runtime source remains
`3f6dee297bbae03be46ec2a418c6adec329a698f`, built by `37475611241`, deployment
timestamp `2026-10-06T14:07:45Z`, migration provenance
`0031_s22_widget_inbound_route_management`. Later test/documentation commits did
not rebuild or change those images.

Read-only post-apply verification
[`37484607889`](https://github.com/mufazzalshokh/lead-agent-platform/actions/runs/37484607889)
**PASS**: exact API image/source/timestamp/migration head, API runtime identity,
private networking, 15 secret references (metadata only), ready API/Web images
and revisions; whole-runtime Terraform convergence exit **0**. API `/health`
returned `service=api,status=ok`; the organization-bound staff shell returned
HTTP **200**. These are provenance/readiness/reachability checks, not a new
authenticated browser or customer-answer test.

Only the existing booking reader's reviewed source/timestamp/Worker/Migrator
pins and corresponding regression expectations are updated for this completed
rollout. All read-only/runtime/RLS/private-VPC/explicit-zero-retry safeguards
remain unchanged. Its focused Node tests **9/9 PASS**, including rejection of
previous images and exact ES-module subprocess/package resolution without DB or
provider calls; scoped ESLint, Prettier and diff checks PASS. This tooling-only
update needs no runtime deployment.

Current post-turn conversation/handoff/request state and settled cohort counters
must still be read before another customer turn. No historical NULL cost is
rewritten, no allowance is reset, and neither previous message is replayed.
Paid turns remain paused operationally until those results are known. No new
grounded-answer, booking, recovery/capacity or S22 acceptance PASS is claimed.

### Post-rollout bounded observation: result-log access blocked — 2026-10-06

Tooling/evidence commit `38262834a7af6d8141488484133c691258c56218` was pushed
and its remote branch SHA verified. Existing **observe** workflow
[`37485119569`](https://github.com/mufazzalshokh/lead-agent-platform/actions/runs/37485119569)
verified the live Worker image/source/timestamp/head, `booking` mode, one instance
and private networking. It also verified the exact Migrator diagnostic image,
runtime database secret reference (no payload read), private networking and
explicit numeric zero retries. The read-only execution
**`lead-agent-staging-migrator-n2vs5` SUCCESS** used reader SHA256
`04a3488a3eaf9e620bbe7e92fa5b618db99c0f4ef50938231bc4906b8fe28941`.
No paid call, migration execution or job configuration change occurred.

The workflow's exact remaining failure is
**`EXACT_EXECUTION_LOG_PERMISSION_DENIED`**, not a runtime rollout or provider
failure. The sanitized artifact contains no assertion rows; execution success
alone is not substituted for the missing observed state/counters. The current
handoff/request state, remaining paid allowance and preserved historical NULLs
still need the existing execution's structured result rows. No rerun, upload,
IAM broadening, message replay or paid turn is justified. Recover only this
execution's `s22_booking_readonly` logs through the owner's existing authenticated
Cloud Shell. Paid customer turns remain paused until the actual results are read.

### Bounded booking-chain review and result recovery — 2026-10-06

Owner-approved offline review reused the completed CI `37478331777` and rollout
`37480351865`/verification `37484607889`. It did not repeat paid calls, OAuth,
Claim/Resolve, migrations, diagnostic executions or deployment. This is a scoped
review of the booking chain, not proof that every product defect is eliminated.

| Boundary | Evidence inspected / added | Remaining live gap |
| --- | --- | --- |
| Published facts and selectors | `tests/ai/s22-business-readiness.test.ts`; existing price/duration publication readback; the connected rehearsal uses the contract-validated S22 clinic fixture | No fresh grounded Instagram answer is claimed |
| Dispatch, repairs and accounting | `tests/ai/s22-journey-dispatch.test.ts`, `tests/ai/s22-budget-ledger.test.ts`; three real-PG budget cases in `tests/database/ai-orchestration.test-suite.ts` already passed in the reused gate | Current post-turn counters and handoff state remain unread |
| Provider cancellation/finalization | New deterministic regressions in `tests/ai/orchestration.test.ts` | New reliability correction is local, not deployed |
| Qualification/request and atomic side effects | Actual application planner/domain commands in new `tests/ai/s22-booking-chain.test.ts`; reused S16 real-PG CAS/idempotency/rollback proof | New request creation/delivery still requires the bounded live journey |
| Staff acceptance and customer confirmation | New connected rehearsal traverses actual domain transitions and Instagram confirmation evidence; existing customer-confirmation handler and real-PG S18 proofs reused | No actual delivered offer/customer confirmation is fabricated |
| Safety/fallback and social eligibility | Existing policy/medical tests and Worker confirmation-before-AI composition inspected; these boundaries are unchanged | No broader live channel or clinical readiness claim |

One new reliability defect was reproduced: `provider.decide()` could synchronously
abort the caller signal before the orchestration race installed its listener,
then return a non-settling promise. The regression returned `MISSED_ABORT` before
the correction. Subscribing before invoking the adapter fixes that race; the
listener is removed on success/throw/timeout. A late provider result cannot
finalize twice or overwrite unknown usage. Timeout remains a typed fallback,
with NULL usage and no repair; durable budget/tenant policy is unchanged. This
is **not** asserted to be the cause of either earlier paid-turn failure.

The connected synthetic rehearsal runs the actual Gemini adapter with mocked
HTTP, the S16 orchestrator/planner, qualification and booking domain commands:
100,000 UZS / 30 minutes → date/time clarification → request → staff acceptance
→ confirmation preparation → explicit synthetic Instagram confirmation. Staff
acceptance stays `staff_accepted`; conversion occurs only after confirmation.
Duplicate source processing does not make another provider call. Persistence is
simulated: this is not SQL/RLS, real provider, outbound delivery or owner evidence.

The existing observation execution `lead-agent-staging-migrator-n2vs5` remains
the sole live result source. Owner-reported `LOG_READ_EXIT=124` proves only that
the Cloud Shell CLI read timed out; the cause of that timeout is not known.
New `--recover-logs` mode in `.github/scripts/s22-booking-evidence.mjs` obtains an
owner token without printing it (10-second bound), then makes exactly one
15-second direct Cloud Logging `entries.list` read. Invalid/mistyped CLI arguments
cannot enter the diagnostic-execution path. It pins the existing
execution, project, operation and UTC day, requests at most 20 rows, and uses the
existing output allowlist. Missing/duplicate/truncated/failed assertions fail
closed. Authentication, HTTP 401/403, transport, timeout and malformed response
have distinct safe tags. There is no job execution, migration, IAM grant, paid
call, API retry or secret/error-payload output. Google documents this read API
and recommends descending order and selective time bounds:
[Cloud Logging entries.list](https://docs.cloud.google.com/logging/docs/reference/v2/rest/v2/entries/list).

Recovery can be fetched from the public repository at the verified correction
commit, checksum-checked and run in Cloud Shell without uploading another file.
Local controlled HTTP tests are not successful live result retrieval. No new
remaining-slot number or exact-accounting PASS is claimed; historical NULL costs
and the owner-approved reserve stay visible. Paid calls remain paused.

Focused verification: 60/60 Vitest cases (orchestration 24, connected chain 1,
dispatch 11, ledger 14, confirmation handler 10), 20/20 Node tooling tests;
root TypeScript, scoped ESLint, Application declaration build, Worker production
build and scoped formatting passed. A mis-scoped initial compiler invocation
failed with TS6059 and generated untracked outputs; only those outputs were
removed, and the correctly scoped builds passed. The unrelated existing
Instagram-document trailing whitespace is preserved and excluded from scoped
diff verification. No migration, dependency, IAM, budget, social eligibility or
public-contract change. A fresh reviewed runtime plan would be required to
deploy the cancellation fix; old images/plans/approval hashes are not reusable.

### Existing observation recovered and one-message preparation — 2026-10-06

Owner-supplied live output from the checksum-pinned `--recover-logs` command at
correction commit `f5b26c699695f8e48e5d445cb553ad6650bbb68e` reports authentication
**PASS**, `logging_response` **PASS**, and all six required assertions **PASS**
for existing execution `lead-agent-staging-migrator-n2vs5`. This closes only its
result-retrieval gap: no diagnostic rerun, provider call or database mutation was
performed. The rows describe that completed observation, not a new current-state
database read at the time the owner pasted them.

| Observed item | Persisted diagnostic output |
| --- | --- |
| Synthetic conversation | `01a1067f-d7d8-7e7e-9fb0-39bfe2f7cdc7`, version **16**, `awaiting_staff`, automation **paused**, active handoff present |
| Booking requests | **0**; neither confirmation nor request creation is proven |
| Delivery | Two inbound paid-turn messages; one outbound recorded **sent**, corresponding to the earlier safe Handoff fallback, not a grounded booking answer |
| Cohort usage | **2 logical messages / 2 physical calls**, maximum 3 / 6 and at most 2 calls per message |
| New-call ledger | **3,742 micros (USD0.003742)** recorded known cost; unresolved reservation **0**; `blocked=false` |
| Historical accounting | Historical NULLs preserved; **1,033,396 micros** approved budget-only reserve; `accountingComplete=false` remains visible |
| Combined exposure | **1,037,138 micros (USD1.037138)**, not a claim of exact historical/billed cost |
| Security | Runtime read-only tenant/FORCE-RLS/baseline assertions **PASS** |

One logical paid message remains at this observation, allowing at most **two**
additional physical calls, not all four otherwise unused physical slots. The
maximum additional reserve is `2 * 801432 = 1602864` micros; maximum combined
AI exposure from this checkpoint would be **2,640,002 micros (USD2.640002)**.
No limit/reservation reset or additional spend is authorized. Timeout, unknown
new-call cost, exhausted allowance or guard failure still stops paid work.

The active handoff ID/status is not present in these rows. Do not substitute the
old resolved handoff or a thread-control ID. The supported live staff UI must
load this exact synthetic conversation's authoritative current resource and
versions. Source `resolveHandoff` permits resolution only from `in_progress`;
the first owner action is Claim/Start handling when appropriate, followed by
separately verified Resolve with the existing `resume_ai` disposition. No
automatic resolution or unrelated staff-work mutation occurred. Source also
shows the UI currently exposes Resolve before that domain precondition; this is
a UI availability discrepancy, not permission to skip Claim or weaken policy.
It is recorded for the next relevant UI change, not patched in this evidence
preparation milestone. Fresh UI state remains necessary before requesting a DM.

The connected rehearsal now covers both three-turn clarification and a complete
one-turn Uzbek preference. The latter includes the service, price/duration
question, `ertaga` and `17:00`, produces the grounded 100,000 UZS / 30-minute
answer plus a staff-reviewed request, and uses exactly one mocked provider call.
Actual booking domain transitions still require explicit subsequent customer
confirmation; no live confirmation is fabricated. This extends only tests, not
runtime behavior. The deployed extraction/grounding correction remains in use;
the separate cancellation correction is still undeployed.

Verification for this test/evidence-only update:

```text
node node_modules/vitest/vitest.mjs run tests/ai/s22-booking-chain.test.ts
  PASS: 2/2 connected rehearsals, mocked HTTP/persistence, no paid call
node node_modules/typescript/bin/tsc -p tsconfig.json --noEmit
  PASS
node node_modules/eslint/bin/eslint.js tests/ai/s22-booking-chain.test.ts --max-warnings=0
  PASS
```

Scoped Prettier and `git diff --check` **PASS** for these three files.
No production change, deployment, migration, IAM change, new diagnostic,
OAuth, event replay, broad CI or paid test is needed for this preparation. S22
remains unaccepted. The single next owner interaction is to load and Claim/Start
handling only the identified synthetic Instagram conversation in the staff UI.

### Final authorized turn: bounded persisted trace preparation — 2026-10-07

Owner-supplied screenshots subsequently show Claim feedback with the transcript
retained, then Resolve feedback, Inbox 0 and the selected transcript still open.
These are UI observations, not a new persisted transition/audit assertion. Do not
repeat either mutation or substitute an earlier handoff ID/version.

The friend sent the final authorized combined service/price/duration/preference
DM at **2026-10-06 23:00 Asia/Tashkent (18:00 UTC)**. The owner reports no reply.
One bounded owner-authenticated log read found an Instagram webhook HTTP **200**
at **18:00:15.987873Z**, but no correlated Worker/AI outcome. This does not prove
that this particular DM was normalized, accepted, persisted or processed. Source
`apps/api/src/instagram/plugin.ts` returns 200 for ignored/empty events and
`channel_unavailable`; application ingress also suppresses ineligible threads.
Those are possible paths, not the proven cause. No OAuth/provider/eligibility
configuration change, replay or further paid DM is justified by this result.

The existing `booking-evidence` workflow gains only a **final-turn** read mode.
Its self-contained reader binds the exact staging organization/conversation and
**17:58–18:15 UTC on October 6**. One guarded execution collects current channel/
thread status, safe message metadata, exact scoped AI usage/outcome/action rows,
Outbox scheduling, allowlisted audits, legacy receipt metadata and current cohort
accounting. Missing/ambiguous inbound discovery and row-cap saturation fail
closed without choosing a different message. Current context is not falsely
presented as the historical state at receipt. The canonical Instagram store does
not currently write `webhook_receipts`; no rows there is not proof of rejection.
Queue-table privileges are inspected but private queue/handler records are not
read or new permissions granted; any remaining queue proof must use the discovered
exact correlation in already-authorized logs.

The existing immutable Worker/Migrator, identities, runtime-secret reference,
private network and explicit zero retries remain pinned to the approved rollout.
The reader adds FORCE-RLS/not-owner checks for its three additional public tables.
Every transaction is runtime-role, tenant-context, read-only, query-bounded and
rolled back, with connection cleanup. No provider construction, message bodies,
provider account IDs, credentials, snapshots or full audit payloads are selected.
No job configuration, migration entrypoint, infrastructure or runtime code changes.
Historical NULL costs and existing spend/slot ceilings remain unchanged. Collection
PASS never means generation/delivery PASS or authorization for another paid turn.

Local verification: **30/30 Node tooling tests PASS**, including the actual
generated final-turn ES-module bootstrap with controlled application-package and
relative-module resolution, rollback/cleanup, absent/ambiguous/capped discovery,
NULL-cost preservation and redaction. Scoped ESLint (zero warnings), formatting
and diff checks pass. These mocks are not live PostgreSQL/Instagram proof.
The new read has not executed at this preparation checkpoint. Existing CI and
runtime rollout proof are reused; no full suite/build/deployment is repeated.

Owner result recovery uses one bounded Logging REST read with an exact execution
filter, strict output allowlist and readable text. The recovery path cannot start
a job. Authentication/permission/timeout, truncated/duplicate/missing assertions
and failed diagnostic assertions remain explicit; no raw error payload or token
is printed. Existing WIF Logging denial is not grounds for IAM broadening. S22
and the booking journey remain unaccepted pending the actual persisted trace.

### Existing final-turn execution and recovery authentication — 2026-10-07

Tooling commit `3b4ecec9558f732d6ac13e0b88aa42a681bc7931` was pushed and its
remote SHA verified. Read-only workflow **37523609035** checked the approved
Worker image/source, booking gate, one instance and private network, plus the
diagnostic identity/image/runtime-secret/private-network/explicit-zero-retry
safeguards. Its single execution **`lead-agent-staging-migrator-kn9mf`** completed
unsuccessfully. The artifact has no assertion rows because collection failed with
**`EXACT_EXECUTION_LOG_PERMISSION_DENIED`**. The diagnostic's actual failed
assertion/SQL error and missing-reply cause are **not yet known**. No migration,
job configuration change, IAM grant, provider call or message replay occurred.

Owner recovery initially returned `LOG_AUTHENTICATION_UNAVAILABLE`. The follow-up
bounded Cloud Shell checks returned **LOGIN_CHECK_EXIT=0 / TOKEN_CHECK_EXIT=0**,
without exposing identity or token values. This proves those CLI commands exited
successfully, not the earlier failure's exact cause or successful log retrieval.
The old 10-second wrapper also combined timeout, missing executable, process
failure and invalid output into one tag; a timeout remains plausible, not proven.

The recovery-only correction uses one **30-second** token attempt followed by
the existing **15-second** Logging REST bound, without retries. It distinguishes
`LOG_AUTHENTICATION_TIMEOUT`, `LOG_AUTH_CLI_UNAVAILABLE`,
`LOG_AUTHENTICATION_UNAVAILABLE` and `LOG_TOKEN_RESPONSE_INVALID`, discarding
credential-bearing stdout/stderr from errors. Both existing-log recovery modes
share this narrow correction; neither can execute a diagnostic job.

A controlled missing-CLI subprocess regression failed before the correction and
passes after it. **26/26 focused Node tests PASS**, including timeout/output/error
classification, redaction, exact recovery scope and module resolution. Scoped
ESLint, Prettier and diff checks pass. No broad CI or runtime deployment is needed.
Recover only the saved output from `kn9mf`; do not rerun the diagnostic, resend the
DM or spend another paid slot. Historical NULL costs and S22 pending status remain.

### Final paid turn recovered; citation identity regression — 2026-10-07

Owner-supplied output from the existing `lead-agent-staging-migrator-kn9mf` read
closes the collection gap, not the booking journey. Discovery failed because no
inbound was persisted in its fixed **17:58–18:15 UTC** window. The same read found
the latest synthetic inbound `01a112ac-2131-7760-a642-53cff85fa955` at
**2026-10-06T19:23:52.883Z**, and outbound
`01a112ac-3a40-7646-bb0c-7fe07adfc2bf` at **19:23:59.374Z**, delivery **sent**.
The reported 23:00 and persisted receipt time are not interchangeable; the earlier
HTTP 200 is not proof of this exact DM. No further diagnostic/replay was executed.

The owner then supplied the exact Worker outcome at **19:23:59.451707Z**:
AI run `01a112ac-27b2-7589-b4b2-644ad9599946`, correlation
`01a112ac-2131-74b5-9f58-9a6b8d9de6fd`; provider **completed**, schema **valid**,
proposed action **none**, extraction rejection fields **empty**, policy rejection
**untrusted_citation**, final fallback **policy_denied / handoff_requested**,
reply disposition **queued**. The earliest proven failing stage is citation policy,
after provider completion/schema validation, not a provider timeout. Previously
proven price/duration retrieval does not establish the exact facts supplied to this
run; the safe outcome log alone cannot exclude a missing/inapplicable reference.
The persisted outbound is the fallback, not a successful grounded booking answer.
Current state is **awaiting_staff / paused**, conversation version **21**, active
handoff, **zero AppointmentRequests**. No current handoff ID is inferred from a
thread-control ID or an old resolved resource.

The current ledger reports **3 logical messages / 3 physical calls**, known new
cost **6,207 micros (USD0.006207)**, unresolved reserve **0**, historical budget
reserve **1,033,396 micros**, combined exposure **1,039,603 micros (USD1.039603)**.
Historical NULL costs and `accountingComplete=false` remain visible. This
supersedes the historical two-message checkpoint. `blocked=false` does not
authorize a fourth distinct paid message: the dispatch gate separately enforces
the approved three-message limit. Paid testing is paused; no allowance is reset.

Source review confirms the deployed S15/S16 citation gate compared
`JSON.stringify(fact.reference)` with `JSON.stringify(claim)`. Approved fact/input
order is `claim_kind, source_type, source_id, source_version`; the canonical
response schema orders `source_id` before `source_type`. Gemini's adapter uses
`JSON.parse` and contract validation is a non-transforming type guard, so identical
authorized references with a different property order are reachable and wrongly
rejected. The exact historical rejected citation/property order was not retained
in the safe outcome log. This is a **proven local production defect consistent
with the live rejection**, not proof that the historical model cited no wrong fact.
No raw provider-output capture, secret access or another paid call is justified.

The focused correction shares the existing four-field semantic identity rule
between generic and sales policy. Every claim must still match **claim kind,
source type, source ID and source version** in the supplied tenant-authorized
snapshot. Foreign/missing/stale references remain rejected; no model text/action,
publication selector, social-thread eligibility, RLS or booking-confirmation rule
is relaxed. Internal telemetry adds only bounded supplied/proposed/unmatched
citation counts against the inference snapshot, never reference values, messages
or provider payloads. This does not reconcile historical NULL costs.

Before the correction, **23/24** property-order permutations and **both connected
booking rehearsals failed**. After it, **299/299 focused tests PASS** across sales,
the real Gemini adapter with mocked HTTP, booking domain workflow, telemetry,
generic policy, grounding, readiness, submission and orchestration. Tests preserve
changed-ID/version/type/kind denial and unknown-reference/empty-snapshot failure;
they prove a policy denial does not consume a repair and diagnostics project only
bounded numbers. Mocked persistence/HTTP and domain confirmation are **not live
PostgreSQL, provider quality, offer delivery or customer confirmation evidence**.
Verification commands/results for this scoped correction:

- `node node_modules/vitest/vitest.mjs run tests/ai/sales-flow.test.ts tests/ai/s22-booking-chain.test.ts tests/ai/policy-fallback-telemetry.test.ts tests/ai/context-policy.test.ts tests/ai/grounded-answers.test.ts tests/ai/s22-business-readiness.test.ts tests/ai/appointment-submission.test.ts tests/ai/orchestration.test.ts` — **299 PASS**.
- `node node_modules/typescript/bin/tsc -p tsconfig.json --noEmit` — **PASS**.
- Application build from `packages/application`:
  `node ../../node_modules/typescript/bin/tsc -p tsconfig.build.json --noEmit false --declaration true --declarationMap true --outDir dist --rootDir src` — **PASS**.
- `node node_modules/typescript/bin/tsc -p apps/worker/tsconfig.build.json` — **PASS**.
- Scoped ESLint for the eight changed TypeScript files, zero warnings — **PASS**.
- `node scripts/check-boundaries.mjs` — **PASS**, 313 source files.
- Scoped Prettier and `git diff --check` for the ten correction files — **PASS**.
  Whole-worktree diff checking also reports pre-existing trailing whitespace in
  the unrelated owner-edited `s11-instagram-business.md`; it is preserved/excluded.

No old image, saved plan or approval hash may be reused for this new source.

This correction and the already-committed cancellation-listener correction remain
**undeployed** at this checkpoint. No paid test, event replay, OAuth, migration,
IAM change or broad CI occurred. S22 remains unaccepted. A fresh immutable build
and reviewed runtime-only saved plan precede any exact-plan apply approval; a new
paid journey allowance would require a separate explicit owner decision.

### Citation correction rollout approval packet — NOT APPLIED

Runtime source: **`cde3f6580f7625c02196539ca18c6aa4b3c408fe`**, preserved on
`verify/s22-staging-recovery-capacity`. Focused correction commit was pushed and
the remote branch SHA matched. Later evidence-only updates require no rebuild.
The source also includes the previously tested, undeployed cancellation-listener
fix; neither runtime correction is claimed live before apply/verification.

One fresh immutable build **[37579659374](https://github.com/mufazzalshokh/lead-agent-platform/actions/runs/37579659374) PASS**;
the downloaded manifest independently matches this exact source and build ID.
All four images are `linux/amd64`, with build provenance/SBOM enabled:

| Workload | Exact immutable reference |
| --- | --- |
| API | `me-central1-docker.pkg.dev/lead-agent-stg-739284/lead-agent/api@sha256:0a3c38dbc9c7ed7f5d3d029b4191351c2d0dae3ec73f6149d06c7ad50afa355a` |
| Web | `me-central1-docker.pkg.dev/lead-agent-stg-739284/lead-agent/web@sha256:98971efcb7c969d05476a0ce9a29a7aad3370e59a3c45595133f675c066a8c93` |
| Worker | `me-central1-docker.pkg.dev/lead-agent-stg-739284/lead-agent/worker@sha256:6befbf18bb01eb0d7870fb41698407e91456dd55237134427ca7ee026af0b694` |
| Migrator | `me-central1-docker.pkg.dev/lead-agent-stg-739284/lead-agent/migrator@sha256:7baa11d11a31a93c0c2910e9209a453d176fd39df0fc4d5dea3e8ce7d5016f24` |

One fresh plan-only run **[37580236686](https://github.com/mufazzalshokh/lead-agent-platform/actions/runs/37580236686) PASS**, `phase=full`:

- Deployment timestamp: **`2026-10-07T06:11:53Z`**.
- Migration provenance: **`0031_s22_widget_inbound_route_management`**, unchanged.
- Saved-plan SHA256 (downloaded binary independently hashed):
  **`708dad4be348271228c9aa829f54e853f9266605729cddc8a621d5edf10971bb`**.
- **0 creates / 4 in-place changes / 0 destroys / 0 replacements**.
- Exactly `google_cloud_run_v2_job.migrator[0]`,
  `google_cloud_run_v2_service.api[0]`, `google_cloud_run_v2_service.web[0]`,
  `google_cloud_run_v2_worker_pool.worker[0]`.
- No SQL/IAM/network/scaling/resource-limit/secret-reference change. No migration
  execution. The workflow's apply and one-shot migrator steps are **SKIPPED**.

The repository full-runtime plan safety guard passed. An independent local
`terraform -chdir=infra/deploy/gcp/staging show -json <downloaded-plan>` inspection
kept JSON private and projected only allowlisted metadata. It confirmed all four
manifest image bindings, exact source/timestamp on all workloads, unchanged
identities/VPC/scaling/resource limits/secret references, and changes limited to
images, `git-sha` labels and `DEPLOYMENT_GIT_SHA`/`DEPLOYMENT_IMAGE_DIGEST`/
`DEPLOYMENT_TIMESTAMP`. Root-directory `terraform show` initially lacked the
existing provider-schema context; using the already-initialized staging directory
resolved the read without installation, initialization, infrastructure change or
another plan. The recorded and independently computed binary checksums match.

Prepared subsequent apply inputs (not dispatched; approval token withheld):

| Input | Exact value |
| --- | --- |
| `action` | `apply` |
| `phase` | `full` |
| `commit_sha` | `cde3f6580f7625c02196539ca18c6aa4b3c408fe` |
| `deployment_timestamp` | `2026-10-07T06:11:53Z` |
| `api_image`, `web_image`, `worker_image`, `migrator_image` | Exact references above; no tags/substitutions |
| `api_migration_head`, `runtime_migration_head` | `0031_s22_widget_inbound_route_management` |
| `ai_journey_mode` | `preserve` (saved plan retains existing `booking` mode) |
| `plan_run_id` | `37580236686` |
| `approved_plan_sha256` | `708dad4be348271228c9aa829f54e853f9266605729cddc8a621d5edf10971bb` |

Existing cohort binding/reservations and exhausted three-message allowance remain
unchanged. Retaining the configuration is not new paid-call authorization.
Artifacts have seven-day retention; the saved plan's stale-state protection must
still pass at apply. No assumption that future state cannot change is made.
Exact saved-plan owner approval is required before apply; any stale/safeguard
rejection stops rather than generating an unapproved replacement. Historical NULL
costs, the live booking gap and S22 pending status remain visible. No broad CI,
paid call, message replay, OAuth, migration or apply was performed for this packet.

### Citation correction applied and verified — 2026-10-07

The owner approved the exact preceding saved-plan packet. Apply run
**[37581684183](https://github.com/mufazzalshokh/lead-agent-platform/actions/runs/37581684183) PASS**
used source **`cde3f6580f7625c02196539ca18c6aa4b3c408fe`**, plan run
**37580236686**, SHA256
**`708dad4be348271228c9aa829f54e853f9266605729cddc8a621d5edf10971bb`**,
and the four exact immutable references recorded above. Saved-plan integrity and
the full-runtime approval boundary passed. Terraform's actual result was
**0 added / 4 changed / 0 destroyed**, matching the reviewed four in-place updates
and zero replacements. No images were rebuilt and no replacement plan was
generated. The one-shot migrator was **SKIPPED**. No SQL, IAM, networking, scaling
or secret-reference changes were applied.

Read-only verification run
**[37581905191](https://github.com/mufazzalshokh/lead-agent-platform/actions/runs/37581905191) PASS**
used the same four image references, source, deployment timestamp
**`2026-10-07T06:11:53Z`**, and unchanged migration provenance
**`0031_s22_widget_inbound_route_management`**. Its downloaded sanitized artifact
`s22-api-image-live-evidence-37581905191` reports **zero failed assertions**:

- API image/source/timestamp/migration bindings, runtime identity, private VPC,
  subnet, private-ranges egress and secret-reference count: **PASS**.
- API ready revision **`lead-agent-staging-api-00021-d4j`**: **PASS**.
- Exact Web image and ready revision **`lead-agent-staging-web-00017-x9f`**: **PASS**.
- Whole-runtime `terraform plan -detailed-exitcode -lock-timeout=5m`: **exit 0**.
  This refreshed convergence includes the exact Worker/Migrator desired bindings;
  the separate direct-service metadata assertions cover API/Web. No migration,
  diagnostic job or apply was executed by the verification run.

Independent public checks after apply returned API `/health` **HTTP 200**, service
`api`, status `ok`, and the organization-bound Web workspace **HTTP 200**, HTML.
Web reachability is not authenticated owner-flow or live booking proof.

The citation-identity and cancellation-listener corrections are now deployed.
The existing `booking` mode was preserved, with no budget/tenant-binding change.
The last persisted ledger evidence remains the owner-supplied `kn9mf` observation,
not a new post-deployment ledger read: **three logical messages consumed**, known
new cost **USD0.006207**, historical budget-only reserve **USD1.033396**, combined
exposure **USD1.039603**, historical NULL costs still unknown. No message replay,
new paid call, ledger reset, OAuth or broad CI was performed. Config preservation
does not renew the exhausted paid-test authorization.

Only these evidence/journey documents changed after rollout; scoped Prettier and
diff checks apply to that documentation checkpoint, with no runtime redeployment.
The next journey requires a separately authorized bounded paid allowance and
current synthetic handoff readiness. Do not send another DM yet. Live grounded
answer/request/offer/customer-confirmation proof remains open; **S22 is unaccepted**.

### Approved one-message continuation preparation — 2026-10-07

The owner approved preparation of **one additional synthetic paid message**, at
most **two physical attempts**, reserving at most **USD1.602864** more. This is
not permission to apply a deployment or make paid calls now. Exact-plan approval
and post-deployment readiness remain required. The citation rollout above is not
repeated and its live outcome is not reclassified as a completed booking.

The private profile remains `s22-synthetic-booking.v1`, bound to the same exact
organization/conversation. Cumulative limits become **four messages / five
physical calls / two calls per message**; existing audit markers, three consumed
messages/calls, known costs and the two historical NULL costs are not reset,
reclassified or written. The hard ceiling remains USD10. Per-call reservation is
unchanged at USD0.801432. From the last accepted ledger, the maximum projected
combined exposure is **1.033396 + 0.006207 + 1.602864 = USD2.642467**, not an exact
accounting reconstruction or a fresh state observation. Unknown-cost/timeout,
in-flight, stale-version, wrong-tenant/thread, expired-price and integrity stops
remain enforced before provider dispatch. No model, pricing or billable extras
changed.

The read-only status previously omitted logical-message exhaustion even though
dispatch correctly denied a fourth message. It now returns `blocked=true` and
`reason=message_limit` at the new four-message cap. This describes permission for
a **new logical message**, not the current message's allowed schema repair;
`authorizeDispatch` independently reserves and verifies that repair. The fifth
cumulative physical slot ends further attempts. The diagnostic's strict expected
cohort counts and its controlled bootstrap fixture are aligned with the approved
profile; historical documentation/count evidence is not globally rewritten.

Before the implementation, **five focused assertions failed**, including the
fourth-message continuation, revised physical limit and logical-limit reporting.
Afterward, **29/29 local ledger/dispatch tests PASS**, with modeled pg transport:

- `node node_modules/vitest/vitest.mjs run tests/ai/s22-budget-ledger.test.ts tests/ai/s22-journey-dispatch.test.ts`.
- Continuation coverage preserves two NULL-cost records plus all three prior
  reservations/costs, uses independent guard instances, reserves both new slots,
  proves the USD2.642467 worst case, rejects a fifth message/third same-message
  attempt and rejects config widening. Existing concurrency/unknown-cost/commit
  uncertainty/cross-tenant tests remain green; these are not fresh PostgreSQL proof.
- `node --test .github/scripts/s22-booking-first-turn.test.mjs .github/scripts/s22-booking-evidence.test.mjs` — **21/21 PASS**, including real Node subprocess
  ES-module/package resolution, rollback/cleanup and redaction with controlled
  fixtures; no live database/provider access.
- Root `tsc -p tsconfig.json --noEmit` and scoped six-file ESLint with zero
  warnings — **PASS**. Config/database production/declaration builds and Worker
  build — **PASS**. Scoped Prettier and diff checks — **PASS**.

No migrations, IAM, schema, RLS, social eligibility, contracts, confirmation policy
or unrelated owner edits changed. No extra aggregate or prior parser/citation
test round is manually dispatched. A fresh immutable image build
and one reviewed runtime-only saved plan follow verified source. Do not reuse the
previous rollout's image digests or plan hash. **Not deployed; no paid calls.**

### One-message continuation rollout packet — NOT APPLIED

Source **`191a9cdbb4187ad0006a5dbab04882b4f44d0e64`** was committed and pushed
to `verify/s22-staging-recovery-capacity`; the remote SHA matched. The focused
PostgreSQL push check **[37583343644](https://github.com/mufazzalshokh/lead-agent-platform/actions/runs/37583343644) PASS**
ran the existing three budget cases on PostgreSQL 17.11: **3 passed / 449 skipped**.
Existing pull-request CI automatically ran on this push:
**[37583346883](https://github.com/mufazzalshokh/lead-agent-platform/actions/runs/37583346883) PASS**.
No extra aggregate was manually dispatched. The 50 focused local checks above
and unchanged SQL/transaction implementation remain the scoped correction proof.

One fresh image build **[37583383103](https://github.com/mufazzalshokh/lead-agent-platform/actions/runs/37583383103) PASS**.
Downloaded manifest source/build ID and all four immutable references independently
match this exact source; architecture `linux/amd64`, provenance/SBOM enabled:

| Workload | Exact immutable reference |
| --- | --- |
| api | `me-central1-docker.pkg.dev/lead-agent-stg-739284/lead-agent/api@sha256:e2b3ac2b91b792bb74d3d7d14e8e30dc72fbe7f243badde3d1158be147eed657` |
| web | `me-central1-docker.pkg.dev/lead-agent-stg-739284/lead-agent/web@sha256:a6f2169b232a8357e804a923eddb774dd8a1cbfdda109810a007a13754a107a1` |
| worker | `me-central1-docker.pkg.dev/lead-agent-stg-739284/lead-agent/worker@sha256:f654f252f802488f5ef08d3a9a8a99dbe4ccc09ca01b59c1adff88b71c124506` |
| migrator | `me-central1-docker.pkg.dev/lead-agent-stg-739284/lead-agent/migrator@sha256:e66cba1a63b620863e30eeea210ff4169daef559dfc4c2b9eae4daba32bafb16` |

One plan-only full-runtime reconciliation
**[37583839262](https://github.com/mufazzalshokh/lead-agent-platform/actions/runs/37583839262) PASS**.
Deployment timestamp **`2026-10-07T06:50:40Z`**; migration head
**`0031_s22_widget_inbound_route_management`**, unchanged.
The downloaded saved binary's independently computed SHA256 matches its artifact:
**`3b086e086bee0ed60a0eb418727a5d6189cb4f56a1f3fe0423c9a82b6367d72f`**.

Actual reviewed actions: **0 creates / 4 in-place updates / 0 destroys /
0 replacements**:

- `google_cloud_run_v2_job.migrator[0]` — update image/provenance only.
- `google_cloud_run_v2_service.api[0]` — update image/provenance only.
- `google_cloud_run_v2_service.web[0]` — update image/provenance only.
- `google_cloud_run_v2_worker_pool.worker[0]` — update image/provenance only.

The workflow safety guard passed. Independent local inspection using the existing
Terraform 1.14.7 staging provider context kept the full JSON private and checked
every known changed field against image/source-label/deployment-metadata paths.
All four images, source/time/migration bindings match; runtime identities, network,
scaling/resources and non-provenance environment/secret references are unchanged.
API/Migrator include an explicit image-digest environment field; Web/Worker bind
their digest through the actual container image, matching existing `runtime.tf`.
No SQL, IAM, network, scaling, secret or unexpected resource action is present.
Apply and one-shot migrator steps are **SKIPPED**. Plan generation refreshed the
authoritative remote state; future stale-state rejection must stop, not replan.

Prepared exact subsequent apply inputs (NOT dispatched; no approval token supplied):

| Input | Value |
| --- | --- |
| `action` | `apply` |
| `phase` | `full` |
| `commit_sha` | `191a9cdbb4187ad0006a5dbab04882b4f44d0e64` |
| `deployment_timestamp` | `2026-10-07T06:50:40Z` |
| `api_migration_head` | `0031_s22_widget_inbound_route_management` |
| `runtime_migration_head` | `0031_s22_widget_inbound_route_management` |
| `ai_journey_mode` | `preserve` |
| `plan_run_id` | `37583839262` |
| `approved_plan_sha256` | `3b086e086bee0ed60a0eb418727a5d6189cb4f56a1f3fe0423c9a82b6367d72f` |
| `api_image`, `web_image`, `worker_image`, `migrator_image` | Exact immutable references above |

`preserve` resolves to existing `booking` mode; the new source enforces the revised
four-message/five-attempt cumulative caps. Current approval covers implementation,
testing and plan preparation only. Deployment/paid execution remain paused pending
the exact owner decision and post-apply readiness. No counter/ledger mutation or
new database diagnostic occurred. Historical unknown accounting, the unconfirmed
live booking journey and S22 pending status remain explicit. Later evidence-only
commits do not change runtime source or justify rebuilding these images.

### Exact continuation plan applied and verified — 2026-10-07

The owner explicitly authorized **plan 37583839262 only**. Its existing saved
binary was independently rehashed before dispatch and matched
**`3b086e086bee0ed60a0eb418727a5d6189cb4f56a1f3fe0423c9a82b6367d72f`**.
The exact source, four immutable images and timestamp in the preceding packet
were reused without rebuilding images or generating a replacement saved plan.

Apply **[37593007330](https://github.com/mufazzalshokh/lead-agent-platform/actions/runs/37593007330) PASS**:
download of the reviewed artifact, exact full-runtime approval boundary and apply
steps succeeded. Terraform reported **0 added / 4 changed / 0 destroyed**; the
reviewed four workload updates were in-place, with **0 replacements**. The
one-shot migrator and database-validation execution steps were **SKIPPED**.
No SQL, IAM, network, scaling or secret change was included.

Read-only verification
**[37596517708](https://github.com/mufazzalshokh/lead-agent-platform/actions/runs/37596517708) PASS**.
Downloaded artifact `s22-api-image-live-evidence-37596517708`, file
`s22-api-image-live-evidence.txt`, reports **PASS / 0 failures**. Direct live
metadata matches the API image/source/timestamp/migration provenance, runtime
identity, private VPC/subnet/egress, 15 secret references and readiness; the Web
image and readiness also match. Ready revisions are `lead-agent-staging-api-00022-fdp`
and `lead-agent-staging-web-00018-mw8`. Whole-runtime Terraform convergence
**exit 0** covers the configured Worker/Migrator bindings; this is not a separate
direct REST assertion for those two workloads. Public API `/health` returned
**HTTP 200**, service `api`, status `ok`; organization-bound Web reachability
returned **HTTP 200**, HTML. These checks do not prove authenticated owner UX or
the live customer-to-confirmed-booking journey.

Deployed runtime source is **`191a9cdbb4187ad0006a5dbab04882b4f44d0e64`**,
with reviewed timestamp **`2026-10-07T06:50:40Z`** and unchanged migration head
**`0031_s22_widget_inbound_route_management`**. Existing booking mode was preserved;
the source enforces four cumulative logical messages, five cumulative physical
attempts and two attempts per message. No event replay, paid call, migration,
ledger reset, historical NULL-cost rewrite, OAuth or repeated test suite occurred.
No fresh database readiness/ledger observation is claimed. The last accepted
historical reserve remains USD1.033396 and exact historical accounting remains
incomplete. Unrelated owner edits were preserved.

Next: use the existing authorized read-only interface to establish current
synthetic handoff/request/ledger readiness before instructing another customer
DM. Paid execution remains paused at this checkpoint. Staff acceptance alone is
not confirmation; actual delivered-offer customer confirmation is still required.
**S22 remains unaccepted; no S23 work.**

### Post-Resolve readiness reader repinned — 2026-10-07

The owner reports Claim followed by Resolve on the original synthetic test chat.
This is owner-reported UI evidence, not a new persisted state/version/audit
assertion. The different friend's unanswered DM is outside the fixed paid cohort;
its actual ingress/eligibility disposition is not inferred from this chat's Inbox.
Neither a new paid call nor a broader social-thread approval is authorized here.

The existing diagnostic launcher still pinned the extraction rollout. Its exact
source/timestamp and Worker/Migrator image expectations now match the already
approved apply **37593007330** and verification **37596517708**, using the existing
build **37583383103** manifest. Only diagnostic pins and regression expectations
change; all runtime code, image builds, Terraform, secrets and database state are
unchanged. The exact-pin test matches the continuation rollout and rejects the
prior images, source and timestamp; no identity, VPC, retry, tenant/RLS,
read-only transaction, timeout, rollback or output-redaction safeguard is relaxed.

Local verification: `node --test .github/scripts/s22-booking-evidence.test.mjs
.github/scripts/s22-booking-first-turn.test.mjs` **21/21 PASS**, including real
Node subprocess module/package resolution with controlled fixtures and no live
DB/provider access. Scoped ESLint with zero warnings, Prettier and scoped
`git diff --check` **PASS**. No TypeScript/runtime change requires another build
or aggregate. One existing **observe** workflow follows publication of this
tooling commit; it is not another first-turn test or deployment. Collection PASS
alone will not be called readiness: independently check current open/AI/no-handoff
state, appointment requests and the settled remaining message/call allowance.
Paid execution remains paused pending that result and applicable authorization.

### Post-Resolve diagnostic executed; result-log access blocked — 2026-10-07

Tooling commit **`829f1c46b493d7b9a57e7708c60bb9a22071e0b4`** was pushed and the
remote SHA verified. One **observe** run
**[37621701908](https://github.com/mufazzalshokh/lead-agent-platform/actions/runs/37621701908)**
produced sanitized artifact `s22-booking-evidence-37621701908`.
The artifact confirms live Worker image/source/time/migration, booking mode,
one manual instance and private VPC passed the exact guards. The diagnostic's
immutable image, runtime database-secret reference, identity, private VPC and
explicit zero retries also passed. Runtime deployment remains source `191a9cd`;
the tooling commit is not deployed runtime code.

Exactly one read-only execution **`lead-agent-staging-migrator-q2z8g`** succeeded,
using reader SHA256
**`d4b87ff17d8609dca0f871c5cef7571cddc57de469fcb34c5f7297bbcdee9109`**.
The workflow then stopped with **`EXACT_EXECUTION_LOG_PERMISSION_DENIED`**, empty
collected assertions, not a database/provider failure. No migration entrypoint,
job configuration change, paid call, replay, IAM grant or new diagnostic followed.
Execution success alone is not published as current conversation/budget readiness.

Current state/versions, active-handoff clearance, appointment requests and settled
remaining allowance are **BLOCKED pending collection**. Recover only this existing
execution's `s22_booking_readonly` assertion logs through the owner's existing
authenticated Cloud Shell, with a bounded exact-execution filter and projected
assertion/outcome/observed fields. No file upload or execution rerun is needed.
Historical NULLs remain unknown; no accounting reconciliation or S22 acceptance
is claimed. Paid execution remains paused.

### Existing readiness-result recovery corrected — 2026-10-07

The owner-supplied Cloud Shell result `LOG_READ_EXIT=124` means the bounded CLI
log read timed out. It does not identify whether CLI authentication, transport or
the Logging API stalled, and it does not establish a database/product failure.
The already-completed execution remains **`lead-agent-staging-migrator-q2z8g`**;
neither that execution nor the deployment has been repeated.

The repository-backed launcher now has a recovery-only `--recover-readiness`
mode pinned to that execution, project, job, operation and October 7 UTC window.
It obtains the owner's token privately once (30-second bound), then makes one
direct Logging REST read (15-second bound, 20-entry cap), with no retry or
pagination. Authentication, permission, API timeout, malformed/incomplete,
duplicate, truncated and failed-assertion outcomes remain distinct and fail
closed. This mode cannot execute a job or enter the migration/readiness launcher;
malformed arguments stop before authentication.

Human-readable output retains failed assertion names and safe state/request,
counter and reservation observations. Collection and continuation readiness are
separate: the original chat must be open/AI/no active handoff with no request;
the reviewed cumulative 4-message/5-attempt/2-per-message binding and settled
3-message/3-attempt baseline must match, with two remaining reserved slots within
the unchanged ceiling. Non-ready snapshots exit nonzero. Historical NULL costs
remain unknown, and a completed-check snapshot is not new paid-call authorization.

Local verification: `node --test .github/scripts/s22-booking-evidence.test.mjs
.github/scripts/s22-booking-final-turn.test.mjs` **30/30 PASS**. Coverage includes
the actual recovery CLI in a Node subprocess with controlled authentication and
REST fixtures, readiness failure exits, exact scope, no extra process/request,
redaction and existing recovery regressions. Scoped ESLint (zero warnings),
Prettier and `git diff --check` **PASS**. Installed CLI entrypoints were used
directly after the pnpm wrapper tried a blocked dependency reconciliation; no
dependency installation or host configuration change was made.

Live recovery has **not** yet returned the six assertions. Current readiness and
the complete booking journey remain **BLOCKED/PENDING**, not PASS. No upload,
diagnostic rerun, provider call, message replay, runtime build/deployment, IAM,
SQL or migration change is needed for this result-recovery correction. Unrelated
owner edits are preserved. **S22 remains unaccepted; no S23 work.**

### Current blocker investigation — 2026-10-07, 13:08 UTC checkpoint

**Status: BLOCKED on private result collection, not a newly proven application
defect.** Repository instructions, current journey/evidence, actual message flow
and existing diagnostic/workflow safeguards were inspected. Investigation base
is `8e09859bcdd519f87c171d26b27b52e5900b06a9` on
`verify/s22-staging-recovery-capacity`. Unrelated owner edits to `README.md`,
`s11-instagram-business.md` and the untracked public-notices patch remain excluded.
No runtime changes are made from hypotheses.

#### Observations and current deployment

- Authenticated GitHub reads now confirm **37621701908 FAILED** at **Read exact
  cohort with the runtime role**, with preserved artifact proving
  `lead-agent-staging-migrator-q2z8g` succeeded and collection failed
  `EXACT_EXECUTION_LOG_PERMISSION_DENIED`. The six assertions are absent from the
  artifact. The owner's subsequent CLI exit 124 proves only a timeout; its
  internal auth/transport/API cause is not known. No result from the corrected
  recovery-only command has been supplied yet.
- Existing IAM code grants the deployer no permanent `roles/logging.viewer`;
  that role is a separate temporary binding defaulting to false
  (`infra/deploy/gcp/bootstrap/main.tf`, `variables.tf`). This is consistent with
  the observed denial, not permission to restore the temporary grant. The safe
  correction is owner-authenticated result recovery, already committed in
  `8e09859`, not another database execution or IAM change.
- Completed **CI 37624137550 PASS** is associated with `8e09859`; it was read,
  not rerun. Reuse the prior **30/30 focused recovery tests**, including real Node
  subprocess invocation with controlled auth/REST, HTTP/auth/timeout separation,
  failed readiness exits, strict scope and redaction. These are local/mocked
  tooling evidence, not real-provider or database readiness results.
- To meet this task's explicit current-state requirement, exactly one existing
  **read-only api-image-verify** run
  **[37626128214](https://github.com/mufazzalshokh/lead-agent-platform/actions/runs/37626128214)
  PASS** was dispatched. Observation window: **13:08:02–13:08:51 UTC**. Tooling
  source is `8e09859`; expected/runtime source remains
  `191a9cdbb4187ad0006a5dbab04882b4f44d0e64`. No saved deployment plan, build,
  apply, migration, database diagnostic, OAuth or paid test was repeated.
- Downloaded sanitized artifact `s22-api-image-live-evidence-37626128214`, file
  `s22-api-image-live-evidence.txt`, SHA256
  `00a5797108a802712f5556375b5a9b6f6c43465a17bf1293fe7a6a8f0a8fc983`,
  reports **PASS / 0 failures**. Current API ready revision is
  `lead-agent-staging-api-00022-fdp`; Web is `lead-agent-staging-web-00018-mw8`.
  API/Web digest references exactly match the continuation packet above. API
  runtime identity, private VPC/subnet/egress, 15 secret **references**, source and
  `2026-10-07T06:50:40Z` deployment timestamp match. Whole-runtime refreshed
  Terraform convergence is **exit 0**; Worker/Migrator are corroborated through
  convergence, not newly asserted as direct REST ready-revision observations.
- Configured API migration provenance is
  `0031_s22_widget_inbound_route_management`. The workflow does **not** query the
  database migration journal, current conversation or budget ledger; their
  present values are not inferred from deployment metadata. No new HTTP 200 or
  deployment success is promoted to end-to-end proof.

#### Last failed eligible journey: observed trace versus implementation

The last proven eligible journey failure is the **original** synthetic chat, not
the different friend's 18:00 UTC DM. Exact tenant/conversation remain
`01a0ee39-91a9-7293-82c0-5b7046c10115` /
`01a1067f-d7d8-7e7e-9fb0-39bfe2f7cdc7`. These are internal synthetic resource IDs;
no customer/account identifiers or content are collected.

| Boundary | Evidence and limit |
| --- | --- |
| Provider receipt/normalization/routing | An 18:00:15.987873 UTC webhook HTTP 200 exists, but no exact event/message identity connects it to either the new friend or the 19:23 synthetic turn. HTTP 200 can include empty normalization, ignored routing or privacy suppression. |
| Synthetic inbound persistence | Owner-supplied `kn9mf` metadata: message `01a112ac-2131-7760-a642-53cff85fa955`, persisted `2026-10-06T19:23:52.883Z`. This receipt time must not be replaced with the reported 23:00 local time. |
| Outbox/physical job | Exact third-turn relay/job/retry/DLQ records were not collected. Do not substitute the first turn's job ID. Source inspection proves routing and ownership checks, not those missing persisted records. Runtime DB role cannot read the private queue tables. |
| Worker/provider/schema | Owner-supplied structured outcome at 19:23:59.451707 UTC: correlation `01a112ac-2131-74b5-9f58-9a6b8d9de6fd`, run `01a112ac-27b2-7589-b4b2-644ad9599946`, provider completed, schema valid, proposed action none. |
| Policy and fallback | `untrusted_citation`, `policy_denied`, `handoff_requested`, reply disposition queued. This is the first recorded failing business boundary, not provider timeout or successful grounded booking generation. The historical rejected citation payload was not retained. |
| Outbound send | Same-conversation fallback message `01a112ac-3a40-7646-bb0c-7fe07adfc2bf`, created 19:23:59.374 UTC, delivery status sent. This proves persisted provider-send status, not delivered/read/customer confirmation. |
| Staff/inbox state | Historical state awaiting_staff/paused, version 21, active handoff, no AppointmentRequests. Later Claim/Resolve reports are owner UI evidence; the new persisted state is awaiting q2 result recovery. |
| Accounting | Last accepted ledger: 3 logical / 3 physical, USD0.006207 known cost, zero unresolved reserve, USD1.033396 historical budget-only reserve, exact historical accounting incomplete. Current values are uncollected. |

Actual flow inspected at the runtime source (no application/infra diff against
`191a9cd`): signature-before-parse and normalization in
`apps/api/src/instagram/plugin.ts` and
`packages/integrations/src/instagram/webhook.ts`; trusted channel routing in
`packages/application/src/instagram/use-cases.ts`; pre-persistence social
eligibility in `conversations/inbound-use-cases.ts`, repeated transactionally in
`packages/database/src/repositories/inbound-conversations.ts`. Unseen social
threads stay uncertain. The repository uses tenant-scoped receipt/MID locks and
atomic domain/message/audit/outbox persistence, not a direct provider-send chain.

Worker `event-routing.ts`, `outbox-dispatcher.ts`, `job-executor.ts` and
`ai-handler.ts` bind canonical tenant/event/version and reliability ownership.
`ai-orchestration.ts` rejects non-open/non-AI/owned/stale sources and revalidates
versions/knowledge at commit. `ai-journey-budget.ts` serializes reservations under
the conversation lock before provider I/O and rejects foreign cohorts, unknown
or pending usage, exhausted attempts/messages and ceiling breaches. Deterministic
confirmation is attempted before AI. Current policy compares citation identity's
four fields, not JSON key order; rejected model material never authorizes state.
`customer-replies.ts` commits reply/audit/outbox atomically. `instagram-outbound.ts`
rechecks tenant/recipient/thread/credential/window, no-ops already-sent messages,
and reconciles ambiguous effects instead of blindly retrying. Staff History uses
the real tenant-authorized non-actionable view; Inbox 0 does not delete messages.

#### Ranked hypotheses and distinguishing evidence

| Rank / hypothesis | Predicted evidence / bounded experiment | Disposition |
| --- | --- | --- |
| 1. Result collection lacks log authority | Successful execution but permission-denied collector, no assertion rows. Recover the existing q2 logs once with owner authentication, not another job. | Confirmed immediate blocker for the GitHub identity; owner CLI timeout cause remains unknown. |
| 2. Original chat remains paused or a request already exists | q2 state/request rows show active handoff, non-open/non-AI, or an existing request. | Unknown. Owner Resolve alone does not rule this out. |
| 3. Remaining allowance is unsettled/exhausted or differently bound | q2 accounting/binding shows pending/unknown reserve, wrong cohort/caps or changed consumed counts. | Unknown. Historical 3/3 cannot establish current dispatch readiness. |
| 4. Different friend's DM was privacy-suppressed | Non-business-eligible thread before canonical persistence; no message/outbox/provider run. | Source-consistent, not observed for that exact event. Never globally enable personal DMs or substitute it into the paid cohort. |
| 5. Different friend's event was ignored before eligibility | Empty normalization, ignored subtype, or missing/inactive route; HTTP 200 but no canonical message. | Competes with rank 4; absent exact event/route metadata prevents distinction. |
| 6. Citation rejection repeats despite correction | Fresh exact-run outcome with supplied/proposed/unmatched citation counts and current snapshot provenance. | No post-correction paid turn is recorded. Historical key-order defect is locally proven, not a reconstruction of the exact historical model payload. |
| Current workload configuration drift | Fresh runtime metadata mismatch or nonzero convergence. | Rejected at this checkpoint by run 37626128214; this does not exclude a future deployment or live logic defect. |
| Provider timeout or Instagram send failure explains the original third turn | Failed provider/absent schema or failed outbound-send status. | Rejected for that turn by completed/schema-valid outcome and persisted sent fallback; no generalized future claim. |

No new application patch/instrumentation is justified by these unknowns. Existing
correlated outcome telemetry and bounded citation counts will distinguish a new
eligible rejection without provider payload capture. Existing accepted regression
coverage for privacy/routing, duplicate MID, ownership/stale context, reservations,
ambiguous sends and citation property-order permutations is reused, not rerun.
The original recorded event is not replayed. A fresh real-provider reproduction
on the exact eligible chat remains blocked on collected readiness and applicable
paid authorization; no new friend/message is requested.

**One external action:** run the already-published checksum-pinned
`--recover-readiness` command in the owner's existing Cloud Shell and return its
short safe output. It collects only q2's six existing assertions and will name
authentication/permission/timeout failures independently. The output is a
completed-check snapshot, not a fresh DB journal check or paid-call authorization.
If this new path fails, stop at that specific access failure; do not blindly
repeat it or start another diagnostic. Next S22 journey item after readiness and
authorization is the bounded grounded answer/AppointmentRequest, then staff
acceptance, delivered offer and actual customer confirmation. **S22 unaccepted.**

### Readiness result recovered — owner-supplied evidence, 2026-10-07

The owner returned the successful human-readable output of the pinned
`--recover-readiness` command from tooling commit
`8e09859bcdd519f87c171d26b27b52e5900b06a9`. This collects the existing
**`lead-agent-staging-migrator-q2z8g`** execution's assertion logs; it does not
launch another diagnostic or read the database again. Authentication and result
collection both report **PASS**. Record this as **owner-supplied live diagnostic
evidence**, not an independently collected new state observation.

The recovered snapshot reports:

- Original synthetic conversation **open / ai**, with **no active handoff** and
  **zero existing booking requests**; readiness for a new test message **PASS**.
- Reviewed cohort binding **PASS**; cumulative usage **3/4 logical messages** and
  **3/5 physical attempts**, leaving one message with at most two attempts.
- Budget readiness **PASS**; unresolved reserve **0**, known cost **6207 USD
  micros**, combined historical reservation/known exposure **1039603 USD micros**.

This closes the scoped result-collection gap and rules out a still-paused chat,
existing request or exhausted/unsettled allowance **at the diagnostic snapshot**.
The original workflow's permission denial and the owner's earlier CLI timeout
remain recorded; the successful recovery does not retrospectively make that
workflow PASS or establish the timeout's internal cause. No handoff/conversation
version, transition/audit rows or database migration-journal head are supplied by
this human-readable result, so none are newly asserted.

Integer reservation arithmetic remains **1033396 + 6207 = 1039603** micros.
At the unchanged **801432 micros per attempt**, two remaining slots add at most
**1602864 micros (USD1.602864)**. The projected maximum combined exposure from
this snapshot is **2642467 micros (USD2.642467)**, below the unchanged USD10
ceiling. These are budget reservations, not exact historical costs; original
historical NULL costs and the accounting gap remain visible and unchanged.

The recorded continuation approval covers preparation; the later owner approval
authorized only the exact deployment plan. Neither this recovered snapshot nor
deployment success is paid execution authorization. Keep the extra paid turn
paused pending explicit approval of **one original-conversation synthetic
message / at most two provider attempts / USD1.602864 maximum additional
reservation**. No further log recovery, job execution, Claim/Resolve, deployment,
OAuth, tests or paid call is needed to close this evidence gap. The different
friend's unanswered DM remains separately unproven and outside this cohort.

After that execution approval, the next journey step is the prepared combined
Uzbek service/price/duration question and future booking preference from the
**original** test friend, followed by observed grounded output/request state.
Staff acceptance, delivered offer and actual customer confirmation remain open.
**S22 remains unaccepted; no S23 work.**

### Owner authorizes the single continuation turn — 2026-10-07

After the readiness recovery, the owner explicitly approved: "Approve one test
message from the original friend, at most two provider attempts." This closes
the paid-execution authorization gap for **only** the remaining original-cohort
turn. The existing four-message/five-attempt/two-per-message limits, maximum
additional reservation **USD1.602864**, projected combined exposure
**USD2.642467**, historical reserve/NULL costs and USD10 ceiling are unchanged.

The next owner action is one combined Uzbek question about the published test
consultation's price/duration and a future booking preference in the original
Instagram conversation. No resend, replay, additional customer test, new cohort,
manual provider call or privacy override is authorized. Stop on timeout, unknown
cost, guard failure or exhausted allowance. No additional readiness diagnostic,
deployment, migration or IAM change is required by this approval.

No new message/provider call or journey result has been observed at this entry.
Grounded output, authoritative request, staff acceptance, delivered offer and
actual customer confirmation remain pending; staff acceptance alone is not a
confirmed booking. **S22 remains unaccepted; no S23 work.**

### Authorized continuation: grounded Instagram reply — 2026-10-07

The owner reports the original friend sent the single approved continuation at
**18:40 Asia/Tashkent (approximately 13:40 UTC)**. The received Instagram reply
states **UZS100000**, **30 minutes**, and a request for **08 October 2026 17:00**
pending staff review. This is **owner-reported live customer-visible grounding
and receipt evidence**. It is not yet a persisted AppointmentRequest, fresh
version/audit, exact AI-run usage/cost, attempt-count or independent delivery
assertion. The wording does not claim guaranteed availability or confirmation.
Redundant price wording is noted as non-blocking presentation polish; no runtime
patch or additional paid test is justified solely by that wording.

Authenticated GitHub read confirms no newer staging workflow than read-only
verification **37626128214**; no workflow was dispatched here. Local gcloud and
a Chrome DevTools listener on port 9222 are unavailable. The existing GitHub
collector's log-permission failure remains recorded; it is not bypassed by IAM
changes or another execution of the pre-turn diagnostic. Direct post-turn
request/run/accounting evidence is still pending. A message-limit dispatch stop
after the fourth allowed message must not be mislabeled as accounting failure.

Read-only source inspection confirms staff acceptance exists in the authenticated
workspace: **Inbox → Refresh → original synthetic conversation → Review
appointment request → Start / End → Accept request**. It is shown only for a
requested AppointmentRequest with current action identity, and mutations retain
tenant authorization, CSRF, fresh versions and idempotency. The owner must verify
the intended request before that authorized synthetic staff action. Local Windows
timezone is **UTC+05:00, no DST**; Oct 8 17:00–17:30 on this device corresponds
to 12:00–12:30 UTC. No acceptance was executed by this investigation.

The next customer action is withheld until the real current confirmation offer
is received. Ongoing journey wording is corrected to **Ha, tasdiqlayman.**:
source `packages/application/src/appointments/customer-confirmation.ts` accepts
these tokens deterministically; the previously suggested longer phrase contains
unrecognized tokens and clarifies instead. This is a documentation correction,
not weakening confirmation recognition. No credentials, customer identifiers,
raw provider payloads, runtime code, ledger, SQL, migration or IAM were changed.
Grounded reply is owner-reported PASS; request persistence/accounting remain
pending; staff acceptance, offer delivery and actual confirmation are unproven.
**S22 remains unaccepted; no S23 work.**

### Owner-reported confirmed booking; persisted completion collection prepared — 2026-10-07

The owner subsequently reported that the original friend received the
staff-accepted offer for **08 October 2026 17:00 Asia/Tashkent**, explicitly
asking for confirmation. After the instructed actual customer confirmation,
the owner reported receipt of the final confirmation acknowledgment for the
same time. The **owner-reported live customer-visible** journey is PASS:
grounded facts → request → staff acceptance → delivered offer → customer
confirmation → received acknowledgment. This is not independent persisted
request/version, confirmation, audit, delivery, converted-lead or cost evidence.
No exact confirmation timestamp, inbound ID or cost is inferred from wording.
No additional paid message is requested or authorized.

The existing readiness predicate correctly rejects an exhausted cohort; applying
it to completion would falsely fail a settled fourth-message journey. Tooling now
has a separate `--complete-booking` assertion: four logical messages, four/five
physical attempts, expected `message_limit`/`attempt_limit` stop, no pending
reserve, and exact reconciliation of collected continuation cost against the
prior **6207 USD micros** known baseline. Historical costs remain NULL and
`accountingComplete=false`. This verifies approved reservation accounting, not
exact historical costs. Production budget/booking/privacy policies are unchanged.

Eight bounded, parameterized completion reads supplement six baseline assertions.
The reader discovers exactly one request in the original authorized conversation
between **2026-10-07T13:35:00Z and 2026-10-08T00:00:00Z**, then scopes every
subsequent query to the organization/conversation/discovered request. It checks:

- Requested/1 → staff_accepted/2 → awaiting_customer_confirmation/3 → confirmed/4,
  including intermediate preparation, actual actor/correlation bindings and the
  **October 8 12:00–12:30 UTC** offer. These are source-derived expectations, not
  newly observed live versions.
- Immutable direct Instagram customer confirmation for the current offer/window,
  no substituted staff attestation, and no provider call on confirmation.
- Sent/delivered offer and acknowledgment with exact reply/outbox correlation;
  generic delivery-list PASS remains collection only, not send proof.
- Successful owner acceptance/customer confirmation audits, converted lead and
  one/two priced continuation runs with reservations/limits. Ambiguity, NULL cost,
  unknown usage, extra run or an unrelated request cannot pass.

Execution reuses only the reviewed immutable diagnostic job/image at runtime
source `191a9cdbb4187ad0006a5dbab04882b4f44d0e64`, with runtime-role secret
reference, private VPC/subnet/egress and explicit zero retries. Read-only
transactions, transaction-local tenant context, runtime-not-owner/FORCE-RLS on
**12 queried tables**, timeouts, strict row caps, rollback and connection cleanup
remain mandatory. No content/customer identifiers/credentials/whole metadata
blobs are output. Actual ES-module/application-relative resolution is retained;
gzip and decoded-size limits bound the completion payload. Query failures carry
an exact sanitized stage/SQLSTATE. No migration entrypoint or job-template change.

Local verification (controlled fixtures, no live DB/network/paid calls):

- `node --test .github/scripts/s22-booking-evidence.test.mjs .github/scripts/s22-booking-first-turn.test.mjs .github/scripts/s22-booking-final-turn.test.mjs .github/scripts/s22-booking-completion.test.mjs .github/scripts/s22-booking-completion-launch.test.mjs`: **94/94 PASS**.
- Exact generated bootstrap executes real reader modules with controlled bare
  package/relative-module resolution, 14 assertions, rollback/closure, failed
  guards and expected exhaustion. Real Bash tests verify pinned download hashes,
  one invocation and tamper rejection before authentication/execution.
- Scoped ESLint zero warnings, Prettier and `git diff --check`: **PASS**.
  Independent source/SQL/safeguard review found no blocking discrepancy. No broad
  CI, production build or already-passed runtime check was repeated.

**Persisted completion remains PENDING.** Local gcloud/browser access is
unavailable; the prior GitHub logging-permission gap is not widened. One owner
Cloud Shell action runs checksum-pinned `s22-booking-completion-launch-v1.sh`:
download/verify three modules, launch one guarded read-only execution, collect
once through bounded Logging REST and print readable results. No uploads,
deployment, provider call, migration, IAM or secret changes. A failure preserves
the exact execution and sanitized JSON; recover its logs only, never blindly
rerun. Historical reservation **USD1.033396**, maximum combined exposure
**USD2.642467** and USD10 ceiling remain unchanged. The different friend's
unproven DM is outside this cohort. **S22 unaccepted; no S23 work.**

### Persisted booking proved; orchestration/dispatch diagnostic mismatch — 2026-10-07

Owner-supplied execution **`lead-agent-staging-migrator-8qlzd`**, using tooling
commit `5e1e6924c2187fe1473a1cc98538a622ef93c50c`, returned all seven booking
assertions **PASS**: request, transitions, direct customer evidence, offer delivery,
confirmation delivery, audits and converted lead. The current request is
**confirmed/4, offer1, Instagram direct confirmation**, with start/end
**2026-10-08T12:00:00Z–12:30:00Z** (17:00–17:30 Asia/Tashkent). Runtime/RLS,
historical NULL baseline, cohort binding and bounded metadata collection passed.
This is owner-supplied live persisted diagnostic evidence, not a new independent
browser observation. It closes this scoped booking persistence/confirmation/audit
gap; do not repeat the customer or staff actions, or the seven passed reads.

The overall diagnostic is accurately retained as **BLOCKED**, not retroactively
changed to PASS. `completion_provider_runs` failed, causing the derived
`cohort_reservation_accounting` assertion to fail. Collected rows:

| Orchestration record | Persisted facts | Evidence interpretation |
| --- | --- | --- |
| `01a11698-c4a3-7f88-a76d-1c4a7a4bd677` | Booking source `01a11698-bb8a-7b29-b3a9-2b3b5b9a3839`; correlation `01a11698-bb8a-7dd3-aa9b-f9a30ee634ba`; succeeded 13:41:19.177 UTC; approved Gemini 3.8 Flash; input1222/output424/cache0/total1646; cost2507 USD micros; one start and one dispatch reservation | Complete known paid booking run. |
| `01a1169a-49a5-79e9-94c6-03c3d91e248c` | Source `01a1169a-4501-73ce-9ef6-dc1c48451b3f`; correlation `01a1169a-4501-7457-9cea-db4e9db186d4`; failed 13:42:52.635 UTC; one start, zero dispatch reservations; model/usage/cost NULL | No automatic inference of a physical provider call, zero cost, exact preflight reason or actual customer-confirmation source. Terminal authorization/audit binding were not selected. |

The observed ledger is four logical messages/four physical reservations,
**8714 USD micros known cost**, **1042110 USD micros exposure**, unresolved0,
blocked=`message_limit`. Arithmetic is **6207 + 2507 = 8714** and
**1033396 + 8714 = 1042110**. Known paid cost is USD0.008714; exposure including
the unchanged historical budget-only reserve is USD1.042110. These are observed
metadata, not permission for another call or exact historical accounting.

**Confirmed diagnostic mechanism:** `ai-orchestration.ts` creates an `ai_runs`
row and `ai_run.journey_started` before preflight and dispatch authorization.
`orchestrate.ts` invokes the provider only after authorization; terminal audit
records explicit `dispatch_authorized`. These source files, the budget guard and
confirmation handler have no diff from deployed source `191a9cdbb4187ad0006a5dbab04882b4f44d0e64`.
Thus an orchestration record is not necessarily a paid call. The old diagnostic
wrongly required every scoped row to be a priced booking dispatch and named every
non-booking trigger `confirmation_calls`; neither assumption follows from the
actual implementation. No production defect or paid confirmation call is proven.

The narrowly scoped correction distinguishes reserved provider calls from
**audited non-dispatch orchestration records**, preserving original NULL values.
Non-dispatch requires one exact terminal audit with explicit authorization false,
matching status/attempt/correlation/time, no dispatch marker, output or provider
metadata. Missing/contradictory evidence remains failure, not assumed zero.
Actual confirmation association is compared with persisted confirmation evidence,
never inferred from `booking_trigger=false`. Historical costs stay unknown.

One remaining read is dispatch/accounting-only, using the existing reviewed
runtime image and read-only/RLS/private-network/zero-retry safeguards. It skips
the seven passed booking assertions; collects the missing finite failure/audit
fields and source binding; and reconciles priced dispatches against the current
ledger. No paid call, message replay, runtime deployment, migration, IAM change
or database write is required. **Exact second-record non-dispatch classification
and corrected aggregate PASS remain PENDING** on that read. S22 remains unaccepted.

Correction verification: `node --test .github/scripts/s22-booking-evidence.test.mjs .github/scripts/s22-booking-first-turn.test.mjs .github/scripts/s22-booking-final-turn.test.mjs .github/scripts/s22-booking-completion.test.mjs .github/scripts/s22-booking-completion-launch.test.mjs`
returned **100/100 PASS**. Scoped ESLint zero warnings, Prettier and diff checks
PASS. Regression fixtures reproduce the observed two-row failure and prove that
the second row passes only with explicit bound terminal non-authorization; paid
NULL-cost failures, absent/contradictory audits, extra runs, foreign source binding
and truncation still fail. The exact generated bootstrap proves accounting-only
issues one provider-metadata query, reports four assertions, rolls back both
transactions and closes the connection without seven prior booking reads.

One next owner action uses the checksum-pinned
`s22-booking-completion-launch-v2.sh` (replacing V1 for new tooling). It downloads
three verified files and runs only `--complete-booking-accounting`; no uploads or
runtime rebuild. Original V1 execution/checksum are preserved at commit `5e1e692`.
If exact audit proves `policy_denied`, that identifies the recorded failure but
does not uniquely distinguish budget denial from deterministic preflight. Report
**audited non-dispatch**, not an unproven denial source. No missing NULL cost is
rewritten or treated as zero. Keep paid calls blocked and S22 unaccepted.

## 2026-10-07 — owner-supplied dispatch/accounting completion PASS

Provenance: the owner supplied the sanitized completed output from
`lead-agent-staging-migrator-f5cpf`, using the checksum-pinned V2 accounting-only
launcher and repository tooling at `e67fc237dafb82c92e1a08761a7806238640b7c0`.
Download/preflight and result collection were PASS. This is owner-supplied live
diagnostic evidence, not a new local database read. The prior `8qlzd` overall
BLOCKED result is retained above; its seven passed booking checks were not
repeated. The sanitized Cloud Shell artifact directory was reported as
`/tmp/s22-booking-completion.UAJQyT`; it is not committed evidence or assumed
durable storage.

| Accounting-only assertion | Observed outcome |
| --- | --- |
| `runtime_rls_and_baseline` | PASS; reviewed runtime identity/read-only tenant/RLS safeguards and historical NULL baseline retained |
| `deployed_cohort_binding` | PASS; exact original synthetic organization/conversation and reviewed limits |
| `completion_provider_runs` | PASS; one priced dispatched booking call and one explicitly audited non-dispatch orchestration record |
| `cohort_reservation_accounting` | PASS; recorded cost reconciles to the cohort ledger, zero unresolved reserve, further dispatch blocked at the expected message limit |

The exact rows were classified independently:

- `01a11698-c4a3-7f88-a76d-1c4a7a4bd677`: paid provider call, recorded
  cost **USD0.002507**; actual confirmation-source association **false**.
- `01a1169a-49a5-79e9-94c6-03c3d91e248c`: audited stop before provider
  dispatch, terminal reason `policy_denied`; actual confirmation-source
  association **false**. The bound terminal audit/absence of dispatch marker
  proves non-dispatch, not a paid confirmation call. `policy_denied` alone does
  not uniquely identify the budget versus deterministic-preflight branch.
  Its original NULL model/usage/cost fields remain NULL, not rewritten to zero.

Known recorded total AI cost is **USD0.008714**, approved historical budget-only
reservation **USD1.033396**, combined exposure **USD1.042110**, pending reserve
**USD0.000000**. Paid messages/physical attempts remain **4/4**; further paid
dispatch is **BLOCKED (`message_limit`)**. This is scoped dispatch/reservation
proof, not recovered historical provider billing or exact historical accounting.
The historical NULL-cost gap remains visible; no ledger reset or new allowance
is implied.

Together with `8qlzd`'s persisted confirmed/4, offer1, actual customer evidence,
transitions, delivery, audits and converted-lead assertions, and owner-reported
offer/final acknowledgment receipt, the **original Instagram synthetic booking
milestone and its reservation/dispatch evidence are PASS**. No customer message,
provider call, migration, IAM/job configuration change or runtime deployment was
performed by this completion check. S22 as a whole remains unaccepted.

### Next prepared gate — non-paid Website Chat

Source inspection confirms the existing path: organization-bound staff workspace
→ **Integrations → Website Chat**. The authenticated read is
`GET /v1/staff/integrations/widget`, whose validated response reports
`status`, `publishable_key` and `website_origin`. The existing card can show
an active exact HTTPS origin, not connected, or a safe load failure. Read its
status/origin first; **Replace setup** invalidates the previous installation
key and is not needed to inspect it.

On a real approved controlled HTTPS host, the existing `/embed/widget.js` loader
opens **Chat with us**, obtains a one-time grant and posts into the sandboxed
`/widget/frame` before redeeming its session. This is not an invented GET frame
URL. Opening/closing the frame without **Send** does not initiate a model call;
non-paid proof can cover origin/CSP binding, session isolation and
third-party-cookie independence. A Widget message crosses the paid-risk boundary
and is not covered by the exhausted Instagram-only authorization.

Unknown: current live card configuration and a usable controlled external HTTPS
embed host. `https://clinic.example` is a placeholder, not a proven test origin.
Local authenticated browser access is unavailable. One necessary owner action
is to open the existing **Website Chat** card and report only its status and
configured business website origin, if present. Do not request installation
code, cookies, grants or secret values; do not replace setup or send a message.

## 2026-10-07 — Website Chat starting state and non-paid host preparation

Owner-supplied current Integrations screenshot: **Website Chat: Not connected**,
empty Business website input, disabled Set up, placeholder
`https://clinic.example`. Source confirms this is the supported unconfigured
state, not a hidden fetch failure. The screenshot also shows recorded one
lead/request/confirmed appointment, but does not independently reconcile those
analytics or their latency values.

Added the [synthetic embedding proof runbook](s22-widget-embedding-proof.md) and
a dependency-free temporary Cloud Shell host. It uses the normal owner/tenant/
CSRF setup and canonical public installation snippet; no bypass, credential
entry, same-origin iframe substitute or untrusted HTML execution. Live public
loader metadata confirms HTTP 200 and the existing Web gateway API origin.
The distinct HTTPS preview address must come from the actual owner's Cloud
Shell preview page. Nothing was configured through the live staff UI yet.

Verification: **12/12 focused host tests PASS** (real local HTTP plus controlled
exact generated browser-bootstrap execution), scoped ESLint zero warnings,
Prettier/diff checks and independent security review PASS. These are host-tooling
checks, not live Widget acceptance. The host makes no API requests itself;
installing the real loader is owner-triggered, and opening the genuine Widget
creates a session only. **Do not Send** remains essential because the host cannot
disable controls across the real isolated iframe. Temporary hosting stops after
one hour/Ctrl+C; its persisted allowed origin remains tracked until the existing
supported replacement flow rotates the key.

Next required owner action is to start the reviewed fixture in existing Cloud
Shell and open Web Preview on port 8080. No upload, provider call, model change,
migration, IAM change, image build or staging deployment is needed. Approved
origin/session/blocked-cookie/disallowed-origin live assertions remain pending;
Widget paid customer/booking proof requires separate bounded authorization.

## 2026-10-07 — Website Chat frame bootstrap failure and correction

Owner-supplied browser evidence now supersedes the earlier unconfigured snapshot:
the controlled HTTPS preview opened, initial owner/tenant/CSRF Website Chat setup
succeeded and reported Active for the exact distinct preview origin. The normal
public loader installed, but the real iframe displayed its generic unavailable
response. No Widget message or provider call was sent.

One bounded owner-supplied Cloud Logging read (`LOG_READ_EXIT=0`) reports the
canonical Web gateway `/v1/widget/embed-policy` **200** at
`2026-10-07T17:41:07.108243Z` (0.017547776s), and `/widget/frame` **400** at
`2026-10-07T17:41:06.872729Z` (0.256173704s). This proves policy success followed
by frame rejection, not redemption or a working customer session. The
[bounded investigation](s22-widget-embedding-proof.md#2026-10-07--live-frame-rejection-and-bounded-correction)
records observations, mechanism, rejected earlier-boundary explanations and
remaining unknowns.

The installed Next standalone adapter reproduces an internal request origin
`https://0.0.0.0:8080` behind the public TLS endpoint. The original frame compared
the valid signed policy's public iframe origin with that internal address and
returned 400. The correction instead requires independent trusted configured Web
`WIDGET_PLATFORM_ORIGIN` and exact policy matching. Terraform adds only that Web
environment entry from the existing canonical public Web origin. No arbitrary
Host/forwarded-header trust, CSP relaxation or new public boundary is introduced.

Related setup UX recovery is corrected: actual authorized-request 401 and missing
CSRF initiation branches show the existing organization-bound reauthentication
flow rather than leaving cached ready controls unusable. A 403 stays a permission
denial, no command is retried, and late initialization/analytics cannot restore
ready state. Auth0/MFA/membership/backend session policy is unchanged. Specific
backend cookie-rotation causation remains unproven and is not patched.

Focused verification:

- `node node_modules/vitest/vitest.mjs run apps/web/src/lib/widget-frame.test.ts`:
  **26/26 PASS**. Actual installed-framework route reproduction was **FAIL** before
  correction (expected 200, observed 400) and **PASS** after it (200). Covers
  signed-policy origin matching, spoofed/foreign origins, malformed inputs/config,
  upstream status/body/fetch errors, fetch/body timeouts, no retries/redemption,
  nonce CSP and finite sanitized correlated telemetry.
- Final `node node_modules/vitest/vitest.mjs run apps/web/src/lib/staff-request.test.ts apps/web/src/lib/staff-workflow.test.ts`:
  **34/34 PASS** (15 request/recovery tests and 19 existing workflow tests).
  The unchanged `product-ux.test.ts`'s **16/16 PASS** from the earlier scoped run is
  reused: **50 distinct staff tests PASS**. Organization/CSRF/options/cancellation
  and no automatic retries preserved. The authentication latch is an explicit
  per-workspace controller; no React ref is accessed by a render-time factory.
- Native headless Edge against the local production Web build with synthetic
  authorized API responses: **three real-DOM cases PASS** — ready-to-401 recovery,
  missing-CSRF setup recovery with no POST, and 403 retaining the workspace. All
  cases made zero mutations and zero nonlocal requests; no login/provider flow was
  performed. The initial sandbox could not expose its debugging endpoint; the
  bounded isolated-profile check succeeded outside the sandbox. Browser-profile
  cleanup initially hit EPERM, then validated cleanup of only the fresh temporary
  profile succeeded and verified its absence. This is not live Cloud Run proof.
  The exact final controller bundle passed all three cases after a bounded
  localhost warm read (HTTP 200, 0.502839s) and a 30s local CDP deadline. Its
  first cold navigation had hit the harness's 10s deadline before assertions;
  only that tooling deadline changed, not application/production safeguards.
- Web `node node_modules/typescript/bin/tsc -p apps/web/tsconfig.json --noEmit`:
  PASS; production `node node_modules/next/dist/bin/next build` from `apps/web`:
  PASS. The final rebuild followed the request/controller integration correction.
- Scoped ESLint with `--max-warnings=0` for both new helpers/tests, the frame route
  and workspace component: PASS. No lint rule/compiler error suppression. Scoped
  Prettier/diff checks and `terraform fmt -check infra/deploy/gcp/staging/runtime.tf`:
  PASS. Unrelated README/Instagram edits and the untracked notices patch remain
  outside this milestone.

New policy request failures carry finite safe stage/status/request-ID metadata;
no grant, key, secret, origin, provider payload or message body enters telemetry.
No migration, IAM, SQL, scaling, provider setup, fixture rotation or paid-budget
change is part of this milestone. Historical NULL costs remain untouched and the
exhausted cohort still blocks paid dispatch. A fresh immutable build and exact
reviewed saved plan must precede apply. Live frame/session open/close/reopen,
blocked-third-party-cookie behavior and disallowed-origin denial remain pending;
S22 remains unaccepted.

## 2026-10-08 — approved Widget origin rollout

The owner approved only saved plan
**[37669343531](https://github.com/mufazzalshokh/lead-agent-platform/actions/runs/37669343531)**,
SHA256 **`8a61030064cb13168acfafbb1002db866a8d1686fe7898e565cc97e353e1def1`**.
The source is `65b6c906f3a3433a1093abcf1aada4b0f2f00423` on
`verify/s22-staging-recovery-capacity`; reviewed deployment timestamp
`2026-10-07T18:45:42Z` and migration head
`0031_s22_widget_inbound_route_management` were preserved exactly. This date
heading uses Asia/Tashkent; provenance timestamps remain canonical UTC.

Existing immutable build
**[37668568053](https://github.com/mufazzalshokh/lead-agent-platform/actions/runs/37668568053)**
contains all four images from that exact source. Independent saved-plan SHA256
and locked-provider field-level review passed: **0 creates / 4 in-place updates /
0 destroys / 0 replacements**. Only four image/provenance bindings and one new
Web `WIDGET_PLATFORM_ORIGIN` changed. Network, identities, secret references,
commands, scaling, migration head, model and cohort controls matched the refreshed
before-state. The temporary local reviewer passed **23/23** controlled rejection
cases; no computed-unknown difference was excluded. These are plan/local checks,
not browser proof.

Apply
**[37672530149](https://github.com/mufazzalshokh/lead-agent-platform/actions/runs/37672530149) PASS**:
reviewed-plan integrity and exact approval boundary passed, then Terraform
reported **0 added / 4 changed / 0 destroyed**. No replacement plan, image rebuild,
migrator execution, migration, IAM, network, scaling, secret or paid-budget change
occurred. The original prepared-input precheck stopped before dispatch because
the escalated PowerShell JSON reader converted the RFC3339 string to `DateTime`;
ordinary Node JSON parsing preserved the exact approved timestamp. Only one
actual apply workflow was dispatched; no application or workflow change was
needed for that local tooling issue.

Read-only verification
**[37672800406](https://github.com/mufazzalshokh/lead-agent-platform/actions/runs/37672800406) PASS**:
artifact `s22-api-image-live-evidence-37672800406` reports **PASS / 0 failures**.
Direct API metadata matches source/timestamp/head, reviewed immutable image,
runtime identity, private VPC/subnet/egress, 15 secret references and readiness.
Direct Web image/readiness also matches. Ready revisions are
`lead-agent-staging-api-00023-w68` and `lead-agent-staging-web-00019-hjs`.
Whole-runtime refreshed Terraform convergence is **exit 0**; this covers the
configured Worker/Migrator bindings and the new canonical Web origin setting,
not a separate direct REST assertion of those descriptors or that environment
entry. The verifier's apply and one-shot migrator steps were **SKIPPED**.

Bounded unauthenticated public reads after apply passed: API `/health` **HTTP
200**, service `api`, status `ok`; the exact organization-bound Web `/staff`
**HTTP 200**, HTML; `/embed/widget.js` **HTTP 200**, 5,039 bytes, SHA256
`abda0e39938bcd9ab55b938fbc53e712e120b662beea18448d324e9d234d1fd9`, canonical
Web gateway `API_ORIGIN` matched. These used no cookies, grant or message and
do not establish authenticated owner access or a ready Widget frame. Initial
sandbox transport failures were local access restrictions; permitted bounded
reads succeeded without changing the application.

The existing local application tests, actual Next adapter before/after regression
and production build evidence were reused; no unchanged test suite or CI was
repeated. Historical NULL costs remain unknown and unchanged. The exhausted
synthetic cohort is not reset and no paid test is authorized by this rollout.

Remaining: real approved-origin Widget frame/session open/close/reopen,
third-party-cookie-independent behavior and disallowed-origin rejection. The
earlier temporary host has a one-hour lifetime; restarting the unchanged,
checksum-verified host does not require uploads, infrastructure changes or setup
replacement when its actual preview origin is unchanged. Do not invent a preview
URL, rotate the installation key unnecessarily, or press **Send**. S22 remains
unaccepted; no S23 work.

## 2026-10-08 — Widget launcher lifecycle correction checkpoint

Owner-supplied live browser evidence after source
`65b6c906f3a3433a1093abcf1aada4b0f2f00423` / apply **37672530149** shows the
genuine synthetic-host frame greeting/composer, and the owner confirms it closes
and reopens without Send. The closed launcher incorrectly retains `Opening…`.
Record open/close/reopen as owner-observed, not an independently collected
redemption trace, cookie-independence or origin-denial proof. No paid dispatch.

Confirmed mechanism: generated `READY` clears the busy latch/enables the button
but never restores its label; `CLOSE` and cached reopen leave that stale label
unchanged. An exact generated-loader + generated-frame controlled VM reproduction
observed scripted READY followed by the same enabled `Opening…` symptom before
correction. Thus the label is not evidence of a failed readiness handshake. The
same implementation also left pre-READY EXPIRED busy, and kept partially created
frame/form state after submission failure; these related paths are covered.

Smallest runtime change is restricted to `apps/web/src/lib/widget-embed.ts`:
restore captured configured/default label on validated READY; allow cached-frame
reopen after CLOSE while retaining the grant busy latch; discard expired/failed
frames/reset busy; remove the short-lived grant-transfer form in `finally`.
No frame/API/public contract, provider, auth, tenant, CSP, sandbox, budget,
network, IAM or migration change. Retry is manual only. Independent review of
unchanged exact source/origin/version/instance/payload and stale-frame rejection
passed. No missing-readiness timeout or unrelated redesign is introduced.

Focused local evidence:

- Exact generated loader/frame VM reproduction: **12/12 PASS** after correction;
  before correction the label restore and pre-READY-expiry manual retry failed.
- `node node_modules/vitest/vitest.mjs run apps/web/src/lib/widget-embed.test.ts`:
  **17/17 PASS**. Actual generated scripts execute against synthetic responses;
  default/custom labels, cached same-session reopen, duplicate mount/click/READY,
  foreign/malformed/retired-frame messages, grant/redeem/submission failures,
  cleanup and close-before-READY are exercised. This is not a live API/DB proof.
- Scoped existing `product-ux.test.ts` **16/16 PASS** and `widget-frame.test.ts`
  **26/26 PASS**. No broad CI, provider or completed staff journey repeated.
- Web `node node_modules/typescript/bin/tsc -p apps/web/tsconfig.json --noEmit`:
  PASS; production `node node_modules/next/dist/bin/next build` from `apps/web`:
  PASS. Initial test-helper strict-TypeScript/lint findings were corrected before
  the final checks; no suppression. Runtime bundle and production typecheck pass.
- Scoped ESLint zero warnings, Prettier and in-scope diff checks: PASS. Existing
  unrelated README/Instagram edits and the untracked notices patch are preserved;
  their formatting is not changed or represented as passing this scoped check.

Final combined focused test command on committed runtime source:
`node node_modules/vitest/vitest.mjs run apps/web/src/lib/widget-embed.test.ts apps/web/src/lib/product-ux.test.ts apps/web/src/lib/widget-frame.test.ts`:
**59/59 PASS**, three files. This is local controlled proof, not live staging.

An additional isolated native Edge check with synthetic responses reached real
READY/sandbox/cross-origin DOM/form-cleanup assertions, but stopped at a DevTools
frame-process assumption. A bounded harness fallback timed out before close/reopen.
No completed native before/after verdict or live session proof is claimed. Both
fresh profiles were removed; no live API, message/model dispatch or owner profile.
The deterministic generated-runtime tests above are the completed local proof.

Fresh images and one reviewed full-runtime saved plan are required before apply;
the previous owner approval does not cover this new correction. Further paid
dispatch remains blocked; historical NULL costs and the approved reserve remain
untouched. Live corrected-label/session-security assertions remain pending;
S22 remains unaccepted. See [Widget proof](s22-widget-embedding-proof.md).

Immutable build **37680689682** and the single fresh full-runtime plan
**37681742450** now PASS for source
`6a31cd8e3a37f31a7bb85329eab0aa9c4de53926`, timestamp
`2026-10-07T20:22:40Z`, unchanged head
`0031_s22_widget_inbound_route_management`. Independently verified saved-plan
SHA256: `a228a8c3ce86c59c886e9c6884226d7969a8c51e03200b5c5c294d0abd9da485`.
Only **0 creates / 4 in-place updates / 0 destroys / 0 replacements**, images/
git labels/deployment provenance. Locked-provider field review checks all 84
unchanged managed resources, with zero configuration or computed-unknown
differences; canonical Widget origin, secrets, network, IAM, SQL, scaling,
commands, migration head and model/budget controls remain unchanged. All four
predecessors match the already-verified `65b6c9` runtime/time/head. Reviewer
controls **32/32 PASS**; workflow safety PASS, apply/migrator steps SKIPPED.
No later apply appears in workflow records at review; a new independent remote
state-serial read is not claimed. Built-in saved-plan stale-state rejection remains
required. Full immutable references and prepared token-free apply inputs are in
the [exact approval packet](s22-widget-embedding-proof.md#launcher-correction--exact-saved-plan-approval-packet).
**STOP before apply**: preceding approval does not cover this plan. Later evidence
documentation must not trigger duplicate runtime builds/plans. No new paid-call
authorization; S22 remains unaccepted.

## 2026-10-08 — exact approved launcher apply and deployed verification

Owner authorization: **Apply plan 37681742450 only**. Approved source
`6a31cd8e3a37f31a7bb85329eab0aa9c4de53926`, build **37680689682**, plan SHA256
`a228a8c3ce86c59c886e9c6884226d7969a8c51e03200b5c5c294d0abd9da485`, exact
declared timestamp `2026-10-07T20:22:40Z`, unchanged migration provenance
`0031_s22_widget_inbound_route_management`. Local binary/sidecar and prepared
inputs were checked; independent 52 read-only comparisons passed. Source remains
on `verify/s22-staging-recovery-capacity`; dispatch HEAD `1f45516` is an
evidence-only descendant, not a new runtime source or reason to rebuild.

[Apply **37735083627**](https://github.com/mufazzalshokh/lead-agent-platform/actions/runs/37735083627)
**PASS**: saved-plan integrity and exact approval boundary passed; actual Terraform
counts **0 added / 4 changed / 0 destroyed**, no replacements. Exactly the
reviewed artifact was applied once. No image rebuild, replacement plan,
unrelated configuration/IAM/network/SQL/scaling/budget change or migration execution.
Migrator/DB-validation steps were **SKIPPED**. The declared timestamp was preserved
exactly, not changed to the later approval/execution date.

[Read-only verifier **37735337876**](https://github.com/mufazzalshokh/lead-agent-platform/actions/runs/37735337876)
**PASS**, downloaded artifact `s22-api-image-live-evidence-37735337876` reports
**16 assertions PASS / 0 failures**. Direct API image/source/time/head,
identity/private network/egress, secret-reference count (15) and readiness pass;
direct Web image/readiness pass. Ready revisions:
`lead-agent-staging-api-00024-hx6`, `lead-agent-staging-web-00020-hz9`.
Whole-runtime refreshed convergence **exit 0** covers configured Worker/Migrator
and canonical Web origin, not separate direct REST assertions for their
descriptors. Head is configured provenance, not a repeated DB-journal read.
Verifier apply/migrator/DB-validation and replacement-plan creation were SKIPPED.

Bounded public probes before `2026-10-08T06:02:02Z`: API health **HTTP 200**,
expected `api/ok`; organization-bound staff HTML **HTTP 200**; Widget loader
**HTTP 200**, **5,286 bytes**, exact match to the generated committed `6a31cd8`
source. Expected/live SHA256
`9174e16a48d3bb1620d20e8854a774f78daac22d5d917b8ea7744cc2f7eaea0a`.
Credential/cookie-free GETs, redirects prohibited, each fetch/body bounded to
15 seconds/100 KB; no grant, conversation, message or paid provider call. Local
restricted transport required permitted network access; final read exited 0.
No existing test suite, OAuth, Claim/Resolve, inventory or migration was repeated.

Existing owner-page JS can remain old until a fresh page/remount; public script
cache is 300 seconds. Reloading the temporary host clears the non-persisted public
snippet installation, so remount it before verifying the label. First establish
host availability if its one-hour window elapsed; do not rotate setup/key or ask
for a DM. Live corrected close/reopen label, redemption, cookie-independence,
origin rejection and the remaining Widget/channel/recovery/capacity/release gates
remain pending. Historical NULL costs remain visible, no cohort reset/new paid
authorization, S22 unaccepted. See the
[rollout proof](s22-widget-embedding-proof.md#2026-10-08--exact-approved-launcher-rollout-verified).

## 2026-10-08 — owner confirms corrected Widget launcher

**Owner-observed live launcher UX PASS**, following the approved `6a31cd8` rollout
and preserved verifier **37735337876** / corrected-loader byte match. No new
revision read is claimed. After a temporary preview-root 404, the owner confirmed
page availability after the existing checksum-pinned host startup instruction.
Expiry is plausible from the one-hour lifetime, not a proven cause; the fixture
accepts `/?authuser=0`.

The owner remounted the public snippet, supplied a screenshot of the genuine
empty frame on the same preview origin, and explicitly confirmed the chat reopens
and the closed button reads exactly **Chat with us**. This closes the stale
`Opening…` label gap. Exact UTC test time, session ID and redemption/server trace
were not collected. No Send was reported and no new provider ledger read was
performed; no accounting or paid-call-count claim is added.

Blocked-third-party-cookie fresh-session behavior, disallowed-origin denial,
host/frame/token isolation and actual Widget customer/booking E2E remain pending,
alongside the other preserved S22 gates. Next non-paid preparation: inspect the
existing browser cookie setting without deleting cookies or blindly changing
global settings. Only these two Markdown documents receive scoped format/diff
checks; no runtime tests, broad CI, deployment, migration, setup/key replacement
or paid call is repeated or authorized. Historical NULL costs remain visible;
S22 remains unaccepted. See the [detailed owner proof](s22-widget-embedding-proof.md#2026-10-08--owner-verifies-corrected-live-launcher).

## 2026-10-08 — Widget cookie-block setting checkpoint

Owner-supplied live result: after confirming the standard Chrome **Block
third-party cookies** selection, the owner reported success following the fresh
refresh/remount/new-frame instructions. Freshness was not independently traced;
cached reopen alone would not establish this check. The proposed DevTools control
was unavailable in this observed UI; no universal browser-removal claim is made.

Asked only whether an exception covers `cloudshell.dev` or `run.app` (including
wildcards), the owner answered **no** and reiterated that **Block** was selected.
**Owner-reported fresh bootstrap under cookie blocking without a covering
exception: PASS**, not an independent cookie/request trace. The initial reply did
not confirm restoring the original **Allow** setting; restoration was requested
again without deleting cookies. The owner subsequently replied **restored**:
owner-reported cleanup **PASS**, not an independent setting read. No Send was
reported; no new accounting, direct session trace or paid-call-count proof is claimed.
Scoped documentation format/diff checks only; no runtime change, deployment,
migration or repeated CI. Historical NULL costs and exhausted paid-dispatch
controls stay unchanged. S22 remains unaccepted. See the
[detailed cookie checkpoint](s22-widget-embedding-proof.md#2026-10-08--fresh-opening-with-cookie-block-setting-selected).

## 2026-10-08 — Widget host document denial

Following instructions to keep the genuine chat open on the distinct-origin
synthetic host and use DevTools Console's **top** context, the owner reported
**true** for:

```js
document.querySelector('iframe[name^="lead_agent_widget_"]').contentDocument === null
```

**Owner-reported scoped host DOM denial: PASS**. The matched frame's document
was not readable through that property in the reported context. Context,
frame identity/origin and exact UTC time were not independently captured.
No document contents, cookies, tokens or message bodies were requested. This
does not prove token storage/access, grant redemption, postMessage validation
or disallowed-origin rejection. No message, model call or new accounting read.

Next separate check: one valid-public-key, disallowed-HTTPS-Origin request.
Actual deployed source denies before session INSERT and maps the rejection
to **404 / resource_not_found**; a bad key, OPTIONS result or malformed-Origin
403 cannot substitute for allowlist proof. No such probe has been executed.
Unexpected success could create one unbound session, so no redemption/retry/Send
is permitted. See [detailed scope and provenance](s22-widget-embedding-proof.md#2026-10-08--host-document-access-denial).

Only scoped evidence documentation/format/diff checks; no runtime change,
deployment, migration, repeated CI or new paid authorization. Historical NULL
costs stay visible, and S22 remains unaccepted.

## 2026-10-08 — Widget live actual-request origin denial

**Agent-executed live actual-request denial: PASS**, paired with the preserved
owner-reported approved-origin success and newly supplied public installation
snippet. No public key is saved in this evidence. Exactly one credential/cookie-
free POST to the canonical gateway `/v1/widget/embed-grants` used normalized
Origin/page URL `https://s22-origin-denial.invalid`, locale `uz`, no tenant input.
Start/end: `2026-10-08T07:13:24.883Z` / `2026-10-08T07:13:26.024Z`.

Observed **404 / resource_not_found**, exact Problem endpoint instance,
**`request:req-c`**, no `Access-Control-Allow-Origin`, `Cache-Control: no-store`.
Redirects prohibited, fetch/body bounded to 15 seconds/8 KB, no retry/redemption,
session opening, message or paid provider call. This is an actual grant-route
request, not OPTIONS or malformed-Origin rejection, and not intrinsically a
read-only operation. The deployed source denies before session INSERT; no
independent DB zero-insert proof is claimed. The non-enumerating 404 is paired
with owner working-key evidence, not independent current routing/allowlist reads.

This closes only server-side Origin-header denial, not a second real browser
host's E2E, bearer storage/isolation or direct session trace. Widget customer E2E
still needs separately bounded paid authorization; the Instagram allowance is
exhausted and cannot be reused. No runtime change/deployment/repeated CI,
migration, budget reset or historical NULL-cost reconciliation. Scoped evidence
format/diff checks only; S22 remains unaccepted. See
[detailed request provenance](s22-widget-embedding-proof.md#2026-10-08--live-actual-request-origin-denial).

Next M2 boundary is the first meaningful Widget message and complete customer
journey, not another opening/cookie/DOM check. Read-only source inspection
confirms the current internal cohort pins the original Instagram conversation
and denies other conversations before provider dispatch. A separate bounded
Widget cohort/budget and any exact runtime-plan approval must be prepared before
Send; changing mode alone is insufficient. The old ledger/reserve/NULL costs
cannot be reset or transferred silently. No additional paid test is authorized.

## 2026-10-08 — bounded Website Chat guard preparation

The next owner reply approved **preparing this bounded Website Chat test**.
Authority remains preparation: no apply, message/provider execution, replay,
migration or IAM change. The existing Instagram booking proof and two historical
NULL-cost records are preserved. See the [limits and prepared customer/staff
sequence](s22-synthetic-booking-journey.md#current-preparation--separate-website-chat-journey-2026-10-08).

The concrete missing control was the old gate's intentional pin to the original
Instagram conversation. Setting a mode alone could not authorize a Widget
session, and globally authorizing website visitors would violate the bounded
scope. The new staging-only lane uses an exact trusted WidgetSession UUID and
derives its tenant/contact/conversation from persisted ownership. A common
original-conversation lock serializes reservations across Worker instances;
the immutable one-off session/conversation latch and first paid reservation
commit atomically before dispatch. It freezes the original four paid messages,
four attempts and 8,714 micros known cost, retaining the historical planning
reserve. No switching/restarting can reset the selected lane after its latch.

Two logical messages, four physical attempts and two attempts/message are
enforced. Pending or unknown cost retains the full 801,432-micros slot and
blocks continuation. New allowance is 3,205,728 micros; maximum combined
exposure 4,247,838 micros, below the unchanged USD5 target/USD10 hard ceiling.
Strict version/state/model/usage/pricing/lifetime checks remain. Independent
review identified an active-contact race between context load and dispatch;
the selected-conversation query now rechecks active contact before reservation.
Historical costs must remain NULL; mutation to zero is explicitly rejected.

Local verification completed without production DB or paid provider access:

- `node node_modules/vitest/vitest.mjs run tests/ai/s22-budget-ledger.test.ts tests/ai/s22-journey-dispatch.test.ts`: **56/56 PASS**. Modeled PostgreSQL transport, not real locking/RLS evidence. Includes concurrency, atomic commit failure, cross-tenant/session/contact/origin denial, revocation/expiry, downgrade/session-reset denial, inclusive fourth-slot cap, message/attempt caps, unknown/timeout retention and immutable historical NULLs.
- `node node_modules/vitest/vitest.mjs run tests/ai/sales-flow.test.ts`: **89/89 PASS** in the focused combined run. Unchanged deterministic policy/booking failure protections; no real generation or channel delivery claim.
- `node --test .github/scripts/s22-widget-session-select.test.mjs`: **20/20 PASS**, including exact generated ES-module bootstrap, bare application-package and relative runtime-module resolution, runtime/read-only/tenant guard, forced rollback and cleanup, bounded/sanitized collection, and missing Logging access denial **before** execution.
- Root `tsc -p tsconfig.json --noEmit`, database TypeScript and Worker TypeScript: **PASS**. `node scripts/check-boundaries.mjs`: **PASS**, 318 source files. Scoped ESLint/Prettier/diff checks: **PASS**.

Three additional isolated PostgreSQL cases exercise real runtime-role concurrent
gates and immutable binding, retained timeout reserve/process restart, inactive
contact/origin, session expiry and foreign tenant. Local Docker engine is
unavailable; the existing scoped `s22-booking-budget.yml` runs all six cases
on disposable PostgreSQL 17 after push, without staging credentials or Gemini.
Their result is **pending** here, not replaced by mocked PASS.

First isolated run **37747745619** at preparation source
`fe07763cc0c5c7a0f3366014af99611e54af0d9f`: **5/6 PASS**, timeout-case fixture
**FAIL** (`Missing Widget fixture run`). The fixture attempted to reserve the
same message after terminal timeout with `allowRepair=false`; the existing
persistence correctly rejects that reservation. Correction explicitly asserts
that rejection, then creates a fresh isolated subsequent inbound and verifies
the restarted dispatch guard blocks it while retaining the unknown-cost slot.
No runtime behavior was weakened or provider call made. Corrected real-DB result
remains pending until the next source's focused run completes.

Corrected fixture source `2b3072255b0bf3d6da9b56e6f287679257c674cc`:
isolated PostgreSQL run **37748266062 PASS, 6/6**; automatic CI run
**37748272851 PASS**. Image build **37748463181 PASS** was subsequently
superseded during final scope review and must not be used for the rollout plan.
The paid-logical-message counter alone could permit a third customer message
when the second inbound was a confirmation requiring no provider call. No plan,
apply or paid execution used that source's images.

The correction reads only the first three tenant/conversation-scoped inbound
message IDs (one bounded sentinel beyond the approved two), authorizes only the
first two, and denies paid dispatch once a third exists. The selected session
lock serializes this check with normal Widget intake. Snapshot
`widget.customerMessages` now distinguishes all customer inbounds from the
existing paid `logicalMessages` count. The new modeled and isolated PostgreSQL
regressions cover a free second confirmation followed by a denied third inbound;
their updated-source validation is recorded below when completed.

Updated local scope verification: `node node_modules/vitest/vitest.mjs run
tests/ai/s22-budget-ledger.test.ts tests/ai/s22-journey-dispatch.test.ts`:
**60/60 PASS** (48 ledger, 12 dispatch). Root TypeScript and scoped lint/format/
diff checks: **PASS**. The added isolated PostgreSQL case makes **seven** cases
in the scoped workflow; its new-source result remains pending until execution.
No customer message, live diagnostic, provider call or apply was performed.

Deployment preparation validation: mode/workflow **18/18 PASS**, existing
infrastructure checks **10/10 PASS**, strict configuration helper **7/7 PASS**;
Terraform validation/format and Bash syntax **PASS**. The new helper rejects
configurable unknowns and unrelated resource/environment/secret/network/scaling
changes. A genuine replay using the locked Google 7.46.1 provider schema and
the previous saved reconciliation plan verified **88 managed resources / exactly
4 workload updates**. Only the newly introduced empty legacy session variable
was supplied in memory for this compatibility test; the saved plan was unchanged.
This is local guard compatibility evidence, not a new approved plan or apply.

The fresh build and session-bound deployment plan are also pending at this
checkpoint. Exact live session selection requires one fresh real-frame opening
without Send and a bounded runtime-role read; no customer credential is exposed.
The saved plan must contain only four in-place workload image/provenance updates
plus the explicitly reviewed Worker mode/session binding, no SQL/IAM/network/
scaling changes, creates/destroys/replacements or migration execution. Exact
saved-plan approval remains required. S22 remains unaccepted.

### Final verified preparation source and immutable build

Runtime source **`a2b2f708d2e804d2c3d2be66426fa7b49d8203c9`**, preserved on
`verify/s22-staging-recovery-capacity`:

- Focused isolated PostgreSQL **37750085917 PASS, 7/7**. Exact command:
  `pnpm exec vitest run tests/database/s4a-schema.test.ts --testNamePattern "S22 durable synthetic booking budget" --maxWorkers=1`.
- Automatic authoritative CI **37750093321 PASS** (`pnpm ci:verify`), including
  database regressions, type/lint/contracts/boundaries and production builds.
  It was followed, not manually dispatched or repeated.
- Final immutable image build **37750247345 PASS**, exact source above,
  `image_scope=all`, `linux/amd64`. Authenticated artifact download and an
  independent strict manifest parse verified build/source and all four role/
  digest references. Manifest SHA256:
  `0abf845efa17aadcfaaedc2c8407e5079aad944afdcdaf01d8ccd060e73059af`.

| Runtime role | Verified immutable image |
| --- | --- |
| API | `me-central1-docker.pkg.dev/lead-agent-stg-739284/lead-agent/api@sha256:dcf22aa7db8c93ed813c84be96f7216d6b1f9f51081a5ad19fa7a6456985d5bd` |
| Web | `me-central1-docker.pkg.dev/lead-agent-stg-739284/lead-agent/web@sha256:167e9cf10b6d8ce6a6965565a254c54580deb65a29bf66532589719ef69ee267` |
| Worker | `me-central1-docker.pkg.dev/lead-agent-stg-739284/lead-agent/worker@sha256:c2c31c5643938aaae945ff0906f99522f6573fc562cd0568be7594049409580b` |
| Migrator | `me-central1-docker.pkg.dev/lead-agent-stg-739284/lead-agent/migrator@sha256:2aa2c94ef59b8becda3db9e731a2cd5e65b535a40b539b896b97486d67c80276` |

No migration files changed relative to the last verified live source
`6a31cd8e3a37f31a7bb85329eab0aa9c4de53926`; migration provenance remains
`0031_s22_widget_inbound_route_management`. No runtime apply, live diagnostic,
message, provider call, IAM/job-configuration or unrelated record change was
made during preparation. The prior successful build **37748463181** is not the
final runtime source and must not supply this plan's images.

**Remaining preparation blocker:** the exact live fresh unbound Widget session
has not been read. Local authenticated Cloud Shell/browser access is unavailable;
no session UUID is guessed or automatically substituted. The bounded repository
selector requires exactly one recently issued unbound version-2 session on the
approved origin, runtime/read-only/tenant/FORCE-RLS guards and reviewed immutable
diagnostic job configuration. It makes no model calls or migration execution.
Its 20 deterministic tests include the exact ES-module/package-resolution
bootstrap; these are local tooling tests, not live session-selection evidence.

The next owner action is one fresh real-frame opening without Send, followed
immediately by the checksum-pinned selector in a second Cloud Shell tab. Keep
the same preview/frame intact afterward. The printed absolute expiry is not the
**30-minute idle deadline**: selection, plan, exact approval, apply, verification
and first permitted message must fit that lifetime. Expiry blocks the process;
it never authorizes replacement of the reviewed session. Version 2 is correlated
with this owner opening, not represented as an independent redemption trace.

Once selected, the single supported plan uses `action=plan`, `phase=full`, the
exact runtime source/images above, `ai_journey_mode=widget_booking`, the exact
selected `ai_journey_widget_session_id`, unchanged migration head and one UTC
RFC3339 deployment timestamp. No plan run, saved-plan hash or timestamp has been
generated before this missing binding is supplied. Review must prove zero
creates/destroys/replacements, four intended in-place workloads only, with no
SQL/IAM/network/scaling or migration execution. Subsequent documentation-only
commits do not justify rebuilding this unchanged runtime source. Apply and
paid execution remain separately unauthorized; S22 is unaccepted.

The customer-message counter is bounded at three (three means **at least**
three). The gate prevents additional paid dispatch; it does not globally reject
Widget HTTP intake or replace the existing deterministic confirmation handler.
The owner test remains exactly two total sends. The PostgreSQL case proves
persisted counting/dispatch denial, not a live customer-confirmation transition
or a new intake-versus-dispatch race experiment.

Exact in-scope preparation files (relative to `a0cb1bb`):

```text
.github/scripts/s22-ai-journey-mode.mjs
.github/scripts/s22-full-runtime-config-check.mjs
.github/scripts/s22-full-runtime-config-check.test.mjs
.github/scripts/s22-full-runtime-plan-check.sh
.github/scripts/s22-widget-session-select-readonly.mjs
.github/scripts/s22-widget-session-select.mjs
.github/scripts/s22-widget-session-select.test.mjs
.github/workflows/s22-booking-budget.yml
.github/workflows/staging-terraform.yml
docs/architecture/s22-acceptance-evidence.md
docs/architecture/s22-synthetic-booking-journey.md
docs/architecture/s22-widget-embedding-proof.md
infra/deploy/gcp/staging/runtime.tf
infra/deploy/gcp/staging/variables.tf
packages/config/src/ai-journey.ts
packages/config/src/index.ts
packages/database/src/repositories/ai-journey-budget.ts
tests/ai/s22-budget-ledger.test.ts
tests/ai/s22-journey-dispatch.test.ts
tests/database/ai-orchestration.test-suite.ts
tests/workspace/staging-journey-mode.test.ts
```

Unrelated `README.md`, `docs/architecture/s11-instagram-business.md` and
`s22-public-notices.patch` remain untouched and excluded from every preparation
commit. This final evidence-only update does not require another image build.

### Session-selector failure investigation: `xtcgs`

Owner-supplied live tooling result: both checksum-pinned files reported **OK**;
read-only execution **`lead-agent-staging-migrator-xtcgs`** was created and
collection returned **BLOCKED: `DATABASE_OR_TOOLING_UNAVAILABLE`**. The execution
is preserved and was not rerun. This is not evidence of Widget product failure,
a failed AI call, successful session selection or a cohort-binding change. No
plan, apply, Send or paid dispatch is authorized by this result.

Observations: the reader catches unexpected errors into a generic code; the
launcher originally drops the assertion/stage when displaying that code. Source
inspection identified a concrete diagnostic SQL defect: the FORCE-RLS catalog
query uses `$2::text[]` while its tenant helper binds `[organization, tableNames]`,
leaving `$1` unreferenced/untyped. The pinned deployed tenant query helper forwards
all parameters to installed `pg`; no adapter fills in this missing type. The
previous successful booking reader explicitly types `$1::uuid`. The mocked
selector bootstrap returned a catalog result without executing PostgreSQL SQL,
so its earlier PASS did not cover server parsing.

The mechanism is corroborated by [PostgreSQL 17's parameter-type validation](https://github.com/postgres/postgres/blob/REL_17_STABLE/src/backend/tcop/postgres.c#L687):
every supplied parameter must resolve a type, including an unused earlier slot.
This source explanation is not substituted for the pending actual wire test or
persisted `xtcgs` failure-stage attribution.

Ranked hypotheses and distinguishing evidence:

| Hypothesis | Prediction / distinguishing check | Current disposition |
| --- | --- | --- |
| Untyped first SQL parameter in FORCE-RLS query | Runtime guard passes, then `force_rls_not_owner_guard` blocks; original statement produces PostgreSQL `42P18`, corrected actual statement executes | Source/transport mechanism identified; isolated PostgreSQL regression and exact persisted stage pending |
| Package/config/database initialization failure | Failure assertion is `initialize`, with no completed runtime guard | Not excluded by the owner's abbreviated output; existing execution-stage read requested |
| Missing/expired/ambiguous session or inactive origin | Reader reaches selection and emits its explicit selection failure code | Does not explain the reported generic code; no session is guessed or replaced |

One bounded read of **existing** `xtcgs` structured assertion/outcome/code metadata
was requested to attribute its exact failed boundary. It creates no execution
and prints no raw errors, environment, credentials or customer content. Local
`gcloud` is unavailable; authenticated GitHub access remains available for
isolated regression checks. The smallest correction being verified is explicit
typing of the tenant parameter plus finite sanitized stage/SQLSTATE telemetry,
not removal of tenant/read-only/RLS/identity/VPC/lifetime safeguards. No runtime
image rebuild or replacement deployment plan is required for diagnostic-only
changes; the verified `a2b2f70` images remain unchanged.

Local diagnostic correction checks: `node --test
.github/scripts/s22-widget-session-select.test.mjs` **23/23 PASS**; scoped
ESLint/Prettier/diff checks **PASS**. The actual catalog query explicitly types
`$1::uuid` and still requires exactly three FORCE-RLS/non-owner tables. The
unchanged ES-module bootstrap was exercised in nine controlled subprocess
scenarios, including the original parameter-gap failure, guard/config/readiness
failures, unknown SQLSTATE, rollback and cleanup. Only finite allowlisted stages,
SQLSTATEs and categories reach reader/launcher output; raw error text/name/stack,
credentials and customer content are never copied. These are local controlled
fixtures, not a successful live session read. A dedicated isolated PostgreSQL 17
wire regression is being prepared without rerunning the seven unchanged budget
cases or using staging credentials/provider access.

Corrected diagnostic source **`676b1d3fc389b66a4c1401cb88bbe4a655e0da6c`**
is pushed. Focused isolated PostgreSQL workflow **37754475137 PASS**:
`node --test .github/scripts/s22-widget-session-select-postgres.test.mjs`.
Five real database subcases (plus the parent harness) prove:

- The exact original parameterized query fails over installed `pg` with
  **SQLSTATE `42P18`**; the connection remains usable after explicit rollback.
- The actual exported corrected SQL returns **`count=3, safe=true`** under a
  non-superuser, non-bypass, non-owner runtime fixture role with FORCE RLS.
- The actual selector collector retrieves only the selected tenant's session;
  a same-origin foreign-tenant session stays invisible under enforced RLS.
- Same-tenant duplicate origins and fresh sessions independently fail closed
  with their explicit ambiguity codes.
- Every read transaction rolls back and clears transaction-local tenant
  context; runtime connections and the disposable fixture/role are cleaned up.

This is an isolated **three-table selector fixture**, not application migration
or a production/staging DB test. The full reader's `lead_agent_staging` guard is
retained, not bypassed or represented as live evidence. The connected server is
verified as PostgreSQL 17; the workflow has no GCP identity, staging credentials
or provider access. The seven unchanged budget tests, passed runtime build and
deployment verification were not manually repeated.

Corrected immutable script checksums (verified from committed blobs):

- Launcher: `25f8bb735ac50b44d80573136f783f5b3e68b58f6336d879245440bac240f0d8`.
- Reader: `1d430316acc64e4b16e270e9bc795793a1d6f6c175ad545928f15d7997156ef0`.

The diagnostic SQL defect and its correction are now independently proven.
**At this checkpoint, its attribution to `xtcgs` remains pending**: the owner
has not supplied the existing execution's assertion/stage read. A
`force_rls_not_owner_guard` failure after a passed runtime guard would correlate
the live boundary with this deterministic reproduction; an `initialize` failure
requires separate investigation. No live success is claimed and no corrected
execution is triggered merely to infer the missing original stage. No runtime
code, image, Terraform configuration or historical ledger value changed.

Exact files changed in this diagnostic correction:
`.github/scripts/s22-widget-session-select-readonly.mjs`,
`.github/scripts/s22-widget-session-select.mjs`,
`.github/scripts/s22-widget-session-select.test.mjs`,
`.github/scripts/s22-widget-session-select-postgres.test.mjs`,
`.github/workflows/s22-widget-session-select.yml`,
`docs/architecture/s22-acceptance-evidence.md` and
`docs/architecture/s22-synthetic-booking-journey.md`.

### Existing selector log-read timeout — no diagnostic retry

The owner returned **`LOG_READ_EXIT=124`** from the bounded `gcloud logging read`
for preserved execution `lead-agent-staging-migrator-xtcgs`. This establishes a
timeout of that log-collection command, not a database outage, failed provider
call or another execution. The original failure-stage attribution remains
uncollected. Do not repeat the same CLI read or execute the selector again to
infer what happened.

The following alternative makes **one direct Logging API request** for that
existing execution and operation within the last 24 hours. It obtains a token
privately in memory with a ten-second subprocess timeout, bounds the API/body
read to twenty seconds and at most ten entries, rejects pagination/incomplete
responses, and prints only allowlisted assertion labels, outcomes and failure
codes. It does not output observed metadata, raw errors, credentials or message
content. No upload, database connection, job execution, mutation or paid call
is involved. Local GCP authentication is unavailable; this command needs the
owner's existing authenticated Cloud Shell. Empty results are missing evidence,
not PASS. The old reader did not persist SQLSTATE, so this read can identify its
failed stage but cannot recover a historical `42P18` value.

```bash
node --input-type=module <<'NODE'
import {execFileSync} from 'node:child_process';
const labels = {
  initialize: 'Initialization',
  runtime_read_only_tenant_guard: 'Runtime / tenant / read-only guard',
  force_rls_not_owner_guard: 'FORCE RLS / non-owner guard',
  widget_session_selection: 'Session selection',
  exact_active_widget_origin: 'Active website origin',
  fresh_unbound_widget_session: 'Fresh unbound session',
  pool_error: 'Database connection',
  cleanup: 'Connection cleanup'
};
const codes = new Set(['DATABASE_OR_TOOLING_UNAVAILABLE', 'DATABASE_UNAVAILABLE',
  'DATABASE_CLEANUP_FAILED', 'SELECTION_SCOPE_INVALID',
  'READ_ONLY_RUNTIME_TENANT_GUARD_FAILED', 'FORCE_RLS_NOT_OWNER_GUARD_FAILED',
  'EXACT_ORIGIN_NOT_ACTIVE', 'EXACT_ORIGIN_AMBIGUOUS', 'NO_FRESH_UNBOUND_SESSION',
  'FRESH_SESSION_AMBIGUOUS', 'FRESH_SESSION_STATE_INVALID']);
let failure = 'Cannot obtain Cloud Shell authentication.';
try {
  const token = execFileSync('gcloud', ['auth', 'print-access-token', '--quiet'], {
    encoding: 'utf8', timeout: 10000, maxBuffer: 65536,
    stdio: ['ignore', 'pipe', 'pipe']
  }).trim();
  if (!token || /\s/u.test(token)) throw Error();
  failure = 'Logging API timed out or could not be reached.';
  const until = new Date().toISOString();
  const from = new Date(Date.parse(until) - 86400000).toISOString();
  const response = await fetch('https://logging.googleapis.com/v2/entries:list', {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(20000),
    headers: {Authorization: `Bearer ${token}`, 'Content-Type': 'application/json'},
    body: JSON.stringify({resourceNames: ['projects/lead-agent-stg-739284'],
      filter: `resource.type="cloud_run_job" AND resource.labels.job_name="lead-agent-staging-migrator" AND labels."run.googleapis.com/execution_name"="lead-agent-staging-migrator-xtcgs" AND jsonPayload.operation="s22_widget_session_selection" AND timestamp>="${from}" AND timestamp<="${until}"`,
      pageSize: 10, orderBy: 'timestamp asc'})
  });
  failure = [401, 403].includes(response.status)
    ? 'Cloud Shell does not have authorized Logging API access.'
    : 'Logging API returned an unsuccessful response.';
  if (!response.ok) throw Error();
  failure = 'Logging API response timed out or could not be read.';
  const raw = await response.text();
  failure = 'Log response was incomplete or invalid; no conclusion drawn.';
  if (raw.length > 65536) throw Error();
  const data = JSON.parse(raw);
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw Error();
  const entries = data.entries ?? [];
  if (!Array.isArray(entries) || entries.length > 10 || data.nextPageToken) throw Error();
  failure = 'No diagnostic rows found in the last 24 hours; evidence still missing.';
  if (!entries.length) throw Error();
  failure = 'Unexpected diagnostic rows; unsafe fields withheld.';
  const rows = entries.map(entry => entry?.jsonPayload);
  if (rows.some(row => !row || row.operation !== 's22_widget_session_selection'
    || !Object.hasOwn(labels, row.assertion) || !['PASS', 'BLOCKED'].includes(row.outcome)
    || (row.outcome === 'BLOCKED' && !codes.has(row.code)))) throw Error();
  console.log('Existing execution: lead-agent-staging-migrator-xtcgs');
  for (const row of rows) console.log(`${labels[row.assertion]}: ${row.outcome}`
    + (row.outcome === 'BLOCKED' ? ` (${row.code})` : ''));
  if (!rows.some(row => row.outcome === 'BLOCKED')) {
    failure = 'Original failure stage not present; evidence still incomplete.';
    throw Error();
  }
  console.log('Log read collected. No diagnostic or paid call was run.');
} catch {
  console.log(`BLOCKED: ${failure}`);
  process.exitCode = 1;
}
NODE
```

Verification for this alternative: the **exact ESM source extracted from the
documented command** passed 17 controlled Node subprocess cases without live
access: guard-then-failure, initialization failure, private authentication error,
invalid token, HTTP 401/403/503, transport/body timeout, empty/malformed/
paginated/oversized response, untrusted assertion/code, wrong operation and
missing original failure. The fixtures assert exactly one private auth command
and at most one correctly scoped Logging request, finite output and no copied
private fixture strings. This is local tooling evidence only; it neither
collects `xtcgs` nor verifies a live session. No application/runtime change or
image rebuild is required. Historical costs and unrelated edits are preserved.

### Owner-supplied original selector failure stage collected

The owner returned the readable result of the single direct Logging API read of
**existing** execution **`lead-agent-staging-migrator-xtcgs`**:

- `runtime_read_only_tenant_guard`: **PASS**.
- `force_rls_not_owner_guard`: **BLOCKED**, code
  `DATABASE_OR_TOOLING_UNAVAILABLE`.
- Log collection completed; no diagnostic or paid call was run by that read.

This is **owner-supplied live diagnostic evidence**, not a new local or
independently authenticated GCP read. The last successful boundary is actual
runtime database access with tenant context, read-only transaction and role
guards. The first failed boundary is the diagnostic FORCE-RLS catalog query,
before origin/session selection. Package/config/initial connection failure is
rejected as the cause of this execution; an expired or ambiguous session is not
its failing stage because selection was never reached. The initial `124` was
the intervening CLI log-collection timeout, not a second database failure.

The live stage correlates with the exact original SQL's independently verified
parameter-type failure: `[organization, tableNames]` binds two values, while
only `$2::text[]` is typed. Isolated PostgreSQL 17 run **37754475137** reproduced
**`42P18`** for that original statement and proved the corrected actual SQL,
which additionally types `$1::uuid`, succeeds without removing FORCE RLS,
runtime-non-owner or tenant boundaries. The original live reader did not retain
SQLSTATE, so **`42P18` is regression evidence, not claimed as a persisted live
field**. The live guard failure is not evidence that FORCE RLS is disabled, nor
an AI, Widget-frame or messaging-provider failure.

The original failure-stage evidence gap is now closed. A **single corrected
read** on a freshly opened real Widget frame is justified to collect the
session needed for the already-prepared deployment plan; no successful live
selection or cohort binding is claimed yet. Corrected immutable diagnostic
source remains `676b1d3fc389b66a4c1401cb88bbe4a655e0da6c`. Both committed script
SHA256 values were rechecked against the prepared download command and match.
The existing 23 local tests and five isolated PostgreSQL subcases are reused;
unchanged tests, runtime builds, inventory and passed deployment checks were
not rerun. Current changes are only this evidence register and the journey's
next-action instructions, checked with scoped Prettier and `git diff --check`.
No application code, runtime image, SQL/IAM configuration, migration, paid
authorization or historical NULL cost changed. S22 remains unaccepted.
