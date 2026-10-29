# S22 independent recovery for a sole operator

Status: **PREPARED DESIGN — NOT IMPLEMENTED, DEPLOYED OR LIVE-AUTHORIZED**.
This proposal addresses the sole-operator constraint recorded on 2026-10-24.
It is not a saved Terraform rollout plan and does not replace the current
human-recovery gate. S22 remains unaccepted.

## Decision and unchanged boundaries

Propose one independently running Cloud Run job as the recovery controller.
The owner remains the primary operator and emergency incident contact, not a
fictional second operator. A second browser tab, another GitHub step or a
`finally` handler in the fault runner is not the independent recovery path.

Keep the existing target and limits from the
[failure exercise](s22-failure-notification-plan.md): project
`lead-agent-stg-739284`, region `me-central1`, instance
`lead-agent-staging-postgres17`, one `ALWAYS -> NEVER -> ALWAYS` exercise,
44 browser probes, 48 operation GETs, and zero AI/provider attempts.
No outage, notification, session-metadata write, resource provisioning or IAM
change is authorized by preparing this document. Historical plan approvals
cannot be reused.

The primary runner owns at most one stop submission and the browser probe.
The independent job owns the only automatic restore submission. The primary
runner must not race it with its own restore handler. The job has no dependency
on the primary runner, browser, application database, worker or migrator.
Cloud SQL control-plane availability is still required; this is not a guarantee
against simultaneous failure of every recovery component.

## Proposed deployment boundary

Use a separate Terraform root, proposed as
`infra/deploy/gcp/s22-recovery-watchdog`, and the existing authenticated backend
bucket with prefix `lead-agent-platform/s22-recovery-watchdog`. Do not import or
move the staging state, add resources to its 88-resource inventory, use `-target`,
or loosen `.github/scripts/s22-monitoring-plan-check.mjs`.

The proposed minimum inventory is ten new managed resources in that root:

| Address                                             | Purpose                                       |
| --------------------------------------------------- | --------------------------------------------- |
| `google_service_account.watchdog`                   | Dedicated recovery runtime identity           |
| `google_project_iam_custom_role.sql_read`           | Exact required control-plane reads            |
| `google_project_iam_custom_role.sql_update`         | Instance-update permission only               |
| `google_project_iam_member.sql_read`                | Read role binding for the runtime             |
| `google_project_iam_member.sql_update`              | Time-limited, exact-instance update binding   |
| `google_storage_bucket.control`                     | Private exercise claims and receipts          |
| `google_storage_bucket_iam_member.control_read`     | Read control records                          |
| `google_storage_bucket_iam_member.control_create`   | Create records without overwrite/delete       |
| `google_service_account_iam_member.deployer_act_as` | Reviewed deployer attachment to this identity |
| `google_cloud_run_v2_job.watchdog`                  | Independent, one-task execution               |

Proposed names are `lead-agent-staging-recovery` for the service account,
`lead-agent-staging-recovery-watchdog` for the job, and
`lead-agent-stg-739284-s22-recovery` for the bucket. These names are proposals;
availability and the actual saved-plan inventory remain unverified. A collision
or extra resource invalidates the proposed scope; do not silently rename or
expand it.

Pin one non-root image digest built from the repository's pinned Node base,
without the application build, database libraries or runtime secrets. A future
explicit `watchdog` image scope may be added to `staging-images.yml`; existing
`all` must continue to mean the four application images. No image build or push
is part of this preparation.

The job configuration must pin one task, parallelism one, zero retries,
1 vCPU, 512 MiB, and a 1,200-second task timeout. Reject execution overrides,
foreign identities/images/arguments and unreviewed environment variables.
There is no SQL connector, Direct VPC attachment, database login, secret mount,
public endpoint or recurring scheduler. The job uses Google control-plane HTTPS,
not a connection to the private SQL database.

