# Stage 0 Architecture Package

Status: Audited Stage 0 baseline — conditional Stage 1 entry

Architecture baseline date: 2026-08-30

## Purpose

This package is the implementation-independent specification for the V1
multi-tenant AI Lead-to-Booking SaaS. Stage 0 creates documentation and contracts
only. It does not authorize application code, database deployment, provider
connections, or production rollout.

The package is normative where it uses **must**, **must not**, **required**, or an
explicit invariant. Items marked **proposed**, **assumption**, or **open question**
require the stated validation before they become contractual.

## Read order

1. [Product and journeys](01-product-and-journeys.md)
2. [System architecture](02-system-architecture.md)
3. [Domain model and state machines](03-domain-and-state-machines.md)
4. [Data model](04-data-model.md)
5. [API and channel contracts](05-api-and-channel-contracts.md)
6. [AI and booking architecture](06-ai-and-booking.md)
7. [Multi-tenancy, security, and privacy](07-tenancy-security-privacy.md)
8. [Reliability, observability, and analytics](08-reliability-observability-analytics.md)
9. [Test strategy](09-test-strategy.md)
10. [Deployment and repository structure](10-deployment-and-repository.md)
11. [ADRs, implementation roadmap, risks, costs, and open questions](11-adrs-roadmap-risks.md)
12. [Stage 0 audit and traceability](12-stage-0-audit.md)

Repository-wide engineering constraints remain in [AGENTS.md](../../AGENTS.md).

## Source-of-truth precedence

When two statements appear inconsistent, use this order and record the discrepancy
in the audit rather than silently choosing at implementation time:

1. approved product decisions and legal/compliance constraints;
2. explicit invariants in this index and the domain/state-machine specification;
3. versioned API and data contracts;
4. component and deployment guidance;
5. non-normative examples and diagrams.

ADRs explain why a decision exists. They do not override a later approved product
decision; superseded ADRs are retained and linked to their replacements.

## Canonical V1 invariants

- A trusted server-side lookup determines `organization_id`; anonymous/client body
  data never does.
- Every tenant-owned access is application-scoped and protected by PostgreSQL RLS as
  defense in depth.
- AI output is untrusted, schema-constrained interpretation. Deterministic code owns
  authorization, policy, prices, calculations, and state changes.
- Structured, active, versioned business records are authoritative. Missing facts
  produce a qualified response or human handoff, never an invented answer.
- V1 never writes to an external calendar and never claims unverified availability.
- A booking is final only after a request is accepted by staff and confirmed by the
  customer.
- Domain state and outbox intent commit atomically; external effects are retryable
  and idempotent.
- Webhook delivery is treated as duplicateable, delayed, reordered, and replayable.
- Healthcare behavior remains administrative; the system does not diagnose or give
  autonomous medical advice.
- Uzbek, Russian, and English share one domain model and policy system.
- Logs, traces, and metrics do not contain message bodies, phone numbers, access
  tokens, or other unnecessary PII.

## Canonical terminology

| Term | Meaning |
|---|---|
| Organization | Tenant and top-level data-isolation boundary. |
| Location | A business site with its own timezone, hours, services, and staff scope. |
| Contact | A tenant-local person record; it is not globally shared across organizations. |
| Lead | The tenant-local commercial workflow for a contact. |
| Conversation | A channel-bound interaction stream linked to a lead when known. |
| Appointment request | A requested service/location/time preference; it is not availability or a booking. |
| Staff acceptance | Staff approval of exact proposed details; customer confirmation is still required. |
| Confirmed booking | Final V1 outcome after customer confirmation; no external calendar write is implied. |
| Handoff | A durable request for human ownership of a conversation. |
| Agent decision | Schema-valid AI proposal that still requires deterministic policy validation. |
| Channel connection | Tenant-owned configuration/credential reference for one messaging endpoint. |
| Platform operator | Control-plane actor; never an implicit tenant member. |

## Deliverable coverage

| Stage 0 requirement | Primary document |
|---|---|
| 1. Product specification | `01-product-and-journeys.md` |
| 2. User journeys A–N | `01-product-and-journeys.md` |
| 3. System architecture and lifecycles | `02-system-architecture.md` |
| 4. Domain model | `03-domain-and-state-machines.md` |
| 5. State machines | `03-domain-and-state-machines.md` |
| 6. Relational database design and ERD | `04-data-model.md` |
| 7. REST/OpenAPI contract | `05-api-and-channel-contracts.md` |
| 8. Channel adapter contract | `05-api-and-channel-contracts.md` |
| 9. AI architecture and `AgentDecision` | `06-ai-and-booking.md` |
| 10. Booking architecture | `06-ai-and-booking.md` |
| 11. Multi-tenancy | `07-tenancy-security-privacy.md` |
| 12. Threat model and security | `07-tenancy-security-privacy.md` |
| 13. Privacy | `07-tenancy-security-privacy.md` |
| 14. Reliability | `08-reliability-observability-analytics.md` |
| 15. Observability | `08-reliability-observability-analytics.md` |
| 16. Analytics | `08-reliability-observability-analytics.md` |
| 17. Test strategy and multilingual AI evals | `09-test-strategy.md` |
| 18. Deployment architecture | `10-deployment-and-repository.md` |
| 19. Repository structure | `10-deployment-and-repository.md` |
| 20. Architectural decisions | `11-adrs-roadmap-risks.md` |
| 21. Implementation roadmap | `11-adrs-roadmap-risks.md` |
| 22. Risk register | `11-adrs-roadmap-risks.md` |
| 23. Open questions | `11-adrs-roadmap-risks.md` |
| Cross-document consistency and requested audit | `12-stage-0-audit.md` |

## Audit dimensions

The final Stage 0 gate explicitly audits:

- requirements traceability;
- domain model completeness and invariants;
- relational integrity and access patterns;
- tenant resolution, authorization, and isolation;
- AI authority boundaries and safe failure;
- state-machine completeness and terminology;
- API and channel boundaries;
- security and privacy controls;
- edge cases and degraded operation;
- testability and fitness functions;
- scalability triggers and bottlenecks;
- MVP scope control;
- cost drivers, budgets, and kill switches;
- future channel, calendar, identity, notification, and analytics integrations.

Stage 1 entry is governed by the verdict in `12-stage-0-audit.md`: it requires no
unresolved P0 contradiction, repository-owner acceptance of the ADR baseline,
and a decision owner plus stage deadline for each implementation-affecting open
question.
