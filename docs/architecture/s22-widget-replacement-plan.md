# S22 Website Chat replacement-lane preparation

Status: **RUNTIME AND ROLLOUT PREPARATION VERIFIED; NOT DEPLOYED; NO SEND**.

The owner subsequently approved rollout preparation only. The
[exact saved rollout plan 38157342630](s22-widget-replacement-rollout-plan.md)
records green runtime source `2055ab2`, immutable image digests, the independently
reviewed four-update action set and binary checksum. No apply, session or paid
execution is authorized by that preparation receipt.

## Exact authority and current boundary

On 11 October 2026 the owner approved preparation of one replacement Website
Chat test lane: two new customer messages, at most three new physical provider
attempts, at most two per message, retaining all prior costs/counts and the
existing USD4.247838 combined-exposure cap and USD10 hard ceiling. This is not
deployment, session creation/selection, provider dispatch or customer-message
approval. The original two-message lane is not silently reset or transferred.

The [recovery application rollout](s22-widget-recovery-rollout-plan.md#application-apply-and-live-verification-receipt--11-october-2026)
is already verified. This packet neither repeats it nor substitutes another
runtime source/image. The replacement-lane runtime transition is now implemented
and tested locally below, not a claimed completed deployment.

## Why another fresh-frame loop would fail

- Original session `01a12a04-d2ae-7cba-aded-0c48a410be0c` is bound to conversation
  `01a12a13-2f0a-7cb4-a8c7-8f0051168d39` and request
  `01a12a13-498e-7d43-83cf-85b13307bd7b`.
- The last owner-supplied trace proves one inbound, one outbound and one priced
  provider reservation, not a completed booking. The request was `requested/1`,
  offer 0. This is historical evidence, not a fresh database observation.
- The old chat has no previously saved ownership code. The recovery release
  cannot issue one retroactively. Persisted messages/request remain intact.
- The live budget guard intentionally refuses replacement once a Widget
  conversation or dispatch is bound. Fresh frames, refreshing selection and
  reapplying the recovery release cannot change that invariant.
- Older diagnostic scripts pin other releases/sessions and evaluate original
  expiry. They are preserved as historical tools, not reused for recovery
  readiness. The effective recovered access lease is separate from original
  identity timestamps.

## Prepared scope and integer budget proof

The source of the preparation packet is
`.github/scripts/s22-widget-replacement-prepare.mjs`. Its `--plan` command prints
the immutable finite packet and its SHA256 only. It never accesses cloud,
database, browser or provider services; it writes no evidence file.

| Quantity | Prepared bound / historical baseline |
| --- | --- |
| Existing ledger | 5 priced dispatch slots/trigger messages: 4 original Instagram + 1 retired Widget |
| Retired Widget | 1 customer inbound, 1 provider reservation, USD0.002250 known cost |
| Known cohort cost | USD0.010964, expected historical snapshot only |
| Historical uncertainty reserve | USD1.033396; original NULL costs remain NULL |
| Existing combined exposure | USD1.044360; pending reserve USD0, expected historical snapshot only |
| New lane | 2 customer messages: request, then confirmation only after actual staff offer |
| New physical attempts | 3 total; at most 2 per message, no transport retry expansion |
| Per-attempt reservation | 801,432 micros; exact model/profile/pricing must remain valid |
| New reserve bound | 3 × 801,432 = 2,404,296 micros / USD2.404296 |
| Planned combined bound | 1,044,360 + 2,404,296 = 3,448,656 micros / USD3.448656 |
| Existing caps | USD4.247838 combined exposure and USD10 hard ceiling, unchanged |
| Widget physical total including retired lane | At most 4; the retired attempt is not erased |
| Widget customer total including retired lane | At most 3: one retained + two proposed new messages |

The change from two original Widget messages to three including the retired
message is explicit. Only its preparation was approved; execution still needs
the exact new-lane approval. A new reservation must fit the existing monetary
caps independently at dispatch time. This calculation is a bound, not a current
balance, billing reconciliation or permission to call a provider.

## Prepared read-only evidence checks

`collectReplacementBaseline` accepts a trusted read adapter and budget reader;
it has no execution launcher. A future adapter must verify the reviewed runtime
images/source/migration head before database access and use one bounded,
tenant-scoped READ ONLY transaction with the actual non-owner runtime role.
Do not use an administrator connection. Cloud diagnostic execution remains
unapproved by this packet.

The finite SELECT-only collection fails closed unless all of these match:

1. `lead_agent_runtime`, staging database, no superuser/BYPASSRLS, read-only
   transaction, tenant context, row security, and a fresh collection window.
2. FORCE RLS/non-ownership on all nine tables used.
3. Both original historical rows still exist in their original conversation
   with NULL costs. Even a write of zero is rejected.
4. Attributed contiguous owner-selection CAS history, latest selection matching
   the retired session, with room for one replacement under the existing limit.
5. Exact retired session/channel/origin/conversation/request; original access
   expired, no recovery proof issued, exactly one matching customer inbound,
   request still `requested/1` with offer 0.
6. Exactly one matching Widget binding audit, not an arbitrary latest row.
7. Exact retired run, trigger and reservation authority; completed success,
   one reservation, expected provider/model and known cost 2,250 micros.
8. Cohort counts, known cost, zero pending reserve, retained historical reserve
   and existing retired selection match the frozen baseline. Changed/unknown
   state requires review, never automatic reconciliation or a ledger reset.

The output is `BASELINE_MATCHES_PREPARED_PLAN`, not booking/dispatch readiness.
It explicitly retains `sendAuthorized=false` and `runtimeGuardImplemented=false`.
This milestone has tested the collector with modeled reads only; it has not
collected a live baseline or executed its SQL against PostgreSQL.

`recoveryAccessSql` and `assessRecoveredAccess` provide the prepared observation
for an independently corroborated new session/conversation identity. They check
the authenticated access lease, idle deadline, fixed recovery-family deadline,
current channel/origin/contact and nonterminal conversation. The original expiry
may be in the past after recovery; identity and business objects must stay the
same. No proof/token/hash/body is returned. The standalone assessor is not an
authorization function: future collection must use the guarded transaction,
owner-selection/binding evidence and the budget guard. A metadata PASS never
substitutes for the customer's private code or actual browser recovery.

## Runtime transition requirements

The preparation checkpoint deliberately left the paid guard unchanged. The
subsequently approved local implementation follows these requirements:

- Recognize only this exact fully settled retired binding, including the retained
  historical uncertainty and all original paid dispatch markers. Validate the
  full ledger, not merely the preparation snapshot's expired-session reason.
- Atomically recheck retirement, owner membership, tenant/channel/origin and
  selection CAS under the existing cohort mutex. Keep old audit events immutable;
  record an attributed additive replacement authorization and new binding.
- Permit only an explicitly owner-correlated fresh unbound session after rollout.
  Do not choose the newest frame, revive the retired bearer or move its request.
- Classify original Instagram, retained old Widget and new Widget dispatches
  independently while aggregating every known cost and unresolved reservation.
  All counters survive restarts, races, unknown outcomes and code recovery.
- Deny old-lane dispatch and any second consumed replacement. The new lane has
  two customer messages/three physical slots/two slots per message. Replay,
  duplicate/concurrent selection and stale versions cannot create extra allowance.
- Recheck exact model/pricing, per-call reservation, exposure caps, active access
  lease and conversation state before every call. Unknown cost, missing audit
  provenance, timeout or pending reserve stops subsequent calls.
- Keep customer confirmation deterministic and bound to the actual current staff
  offer. Staff acceptance alone cannot confirm a booking.

Required verification includes actual PostgreSQL row-lock/CAS/rollback tests,
cross-tenant denial, retained-NULL/cost/count preservation, retired-lane denial,
new-lane caps and recovery without duplicated business effects. Modeled tests
cannot establish those database or live-channel claims. No schema change is
assumed; any genuine need must be reviewed before implementation.

## Finite live sequence, after separate rollout and execution approvals

1. Finish implementation, full CI and immutable source/image review first.
   Prepare one exact rollout plan; apply only after its separate approval.
2. Verify the deployed revisions and current ledger. If the retired snapshot
   changed, stop and explain the difference. Do not open a new frame during builds.
3. Obtain explicit bounded execution approval for the new lane. Open/corroborate
   one empty frame and select it through the authenticated staff interface.
4. Send one booking request using approved synthetic knowledge and a valid future
   preference. Observe the response and persisted request; do not resend.
5. Issue/save the optional private code while access is live. Keep it private;
   never paste it into chat, logs, screenshots, the host page or a URL.
6. Reload the test host once, reinstall the same public snippet, and manually
   resume with the code before any new Send. Save its rotated replacement code.
   Verify the same session identity, conversation, messages and appointment
   request, with no extra inbound or provider reservation from recovery.
7. Staff accepts a valid future offer. Observe its actual delivery, then send
   exactly one customer confirmation. No manufactured external attestation.
8. Collect the bound final receipt: confirmed state/evidence, delivery, unchanged
   identities, two new inbounds at most, three new attempts at most, preserved
   old lane/history and final cost/reserve. S22's other gates remain separate.

On any unexpected result, stop at that transition and collect evidence. Do not
create another chat, renew access automatically, resend or repeat the rollout.

## Verification and changed files

Preparation tests cover the integer bounds, inactive authority flags, unchanged
live guard, role/RLS/freshness failures, changed/missing/duplicate scope and audits,
retained NULLs, unknown costs, credential exclusion and effective recovered access.
The native tests are registered in ordinary CI's existing workspace wrapper.

Local commands (no cloud/provider/database connection):

```text
node --test .github/scripts/s22-widget-replacement-prepare.test.mjs
node node_modules/vitest/vitest.mjs run tests/workspace/staging-journey-mode.test.ts apps/web/src/lib/widget-embed.test.ts apps/api/tests/widget.test.ts tests/application/widget-use-cases.test.ts tests/security/widget-security.test.ts tests/ai/s22-budget-ledger.test.ts --maxWorkers=1 --testTimeout=30000
node node_modules/typescript/bin/tsc -p tsconfig.json --noEmit
node node_modules/eslint/bin/eslint.js .github/scripts/s22-widget-replacement-prepare.mjs .github/scripts/s22-widget-replacement-prepare.test.mjs tests/workspace/staging-journey-mode.test.ts --max-warnings=0
node node_modules/prettier/bin/prettier.cjs --check .github/scripts/s22-widget-replacement-prepare.mjs .github/scripts/s22-widget-replacement-prepare.test.mjs tests/workspace/staging-journey-mode.test.ts
node --check .github/scripts/s22-widget-replacement-prepare.mjs
node --check .github/scripts/s22-widget-replacement-prepare.test.mjs
node .github/scripts/s22-widget-replacement-prepare.mjs --plan
git diff --cached --check
```

The stable preparation-packet SHA256 is
`545516ebc0587af0dd5ff47534164c393c9dd448ddb7cff46d20b0a63438c89b`.
This fingerprints scope/limits/inactive authority, not a saved Terraform plan
or deployed authorization. The source and reader must additionally be pinned
and verified when a live read is separately prepared.

Results: **67/67 native preparation cases PASS** and **159/159 focused Vitest
cases PASS** in six suites. The workspace case also reruns the native tests, so
these counts are not disjoint. Root TypeScript, touched-file lint/format, both
Node syntax checks and the finite `--plan` CLI pass. The staged scope/whitespace
check is required before committing this packet. No full aggregate CI, actual
SQL execution, live baseline collection, deployment or customer E2E is claimed.

Files:

```text
.github/scripts/s22-widget-replacement-prepare.mjs
.github/scripts/s22-widget-replacement-prepare.test.mjs
tests/workspace/staging-journey-mode.test.ts
docs/architecture/s22-widget-replacement-plan.md
```

Existing owner edits to README, Instagram documentation and the public-notices
patch remain excluded. There is no application/configuration/SQL/IAM/budget change.

The preparation checkpoint's next task was local implementation and PostgreSQL
verification. That subsequent milestone is recorded below; the original
preparation packet and its inactive flags remain unchanged.

## Local runtime transition — 11 October 2026

Owner instruction to continue authorizes local implementation/testing only.
No cloud execution, deployment, new browser frame, Send or provider call was
performed. No new schema, public API field, environment option, role or dependency
is required.

`S22_WIDGET_REPLACEMENT` fixes the exact retired session/conversation/message/run/
request above, its 2,250-micro settled cost, two new inbounds and three new physical
slots. Original allowance/caps, historical NULLs and the immutable ledger remain.
The existing owner-selection command commits additive `replacement_profile` and
`retired_session_id` metadata with current member attribution and CAS. Browser
input cannot set the phase, limits, tenant, channel or origin.

Before that commit the full ledger and exact expired, non-recoverable old identity
and `requested/1/offer0` request must match. The existing cohort mutex serializes
selection/dispatch; retired identity/conversation/request rows are also locked
for the recheck. Missing, duplicated, unknown, changed or unattributed evidence
denies the transition. No previous audit or session timestamp is modified.

Each dispatch classifies original Instagram, retired Widget and replacement
Widget separately, sums all costs/reserves/slots, and requires both old/new binding
audits. Retired dispatch and any second replacement are denied. Restart or genuine
code recovery does not grant new counters. The replacement checks its effective
access lease, actual first two inbounds, owned active contact/conversation,
versions, exact dated pricing, three physical attempts/two per message and both
unchanged monetary caps before committing a physical reservation.

Modeled transport checks cover corrupted selection authority, NULL/changed costs,
missing/duplicate markers, orphan reservations, unknown outcome, rollback,
restarts, duplicate commands and attempt/inbound limits. Eleven new actual
PostgreSQL cases exercise locks/CAS, audit-failure rollback, foreign-tenant denial,
frozen historical NULLs/costs/timestamps, old-lane denial, next-lane exhaustion and
genuine private-code issuance/redemption after original expiry. Recovery retains
the same session/conversation/request and ledger and rejects old credentials/replay;
this uses the real application/security/database implementations, not a modeled
lease update. Provider completion/knowledge/request rows are explicitly synthetic
fixtures, not customer E2E evidence. Existing staff-offer confirmation semantics
are unchanged; their separate recovered-lease regression is included.

Verification:

```text
node node_modules/vitest/vitest.mjs run tests/ai/s22-budget-ledger.test.ts tests/application/s22-widget-cohort.test.ts apps/api/tests/s22-widget-cohort.test.ts tests/contracts/s22-widget-cohort.test.ts tests/contracts/contract-compatibility.test.ts apps/web/src/lib/s22-widget-cohort.test.ts --maxWorkers=1 --testTimeout=30000 --reporter=dot
TEST_DATABASE_URL=postgresql://s22_test_admin@127.0.0.1:55437/s22_local_replacement_final_test
node node_modules/vitest/vitest.mjs run tests/database/s4a-schema.test.ts -t 'S22|customer-owned Widget recovery|confirms the existing staff offer through a recovered' --maxWorkers=1 --testTimeout=60000 --hookTimeout=120000 --reporter=dot
node --test .github/scripts/s22-widget-replacement-prepare.test.mjs
node node_modules/typescript/bin/tsc -p tsconfig.json --noEmit
node node_modules/eslint/bin/eslint.js packages/config/src/ai-journey.ts packages/config/src/index.ts packages/database/src/repositories/ai-journey-budget.ts packages/database/src/repositories/s22-widget-retirement.ts tests/ai/s22-budget-ledger.test.ts tests/database/s22-widget-cohort.test-suite.ts --max-warnings=0
node node_modules/prettier/bin/prettier.cjs --check packages/config/src/ai-journey.ts packages/config/src/index.ts packages/database/src/repositories/ai-journey-budget.ts packages/database/src/repositories/s22-widget-retirement.ts tests/ai/s22-budget-ledger.test.ts tests/database/s22-widget-cohort.test-suite.ts
node scripts/check-boundaries.mjs
```

Results: **210/210 focused ordinary cases PASS** (96 ledger cases, including 20
new replacement cases); **39/39 selected real PostgreSQL cases PASS**, with 447
unselected cases explicitly not claimed as verified in that run; **67/67 native
preparation cases PASS**. The original packet remains non-executing. Root
TypeScript, scoped lint/format and dependency boundaries pass. Full aggregate CI
and live retirement-baseline collection/deployment/customer acceptance are not
claimed by these results.

The first two database runs stopped in fixture setup (publication timestamps,
then empty policy JSON); constraints were not relaxed. The third passed nine
new cases and exposed two test issues: attempts inserted as attempt 1 before an
update, and an assertion expecting an unsanitized database error. Correcting those
fixtures/assertions produced the combined 39-case PASS above. Earlier failed runs
are not reclassified as successful verification. PostgreSQL 17.11 is task-local,
loopback-only, with bounded WAL; existing installed services and staging databases
were untouched.

The disposable server was stopped after verification. Only this milestone's
downloaded binaries, fictional cluster data and setup scripts in its exact task-
cache directory were removed; versioned source, receipts and unrelated owner
files remain. These disposable artifacts can be recreated, not restored as
customer data.

Runtime milestone files (unrelated owner edits excluded):

```text
packages/config/src/ai-journey.ts
packages/config/src/index.ts
packages/database/src/repositories/ai-journey-budget.ts
packages/database/src/repositories/s22-widget-retirement.ts
tests/ai/s22-budget-ledger.test.ts
tests/database/s22-widget-cohort.test-suite.ts
docs/architecture/s22-widget-replacement-plan.md
docs/architecture/s22-widget-cohort-binding.md
```

That milestone's next task was clean-checkout CI and one separately approved
rollout preparation. Both now pass on exact runtime source `2055ab2`; see the
linked approval packet above. Deployment and bounded execution still require
separate approval. Do not open a fresh frame before verified deployment.

### Clean-checkout declaration-build correction

Runtime commit `939a72b2cdd427ccd0eedf42b7904fbdd53a6c65` was pushed and its remote
hash verified. Automatic CI **38155757493** passed format/lint/boundaries, all
382 canonical contracts, all workspace TypeScript, **3,594 ordinary tests**
(seven opt-in skipped) and **542 actual PostgreSQL tests** (486 + 9 + 21 + 12 + 14).
It then failed package declaration generation with **TS2883**: the new helper's
inferred branded contact identifier could not be named portably from generated
contract declarations. Root `--noEmit` checks do not prove declaration emission.
That run remains FAIL; it is not a completed full-CI/build receipt.

The smallest correction explicitly annotates the helper's finite metadata return
type (UUID strings/inbound ID list or NULL). Runtime validation still uses the
same identifier schema; no assertion cast, widened input, compiler suppression,
guard, query, budget or schema change is introduced. Local declaration build and
fresh exact-source CI must pass before a rollout can be prepared.

Local correction verification: configuration and database declaration builds
**PASS**, and the emitted helper declaration references only its named tenant
session type and explicit finite metadata shape. Commands:

```text
node node_modules/typescript/bin/tsc -p packages/config/tsconfig.json --noEmit false --declaration true --declarationMap true --outDir packages/config/dist --rootDir packages/config/src
node node_modules/typescript/bin/tsc -p packages/database/tsconfig.build.json --noEmit false --declaration true --declarationMap true --outDir packages/database/dist --rootDir packages/database/src
node node_modules/vitest/vitest.mjs run tests/ai/s22-budget-ledger.test.ts --maxWorkers=1 --testTimeout=30000 --reporter=dot
```

All **96/96 modeled ledger cases PASS** after the annotation. Scoped lint,
formatting and whitespace checks also pass; generated declarations remain
unversioned. Follow-up source `2055ab297fa14549c32cfbae62a094c0dd7ee751` has its
own successful clean-checkout CI **38156365923**: all 3,594 ordinary cases (seven
opt-in skipped), 542 actual PostgreSQL cases and production/declaration builds
PASS. This corrects the declaration failure; it is not live booking acceptance.
