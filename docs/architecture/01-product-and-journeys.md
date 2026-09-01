# Product specification and user journeys

Status: Stage 0 normative specification

Audience: product, engineering, security, operations, QA

Initial release: V1 / MVP

## 1. Product definition

The product is a multi-tenant AI lead-to-booking workflow for high-value
appointment businesses. It responds to inbound website-widget and Telegram
messages, answers only from authoritative business data, qualifies a lead,
captures contact and scheduling preferences, creates an appointment request,
and coordinates staff and customer confirmation.

It is not a general-purpose chatbot and it is not an autonomous scheduling
agent. In V1 an appointment becomes confirmed only after both of these facts
are recorded:

1. staff accepted the request and initiated a customer confirmation request;
2. the customer explicitly confirmed the offered appointment.

The canonical appointment progression is:

`requested -> staff_accepted -> awaiting_customer_confirmation -> confirmed`

`rejected`, `cancelled`, and `expired` are terminal alternatives. Staff
acceptance alone must never be displayed, emitted, or measured as a confirmed
booking.

## 2. Problem

Appointment businesses lose valuable leads when staff cannot answer
immediately, repeat answers are inconsistent, conversations are not followed
through to an actionable request, or channel history cannot be connected to
business outcomes. Generic chatbots add a second risk: plausible but false
answers about price, services, availability, medical matters, or guarantees.

The product must reduce response delay and administrative work without
delegating business authority to a language model. Every state change,
authorization decision, price, and booking decision remains deterministic and
auditable.

## 3. Initial ICP and rollout assumptions

### 3.1 Initial ICP

- Dental and aesthetic clinics with one or more locations.
- High-value, appointment-led services where a missed lead has material cost.
- Teams that currently handle website or Telegram inquiries manually.
- Businesses able to maintain structured services, prices, FAQs, hours, and
  qualification policy.
- Businesses willing to keep a staff member responsible for accepting or
  rejecting appointment requests.

### 3.2 Assumptions to validate during pilots

- Most routine pre-booking questions can be answered from small, structured
  tenant knowledge rather than semantic retrieval infrastructure.
- A first useful response within seconds materially improves engagement.
- Staff will review a clearly prioritized request queue.
- Customers can explicitly confirm through the originating channel or another
  verified contact method.
- The business can define what “qualified” means without medical diagnosis.
- Uzbek, Russian, and English cover the first launch cohort.

These are product hypotheses, not architectural facts. Pilot metrics must be
segmented by organization, channel, language, and campaign before conclusions
are generalized.

## 4. Users, actors, and roles

| Actor / role | Needs | Permitted V1 behavior |
| --- | --- | --- |
| Anonymous lead | Fast, accurate answers without an account | Start a widget session, send messages, receive factual answers, request a human |
| Identified lead / customer | Continue a conversation and request an appointment | Provide contact details and consent, state preferences, confirm or decline a staff-accepted offer |
| Receptionist / staff | Process leads and requests | Read assigned/permitted conversations, reply, claim handoffs, accept or reject requests |
| Location-scoped staff/admin | Oversee one or more permitted locations | Capabilities come from `staff` or `admin` plus membership location scope, not a separate persisted role |
| Organization admin | Configure the tenant | Manage membership, locations, knowledge, policies, channel connections, allowed widget origins, and organization settings |
| Organization owner | Be accountable for commercial results | Admin permissions plus ownership/billing decisions when billing is introduced |
| Platform support operator | Resolve platform incidents without becoming a tenant user | Use a separately authorized, audited support path; no default access to message content or tenant mutation |
| Channel provider | Deliver and receive channel messages | Access only signed/provider-authenticated integration endpoints |
| AI provider | Return a schema-constrained interpretation/proposed response | Has no tenant resolution, authorization, persistence, or side-effect authority |
| Background worker | Deliver durable side effects | Execute only validated, persisted jobs with bounded service credentials |

Canonical membership roles are `owner|admin|staff|analyst`. Exact permission
grants are centralized policy, not string comparisons scattered through
handlers. Membership always binds a user to an organization and optionally a
location scope. `platform_operator` is not a tenant membership role.

## 5. Primary value proposition

For appointment businesses, the product converts more inbound interest into
staff-reviewed booking requests by providing immediate multilingual responses,
consistent factual information, structured lead qualification, reliable
handoff, and attributable funnel analytics. It does this while keeping tenant
data isolated and keeping booking, security, and business decisions outside
the model.

## 6. Product principles

1. **Accuracy before fluency.** If authoritative data does not support an
   answer, say so and offer a human.
2. **Workflow before chat.** Each response advances or safely pauses a defined
   lead, handoff, or appointment process.
