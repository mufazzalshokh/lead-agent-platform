# S22 owner-selected Website Chat test binding

Scope: the existing synthetic staging cohort only. This is not production billing,
general Widget eligibility, a new budget, or S22 acceptance.

## Confirmed timing failure

The previous Worker configuration selected an anonymous Widget session before
Terraform plan, owner approval, apply, provenance verification and readiness.
The browser session has a 30-minute idle limit and two-hour absolute lifetime.
An empty frame does not poll; closing/reopening it does not create authorized
activity. A fresh bootstrap creates a different session ID, previously requiring
another deployment. Repeating that process did not remove the timing dependency.

Owner-supplied execution `lead-agent-staging-migrator-f57lg` reported readiness
PASS, with unchanged last activity at `2026-10-08T16:11:40.456Z`. Its idle
deadline was `16:41:40.456Z`; the agent received the result at `16:41:45Z`.
That completed snapshot could not authorize a later Send. No new provider failure
was established. The separately corrected gateway read-origin defect remains a
separate cause and evidence item.

## Stable deployment envelope, fresh selection after deployment

The owner approved implementation and local verification of a narrowly scoped
authenticated selection command. This approval does not authorize deployment,
opening another chat, or additional paid tests.

The existing deployment SID is retained as a **reviewed envelope anchor**, not
as a revived browser session. The trusted configuration fixes the original
organization/cohort, Widget channel and exact allowed-origin record. The deployed
Worker in owner-selection mode requires an explicit persisted owner selection;
it never falls back to the anchor, automatically chooses the newest session, or
authorizes arbitrary sessions.

After deployment, the authenticated owner may inspect bounded safe candidate
metadata in the staff workspace, corroborate one fresh empty frame, and select
its exact ID and version within five minutes of creation. The UI mirrors this
fresh-selection boundary; selecting does not extend the existing idle/absolute
lifetime. Server-side current membership, owner role, session,
CSRF, Origin and Fetch Metadata checks protect the command. The tenant is derived
from current authorization, not from the command body. Client input contains
only the exact session ID, expected session version and expected selection
version; it cannot supply budgets, authority, tenant, channel or origin.

Selection is append-only in the existing tenant audit table, with member and
membership attribution, server request/correlation IDs, predecessor/version and
allowlisted scope metadata. It does not update session activity, TTL, original
usage/cost records, or protected business state. There is no direct SQL writer
script or new privileged diagnostic launcher.

## Concurrency and irreversible consumption boundary

Owner selection and provider authorization use the original cohort conversation's
existing transaction mutex. Selection also locks the relevant Widget session.
Compare-and-set prevents stale/concurrent choices; an exact repeated command
returns its existing receipt without creating another selection or paid slot.

Replacement is allowed only while the lane is unused and the prior selection
remains contact/conversation-unbound. Any bound conversation/customer inbound,
dispatch latch, reservation, spend, pending/unknown cost or integrity failure
prevents replacement. The first provider dispatch still atomically writes
`ai_run.widget_journey_bound` and `ai_run.dispatch_reserved`. Restarts and later
selections cannot reset this ledger or transfer consumed allowance.

Every dispatch independently rechecks the selected session, tenant, channel,
origin, contact/conversation, automation state, expected versions, idle/absolute
lifetime and existing monetary controls. Expired/revoked sessions are not renewed.
The existing two-inbound/four-physical-attempt Widget allowance and maximum two
attempts per message remain unchanged. Timeout, unknown cost, unresolved reserve,
exhaustion and guard failures continue to stop paid dispatch.

Historical NULL costs remain NULL and unknown. The USD1.033396 historical reserve
is budget-only; additional Widget allowance is USD3.205728 and maximum combined
planning exposure USD4.247838. The USD5 target and USD10 ceiling are unchanged.

## Verification and rollout boundary

### Local verification checkpoint, 2026-10-09

- Focused deterministic regression run: **188/188 PASS**, six files, exit 0.
  This includes 76 modeled ledger cases, 23 application cases, 18 authenticated
  API cases, 24 client-controller cases, 10 selection-contract cases and 37
  public-contract compatibility cases. Mocked transports are not PostgreSQL
  locking or live browser/provider evidence.
- Production Web build: **PASS**, exit 0, including its TypeScript phase and
  static/dynamic route generation. The four changed workspace packages compiled
  successfully using their repository-defined build configurations.
