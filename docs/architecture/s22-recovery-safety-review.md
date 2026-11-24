# S22 recovery safety review — 2026-10-30

Decision: **NO-GO for provisioning or live execution of the current SQL-stop/watchdog proposal.**
The Step 1 review is concluded; its required safety guarantees are not established.
This is not S22 acceptance and does not authorize a replacement implementation.

Owner decision received on 30 October: **prepare the self-expiring connection-fault
design only**. The [replacement design](s22-connection-fault-plan.md) records that
bounded preparation. The SQL-stop NO-GO remains; implementation and live actions
are still unauthorized.

On 31 October the owner authorized continuation into offline implementation of
that replacement and tests only. This does not authorize its build/deployment,
live use or provisioning the rejected SQL-stop/watchdog design.

## Scope and evidence

Reviewed the independent-recovery proposal, its pure contract/simulator/tests,
the SQL response normalizers, API/session database composition, the recovery
runbook and checked-in WIF/deployer configuration. External references below
are official Google documentation reviewed on 30 October 2026. No live IAM,
instance, operation, credential or customer-session inspection was performed.

The 71-test suite establishes offline behavior. It does not establish an actual
writer's identity, Google control-plane fencing or live recovery availability.
Existing accepted product/channel evidence remains closed; no UI expansion,
paid retry, expired-session recovery or budget change follows from this review.

## Finding 1: receipt fields are not writer authentication

The simulator checks `actor`, execution, image and manifest fields supplied by
fixtures. The request constructor restricts namespaces but is not an IAM boundary.
Google supports object-prefix conditions with uniform bucket-level access, but
an additional conditional allow binding does not subtract broader grants.
See [Storage conditions](https://docs.cloud.google.com/storage/docs/access-control/iam#conditions)
and [conditional versus unconditional grants](https://docs.cloud.google.com/iam/docs/allow-policies).

The checked-in deployer has SQL/Run administration, service-account administration
and project-IAM administration. Reusing it as the primary runtime does not create
the proposed restricted writer boundary. Its actual inherited authority was not
inspected. The owner/deployer is a trusted administrative actor, not an identity
the exercise can claim to constrain merely by adding a narrower role.

A viable revision needs a credential-isolated primary runtime with reviewed
effective permissions, no watchdog-prefix writes, no route to impersonate or
reconfigure the watchdog, and separate reviewed deployment/emergency authority.
The current repository-wide principal binding is pool-scoped; adding another
provider in that pool is not, by itself, proof of isolation from the deployer.
Actual WIF mappings, inherited grants and negative permission checks must be
reviewed. Do not assume the proposed ten-resource inventory remains sufficient.

## Finding 2: the current SQL requests are not fenced

The inert patch descriptors contain activation policy only. They do not bind a
`settingsVersion`; the instance normalizer also omits that value. The published
[Settings contract](https://docs.cloud.google.com/sql/docs/postgres/admin-api/rest/v1/instances#Settings)
describes version-based concurrency handling, and [API errors](https://docs.cloud.google.com/sql/docs/postgres/admin-api-error-messages)
include stale-data and operation-in-progress failures. Neither establishes that
the existing versionless descriptors implement the required ordering guarantee.

The reviewed [patch contract](https://docs.cloud.google.com/sql/docs/postgres/admin-api/rest/v1/instances/patch)
describes a partial configuration update returning an asynchronous operation.
It does not establish client-timeout cancellation or the proposed no-op
`ALWAYS -> ALWAYS` fence. The review did not establish those guarantees elsewhere
in the official references examined. This is a missing safety proof, not a claim
that every possible version-aware design is impossible.

The following is a safety counterexample to the inference, **not an observed
Cloud SQL execution or an assertion about undocumented implementation details**:

| Order | Observation available to the exercise       | Unresolved possibility                                               |
| ----- | ------------------------------------------- | -------------------------------------------------------------------- |
| 1     | Baseline says `ALWAYS`; stop is dispatched  | Request has left the primary                                         |
| 2     | Stop response is lost                       | Rejection, completion and delayed acceptance cannot be distinguished |
| 3     | An instance read still says `ALWAYS`        | This does not settle the outstanding request                         |
| 4     | Recovery is declared without a proven fence | A late stop has not been ruled out                                   |

The simulator correctly ends this path as `INCIDENT`, retains the claims and
issues no automatic restore. That is safe refusal to assert success, **not proof
that an already accepted stop will be recovered independently**. Another passing
mock test cannot supply the absent provider guarantee.

The [operation-list contract](https://docs.cloud.google.com/sql/docs/postgres/admin-api/rest/v1/operations/list)
is paginated and ordered by start time. A truncated 16-item page cannot certify
the absence of all relevant operations, and timestamps alone cannot identify the
lost mutation. The [cancel API](https://docs.cloud.google.com/sql/docs/postgres/admin-api/rest/v1/operations/cancel)
requires an operation identifier; applicability to this stop and late-request
fencing were not established. Cancellation is not a substitute to assume here.

## Required direction before Step 2

Do not provision the watchdog, expand IAM, add a workflow trust path, build its
image or run a canary to discover whether this unsafe path happens to work.
Keep the current human-console gate and all offline live-denial markers intact.

Recommended next decision: **approve preparation only of a self-expiring,
staging-only application-side database-connection interruption design**. This
would change the fault mechanism, not silently mark the SQL-stop proposal PASS.
The existing runbook permits a reversible connection interruption; it does not
require stopping the Cloud SQL instance. A new design must still be reviewed.

That preparation must specify an immutable bounded expiry, default-off and
production rejection, safe behavior across process restarts and clock skew,
operator/browser loss, a pre-start abort path, existing-pool handling, admission
and recovery observation, and removal of temporary configuration. No public fault
endpoint, arbitrary destination, credential export or fabricated HTTP500 proof
is acceptable. Code inspection found composition seams, not an implemented fault
hook; a thrown mock database error is not live connection-interruption evidence.

This candidate would not prove a whole-instance outage, transaction rollback,
worker drain or PITR by implication. Preserve those distinct acceptance gates
and agree the revised evidence mapping before implementation. No deployment,
outage or notification approval is requested or implied by preparation.

Alternative: retain the SQL-stop mechanism, obtain a supported late-stop
reconciliation/fencing contract, and revise the primary-identity/WIF/resource
boundary before implementation. Provider clarification or a changed mechanism
requires an explicit decision; repeating current readiness checks cannot resolve it.

## Verification and handoff

No runtime, test, infrastructure or workflow code changed in this review.
The unchanged combined native suite passed **71/71**, using the command in the
[offline checkpoint](s22-solo-recovery-plan.md#offline-protocol-checkpoint--2026-10-30).
No new regression is claimed to prove cloud behavior. Source checks confirmed
the missing version binding and the incident-only unknown-stop handling.
Documentation formatting and staged whitespace checks passed. Exact formatting
commands are:

```text
node node_modules/prettier/bin/prettier.cjs --check --ignore-path .gitignore docs/architecture/s22-recovery-safety-review.md docs/architecture/s22-solo-recovery-plan.md
node node_modules/prettier/bin/prettier.cjs --check infra/runbooks/recovery-capacity.md
git diff --cached --check
```

The historical unformatted evidence register is not reformatted wholesale.
Unrelated owner edits are excluded. Full CI status belongs to the resulting
commit's actual run, not an earlier source's successful check.

**Next safe step after replacement implementation verification: prepare its
[default-off rollout packet](s22-connection-fault-plan.md). S22 remains unaccepted;
S23 is not started.**