3. **Human authority over bookings.** The model can propose an appointment
   request; staff accepts or rejects it; the customer then confirms.
4. **One domain across languages and channels.** Language and channel adapters
   affect input/output, not business rules.
5. **Privacy by default.** Collect only needed data, redact telemetry, and
   support retention, export, and erasure policy.
6. **At-least-once delivery, effectively-once effects.** Duplicate and
   reordered channel deliveries cannot duplicate leads, messages, requests, or
   notifications.
7. **Configuration is authority.** Structured services, prices, FAQs, hours,
   and policy are versioned business records; free-form external text is data.

## 7. Core use cases

- Respond to a new lead in Uzbek, Russian, or English.
- Answer supported FAQs and show authoritative service prices or price ranges.
- Explain that unavailable or unknown facts need staff confirmation.
- Collect policy-defined qualification facts without diagnosis.
- Capture and normalize a phone number with explicit purpose/consent evidence.
- Collect location, service, time-zone-aware date/time preference, and notes.
- Create exactly one appointment request for one intentional submission.
- Notify eligible staff and expose a prioritized request queue.
- Record staff acceptance or rejection with reason and audit attribution.
- Ask the customer to confirm a staff-accepted offer.
- Mark the request confirmed only on explicit, attributable customer consent.
- Escalate by customer request, safety rule, missing authority, or provider
  failure.
- Let authorized staff review and reply to a conversation.
- Let authorized tenant administrators maintain structured knowledge.
- Measure progression from inbound conversation through revenue attribution
  without using analytics projections as transactional authority.

## 8. Functional requirements

| ID | Requirement | Priority |
| --- | --- | --- |
| FR-001 | Resolve the tenant from a server-trusted channel connection or public widget key plus allowed origin; never accept a client-selected `organization_id` as authority. | P0 |
| FR-002 | Authenticate provider webhooks, apply payload limits, persist a receipt, and deduplicate by connection and external event/message ID before processing. | P0 |
| FR-003 | Normalize widget and Telegram input into one canonical inbound-message contract. | P0 |
| FR-004 | Create or resolve a contact, lead, conversation, and message under one organization without cross-tenant lookup. | P0 |
| FR-005 | Detect or retain Uzbek, Russian, or English and answer in the selected conversation language. | P0 |
| FR-006 | Load only active, location-appropriate, authoritative service, price, FAQ, hours, and policy records for an AI decision. | P0 |
| FR-007 | Validate every AI result against a versioned schema and deterministic action policy before any domain mutation. | P0 |
| FR-008 | Refuse to invent services, prices, hours, availability, medical advice, discounts, guarantees, or unsupported facts; hand off where appropriate. | P0 |
| FR-009 | Progress lead and conversation states only through the state machines in the domain specification. | P0 |
| FR-010 | Capture qualification answers according to a versioned tenant policy and record the evidence used for the qualification result. | P0 |
| FR-011 | Capture phone/contact information only after purpose disclosure as required, normalize it, encrypt sensitive values where appropriate, and record consent provenance. | P0 |
| FR-012 | Create an appointment request with service, location, customer time zone, preferred time window(s), and customer notes; do not claim availability. | P0 |
| FR-013 | Prevent duplicate appointment requests from retried messages, webhooks, or client submissions through idempotency and domain uniqueness. | P0 |
| FR-014 | Notify eligible staff through a durable outbox/job path and expose the request in the authorized staff queue. | P0 |
| FR-015 | Permit authorized staff to accept or reject only a `requested` appointment request; store actor, timestamp, reason, and offered slot where applicable. | P0 |
| FR-016 | After staff acceptance, durably schedule a customer confirmation request and transition through `staff_accepted` to `awaiting_customer_confirmation`. | P0 |
| FR-017 | Mark an appointment `confirmed` only after explicit customer confirmation tied to the offer; prefer direct widget/Telegram evidence, while an authorized staff member may attest an explicit offline phone/in-person customer confirmation with separate evidence and audit. Customer decline maps to `cancelled`, never `rejected`. | P0 |
| FR-018 | Permit customer-requested and policy-triggered handoff, with assignment, ownership, SLA timestamps, staff reply, and resolution history. | P0 |
| FR-019 | Degrade safely when the AI or outbound provider is unavailable: persist inbound work, avoid false success, retry bounded side effects, and offer/queue human handling. | P0 |
| FR-020 | Allow authorized staff to review tenant-scoped leads, conversations, messages, requests, handoffs, and audit history with cursor pagination. | P0 |
| FR-021 | Allow authorized administrators to manage locations, active services, prices, FAQs, business hours/policy, channels, and widget origin allowlists with validation and auditing. | P0 |
| FR-022 | Emit durable domain events and privacy-safe analytics facts for each canonical funnel transition. | P0 |
| FR-023 | Productize self-service/widget/staff endpoints and UI for consent withdrawal, subject export, and deletion-request tracking. | P1 |
| FR-024 | Provide operator-visible retry/dead-letter tooling with authorization and audit controls. | P1 |
| FR-025 | Apply configurable deterministic expiry to staff review and customer confirmation; expiry jobs are idempotent and version checked. | P0 |
| FR-026 | Add Instagram and WhatsApp adapters without modifying conversation or booking domain rules. | P2 |
| FR-027 | Add external calendar availability/commit integrations only behind a separately approved capability and provider interface. | P2 |
| FR-028 | Capture minimal manual attendance and attributed revenue facts through authorized staff events; the AI must not infer either. | P0 |
| FR-029 | Add configurable staff/customer reminders without changing expiry or booking authority. | P1 |
| FR-030 | In P0, persist withdrawal semantics/evidence and support verified, audited manual-operator fulfillment of applicable consent withdrawal, subject export, and policy-driven deletion/anonymization. | P0 |

