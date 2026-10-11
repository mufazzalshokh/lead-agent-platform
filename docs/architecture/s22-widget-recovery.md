# Customer-owned Website Chat recovery

Original implementation scope: local implementation and regression testing.
The owner subsequently approved migration-first rollout preparation, one
migration/schema-security validation and **application plan 38144565508 only**.
The [rollout receipt](s22-widget-recovery-rollout-plan.md) records those separate
approvals, verified immutable images, successful exact-plan application deployment
and read-only postflight. It does not approve another paid test, increased budget,
session replacement or retroactive recovery without customer ownership proof.
Live customer recovery/booking acceptance remains pending.

## Root cause

The original trusted frame holds its access JWT and conversation reference only
in memory. Reloading removes that memory. Access ends after two hours or thirty
idle minutes; reopening an existing frame does not authenticate anew. Persisted
messages and the appointment request are not deleted by either event.

A public installation key, session/conversation UUID or staff-visible message is
not customer ownership proof. Staff cannot issue recovery for an expired chat.
An already-lost chat without a previously saved code cannot use this feature
retroactively.

## Optional private code

While a live conversation-bound chat is accessible, the customer can open **Keep
or resume your chat**, obtain a code, and save it privately. The frame displays
and selects it for manual copying. Neither code nor access JWT goes into cookies,
browser storage, URLs/fragments/referrers, the host DOM or host `postMessage`.
Only finite lifecycle messages cross the host boundary.

`wrc1` encrypts finite tenant/channel/identity/origin authority with AES-GCM. A
purpose-specific HKDF key and AAD separate it from `wex1` exchange grants. Its
identifier is random 256-bit entropy; only its SHA-256 hash is stored in the DB.
First issuance fixes a 24-hour recovery-family deadline. Reissue and consumption
rotate the hash but never extend this deadline. Concurrent redemption has one
winner. Losing a successful response loses the replacement code: do not blindly
retry the consumed code or resend the original customer message.

## Explicit reauthentication

Open a fresh empty frame on the same approved website and paste the saved code
before sending. The API requires both that code and a live unbound context bearer.
The latter establishes current tenant/channel/embedding authority; a host-supplied
identifier cannot replace it.

One tenant transaction locks both identity rows, verifies hashes and deadlines,
current channel/allowlist, active contact and nonterminal owned conversation,
rotates credentials, appends a customer audit, and revokes the unbound context.
Revoked sessions, disabled channels/origins, anonymized/blocked contacts and
terminal conversations are denied. Failures are non-enumerating. IP, identity and
tenant request limits apply; the existing limiter is process-local, not a
distributed guarantee.

The new access lease lasts at most two hours, capped by the original recovery
deadline, with the existing idle limit. Original session ID, participant, contact,
conversation, `issued_at` and `expires_at` remain unchanged. This is independent
authentication using saved proof, not renewal of the expired JWT. Old access and
the consumed unbound context no longer work. Save the replacement code after
success; the previous code no longer works.

On bound access expiry the frame stops requests, disables sending, retains
already-displayed messages and explicitly says the session ended. A fresh recovery
window is a manual action. No automatic access renewal or inbound replay occurs.

## Booking and budget invariants

Recovery creates no contact, lead, conversation, message, appointment, provider
reservation, staff offer, confirmation or outbox work. The existing conversation
continues to own its appointment. Staff acceptance still requires subsequent
customer confirmation or separately authorized audited external attestation.

S22 selection/dispatch stay pinned to the original session identity. Consumed
selections, message counts, attempts, costs, historical unknown costs, stop guards
and ceilings are unchanged. The binding guard uses an authenticated access lease
deadline when present. Recovery does not select a test or authorize Send.
AI context, sales qualification and customer-confirmation channel checks use the
same effective access deadline; they do not replace the original customer identity
or extend the domain staff offer.
Previously packaged read-only readers of original expiry are not recovery-aware
readiness evidence and must not be interpreted as permission to send.

