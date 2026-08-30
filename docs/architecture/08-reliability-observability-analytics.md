# Reliability, Observability, Analytics, and Cost

## Purpose and operating principles

This document defines how the V1 modular monolith behaves when processes, providers, networks, and inputs fail. PostgreSQL is the system of record. Delivery across process or provider boundaries is **at least once**; correctness comes from durable acceptance, idempotent handlers, deterministic state transitions, and reconciliation. The design never claims distributed exactly-once delivery.

The following invariants apply to every channel and tenant:

- A webhook is acknowledged only after its receipt is durably recorded, or after a previously recorded duplicate is recognized.
- A duplicate inbound event cannot create a second message, lead, appointment request, handoff, or outbound side effect.
- Business state and the intent to perform an external side effect are committed atomically.
- External side effects are never performed inside a database transaction.
- Work may be retried, delayed, or reordered without bypassing current-state and authorization checks.
- One tenant's failure, traffic spike, or budget exhaustion must not corrupt or expose another tenant's state.
- If AI is unavailable or unsafe, the system preserves the inbound message and moves to an approved fallback or human handoff; it never fabricates a successful answer.
- `appointment_request.confirmed` means the customer has explicitly confirmed after staff acceptance. Confirmation evidence source is `customer_session`, `telegram`, or an authorized `staff_attested_external` record whose method is `phone` or `in_person`; durable notification alone is not customer confirmation.

## Reliability model

### Failure domains

| Boundary | Expected failures | Required behavior |
| --- | --- | --- |
| Browser/API client | retries, abandoned connections, repeated clicks, stale state | Idempotency key on retriable commands, optimistic version/state checks, stable typed error response |
| Channel webhook | duplicate, replayed, delayed, reordered, forged, malformed | Verify signature and freshness, resolve tenant from trusted connection, persist receipt once, return a non-revealing status |
| API or worker process | crash before/after commit, deployment interruption | Atomic transaction, outbox, lease expiry, safe retry |
| PostgreSQL | transient connection failure, failover, deadlock, capacity exhaustion | Bounded retry for transaction-safe errors, readiness failure, backpressure, alerting; never retry arbitrary commands blindly |
| AI provider | timeout, rate limit, invalid schema, refusal, content-safety failure, outage | Bounded model/validation retry, circuit breaker, deterministic safe template and handoff |
| Messaging/notification provider | timeout, ambiguous result, rate limit, outage | Stable idempotency reference where supported, status reconciliation, exponential backoff, dead-letter review |
| Application defect or poison event | repeatable handler failure | Stop after a bounded number of attempts, preserve diagnostic metadata, dead-letter and alert |

### End-to-end inbound lifecycle

```mermaid
sequenceDiagram
    participant P as Channel provider
    participant A as API intake
    participant DB as PostgreSQL
    participant W as Worker
    participant AI as AI adapter
    participant O as Outbound provider

    P->>A: signed webhook(event_id)
    A->>A: bound body, verify signature/freshness
    A->>DB: transaction: receipt + normalized envelope + dispatch intent
    alt first valid delivery
        DB-->>A: committed
        A-->>P: 2xx accepted
    else duplicate
        DB-->>A: existing receipt
        A-->>P: 2xx duplicate accepted
    end
    W->>DB: claim event; serialize conversation
    W->>DB: load tenant-scoped state and knowledge
    W->>AI: schema-constrained decision
    AI-->>W: structured decision
    W->>W: validate schema and deterministic policy
    W->>DB: transaction: state + domain events + outbox
    W->>DB: mark inbound processing complete
    W->>DB: claim outbound outbox item
    W->>O: send using stable delivery key
    O-->>W: provider result
    W->>DB: record attempt/result
```

The intake path performs only bounded validation and durable acceptance. Slow AI and outbound calls occur in workers. A valid duplicate receives success so that the provider stops retrying; an invalid signature does not receive a success response merely to suppress retries.

### Transaction boundaries

