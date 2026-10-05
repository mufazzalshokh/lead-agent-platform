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
  version progression, source inspection or prior tests.

This continuation changes only the evidence register. No runtime/product code,
schema, migration, IAM, privacy eligibility, credentials or infrastructure changed.
No CI, deployment, provider OAuth or local suite was repeated. S22 remains
unaccepted until the remaining gates are proven.

## Scoped persisted Claim/Resolve evidence checkpoint — 2026-10-05

Status: **BLOCKED for direct persisted-row verification**, not a product failure.
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
  **1 -> 3**; their actual persistence remains unverified.
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
| Accepted live current state: handoff resolved/4; conversation open/12, AI mode, no active handoff | PASS, preserved API evidence | No fresh database snapshot was taken |
| Direct current handoff/conversation database snapshot | BLOCKED | Runtime-role diagnostic has not executed |
| Persisted Claim intermediates: versions 2 and 3, same owner/time/correlation | BLOCKED | Source expectation only; no transition rows read |
| Persisted Resolve: version 4, `staff_resolved` / `resume_ai` | BLOCKED | Source expectation only; no transition row read |
| Persisted conversation events: versions 11 and 12 | BLOCKED | No canonical Outbox event rows read |
| Claim: two succeeded, owner-attributed target audit rows | BLOCKED | No audit rows read |
| Resolve: two succeeded, owner-attributed target audit rows | BLOCKED | No audit rows read |

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
direct persisted transition/audit proof still awaits the actual read-only execution.

Required next action: execute this exact scoped diagnostic from existing
authenticated GCP access and preserve its structured results/execution ID. Do not
broaden permissions if that access cannot launch the existing job or read its logs.
After this evidence gap is closed, the next milestone is authoritative synthetic
business knowledge and the complete customer-to-confirmed-booking journey.
S22 remains unaccepted; S23 has not started.

## Remaining gates

| Gate | Evidence still required |
| --- | --- |
| Instagram DM / staff workflow | Deployment, authenticated History/transcript/navigation/current-state and fresh synthetic Claim/Resolve feedback/version sequencing PASS; direct transition/audit rows and tenant-routing/eligibility proof remain pending |
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
