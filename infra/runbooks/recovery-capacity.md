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