1. **Webhook acceptance transaction:** insert `webhook_receipts`, normalized inbound message/envelope, and an outbox event that requests processing. A unique constraint wins duplicate races.
2. **Domain command transaction:** lock or version-check the conversation/aggregate, re-read current state, apply one deterministic command, append transition/domain records, and insert outbox events.
3. **Outbox claim transaction:** claim a bounded batch using leases/row locking. Network calls happen after commit.
4. **Delivery result transaction:** record the attempt and terminal/transient result. On success mark the outbox item delivered; on transient failure schedule the next attempt; on permanent exhaustion mark it dead-lettered.
5. **Analytics projection transaction:** consume a stable domain event and insert one versioned analytics fact using a uniqueness constraint. Analytics failure never rolls back the original business action.

No transaction remains open while calling OpenAI, Telegram, email/SMS, or another remote service. Domain transactions are intentionally short. PostgreSQL deadlocks and serialization failures may be retried only by a wrapper that re-executes the entire idempotent transaction with a small, bounded attempt count and jitter.

### Inbox, idempotency, and duplicate protection

Idempotency is enforced at several layers because any one layer can fail:

| Operation | Stable identity / uniqueness scope | Duplicate result |
| --- | --- | --- |
| Provider webhook receipt | `(channel_connection_id, provider_event_id)` | Return the previously accepted outcome; do not enqueue again |
| Provider inbound message | `(channel_connection_id, provider_message_id)` | Return existing canonical `message_id` |
| Widget message | `(widget_session_id, client_message_id)` with an opaque server-issued session | Return existing canonical `message_id` |
| Private API mutation | `(organization_id, actor_id, route_or_command, idempotency_key)` plus request fingerprint | Replay stored outcome; reject key reuse with a different fingerprint |
| Domain transition | Aggregate ID, current state/version, and command identity | No-op/replay the known transition or return typed domain `InvalidTransition`, mapped to the contract's resource-specific code such as `appointment_transition_invalid` |
| Outbox effect | `outbox_event.id` as internal delivery key; provider idempotency key where available | Record one logical effect even if transport was attempted more than once |
| Analytics fact | `(organization_id, source_event_id, event_type, schema_version)` | Ignore duplicate projection |
| Notification | Logical recipient, notification kind, subject ID, and subject version | Do not create the same logical notification twice |

An idempotency record stores a hash of the canonical request, status, resource reference, and bounded response metadata—not secrets or raw message content. Keys are high-entropy opaque values. Retention must exceed the maximum supported client/provider retry window and is finalized by the privacy policy.

### Ordering and concurrency

The system assumes webhooks can arrive out of order. `provider_occurred_at` is untrusted display/context metadata; `received_at` is the canonical ingestion timestamp. Provider sequence numbers are retained when authenticated but are not assumed to exist.

- Work is serialized per conversation using a transaction-scoped lock or optimistic aggregate version. It is not globally serialized.
- Every worker re-loads current tenant-scoped state before applying a decision. A decision made against a stale version is discarded and re-evaluated, not force-applied.
- A late message is always retained. If applying it would regress a terminal state, it is marked late and surfaced for staff review rather than replaying invalid transitions.
- Independent conversations can run concurrently. Commands affecting the same appointment request use its version/state guard.
- `staff_accepted` advances to `awaiting_customer_confirmation` only after the customer-confirmation request is durably queued. Only a valid customer action advances it to `confirmed`.
- A staff rejection/cancellation racing with AI output wins according to the state machine. The stale AI action fails policy validation.

### Transactional outbox and jobs

`outbox_events` is the durable record of side-effect intent. It contains IDs and minimal typed payloads or references, never access tokens and preferably no raw customer text. Required fields include event ID, organization ID, aggregate reference, event type/schema version, trace context, availability time, attempt count, state, and timestamps.

`pg-boss` is the initial PostgreSQL-backed job mechanism. The outbox remains explicit rather than relying on an implicit enqueue-after-commit convention:

1. A business transaction inserts an outbox row.
2. A dispatcher claims pending rows fairly and publishes/executes the corresponding job.
3. A handler performs an idempotent effect and records an attempt.
4. Success marks delivery. Retryable failure schedules another attempt. Exhaustion dead-letters the row/job.

The dispatcher and handler may collapse into one worker implementation in V1, but the durable states and separation of responsibilities remain. A periodic sweeper recovers expired leases. A reconciliation job compares stuck domain states, outbox states, and provider receipts.

