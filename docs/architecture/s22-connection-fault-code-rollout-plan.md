# S22 default-off connection-fault code rollout

Status: **APPLIED; ZERO-CHANGE CONVERGENCE VERIFIED**.
The owner approved **apply plan 41228923359 only**. That exact saved binary was
consumed once; do not reapply it. The earlier build/plan authority and unchanged
spending limits were preserved. This rollout does not authorize an enabled
profile, fault requests, notifications, migrations, AI calls or IAM changes.

## Source and release boundary

Application source is fixed at `7a4201c824be3db2396b51c14d62e6758f43e860`.
[CI 41226090997](https://github.com/mufazzalshokh/lead-agent-platform/actions/runs/41226090997)
passed on that exact source, including the isolated PostgreSQL gate. Tooling
source `621047b3291e41362dd74266dc1e989f7c763aa9` passed full
[CI 41228163371](https://github.com/mufazzalshokh/lead-agent-platform/actions/runs/41228163371)
before either dispatch. Actual image/plan receipts are recorded below, not
inferred from fixtures or historical plans.

## Exact consumed packet — 1 November 2026

| Binding                                 | Verified value                                                                               |
| --------------------------------------- | -------------------------------------------------------------------------------------------- |
| Application source                      | `7a4201c824be3db2396b51c14d62e6758f43e860`                                                   |
| Tooling source                          | `621047b3291e41362dd74266dc1e989f7c763aa9`                                                   |
| Preserved branch                        | `verify/s22-staging-recovery-capacity`                                                       |
| Successful API-only build               | [41228545634](https://github.com/mufazzalshokh/lead-agent-platform/actions/runs/41228545634) |
| Immutable API SHA256                    | `624e2d17ca48394af37bd70ac305e9b3104712afe25c83b3f3e2449711e2e2b9`                           |
| Registry / architecture                 | `me-central1-docker.pkg.dev/lead-agent-stg-739284/lead-agent/api` / `linux/amd64`            |
| Successful saved-plan run               | [41228923359](https://github.com/mufazzalshokh/lead-agent-platform/actions/runs/41228923359) |
| Workflow/action/phase                   | `staging-terraform.yml` / `plan` / `connection-fault-code`                                   |
| Saved binary                            | `s22.tfplan`                                                                                 |
| Binary SHA256                           | `4ad4d987a961c05af28375f4721adcf469da84bbb43a7c500445291dbcbc1269`                           |
| Artifact                                | `s22-terraform-plan-connection-fault-code-621047b3291e41362dd74266dc1e989f7c763aa9`          |
| Artifact ID / expiry                    | `13052149758` / `2026-11-07T18:21:18Z` (7 November, 23:21:18 Asia/Tashkent)                  |
| Retained API provenance timestamp       | `2026-10-31T18:20:23Z`                                                                       |
| Migration / Terraform / Google provider | `0032_s22_widget_recovery` / `1.14.7` / locked `7.46.1`                                      |
| Full configuration review               | 88 managed resources; 1 in-place API update; 0 creates/deletes/replacements                  |

The full image reference is the registry above followed by `@sha256:` and its
verified digest. Build receipt/head, source, architecture, API-only scope and
immutable manifest match; Web/worker/migrator build-and-push steps were skipped.
The plan's authenticated repository, branch, workflow, source and successful
status match. Its independently downloaded binary matches the artifact checksum;
its full JSON passed the new guard against the actual locked provider schema.
The only changed address is `google_cloud_run_v2_service.api[0]`; the fault
profile and both explicit target-metadata variables remain absent.

The executed-step review found only request/source/build validation, OIDC,
Terraform initialization/state-preservation/validation/planning, the narrow guard
and artifact handling (17 successful setup/work/cleanup steps). All apply, DB
job, migration, diagnostic, customer/provider and unrelated evidence steps were
skipped. No application deployment, enabled profile, fault, notification, IAM
expansion or budget change occurred during preparation. The approved apply below
then changed only the API image/provenance; the other runtimes remain at baseline.
This plan is now consumed and must not be reapplied.

The legacy `api-image-update` guard is pinned to migration `0031`; it is not
relaxed or reused. The isolated `connection-fault-code` phase supports the
current `0032_s22_widget_recovery` head and authenticates the successful API-only
image workflow and its seven-field immutable manifest. Build source, scope,
architecture, run, registry and digest must match. Tooling and application
source are recorded separately. Use the existing branch, staging environment,
OIDC identity, workflow and locked Terraform/provider versions; add no grants.

Only `google_cloud_run_v2_service.api[0]` may update, in place. The allowlist is
its immutable container image, `git-sha` label and existing
`DEPLOYMENT_GIT_SHA`, `DEPLOYMENT_TIMESTAMP`, `DEPLOYMENT_IMAGE_DIGEST` values.
All other configurable values are compared through the locked provider schema,
including optional+computed fields. Reject configurable unknowns/drift, moved
addresses, creates, replacements, deletions, extra data reads, incomplete or
duplicate inventories. Both inventories must contain the same 88 managed
addresses. Computed-only revision/timestamp changes are not configuration changes.

The fault profile and both explicit target-metadata variables
`S22_CONNECTION_FAULT_PROFILE`, `GOOGLE_CLOUD_PROJECT`, `GOOGLE_CLOUD_REGION`
must be absent before and after. No profile/window/operator session is prepared
by this code rollout. Startup defaults to normal request handling; there is no
SQL stop/watchdog activation or self-arming background task.

## Preserved baseline

The baseline is the last accepted application deployment plus the already
applied monitoring ratio correction, not the rejected SQL-stop proposal.
Non-API application source remains `abc3071fb81777068f5adfb98f6144d9081077eb`,
timestamp `2026-10-11T20:27:12Z`, head `0032_s22_widget_recovery`. The image pins
are retained from the [consumed monitoring packet](s22-monitoring-rollout-plan.md).
API before-image must also match that baseline; an unexpected baseline stops
preparation rather than silently updating the guard to accept it.

Preserve Web, worker, migrator, all secrets/references, commands, private VPC,
identities, scaling/resources, zero migrator retries, SQL `ALWAYS`/shared-core
profile, alerts/recipient and budgets. Resolve `ai_journey_mode=preserve` from
authoritative state and require its unchanged reviewed mode/session binding in
the full plan. This is not a fresh session or paid-test authorization. Historical
unknown costs, reservations, retired usage and all acceptance gaps remain intact.

## Reviewed execution protocol — consumed, do not repeat

This protocol is retained as the audit trail for the completed rollout, not
authority to repeat its build, plan or apply.

1. Pass new guard/native/workspace regressions, formatting/lint and full CI on
   the exact tooling commit; preserve the owner's unrelated local edits.
2. Dispatch `staging-images.yml` once on that tooling branch with
   `commit_sha=7a4201c824be3db2396b51c14d62e6758f43e860`, `image_scope=api`.
   Retain its run ID. Inspect the authenticated successful run and immutable
   manifest; no Web/worker/migrator build-and-push steps may execute.
3. Dispatch `staging-terraform.yml` once, `action=plan`,
   `phase=connection-fault-code`, exact tooling SHA, actual image digest and
   UTC API timestamp. Preserve baseline runtime/migrator provenance and images,
   all three heads `0032`, `ai_journey_mode=preserve`, no new Widget binding,
   no approval token or apply fields. Authenticated workflow metadata must
   resolve exactly one successful build at that tooling SHA; its run and API-only
   manifest are independently checked. Missing/duplicate matches stop the run.
   No DB job or diagnostic executes. No extra workflow input is introduced.
4. Independently download/authenticate the exact saved artifact and recompute
   its binary SHA256. Review its JSON with the locked provider schema and new
   guard; inspect executed/skipped steps. Publish actual receipt values before
   requesting exact-plan apply authority. An unsuccessful/ambiguous dispatch
   retains its ID and stops; do not blindly rerun or manufacture a new plan.
5. Only after exact saved-plan approval, the apply must reauthenticate the
   build and plan runs, recompute the binary checksum against owner approval,
   re-run the full guard and apply that binary. Require fresh no-op convergence
   across 88 resources with the new API provenance and fault profile absent.
   A failed convergence is not a successful rollout. No automatic rollback or
   fault run follows; preserve evidence and prepare the narrow corrective plan.

Rollback candidate is the prior immutable API image/provenance above. Any
rollback needs a fresh reviewed plan and applicable approval; do not reapply
consumed plans or mutate SQL to resolve a code-only rollout problem.

Preparation caught an input-limit error before cloud execution: workflow-load
run `41227953661` rejected the initial 26-input definition. The extra input was
removed; the workflow retains 25 inputs and resolves exactly one build through
authenticated metadata instead. A regression fixes this boundary at 25, matching
[GitHub's documented limit](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#onworkflow_dispatchinputs).
No build or Terraform execution occurred in that failed validation run.

## Acceptance accounting

The default-off code deployment prerequisite is closed by the approved apply and
verified convergence below. This does not establish live socket-cut recovery,
actual alert delivery, whole-instance SQL failure, transaction rollback,
worker/channel failure and queue drain, PITR/RPO/RTO, capacity, customer booking
completion, or S22 acceptance. The [replacement design](s22-connection-fault-plan.md)
and [remaining evidence register](s22-acceptance-evidence.md) keep those gates
separate. **S22 remains unaccepted; S23 is not started.**

## Local verification

```text
node --test .github/scripts/s22-connection-fault-code-plan-check.test.mjs .github/scripts/s22-monitoring-plan-check.test.mjs .github/scripts/s22-full-runtime-config-check.test.mjs .github/scripts/s22-recovery-rollout.test.mjs
# 104/104 passed: 52 new code-rollout cases and 52 existing regressions
node node_modules/vitest/vitest.mjs run tests/workspace/staging-infrastructure.test.ts tests/workspace/staging-acceptance-inventory.test.ts tests/workspace/staging-monitoring-boundary.test.ts tests/workspace/staging-connection-fault-code-boundary.test.ts --maxWorkers=1 --reporter=dot
# 20/20 passed; after input-limit correction, both native CI wrappers passed again
node node_modules/eslint/bin/eslint.js .github/scripts/s22-connection-fault-code-plan-check.mjs .github/scripts/s22-connection-fault-code-plan-check.test.mjs tests/workspace/staging-connection-fault-code-boundary.test.ts --max-warnings=0
# exit 0
bash -n .github/scripts/s22-connection-fault-code-plan-check.sh
# exit 0 (Git Bash; no WSL/Docker startup)
node scripts/check-boundaries.mjs
# 336 source files passed
```

Scoped Prettier and whitespace checks passed. An ignored local, in-memory
fixture derived from the historical retained plan also passed the new guard
against the actual locked Google provider schema: 88 configurations / one API
update. This checks provider-format compatibility, **not current live state**.
No new dependency, migration or business/tenant authorization code is introduced.
The owner's README, Instagram documentation and public-notices patch remain
excluded. Full tooling CI passed **4,296 tests**, including **549 real PostgreSQL
tests**; seven opt-in tests in two ordinary-test files were skipped. Formatting,
lint, types, contracts, boundaries and application/package builds passed.

Independent receipt review command:

```text
node .cache/s22-connection-fault-code/release.mjs review 41228923359
# PASS: authenticated build and plan, exact binary SHA256, actual provider schema,
# 88 configurations / 1 API update, profile absent, executed/skipped steps reviewed
```

The review helper and downloaded artifacts are ignored local evidence, not
committed production tooling. Raw plan/state, credentials and artifact bodies
are not added to Git.

## Approved apply and independent verification — 1 November 2026

[Apply 41277068065](https://github.com/mufazzalshokh/lead-agent-platform/actions/runs/41277068065)
completed successfully at `2026-11-01T05:30:02Z` (10:30:02 Asia/Tashkent).
Dispatch head was documentation receipt `06d086e`; the actual checked-out tooling
was the CI-verified `621047b`. Their workflow and guard files were independently
confirmed identical before dispatch. No new image or rollout plan was created.

Fresh authenticated plan/build/artifact checks and provider-schema review passed
before dispatch. The independently recomputed binary SHA256 matched the exact
owner-approved checksum above; the workflow repeated provenance, integrity and
full configuration guards before applying that binary. No newer deployment
execution was present before this one-shot dispatch.

Terraform recorded exactly **0 added / 1 changed / 0 destroyed**, with one API
modification completion. The fresh post-apply no-op plan and full provider-schema
guard verified **88 managed configurations / zero changes**, including exact new
API image/source/timestamp/head and the absent fault profile/target metadata.
All non-API resources and configuration, including SQL, identities, private VPC,
secret references, worker binding, monitoring and budgets, remain preserved.

The authenticated run/step/log/artifact review passed **22 successful steps**;
all four unrelated evidence jobs and all migration/DB diagnostic/customer/AI
execution steps were skipped. Apply evidence artifact:
`s22-connection-fault-code-apply-evidence-41277068065`, ID `13071399846`, expires
`2026-11-08T05:29:57Z` (8 November, 10:29:57 Asia/Tashkent). It records 88 verified
configurations, zero changes, verification mode, profile absent and database
execution disabled. No outage, fault, notification, replay, session replacement,
provider-test call or budget expansion ran.

```text
node .cache/s22-connection-fault-code/apply-approved.mjs
# Fresh exact-plan/build/checksum/schema/authority preflight PASS; one dispatch
node .cache/s22-connection-fault-code/verify-approved-apply.mjs
# PASS: authenticated apply/steps/logs/artifact, 0/1/0, 88 configurations / zero changes
```

Only this packet and the acceptance evidence register change in the apply
receipt milestone; no application, guard, workflow, migration or test is changed.
Existing source/tooling CI remains the code verification. Scoped receipt
formatting/whitespace and final diff checks passed for its documentation
handoff. Owner edits remain excluded.

Next safe step: offline-implement the guards/controller from the
[exercise specification](s22-connection-fault-exercise-plan.md), without real
bindings or activation. Historical readers pinned to the old API image must fail
closed; the policy-scoped monitoring reader can be reused unchanged. Follow the
[completion checklist](s22-completion-checklist.md); do not loosen historical
guards or relabel default-off deployment as live recovery evidence.
**S22 remains unaccepted; S23 is not started.**
