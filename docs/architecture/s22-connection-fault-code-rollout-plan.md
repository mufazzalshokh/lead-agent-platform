# S22 default-off connection-fault code rollout

Status: preparation in progress, **not deployment or live-exercise approval**.
The owner approved one API-only image build and one saved Terraform plan, after
the new guard passes CI, under unchanged spending limits. Do not apply a plan
until the owner approves its exact run/checksum. Do not enable a profile or run
requests, notifications, migrations, AI calls or IAM changes under this approval.

## Source and release boundary

Application source is fixed at `7a4201c824be3db2396b51c14d62e6758f43e860`.
[CI 41226090997](https://github.com/mufazzalshokh/lead-agent-platform/actions/runs/41226090997)
passed on that exact source, including the isolated PostgreSQL gate. The new
tooling source requires its own passing CI before dispatch. API image digest,
build run, tooling SHA, saved-plan run/checksum and artifact expiry are pending
actual execution receipts; they must not be inferred from fixtures or old plans.

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

## Execution sequence and stop rules

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
5. Only after exact saved-plan approval, a future apply must reauthenticate the
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

This packet can close only the default-off code deployment prerequisite once
actually applied and verified. It cannot establish live socket-cut recovery,
actual alert delivery, whole-instance SQL failure, transaction rollback,
worker/channel failure and queue drain, PITR/RPO/RTO, capacity, customer booking
completion, or S22 acceptance. The [replacement design](s22-connection-fault-plan.md)
and [remaining evidence register](s22-acceptance-evidence.md) keep those gates
separate. **S22 remains unaccepted; S23 is not started.**