Global due-work claiming is the only cross-tenant worker operation and uses a dedicated least-privilege claim function/role that returns minimal outbox references. Before reading or mutating tenant business data, the handler opens a fresh transaction, establishes the stored `organization_id` as transaction-local RLS context, and verifies every referenced record belongs to it. A mismatched/missing scope is quarantined and security-alerted, never retried as ordinary provider failure.

Queue names and handler concurrency are separated by workload class (`inbound`, `ai`, `outbound_message`, `staff_notification`, `analytics`, `maintenance`) so a slow AI provider cannot starve confirmations or security work. Tenant-aware concurrency/rate limits prevent a noisy tenant from consuming all workers.

### Retry policy

Retries are based on typed failure classification, not on a blanket catch:

- **Transient:** connection reset, provider `429`, most `5xx`, lease loss before effect, or a documented database retry condition. Retry with exponential backoff and full jitter, honoring a bounded `Retry-After`.
- **Ambiguous delivery:** timeout after a request may have reached a provider. Query/reconcile by the stable external reference when possible before retrying.
- **Permanent:** schema violation after the one allowed repair attempt, invalid destination, revoked integration, forbidden response, unsupported action, invalid state, or authentication failure. Do not repeatedly retry; open an operational/handoff path as applicable.
- **Unknown:** initially retry only when the operation is demonstrably idempotent, then dead-letter and alert.

Attempt counts, maximum age, and delays are configuration, validated at startup. Initial operational profiles must be load-tested rather than treated as product promises. Recommended envelopes are:

| Work | Initial envelope | Exhaustion behavior |
| --- | --- | --- |
| AI transient call | At most two transient retry attempts within the conversation deadline; invalid/incomplete output permits at most one repair/retry; nested retry layers share the same budget | Safe localized fallback, request/reuse handoff, record failed `ai_run` |
| Outbound lead response | Exponential jitter over a bounded provider-specific window | Mark undelivered, notify staff/dashboard, dead-letter |
| Booking/customer confirmation | Higher-priority retries and reconciliation until its configured expiry | Never infer confirmation; alert staff and expose delivery state |
| Analytics projection | Long retry window because it is not user-blocking | Dead-letter and rebuild from source events |
| Maintenance/reconciliation | Bounded retry; next scheduled run can recover | Alert on repeated failure |

Retries preserve the original correlation, tenant, and idempotency identities while creating a new attempt ID. The application owns one end-to-end attempt counter; provider SDK, adapter, and job retry layers may not each multiply attempts. For AI, transient timeout/`429`/`5xx` failures permit at most two retry attempts, invalid/incomplete structured output permits at most one repair/retry, and a stale aggregate conflict permits one reload/recompute. Exhaustion uses the safe fallback path.

### Dead-letter handling

A dead-letter record is a state, not a place where work disappears. It records the source ID, tenant ID, handler/version, safe error code, first/last failure time, attempt count, and next operator action. Raw payloads are referenced through access-controlled records rather than copied into logs or queue metadata.

- Critical dead letters (customer confirmations, staff notifications, webhook intake processing) alert immediately according to severity.
- Operators can inspect, resolve, discard with reason, or replay through a protected command.
- Replay re-runs current authorization, schema, policy, and state checks; it does not bypass them.
- Every replay/discard is audited with actor and reason.
- Poison events can be quarantined by handler/schema version while unrelated tenant work continues.
- Dead-letter age, count, and oldest-item gauges are deployment gates and operational alerts.

### Timeouts, backpressure, and circuit breakers

Every remote call has explicit connect and total deadlines shorter than its job lease. Request handlers have an overall deadline and propagate cancellation. Provider SDK defaults are not accepted implicitly. Timeout values remain environment configuration and must be validated against measured latency and channel webhook deadlines.

Circuit breakers are maintained per provider/operation and, where appropriate, per tenant connection. They open on a rolling threshold of transient failures, transition to limited half-open probes, and close after successful probes. Authentication/revocation errors disable only the affected connection and require human repair; they do not open a global provider breaker.

