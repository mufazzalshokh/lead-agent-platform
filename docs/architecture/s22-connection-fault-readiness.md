# S22 C2 connection-fault readiness packet

Checkpoint: **4 November 2026 — BLOCKED; NO LIVE AUTHORITY**.
This is a read-only preparation result, not a saved Terraform plan, deployment
approval or fault-exercise receipt. All eight S22 acceptance groups remain open.

## Scope and fixed references

This packet follows the [exercise specification](s22-connection-fault-exercise-plan.md)
and [current checklist](s22-completion-checklist.md). It records repository/Actions
metadata and source inspection only. It does not collect a staff session, choose
real profile values, test write permissions by mutation, or inspect secret values.

Verified code/tooling source: `4d478071703567b585c6dc861bfc889142b8d68f` on
`verify/s22-staging-recovery-capacity`. Subsequent documentation commits are not
substitutes for this code receipt; the adapter still requires successful CI for
the exact future dispatched HEAD. No source is frozen for a live run yet.

The retained [deployed baseline](s22-connection-fault-code-rollout-plan.md#approved-apply-and-independent-verification--1-november-2026)
is the 1 November default-off apply `41277068065`, consuming plan `41228923359`
once. API source is `7a4201c824be3db2396b51c14d62e6758f43e860`; the other
runtimes remain `abc3071fb81777068f5adfb98f6144d9081077eb`. The receipt covers
88 managed configurations and head `0032_s22_widget_recovery`. This packet makes
no fresh Google Cloud state/health/convergence claim. Do not reuse consumed plans.

## Verified preparation results

| Prerequisite                           | Result                  | Exact scope / limitation                                                                                                                                                                                                            |
| -------------------------------------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Exact-source engineering CI            | PASS                    | [Run 41861413597](https://github.com/mufazzalshokh/lead-agent-platform/actions/runs/41861413597) is completed/success for `4d47807`; every step passed.                                                                             |
| CI verification scope                  | PASS                    | `pnpm ci:verify`: 3,748 ordinary tests plus 549 actual PostgreSQL tests, 4,297 total; seven opt-in tests skipped. Offline Terraform validation and the nine-run Google-mock checker also passed. No live fault or notification ran. |
| Repository identity and visibility     | BLOCKED                 | Authenticated metadata for `mufazzalshokh/lead-agent-platform` reports `private=false`, `archived=false`. The profile adapter requires the exact repository and `private===true`.                                                   |
| Reported repository role               | OBSERVED                | API reports admin/maintain/push/pull access. This is not permission to change visibility, a subscription, IAM or secret settings, nor a proof that private-environment features are available.                                      |
| Staging environment metadata           | OBSERVED                | Existing environment is `staging`; the complete branch-policy listing allows `main` and `verify/s22-staging-recovery-capacity`. Only metadata was read; no protection, reviewer or branch rule was changed.                         |
| Private profile delivery setting       | ABSENT                  | Secret-name listing did not contain `S22_CONNECTION_FAULT_PROFILE`. No secret payload was read or created. This does not establish the current Cloud Run environment.                                                               |
| Activation cleanup pointer             | ABSENT                  | Variable-name listing did not contain `S22_CONNECTION_FAULT_ACTIVATION_RUN_ID`. No variable value was printed or changed.                                                                                                           |
| Retained API image manifest            | AVAILABLE METADATA ONLY | Build `41228545634`, artifact `13053086367`, `s22-image-manifest-7a4201c824be3db2396b51c14d62e6758f43e860-41228545634`, reports unexpired until `2026-11-07T18:19:34Z`. No artifact was downloaded by this packet.                  |
| Private-environment plan compatibility | UNKNOWN                 | Authenticated account metadata did not return a plan name. Public-environment access must not be generalized to private-environment support.                                                                                        |
| Browser-controller delivery            | NOT PREPARED            | Existing controller/profile ESM modules are inert and tested, but no reviewed browser bundle/entrypoint was delivered. Do not import the unserved repository URL or rebuild an application image automatically.                     |
| Operator, browser and quiet window     | NOT CONFIRMED           | Historical owner control of the alert recipient is retained; current availability, valid staff context, clock and quiet window have not been established. No customer Widget recovery proof is used for this staff probe.           |
| Live binding/configuration/traffic     | NOT PERFORMED           | No setup GET, profile/digest/window, plan dispatch, apply, connection cut, notification or monitoring-reader execution.                                                                                                             |

Name-absence checks used complete paginated listings: one environment secret and
13 environment variables, with no profile secret or activation pointer. Only
counts/target-name presence were printed, never variable values or other secret
names. The two deployment-branch policy entries were checked separately.

## Blocking cause, not a failed live execution

The source check in `.github/scripts/s22-connection-fault-profile-workflow.mjs`
sets `failureStage="private_repository"` and requires
`repository.full_name === env.GITHUB_REPOSITORY && repository.private === true`
before proceeding to provenance/artifact checks and the later cloud-authenticated
steps. Current repository metadata does not satisfy that prerequisite. This was
found without constructing a profile or dispatching the workflow; there is no
new failed cloud execution to retry.

Passing ordinary CI proves the code checks, not that deployment-environment
prerequisites match the guard. Do not remove the private-repository condition,
substitute fixture metadata, or create a real profile to force this path forward.
The intended profile is private correlation configuration, and saved Terraform
plans/state retain sensitive values despite output redaction. GitHub documents
that public repository Actions history/logs are publicly visible; this finding
does not establish that a credential or a profile was exposed.

## Required owner/design decision

Repository visibility and paid feature changes are outside this preparation's
authority. Two possible paths require an explicit decision:

1. **Private-repository path:** first confirm that the existing account plan
   supports the required private staging environment secrets/variables and branch
   policies. Review the effects on existing repository features/access, then obtain
   explicit authority for the exact visibility change. No upgrade, purchase or
   billing change is implied. Do not promise this is a free one-click fix.
2. **Public-source path:** if source must remain public, prepare a separately
   reviewed private execution/evidence boundary. This is a design change, not
   permission to drop the check or move secrets into public artifacts. It may
   affect workflow provenance, identity trust and storage; create no new repository,
   WIF/IAM grant, workflow or artifact channel under this packet.

GitHub's official [environment feature availability](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments)
states that private environment secrets require an eligible plan; public access
on GitHub Free does not establish private support. Its
[visibility-change guidance](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/managing-repository-settings/setting-repository-visibility)
also identifies consequences for existing features and public forks. Current plan
eligibility is unknown here; no account tier, price or upgrade is assumed.

## Resumption gate — no expiring setup before this is resolved

After the owner/design decision is implemented under its applicable authority:

1. Verify repository/execution privacy, environment compatibility, private delivery
   read/write authority and retained build provenance without exposing values.
   If the retained manifest expires, stop for a provenance decision, not a blind
   rebuild or reuse of an old saved plan.
2. Prepare and offline-test the reviewed browser delivery artifact before selecting
   a real session or UTC window. Preserve the existing fixed path, same-origin
   credentials, no storage/logging, finite deadlines and no automatic invocation.
3. Require completed successful CI for the exact dispatch source, then confirm
   current operator/browser/clock availability, no-dispatch state and cleanup
   ownership. No claim of freshness follows from the historical deployment receipt.
4. Obtain authority covering the single setup GET/security-metadata writes, private
   profile/configuration preparation and its fixed window before any binding.
   Activation still needs its own exact saved-plan/checksum approval and live scope.

The later exercise remains capped at **44 staff GETs total**: one setup plus at
most 4 baseline, 23 fault and 16 recovery slots, with one request in flight and no
retry/catch-up/rearm. Monitoring remains at most two bounded readers plus one
recipient observation. Actual transport recovery and notification delivery are
graded separately; missing evidence does not authorize extra traffic or a test
email. Preserve the fixed expiry, finite stop rules, authenticated activation
receipt and separately reviewed removal/convergence path from the specification.

This packet does not close C2, authorize Send, increase a budget, reconcile
historical NULL costs or replace C1/C3–C8 evidence. No changes to runtime, cloud
resources, IAM, repository visibility, subscription, secrets, variables, sessions,
customer messages or migrations were performed.