- Review corrected a bound-legacy-anchor edge case, immutable-result sorting,
  and the new API's error mapping into the existing public problem contract.
  Internal audit/telemetry codes remain unchanged. All 372 previous public
  contracts are preserved; six bounded staging contracts are additive.
- Independent review also identified PostgreSQL's actual `bigint` representation:
  the installed driver's INT8 parser returns session version `"2"`, not numeric
  `2`. Passing the raw value into the numeric candidate contract rejected fresh
  sessions. With the old conversion restored for a controlled reproduction,
  both new string/bigint cases **FAIL** with `unavailable`; with the existing safe
  integer mapper restored, both **PASS** in the 188-case run. Session timestamps,
  version and historical records are unchanged. This is local boundary evidence,
  not a claim that this new defect was deployed or observed in staging.
- Five real PostgreSQL regressions are registered in the existing S4a harness:
  concurrent CAS/attribution, idempotency/lifetime/history preservation, tenant
  RLS, bound-anchor refusal, and independent-guard dispatch/replacement races
  with retained unknown-cost reservations. **Execution remains pending**.
  That harness requires major version 17. This laptop has PostgreSQL 18, no
  configured test connection, and its attempted Docker engine was unavailable.
  The PostgreSQL version guard was not bypassed or relaxed.
- Windows paging-file exhaustion and Node native/heap allocation failures
  interrupted local validation. These are tooling failures, not live business
  failures. Task-started Docker helpers were stopped; only generated artifacts
  from the failed compiler invocation were removed. Unrelated edits remain
  untouched. Final source-aware root/API/Worker/Web TypeScript checks **PASS**;
  scoped lint/format checks also passed. The final conversion and presentation
  changes passed touched-file lint, database compilation, source-aware root/Web
  TypeScript and the production Web rebuild before commit.
- No new session, staging execution, migration, paid call, image build, plan or
  apply was performed. The existing PR is number 17; normal CI can provide the
  required PostgreSQL 17 proof after the verified change is pushed.

### Clean-checkout correction after the first push

The implementation was committed/pushed as `a63094dcfb508d73dfc1ab165df05d6384632c98`.
Automatic PR CI **37907478143 FAIL** at Web TypeScript, before database tests.
Repository-wide formatting/lint, 325-file dependency boundaries, 378-contract
snapshot and root TypeScript passed in that run. The Web package's original
typecheck lacked workspace source aliases and required generated contract
declarations, which CI deliberately does not build before typechecking. Existing
local compiled artifacts had masked this clean-checkout requirement.

The smallest correction adds the same separate source-aware typecheck config
already used by API/Worker and points the Web package's typecheck script at it.
Next's production/build config is unchanged. An installed-TypeScript resolver
regression hides generated contract declarations: the old options cannot resolve
the bare import, while the actual new config resolves the repository's contract
source. **25/25 Web cases, source-aware Web TypeScript, scoped lint and formatting
PASS** after correction. The original 188-case run remains valid; the additional
case is clean-checkout tooling evidence, not paid/provider or PostgreSQL proof.
The failed run is retained, not relabeled PASS; PostgreSQL 17 execution awaits
the corrected commit's normal CI.

The old diagnostic readers' static-SID defaults do not establish readiness for
this new mode. The authenticated status reader resolves the persisted owner
selection; an older completed snapshot must not be used as Send authorization.
If multiple fresh candidates exist, stop unless the owner can corroborate the
exact empty frame. Never infer authority by choosing the newest candidate.

Local regression verification must reproduce a Worker created before the new
session, show explicit audited selection of that later session, and preserve
cross-tenant/channel/origin, CAS, duplicate, concurrent dispatch, expiry, consumed
lane and unknown-cost denial. Local/mocked, real local PostgreSQL and live
provider/channel results must be reported separately.

Runtime source changes require fresh immutable images and a new exact saved-plan
review. The existing full-runtime safeguards stay unchanged: four in-place
workload updates only, no migration execution, SQL/IAM/network/scaling changes,
creates, destroys or replacements. The unused replacement preparation timestamp
and old image/plan packets cannot stand in for new runtime provenance.

After an exact approved rollout, select the fresh frame through the staff
interface. No additional SID-binding deployment is needed. Readiness is an
authoritative snapshot, not permission to Send; the existing explicit bounded
paid-test approval is still required before customer actions.

## Exact milestone files and local commands

Runtime/application and shared contracts:

