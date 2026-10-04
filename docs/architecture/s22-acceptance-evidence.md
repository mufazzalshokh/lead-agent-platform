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

## Staff conversation workflow milestone — local, not deployed

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
Deployment and real owner verification of layout/focus, History, retained feedback,
fresh-version sequencing and direct post-action history/audit remain pending.

Rollout starts with `Build staging images` (`staging-images.yml`), dispatched on the
existing S22 branch with the exact new checkpoint SHA and `image_scope=all`; the
workflow has no Web-only scope. Use its fresh immutable digests to generate a new
reviewable plan. Do not reuse earlier saved plans, image digests or approval hashes.
Infrastructure apply requires repository-mandated approval of that exact new plan.

## Remaining gates

| Gate | Evidence still required |
| --- | --- |
| Instagram DM / staff workflow | Owner-observed inbound, automatic reply and Claim/Resolve preserved; direct post-action history/audit and tenant-routing/eligibility proof remain pending, together with the new staff workflow deployment/live proof |
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
