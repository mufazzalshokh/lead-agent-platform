# Architecture Decisions, MVP Roadmap, Costs, Integrations, and Risks

## Decision status convention

The ADRs below are **Accepted as the Stage 0 implementation baseline**. “Accepted” selects an approach, not an unverified package version or a claim of production readiness. Stage 1 must pin compatible versions in the lockfile, verify their documented APIs, and supersede a decision with a new ADR if evidence changes it. Accepted ADRs should be split into immutable files under `docs/adr/` as the repository is bootstrapped.

## Architectural decision records

### ADR-001: TypeScript, Node.js 24 LTS, and pnpm monorepo

**Status:** Accepted

**Context:** Three deployable applications and shared contracts/domain modules need one type system, reproducible builds, and enforceable boundaries without duplicating models.

**Decision:** Use TypeScript on Node.js 24 LTS in one `pnpm` workspace and lockfile. Use strict compiler settings and project/dependency-boundary checks. Runtime validation remains mandatory because TypeScript types do not validate untrusted data.

**Consequences:** Teams share language/tooling and can derive types from canonical schemas. A single lockfile makes upgrades coordinated and raises the blast radius of dependency mistakes; CI and scoped ownership must compensate. Node/package versions must be pinned and deliberately upgraded.

### ADR-002: Modular monolith

**Status:** Accepted

**Context:** V1 has tightly coupled conversation, lead, booking, tenant, policy, and audit transactions. Premature services would add network consistency and operational cost before scale/team boundaries are known.

**Decision:** Build a modular monolith with `web`, `api`, and `worker` processes from one repository/release. Domain/application modules communicate in-process through explicit interfaces and durable events for asynchronous effects. No module accesses another module's tables except through its repository/application contract.

**Consequences:** Cross-domain invariants and transactions remain straightforward, deployment is cheaper, and refactoring is easier. Poor boundary discipline could still produce a distributed “big ball of mud,” so dependency rules and module ownership are release gates. Measured independent scaling/failure/team needs can justify later extraction via existing ports.

### ADR-003: PostgreSQL as the system of record

**Status:** Accepted

**Context:** The product needs transactions, relational constraints, tenant-scoped queries, audit/history, exact money, JSON metadata, and reliable job/outbox coordination.

**Decision:** Use PostgreSQL for authoritative domain data, idempotency/inbox/outbox, pg-boss jobs, and initial analytics facts. Use UTC timestamps, exact numeric/integer minor units, explicit foreign keys/checks/unique constraints/indexes, and managed backups/PITR in production.

**Consequences:** V1 avoids additional stateful systems and gains strong transaction semantics. PostgreSQL becomes a critical shared capacity/failure domain; connection budgets, query plans, backup/restore, queue fairness, and growth must be monitored. A new datastore requires measured need and an ADR.

### ADR-004: Drizzle ORM and explicit SQL migrations

**Status:** Accepted

**Context:** The TypeScript codebase needs strongly typed mappings without hiding SQL, constraints, indexes, RLS, or migration behavior.

**Decision:** Use Drizzle for schema mapping/query construction and its supported explicit migration workflow. Check reviewed SQL migrations into source control. Repositories expose domain/application concepts and mandatory tenant scope; raw escape hatches stay infrastructure-local and reviewed.

**Consequences:** Schema and TypeScript stay close while PostgreSQL capabilities remain accessible. The team must understand generated SQL and cannot assume ORM typing proves runtime authorization. Exact commands/APIs are verified against the installed version during bootstrap; deployed migrations are immutable.

### ADR-005: Fastify REST API

**Status:** Accepted

**Context:** Staff, widget, and webhook clients need a bounded, schema-validated HTTP interface with different trust models. The domain must remain transport-independent.

**Decision:** Use Fastify as the HTTP adapter, expose versioned REST resources, and validate/serialize all external bodies with canonical JSON Schemas. Separate private, widget, and webhook route trees and middleware. Route handlers translate transport to application commands/queries; they contain no domain policy.

**Consequences:** The API gains explicit schemas and efficient request lifecycle hooks. Framework plugins can accidentally become hidden global policy, so composition, encapsulation, and authorization tests are required. Realtime/WebSocket transport is not assumed for V1 and can be added behind the same application contracts.

### ADR-006: Next.js web application

**Status:** Accepted

**Context:** V1 needs a staff dashboard/configuration surface and an embeddable web-chat surface while keeping business behavior on the server.

**Decision:** Use Next.js for `apps/web`. It consumes versioned APIs and presentation-only `packages/ui`; it never imports database code or reimplements state/authorization rules. Private and public/widget routes are isolated, and server/client boundaries prevent secrets from reaching bundles.

**Consequences:** One web stack can deliver staff and widget experiences and share accessible UI/i18n primitives. Bundle isolation, CSP/CORS/origin rules, XSS tests, and caching scope require care. If an independently versioned tiny widget loader becomes necessary, it can be built as an artifact/package without moving domain logic.

### ADR-007: OIDC-compatible staff authentication with app-owned membership/RBAC

**Status:** Accepted

**Context:** Authentication provider choice may change, while organization membership and tenant authorization are core application facts. Trusting organization claims or client-supplied IDs would create cross-tenant risk.

**Decision:** Authenticate staff through a standards-compatible OIDC provider. Map the stable external subject/issuer to an application user/membership. The application owns organization membership and roles `owner`, `admin`, `staff`, and `analyst`; a `platform_operator` identity/path is separate, explicit, reason-bound, and audited. Derive tenant context server-side for every request.

**Consequences:** Identity capabilities can be outsourced without outsourcing authorization. OIDC validation, key rotation, account lifecycle, membership revocation, MFA/session policy, and provider outage need contracts/runbooks. The concrete provider remains an open deployment decision.

### ADR-008: pg-boss for PostgreSQL-backed background work

**Status:** Accepted

**Context:** AI calls, outbound delivery, analytics, notification, reconciliation, and maintenance cannot block webhook/API requests and must survive restarts. V1 should avoid operating a separate broker.

**Decision:** Use pg-boss as the initial job runtime. Separate queues/concurrency by workload class, use bounded retries/leases/dead letters, and pass references/minimal typed payloads. Handlers are idempotent and re-check tenant/state/policy.