When capacity is constrained:

- API intake accepts only what can be durably queued and returns `429`/`503` with retry guidance before exhausting database resources.
- Workers use bounded concurrency, database connection pools, and queue-depth limits.
- Priority order is security/confirmation work, inbound persistence, human handoff, ordinary replies, then analytics/maintenance.
- Non-critical analytics may lag, but accepted customer messages and booking state are never silently dropped.
- Tenant quotas and fair scheduling limit noisy-neighbor effects.

### Graceful degradation matrix

| Failure | Customer behavior | Staff/operations behavior | Forbidden behavior |
| --- | --- | --- | --- |
| AI unavailable/invalid | Reviewed localized template says assistance is delayed and offers/creates handoff | Conversation becomes `awaiting_staff` when policy permits; alert on rate | Pretend the request was answered or advance qualification/booking from guessed data |
| Knowledge missing | State that the fact needs staff confirmation; handoff as policy requires | Show missing knowledge category | Generate plausible price/service/hour/medical answer |
| Outbound channel down | Persist intended response; retry | Show delivery status and backlog; alert | Mark message delivered without provider evidence |
| Staff notification down | Booking remains requested; retry notification | Dashboard remains authoritative and highlights unnotified item | Treat staff as having accepted |
| Customer confirmation delivery down | Remain `staff_accepted` until durable request is queued, then `awaiting_customer_confirmation`; retry | Alert before expiry | Mark confirmed |
| Analytics unavailable | Continue transaction and enqueue/retry analytics | Mark projection lag | Block the lead flow or alter source events |
| Database unavailable | Fail readiness and reject new work safely | Alert and fail over/restore per runbook | Accept data only in process memory |

## Observability

### Telemetry architecture

The applications emit OpenTelemetry-compatible traces, metrics, and structured logs. Telemetry is exported using OTLP to a deployment-selected backend; domain code depends only on small observability ports and does not import a vendor SDK. `apps/api`, `apps/worker`, and `apps/web` use the same semantic conventions and release identifier.

Correlation context includes:

- `request_id` for an HTTP execution;
- `trace_id` and `span_id` across HTTP, outbox, and job boundaries;
- `organization_id` in access-controlled logs/traces, never as an unbounded metrics label;
- `channel_connection_id`, `conversation_id`, `message_id`, and `appointment_request_id` when relevant;
- `job_id`, `outbox_event_id`, and attempt ID for asynchronous work;
- `ai_run_id`, prompt version, schema version, provider, and approved model identifier for AI work.

External correlation headers are accepted only through a validated allowlist; the system creates its own request ID. Trace context stored with an outbox event is linked, rather than assuming one indefinitely long span.

### Structured, PII-safe logging

Logs are JSON with UTC timestamp, severity, service, environment, release, event name, safe error code, correlation fields, and duration/result where applicable. Logging uses an allowlist, not post-hoc redaction alone.

Never log by default:

- message bodies, prompts, model output, knowledge document text, phone/email, names, health-related text, cookies, authorization headers, webhook secrets/signatures, integration tokens, session IDs, or idempotency keys;
- complete request/response bodies;
- raw database statements with bound values;
- high-cardinality stack/context in metrics.

PII needed for a time-bounded investigation is accessed from the authoritative application through audited, role-restricted tooling. Hashing is not anonymization; a stable keyed pseudonym may be used only for a documented diagnostic purpose and with key rotation/retention controls. Error objects are normalized before logging so third-party bodies cannot leak secrets or customer text.

Log access is least-privilege, production access is audited, retention is environment/policy-specific, and production logs do not flow to local developer tooling.

### Tracing

Minimum spans include webhook verification/intake, authentication/authorization, tenant-scoped repository operations (without SQL values), aggregate command, outbox dispatch, job execution, AI call and validation/policy phases, channel send, and analytics projection. Sampling keeps all errors, security events, and a controlled sample of success traffic. Tail/head sampling must never be used as the only audit record.

Trace attributes use IDs and enums, not customer text. Provider trace IDs may be stored as safe references. The AI span separates provider latency from schema validation and policy execution so slow inference is not confused with application processing.

### Metrics and service-level indicators

