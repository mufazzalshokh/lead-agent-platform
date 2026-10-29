# S22 recovery and capacity evidence runbook

Use synthetic staging data only. Every exercise records start/end UTC timestamps, exact
Git/image/migration provenance, operator, approved ticket, observations, and cleanup.
Raw messages, credentials, database URLs, and unbounded customer/tenant identifiers do
not belong in evidence or telemetry.

## Isolated database restore

1. Record the active Cloud SQL instance, latest successful backup, target PITR time,
   and recovery-point age. Confirm backup/PITR encryption and operator IAM.
2. Restore/clone to a new uniquely named recovery instance. Never overwrite active
   staging and never expose a public IP.
3. Attach the recovery instance to the same isolated VPC with a temporary, dedicated
   recovery credential. Do not reuse application secrets in logs or Terraform state.
4. Run read-only validation for PostgreSQL 17, migration head
   `0032_s22_widget_recovery`, all 33 migrations,
   52 production tables, FORCE RLS/policy/role drift, and pg-boss ownership.
   Cross-check the exact packaged migration journal against the reviewed release
   and the backup/PITR point selected in step 1. An intentionally older recovery
   point requires its own matching reviewed release manifest, not the current head.
   Stop on a head/count mismatch; do not migrate the restored target to make the
   validation pass.
5. Validate representative synthetic Contacts, Leads, Conversations, Messages,
   AppointmentRequests, confirmation evidence, eligibility controls, audit and Outbox.
   Prove encrypted fields decrypt only with authorized recovery keys and Tenant A/B
   isolation still fails closed.
6. Record restore finish and application-validation finish. Calculate measured RPO from
   target/recovered data and measured RTO from restore start to validated service.
7. Delete the recovery workload and credential after evidence is preserved; retain no
   copied customer data. Resource deletion requires a separately reviewed plan.

PASS requires measured RPO `<= 5 minutes` and RTO `<= 60 minutes`. Otherwise report the
measurement and bottleneck; do not claim the target.

## Failure drills

- **Worker pause:** set the worker pool instance count to zero in a reviewed temporary
  plan, generate bounded synthetic work, observe backlog age/depth, restore one worker,
  and prove drain without a duplicate logical effect.
- **AI failures:** use controlled deterministic timeout/429/5xx/network/malformed-output
  fixtures. Prove no protected action, bounded retry, honest cost, safe fallback, and no
  infinite queue loop. Live paid failures are not manufactured unnecessarily.
- **Channel failures:** inject Telegram/Instagram/Widget transport failures at the
  existing adapter seam. State cannot report false success or false confirmation; retry
  and recovery must remain idempotent.
- **Database interruption:** only use a reversible connection interruption. Prove the
  transaction has no partial AppointmentRequest/confirmation, no tenant fallback, and
  bounded recovery. Do not corrupt data or disable RLS.

The [bounded database-failure/notification proposal](../../docs/architecture/s22-failure-notification-plan.md)
selects an existing authenticated dependency probe and records its security-metadata
writes, whole-staging outage scope, finite limits and independent recovery gates.
It is preparation only, not live authority or transaction-rollback evidence.
The offline [preflight validator](../../.github/scripts/s22-failure-preflight.mjs)
checks a supplied snapshot against the pinned deployment and fixed bounds. A passing
snapshot is not independent live-state verification or execution authority. The
offline reducer only simulates transitions; a live execution adapter, independent
watchdog and recovery confirmation still need implementation and separate review.

For the confirmed sole-operator constraint, follow the
[independent recovery proposal](../../docs/architecture/s22-solo-recovery-plan.md).
It specifies an isolated job/root and bounded ownership protocol, not a deployed
watchdog or an exception to the existing second-operator gate. Offline protocol
tests come next; provisioning, any restore canary, outage, session-metadata writes
and notification delivery each retain their explicit review/authority boundaries.

## Capacity profile

Capacity traffic uses a deterministic fake AI path and synthetic channel/provider seams;
it does not spend real Gemini quota. Run a separate small real-Gemini cohort under the
USD 5 target and USD 10 hard ceiling.