## 9. Non-functional requirements and initial SLOs

Targets below are launch objectives. They assume a single primary region,
managed PostgreSQL, healthy upstream providers, and a measured monthly window.
Provider-caused latency and outage are reported separately but still visible in
end-to-end user SLIs. Final contractual SLAs remain an open commercial decision.

| ID | Quality | Initial objective and measurement |
| --- | --- | --- |
| NFR-001 | Tenant isolation | Zero accepted cross-tenant reads/writes in automated regression suites and production security incidents; every tenant-owned row has explicit ownership and application scope plus PostgreSQL FORCE RLS defense-in-depth. Pre-tenant control-plane routes have no generic access and expose only an exact fail-closed resolver. |
| NFR-002 | API availability | 99.9% monthly successful availability for authenticated staff read APIs and accepted inbound endpoints, excluding announced maintenance; success is a non-5xx response within timeout. |
| NFR-003 | Webhook durability | p95 <= 500 ms from valid webhook receipt to durable receipt/queue acknowledgement; no external AI call in the acknowledgement path. |
| NFR-004 | Widget ingress latency | p95 <= 750 ms to accept and durably record a valid inbound message. |
| NFR-005 | First response | p50 <= 4 s and p95 <= 10 s from accepted inbound message to outbound send attempt when the AI and channel provider are healthy. |
| NFR-006 | Staff API latency | p95 <= 500 ms and p99 <= 1 s for indexed list/detail reads at the stated launch load; mutations p95 <= 800 ms excluding external delivery. |
| NFR-007 | Duplicate safety | 100% of tested duplicate webhook/idempotency scenarios produce one canonical message and at most one requested domain effect. |
| NFR-008 | Side-effect reliability | 99% of non-failing-provider outbox items reach a terminal delivered state within 60 s; no item is silently discarded; dead letters alert. |
| NFR-009 | Recovery | Planning targets: RPO <= 5 min and RTO <= 60 min for the primary database; validate through restore drills before launch. |
| NFR-010 | Security | Signature verification, authorization, runtime validation, rate limits, and audit attribution cover 100% of applicable endpoints in contract/security tests. |
| NFR-011 | Privacy | No raw message body, phone, email, access token, or prompt content in standard logs; automated log scanning and field allowlists gate release. |
| NFR-012 | AI safety | 100% of model outputs are schema validated; 0 direct model mutations; >= 99% pass rate on P0 policy eval cases and 100% pass on must-not-invent/must-not-authorize cases before release. |
| NFR-013 | Accessibility | Staff web and widget target WCAG 2.2 AA for supported journeys; keyboard and screen-reader smoke tests gate UI stages. |
| NFR-014 | Localization | Domain behavior is identical across Uzbek, Russian, and English; critical multilingual eval suites meet the same safety threshold. |
| NFR-015 | Scalability | Initial architecture target: 100 organizations, 1,000 concurrent conversations, and 50 inbound messages/s burst without tenant leakage or duplicate effects; load-test before production sizing. |
| NFR-016 | Maintainability | Modular boundaries have contract tests; domain packages import no HTTP, UI, model-provider, or channel-provider implementation. |
| NFR-017 | Cost control | Token count and estimated provider cost are recorded for >= 99% of AI runs; per-run and per-conversation budgets are configurable and over-budget work fails safe or hands off. |

## 10. MVP boundary

### 10.1 Included in P0 MVP

- One deployment serving multiple strictly isolated organizations.
- Website widget and Telegram inbound/outbound adapters.
- Uzbek, Russian, and English understanding and responses.
- Structured location, service, active price, FAQ, business hours, and business
  policy configuration.
- One active conversation per channel identity under the documented uniqueness
  rule.