Operational metrics use bounded labels such as environment, service, route template, channel type, language, outcome/error class, provider, model alias, and job type. `organization_id`, user IDs, conversation IDs, raw URLs, and error messages are prohibited metric labels.

| Area | Required metrics / SLIs |
| --- | --- |
| API/webhooks | request count, accepted/rejected/duplicate receipts, latency histogram, body/signature/rate-limit failures |
| Queue/outbox | ready count, oldest age, processing latency, attempts, lease recovery, throughput, dead-letter count |
| Database | pool utilization/wait, query latency by named operation, transaction rollback/deadlock, storage/replica/backup health |
| Channels | send latency, accepted/delivered/failed where provider supports it, connection authorization failures |
| AI | calls, latency, timeout/rate-limit/provider error, schema-invalid/repair, policy rejection, fallback/handoff, input/output/cached/reasoning tokens when reported |
| Domain | invalid transitions, stale-decision rejection, handoff age, booking confirmation expiry |
| Deployment | release, instance readiness, restart/crash, saturation, error budget consumption |

Stage 0 establishes these planning targets, which must be validated and approved or replaced before production:

- staff read/inbound endpoint availability: 99.9% monthly excluding announced maintenance;
- valid webhook receipt to durable acknowledgement: p95 <= 500 ms;
- valid widget message to durable acceptance: p95 <= 750 ms;
- accepted inbound to outbound send attempt while AI/channel are healthy: p50 <= 4 seconds and p95 <= 10 seconds;
- indexed staff list/detail reads: p95 <= 500 ms and p99 <= 1 second; mutations excluding external delivery: p95 <= 800 ms;
- 99% of provider-bound outbox items with a non-failing provider reach terminal delivered state within 60 seconds;
- database recovery planning targets: RPO <= 5 minutes and RTO <= 60 minutes.

Alert windows and error-budget policies remain operational decisions. Dashboards must show both rates and absolute volume so a quiet outage is not hidden by percentages, and must separate provider failure/exclusion conditions from application failure without hiding customer impact.

### Alerting and runbooks

Alerts are symptom-based and actionable. Every paging alert names a runbook, owner role, severity, affected environment, and safe first diagnostics. Initial alert candidates are:

- valid webhook intake failures or sustained response-latency/error-budget burn;
- oldest high-priority outbox/job age above the confirmation response objective;
- any growing critical dead-letter backlog;
- AI fallback or policy-rejection rate materially above its evaluated baseline;
- channel authentication revoked or signature verification anomalies;
- database saturation, failover, replication/PITR/backup failure;
- cross-tenant security test/runtime authorization invariant failure;
- analytics projection lag that threatens reporting freshness;
- cost velocity beyond tenant/platform guardrails.

Expected customer input errors do not page. Alert grouping prevents a provider-wide outage from paging once per tenant. Security alerts route separately from availability alerts.

## AI and cost telemetry

Each `ai_run` records, without default prompt/response content: organization/conversation references, provider and approved model identifier, prompt/template version, decision schema version, start/end/duration, provider request reference, outcome/error class, validation/repair count, proposed action, policy result, handoff/fallback result, and provider-reported token categories. Token count and estimated provider cost coverage must be >= 99% of AI runs; missing provider usage is explicitly `unknown` and alerts on coverage loss. If content capture is ever enabled for evaluation, it requires explicit purpose, access, consent/legal basis, separate encrypted storage, retention, and redaction controls.

Estimated AI cost is computed by application code from a versioned price catalog and provider-reported usage, using integer micros of the billing currency (or another exact decimal representation). The record includes pricing-catalog version and marks the value estimated until reconciled with provider billing. The LLM never calculates or authorizes cost. Unknown usage/cost is represented as unknown, not zero.

Cost metrics include:

- AI cost per conversation and per qualified lead;
- token distribution and AI calls per conversation/language/intent;
- messaging provider cost per delivered conversation/booking when reported;
- database, telemetry, egress, and compute cost allocated at platform level and, only where defensible, by tenant;
- total cost per booking request/confirmed booking and gross-margin inputs once revenue capture exists.