- `apps/api/src/app.ts`
- `apps/api/src/auth/plugin.ts`
- `apps/api/src/runtime.ts`
- `apps/api/src/staff/s22-widget-cohort-composition.ts`
- `apps/api/src/staff/s22-widget-cohort-plugin.ts`
- `apps/web/package.json`
- `apps/web/tsconfig.typecheck.json`
- `apps/web/src/app/staff/StaffWorkspace.tsx`
- `apps/web/src/app/staff/S22WidgetCohort.tsx`
- `apps/web/src/lib/s22-widget-cohort.ts`
- `apps/worker/src/telegram-composition.ts`
- `packages/application/src/index.ts`
- `packages/application/src/staff/s22-widget-cohort.ts`
- `packages/config/src/ai-journey.ts`
- `packages/config/src/index.ts`
- `packages/contracts/src/index.ts`
- `packages/contracts/src/staff/s22-widget-cohort.ts`
- `packages/contracts/snapshots/public-contracts.v1.json`
- `packages/database/src/index.ts`
- `packages/database/src/repositories/ai-journey-budget.ts`
- `packages/database/src/repositories/ai-orchestration.ts`
- `pnpm-lock.yaml` (existing workspace contract dependency only; no external package)
- `scripts/contracts/catalog.ts`

Regression/evidence files:

- `apps/api/tests/s22-widget-cohort.test.ts`
- `apps/web/src/lib/s22-widget-cohort.test.ts`
- `tests/ai/s22-budget-ledger.test.ts`
- `tests/application/s22-widget-cohort-fixtures.ts`
- `tests/application/s22-widget-cohort.test.ts`
- `tests/contracts/s22-widget-cohort.test.ts`
- `tests/contracts/contract-compatibility.test.ts`
- `tests/database/s22-widget-cohort.test-suite.ts`
- `tests/database/s4a-schema.test.ts`
- `docs/architecture/s22-widget-cohort-binding.md`
- `docs/architecture/s22-acceptance-evidence.md`
- `docs/architecture/s22-synthetic-booking-journey.md`

Commands executed locally (Node CLI forms avoid the laptop's PowerShell/pnpm
launcher problems; no live DB or model credentials are used):

```text
node node_modules/vitest/vitest.mjs run tests/ai/s22-budget-ledger.test.ts tests/application/s22-widget-cohort.test.ts tests/contracts/s22-widget-cohort.test.ts tests/contracts/contract-compatibility.test.ts apps/api/tests/s22-widget-cohort.test.ts apps/web/src/lib/s22-widget-cohort.test.ts --maxWorkers=1 --testTimeout=120000 --hookTimeout=120000
node node_modules/typescript/bin/tsc -p tsconfig.json --noEmit
node node_modules/typescript/bin/tsc -p apps/api/tsconfig.typecheck.json --noEmit
node node_modules/typescript/bin/tsc -p apps/worker/tsconfig.typecheck.json --noEmit
node node_modules/typescript/bin/tsc -p apps/web/tsconfig.typecheck.json --noEmit
node node_modules/typescript/bin/tsc -p packages/contracts/tsconfig.json --noEmit false --declaration true --declarationMap true --outDir packages/contracts/dist --rootDir packages/contracts/src
node node_modules/typescript/bin/tsc -p packages/config/tsconfig.json --noEmit false --declaration true --declarationMap true --outDir packages/config/dist --rootDir packages/config/src
node node_modules/typescript/bin/tsc -p packages/application/tsconfig.build.json --noEmit false --declaration true --declarationMap true --outDir packages/application/dist --rootDir packages/application/src
node node_modules/typescript/bin/tsc -p packages/database/tsconfig.build.json --noEmit false --declaration true --declarationMap true --outDir packages/database/dist --rootDir packages/database/src
node node_modules/next/dist/bin/next build  (working directory apps/web)
node node_modules/eslint/bin/eslint.js <exact changed TypeScript files, sequential directory batches> --max-warnings=0
node node_modules/prettier/bin/prettier.cjs --check <exact changed source/contract/package/lock files>
node node_modules/tsx/dist/cli.mjs scripts/contracts/snapshot.ts --check
node scripts/check-boundaries.mjs
git diff --check -- . :!README.md :!docs/architecture/s11-instagram-business.md
```

Architecture Markdown is intentionally excluded by the repository's formatter;
source formatting is not claimed as Markdown formatting. Existing unrelated
`README.md`, S11 Instagram architecture edits and `s22-public-notices.patch`
are not part of this milestone. No migration, IAM, job-configuration, network,
model, paid-dispatch, session-renewal or deployment action was performed.