| Tier   |      Duration |      Active tenants |   Aggregate inbound | Staff sessions |
| ------ | ------------: | ------------------: | ------------------: | -------------: |
| Normal |        15 min |                  10 |   about 1 message/s |             10 |
| Burst  |         5 min |            up to 25 |  about 5 messages/s |             25 |
| Stress | bounded steps | increase from burst | increase from burst |        bounded |

Measure customer/platform TTFR distributions, request and business error rates, queue
depth/oldest age/drain time, database connections/CPU/locks, Cloud Run CPU/memory/
instances/cold starts, worker throughput/retries/DLQ, provider latency/errors/tokens/
cost, and per-tenant fairness. Customer-facing TTFR distinguishes acknowledgment from
the first meaningful response.

Stop increasing load at the first of: meaningful-response p99 over 60 seconds,
sustained error rate over 1%, operationally unsafe queue lag, database connections near
safe saturation, sustained CPU/memory saturation, or provider limits. Record the first
actual bottleneck and restore API/Web min instances to zero after the test window.

## Operational response

### API error-percentage alert

The API alert compares summed 5xx request rates with summed request rates for all
response codes, scoped to the staging project, region and API service. Both sides
use 60-second alignment and identical service/location grouping; revisions and
response-code labels are reduced away before division. The threshold is strictly
greater than 1% for 300 seconds. CPU and billing policies are separate and unchanged.
This follows [Google's ratio-condition requirements](https://docs.cloud.google.com/monitoring/alerts/policies-in-json#metric-ratio)
and the [locked Google provider's denominator aggregation contract](https://github.com/hashicorp/terraform-provider-google/blob/v7.46.1/website/docs/r/monitoring_alert_policy.html.markdown).

After a separately reviewed deployment, use bounded synthetic traffic to verify
that 2 errors among 1,000 requests (0.2%) do not satisfy the condition, whereas
2 among 100 (2%) do when sustained for the full retest window. Split traffic across
revisions to check the ratio of totals rather than an unweighted average. Zero or
missing total traffic is not evidence of a measured 0% error rate; this policy is
not an availability or metric-absence alert. Confirm actual notification receipt
and preserve content-free observations. Source tests and configured channels do
not prove live alert delivery. Budget notifications do not enforce a dollar cap.

### Monitoring-only saved-plan boundary

Use `staging-terraform.yml` with `action=plan` and `phase=monitoring-policy`.
This phase is not an application release or a permission to send test traffic.
The exact reviewed tooling commit must be the dispatched branch HEAD and pass
CI before planning. Preserve the existing immutable images and application
provenance: source `abc3071fb81777068f5adfb98f6144d9081077eb`, timestamp
`2026-10-11T20:27:12Z`, packaged/runtime/API head
`0032_s22_widget_recovery`, functional shared-core profile, and authoritative
`widget_booking` mode/envelope anchor. The anchor is not a fresh browser session
and does not renew an expired session or activate a budget.

The provider-schema guard checks the complete 88-resource plan and permits only
one in-place update to `google_monitoring_alert_policy.api_errors`: the reviewed
numerator/denominator and matching aggregations. Every other configurable value
must remain known and unchanged, including identities, networks, secret
references, runtime environment, database settings, recipients, CPU alert and
billing budget. Computed-only provider metadata is not configuration drift.
Targeted/partial inventories, configurable drift, unknowns, create/delete/replace
actions, additional reads and arbitrary baseline changes fail closed. Never
loosen the application rollout guard or use `-target` to force this plan through.

Preserve the successful plan run ID, exact source, saved-plan SHA256, seven-day
artifact expiry and finite monitoring receipt in a review packet. Applying
requires separate owner approval naming that exact plan, its approved checksum
and `S22-APPLY-APPROVED`. The workflow rechecks successful same-repository,
same-branch, exact-source plan provenance, artifact integrity and policy scope
before applying only the saved binary. A post-apply full read-only plan must
converge with zero changes and the corrected ratio. It must not record a new
application deployment. No migration, diagnostic job, IAM grant, secret payload
read, session replacement, provider call, restore or capacity drill is authorized.
If state advances or the artifact expires, stop; do not silently regenerate and
apply a replacement. Configuration convergence does not prove alert delivery.

### Read-only monitoring baseline

Before a separately approved alert/failure exercise, dispatch the existing
`staging-terraform.yml` with `action=plan`, `phase=monitoring-evidence`, and the
exact CI-passing branch HEAD as `commit_sha`. Leave apply authority fields empty.
Its isolated job cannot enter Terraform or execute database/customer/provider
work. It uses existing WIF permissions only; access denial must produce a finite
`BLOCKED` receipt, never an automatic IAM expansion.

The collector checks the deployed API ratio, enabled canonical notification
channel references, and two matching scoped metric aggregates. It makes at most
11 Monitoring GET requests (one policy list, up to eight channels, two metric
queries), with no redirects, retries, pagination or notification sends. Each
response is capped at 1 MiB and each request at 15 seconds. Output excludes
credentials, channel destinations, raw labels and customer content. The job has
a five-minute bound and retains only its allowlisted receipt for seven days.

The ten-minute metric window ends two minutes before observation because the
[Cloud Run metric catalog](https://docs.cloud.google.com/monitoring/api/metrics_gcp_p_z#run)
documents 60-second sampling and up to 120 seconds of visibility delay for
`run.googleapis.com/request_count`. Queries use the deployed policy's alignment,
reduction and grouping through the [time-series GET API](https://docs.cloud.google.com/monitoring/api/ref_v3/rest/v3/projects.timeSeries/list).
Absent numerator/denominator series remain unobserved; a zero denominator does
not yield a measured ratio. `BASELINE_COLLECTED` proves neither sustained
threshold evaluation nor actual notification delivery. Do not claim otherwise.
The existing `/health` handler returns static success; it is not a database
readiness probe or a controlled 5xx generator. Do not add a public fault endpoint
or assume probing `/health` during a database interruption proves this alert.

### Incident response

Use this small internal severity model:

- **SEV-1:** suspected tenant-data exposure, security compromise, or booking/state
  corruption. Stop affected automation, preserve evidence without message content,
  restrict access, and invoke the security/privacy incident owner immediately.
- **SEV-2:** staging service unavailable, database unavailable, or queue backlog that
  threatens the tested recovery objective. Freeze deployments, identify the last known
  good digest, and restore service or use the isolated database recovery procedure.
- **SEV-3:** one channel or the AI provider is degraded while deterministic safety and
  authoritative state remain intact. Keep the healthy paths available, activate the
  existing safe fallback/handoff behavior, and monitor retry/backlog limits.
- **SEV-4:** noncritical UX or reporting defect with no incorrect business state or
  sensitive-data exposure. Record and schedule a bounded repair.

Provider outage: confirm the dependency-specific error/latency metrics, prevent
unbounded retries, keep model output non-authoritative, and use the existing safe
handoff path. Do not silently switch the production model or reveal provider errors to
customers.

Telegram or Instagram outage: verify provider status and credentials without logging
their values, confirm the Outbox/queue records remain pending rather than falsely sent,
and observe bounded retries. After recovery, prove one logical outbound effect per
message. Do not mark customer confirmation from an unsuccessful delivery.

Queue backlog: inspect oldest-job age, ready/retry/dead-letter counts, worker health,
and database pressure. Pause synthetic ingress if a stop condition is reached. Resume
one worker and prove the backlog drains without duplicate business effects before
raising capacity.

High latency: split customer TTFR into ingress, application/database, queue, model, and
channel-provider segments. Check cold starts, database connections, oldest-job age,
provider p95/p99, and outbound submission latency. Scale only the measured bottleneck;
do not hide provider time behind acknowledgment metrics.

Secret rotation: add a new Secret Manager version through the owner-controlled path,
deploy/reload the intended workload, run a bounded synthetic smoke, then disable or
destroy the previous version only after rollback is no longer needed. Channel runtime
credentials use the writable `CredentialSecretStore`; signing/encryption key rotation
requires its separately approved compatibility path and must not destroy decryptability.

Customer incident triage: record UTC time, synthetic tenant or bounded tenant ID,
correlation/request IDs, deployment SHA/digests, migration head, affected surface, and
business-state impact. Never copy raw customer messages, credentials, provider payloads,
or unrestricted personal data into tickets. Determine tenant scope first, then classify
severity and choose rollback, retry, recovery, or code-fix response.
