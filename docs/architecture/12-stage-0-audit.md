# Stage 0 Architecture Audit and Traceability

Status: CONDITIONAL PASS — Stage 1 workspace bootstrap may begin; production is not approved

Audit date: 2026-08-30

## 1. Audit objective

This audit tests whether the Stage 0 architecture is sufficiently complete and
internally consistent for small implementation stages to proceed without inventing
business, security, or data-isolation behavior.

The review covers the requested dimensions:

- requirements;
- domain model;
- database;
- tenant isolation;
- AI architecture;
- state machines;
- API boundaries;
- security;
- edge cases;
- testability;
- scalability;
- MVP scope;
- cost;
- future integrations.

It also checks the product, permissions, privacy, reliability, observability,
analytics, deployment, and implementation-roadmap relationships needed to support
those dimensions.

No unresolved architecture contradiction requires implementation guesswork in
Stage 1. The conditions recorded below are named product, legal, provider,
budget, and operating-target decisions with explicit owners/stage deadlines;
they do not authorize bypassing a stage gate.

## 2. Rating method

| Rating | Meaning |
|---|---|
| PASS | Design is explicit, consistent, testable, and has no unresolved P0 choice. |
| CONDITIONAL | Boundary is sound, but a named product/operational choice must be resolved by its stated stage. |
| FAIL | Contradiction, missing authority boundary, or unsafe behavior would force implementation guessing. |
| NOT APPLICABLE | Intentionally outside V1 and isolated behind a documented seam. |

A PASS is a design verdict, not a claim that code or infrastructure exists.

## 3. Requirements traceability

| # | Required deliverable | Evidence | Final rating |
|---:|---|---|---|
| 1 | Product specification, boundaries, priorities, metrics | `01-product-and-journeys.md` | PASS |
| 2 | User journeys A–N | `01-product-and-journeys.md` | PASS |
| 3 | Context, containers, components, and lifecycles | `02-system-architecture.md` | PASS |
| 4 | Aggregates, entities, values, services, repositories, events, invariants | `03-domain-and-state-machines.md` | PASS |
| 5 | Lead, conversation, appointment, and handoff state machines | `03-domain-and-state-machines.md` | PASS |
| 6 | Table-by-table relational design, isolation, indexes, deletion, ERD | `04-data-model.md` | PASS |
| 7 | Versioned private/widget/webhook API contract | `05-api-and-channel-contracts.md` | PASS |
| 8 | Canonical channel adapter with widget/Telegram and future adapters | `05-api-and-channel-contracts.md` | PASS |
| 9 | AI orchestration, `AgentDecision`, policy and failure controls | `06-ai-and-booking.md` | PASS |
| 10 | Human-controlled booking workflow and calendar seam | `06-ai-and-booking.md` | PASS |
| 11 | Tenant resolution, scoping, authorization, super-admin, widget controls | `07-tenancy-security-privacy.md` | PASS |
| 12 | Threat model and mitigations | `07-tenancy-security-privacy.md` | PASS |
| 13 | Minimization, retention, deletion, consent, export, audit | `07-tenancy-security-privacy.md` | PASS |
| 14 | Idempotency, retries, outbox, DLQ, timeouts, ordering, failure | `08-reliability-observability-analytics.md` | PASS |
| 15 | Logs, metrics, traces, correlation, AI and cost telemetry, alerts | `08-reliability-observability-analytics.md` | PASS |
| 16 | Conversion funnel through attendance and revenue | `08-reliability-observability-analytics.md` | PASS |
| 17 | Test pyramid, security regression, and multilingual AI evals | `09-test-strategy.md` | PASS |
| 18 | Local/test/staging/production, secrets, migration, backup, rollback, CI/CD, health | `10-deployment-and-repository.md` | PASS |
| 19 | Monorepo tree and responsibility boundaries | `10-deployment-and-repository.md` | PASS |
| 20 | Required ADR set | `11-adrs-roadmap-risks.md` | PASS |
| 21 | Small implementation stages with gates and tests | `11-adrs-roadmap-risks.md` | PASS |
| 22 | Ranked multi-category risk register | `11-adrs-roadmap-risks.md` | PASS |
| 23 | Explicit genuine open questions | `11-adrs-roadmap-risks.md` | PASS |