**Consequences:** Jobs share PostgreSQL operations/backups and reduce infrastructure cost. Queue load competes with transactional load, so age, locks, connections, fairness, and dead letters must be observed. Kafka/SQS/another broker is a future adapter only after measured contention or delivery requirements justify it.

### ADR-009: Transactional outbox

**Status:** Accepted

**Context:** A crash between a business commit and provider/job call can lose an action; calling a provider inside a transaction creates long locks and still cannot atomically commit two systems.

**Decision:** Commit domain state and an `outbox_events` intent in the same PostgreSQL transaction. A worker claims, dispatches, retries, and records delivery/dead-letter status. Consumers use stable event IDs and idempotent effects. Analytics is an idempotent projection from the same durable source.

**Consequences:** Important effects are recoverable and auditable with at-least-once delivery. The outbox requires dispatch/reconciliation/retention tooling and can duplicate physical attempts. It does not promise distributed exactly-once delivery.

### ADR-010: AI provider abstraction with OpenAI first

**Status:** Accepted

**Context:** Natural-language interpretation is required, but provider/model APIs, price, quality, and availability change. Application authority cannot live in the model.

**Decision:** Define the provider-neutral `AIProvider` decision port and implement the first adapter with the OpenAI Responses API. Use application-owned conversation state, `store: false`, explicit deadlines, usage capture, and a pinned supported model selected by multilingual eval/cost gates. Provider/model output is untrusted.

**Consequences:** The application can test with deterministic fakes and change model/provider without rewriting domain workflows. The abstraction must expose real capabilities/errors rather than a lowest-common-denominator fiction. OpenAI-specific code stays in the adapter; provider state is not the conversation record.

### ADR-011: Schema-constrained structured AI decisions

**Status:** Accepted

**Context:** Free-form prose cannot safely authorize tools/state changes or reliably distinguish intent, facts, and proposed actions.

**Decision:** The model returns an `AgentDecision` constrained by the canonical JSON Schema and version. Its action discriminant is one of `none`, `request_information`, `create_appointment_request`, `confirm_appointment`, `decline_appointment`, or `request_handoff`. Runtime validation occurs before deterministic policy validation. Only allowlisted arguments referencing authoritative same-tenant records may reach an application command. `confirm_appointment` still requires independently verified customer/channel/tenant/state evidence. Malformed output gets at most one approved repair path; failure degrades to safe handoff/template.

**Consequences:** Model behavior becomes testable and auditable, and prose is separated from authority. Schema evolution and prompt/model compatibility require versioning/evals. A valid schema is necessary but never sufficient for authorization or factual safety.

### ADR-012: No vector database in V1

**Status:** Accepted

**Context:** Initial business knowledge is bounded and structured: services, prices, FAQs, hours, policies, and locations. A vector store adds cost, synchronization/deletion/isolation risk, and nondeterministic recall without demonstrated need.

**Decision:** Use tenant-scoped structured PostgreSQL queries plus category/lexical search where needed. Supply approved fact records/revisions to the model and require fact references in grounded decisions. Do not add embeddings/vector infrastructure in V1.

**Consequences:** Answers remain explainable and authoritative with lower operational cost. Recall may degrade as unstructured corpora grow. Revisit only when corpus size/shape and measured multilingual recall/latency show the structured approach misses an approved target; any vector design requires per-tenant isolation, deletion/reindex consistency, injection handling, evaluation evidence, and a new ADR.

### ADR-013: Request, staff acceptance, then customer confirmation; no autonomous calendar writes

**Status:** Accepted

**Context:** The source requirements distinguish a preferred time from actual availability and require staff control. They also require customer confirmation after staff acceptance.

**Decision:** V1 states are `requested -> staff_accepted -> awaiting_customer_confirmation -> confirmed`. Staff may reject/cancel; expiration is deterministic. `staff_accepted` moves to `awaiting_customer_confirmation` only after confirmation intent is durably queued. Only evidence source `customer_session`, `telegram`, or an authorized `staff_attested_external` record with method `phone` or `in_person` creates `confirmed`; attestation is fully audited. Every confirmation must match both the expected aggregate version and current `offer_version` and use an explicit clock instant in `[issued_at, expires_at)`; equality with `expires_at` is expired. AI may create a request but cannot authoritatively confirm or write a calendar.

**Consequences:** False bookings and calendar races are reduced and all intermediate truth is visible. Conversion has an extra step and depends on staff responsiveness/customer delivery. A future calendar adapter may read/suggest or write only after explicit product approval, conflict/idempotency design, permissions, reconciliation, tests, and a superseding ADR.

### ADR-014: Provider-neutral channel adapters

**Status:** Accepted

**Context:** Widget and Telegram differ in authentication, event/delivery formats, and capabilities; Instagram and WhatsApp are planned. Core conversation policy must not branch by provider.

**Decision:** Verify provider input in its adapter, resolve trusted `channel_connection_id`/tenant, and normalize to canonical inbound/outbound contracts. Adapters declare capabilities and map typed errors/receipts. Core logic works on conversation/message contracts; language affects interpretation/presentation, not state rules.

**Consequences:** New channels can reuse lead/AI/booking flows and one contract suite. Provider quirks remain explicit, but the canonical contract must evolve compatibly. The system cannot promise a capability an adapter does not report.

### ADR-015: OpenTelemetry and OTLP observability

**Status:** Accepted

**Context:** HTTP, jobs, AI calls, and outbound delivery need correlated diagnostics without locking the product to a telemetry vendor or exposing PII.

**Decision:** Instrument web/API/worker with OpenTelemetry semantics and export OTLP to a deployment-selected backend. Use structured allowlisted logs, bounded-cardinality metrics, linked traces across jobs, stable correlation IDs, and separate immutable audit records. Raw conversation/prompt/contact content is excluded by default.

**Consequences:** Backends can change and async latency/failure/cost is attributable. Instrumentation, sampling, retention, redaction, and cardinality need governance; telemetry is not an audit ledger. Concrete backend/SLOs remain open.

### ADR-016: JSON Schema as runtime contract source of truth

**Status:** Accepted

**Context:** TypeScript types vanish at runtime, while REST, events, channels, and AI all cross untrusted/versioned boundaries. Duplicated interfaces would drift.

