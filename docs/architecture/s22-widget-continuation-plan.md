# S22 — exact same-chat date continuation preparation

## Authority and current boundary

The owner approved preparation of one amendment: three customer messages in
the already-selected replacement chat, with the three-physical-attempt limit
and all monetary caps unchanged. On 12 October the owner separately authorized
**apply plan 38172305694 only**. That exact saved binary was consumed once by
successful apply **38245351724**; its runtime postflight **38245540893** passed.
Do not apply it again. This authority does not authorize recovery, Send, replay,
another replacement, a migration or a database diagnostic execution.

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
After the verified rollout, separately authorized owner redemption can resume
this same session/conversation. The protocol uses an empty, unbound frame
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
The local Docker daemon is not available, so their evidence comes from the
completed remote database gate, not a simulated local PostgreSQL run.

Source `abc3071fb81777068f5adfb98f6144d9081077eb` is committed/pushed and
[full CI 38171326929](https://github.com/mufazzalshokh/lead-agent-platform/actions/runs/38171326929)
passed `pnpm ci:verify`: **4,224 passed** (3,678 ordinary and **546 actual
PostgreSQL**), seven opt-in live tests skipped, format/lint/types, boundaries,
canonical contracts and production builds. This includes all four new database
cases. Separately, `node --test .github/scripts/s22-full-runtime-config-check.test.mjs`
passed **11/11** runtime-plan guard regressions. Passing CI is not live booking
acceptance or Send authority.

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
The old metadata reader's source/image/window pins cannot establish post-rollout
readiness. The `s22-widget-progress.mjs --continuation` reader pins
this plan's exact source, timestamp, Worker and Migrator images. Before apply,
the old deployed runtime had to fail that preflight. Deployment verification
does not authorize executing this database observer. After separately authorized
collection, its new observation window is at most
120 minutes, bounded by the observed fixed recovery-family deadline. The
original issuance window and exact persisted conversation remain independently
required; the existing 121-minute maximum, tenant/owner/role guards, metadata-only
SQL, row sentinels and no-retry protections are preserved. This is an observer,
not a paid-send readiness check. It does not recover, select or authorize Send.

Fifteen native regressions were added for the later window, wrong profiles,
other identities, issuance tampering, deadline/length bounds and invalid clocks.
The following complete applicable native group passed **432/432**:

```powershell
$continuationTests = @(rg --files .github/scripts -g 's22-widget-*.test.mjs' -g '!s22-widget-session-select-postgres.test.mjs')
node --test @continuationTests .github/scripts/s22-full-runtime-config-check.test.mjs
```

An initial broader native glob included the unchanged standalone selector
PostgreSQL script and failed because its local disposable DB configuration is
unavailable; it is explicitly excluded here, not reported as passing. Actual
runtime PostgreSQL coverage is the successful 546-test remote gate above. New
read-only tooling also passed scoped ESLint, Prettier and diff checks.

## Exact saved rollout packet — preparation record

[Image build 38171816097](https://github.com/mufazzalshokh/lead-agent-platform/actions/runs/38171816097)
passed for exact source `abc3071fb81777068f5adfb98f6144d9081077eb`. Four
digest-pinned OCI images were pulled and checked as `linux/amd64`, with source
provenance and SBOM enabled. Image-manifest SHA256:
`c7aebf80fbeadf6352a59310ccc0979bba41b1480ab9bb10a89a7d807efffd4a`.

[Saved plan 38172305694](https://github.com/mufazzalshokh/lead-agent-platform/actions/runs/38172305694)
completed successfully. Artifact ID **11714626122**, expiration
`2026-10-18T20:28:29Z`; saved binary SHA256:
`f1f3bf00d5bb67cd552de85b3be3fc68c356dbfa06985dcee4db40cd51569e22`.
The downloaded binary and its separately downloaded checksum match. Later
documentation/tooling HEADs are not substitute runtime source pins.

Workflow and independent downloaded-plan inspection passed **88/88 managed
configurations**, using Terraform **1.14.7** and locked Google provider **7.46.1**.
Before-images/source/timestamp/head match the retained successful `1a910f0`
manifest and deployment. After-images and provenance match these exact inputs:

```json
{
  "action": "plan",
  "phase": "full",
  "commit_sha": "abc3071fb81777068f5adfb98f6144d9081077eb",
  "runtime_git_commit_sha": "abc3071fb81777068f5adfb98f6144d9081077eb",
  "deployment_timestamp": "2026-10-11T20:27:12Z",
  "migration_head": "0032_s22_widget_recovery",
  "runtime_migration_head": "0032_s22_widget_recovery",
  "api_migration_head": "0032_s22_widget_recovery",
  "api_image": "me-central1-docker.pkg.dev/lead-agent-stg-739284/lead-agent/api@sha256:f89024dc7406a307c597a7d90ca57c616e2730cb73699733c2f7378216c4941f",
  "web_image": "me-central1-docker.pkg.dev/lead-agent-stg-739284/lead-agent/web@sha256:4a57a0d4d80caa0eab3c0efb824aa1f97e33bb7f9d163b31fac129561e8f6dfe",
  "worker_image": "me-central1-docker.pkg.dev/lead-agent-stg-739284/lead-agent/worker@sha256:b6d550af4f2c071f00b7ae8388dddd7d8ef7efc3be8923aebd5c168140f75c5a",
  "migrator_image": "me-central1-docker.pkg.dev/lead-agent-stg-739284/lead-agent/migrator@sha256:223f1cb22f12a082c147c001d12690c491ca01cf63aa265afeaaa62bd7b69ce5",
  "ai_journey_mode": "preserve",
  "ai_journey_widget_session_id": "01a11c48-dbc2-76de-a873-f41664da5ccb"
}
```

Actions are **0 creates / 4 in-place updates / 0 destroys / 0 replacements**:
API, Web, Worker and Migrator definition only. Every other managed resource is
no-op. IAM, identities, secret references, private VPC/egress, ingress, SQL,
CPU/memory/scaling, commands, task count, parallelism and explicit zero Migrator
retries remain unchanged. Worker mode and stable envelope anchor are identical
before/after; owner-selected session identity is not a Terraform change. There
are no configurable unknowns or unreviewed configuration changes. Refresh drift
is limited to provider-classified computed-only Artifact Registry `update_time`
and Migrator execution-count/latest-execution fields; it is not a new execution.

Receipt inspection passed **15 successful preparation steps**, **126 skipped
steps** and all three evidence jobs skipped. Apply, migration, validator,
diagnostic/database jobs and bootstrap/IAM changes did not run. Independent
review command: `node .cache/s22-widget-continuation-rollout/review.mjs --review 38172305694`
— **PASS**. The helper and raw downloaded plan remain ignored local review
artifacts, not committed credentials/state or a substitute for the saved binary.

The owner subsequently authorized **apply plan 38172305694 only**. The fresh
checksum and before-state comparison, one-time apply and postflight are recorded
below. Do not reapply, substitute another plan, run a migration or execute a
database job. Later customer recovery/clarification/confirmation remain separate
authority boundaries.

## 12 October 2026 — exact approved apply and verification

No deviation from the reviewed scope was found. Before apply, the artifact was
downloaded again; its SHA256 remained
`f1f3bf00d5bb67cd552de85b3be3fc68c356dbfa06985dcee4db40cd51569e22`.
Backend-free inspection with the locked provider again passed all **88 managed
configurations**, with exactly four in-place updates. The fresh read-only
[before-state run 38245129813](https://github.com/mufazzalshokh/lead-agent-platform/actions/runs/38245129813)
passed **16/16** assertions against the old `1a910f0` image/source/timestamp pins
and zero Terraform configuration drift. Its evidence artifact is **11745410713**;
SHA256 `890dd070d735db7afdd615d3f891a6b55e7d56f6d41ff8ccc6401620da11ff94`.
The convergence check did not create a replacement saved rollout plan.

[Apply 38245351724](https://github.com/mufazzalshokh/lead-agent-platform/actions/runs/38245351724)
completed successfully: **0 added / 4 changed / 0 destroyed**. Independent
receipt inspection matched one completion for each API, Web, Worker and Migrator
definition, the saved checksum and all 88 configuration checks. The exact-plan
approval guard and deployment-provenance recording succeeded. Replanning,
migration, validator, diagnostic, bootstrap and all three evidence jobs were
skipped. No IAM, session binding, cost ledger or financial cap was changed.
The dispatched workflow HEAD was `d58b12d8a0d32b05eb1fd622eba37db4c5619e84`;
the deployed image source remains the reviewed **`abc3071`**, not that later
documentation/tooling HEAD. Both
[source CI 38171326929](https://github.com/mufazzalshokh/lead-agent-platform/actions/runs/38171326929)
and [tooling CI 38172809848](https://github.com/mufazzalshokh/lead-agent-platform/actions/runs/38172809848)
were independently rechecked as successful before dispatch.

[Runtime postflight 38245540893](https://github.com/mufazzalshokh/lead-agent-platform/actions/runs/38245540893)
passed **16/16** assertions: exact approved API/Web digests, source, timestamp,
migration head, private VPC, runtime identity and 15 secret references, ready
revisions and zero Terraform configuration drift. Ready revisions are
`lead-agent-staging-api-00036-n86` and `lead-agent-staging-web-00032-8lc`.
Its artifact is **11746025034**; evidence SHA256
`e5dc2f6cd36ccdac3f3412578bf2bf19cdea869b36885269140ec7aee2f24f46`.
No application database job or customer/provider-test call was executed.

[Read-only inventory 38245680630](https://github.com/mufazzalshokh/lead-agent-platform/actions/runs/38245680630)
passed **12/12** assertions at `2026-10-12T11:55:00.048Z`: API/Web HTTP 200,
Worker ready, private PostgreSQL 17/shared-core configuration, backups/PITR and
configured alert policies. Artifact **11746305091**; evidence SHA256
`e4b69ffc927493a1a1a2c3889d9c5e35744932dff4fb5f70a4497927b10337e1`.
Secret payload reads and infrastructure mutations are false. Restore and
capacity proof remain explicitly false; inventory is not S22 acceptance.

The applicable native regression command above was rerun with
`--test-reporter=dot`: **432 passed, exit 0**. Only rollout-receipt documentation
is changed after deployment; runtime code remains identical to source CI.
Owner changes to `README.md`, `docs/architecture/s11-instagram-business.md` and
`s22-public-notices.patch` are preserved and excluded from the receipt commit.

The next safe task is separately authorized **same-chat recovery plus read-only
readiness/allowance collection**, with no Send. The observed family deadline
remains **12 October, 22:49:03 Asia/Tashkent**, not renewed by deployment. No
recovery proof may be pasted or screenshotted. A failed/expired proof stops this
continuation; it does not authorize another replacement. The clarification,
staff offer and customer-confirmed booking are still unproven.

No database migration, new dependency, public contract change, IAM expansion,
provider call or UI change is part of this amendment. **S22 remains unaccepted.**