## 4. Cross-boundary consistency checks

### 4.1 Tenant derivation matrix

| Entry path | Untrusted input may contain tenant ID? | Authoritative tenant source | Required mismatch behavior |
|---|---:|---|---|
| Staff/private API | It may appear in URL/filter, but is not authority. | Verified identity subject → active membership → allowed organization/location scope. | `404` for cross-tenant resource oracle; `403` for an understood in-tenant capability failure. |
| Widget bootstrap | Public key is presented by browser. | Active widget key lookup → channel connection → organization; requested origin checked against allowlist. | Generic unavailable response; never disclose another tenant. |
| Widget message | Body cannot choose tenant. | Signed short-lived widget session bound to connection and conversation nonce. | `401/404` generic failure; no state mutation. |
| Telegram webhook | Payload chat/user data is not tenant authority. | Non-secret route selector plus verified connection webhook secret/signature → channel connection → organization. | Reject unauthenticated delivery; valid duplicate returns success without effects. |
| Durable job | Payload is still validated. | Immutable outbox/job record created within a previously authorized tenant transaction. | Dead-letter and security alert on missing/mismatched tenant record. |
| Platform operation | No implicit tenant access. | Separate platform identity plus audited time-bounded elevation to one organization. | Fail closed; every elevation and access recorded. |

Required consistency assertion: API, repositories, RLS policies, audit events, jobs,
and telemetry must carry the same resolved `organization_id`. The client value is
never copied into trusted context without the authoritative lookup above.

### 4.2 State/contract/data mapping

| Aggregate | Canonical states | Persistence | API representation | Invalid transition behavior |
|---|---|---|---|---|
| Lead | `new`, `engaged`, `qualified`, `booking_requested`, `converted`, `disqualified`, `closed` | `leads.status` plus transition/audit history | Read resource plus command endpoints, never arbitrary status patch | Domain `InvalidTransition`; stable lower-case resource API code, no mutation/outbox side effect. |
| Conversation | `open`, `awaiting_lead`, `awaiting_staff`, `resolved`, `closed` | `conversations.status`, optimistic `version` | Read resource; explicit resolve/reopen/close commands | Expected-version conflict or typed transition rejection. |
| Appointment request | `requested`, `staff_accepted`, `awaiting_customer_confirmation`, `confirmed`, `rejected`, `cancelled`, `expired` | `appointment_requests.status` plus decision/transition records | Staff decision and scoped customer confirmation commands | Transition and actor capability both checked; stale/expired confirmation fails. |
| Handoff | `requested`, `assigned`, `in_progress`, `resolved`, `cancelled`, `expired` | `handoffs.status`; one active handoff per conversation | Explicit assign/start/resolve/cancel commands | Deterministic rejection; duplicate request returns active handoff. |

The detailed appointment flow resolves the earlier shorthand ambiguity:
`staff_accepted` is not `confirmed`. A final booking requires direct customer
confirmation or an explicitly audited staff attestation that the customer confirmed
through an external contact.

### 4.3 Domain/data/API/event invariant mapping