**Decision:** Maintain canonical JSON Schemas in `packages/contracts` and derive/generate TypeScript/OpenAPI representations where tooling supports it. Every external input/output and durable event has a schema/version and compatibility test. A semantic event name may have multiple accepted schema versions: consumers dispatch by `event_type` plus `schema_version` and verify the matching `schema_id`, deployed versions remain immutable, and producers migrate to the new version without reinterpreting historical events. For `lead.reopened`, V1 remains byte-compatible while new production uses the approved V2 discriminated payload.

**Consequences:** Runtime validation and language-neutral contracts share one source. Schema evolution/generation needs discipline and CI drift checks. Domain models remain richer and are mapped explicitly rather than becoming database/API DTOs.

### ADR-017: Tenant scoping plus PostgreSQL RLS defense-in-depth

**Status:** Accepted

**Context:** Every tenant-owned access path is security-critical; either application filters or RLS alone can be misconfigured. Connection pooling can leak session context if handled incorrectly.

**Decision:** Require organization scope in repository/application interfaces, derive it from trusted authentication/channel context, enforce tenant-consistent keys/constraints, and use PostgreSQL `ENABLE` plus `FORCE ROW LEVEL SECURITY` on tenant-owned tables as defense-in-depth. Set tenant context transaction-locally and reset by transaction completion; runtime roles do not receive bypass/table-owner privileges. Platform-operator repositories/roles are separate and audited.

**Consequences:** Two independent controls reduce IDOR/query mistakes. Migrations/tests/operations are more complex, and careless owner/bypass roles or pooled session state could defeat RLS. Cross-tenant matrices and pool-reuse integration tests are mandatory.

### ADR-018: Cloud-neutral container deployment and build-once promotion

**Status:** Accepted

**Context:** The hosting provider/region is unresolved, but environments, rollback, security, and reproducible artifacts need a deployable contract now.

**Decision:** Package web/API/worker as hardened OCI containers, use a managed PostgreSQL capability, inject validated environment configuration/secrets, and promote one signed image digest through staging to production. Keep target-specific IaC under `infra/deploy`.

**Consequences:** Hosting remains selectable and release provenance improves. “Cloud-neutral” is not identical behavior across providers; one target must still be selected, tested, documented, and operated before production.

## MVP scope and release boundaries

### P0: required for the first sellable, measurable workflow

- Multi-tenant organizations/memberships/RBAC with strict tenant scope and audit.
- Configured locations, services, exact prices, FAQs, hours, business/qualification policies, Uzbek/Russian/English presentation.
- Website widget and Telegram inbound/outbound adapters with signatures/origin controls, idempotency, rate limits, and duplicate/reorder safety.
- Lead/conversation/contact capture, factual FAQ/pricing, deterministic qualification, safe medical/non-authoritative refusal, and human handoff.
- Appointment preference/request, durable in-app staff inbox, staff accept/reject, customer confirmation via supported channel, expiry/cancel, and audited staff attestation when widget confirmation occurred offline.
- Staff conversation/review/configuration workflow. Optional external staff alert adapters are not required for P0 correctness because the in-app inbox is authoritative.
- Manual authorized attended/no-show and attributed-revenue outcome capture using exact money/currency, so ROI funnel analytics can be measured before CRM/calendar integrations.
- AI structured decisions with deterministic policy, multilingual release eval, safe provider failure, token/cost tracking, and a tenant/platform kill switch.
- Outbox/jobs/dead letters/reconciliation, PII-safe observability, analytics funnel, data minimization, consent evidence/withdrawal semantics, configurable retention defaults/fields, legal holds/audit, and a verified operator runbook capable of fulfilling applicable subject requests before launch; plus backups/restore, CI/CD, and security tests.

### P1: valuable after P0 evidence

- Email/SMS/other outbound staff alerts and delivery preferences.
- Productized consent withdrawal, subject export, and policy-driven deletion/anonymization APIs/workers (FR-023), unless launch-jurisdiction counsel elevates them to P0.
- Staff SLA/reminders, configurable customer-confirmation/staff-review reminders and expiry, richer assignment/routing, and an operator-facing dead-letter/retry UI. A fixed safe P0 offer expiry and protected runbook are still required.
- Richer reporting/cohorts and approved attendance/revenue import automation.

### P2 / explicitly excluded from V1

- AI-autonomous appointment confirmation or calendar writes.
- Instagram and WhatsApp production adapters after provider access/contract verification.
- Any external calendar read/availability/commit integration, CRM/practice-management synchronization, subscription billing/plans, or advanced campaign attribution.
- SSO administration/SCIM and attachment/file ingestion unless separately reprioritized with their security/privacy requirements.
- Autonomous medical diagnosis, treatment recommendation, guarantees, or clinical decision support.
- Generic no-code bot/workflow builder, arbitrary model tools/SQL, or user-authored executable prompts.
- Vector database/unstructured retrieval until ADR-012 revisit evidence exists.
- Microservices/event-stream platform, multi-region active-active writes, or a separate cache/queue merely for anticipated scale.
- Authoritative billing/revenue/discount arithmetic by an LLM; full subscription billing/marketplace is a separate approved scope.

## Codex-sized implementation roadmap

Each stage is a focused, reviewable change and must follow `AGENTS.md`. “Gate” means the stage is not marked complete until its evidence exists. File paths are likely targets, not authorization to create unrelated scaffolding.