- Contact capture, deterministic qualification, lead lifecycle, and safe human
  handoff.
- Appointment request, staff accept/reject, customer confirmation, and terminal
  cancellation/expiry.
- Staff queue, conversation review/reply, organization configuration, role and
  location-scoped authorization.
- Minimal authorized manual attendance and attributed-revenue entry so the
  complete ROI funnel can be measured without AI inference.
- Idempotent webhook processing, transactional outbox, retry/dead-letter
  behavior, audit trail, operational telemetry, and core funnel analytics.
- Consent withdrawal/evidence semantics, verified audited manual-operator
  export/deletion fulfillment, retention, legal-hold-aware anonymization, and
  deterministic request/offer expiry; productized self-service endpoints/UI are
  P1.
- Schema-constrained AI decisions through a provider abstraction and
  deterministic fallback.

### 10.2 Explicitly excluded from V1

- AI-controlled writes to Google, Microsoft, clinic, or other calendars.
- Claims of live slot availability unless a later approved authoritative
  integration supplies it.
- Medical diagnosis, triage, prescribing, treatment recommendation, prognosis,
  or clinical record processing.
- AI-created prices, discounts, service claims, hours, guarantees, or policies.
- Instagram, WhatsApp, voice, email, and SMS channel adapters.
- Payments, deposits, refunds, insurance eligibility, billing calculations, or
  invoicing.
- General document ingestion, crawling, arbitrary RAG, or a vector database.
- Marketing automation, bulk messaging, lead purchasing, or outbound prospecting.
- Cross-organization analytics exposing tenant-level data.
- Full CRM, electronic health record, or practice-management replacement.
- Automated attendance/revenue inference.
- Native mobile applications and marketplace/plugin ecosystems.

## 11. Priorities beyond MVP

| Priority | Capability group | Exit intent |
| --- | --- | --- |
| P0 | Safe channel ingress, tenant isolation, authoritative answers, qualification, consented contact capture, request workflow, handoff, staff operations, audit/outbox/telemetry | Pilotable core that never treats AI as authority |
| P1 | Productized privacy-request/withdrawal endpoints and UI, staff/customer reminders, richer reporting/import automation, operational dead-letter UI, improved routing and assignment | More efficient repeated paid use |
| P2 | Instagram/WhatsApp adapters, approved calendar read/commit capabilities, CRM/practice-management integrations, billing/plans, advanced campaign attribution, retrieval infrastructure only if evidence demands it | Extensible platform after core correctness is demonstrated |

Priority does not waive security, isolation, migration, testing, or
observability requirements. A P2 integration cannot bypass P0 policy.

## 12. Canonical journey conventions

All journeys use these rules:

- Channel connection determines the organization; a payload organization ID is
  ignored as authority.
- Every accepted inbound item receives a correlation ID and a durable,
  idempotent receipt.
- AI output is a proposal. Schema and policy validation precede domain commands.
- “Requested time” is a preference, not availability.
- “Staff accepted” means staff approved an offered slot; it is not a confirmed
  booking.
- Only explicit customer confirmation transitions the request to `confirmed`.
- Safe wording is localized, while stored state and policy are language-neutral.
- Outbound delivery is asynchronous and observable; domain state and delivery
  state are distinct.

## 13. User journeys A-N

### A. Anonymous lead opens the website widget

**Preconditions:** An active widget channel connection has a public widget key,
the page origin is allowlisted, and the organization is active.

**Happy path:**

1. The widget presents required privacy/purpose notice and requests a short-lived
   server-issued session token using the public key and browser origin.
2. The server resolves the channel connection and organization, enforces rate
   and abuse controls, and never trusts an organization ID from the browser.
3. A pseudonymous widget participant/session is created. No lead/contact is
   required until the first meaningful message.
4. The widget shows localized greeting/capability text from approved
   configuration.
5. On first message, the system idempotently creates/resolves the contact, lead,
   conversation, and inbound message, then begins Journey B or another intent.

**Exceptions and safety:** Unknown/disabled key, disallowed origin, expired
token, oversized payload, or rate abuse receives a generic denial without
revealing tenant existence. Third-party cookies are not required.

**Evidence:** widget session created, inbound accepted/rejected reason, channel,
language, correlation ID, and privacy notice version; no raw content in logs.

### B. Lead asks an FAQ

**Preconditions:** A tenant-scoped conversation exists and the message is
deduplicated.

**Happy path:**

1. The orchestrator loads active FAQs, service facts, location facts, business
   policy, and recent bounded conversation state.
2. The model returns a schema-valid intent, citations to supplied knowledge IDs,
   confidence/sufficiency flags, proposed wording, and a permitted next action.