| Invariant | Domain enforcement | Database defense | API/worker boundary | Required test |
|---|---|---|---|---|
| No cross-tenant reference | Aggregate/repository requires tenant context. | Tenant-aware composite FK/unique strategy and FORCE RLS on tenant tables. | Resource lookup scoped before authorization/action. | Parameterized tenant A/B read/write/IDOR suite. |
| No duplicate inbound effect | Idempotent receive use case. | Unique provider/widget receipt key. | Duplicate returns prior acknowledgement. | Concurrent duplicate webhook/message test. |
| No duplicate active handoff | Handoff service returns existing active item. | Partial unique active-handoff index. | Duplicate command is idempotent. | Race test with two workers. |
| AI cannot change protected state | Only application commands own transitions. | Constraints reject invalid stored values; transaction records actor/provenance. | Closed AI action enum plus policy gateway. | Malicious/unknown action and prompt-injection tests. |
| Missing price is never invented | Price value object requires authoritative source. | Versioned price rows and explicit pricing mode. | AI context marks fact absent; policy selects handoff/qualified wording. | Multilingual missing-price/invented-discount evals. |
| Staff acceptance is not final booking | Appointment aggregate requires customer-confirmation command. | Distinct status values and transition history. | Staff accept response says awaiting customer; customer capability is separately scoped. | State/API E2E for accept, confirm, reject, expiry. |
| External side effects follow commit | Use case emits intent only. | Aggregate mutation and outbox row in one transaction. | Worker performs provider call after commit. | Crash-boundary/outbox replay test. |
| Money arithmetic is deterministic | Money value object uses integer minor units and currency. | Integer/decimal constraints; no float column. | AI can quote an approved formatted value, not calculate authority. | Rounding/currency/property tests. |
| Location time is deterministic | Scheduling uses injected clock and IANA timezone. | UTC instants plus location timezone/versioned local preference. | API requires explicit offset/local interpretation where ambiguous. | DST and timezone boundary tests. |

## 5. Requested-dimension audit

| Dimension | Evidence to verify | Key acceptance question | Final rating |
|---|---|---|---|
| Requirements | Product priorities, journeys, 23-item traceability | Can every P0 behavior be traced to a use case, contract, state, data owner, and test? | CONDITIONAL — traceable; cohort rules, legal wording, and operating targets remain owned decisions. |
| Domain model | Aggregates, invariants, events, state machines | Is each business mutation owned by exactly one aggregate/use case? | PASS |
| Database | Table catalog, constraints, indexes, deletion, ERD | Can the schema enforce identity, dedupe, and reference invariants without JSON blobs becoming hidden domain state? | PASS |
| Tenant isolation | Resolution matrix, repositories, RLS, control plane | Is there any path where a caller-supplied tenant identifier becomes authority? | PASS |
| AI architecture | Context provenance, schema, policy, failure handling | Can any model output directly authorize or perform a protected action? | CONDITIONAL — authority boundary passes; pinned model/profile and eval thresholds require measured selection. |
| State machines | Canonical tables and invalid-pair tests | Are all actor-allowed transitions explicit, including expiry/retry/idempotent duplicates? | PASS |
| API boundaries | Three surfaces, schemas, auth, errors, pagination, idempotency | Do transports expose commands rather than arbitrary state mutation? | PASS |
| Security | Threat matrix, privacy, secrets, audit | Does each required threat have prevention, detection, and response ownership? | CONDITIONAL — design passes; jurisdiction, IdP/MFA, hosting, and provider controls need approval before their gates. |
| Edge cases | Journey exceptions, failures, races, language and time handling | Is safe behavior defined without relying on model improvisation? | PASS |
| Testability | Ports, clocks/IDs, mocks, contract and security tests | Can normal CI run deterministically without live providers? | PASS |
| Scalability | Stateless processes, worker queues, DB access, triggers | Are scale assumptions explicit and are extraction triggers based on evidence? | CONDITIONAL — explicit load hypotheses exist but are not demonstrated capacity. |
| MVP scope | P0/P1/P2 and exclusions | Does P0 prove lead-to-confirmed-booking ROI without calendar writes or speculative integrations? | PASS |
| Cost | Token/provider/infrastructure metrics and budgets | Can cost per conversation/lead be attributed, alerted, and limited per tenant? | CONDITIONAL — accounting/control design passes; model and tenant budgets need owner approval. |
| Future integrations | Stable ports/contracts and capability model | Can a new channel/calendar/provider be added without changing core conversation rules? | PASS |

## 6. Edge-case audit set

The following cases must have both a deterministic design outcome and at least one
named test category:

| Case | Expected architecture behavior | Evidence |
|---|---|---|
| Duplicate, delayed, or reordered webhook | Persist a scoped inbox receipt; suppress duplicate effects; apply only transitions valid for current version. | PASS — `02`, `04`, `08`, `09`. |
| AI provider timeout, refusal, malformed/incomplete output | Record failed AI run; bounded retry if safe; acknowledge delay or create handoff; never claim success. | PASS — `06`, `08`, `09`. |
| Missing price/service/hours | Use explicit absence; provide no plausible substitute; offer handoff. | PASS — `01`, `06`, `09`. |
| Unsupported/unavailable requested time | Store preference only; never claim slot availability; staff decides. | PASS — `01`, `03`, `06`. |
| Two staff members decide concurrently | Optimistic version/transition precondition lets one win; other receives conflict/current state. | PASS — `03`, `04`, `05`, `09`. |
| Customer confirms after rejection/expiry/change | Reject stale capability; create a new review/request path. | PASS — `03`, `05`, `09`. |
| Widget lead closes browser before staff response | Durable conversation remains; response appears on valid return, or staff records externally obtained confirmation with provenance. | PASS — `01`, `02`, `06`. |
| Same contact identity appears across tenants | Never globally merge; uniqueness is tenant-scoped. | PASS — `03`, `04`, `07`, `09`. |
| Same contact appears on widget and Telegram in one tenant | Suggest/link only through verified deterministic identity workflow; no AI-only merge. | PASS — `03`, `04`, `09`. |
| Tenant disables connection mid-job | Re-check active connection before effect; stop/dead-letter safely. | PASS — `02`, `07`, `08`, `09`. |
| Knowledge changes during AI run | Conversation/knowledge version mismatch prevents stale decision application. | PASS — `02`, `06`, `09`. |
| Prompt injection in lead or business content | Treat text as data, constrain tools/actions, validate independent policy. | PASS — `06`, `07`, `09`. |
| Medical question | Approved administrative boundary wording plus handoff; no diagnosis. | PASS — `01`, `06`, `07`, `09`. |
| Malformed/international phone | Normalize only with explicit country context; retain raw encrypted value as needed; request clarification. | PASS — `03`, `04`, `09`. |
| DST/ambiguous local time | Use IANA location timezone and ask for confirmation when a local time maps ambiguously. | PASS — `03`, `04`, `09`. |
| Outbox/job crash after provider accepted send | Reuse effect idempotency key; reconcile provider result or tolerate duplicate-safe delivery. | PASS — `02`, `08`, `09`. |
| Deletion during active workflow | Tombstone/close workflow, cancel pending effects, preserve minimal legally required audit proof. | PASS — `03`, `04`, `07`, `09`; productized automation is P1. |

## 7. Scalability audit

### Assumptions to validate with load tests

- 100 active organizations, 1,000 concurrent conversations, and 50 inbound
  messages/second at initial peak;
- up to 10 million messages per year before archival;
- independently scalable stateless web/API containers;
- AI and provider calls execute only in workers;
- bounded database connection pools across all replicas;
- ordered application by conversation version rather than a global queue lock.

### Likely first bottlenecks and designed response

| Bottleneck | Early signal | V1 response | Extraction trigger |
|---|---|---|---|
| AI latency/rate limit | queue age, timeout and 429 rate | admission budgets, bounded concurrency, safe handoff, model/cost profile | Dedicated orchestration deployment only if worker isolation cannot meet SLO. |
| PostgreSQL connections | pool saturation/wait time | pool budgets, worker concurrency limit, pooler | Separate job/analytics store only after measured interference. |
| Outbox/job backlog | oldest pending age | indexed claims, batch dispatch, worker autoscale | Broker evaluation only when PostgreSQL queue load harms OLTP. |
| Large message/audit tables | index size, vacuum lag, query p95 | retention/archive, tenant-leading indexes, targeted partitions | Warehouse/archive extraction when primary query SLO degrades. |
| Hot conversation | version conflicts/replans | per-conversation debounce and version checks | No service split; refine scheduler/lock policy. |
| Noisy tenant | per-tenant queue/cost share | quotas, fair scheduling, rate and spend budgets | Dedicated tenant resources only as commercial/operational exception. |