## Additive migration and release gate

`0032_s22_widget_recovery` adds seven nullable `widget_sessions` columns and bounded
shape/lifetime constraints. Existing rows remain proof-less. No backfill, new
table, RLS/grant/role change, secret or environment change is included. Historical
SQL migrations are untouched; the new snapshot preserves unrelated objects.
Do not deploy new queries before the additive migration. Real PostgreSQL tests
and a separately reviewed migration/runtime rollout are required before release.

Tests cover purpose separation, tampering/expiry, finite HTTP contracts, host
credential exclusion, busy-send exclusion, ended-frame behavior, cross-tenant/
origin/channel rejection, revocation/privacy/terminal-state denial, reissue,
replay/concurrent consumption, unchanged identity/business state and deadline
caps. Live recovery and the remaining booking confirmation are separate acceptance
evidence, not implied by local checks.

## Local verification — 11 October 2026

No staging credentials, database, browser session or provider endpoint were used.
No billable call, live message, booking change, deployment or budget increase was
performed. Dependencies were repaired using the existing frozen lockfile; package
and lockfile contents are unchanged.

Commands and results:

- `node node_modules/typescript/bin/tsc -p tsconfig.json --noEmit`: PASS.
- `node C:/Users/Lenovo/AppData/Roaming/npm/node_modules/pnpm/bin/pnpm.cjs --workspace-concurrency=1 --recursive --if-present run typecheck`:
  PASS for all 15 workspace projects with typecheck scripts.
- `node C:/Users/Lenovo/AppData/Roaming/npm/node_modules/pnpm/bin/pnpm.cjs --workspace-concurrency=1 --filter './packages/*' run build`:
  PASS for all 11 shared packages.
- `node node_modules/typescript/bin/tsc -p apps/api/tsconfig.build.json`, then
  `apps/worker/tsconfig.build.json`, then `apps/migrator/tsconfig.build.json`: PASS.
- `NEXT_TELEMETRY_DISABLED=1 node node_modules/next/dist/bin/next build` from
  `apps/web`: PASS, including TypeScript and production route generation.
- `node node_modules/eslint/bin/eslint.js <all changed TypeScript files from the inventory below> --max-warnings=0`:
  PASS.
- `node node_modules/prettier/bin/prettier.cjs --check <all in-scope files below> --ignore-unknown`:
  PASS for matched files. Architecture Markdown and database snapshots are
  intentionally ignored by the repository formatter.
- `node scripts/check-boundaries.mjs`: PASS for 330 source files.
- `node node_modules/tsx/dist/cli.mjs scripts/contracts/snapshot.ts --check`:
  PASS for 382 canonical contracts. An additional direct comparison with `HEAD`
  verified all 378 accepted contracts, historical migration journal entries and
  unrelated Drizzle snapshot objects remain unchanged.
- `git diff --check -- apps packages scripts tests docs/architecture/s22-widget-recovery.md docs/architecture/s22-widget-cohort-binding.md`:
  PASS. SHA-256 comparisons verified the three unrelated user edits are unchanged.

The full ordinary-test command was:

```text
node node_modules/vitest/vitest.mjs run --exclude tests/database/s4a-schema.test.ts --exclude tests/database/s8-pgboss-infrastructure.test.ts --exclude tests/database/s8-outbox-relay.test.ts --exclude tests/database/s8-dispatcher.test.ts --exclude tests/database/s8-handler-reliability.test.ts --maxWorkers=1 --testTimeout=30000
```

Result: 3,573 passed, seven opt-in tests skipped, one failed when an existing
five-second child-process limit terminated a Node validation command. The exact
suite then passed all 18 tests with its original child-process guards unchanged:

```text
node node_modules/vitest/vitest.mjs run tests/workspace/staging-journey-mode.test.ts --maxWorkers=1 --testTimeout=30000
```