Reports label measured provider/infrastructure cost separately from any fully loaded estimate. Staff/handoff/support labor is unknown until the owner supplies a defensible allocation model; it is never silently treated as zero.

## Business funnel analytics

### Event model

Canonical domain records remain authoritative. A projector creates append-only, versioned `analytics_events` with no raw message text. Each fact has `event_id`, `source_event_id`, `schema_version`, `organization_id`, UTC `occurred_at`, event type, subject references or privacy-safe pseudonyms, and bounded dimensions. Uniqueness on `(organization_id, source_event_id, event_type, schema_version)` makes projection idempotent.

Allowed dimensions include channel type, configured location/service IDs, detected/selected language with confidence, campaign/referrer codes when consented, handoff reason enum, and terminal outcome. Free-form text and contact values are not analytics dimensions. Subject identifiers are erased or pseudonymized under deletion policy while permissible aggregate facts remain.

### Canonical funnel definitions

| Funnel step | Canonical event / rule | Counting rule |
| --- | --- | --- |
| Inbound conversation | First valid customer-authored inbound message creates `conversation.started` | One per conversation; bots/test traffic excluded by explicit flag |
| Qualified lead | `lead.qualified` transition after deterministic qualification policy | First qualifying transition per lead |
| Booking requested | `appointment_request.created` committed with status `requested` | One per request, plus a separate unique-lead view |
| Staff accepted | `appointment_request.staff_accepted` | Intermediate operational step, not a confirmed booking |
| Booking confirmed | `appointment_request.confirmed` after valid customer confirmation | One per request; notification/delivery is insufficient |
| Attended | Authorized staff or a future authoritative integration appends an attendance fact and `appointment.attendance_recorded` (`attended`, `did_not_attend`, or `unknown`) | Source and actor required; correction appends history rather than overwriting |
| Revenue | Authorized staff/integration appends an exact attribution fact and `appointment.revenue_attributed` in integer minor units, currency, and source | Never inferred by AI; cross-currency totals require explicit reporting currency rules |

Conversion reports declare cohort basis and time window. The default architecture supports both conversation-start cohorts and event-period activity; the UI must label which is used. Mutable dimensions are snapshotted or joined `as of` the event so historical reports do not silently change when a service is renamed.

### Required product and operational measures

- first-response attempt latency: receipt commit to first outbound send attempt (the planning SLO boundary), plus a separate provider-acceptance/delivery latency where evidence exists; AI/application/queue/provider segments remain separately visible;
- handoff rate and handoff time-to-assignment/resolution;
- AI failure, malformed-output, policy-rejection, and safe-fallback rates;
- qualified-lead rate, booking-request conversion, staff-acceptance rate, customer-confirmation conversion, attendance rate, and attributable revenue;
- cost per conversation, qualified lead, booking request, confirmed booking, and attended booking;
- duplicate/replay rate and late-message rate;
- notification delivery latency and booking request age.

Analytics freshness and completeness are measured through projector lag, source-to-fact reconciliation, and per-event-type count checks. Metric definition changes require a schema/definition version and release note; dashboards must not silently redefine prior periods.

## Cost architecture and guardrails

### Cost centers and levers

| Cost center | Primary driver | V1 control |
| --- | --- | --- |
| AI inference | input/output tokens, model, retries, context size | Pinned model selected by multilingual evals, bounded context, one approved repair, per-tenant usage limits |
| PostgreSQL | storage, IOPS, connections, backups/PITR | indexes from access patterns, bounded pools, retention/archive, no separate queue/vector datastore |
| Application compute | API/worker/web concurrency and duration | Stateless scale-out, bounded worker concurrency, autoscaling on latency/queue age |
| Messaging | outbound messages/template/provider fees | suppress logical duplicates, record delivery outcomes, tenant/channel quotas |
| Observability | log/trace volume and retention | PII-safe allowlist, sampling, bounded cardinality and tiered retention |
| Network/storage | egress, assets, backup volume | compact contracts, lifecycle policies, no duplicate raw payload copies |
| Human operations | handoff volume, staff handling time, support/on-call effort | measure handoff age/rate and support work separately; do not present inference savings as total ROI while labor cost is unknown |