| Stage / one outcome | Depends on | Likely files/modules | Acceptance criteria | Required tests | Completion gate |
| --- | --- | --- | --- | --- | --- |
| **S1 Workspace baseline:** reproducible empty monorepo | Approved Stage 0 | root workspace/TS/lint/test config, `apps/*`, package manifests, CI skeleton | Node 24/pnpm frozen install; apps/packages build with boundary rules; no product route | config/type/build smoke, boundary negative fixture | Clean install and required CI checks pass |
| **S2 Canonical contracts:** runtime schemas/errors/events | S1 | `packages/contracts` | Versioned JSON Schemas for IDs, errors, pagination, domain events, channel envelope, `AgentDecision`; generated types cannot drift | schema valid/invalid fixtures, compatibility snapshot | Contract package has one source and zero duplicate DTOs |
| **S3 Pure domain kernel:** values and all state machines | S2 | `packages/domain` | Organization/time/money/contact values; canonical lead/conversation/appointment/handoff transitions and events; `lead.reopened` V2 production with V1 read compatibility; explicit handoff/conversation dispositions and modes; confirmation bound to aggregate + offer versions and `[issued_at, expires_at)`; no I/O | exhaustive transition/property/time/money tests, V1/V2 event compatibility, disposition/mode/reassignment, dual-version and expiry-boundary tests | Invalid transitions, no implicit AI resume, and staff-vs-customer confirmation invariant proven |
| **S4a Tenant/configuration database foundation:** first reviewed migration slice | S2-S3 | database organization/membership/location/knowledge schema and migrations | Tenant/configuration tables and constraints exist; installed Drizzle workflow verified for partial/expression indexes, generated lexical-search vectors, range/exclusion constraints, functions and forced RLS with explicit SQL where needed | PostgreSQL migrate-from-zero and tenant/config constraints/features | Slice SQL reviewed; no unscoped table or assumed ORM API |
| **S4b Customer/workflow database foundation:** second migration slice | S4a | database contact/lead/conversation/message/appointment/outcome/handoff/notification schema | Customer workflow tables, transition/evidence history, exact money/time, dedupe and tenant composite references exist | clean/upgrade migration, workflow constraints, concurrent uniqueness | Slice SQL reviewed; no hidden JSON state or cross-tenant reference |
| **S4c Reliability/governance database foundation:** final initial-schema slice | S4a-S4b | database receipts/idempotency/outbox/AI/audit/privacy/analytics schema | Reliable processing, governance and analytics fact tables/indexes exist with bounded sensitive payloads | clean/upgrade migration, atomicity/uniqueness/retention constraints | Full initial schema maps to data specification and migrates cleanly |
| **S5 Tenant-safe persistence:** scoped repositories + RLS | S4a,S4b,S4c | database repositories/transactions/RLS, security test helpers | Tenant scope required; transaction-local RLS; operator path separate | two-tenant CRUD/list/count/export hostile matrix, pooled connection reuse | Zero cross-tenant access/mutation in suite |
| **S6 Staff identity/RBAC:** OIDC-to-membership path | S2,S5 | security, integrations/identity, API auth plugin | Valid OIDC maps to active app membership/role; disabled/revoked denied; org claim ignored | token/issuer/audience/JWKS rotation, role/IDOR/CSRF tests | Every private route uses trusted actor/tenant context |
| **S7 Business knowledge configuration API:** authoritative tenant facts | S3,S5,S6 | domain/application knowledge, private API | Owner/admin manage locations/services/prices/FAQs/hours/policies with revisions/audit | auth matrix, exact money/timezone, tenant/revision integration | AI-independent API returns only active authoritative tenant facts |
| **S8 Reliable async substrate:** outbox and pg-boss | S4c,S5 | database outbox, integrations/jobs, worker | Atomic intent, claims/leases/retry/DLQ/replay/reconciliation; workload queues | crash-point, duplicate, poison, fairness, replay audit tests | One logical effect under retries/restarts |
| **S9 Conversation/lead/contact application:** deterministic persistence | S3,S5,S8 | domain/application conversations/leads, API queries | One lead/conversation/message per logical inbound; approved active-lead/conversation grouping, phone/session sufficiency, contact/consent semantics; no AI yet | state/concurrency/idempotency/PII/grouping tests | Duplicate/reordered canonical messages cannot regress state or identity |
| **S10 Widget trust and intake:** secure widget vertical ingress | S2,S6,S8-S9 | web widget bootstrap, API widget routes, channel adapter | Opaque session/public credential + allowed origin resolves server-side tenant; approved session/reopen/body/rate/idempotency settings; message durably accepted | origin/forgery/replay/oversize/duplicate/reopen E2E | Tenant cannot be selected or crossed by widget input |
| **S11 Telegram adapter:** verified Telegram ingress/outbound | S2,S8-S9 | integrations/channels/telegram, webhook routes | Authenticated connection resolves tenant; approved bot ownership/thread grouping/limits; canonical normalize/send/status/errors | recorded contract fixtures, forgery/retry/reorder/thread/ambiguous send | Shared channel contract suite passes unchanged |
| **S12 AI orchestration harness:** safe provider-independent decision path | S2,S7,S9 | `packages/ai`, application policy, AI run schema/adapter | OpenAI Responses adapter uses `store:false`, schema output, bounded context/deadline; policy executes no unauthorized action | malformed/refusal/timeout/stale/tool/prompt injection deterministic suite | Safe fallback/handoff and zero direct protected mutation |
| **S13 Multilingual model selection:** pin evaluated model/budgets | S12 | `tests/ai-evals`, prompt/model/price/processor config | Luna/Terra viable candidates (and another only if justified) compared on the same EN/RU/UZ corpus, safety, latency, tokens/cost; provider contract/region/data controls approved; model pinned | full live eval plus deterministic regression | Red-line safety 100%; approved per-slice quality/cost/privacy thresholds documented and met |
| **S14 Grounded FAQ/pricing response:** first AI product slice | S7,S10-S13 | application conversation flow, AI context/prompt, channel renderer | Same-tenant active facts only; deterministic direct lookup when sufficient; missing facts hand off | all-language FAQ/price/missing/discount/service/medical/injection E2E/evals | Zero accepted invented authoritative fact in gate corpus |
| **S15 Qualification/contact/handoff workflow:** safe lead progression | S9,S12-S14 | domain/application leads/handoffs, worker, APIs | Configured fields drive qualification; human/safety request creates one handoff and `awaiting_staff` | multilingual ambiguity/phone/human/offensive/provider-down, concurrency | One deterministic state/event/audit/analytics outcome per command |
| **S16 Appointment request workflow:** staff-controlled booking states | S3,S5,S8,S15 | domain/application bookings, private API | Preference creates `requested`; staff accepts/rejects with state/version; no calendar write | full transition/race/tenant/timezone/idempotency suite | Nothing except customer action/attestation can reach `confirmed` |
| **S17 Authoritative staff inbox and private operations API:** staff can act | S6,S9,S15-S16 | private API queries/commands, notifications/inbox | Durable tenant-scoped inbox covers requests/handoffs; conversation review; manual attended/no-show/revenue outcome with audit | role/IDOR/pagination/concurrency/exact money/E2E | Staff can operate P0 with all optional alert providers disabled |
| **S18 Customer confirmation delivery:** close booking safely | S8,S10-S11,S16-S17 | channel renderers, worker handlers, booking commands | Acceptance durably queues confirmation; `customer_session`, `telegram`, or audited authorized `staff_attested_external` (`phone` or `in_person`) evidence confirms; expiry/retry visible | crash/ambiguous delivery/duplicate/late/cancel/source/method/attestation E2E | Confirmed implies allowed customer evidence and transition history |
| **S19a Staff UX:** operable Next.js staff surface | S7,S15,S17,S18 | `apps/web` staff routes, `packages/ui` | WCAG 2.2 AA EN/RU/UZ config, inbox, conversation, booking, handoff and outcome flows; APIs remain authority | component/accessibility/XSS/CSP/approved-browser staff E2E | Staff journeys/configuration pass with no client-only policy |
| **S19b Widget UX:** embeddable customer surface | S10,S14,S15,S16,S18 | `apps/web` widget routes/loader, `packages/ui` | WCAG 2.2 AA EN/RU/UZ conversation/request/confirmation/handoff flow with secure embedding and degraded states | component/accessibility/XSS/CSP/origin/approved-browser widget E2E | Widget journeys and AA/security gates pass |
| **S20 Observability, analytics, and cost controls:** measurable funnel | S8,S17,S19a,S19b | observability, projectors, dashboards/runbooks | Correlated PII-safe telemetry; canonical funnel through attendance/revenue; cohort/baseline/sample-size definitions approved; >=99% AI usage/cost coverage; alerts/budget fallback; Stage 0 SLI definitions instrumented | redaction/cardinality/projector replay/funnel reconciliation/cost/SLO tests | Dashboard reconciles synthetic source events, exposes planning SLOs, and has no PII scan findings |
| **S21a Privacy launch operations:** fulfill applicable rights safely | S6-S20 | privacy policy/configuration, consent/audit, operator runbooks | Minimization, consent evidence/withdrawal semantics, configurable retention/defaults, legal holds and audited operator subject-request procedure are documented | synthetic operator export/anonymization drill, consent/hold/retention tests | Runbook fulfills launch-law requests; counsel decision on FR-023 automation recorded |
| **S21b Security hardening:** close launch threat controls | S21a | security configuration, rate/rotation/operator controls, threat runbooks | Threat-model mitigations, secrets/rotation/rates and operator access implemented and reviewed | full tenant/threat suite, secret scan, penetration findings regression | No unresolved critical/high launch finding or unowned exception |
| **S22a Staging delivery:** deploy the immutable release safely | S1,S4c,S8,S20,S21a,S21b | containers, infra/deploy, CI/CD, deploy/rollback runbooks | Build-once deploy, one-shot migrations, probes/drain, secret injection and progressive rollback work in staging | migration rehearsal, deployment interruption, rollback, staging smoke | Same image digest promotes; deploy and rollback gates pass |
| **S22b Recovery and capacity rehearsal:** prove operational objectives | S22a | backup/restore, outage and capacity runbooks/reports | Isolated restore, provider/database failure behavior, and Stage 0 load profile are exercised | restore/integrity, outage/backlog drain, load/noisy-tenant tests | Measured RPO/RTO, capacity, rollback and degradation evidence meets approved targets |
| **S23 Production readiness review:** evidence-based go/no-go | All P0 stages | release evidence/docs only | SLOs and provisional database RPO <= 5m/RTO <= 60m approved or replaced; on-call/providers/retention approved; capacity, multilingual eval, security, restore, cost and all P0 journeys current | full release matrix; no new product code in review | Named approvers record go/no-go; no “production ready” claim without evidence |