No microservice is justified by the initial assumptions. Process-level scaling keeps
the modular-monolith domain boundary intact.

## 8. MVP-scope audit

### Must be inside P0

- organization/location/service/price/FAQ/hours/policy configuration;
- staff identity, memberships, roles, and location scope;
- widget and Telegram inbound/outbound conversation paths;
- factual multilingual response and qualification workflow;
- contact capture with consent/provenance;
- appointment request, durable in-app staff inbox, staff decision, customer
  confirmation, rejection/cancellation/expiry;
- direct customer confirmation where reachable and audited external confirmation
  attestation for offline widget leads;
- human handoff and graceful provider failure;
- tenant isolation, idempotency, outbox/jobs, audit, PII-safe telemetry;
- manual attendance/no-show and attributed-revenue outcome capture needed to close
  the ROI funnel;
- deterministic CI, tenant security tests, and Uzbek/Russian/English AI eval gates.

### Reserved for P1

- productized consent-withdrawal, subject/tenant export, deletion-request, and
  retention-worker APIs/UI; P0 still has persisted semantics and a verified,
  audited operator fulfillment path for applicable obligations;
- reminders, operator dead-letter UI, richer reporting/routing, optional staff
  alert adapters, and approved attendance/revenue import automation.

### Must remain outside V1

- autonomous calendar writes or claims of live availability;
- Instagram/WhatsApp production adapters;
- vector database/RAG infrastructure;
- medical diagnosis, treatment advice, or clinical decision support;
- voice, file ingestion, arbitrary web search, or unrestricted model tools;
- autonomous discounts, billing, refunds, or payment processing;
- custom workflow builder, generic chatbot platform, or microservice decomposition;
- automatic cross-tenant/contact identity sharing;
- predictive lead scoring not traceable to explicit tenant policy.

## 9. Cost audit

Cost design is valid only if each unit can be attributed to organization,
conversation, AI run, provider operation, and outcome without logging PII.

### Required formula

For a period and tenant:

```text
AI cost = Σ[(uncached_input_tokens × input_rate)
          + (cached_input_tokens × cached_input_rate)
          + (output_tokens × output_rate)] / 1,000,000

conversation variable cost = AI cost
                           + channel delivery cost
                           + notification cost
                           + allocated variable infrastructure cost

cost per qualified lead = total attributable variable cost / qualified leads
cost per confirmed booking = total attributable variable cost / confirmed bookings
```

Rates are dated configuration, never embedded business constants. The cost scenario
in the decision document must record its model, date, currency, assumed turns,
tokens, retries, and cache eligibility.

### Required controls

- per-request token/output ceilings;
- bounded context window and deterministic summarization;
- per-tenant daily/monthly soft and hard budgets;
- global provider spend alert and kill switch;
- retry caps that distinguish schema/provider failure from business uncertainty;
- cheaper-model use only after language/safety eval parity, not solely on price;
- queue backpressure and noisy-tenant isolation;
- dashboards for cost per conversation, qualified lead, request, and confirmation.

## 10. Future-integration audit

| Future integration | Stable seam required now | Core changes forbidden |
|---|---|---|
| Instagram/WhatsApp | `ChannelAdapter`, canonical inbound/outbound message, capability flags, scoped credential reference | No channel enum branches inside lead/booking policy. |
| External calendars | `CalendarProvider` capability and normalized availability/hold/commit result contracts kept unimplemented in V1 | AI never gains calendar credentials or direct commit authority. |
| SMS/email notifications | `NotificationSender` and destination/consent policy | Booking aggregate does not depend on provider delivery status. |
| Alternative AI provider/model | `AIProvider`, canonical usage/error/refusal result, strict `AgentDecision` | Domain action enum and policy do not become provider-specific. |
| Identity vendor | OIDC boundary and internal subject/membership mapping | Tenant RBAC is not stored only in provider claims. |
| Billing/payment | Usage event export and deterministic money contract | AI never calculates charges or receives payment credentials. |
| Warehouse/BI | Versioned analytics events and idempotent export cursor | OLTP domain state is not rewritten by analytical projections. |
| Knowledge retrieval | `KnowledgeSource` returns cited authoritative records and versions | No vector store until measured corpus/latency/quality need passes an ADR and tenant-leakage review. |