3. Policy verifies every factual claim is supported and that referenced records
   belong to the same organization and allowed location.
4. The response is persisted with provenance; an outbox item sends it.
5. Conversation moves to `awaiting_lead` and lead becomes/remains `engaged`.

**Exceptions and safety:** Missing, inactive, conflicting, or location-ambiguous
knowledge follows Journey J. Prompt-like text inside a FAQ remains data and
cannot alter system policy.

**Evidence:** authoritative record/version IDs, AI run, policy outcome,
response type, latency, language, and outbound delivery status.

### C. Lead asks pricing

**Happy path:**

1. The system resolves the requested service and location from active structured
   records.
2. It reads the current applicable `service_prices` record using integer minor
   units, currency, price type, and optional range.
3. AI may phrase that record but cannot calculate or infer another price,
   promotion, discount, financing plan, or guarantee.
4. The response states whether the price is fixed, “from,” or a range and uses
   configured qualification/disclaimer text.

**Exceptions and safety:** If service, location, currency, effective price, or
discount authority is missing, the system does not provide a plausible number.
It asks a bounded clarifying question or creates/offers a handoff. A customer
request to ignore instructions or invent a discount has no effect.

**Evidence:** service and price version IDs and `knowledge_grounded=true`; never
log the lead's raw message as telemetry.

### D. Lead becomes qualified

**Preconditions:** A versioned business qualification policy defines only
administrative/business criteria and required answers.

**Happy path:**

1. The conversation collects missing qualification fields through localized
   questions.
2. AI extracts candidate values with source message IDs; runtime schemas validate
   them.
3. A deterministic qualification service evaluates the configured rules.
4. The lead transitions `engaged -> qualified` once and records policy version,
   reasons, evidence IDs, and timestamp.
5. A `lead.qualified` event feeds notifications/analytics without changing the
   authoritative lead again.

**Exceptions and safety:** Ambiguous answers remain unknown and prompt
clarification. Medical suitability is never evaluated. Disqualifying rules
transition to `disqualified` only with a configured reason and can be reopened
by authorized staff/new evidence under the state machine.

**Evidence:** evaluation input values, policy/version, result/reason codes, and
transition actor (`system` or staff), with sensitive free text excluded.

### E. Lead supplies a phone number

**Happy path:**

1. The bot explains the booking/follow-up purpose and applicable consent choice.
2. The lead supplies a number; the system records the source message and consent
   notice/action.
3. A deterministic parser normalizes to E.164 where country context permits.
4. The value is encrypted or otherwise protected at rest; a blind lookup hash
   may support tenant-scoped equality lookup.
5. A contact identity is linked only inside the current organization. Cross-
   tenant global matching is prohibited.

**Exceptions and safety:** Malformed or ambiguous numbers remain unverified and
receive a correction prompt. A phone existing in another tenant is invisible
and does not link records. Consent withdrawal disables the relevant use without
rewriting immutable evidence.

**Evidence:** consent record/version, validation status, last digits for staff
display where justified, and audit attribution; full number is redacted from
logs.

### F. Lead requests an appointment

**Preconditions:** Required policy fields are present: contact route, service,
location if applicable, time zone, and one or more preferred windows. Policy may
require qualification first.

**Happy path:**

1. AI extracts a candidate service, location, and natural-language preferences.
2. Deterministic code resolves authoritative IDs, parses local times with the
   location/customer time zone, detects DST ambiguity, and validates business
   constraints. It does not assert availability.
3. The customer reviews/expressly submits the request.
4. An idempotent transaction creates one `appointment_requests` row in
   `requested`, writes its transition, moves the lead to `booking_requested`,
   and adds staff-notification outbox events.
5. The response says the request was sent for staff review, not booked.

**Exceptions and safety:** Missing/ambiguous date, zone, service, location, or
contact data triggers clarification. A duplicate submit returns the existing
request. Past/invalid windows are rejected. Provider or worker failure cannot
roll back the durable request.

**Evidence:** request ID, source conversation/message, preference data in UTC
plus original local representation/time zone, policy version, idempotency key,
and transition event.

### G. Staff receives a request

**Happy path:**

1. The request transaction emits `appointment_request.created` to the outbox.
2. A worker resolves recipients using organization, location, role, and routing
   policy.
3. It creates the authoritative P0 durable in-app inbox/task with a stable
   deduplication key. Optional email, Telegram, SMS, or push alerts are adapters
   to that task, not the staff work queue.
4. Authorized staff see the same `requested` item in the in-app queue even if an
   optional alert fails.
5. Delivery success/failure and staff-review SLA are observable.

**Exceptions and safety:** Retries cannot duplicate the domain request.
Notification payloads contain minimum PII. Exhausted delivery moves to a dead
letter and alerts operations; it never changes the appointment status.