Real database verification used an isolated PostgreSQL **17.11** instance bound
only to `127.0.0.1:55437`, not the existing PostgreSQL installation or staging:

```text
TEST_DATABASE_ADMIN_URL=postgresql://s22_test_admin@127.0.0.1:55437/s22_local_recovery_test
node node_modules/tsx/dist/cli.mjs scripts/test/run-database-gate.ts database
TEST_DATABASE_URL=postgresql://s22_test_admin@127.0.0.1:55437/s22_local_recovery_test
node node_modules/vitest/vitest.mjs run tests/database/s4a-schema.test.ts -t '(Widget recovery|recovered|audit_events insertion fails|Instagram V2 evidence)' --maxWorkers=1
```

The first corrected schema/application run passed 471 tests. After adding three
downstream lease-consumer checks, another run passed 472/474; an existing rollback
test timed out and its still-running cleanup caused the following test to deadlock.
The isolated selection above passed all 16 cases, including those failures, the
three new consumers and an additional blocked-contact case (475 total registered
cases; 459 intentionally unselected). The four remaining queue suites used the
exported run-scoped gate lifecycle and passed 9 + 21 + 12 + 14 = **56 tests**.
This is not a claim that the full gate passed in one uninterrupted run.

Earlier validation attempts exhausted local disk space and stopped the disposable
server. A new cluster with bounded WAL completed the checks above. The machine
also reached approximately 217 MB free physical RAM during verification. Only
task-owned downloads, synthetic test data and temporary check scripts were removed;
the disposable server is stopped and existing database services are untouched.

The later clean full CI/database gate and separately approved migration/runtime
rollout are now verified in the linked receipt. Real browser recovery acceptance
remains outstanding. The old live chat without a previously saved ownership code
cannot be retroactively recovered.

## Implementation file inventory

The local change is limited to these 40 files. Existing edits in `README.md`,
`docs/architecture/s11-instagram-business.md` and `s22-public-notices.patch` are
not part of this implementation.

```text
apps/api/src/runtime.ts
apps/api/src/widget/composition.ts
apps/api/src/widget/plugin.ts
apps/api/tests/widget.test.ts
apps/web/src/lib/widget-embed.test.ts
apps/web/src/lib/widget-embed.ts
docs/architecture/s22-widget-cohort-binding.md
docs/architecture/s22-widget-recovery.md
packages/application/src/widget/authority.ts
packages/application/src/widget/index.ts
packages/application/src/widget/recovery.ts
packages/application/src/widget/use-cases.ts
packages/contracts/snapshots/public-contracts.v1.json
packages/contracts/src/widget/contracts.ts
packages/database/drizzle/0032_s22_widget_recovery.sql
packages/database/drizzle/meta/_journal.json
packages/database/drizzle/meta/0032_snapshot.json
packages/database/src/repositories/ai-journey-budget.ts
packages/database/src/repositories/ai-orchestration.ts
packages/database/src/repositories/customer-confirmation.ts
packages/database/src/repositories/sales-context.ts
packages/database/src/repositories/widget.ts
packages/database/src/schema/channels.ts
packages/security/src/widget/exchange.ts
scripts/contracts/catalog.ts
tests/contracts/contract-compatibility.test.ts
tests/database/ai-orchestration.test-suite.ts
tests/database/customer-confirmation.test-suite.ts
tests/database/instagram-business.test-suite.ts
tests/database/s22-widget-cohort.test-suite.ts
tests/database/s4a-schema.test.ts
tests/database/s8-dispatcher.test.ts
tests/database/s8-handler-reliability.test.ts
tests/database/s8-outbox-relay.test.ts
tests/database/s8-pgboss-infrastructure.test.ts
tests/database/widget-intake.test-suite.ts
tests/instagram/identity-contracts.test.ts
tests/instagram/migration.test.ts
tests/security/widget-security.test.ts
tests/workspace/staging-infrastructure.test.ts
```