## 11. Contradictions identified

| Contradiction/tension | Resolution in this package | Status |
|---|---|---|
| Constitution shorthand says staff confirmation leads to confirmed booking; detailed Stage 0 flow adds customer confirmation. | Use distinct `staff_accepted` and `awaiting_customer_confirmation`; final `confirmed` requires customer confirmation/provenance. Detailed product requirement controls. | Resolved |
| Product requests preferred time and an “unavailable appointment” eval, but V1 has no authoritative calendar availability. | Treat time as a preference; compare only with configured hours; staff accepts/rejects. AI never claims availability. | Resolved |
| “Immediate response” conflicts with asynchronous AI/provider outages. | Immediate response means durable acknowledgement within API SLO; substantive answer may arrive asynchronously or become a handoff. | Resolved |
| Customer confirmation is required, but widget leads may leave and V1 has no SMS/WhatsApp. | Persist widget session for return; otherwise staff contacts lead externally and records audited `staff_attested_external` confirmation. | Resolved with explicit provenance |
| Staff must receive requests, but no notification provider is selected. | Durable in-app staff inbox is P0 authority; outbound alerts are secondary adapters and may fail without losing work. | Resolved |
| Funnel includes attendance/revenue, but no external practice-management integration exists. | P0 captures manual outcome and attributed amount with actor/source; integrations may automate later. | Resolved |
| Healthcare ICP could imply regulated clinical processing, but scope says administrative only. | Minimize health content, refuse diagnosis, avoid compliance claims, and require jurisdiction/BAA assessment before any PHI-enabled deployment. | Resolved as scope boundary |
| “Production-grade” can invite premature services/vector infrastructure. | Define measurable reliability/security gates and extraction triggers while retaining modular-monolith deployment. | Resolved |
| `staff_accepted` was described both as a durable state and as a zero-duration step inside the staff transaction. | Staff accept commits durable `staff_accepted` plus preparation outbox; a later worker transaction creates confirmation capability/delivery intent and advances to `awaiting_customer_confirmation`. | Resolved |
| P0 privacy/legal ability was conflated with productized self-service automation. | P0 retains minimization, evidence, policy, legal hold, audit, and a verified operator fulfillment path; productized APIs/workers are P1 unless launch counsel elevates them. | Resolved |
| The full application JSON Schema used `maxLength`, which the provider's strict Structured Outputs subset may reject. | Keep the full canonical application schema; generate and contract-test a provider-compatible projection, then revalidate output against the full schema. | Resolved |
| Provider-port names drifted between generic and split interfaces. | Canonical names are `AIProvider`, capability-based `ChannelAdapter`, `CalendarProvider`, `NotificationSender`, and `KnowledgeSource`; smaller interfaces are documented parts of those seams. | Resolved |

## 12. Final gate

Completed evidence checks:

- all 23 required deliverables exist and are traced above;
- canonical roles, states, event names, confirmation sources, API prefixes,
  tenant keys, AI action names, and integration-port vocabulary were searched
  across the package and reconciled;
- all Markdown/code/Mermaid fences are balanced, all 11 JSON fences parse, table
  structure is consistent, and every relative link resolves;
- the repository contains architecture documentation and `AGENTS.md` only—no
  application code, migration, dependency, secret, provider connection, or
  deployment was created;
- P0 correctness relies on PostgreSQL and the authoritative in-app inbox, not an
  unselected calendar, alert, identity, or model provider implementation.

### Stage 1 verdict

**READY WITH CONDITIONS for S1 workspace baseline only.** S1 may create the
reproducible TypeScript/pnpm workspace, boundary rules, empty app/package
scaffolds, and CI smoke checks defined in the roadmap. It must not silently pull
later product stages forward. The repository owner must record acceptance of the
ADR baseline and decision-owner assignments; each open question must be decided
by its `Needed by` gate. Production readiness remains explicitly unproven.