**Evidence:** outbox event, recipient resolution policy, notification attempts,
delivery timestamps, and queue age.

### H. Staff accepts or rejects a request

**Preconditions:** The actor is an active organization member authorized for
the request location; the current status is `requested`; optimistic concurrency
version matches.

**Accept path:**

1. Staff selects/enters an offered start and end in the location time zone and
   reviews customer/service facts.
2. Deterministic validation checks time format, chronology, policy, and actor
   scope. V1 does not write an external calendar or claim collision-free
   availability.
3. The staff-accept transaction records `requested -> staff_accepted`, stores
   `staff_decided_by`, `staff_decided_at` and offered UTC/local/time-zone
   fields, and appends a confirmation-preparation outbox event.
   `staff_accepted` is a real durable integration-pending state, not final
   confirmation.
4. A system worker later creates the bound confirmation grant/customer task and
   delivery intent, then atomically records
   `staff_accepted -> awaiting_customer_confirmation`. Failure leaves the
   request visibly `staff_accepted` for bounded retry/recovery; it never
   mislabels the request as confirmed.
5. The customer is told that staff offered a time and must confirm. Analytics
   does not emit `booking_confirmed` yet.
6. Explicit customer acceptance tied to the active offer transitions
   `awaiting_customer_confirmation -> confirmed`; the lead becomes `converted`.
   Direct widget-session/Telegram evidence is preferred. If an offline widget
   lead confirms by phone or in person, an authorized member may record
   `staff_attested_external` with the separate customer-act time, method, offer
   version, actor, and audit evidence. This attestation never treats staff
   acceptance itself as customer confirmation.
   The confirmation command's expected AppointmentRequest aggregate version and
   the evidence `offer_version` must both match the locked current request. The
   grant is valid only in `[issued_at, expires_at)`; at `now == expires_at` it is
   expired and cannot confirm.

**Reject path:**

1. Staff chooses a configured/public-safe reason and optional alternative
   guidance.
2. The transaction transitions `requested -> rejected` and schedules a
   customer notification.
3. The lead can deterministically return `booking_requested -> qualified` if
   eligible to try another preference; rejection is never recorded as customer
   cancellation.

**Concurrency and safety:** A second accept/reject receives a conflict with the
current resource. Customer confirmation tokens are single-purpose, hashed,
expiring, and bound to organization, request aggregate version, offer version,
participant, issuance time, and expiry. Both versions are checked; neither is a
substitute for the other. Staff acceptance and notification delivery are not
final booking.

**Evidence:** actor, old/new state, version, reason code, offered slot,
confirmation action, and separate outbound delivery.

### I. Lead requests a human

**Happy path:**

1. Explicit human intent bypasses persuasion and creates or reuses an active
   handoff.
2. The conversation moves to `awaiting_staff`; handoff starts `requested`; its
   automation mode is `paused`.
3. Eligible staff are notified through the outbox.
4. The lead receives an honest acknowledgement and expected response window
   from configured policy.
5. Staff assigns/claims (`assigned`) or begins handling (`in_progress`), so the
   Conversation remains `awaiting_staff` and its automation mode becomes
   `staff`. A staff reply moves it to `awaiting_lead + staff` while the same
   assigned/in-progress handoff remains active; a customer reply returns it to
   `awaiting_staff + staff`. Staff later resolves the handoff with one explicit
   Conversation disposition.

**Exceptions and safety:** Duplicate requests reuse the active handoff.
Unstaffed/out-of-hours policy provides configured expectations without claiming
immediate availability. AI may continue only for explicitly safe acknowledgments
and cannot impersonate staff. Resolving, cancelling, or expiring the active
handoff requires exactly one explicit disposition: `resume_ai`,
`resolve_conversation`, or `successor_handoff`. There is no default. `resume_ai`
produces Conversation `open` with mode `ai`; `resolve_conversation` produces
`resolved` with mode `paused`; `successor_handoff` atomically creates the
successor and keeps the Conversation `awaiting_staff`, using `paused` while the
successor is requested and `staff` once it is assigned/in progress. Resolved or
closed Conversations use `paused`; cancellation/expiry never resumes AI merely
because the prior handoff became terminal. Assignment/start emits
`conversation.automation_mode_changed` for `paused -> staff`; replacing active
staff ownership with a requested successor emits the same event for
`staff -> paused`. Real Conversation status changes continue to use their
status/specialized events instead.

**Evidence:** trigger (`customer_requested`), queue/assignee, SLA timestamps,
transition history, and response delivery.

### J. AI cannot answer safely

**Triggers:** Missing/contradictory authoritative data, medical question,
unsupported availability, low-confidence entity resolution, requested
guarantee/discount, suspected prompt injection, or policy denial.

