# S22 — exact same-chat date continuation preparation

## Authority and current boundary

The owner approved preparation of one amendment: three customer messages in
the already-selected replacement chat, with the three-physical-attempt limit
and all monetary caps unchanged. This is **preparation only**. It does not
authorize deployment, recovery, Send, replay, another replacement or a migration.
No saved rollout plan exists for this amendment yet.

The named-date parser correction is already deployed as source
`1a910f097709a0e20b8d153bf482f470e1d631be` through consumed plan
`38165971091`. Do not apply that plan again. Its correction does not replay the
first customer message processed before deployment.

## Exact continuation, not a reset

| Binding | Required value |
| --- | --- |
| Selected session | `01a12c02-3e50-7663-99f4-c35024796c23` |
| Conversation | `01a12c14-1edf-7609-a7d3-6354deaa7006` |
| Original inbound | `01a12c14-1edf-76bb-a51c-cc92a70975ea` |
| Original paid run | `01a12c14-24bc-77f1-b1bb-b040e2b7d588` |
| Original known cost | USD0.002277; must remain priced and unchanged |

The amendment activates only for this owner-selected replacement, its exact
conversation/first inbound and the exact succeeded, finished, authorized,
single-reservation first attempt. Missing or changed baseline evidence fails
closed. Every other selection retains its two-customer-message boundary.

The intended sequence is the existing first message, one date clarification,
then one customer confirmation **only after an actual staff offer**. The first
two customer messages remain the only paid-message candidates. The third may
be handled by the existing deterministic confirmation path; the provider guard
does not authorize a third paid message. A fourth persisted inbound is detected
by a sentinel and blocked. No previous message, reservation, unknown cost,
owner-selection audit, retirement or conversation-binding latch is reset.

| Limit | Preserved value |
| --- | --- |
| Current replacement physical attempts | 3 total, including the consumed first attempt |
| Attempts per paid message | At most 2 |
| Paid customer messages | First 2 only |
| Replacement reserve | USD2.404296 |
| Original Widget reserve | USD3.205728 |
| Combined reserved-exposure cap | USD4.247838 |
| Hard cohort ceiling | USD10.000000 |
| Historical unknown-cost reserve | USD1.033396; NULL actual costs remain unknown |

## Retained owner-supplied observation

Execution `lead-agent-staging-migrator-6m4qk` completed with runtime, tenant,
read-only, FORCE-RLS and non-owner guards passing. This is the owner's pasted
metadata, not independently fetched current readiness or customer E2E proof.
Preserve the execution; do not rerun it.

The checked window was 11 October 2026, 17:28–19:29 UTC. It contained one
processed inbound, one outbound, one succeeded/schema-valid/authorized paid
run and no appointment request. This supports clarification rather than
immediate staff acceptance; it does not assert that no request exists outside
that window. Observed totals were known USD0.013241, combined reserved exposure
USD1.046637 and pending reserve USD0.000000.

Two remaining physical slots at the existing USD0.801432 per-slot bound imply
additional exposure at most USD1.602864 and a **planning bound** USD2.649501.
Those figures are not a refreshed balance or dispatch authorization.

Original access expired at `2026-10-11T19:28:26.960Z`. The observed recovery
family expires at `2026-10-12T17:49:03.353Z` (22:49:03 Asia/Tashkent). The owner
confirmed privately saving the recovery proof; no proof value is included here.
After a separately authorized rollout and verification, owner redemption can
resume this same session/conversation. The protocol uses an empty, unbound frame
as redemption context and revokes that context on success; it must not become
another selected business chat. Staff cannot recover a chat from its public ID.
Expiry or failed recovery stops the continuation rather than causing a reset.

## Verification and rollout preparation

Local checks passed: root TypeScript; scoped ESLint and Prettier; dependency
boundaries (332 source files); scoped diff whitespace check; and the broad
AI/application/domain regression command below (**1,100 passed, 7 opt-in live
tests skipped**). Twenty modeled-transport tests cover retained usage, recovery
and restart, duplicate authorization, exact baseline tampering, third paid-turn
denial and the fourth-inbound sentinel. Four actual PostgreSQL tests were added
for recovered access, concurrent authorization and changed/unknown first costs.
They require the full remote CI database gate: the local Docker daemon is not
available. Do not report those tests as passing before CI supplies evidence.

```text
node node_modules/typescript/bin/tsc -p tsconfig.json --noEmit
node node_modules/eslint/bin/eslint.js packages/config/src/ai-journey.ts packages/config/src/index.ts packages/database/src/repositories/ai-journey-budget.ts tests/ai/s22-budget-ledger.test.ts tests/database/s22-widget-cohort.test-suite.ts --max-warnings=0
node node_modules/prettier/bin/prettier.cjs --check packages/config/src/ai-journey.ts packages/config/src/index.ts packages/database/src/repositories/ai-journey-budget.ts tests/ai/s22-budget-ledger.test.ts tests/database/s22-widget-cohort.test-suite.ts
node scripts/check-boundaries.mjs
node node_modules/vitest/vitest.mjs run tests/ai tests/ai-evals tests/application/widget-use-cases.test.ts tests/application/s22-widget-cohort.test.ts tests/instagram/application.test.ts tests/domain/appointment-request.test.ts --maxWorkers=1 --testTimeout=30000 --reporter=dot
```

Release preparation must bind passing full CI and immutable image provenance to
one new saved, reviewed plan. Preserve all four current runtime before-images,
the stable `widget_booking` envelope anchor
`01a11c48-dbc2-76de-a873-f41664da5ccb`, migration head
`0032_s22_widget_recovery`, private VPC, runtime identities, secrets references
and explicit zero migrator retries. Do not execute a job during runtime rollout.
The existing metadata reader's old source/image/window pins cannot establish
post-rollout readiness; prepare compatible bounded same-chat evidence instead
of repeatedly running obsolete tooling.

No database migration, new dependency, public contract change, IAM expansion,
provider call or UI change is part of this amendment. **S22 remains unaccepted.**
