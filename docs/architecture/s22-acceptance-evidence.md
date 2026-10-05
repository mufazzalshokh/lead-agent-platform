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