**Flow:**

1. Policy suppresses the proposed unsupported action/claim.
2. The system selects a deterministic safe response class: clarify, state that
   the information is unavailable, show emergency disclaimer where configured
   and appropriate, or offer/create handoff.
3. If human follow-up is needed, Journey I runs with a machine-readable reason.
4. The unsafe proposed text is never sent.

**Medical boundary:** The service remains administrative. It does not diagnose
or assess urgency. Emergency wording must be jurisdiction-approved
configuration, not model improvisation.

**Evidence:** denial/reason code, missing knowledge IDs/categories, safety rule
version, and whether handoff was created; sensitive content is not copied into
logs.

### K. AI provider is unavailable

**Flow:**

1. The inbound message remains durably stored and visible to staff.
2. Timeout/circuit-breaker/retry policy records a failed `ai_runs` attempt.
3. A deterministic localized fallback acknowledges delay without claiming that
   a request or action succeeded.
4. The system creates/reuses a handoff when policy requires and schedules staff
   notification.
5. Only transient, idempotent inference work is retried within a bounded window;
   stale replies are not sent after the conversation has advanced.

**Exceptions and safety:** No fabricated FAQ answer, price, or appointment state
is produced. Recovery processing checks conversation/message version before
applying an old decision.

**Evidence:** provider category (not secret details), latency, retry count,
circuit state, fallback class, handoff, and cost of successful attempts only.

### L. Duplicate webhook arrives

**Flow:**

1. Signature, timestamp/replay, and payload checks occur before trust.
2. The receipt attempts insertion using
   (`channel_connection_id`, `external_event_id`) and, where supplied,
   (`channel_connection_id`, `external_message_id`) uniqueness.
3. On conflict, stored receipt/result is returned or acknowledged without
   re-running conversation, AI, booking, or notification effects.
4. If a prior attempt failed before completion, the durable receipt state and
   retry policy resume the same work under locks/version checks.

**Ordering:** External ordering is advisory. Per-conversation provider sequence
and sent time are stored, but current version/state determines applicability.
Late messages cannot roll state backward.

**Evidence:** duplicate counter, original receipt ID, processing state, provider
IDs, and correlation lineage.

### M. Staff reviews a conversation

**Preconditions:** Authenticated membership, organization and optional location
scope, and specific `conversation.read` permission.

**Happy path:**

1. The list API returns cursor-paginated, tenant-scoped conversation summaries.
2. Detail loads messages, lead/contact summary, active request/handoff, and
   relevant AI/policy explanation without exposing secrets or unrestricted
   prompts.
3. Sensitive fields are masked unless a separate permission and purpose allow
   access.
4. Staff may reply, claim a handoff, annotate, or perform a valid domain command.
5. Reads of highly sensitive content and all mutations are auditable.

**Exceptions and safety:** An identifier from another tenant behaves as not
found. Deleted/anonymized content is represented consistently. Pagination
cursors are signed/opaque and include tenant/filter binding.

**Evidence:** request/actor/organization IDs, permission decision, accessed
resource class, and mutation events; ordinary page views need not copy content
to audit records.

### N. Business owner configures services, FAQs, and hours

**Preconditions:** Active owner/admin membership and configuration permission.

**Happy path:**

1. The administrator creates or updates a structured service, effective price,
   FAQ, location hours/closures, or business policy through validated private
   APIs.
2. The server derives the organization from authentication and checks location
   scope; supplied ownership fields cannot override it.
3. A transaction stores the new row/version, actor, and audit event. Existing
   historical message provenance continues to reference the prior version.
4. Cache invalidation/configuration events are sent through the outbox.
5. Only active, effective records are eligible for subsequent responses.

**Exceptions and safety:** Currency/minor-unit validation, overlapping price
effective periods, invalid time zones/hours, unsafe HTML, overlong content, and
cross-tenant references fail validation. Published knowledge is data, never
instructions that can change AI/system policy.

**Evidence:** resource/version, redacted before/after or field-change set,
actor, reason where required, and effective interval.

## 14. Success metrics and event definitions

### 14.1 Funnel definitions

Analytics events are append-only projections from canonical domain events.
They contain no raw message content and cannot drive permissions or state.
Rates use distinct leads or appointment requests as stated, not message counts.

