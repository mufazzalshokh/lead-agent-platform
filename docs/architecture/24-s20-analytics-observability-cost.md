# S20 analytics, observability, and cost

S20 derives bounded analytics from canonical production records; it does not
create a second event lake or an analytics migration. Migration head remains
`0028` and the production-table count remains 51.

## Canonical sources and counting

| Metric | Source and counting rule |
| --- | --- |
| Contacts / Leads | Distinct Contact IDs and Lead rows created in `[from,to)`; repeat Messages never create another count |
| Conversations | Conversation rows started in `[from,to)`, preserving the S9 channel/thread grouping |
| Meaningful inbound | Deduplicated inbound Message rows whose content type is `text` or `quick_reply` |
| Qualification / Handoff | Lead qualification timestamp and Handoff request rows |
| Appointment funnel | AppointmentRequest rows plus distinct transition history for staff acceptance and confirmation preparation |
| Confirmed / attended | AppointmentRequest confirmation timestamp and current authoritative attendance outcome |
| Recorded revenue | Append-only attribution entries, with reversals subtracted per currency; never inferred from list prices |
| AI usage and cost | Every physical `ai_runs` attempt; retries and schema repairs are not collapsed into the winning decision |
| Queue health | Current tenant Outbox state and ready-item lag; no second queue truth |

Rates use deterministic denominators and return `null` when the denominator is
zero. Conversion rates are cohort based: the source-stage row or transition must
begin in `[from,to)`, and a later-stage outcome counts only when its authoritative
timestamp is before `to`. This prevents unrelated period event volumes from
producing impossible rates above 100%. Missing revenue is `available:false`, not zero. Date boundaries are UTC,
inclusive at `from` and exclusive at `to`; daily groups use the Organization's
authoritative IANA time zone.

## Response-time semantics

- Widget customer telemetry measures monotonic browser `Send` to first meaningful
  outbound render. It contains only a finite metric kind and bounded duration;
  no message content, customer identifier, or wall-clock authority is sent.
  Samples are held in a bounded process-local buffer partitioned by Organization;
  they reset on process restart and are never aggregated across tenants.
- Telegram and Instagram external latency means provider inbound timestamp to
  outbound submission accepted by that provider. It is not exact customer screen
  render time. New delivery audits bind to the Message that was submitted;
  historical deliveries without that binding remain unavailable.
- Platform latency means persisted meaningful inbound Message to the first later
  outbound text Message. Acknowledgment is a separate empty family until a
  canonical acknowledgment signal exists; it is never counted as meaningful.
- Raw observations retain provider/network delays. The normal-availability view
  excludes only attempts with an explicitly recorded external transport/outage
  category. Neither is an SLA claim.

Percentiles are calculated from the observation set (p50/p75/p90/p95/p99/max),
not by averaging daily percentiles. Reports include the `<=3s`, `<=5s`, `<=10s`,
`<=30s`, `<=60s`, and `>60s` buckets. S20 makes the 3-10 second typical target
and future p99 <=60 second objective measurable; S22 must prove representative
capacity and reliability.

## Cost policy

The versioned in-process price catalog is frozen from the accepted S13 provider
evidence. It has effective intervals, source metadata, USD denomination, and
separate input, cached-input, and output rates for `gemini-3.8-flash` and
`gpt-5.6-luna`. A completed physical run is priced only when the exact provider,
resolved model, run time, and complete supported usage match a catalog entry.
Otherwise cost remains `NULL`. Historical `not-priced.v1` runs are not
retroactively fabricated.

Internal tenant economics can calculate known provider cost, cost per
Conversation/Lead/AppointmentRequest/confirmed appointment, and an observed
cost-per-1,000-Conversations projection. If any run in the period has unknown
cost, all derived unit-cost values are unavailable. No subscription revenue,
support cost, or infrastructure allocation source exists yet, so subscription
revenue, allocation, contribution, and margin are explicitly `null` rather than
silently zero.

## Customer analytics versus platform economics

The private staff Analytics API requires the existing `analytics.read`
permission and derives the Organization from the authenticated current
membership. Its bounded response contains funnel, channel, daily, response-time,
usage-consumption, and recorded-attributed-revenue aggregates. It contains no
provider/model identity, raw provider cost, contribution/margin, customer PII,
message text, hidden reasoning, provider envelope, or secret.

The current report is Organization-wide. A restricted-location analyst is
denied rather than receiving cross-location aggregates; a later additive
location filter may provide a scoped report without weakening resource policy.

Raw Gemini/OpenAI spend, provider health, queue state, channel failures,
subscription revenue, allocations, contribution, margin, and cost per outcome
are operator-internal data. S20 exposes these only through tenant-bound
application/database capabilities; it does not invent a platform-operator HTTP
authorization path. Billing, invoices, quotas, overages, and payment providers
remain later commercial work.

## Operational and privacy boundaries

Operational dimensions are finite: operation kind, outcome, channel, and the
approved provider/model identities in internal reports. IDs, tenant IDs, phone,
email, message text, prompts, drafts, and arbitrary error strings cannot become
metric labels. The process-local Widget sample buffer is bounded and contains
durations only. Database-backed tenant analytics remains the durable business
source.

Internal operations report AI success/failure/repair counts and latency,
current Outbox backlog/retry/dead-letter state and lag, and channel submission
outcomes. Existing health endpoints remain bounded. Alert delivery integrations
and contractual thresholds are not introduced; suggested operational signals
are p99 above 60 seconds, ready Outbox lag, dead letters, provider error growth,
and incomplete/cost-unknown AI usage.

## Limitations

- No historical customer-render Widget measurement exists before S20 telemetry.
- No exact Telegram/Instagram physical send-tap or screen-render observation is
  available.
- No causal revenue-uplift or audited financial ROI claim is made.
- No infrastructure/support allocation is fabricated.
- No migration, materialized view, warehouse, billing subsystem, or alerting
  integration is added.