Cross-tenant AI response caching is prohibited. Deterministic structured FAQ/price lookup should answer without an AI call when interpretation is not needed; any tenant-local cache key must include organization, locale, knowledge revision, and policy revision. Conversation context is bounded and summarized into application-owned structured state; provider-side state is disabled (`store: false`).

Budgets exist at platform, per-tenant daily and billing-period, per-conversation, and per-run/context/output levels. Their monetary values and commercial behavior are open decisions. The enforcement order is:

1. Measure and warn at configured spend/velocity thresholds.
2. Reduce optional work (live evals, non-critical enrichment), never security or audit work.
3. Route new AI-dependent conversations to a reviewed safe handoff template at the hard limit.
4. Continue staff access, inbound persistence, existing booking confirmations, and required notifications.
5. Require an authorized, audited change to raise a hard tenant budget.

Budget calculations use exact units and include retry cost. A failed provider call with reported usage is still charged in estimates. Provider invoices are reconciled against the internal ledger; discrepancies alert rather than being overwritten.

## Scalability posture

V1 scales the modular monolith vertically and by independently replicating stateless `web`, `api`, and `worker` containers. PostgreSQL connection budgets, not CPU alone, constrain replicas. Worker scaling follows queue age by workload class, with provider and tenant concurrency caps.

The first scaling tools are query/index review, bounded payloads, pooling, batching outbox claims, archiving according to retention, and fair scheduling. Redis, Kafka, a vector database, table partitioning, read replicas, and service extraction are not initial requirements. Introduce them only from measured pressure and an ADR.

Potential extraction seams already have contracts: channel adapters, AI provider, notification delivery, analytics event export, calendar provider, and repositories. Extraction never changes the tenant/state/policy invariants or makes the AI authoritative.

Stage 0 uses a launch load-test hypothesis of 100 organizations, 1,000 concurrent conversations, a 50 inbound-message/second burst, and 10 million stored messages/year for storage sizing. These are test inputs, not contractual capacity or an SLA. Capacity tests must establish safe webhook throughput, AI queue age, outbox drain time, connection use, and hot-tenant isolation before production, then the profile must be revised from pilot evidence.

## Verification and reconciliation jobs

Scheduled, idempotent checks cover:

- accepted webhook receipt with no canonical message/processing completion;
- pending/leased outbox item older than its workload objective;
- provider-accepted outbound attempt not reflected locally, where provider status can be queried;
- `staff_accepted` request lacking a durable customer-confirmation intent;
- `awaiting_customer_confirmation` request past its configured expiry;
- terminal appointment state inconsistent with its transition history;
- source domain events missing analytics facts;
- `ai_run` usage with missing pricing-catalog mapping;
- stale/revoked channel connections;
- backups and restore drills.

Repairs run through normal idempotent commands, are tenant-scoped, and append audit events. Direct silent database edits are not an operational repair strategy.

## Open questions

These decisions cannot be safely inferred and must be resolved before the named release gate:

1. Do owners approve or replace the Stage 0 availability/latency/outbox planning targets, and what support hours, provider exclusions, measurement windows, and error-budget policy apply?
2. Do owners approve or replace the provisional database targets of RPO <= 5 minutes and RTO <= 60 minutes, and what backup retention and data-residency regions apply?
3. Which staff notification and customer-confirmation channels/providers ship in V1, and what delivery evidence do they expose?
4. What are the customer-confirmation and request-expiry windows, and may staff extend them?
5. What exact retention windows apply to idempotency records, webhook receipts, dead letters, AI metadata, audit events, and analytics facts in the launch jurisdictions?
6. How is attendance and recognized revenue entered in V1, and how are cancellations, refunds, currencies, taxes, and attribution treated?
7. What tenant/platform AI budgets, warning thresholds, hard-limit behavior, and commercial overage policy are approved?
8. Which telemetry backend and on-call/incident tooling will receive OTLP data and alerts?
9. Do launch evidence and commercial forecasts validate the Stage 0 load-test hypotheses (100 organizations, 1,000 concurrent conversations, 50 inbound messages/second burst, and 10 million messages/year), and what traffic distribution/SLO must production certify?