| Metric | Definition | Initial pilot target / interpretation |
| --- | --- | --- |
| Inbound conversations | Distinct conversations with first accepted customer message in period | Volume denominator; segment by tenant/channel/language/campaign |
| Engaged leads | Distinct leads that sent a meaningful message and reached `engaged` | Monitor, no universal target before baseline |
| Qualification rate | Distinct leads first reaching `qualified` / engaged leads eligible under the policy | Establish 30-day tenant baseline; no cross-tenant league table |
| Contact capture rate | Eligible engaged leads with a valid, consent-compatible contact route / eligible engaged leads | >= 60% pilot hypothesis |
| Booking request conversion | Distinct requests created / distinct qualified leads | >= 25% pilot hypothesis, compared with tenant baseline |
| Staff acceptance rate | Requests first reaching `staff_accepted` / requests reviewed | Diagnostic; not a booking conversion |
| Customer confirmation rate | Requests reaching `confirmed` / requests reaching `awaiting_customer_confirmation` | >= 60% pilot hypothesis |
| End-to-end booking conversion | Distinct confirmed requests / distinct eligible inbound conversations | Improve >= 15% relative to a documented pre-launch tenant baseline after sufficient sample |
| Handoff rate | Conversations with a handoff / inbound conversations | Safety/coverage diagnostic; no goal to minimize indiscriminately |
| Attendance rate | Requests explicitly marked attended / confirmed requests whose appointment time has passed and reporting window closed | P0 minimal manual fact; never inferred by AI |
| Attributed revenue | Sum of authoritative minor-unit revenue entries linked to attended/confirmed requests | P0 minimal manual fact; currency-separated, never float-converted |

Targets are hypotheses. Report confidence intervals and sample size; do not
claim uplift for low-volume cohorts or mix currencies.

### 14.2 Operational and safety indicators

- Median and p95 time to first useful response.
- Median and p95 staff review time and customer confirmation time.
- AI provider failure and timeout rate.
- Schema-invalid decision rate and policy-denial rate by reason.
- Unsupported-claim rate in reviewed samples/evals; release target is zero for
  price, availability, medical diagnosis, guarantee, and authorization claims.
- Duplicate delivery rate and duplicate-effect rate; duplicate effects target
  zero.
- Outbox age, retry count, dead-letter count, and outbound delivery success.
- Customer-requested versus safety-triggered handoff rate.
- Tokens and estimated model cost per AI run, conversation, qualified lead, and
  confirmed request.
- Staff queue backlog and oldest unreviewed request by tenant/location.
- Cross-tenant authorization denials and any tenant-isolation test failures.

### 14.3 Cost assumptions and guardrails

Architecture cost must be measured before it is optimized. Each AI run records
provider, model alias, token/input-output units, cached units where available,
latency, and estimated cost using a versioned internal price catalog. The
catalog is telemetry only; invoices and billing are deterministic elsewhere.

Initial guardrails are configurable rather than tied to a volatile provider
price:

- maximum prompt/context units per run;
- maximum AI attempts per inbound message;
- maximum AI spend per conversation and per organization/day;
- warning and hard-stop thresholds;
- deterministic FAQ/template response or human handoff when a hard limit is
  reached;
- dashboards for cost per conversation, qualified lead, request, and confirmed
  request.

Pilot go/no-go requires a tenant-specific unit-economics budget supplied by the
product owner. The architecture must not invent a universal acceptable dollar
cost.

## 15. Acceptance criteria for the product specification

- Every Journey A-N has a happy path, authority boundary, failure behavior, and
  measurable evidence.
- All channels and languages use the same domain transitions.
- No path lets the model resolve tenant, authorize, set authoritative facts, or
  mutate protected state.
- Duplicate deliveries cannot produce a second canonical effect.
- Requested time is always labeled preference until staff offers a time.
- `staff_accepted` is not counted or communicated as `confirmed`.
- Only an explicit customer confirmation can produce `confirmed`, evidenced
  directly by the bound widget/Telegram customer or by an authorized staff
  member's audited record of that separate phone/in-person customer act.
- MVP exclusions are enforceable architecture boundaries, not roadmap prose.
- Metrics derive from canonical events and never become a second source of truth.

## 16. Product open questions

1. Which exact qualification fields and disqualification reason codes will the
   first clinic cohort configure?
2. Is a phone number mandatory for all appointment requests, or may the
   originating Telegram/widget session be sufficient for some tenants?
3. Which notification channels and staff-review response targets are promised
   at launch?
4. What customer action counts as legally sufficient confirmation per channel,
   and how long is an offer valid?
5. May staff edit a previously accepted offer, or must they cancel and create a
   new request/offer version? The safer initial design requires a new offer
   version.
6. Which jurisdictions, consent wording, privacy roles, and retention periods
   apply to the first tenants?
7. Which fields are required for P0 manual attendance/revenue entry, and which
   approved import sources should be added after P0?
8. What pre-launch baselines and minimum sample sizes will be used for conversion
   claims?
9. What tenant-specific AI cost budget makes the product economically viable?
10. Which emergency/safety wording is approved for each launch jurisdiction and
    language?