Optional external staff-alert adapters are separate P1 tasks. Instagram/WhatsApp, calendar/CRM sync, billing, and other P2 capabilities are separate later tasks; none is silently appended to an existing stage.

## Cost architecture and Stage 13 model-selection gate

### Dated model-price scenarios

The official OpenAI model comparison checked on **2026-08-30** listed these prices per one million tokens. They are scenario inputs only and must be re-verified before any budget or commercial decision: [OpenAI model comparison](https://developers.openai.com/api/docs/models/compare).

| Candidate | Input | Cached input | Output | Architecture use |
| --- | ---: | ---: | ---: | --- |
| GPT-5.6 Luna | $0.20 | $0.02 | $1.20 | Low-cost candidate for multilingual eval |
| GPT-5.6 Terra | $2.00 | $0.20 | $12.00 | Higher-capability comparison candidate |
| GPT-5.6 Sol | $4.00 | $0.40 | $20.00 | Consider only if eval evidence justifies incremental quality/cost |

For an illustrative single call with 3,000 uncached input and 500 output tokens (not a measured product workload), the listed rates imply approximately $0.0012 Luna, $0.012 Terra, or $0.022 Sol. Real cost multiplies by AI calls, retries, cache eligibility, provider pricing changes, and language/context distribution. It excludes messaging, compute, database, telemetry, support, tax, and margin.

Application accounting uses provider-reported token categories and a dated/versioned price catalog:

```text
estimated_cost =
  (uncached_input_tokens × input_rate
   + cached_input_tokens × cached_input_rate
   + output_tokens × output_rate) / 1,000,000
```

The calculation uses integer micros/exact decimals and records unknown rather than zero when usage is unavailable. Provider invoices are reconciled to internal estimates.

### Model selection and operating budgets

S13 pins a supported model only after the same versioned Uzbek/Russian/English corpus measures:

- red-line factual, medical, tenant, tool, and booking safety;
- intent/extraction and handoff quality per language/category;
- latency distribution and provider failure behavior;
- input/output tokens, calls/retries per resolved conversation, and cost per qualified lead/booking request scenario.

The cheapest model that meets all approved per-slice thresholds wins; aggregate quality cannot hide a failing language or safety slice. Routing different models by task is postponed unless one pinned model cannot meet both safety/quality and cost goals, because routing increases evaluation and operational surface.

Before production, owners must set platform and per-tenant daily/billing-period/velocity budgets, per-conversation spend, maximum context/output/calls per run and conversation, warning thresholds, and hard-limit policy. At a hard AI limit, the system preserves inbound messages and existing booking/customer confirmation flows, uses reviewed deterministic templates, and opens human handoff; it never silently drops work or lets the model exceed an authorization boundary. A global and per-tenant kill switch is audited.

### Cost minimization without lowering correctness

- Answer exact structured FAQ/price lookups deterministically when interpretation is unnecessary.
- Send only tenant-scoped, relevant, revisioned facts and bounded structured conversation state; do not replay unlimited transcripts.
- Use `store:false`; do not pay for provider-hosted conversation state the application cannot govern.
- Allow at most two transient AI retry attempts, one invalid/incomplete repair/retry, and one stale-state recompute under a single end-to-end counter; account for all usage and prevent nested SDK/job retries from multiplying it.
- Do not cache AI responses across tenants. Tenant-local deterministic caches include organization, locale, fact revision, and policy revision.
- Use PostgreSQL for jobs/analytics initially; avoid Redis/Kafka/vector infrastructure until evidence pays for it.
- Apply PII-safe sampling/retention to telemetry and archive data under policy.
- Compare cost per successful business outcome, not token price alone; excessive handoff or incorrect answers can cost more than inference.

## Future integration seams

| Integration | Existing seam | Preconditions / invariant |
| --- | --- | --- |
| Instagram / WhatsApp | Canonical `ChannelAdapter` verify/normalize/send/capabilities contract and shared fixtures | Provider access/policy verified; tenant connection trusted; same idempotency/security suite; core conversation unchanged |
| Email/SMS staff alerts | `NotificationSender` port fed by outbox | In-app inbox remains authoritative; failure cannot lose/accept a booking; consent/template/delivery-cost rules approved |
| External calendars | `CalendarProvider` capability interface and appointment external-reference fields | Separate ADR; scoped OAuth, timezone/conflict/idempotency/reconciliation, staff authority, audit; no AI direct write |
| CRM | Versioned domain/analytics events and tenant-scoped command/import ports | Conflict/source-of-truth, consent/deletion, mapping, retry and replay policy approved |
| Analytics warehouse/BI | Versioned PII-minimized `analytics_events` export adapter | Per-tenant access, deletion/pseudonymization, schema compatibility and reconciliation retained |
| Alternate AI provider/model | `AIProvider` structured-decision port and eval corpus | Equivalent schema/refusal/usage/store/privacy capability; full multilingual/policy/security gate passes |
| Vector/unstructured knowledge | `KnowledgeSource` retrieval port and fact references | ADR-012 revisit triggers met; ingestion trust, tenant isolation, deletion/reindex, citations and evals approved |
| Enterprise SSO/SCIM | OIDC identity adapter plus app-owned membership lifecycle | Provider contract, domain ownership mapping, deprovisioning/MFA/audit behavior tested |
| Subscription billing | Exact usage/cost facts and billing provider port | Plans/taxes/currency/refunds/webhook/idempotency/legal rules specified; LLM never authoritative |
| Outbound customer webhooks | Versioned domain event contracts and outbox | Tenant signing secrets, endpoint verification, retry/DLQ/replay, filtering/privacy and quotas defined |
| Attachments/knowledge uploads | Channel capability metadata and a future object/scan port | Malware/content scanning, size/type, retention, consent, prompt-injection and safe rendering designed first |
| External attendance/revenue | Outcome command/source fields and versioned analytics facts | Source precedence, corrections/refunds/currency and reconciliation rules approved; AI cannot infer outcome |

An adapter cannot weaken tenant resolution, authorization, state transitions, schema validation, audit, idempotency, or human booking authority. If a provider cannot support the required invariant, that capability remains disabled.

## Risk register

Probability and impact are qualitative launch estimates (`L`, `M`, `H`) and must be revisited with evidence. Priority reflects their combination and safety significance.

| ID | Category | Risk | Probability | Impact | Priority | Mitigation and detection |
| --- | --- | --- | :---: | :---: | :---: | --- |
| R1 | Security | Missing scope/RLS error exposes or mutates another tenant | M | H | Critical | Trusted tenant context, scoped repository APIs, tenant FKs/RLS, separate operator role, exhaustive two-tenant tests, security alert/audit |
| R2 | AI/product | Model invents price/service/hours/availability/guarantee | H | H | Critical | Structured authoritative facts/references, deterministic policy/render checks, missing-fact handoff, multilingual red-line eval, kill switch |
| R3 | Safety | Medical question receives diagnosis/treatment/guarantee | M | H | Critical | Administrative-only policy, refusal/escalation templates, action allowlist, medical adversarial evals and sampled review |
| R4 | Security/AI | Customer or knowledge prompt injection causes disclosure/tool abuse | H | H | Critical | Treat text as data, bounded context, no secrets/tools in prompt, schema + independent policy, malicious-knowledge tests, zero direct SQL/state tools |
| R5 | Booking | Staff acceptance/delivery is misreported as confirmed | M | H | Critical | Explicit four-step state machine, customer evidence/attestation only, wording policy, transition constraints, race/E2E tests, reconciliation |
| R6 | Reliability | Duplicate/reordered webhook duplicates leads/bookings/messages | H | H | Critical | Signature/freshness, unique external IDs, inbox/idempotency, aggregate locks/versions, crash/reorder/concurrency tests |
| R7 | Privacy | PII/health text leaks through logs, traces, evals, dead letters, support export | M | H | Critical | Allowlisted telemetry, no raw content, redaction tests/scans, access audit/retention, synthetic evals, incident runbook |
| R8 | Identity | Account takeover or stale membership grants staff access | M | H | High | OIDC validation, provider MFA/session policy, app-owned active membership/RBAC, revocation tests, audit/anomaly monitoring |
| R9 | Integration | Compromised/revoked bot/provider token affects traffic | M | H | High | Envelope encryption/least privilege/rotation, connection-scoped breaker/disable, provider error alert, containment/runbook |
| R10 | Reliability | AI/provider outage blocks immediate responses | H | M | High | Async durable intake, bounded timeouts/retries/breaker, localized safe template/handoff, provider telemetry and optional future adapter |
| R11 | Operations | Outbox/job backlog delays handoff or customer confirmation | M | H | High | Workload priorities, oldest-age SLI, bounded concurrency/fairness, DLQ/reconciliation, scale/runbook tests |
| R12 | Data | Migration locks/corrupts data or prevents rollback | L-M | H | High | Expand/contract, rehearsal on representative data, advisory lock, compatibility range, backup/restore, forward repair, approval |
| R13 | Data/ops | Backup exists but cannot meet restore objective | M | H | High | Managed PITR, isolated scheduled restore/integrity/E2E drill, measured RPO/RTO alert and runbook |
| R14 | Cost | Token/retry abuse or model choice causes margin/spend overrun | M-H | H | High | Rate/usage budgets, bounded context/calls/retries, dated price catalog, per-tenant/global kill switch, cost/outcome dashboard and alerts |
| R15 | AI/product | Uzbek/Russian quality trails English or drifts after change | M-H | H | High | Native fixtures/reviewers, per-language gates, pinned prompt/model, scheduled live eval, no aggregate masking |
| R16 | Product | Staff fail to monitor/process in-app requests promptly | M | H | High | Clear authoritative inbox/age indicators, handoff/response metrics, optional alert adapters P1, onboarding/SLO ownership; measure abandonment |
| R17 | Analytics | Funnel/revenue report is wrong, eroding ROI trust | M | H | High | Canonical versioned event definitions, exact money/source/actor, idempotent projection/rebuild, source reconciliation, labeled cohorts/currencies |
| R18 | Compliance | Jurisdiction, consent, retention, or health-data obligations are unresolved | M | H | High | Decide launch jurisdictions before production, configurable policies with approved defaults, export/delete/legal hold tests, counsel/product sign-off |
| R19 | Reliability | Ambiguous provider timeout sends duplicate customer messages | M | M-H | High | Provider idempotency/external reference, status reconciliation, logical notification uniqueness, attempt audit and contract tests |
| R20 | Scalability | PostgreSQL queue/analytics/transactions contend under load | M | M-H | Medium-High | Separate pools/workload queues, indexes/batching/retention, capacity/pool/lock metrics; introduce partition/broker only via evidence/ADR |
| R21 | Security | Widget credential/origin/rate control is abused for cost or data enumeration | H | M | High | Public opaque credential not tenant authority alone, domain allowlist, sessions/nonces, layered rates/budgets, non-enumerating errors, abuse metrics |
| R22 | Product | Configured knowledge is stale/wrong, causing grounded but bad answers | M | H | High | Revision/audit/publish workflow, staff ownership/freshness indicators, effective dates, easy handoff; do not label AI as source of truth |
| R23 | Integration | Telegram/Meta/provider API or policy changes break adapters | M | M-H | Medium-High | Capability/contract adapters, pinned/tested APIs, sandbox fixtures, deprecation monitoring, breaker/fallback, provider-specific runbook |
| R24 | Operations | High-cardinality/verbose telemetry causes cost spike or outage | M | M | Medium | Attribute allowlist, no tenant IDs in metrics, sampling/retention/budgets, cardinality/cost CI and dashboards |
| R25 | Security | Platform operator path becomes an unaudited tenant bypass | L-M | H | High | Separate identity/role/repository, just-in-time reason/approval, immutable audit, alert/review, no routine use |
| R26 | Time | Timezone/DST handling creates wrong appointment preference/expiry | M | H | High | UTC instants + location zone, explicit ambiguous/nonexistent local time handling, clock port and DST/property tests |
| R27 | Product | Manual attendance/revenue is incomplete or manipulated | M | M-H | Medium-High | Role/source/audit/correction rules, missing-data indicators, reconciliation with future source, never infer zero or AI-derived revenue |
| R28 | Vendor | OpenAI or hosting coupling makes change expensive | M | M | Medium | Provider/OTLP/channel/repository ports, application-owned state/contracts, cloud-neutral images, periodic adapter/eval evidence |
| R29 | Delivery | Roadmap expands into generic chatbot/integration platform before P0 | H | M-H | High | Stage gates, P0/P1/P2 boundaries, one outcome per change, explicit ADR/product approval for additions |
| R30 | Security | Supply-chain compromise enters build/runtime | M | H | High | Frozen lockfile, minimum CI permissions, pinned actions/base digests, SBOM/sign/provenance, scans and patch SLA |

## Cross-document consistency review

The following apparent contradictions are resolved as normative rules:

1. **“Staff confirmation means booked” versus required customer confirmation:** staff acceptance is intermediate. Final `confirmed` requires customer confirmation/evidence. This refines the constitution's abbreviated flow without allowing AI/calendar authority.
2. **Staff notification requirement versus provider uncertainty:** the durable in-app staff inbox is P0 and authoritative; email/SMS/other outbound alerts are optional adapters. Alert failure never loses a request.
3. **Immediate response versus slow/unavailable AI:** webhook/message intake is durably acknowledged immediately; customer response is asynchronous with measured latency and a reviewed safe fallback/handoff.
4. **AI recommends actions versus deterministic state:** `AgentDecision` proposes only schema-allowed actions; application policy re-loads trusted tenant/state/facts and alone executes commands.
5. **At-least-once delivery versus “no duplicates”:** physical deliveries/attempts may repeat; uniqueness, idempotent consumers, reconciliation, and state/version guards guarantee one logical domain effect.
6. **Business ROI versus no external CRM/calendar:** authorized manual attended/no-show and attributed-revenue capture is P0, with source/audit/exact money. Later integrations reuse the same commands/events.
7. **Three languages versus one domain:** schemas, qualification, prices, permissions, and state machines are shared; language changes interpretation/rendering and eval slices only.
8. **Analytics/privacy versus authoritative history:** analytics events contain bounded dimensions/no raw text, are derived from canonical domain events, and support erasure/pseudonymization under policy.
9. **Cloud-neutral architecture versus a deployable plan:** OCI/managed-PostgreSQL/OTLP capability contracts are accepted, but one concrete target/region and tested IaC remain a production prerequisite.
10. **Stage 3 state/event ambiguity:** `lead.reopened` V1 remains immutable and V2 carries the two exact transition variants; Conversation create/resolve/close use specialized events instead of the generic status event; handoff terminal coupling always records one explicit disposition with fixed automation modes and no implicit resume; confirmation matches both aggregate and offer versions and uses `[issued_at, expires_at)` with an explicit clock; reassignment is a versioned `assigned -> assigned` transition whose ledger preserves both assignees.
11. **No vector store versus multilingual grounding:** V1 retrieves bounded structured same-tenant facts through PostgreSQL and tests recall; measured failure triggers a new evaluated/security-reviewed ADR, not speculative infrastructure.

## Stage entry and release gates

Stage 1 may begin after the architecture package uses one canonical state/role/error vocabulary, all ADRs above are accepted by the product/engineering owner, and the P0/open-question ownership is recorded. Stage 1 is repository/tooling bootstrap only; it is not authorization to implement the entire roadmap.

Production cannot be recommended until S23 has evidence for tenant isolation, migration/rollback, restore against approved RPO/RTO, P0 E2E journeys, live multilingual model/prompt eval, threat mitigations, capacity/SLO, telemetry/on-call, retention/legal decisions, provider credentials/contracts, and budget/kill switches.

## Open questions and decision deadlines

None of these questions blocks **S1 workspace bootstrap**. Before S1, the product and engineering owners only need to record acceptance of the Stage 0 baseline and acknowledge the decision-owner roles below. A question becomes blocking when its named stage reaches the gate without a recorded decision.

| Question | Decision owner role | Why it cannot be invented | Needed by |
| --- | --- | --- | --- |
| Which launch country/jurisdiction, data residency, consent wording, retention/deletion/legal-hold rules apply? | Product + privacy/legal | Legal/privacy obligations and data model operations depend on it | Before S21a; preferably before the affected S4a-S4c fields |
| Does launch-jurisdiction counsel require productized automated subject export/deletion/retention in P0, or is the verified audited operator runbook sufficient until P1/FR-023? | Privacy/legal + product | The architecture must fulfill applicable rights, but product priority cannot override launch law | Decide before S21a scope; verify before S23 |
| What exact qualification fields/rules are the launch defaults, and who may edit/publish them? | Product + clinic operations | Changes lead conversion semantics and eval fixtures | Before S7/S15 |
| Is a phone number mandatory for an appointment request, or can a bound widget/Telegram identity suffice for selected tenants? | Product + privacy | Contact sufficiency changes validation, consent, and reachability behavior | Before S9/S16 |
| What is the active-lead uniqueness scope, and what widget reopen/Telegram thread grouping windows apply? | Product + domain architecture | Database uniqueness and message-to-conversation routing cannot be inferred | Before S4b constraints and S9-S11 |
| What exact permission bundles/location restrictions apply to `owner`, `admin`, `staff`, and `analyst`, including price/content publishing? | Product + security | Role names are fixed, but least-privilege capabilities affect every private command | Before S6/S7 |
| Which OIDC provider, MFA/session policy, invitation/recovery flow, and platform-operator approval process? | Security + platform | Identity assurance and contracts are provider/product decisions | Before S6 |
| Is Telegram one platform bot or a tenant-owned bot per connection, and who handles token rotation/ownership? | Product + integrations | Affects onboarding, provider limits, credentials, and support | Before S11 |
| What customer-confirmation UX, legal sufficiency, offer/staff-review expiry, reminder, cancel/reschedule/new-offer rules apply per widget and Telegram? | Product + privacy/legal + domain | Determines valid state transitions and legal/audit evidence; configured values still need approved defaults | Before S16/S18 |
| Which optional staff-alert provider(s) and preference/escalation rules are desired after the P0 in-app inbox? | Product + integrations | Provider/commercial/consent choice; not required for correctness | Before the relevant P1 stage |
| How are attended/no-show, recognized revenue, corrections/refunds, currency/tax, and attribution defined in V1? | Product + finance/analytics | ROI metrics otherwise become misleading | Before S17/S20 |
| What conversion baselines, cohort window, minimum sample size, and claim-review rules make ROI reporting/marketing defensible? | Product + analytics | A technically correct metric can still support a misleading claim | Before S20/S23 |
| Do tests validate the Stage 0 load, availability/latency/outbox, and database RPO <= 5m/RTO <= 60m targets; which are approved/replaced, and what support/on-call, provider exclusions, skew, and backup retention apply? | SRE + product | Planning targets are not demonstrated capacity/SLA claims; sizing, restore evidence, and alerts need approved business objectives | Before S20/S22 |
| Which cloud/region and managed PostgreSQL, container runtime, edge/WAF, secrets, and OTLP backend are approved? | Platform/SRE + security | Deployment/IaC and data residency cannot remain abstract for production | Before S22 |
| What live-model quality/latency/cost thresholds, per-turn/conversation limits, tenant budgets, overage behavior, and reviewers are approved? | AI engineering + product/finance | Model selection and commercial margin require measured tradeoffs | Before S13 and final budgets before S20 |
| What widget allowed-origin/bootstrap/session/reopen policy, message-size/rate/idempotency-retention defaults, and supported browsers apply beyond the fixed WCAG 2.2 AA target? | Product + frontend/security | Security, API configuration, storage, and E2E matrices depend on embedding requirements | Before S10/S19b |
| What staff data-visibility rules apply to sensitive conversation/health-adjacent content, exports, and support access? | Privacy + security + product | Least privilege and privacy UI cannot be inferred from generic roles | Before S17/S19a/S21b |
| Who owns service/price/FAQ freshness and publishing, and are changes effective immediately or scheduled? | Product + clinic operations | Grounded AI can still repeat stale authoritative data | Before S7/S14 |
| Which reviewed emergency/medical safety wording is approved in Uzbek, Russian, and English for each launch jurisdiction? | Clinical safety + privacy/legal + product | The system is administrative, but unsafe wording cannot be improvised by a model or engineer | Before S14/S21b |
| Are the OpenAI processor terms, region, retention/data controls, and production-data suitability approved for launch content? | Privacy/legal + security + AI engineering | `store:false` does not itself answer processor, residency, or healthcare suitability questions | Before live data; gate S13/S21a |
| At launch volume, do message/provider payloads remain in encrypted PostgreSQL or is separately governed object storage required? | Data/platform + privacy | It affects retention, deletion, backups, threat surface, and cost | Decide before S4b storage schema is frozen |