Task timeout is a per-attempt ceiling, not a restore timer or availability
guarantee; see [Cloud Run task timeouts](https://docs.cloud.google.com/run/docs/configuring/task-timeout).
The attached identity must obtain a token with enough remaining lifetime before
arming. Never log tokens or depend on the owner's browser credential.

## IAM and provisioning prerequisites

The checked-in bootstrap trusts only `staging-images.yml` and
`staging-terraform.yml`, and grants the deployer broad `roles/cloudsql.admin`.
It does not establish the proposed dedicated runtime or authorize a new workflow.
The checked-in deployer grants also do not establish bucket-creation or
custom-role-creation permission. Do not assume a successful old deployment
proves those capabilities.

Initial provisioning therefore requires a separately reviewed, owner-controlled
bootstrap path with verified current permissions. If an added workflow phase
cannot plan/apply this isolated root using existing authority, prepare the exact
bootstrap permission amendment separately. Never grant Storage Admin, Role Admin
or another broad role opportunistically. The ten-resource proposal is not an
assertion that today's deployment principal can create it.

The runtime's proposed SQL read role contains `cloudsql.instances.get` and
`cloudsql.instances.list`, covering the required instance/operation reads.
Read permission can expose control-plane metadata beyond one instance; every
request and projection must still be pinned to the exact target, with no
pagination or raw metadata in receipts. Google's
[permission mapping](https://docs.cloud.google.com/sql/docs/postgres/iam-permissions)
documents the operation permissions; do not invent `cloudsql.operations.*`.

The update role contains only `cloudsql.instances.update`. Its additive IAM
member binding must restrict the resource service/name to the exact instance
and expire at a reviewed absolute UTC time, long enough for the entire approved
recovery window. See [Cloud SQL IAM Conditions](https://docs.cloud.google.com/sql/docs/postgres/iam-conditions).
Do not replace the project's entire IAM policy.

**IAM cannot make this permission activation-policy-only or restore-only.**
The image's validated request constructor must permit only the pinned `ALWAYS`
recovery body. The underlying update capability can change other instance
settings if that code/identity is compromised; retain this residual risk in
the IAM review. No instance deletion, restore-from-backup, user/database access,
secret access or IAM administration belongs to the runtime.

The control bucket must deny public access and use uniform access control,
`force_destroy = false` and destruction protection. Runtime grants permit
reading and creating records, not replacing or deleting them. The primary's
record-writing authority must also be reviewed. Do not grant the runtime access
to Terraform state or reuse the state's bucket for control objects.

The primary must not be able to manufacture a watchdog-origin acknowledgement.
Review per-writer object-prefix conditions and the actual inherited grants,
not just record names. A broadly privileged owner/deployer is not isolated by
adding a narrower allow binding. If origin verification requires another
identity or binding, revise the inventory and review it before provisioning;
do not call a ten-resource plan sufficient by assumption. Writer-origin proof
is a release gate for arming, not an implemented guarantee in this proposal.

## Ownership and arming protocol

Use one immutable exercise ID and a reviewed manifest bound to the exact source,
image/job configuration, target, authority expiry and request budgets. Records
contain no cookies, tokens, bodies, headers, email addresses or business data.
Each record is at most 4 KiB. Read exact object names/generations, not bucket
listings or caller-selected URLs.

Create claims with `ifGenerationMatch=0`; an existing live claim must prevent a
second claimant. A lost create response is reconciled by reading the exact
record, not by issuing an unguarded replacement. This uses
[Cloud Storage generation preconditions](https://docs.cloud.google.com/storage/docs/request-preconditions).
Do not delete claims while authority is live or reuse an old exercise ID.

1. The primary verifies the unchanged baseline and four healthy browser probes.
   It creates the manifest and its one stop-ownership claim.
2. Launch the independent job once, without overrides. A launch timeout is not
   authority to launch a duplicate. Preserve and reconcile the execution ID.
3. The job validates its live identity/configuration, manifest generation,
   target, token lifetime, counter reserves and deadlines. It durably claims
   sole automatic restore ownership, then writes `armed` with the execution
   identity and manifest hash. A duplicate claimant exits without a SQL mutation.
4. Before submitting the stop, the primary verifies the actual Google execution
   resource and a matching fresh `armed` record. A submitted boolean or a receipt
   from an exited/wrong execution does not suffice. The acknowledgement must be
   at most 60 seconds old; stop dispatch must follow its verification within
   15 seconds. If those admission bounds cannot be met, do not stop.
5. The primary submits the stop once, records its exact returned operation ID
   when known, and publishes numbered heartbeats on 15-second slots. An abort
   requests recovery; it does not grant the primary a second restore issuer.
6. After arming, the job retains the recovery target, timer and authority in
   memory. Loss of Cloud Storage cannot become a prerequisite to initiating
   recovery. It reacts to abort, two missed heartbeat slots, primary loss or
   the earlier recovery deadline. It preserves a known operation ID and never
   replays an ambiguous SQL patch.

There is one stop owner and one restore owner, not distributed exactly-once
delivery. A job crash after its durable claim cannot be hidden by allowing a
second automatic claimant. It is an incident requiring owner reconciliation.
The owner must retain an independently accessible emergency console for this
case; no second human is assumed.

## Deadlines, ambiguity and finite traffic

Keep the original eight-minute restore-initiation bound from accepted stop.
The proposed job additionally measures a conservative bound from its own arm
time, so it does not depend on receiving the primary's stop timestamp. End fault
observation by arm + 420 seconds at the latest, reserving 60 seconds for bounded
control reads, the restore submission and scheduling margin. Abort earlier on
any invalid observation. A slow stop shortens the six-minute observation; record
the alert proof as inconclusive instead of extending the outage.

Only exact `PENDING`/`RUNNING` operation states are incomplete; only `DONE`
can terminate the corresponding operation. Distinguish operation completion,
instance activation policy, and successful application probes. A running-state
label alone does not prove SQL availability.

An uncertain stop must not be declared absent merely because one instance read
says `ALWAYS`, nor may timestamps alone identify a lost operation. A delayed
stop could otherwise arrive after a premature recovery declaration. Before live
eligibility, the implementation review must establish safe handling of that
late/abandoned request, pending operations and conflicting settings versions.
Do not assume that an `ALWAYS -> ALWAYS` patch provides a fencing guarantee.
Any provider behavior not established by contract/evidence is a blocking gate,
not a guessed retry policy. If safe reconciliation is unavailable, preserve the
claim and declare an incident; do not claim automatic recovery or start a new
exercise. The owner's emergency path remains necessary.

Proposed execution ceilings, counting failed/ambiguous attempts too:

| Operation                      | Ceiling                                                               |
| ------------------------------ | --------------------------------------------------------------------- |
| Browser session GETs           | 44 total: 4 baseline + 24 fault + 16 recovery                         |
| SQL patches                    | One stop; at most one automatic restore                               |
| Operation GETs                 | 48 total: 8 stop + 40 restore; job owns the shared counter            |
| Instance GETs                  | 8 total: one primary baseline + seven job reads                       |
| Exact-instance operation LISTs | 4 total; one bounded page each, no continuation                       |
| Cloud Storage GETs             | 128 total; 64 per actor                                               |
| Cloud Storage creates          | 48 total, including claims, receipts, abort and at most 32 heartbeats |
| Job launch                     | One, with at most 40 launch-operation/execution status GETs           |
| Runtime metadata               | Two requests for identity/token establishment before arming           |
| HTTP deadline                  | 15 seconds per call; redirects/retries forbidden                      |
| Recovery observation           | At most 600 seconds; two consecutive healthy probes required          |
| AI/provider attempts           | Zero                                                                  |

These additional control/inspection ceilings are a proposed amendment, not
traffic secretly included in the old 48-read allowance. Implementation must
reserve recovery reads before spending diagnostic reads and fail admission if
the remaining budgets cannot support recovery. Tokens, raw API errors and
unbounded lists must not enter receipts. Keep the original two bounded
monitoring-evidence reads and matching incident/inbox acknowledgement limits.

## Implementation and release sequence

1. Implement only the offline independent-job protocol, explicit authority
   envelope, request constructors and fault-injection tests. Use injected clocks
   and transports. Keep current human-console preflight behavior and unknown
   automation rejection unchanged until a separately reviewed strategy exists.
2. Tests must cover forged/stale arming, wrong target/image/identity, cancelled
   primary, missing/failed heartbeats, storage loss after arming, duplicate job
   launches, claim ambiguity, late/unknown stop requests, pending/foreign control
   operations, simultaneous abort/deadline, depleted budgets and expired grants.
   Verify one restore issuer, no blind mutation replay and receipt redaction.
   Scheduling tests must include nonzero HTTP latency, not just results exactly
   on scheduled timestamps. Current simulation PASS is not a live timer proof.
   An offline reproduction on 2026-10-29 found equal next-read start and response
   deadlines in the reducer. The subsequent scoped correction gives each read
   its own response window, clips it to the absolute phase deadline and refuses
   to schedule a read when no phase time remains. Six regressions cover stop
   and restore latency, late responses and absolute bounds. This corrects an
   offline model, not a deployed outage or the unimplemented recovery protocol.
3. Implement the isolated root and strict plan/image guards only after protocol
   review. Verify the complete resource inventory, existing provisioning
   permissions and every added IAM capability. Build only the dedicated image;
   do not rebuild or redeploy the four application images as a side effect.
4. Produce a fresh, checksummed saved-plan packet with source/CI/image provenance,
   finite UTC authority, exact bootstrap prerequisites and cost quote. Obtain
   approval for that concrete provisioning plan before any cloud write.
5. Separately prove the deployed job's independence and least-privilege transport.
   Read-only validation cannot prove that a real restore mutation works. Any
   restore-only, non-outage control-plane canary needs its own exact authority,
   one-request bounds and receipts; it is not an extra mutation hidden in the
   failure drill. If safe canary isolation is unavailable, remain NO-GO.
6. Only after those proofs, complete the browser-local bridge, fresh baseline,
   maintenance/quiet-window and IAM checks. Obtain exact authority for the one
   outage, the operator-session metadata writes and the actual notification.
   Do not reopen expired customer chats or repeat paid booking messages here.
7. After a separately approved exercise, verify SQL/application recovery, unchanged
   application provenance and both Terraform roots' convergence. Expired grants
   and no repeating job are required. Any deletion/cleanup plan is separate.

The maximum configured runtime is 1,200 vCPU-seconds and 600 GiB-seconds per
1 vCPU/512 MiB task, plus bounded requests, build/image storage, control objects
and logs. Duplicate task launches can incur startup cost even when a claim
prevents mutations. These are resource ceilings, not a dollar cap or guaranteed
Cloud SQL RTO. The saved-plan review must attach a current `me-central1` quote
using [Cloud Run pricing](https://cloud.google.com/run/pricing), applicable
Storage/Artifact Registry charges and the unchanged SQL storage/backup exposure.
Do not assume free-tier credit, increase the AI budget, or create a scheduler.

## Remaining acceptance

This proposal does not satisfy outage recovery or actual notification delivery.
It also does not close the Widget/Telegram booking and recovery journeys,
transaction rollback/queue-drain/duplicate-effect proof, isolated PITR RPO/RTO,
capacity, below-threshold alert case or multi-revision ratio evidence. Their
statuses remain in the [S22 register](s22-acceptance-evidence.md).

Next safe implementation task: the offline independent-job protocol and its
fault-injection suite, with the late-stop ambiguity gate explicit. No live
adapter, IAM rollout or SQL stop is authorized by this design.
