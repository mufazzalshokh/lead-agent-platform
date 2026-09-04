# Domain model and deterministic state machines

Status: Stage 0 normative specification

Scope: domain concepts, ownership, ports, events, invariants, and transitions

## 1. Modeling conventions

- All entity identifiers are opaque UUIDv7 values. API and domain types use
  distinct branded identifiers such as `OrganizationId` and `ConversationId`;
  they are not interchangeable strings.
- Every tenant-owned aggregate carries `organization_id`. Commands receive a
  server-derived `TenantContext`; tenant identity is never taken from a public
  payload.
- Canonical timestamps are UTC `timestamptz`. Local scheduling input also
  preserves the IANA time-zone name and original local representation.
- Domain state is changed only by commands on an aggregate or a deterministic
  domain service. Repositories cannot expose unscoped tenant methods.
- State/version checks use optimistic concurrency. A transition is persisted
  with the aggregate change in one transaction.
- Domain events describe committed facts. External delivery is a separate
  integration concern driven by a transactional outbox.
- Status values in this document are canonical contracts. Presentation may
  translate labels but may not introduce different language-specific states.
- Soft deletion, archival, or anonymization is not a state-machine shortcut.
  Deletion policy is modeled separately from business lifecycle.

## 2. Context and aggregate map

The modular monolith contains one domain model split into cohesive modules. A
module may own several aggregate roots; cross-module changes occur through
application commands and committed domain events, not direct table mutation.

| Module | Aggregate roots | Owned entities/value records | Primary responsibility |
| --- | --- | --- | --- |
| Tenancy & access | `Organization`, `Membership` | organization settings, role grants, location scope | Tenant lifecycle and organization-local access relationships |
| Catalog & policy | `Location`, `Service`, `Faq`, `BusinessPolicy` | service prices, hours, closures, localized text, qualification rules | Authoritative business knowledge and rules |
| Channels | `ChannelConnection`, `WidgetSession` | widget origins/keys, provider identifiers, encrypted credentials metadata, anonymous session binding | Trusted mapping from an ingress endpoint/session to an organization |
| Contacts | `Contact` | contact identities, consent records | Tenant-local person/contact representation and communication permission |
| Leads | `Lead` | qualification facts/evaluations, source attribution | Commercial lifecycle from new inquiry to conversion |
| Conversations | `Conversation` | messages, participant bindings | Ordered communication history and response ownership |
| Booking | `AppointmentRequest` | preference windows, offered slot, transition records, confirmation evidence | Human-reviewed appointment-request lifecycle |
| Handoff | `Handoff` | assignment and transition records | Transfer from automation to an accountable staff queue/member |
| Delivery | `Notification` | delivery attempts | Intended outbound/staff task and delivery lifecycle |
| AI governance | `AiRun` | proposed-action evaluation, citations, policy result | Auditable model inference; never business authority |
| Governance | `AuditEvent` | field-change metadata | Immutable security/administrative attribution |

`WebhookReceipt`, `IdempotencyRecord`, `OutboxEvent`, and
`AnalyticsEvent` are durable application/reliability records rather than
business aggregate roots. They still carry explicit tenant ownership whenever
the event is tenant-related.

## 3. Aggregate definitions

### 3.1 Organization

**Root:** `Organization`

**Owns:** legal/display name, status (`active|suspended|closed`), default locale,
default IANA time zone, retention-policy reference, created/updated metadata.

**References:** memberships, locations, catalog records, channel connections,
and all operational tenant data reference the organization; they are not loaded
as one in-memory object.

**Invariants:**

- An active tenant has a valid default time zone and one supported default
  locale (`uz|ru|en`).
- Suspended/closed organizations cannot accept new public messages or issue new
  side effects, while authorized export/retention operations remain possible.
- Organization ownership cannot change via a nested resource update.
- Platform support access is not represented as a hidden organization
  membership.

### 3.2 Membership

**Root:** `Membership`

**Fields:** organization, user/principal, status
(`invited|active|suspended|revoked`), canonical role
(`owner|admin|staff|analyst`), optional allowed location set,
invitation/activation metadata. Location-manager behavior is an admin/staff
permission plus location scope, not another role. `platform_operator` is never
a membership role.

**Invariants:**

- (`organization_id`, `user_id`) is unique.
- Only active memberships authorize tenant access.
- A location-scoped permission can reference only an active location in the
  same organization.
- The last active owner cannot be removed without an explicit ownership
  transfer rule.
- Role labels never replace an evaluated permission and resource scope.

### 3.3 Location

**Root:** `Location`

**Owns:** name, address/contact presentation, IANA time zone, status, regular
business hours, exceptional closures/overrides.

**Invariants:**

- Time zone is an IANA identifier, not a numeric offset.
- Hours are non-overlapping within a local day after validation.
- Exceptional overrides have an explicit local date and version.
- A location referenced by an active appointment request cannot be hard-deleted.

### 3.4 Service and Price

**Root:** `Service`

**Child/value record:** `ServicePrice`

**Service fields:** stable service ID/code, localized name/description, active
state, duration guidance if authoritative, location availability references.

**Price fields:** price type (`fixed|from|range|quote_required`), ISO 4217
currency, minimum/maximum integer minor units when applicable, effective
interval, location override, display disclaimer.

**Invariants:**

- A price belongs to the same organization and service.
- `fixed` has equal non-null minimum/maximum; `from` has a minimum;
  `range` has minimum <= maximum; `quote_required` has no authoritative amount.
- Currency minor units are integers; domain calculations never use floating
  point.
- Applicable price intervals for the same service/location/currency do not
  overlap.
- Inactive/unpublished records cannot ground a new customer answer, but old
  provenance remains resolvable.

### 3.5 FAQ

**Root:** `Faq`

**Owns:** canonical question/topic, localized answer variants, optional
service/location scope, status, effective/version metadata.

**Invariants:**

- Content is business data and cannot alter system/model/tool policy.
- Rendered content is treated as untrusted and escaped/sanitized at output.
- A model answer citing an FAQ must use an active applicable version supplied in
  that AI run.

### 3.6 BusinessPolicy

**Root:** `BusinessPolicy`

**Owns:** versioned administrative qualification rules, required appointment
fields, handoff triggers, staff/customer expiry periods, response templates and
approved safety wording, consent notice references.

**Invariants:**

- Published versions are immutable; an edit creates a new version/effective
  record.
- Rules use a restricted deterministic representation, not executable code or
  model prose.
- Medical diagnosis/suitability rules and model-authorized actions are invalid.
- An appointment request stores the policy version used at submission.

### 3.7 ChannelConnection

**Root:** `ChannelConnection`

**Owns:** channel type (`widget|telegram` in V1), status, provider account/
bot/public-key identifiers, encrypted credential reference, verification
metadata, widget origin allowlist, external configuration.

**Invariants:**

- Provider/public identifiers are globally unique where necessary for trusted
  routing.
- Connection-to-organization binding is server-managed and immutable to
  anonymous clients.
- Secrets are write-only/reveal-never and encrypted through a secrets boundary.
- Disabled/revoked connections cannot accept or send new traffic.
- Instagram/WhatsApp later implement the same port; they do not add domain
  channel branches.

### 3.7.1 WidgetSession

**Root:** `WidgetSession`

**Owns:** channel connection/origin binding, pseudonymous participant hash,
requested locale, expiry/revocation state, and optional immutable contact/
conversation binding.

**Invariants:**

- It belongs to the organization resolved from the widget route; the browser
  cannot select or change that organization/connection.
- A signed token JTI is stored hashed, short-lived, audience scoped, and
  revocable.
- Once a conversation is bound, a request body cannot rebind the session to a
  different conversation/contact.
- Expired/revoked sessions cannot send/read; guessed cross-session resources
  return not found.
- Origin binding is rechecked according to the widget security contract.

### 3.8 Contact

**Root:** `Contact`

**Children:** `ContactIdentity` and linked `ConsentRecord`

**Owns:** preferred display name/language, tenant-local identity keys, protected
contact values, verification flags, deletion/anonymization state.

**Invariants:**

- Identity matching is scoped to one organization; there is no global contact
  graph.
- One normalized provider identity is unique within
  (`organization_id`, `channel_type`, `channel_connection_id`).
- Full phone/email values never appear in routine logs, events, or analytics.
- A blind lookup hash is tenant-peppered/versioned and cannot be used to correlate
  organizations.
- A communication purpose requiring consent must have an active compatible
  consent record or another documented lawful basis.

### 3.9 Lead

**Root:** `Lead`

**Owns:** contact reference, source/channel/campaign attribution, status,
service/location interest, qualification snapshot/result/reasons, assigned
member, status version and timestamps.

Canonical status:

`new | engaged | qualified | booking_requested | converted | disqualified | closed`

**Invariants:**

- A lead and its contact belong to the same organization.
- Qualification is the result of a stored policy version and validated facts,
  not an unconstrained model score.
- `booking_requested` requires a related appointment request created in the same
  transaction or committed command workflow.
- `converted` requires a related appointment request that reached `confirmed`.
- A later cancellation does not erase the historical conversion event.
- An invalid transition is rejected; the status is never “repaired” silently.

### 3.10 Conversation and Message

**Root:** `Conversation`

**Child entity:** `Message`

**Conversation owns:** contact/lead/channel binding, status, detected/preferred
language, current automation mode, last activity, version.

Canonical automation mode is `ai|paused|staff`: `ai` means AI automation owns
eligible response generation; `paused` means AI response generation is
deliberately suspended while staff has not taken active response ownership, or
the Conversation is not active for automation; `staff` means an assigned or
in-progress Handoff owns response handling. Routing to a newly requested Handoff
sets `awaiting_staff + paused`; assignment/start sets `awaiting_staff + staff`;
an explicit permitted resume sets `open + ai`; resolved and closed Conversations
use `paused`. No Handoff terminal transition implicitly resumes AI.

Canonical status:

`open | awaiting_lead | awaiting_staff | resolved | closed`

The only valid status/mode/Handoff combinations are:

| Status + mode | Required active Handoff |
| --- | --- |
| `open + ai` | none |
| `awaiting_lead + ai` | none |
| `awaiting_lead + staff` | exactly one `assigned` or `in_progress` Handoff |
| `awaiting_staff + paused` | exactly one `requested` Handoff |
| `awaiting_staff + staff` | exactly one `assigned` or `in_progress` Handoff |
| `resolved + paused` | none |
| `closed + paused` | none |

Every other status/mode combination is invalid. An active Handoff is likewise
invalid outside the three combinations that require one. `awaiting_lead + ai`
waits for a customer after an AI-owned response; `awaiting_lead + staff` waits
after a staff-owned response while the same assigned/in-progress Handoff retains
response ownership.

**Message owns:** direction (`inbound|outbound|staff_internal`), sender type,
canonical sequence, external IDs, content reference/protected body, language,
delivery status, reply relation, source timestamps, provenance, moderation and
processing metadata.

**Invariants:**

- Conversation, contact, lead, channel connection, and every message have the
  same organization.
- External message identity is unique within its channel connection.
- A duplicate provider message resolves to the existing message.
- Message content is immutable; delivery/processing metadata may advance
  monotonically.
- The model cannot create `staff_internal` messages or impersonate a staff actor.
- Only one non-terminal handoff is active for a conversation.
- A `closed` conversation is terminal; later inbound contact creates a new
  conversation. `resolved` may reopen under the documented transition.

### 3.11 AppointmentRequest

**Root:** `AppointmentRequest`

**Children:** preference windows and append-only
`AppointmentRequestTransition` records

**Owns:** lead/contact/conversation, service/location, original time-zone-aware
preferences, customer notes, status, staff decision, offered slot, confirmation
offer version/expiry, confirmation source/evidence, cancellation/rejection
reason, version.

Canonical status:

`requested | staff_accepted | awaiting_customer_confirmation | confirmed | rejected | cancelled | expired`

**Invariants:**

- Every referenced record belongs to the same organization.
- `requested` means a preference was submitted; it never implies availability.
- Only an authorized human staff command can perform
  `requested -> staff_accepted` or `requested -> rejected`.
- `staff_accepted` is not confirmed. It is a real durable integration-pending
  state recording the staff decision while confirmation preparation is pending.
- Only the system confirmation-request command, after a customer confirmation
  task/message is durably recorded in a later worker transaction, can perform
  `staff_accepted -> awaiting_customer_confirmation`.
- Only explicit customer confirmation, or an authorized staff attestation of
  explicit out-of-platform customer confirmation, can perform
  `awaiting_customer_confirmation -> confirmed`.
- `staff_attested_external` is evidence about a separate customer act, not
  another staff acceptance. It requires staff actor, confirmation time, contact
  method, attestation/evidence metadata, reason, and audit event.
- Direct confirmation sources are `customer_session` and `telegram`; all
  confirmation sources preserve actor/participant, offer version, and timestamp.
- Confirmation requires both the command's expected current AppointmentRequest
  aggregate version and evidence for the current, unexpired `offer_version`.
  Both must match the locked request; an old aggregate/token/response cannot
  confirm a replacement offer.
- Offered start is before end and stored in UTC with IANA time zone and local
  representation. V1 does not claim calendar availability.
- Terminal `rejected`/`expired` requests never reopen. A new attempt creates a
  new request. `cancelled` is also terminal.
- A confirmed request may transition to `cancelled` with an explicit
  post-confirmation cancellation actor/reason; its original confirmed fact and
  analytics event remain immutable.
- Every status change has exactly one transition record with actor, reason,
  timestamp, and from/to status.

### 3.12 Handoff

**Root:** `Handoff`

**Child:** append-only `HandoffTransition`

**Owns:** conversation/lead, trigger reason
(`customer_requested|missing_authoritative_information|medical_or_safety|low_confidence|policy_blocked|ai_unavailable|delivery_problem|staff_created|other`),
status, queue/location,
assignee, requested/assigned/started/resolved/SLA timestamps, resolution code.

Canonical status:

`requested | assigned | in_progress | resolved | cancelled | expired`

**Invariants:**

- At most one `requested|assigned|in_progress` handoff exists per conversation.
- Assignment is to an active, authorized member in the same organization and
  permitted location.
- Customer-requested handoff is never suppressed by an AI preference.
- Resolution requires an accountable actor or deterministic system expiry
  reason.
- A terminal handoff does not reopen; create a new handoff for a later need.

### 3.13 Notification

**Root:** `Notification`

The P0 staff-notification product is a durable in-app inbox/task. Optional
email, Telegram, SMS, or push alerts are delivery adapters and are not the
authoritative queue.

**Owns:** notification type, audience/recipient or queue, related resource,
minimal template/payload reference, status
(`pending|processing|delivered|failed|dead_lettered|cancelled`), attempts,
next attempt, deduplication key.

**Invariants:**

- A stable deduplication key prevents duplicate intended notifications.
- Delivery failure cannot mutate the related appointment/handoff outcome.
- Payload includes minimum required PII and no integration secret.
- Retry count and state advance monotonically; terminal failure is visible.
- Marking an in-app task read is distinct from processing the domain request.

### 3.14 AiRun

**Root:** `AiRun`

**Child:** `AiActionEvaluation` (one proposed action and its independently
validated result in V1)

**Owns:** provider, requested model/profile version, provider-resolved model ID,
prompt/schema/policy versions, bounded context references, knowledge citations,
input/output hashes or exceptional protected payload references, schema
validation, policy result, latency, token/high-precision cost telemetry, failure
category, correlation identifiers.

**Invariants:**

- An AI run belongs to exactly one organization and normally one conversation/
  triggering message.
- Model output never directly writes another aggregate.
- Every output is schema-valid before policy evaluation; every action is
  independently authorized and transition-validated.
- A cited fact must reference supplied tenant-owned authoritative context.
- Raw prompts/content are not standard logs and follow explicit retention.
- Production raw input/output capture is disabled by default. Exceptional
  encrypted capture requires an explicit tenant/legal/consent-compatible policy
  and short retention.
- Production model selection is pinned/versioned. A floating `latest` alias
  cannot be the only recorded or configured identity.
- A stale run cannot apply after the expected conversation/aggregate version
  changes.
- V1 exposes no model provider tools (`tools: []`). The single structured
  proposed action is evaluated as data by application policy; an
  `AiActionEvaluation` is not a provider tool call.

### 3.15 AuditEvent

**Root:** `AuditEvent` (append-only fact)

**Owns:** organization, event type, actor type/ID, target type/ID, request and
correlation IDs, timestamp, result, reason, redacted field-change metadata,
source IP/user-agent treatment where justified.

**Invariants:**

- Audit events are append-only and separately access-controlled.
- They contain no secrets and avoid raw message/contact content.
- Security-relevant mutations and staff-attested external confirmations are
  attributable.
- Tenant audit access cannot reveal platform or another tenant's events.

## 4. Value objects

| Value object | Semantics and validation |
| --- | --- |
| Typed IDs | UUIDv7, non-empty, type-specific; never accept an ID as proof of access |
| `TenantContext` | Server-derived organization, principal, membership, permission and location scope, request/correlation IDs |
| `ActorRef` | `customer\|member\|system\|platform_operator` plus attributable ID; model is never an actor authorized for protected transitions |
| `Locale` | `uz\|ru\|en` in V1; BCP 47 extension can be added without domain branching |
| `IanaTimeZone` | Valid named zone such as `Asia/Tashkent`; numeric offsets alone are insufficient |
| `LocalDateTimeInput` | Original user representation, locale, IANA zone, and DST resolution status |
| `UtcTimeWindow` | start/end instants with start < end, plus original local/zone provenance |
| `Money` | ISO currency plus integer minor units; range uses two Money values of same currency |
| `PhoneNumber` | Protected normalized E.164 value, validation/verification state, redacted display; no cross-tenant equality |
| `ChannelAddress` | Provider-neutral type, connection ID, protected external participant ID |
| `ExternalMessageRef` | Connection, external event/message ID, provider sent time/sequence; used for idempotency, not tenant trust |
| `IdempotencyKey` | Opaque bounded string plus tenant, operation, request hash, expiry |
| `KnowledgeCitation` | Record type, record/version ID, allowed fields, context snapshot/hash |
| `QualificationResult` | policy version, `qualified\|disqualified\|incomplete`, reason codes, validated evidence references |
| `ConfirmationEvidence` | source `customer_session\|telegram\|staff_attested_external`, participant/actor, offer version distinct from the command's expected aggregate version, customer act time, recorded time, method and protected evidence reference |
| `ConsentDecision` | tenant-local subject anchor, purpose, `granted\|declined\|withdrawn\|not_required`, notice/version, lawful basis, capture channel/time, withdrawal relation |
| `CorrelationContext` | request, trace, causation, and correlation IDs propagated across jobs/events |
| `AggregateVersion` | Monotonic integer checked on commands and stale AI results |

## 5. Domain services

Domain services are deterministic and provider-independent.

| Service | Inputs | Output / responsibility |
| --- | --- | --- |
| `TenantAuthorizationPolicy` | trusted tenant context, permission, resource ownership/location | allow/deny decision with reason; never tenant discovery from a resource ID |
| `ContactIdentityResolver` | tenant, connection, normalized provider/phone identity | tenant-local existing contact or new-contact instruction |
| `KnowledgeSelectionService` | tenant/location/service, effective instant, locale | exact authoritative record versions eligible for an answer |
| `PriceSelectionService` | service, location, currency, effective instant | one applicable price or typed missing/ambiguous error |
| `QualificationService` | published policy version and validated facts | qualification result/reasons; no model scoring authority |
| `ConversationRoutingPolicy` | current state, message type, handoff state, policy | automation, staff, clarification, or safe fallback route |
| `LeadTransitionPolicy` | current lead/version and committed related facts | valid next status or typed transition error |
| `AppointmentRequestPolicy` | current request/version, actor, offer/confirmation evidence | valid transition and event(s), or typed conflict/validation error |
| `HandoffRoutingPolicy` | trigger, tenant/location queue config, active handoff | reuse/create/assign instruction |
| `ConsentPolicy` | purpose, jurisdiction configuration, existing grants | permitted contact use or required notice/action |
| `TimePreferenceNormalizer` | localized input, tenant/location time zone, current instant | unambiguous UTC window(s) or clarification/error |
| `NotificationRoutingPolicy` | domain event, role/location grants, preferences | in-app task audience plus optional adapter deliveries |
| `RetentionPolicyEvaluator` | tenant policy, data class, subject request, legal hold | retain, redact, anonymize, or delete instruction |

The AI can supply candidates to these services but cannot replace their
decisions.

## 6. Repository ports

Repository interfaces live with the domain/application contracts; PostgreSQL
implements them. Except for explicit platform-control-plane repositories, every
repository is constructed from a `TenantDbSession`/`TenantTransaction` already
bound to exactly one trusted `OrganizationId`. Tenant repository methods do not
accept a second organization argument, cannot use the raw pool/base database,
and issue tenant-qualified SQL even though forced RLS is also present.

- `OrganizationRepository`: get active tenant, save settings with version.
- `MembershipRepository`: find active membership by tenant/principal, list
  location grants, save invitation/status.
- `CatalogRepository`: get effective location/service/price/FAQ/policy versions;
  save validated versions.
- `InboundRouteResolver`: pre-tenant exact route type/hash resolution only
  through the narrow database boundary; no route scan or tenant repository.
- `ChannelConnectionRepository`: load the resolved connection within the bound
  tenant session; tenant admin mutations remain tenant-scoped.
- `WidgetSessionRepository`: create/load/revoke a tenant-bound session by
  verified token/JTI and enforce immutable conversation binding.
- `ContactRepository`: resolve identity within tenant, get/save contact and
  protected identities.
- `LeadRepository`: get by ID within the bound tenant, get the one active Lead
  for a Contact, and save with expected version.
- `ConversationRepository`: get the active Conversation by channel connection
  and canonical external thread/group hash within the bound tenant, append an
  idempotent message, save state/version, and page by opaque cursor.
- `AppointmentRequestRepository`: get/list by tenant/location, save aggregate
  and transition with expected version.
- `HandoffRepository`: find active by tenant/conversation, save aggregate and
  transition with expected version.
- `NotificationRepository`: create by tenant/deduplication key, claim due work,
  advance delivery status.
- `AiRunRepository`: create/finish run and proposed-action evaluation audit
  under tenant.
- `ConsentRepository`: append consent decisions and resolve the current
  purpose-compatible decision/lawful basis.
- `AuditEventRepository`: append and tenant-scoped read; no update/delete API.
- `WebhookReceiptRepository` and `IdempotencyRepository`: insert-or-get by
  tenant/connection scope and record outcome.
- `OutboxRepository`: append in the current tenant transaction. Cross-tenant
  due-work discovery is a separate later-reviewed narrow worker boundary;
  publish handling returns to one tenant session.

Forbidden shapes include a tenant repository built from the raw pool/base
database, raw query handles returned to handlers, or a repository method that
accepts a client or second organization ID. The safe shape is conceptually
`tenantSession.leads.get(typedId)`: the session supplies immutable organization
scope, SQL still qualifies by that scope, and another tenant's identifier is
indistinguishable from not found.

## 7. Domain events

Names are stable, past-tense dotted contracts. Each event has `event_id`,
`event_type`, `schema_version`, `organization_id` when tenant-owned,
`aggregate_type`/`aggregate_id`/`aggregate_version`, `occurred_at`,
`actor`, `correlation_id`, `causation_id`, and a minimal schema-valid payload.
Consumers select a validator by `event_type` plus `schema_version`, verify the
matching `schema_id`, and only then interpret the payload; an event type alone
does not identify a wire schema version.

`lead.reopened` keeps its accepted V1 event and payload schemas unchanged for
historical validation and replay. New producers emit V2, still with
`event_type=lead.reopened`, using exactly one closed payload variant:

- `disqualified -> engaged`: `previous_lead_status=disqualified`,
  `lead_status=engaged`, and `reason_code`;
- `booking_requested -> qualified`:
  `previous_lead_status=booking_requested`, `lead_status=qualified`, required
  canonical `appointment_request_id`, and `reason_code`.

V1 facts are never reinterpreted as V2, its legacy structural acceptance of
`booking_requested -> engaged` does not authorize that domain transition, and
new producers do not dual-emit V1 and V2.

Conversation creation emits `conversation.started`, resolution emits
`conversation.resolved`, and closure emits `conversation.closed`. For those
edges the specialized event replaces `conversation.status_changed`; the generic
event is emitted for other real Conversation-status changes.
`conversation.automation_mode_changed` is the separate mode-only provenance
event while status remains `awaiting_staff`. V1 permits exactly `paused -> staff`
for assignment/start of the referenced Handoff and `staff -> paused` when a
requested successor replaces prior staff ownership. A status-changing command
does not additionally emit this mode event because its target mode is fixed by
the status transition. `conversation.active_handoff_changed` is the distinct
reference-only provenance event when a requested successor replaces a requested
Handoff while status remains `awaiting_staff` and mode remains `paused`; its V1
payload carries the previous and successor Handoff IDs and literal reason
`successor_handoff`, and rejects equal IDs. Independent Message and Handoff
events remain separate facts and may coexist.

### 7.1 Core event catalog

| Area | Events |
| --- | --- |
| Organization/access | `organization.created`, `organization.status_changed`, `membership.activated`, `membership.scope_changed`, `membership.revoked` |
| Knowledge | `location.changed`, `service.published`, `service.deactivated`, `service_price.published`, `faq.published`, `business_policy.published` |
| Channels | `channel_connection.activated`, `channel_connection.disabled`, `channel_connection.credential_rotated` |
| Contacts/consent | `contact.created`, `contact.identity_added`, `contact.anonymized`, `consent.granted`, `consent.declined`, `consent.withdrawn`, `consent.not_required_recorded` |
| Leads | `lead.created`, `lead.engaged`, `lead.qualified`, `lead.disqualified`, `lead.booking_requested`, `lead.converted`, `lead.closed`, `lead.reopened` |
| Conversations | `conversation.started`, `message.received`, `message.response_queued`, `message.sent`, `conversation.status_changed`, `conversation.automation_mode_changed`, `conversation.active_handoff_changed`, `conversation.resolved`, `conversation.closed` |
| Booking | `appointment_request.created`, `appointment_request.staff_accepted`, `appointment_request.customer_confirmation_requested`, `appointment_request.confirmed`, `appointment_request.rejected`, `appointment_request.cancelled`, `appointment_request.expired` |
| Handoff | `handoff.requested`, `handoff.assigned`, `handoff.started`, `handoff.resolved`, `handoff.cancelled`, `handoff.expired` |
| Delivery | `notification.created`, `notification.delivered`, `notification.failed`, `notification.dead_lettered` |
| AI governance | `ai_run.completed`, `ai_run.failed`, `ai_run.schema_rejected`, `ai_run.policy_denied` |
| Outcome/ROI | `appointment.attendance_recorded`, `appointment.attendance_corrected`, `appointment.revenue_attributed`, `appointment.revenue_reversed` |

An event is not a command. Consumers cannot reinterpret
`appointment_request.staff_accepted` as `appointment_request.confirmed`.

### 7.2 Event consumers

- The outbox dispatcher publishes committed events to in-process/background
  handlers.
- Notification projectors create durable in-app tasks and optional alerts.
- Analytics projectors create privacy-minimized `analytics_events`.
- Cache invalidation reacts to published knowledge versions.
- Audit is written in the command transaction for security-relevant actions;
  it is not reconstructed solely from best-effort consumers.
- Consumers are idempotent on `event_id` and schema version.

## 8. Global invariants and typed failures

### 8.1 Global invariants

1. Tenant ownership is equality-checked for every aggregate reference.
2. A model/provider/channel payload cannot identify or authorize a tenant user.
3. Domain rows, transition rows, outbox events, audit facts, and analytics facts
   share the originating `organization_id`.
4. Prices and revenue use integer minor units and currency.
5. Business time is evaluated in the configured location zone and stored as UTC.
6. Duplicate input cannot create a duplicate canonical message, appointment
   request, active handoff, or notification intent.
7. A protected transition and its transition history/domain event/outbox record
   commit atomically.
8. AI/provider failure cannot be represented as a successful business action.
9. Analytics and notification delivery states never authorize domain changes.
10. History/provenance keeps the exact knowledge/policy/schema versions used.

### 8.2 Typed domain failures

- `TenantScopeViolation` (internally logged; normally exposed as not found)
- `PermissionDenied`
- `AggregateNotFound`
- `InvalidStateTransition` with current/attempted state
- `ConcurrencyConflict` with current version
- `InvariantViolation`
- `DuplicateCommand` returning prior resource/outcome
- `MissingAuthoritativeData`
- `AmbiguousBusinessData`
- `InvalidTimePreference` / `AmbiguousLocalTime`
- `ConsentRequired`
- `ConfirmationEvidenceInvalid` / `OfferExpired`
- `QualificationIncomplete`
- `RateLimitExceeded` at the boundary

Handlers map these to the shared API error contract without exposing row
existence, SQL, secrets, or internal stack details.

## 9. Lead state machine

`new | engaged | qualified | booking_requested | converted | disqualified | closed`

| From | Command/event | Preconditions | To | Required event/evidence |
| --- | --- | --- | --- | --- |
| (none) | create from first accepted inquiry | Tenant/contact/source valid | `new` | `lead.created` |
| `new` | record meaningful engagement | Accepted non-duplicate message | `engaged` | `lead.engaged` |
| `new`, `engaged` | apply disqualification | Published policy deterministically returns disqualified, or authorized staff reason | `disqualified` | `lead.disqualified` + policy/reason |
| `new`, `engaged`, `qualified`, `booking_requested` | close | Authorized actor/system retention-independent business reason | `closed` | `lead.closed` + reason |
| `engaged` | qualify | All required validated facts satisfy published policy | `qualified` | `lead.qualified` + policy/evidence |
| `disqualified` | reopen | Authorized staff or newly validated evidence explicitly invalidates prior result | `engaged` | `lead.reopened` V2 disqualified/engaged variant + reason |
| `qualified` | appointment request created | Related request committed as `requested` in same workflow | `booking_requested` | `lead.booking_requested` + request ID |
| `booking_requested` | request ends without confirmation | Related request `rejected\|cancelled\|expired` and policy permits retry | `qualified` | `lead.reopened` V2 booking-requested/qualified variant + required request ID/reason |
| `booking_requested` | customer confirmation recorded | Related request committed as `confirmed` | `converted` | `lead.converted` + request ID |

`converted` and `closed` are terminal for that lead record. A later commercial
cycle creates a new lead linked to the same tenant-local contact. Cancellation
after confirmation does not roll `converted` backward; analytics records the
cancellation separately. A command may run multiple valid intermediate
transitions atomically (for example first message `new -> engaged`), but each
transition is separately recorded; it cannot skip preconditions.

Within one Organization, a Contact has at most one active Lead across `new`,
`engaged`, `qualified`, and `booking_requested`. `disqualified`, `converted`,
and `closed` records do not compete, so repeat business creates a new Lead while
retaining history. Reopening a disqualified Lead conflicts when another active
Lead already exists for the same organization/contact. Multiple channel
Conversations may associate with the same active Lead; this rule neither merges
Contacts nor crosses tenant boundaries. S5 enforces the invariant in both the
repository and a normal PostgreSQL partial unique index; Stage 3 remains the
authority for transition legality. The index is not a trigger-based Lead state
machine.

## 10. Conversation state machine

`open | awaiting_lead | awaiting_staff | resolved | closed`

| From | Command/event | To | Rules |
| --- | --- | --- | --- |
| (none) | first accepted message creates conversation | `open + ai` | Channel/contact/lead share tenant; no active Handoff |
| `open + ai` | safe AI-owned response queued | `awaiting_lead + ai` | Emit `message.response_queued` and `conversation.status_changed`; outbound intent is durable |
| `awaiting_lead + ai` | accepted customer message | `open + ai` | Emit `message.received` and `conversation.status_changed`; no active Handoff; stale AI run is invalidated |
| `open + ai`, `awaiting_lead + ai` | requested Handoff established | `awaiting_staff + paused` | Exactly one requested Handoff is established by the atomic workflow; emit `conversation.status_changed` |
| `awaiting_staff + paused` | referenced Handoff assigned/started | `awaiting_staff + staff` | Same Handoff is validated as assigned/in progress; emit `conversation.automation_mode_changed` (`paused -> staff`) |
| `awaiting_staff + staff` | staff-owned customer response queued | `awaiting_lead + staff` | Same assigned/in-progress Handoff remains active; emit `message.response_queued` and `conversation.status_changed` |
| `awaiting_lead + staff` | accepted customer message | `awaiting_staff + staff` | Same assigned/in-progress Handoff remains active; emit `message.received` and `conversation.status_changed` |
| `awaiting_staff + staff` | requested successor replaces terminalized Handoff | `awaiting_staff + paused` | Atomic higher-level workflow installs the new requested Handoff; emit `conversation.automation_mode_changed` (`staff -> paused`) |
| `awaiting_staff + paused` | requested successor replaces terminalized requested Handoff | `awaiting_staff + paused` | Atomic higher-level workflow installs a different requested Handoff; increment Conversation version once and emit `conversation.active_handoff_changed` with old/new Handoff IDs and reason `successor_handoff` |
| `awaiting_staff + paused`, `awaiting_staff + staff` | explicit `resume_ai` disposition | `open + ai` | Higher-level workflow leaves no active Handoff; emit `conversation.status_changed` |
| `open + ai`, `awaiting_lead + ai`, `awaiting_lead + staff`, `awaiting_staff + paused`, `awaiting_staff + staff` | resolve | `resolved + paused` | Emit only `conversation.resolved`; any active Handoff is terminalized atomically by the higher-level workflow |
| `resolved + paused` | accepted customer message within reopen policy | `open + ai` | No active Handoff; emit `message.received` and `conversation.status_changed` |
| `resolved + paused` | archive/close | `closed + paused` | Authorized/system policy, no active Handoff; emit only `conversation.closed` |

`closed` is terminal. A later inbound message creates a new conversation.
Outbound delivery failure does not roll the status back; it creates a visible
delivery failure/handoff according to policy. A conversation cannot be
`awaiting_staff` without an active Handoff. `awaiting_lead + staff` also requires
the same assigned/in-progress Handoff; all other valid combinations prohibit an
active Handoff.

An active Conversation is unique by organization, channel connection, and the
canonical external provider thread/session grouping hash. Active statuses are
`open`, `awaiting_lead`, and `awaiting_staff`; `resolved` and `closed` do not
compete. The grouping hash is derived deterministically from trusted adapter or
widget-session context and never from `ContactId`, so one Contact may have
simultaneous Conversations on different connections or canonical threads and
the anonymous/pre-Contact Widget flow remains supported. Before the first
meaningful message that flow persists as a WidgetSession; the message then
creates/resolves the pseudonymous Contact, Lead, and Conversation atomically.
S5 requires the hash for active rows and enforces the grouping with a normal
PostgreSQL partial unique index, not a SQL Conversation state machine.

When resolution, cancellation, or expiry terminalizes an active Handoff, the
cross-machine command must select exactly one disposition; there is no implicit
default:

- `resume_ai`: Conversation becomes `open` with mode `ai`;
- `resolve_conversation`: Conversation becomes `resolved` with mode `paused`;
- `successor_handoff`: a successor active Handoff is established atomically and
  the Conversation remains `awaiting_staff`; replacing staff ownership changes
  `staff -> paused`, while replacing a requested Handoff keeps mode `paused` and
  emits `conversation.active_handoff_changed`; later assignment/start changes
  `paused -> staff`.

The two mode-only ownership changes emit
`conversation.automation_mode_changed` with the applicable Handoff ID. They do
not misuse `conversation.status_changed` with identical status values. Resume,
resolution, and other genuine status changes use only their applicable status
or specialized Conversation event. A requested-to-requested successor
replacement emits only `conversation.active_handoff_changed` for the
Conversation. Its atomic event order is: current Handoff terminal event,
successor `handoff.requested`, then `conversation.active_handoff_changed`.

A cancellation/expiry command that would otherwise leave `awaiting_staff`
without an active Handoff is rejected.

## 11. Appointment-request state machine

`requested | staff_accepted | awaiting_customer_confirmation | confirmed | rejected | cancelled | expired`

~~~mermaid
stateDiagram-v2
    [*] --> requested: customer submits preference
    requested --> staff_accepted: authorized staff accepts
    requested --> rejected: authorized staff rejects
    requested --> cancelled: customer withdraws
    requested --> expired: review deadline
    staff_accepted --> awaiting_customer_confirmation: confirmation request durably queued
    staff_accepted --> cancelled: staff retracts / customer withdraws
    staff_accepted --> expired: offer preparation deadline
    awaiting_customer_confirmation --> confirmed: explicit customer confirmation
    awaiting_customer_confirmation --> cancelled: customer declines / staff withdraws
    awaiting_customer_confirmation --> expired: offer expires
    confirmed --> cancelled: post-confirmation cancellation
    rejected --> [*]
    cancelled --> [*]
    expired --> [*]
~~~

| Transition | Authorized initiator | Preconditions and atomic effects |
| --- | --- | --- |
| create -> `requested` | Customer command via trusted session/channel; staff-assisted command if permissioned and attributed | Required service/location/contact/preference valid; idempotency key/source message unique; write request + transition + `appointment_request.created` + staff in-app task outbox; lead to `booking_requested` |
| `requested -> staff_accepted` | Active staff member with request location permission | Expected version/status; offered slot valid; store decision actor/time and offer version; write transition, audit, `appointment_request.staff_accepted`, and confirmation-preparation outbox atomically |
| `requested -> rejected` | Active authorized staff | Expected version; reason code; transition/audit/event and customer notice; optionally return lead to `qualified` |
| `requested -> cancelled` | Bound customer participant or authorized staff recording customer withdrawal | Cancellation actor/reason and audit as applicable; no “reject” alias |
| `requested -> expired` | System expiry job | Deadline passed, expected version, no staff decision |
| `staff_accepted -> awaiting_customer_confirmation` | System worker only | In a later transaction, a customer confirmation request/task and delivery intent are durably created with active offer version, expiry, and route/token reference; that record, transition, and event commit atomically |
| `staff_accepted -> cancelled` | Authorized staff or bound customer | Explicit retraction/withdrawal; invalidate offer/token; reason required |
| `staff_accepted -> expired` | System | Preparation deadline passed and no valid confirmation request could be made |
| `awaiting_customer_confirmation -> confirmed` | Bound customer via `customer_session`/`telegram`, or authorized staff recording `staff_attested_external` | Expected aggregate version and evidence `offer_version` both match the locked current request; evidence matches organization/request/contact, is within `[issued_at, expires_at)`, and is not replayed; transition + audit + event; lead to `converted` |
| `awaiting_customer_confirmation -> cancelled` | Bound customer decline/withdrawal or authorized staff retraction | Actor/source/reason; invalidate confirmation token; notify other party |
| `awaiting_customer_confirmation -> expired` | System expiry job | Offer expiry passed under row lock/version check |
| `confirmed -> cancelled` | Bound customer or authorized staff | Explicit post-confirmation reason/actor; preserve confirmed timestamp/event; no calendar side effect in V1 |

All other transitions return `InvalidStateTransition`. Two racing decisions use
expected aggregate version and a row lock/compare-and-swap; exactly one wins.
The loser receives a conflict and the current representation.

Confirmation grants use the half-open interval `[issued_at, expires_at)`: they
are valid only while `now < expires_at` and are expired when
`now >= expires_at`. Equality must fail with `OfferExpired`. Pure behavior
receives `now` explicitly and never reads an implicit system clock.

### 11.1 Confirmation-source rules

- `customer_session`: confirmation token/session is bound to the widget
  participant and active offer; one-time token is stored hashed.
- `telegram`: authenticated provider update maps through the same connection and
  tenant-local participant identity; external update/message uniqueness prevents
  replay.
- `staff_attested_external`: used when an offline widget lead confirms by phone
  or another out-of-platform method. The member asserts that the customer
  explicitly confirmed; store member ID, customer act timestamp, method
  (`phone|in_person` in V1), offer version, a structured attestation,
  and optional protected evidence reference. It is audited and reportable
  separately.

No source lets the accepting staff action itself satisfy customer confirmation.

## 12. Handoff state machine

`requested | assigned | in_progress | resolved | cancelled | expired`

| From | Command/event | To | Rules |
| --- | --- | --- | --- |
| (none) | request handoff | `requested` | Trigger/reason required; reuse active handoff by uniqueness |
| `requested` | assign | `assigned` | Assignee active and authorized for queue/location |
| `requested` | claim and start atomically | `in_progress` | Record implicit assignment transition then start, or two transition rows in one command |
| `requested` | cancel | `cancelled` | Customer withdraws or authorized policy/actor; reason |
| `requested` | expire | `expired` | SLA/queue policy allows; create operational alert if still actionable |
| `assigned` | reassign | `assigned` | Real expected-version-checked transition: bump aggregate version; append `HandoffTransition` with old and new assignee; `handoff.assigned` carries the new assignee only |
| `assigned` | begin work | `in_progress` | Only assignee or authorized queue manager |
| `assigned` | cancel/expire | `cancelled` / `expired` | Reason and expected version |
| `in_progress` | resolve | `resolved` | Resolution code and accountable actor |
| `in_progress` | cancel/expire | `cancelled` / `expired` | Explicit reason; expiry cannot hide an active staff response |

`resolved`, `cancelled`, and `expired` are terminal. Creating a new need creates
a new handoff. Conversation coupling is enforced in the same application
transaction/workflow:

- create active handoff => conversation `awaiting_staff`;
- newly requested handoff => mode `paused`;
- assigned/in-progress handoff => mode `staff` and mode-only Conversation event;
- staff customer-facing response => conversation `awaiting_lead + staff`, with
  the same assigned/in-progress Handoff still active;
- customer reply under staff ownership => conversation `awaiting_staff + staff`;
- terminalize with `resume_ai` => conversation `open`, mode `ai`;
- terminalize with `resolve_conversation` => conversation `resolved`, mode
  `paused`;
- terminalize with `successor_handoff` => establish a successor atomically and
  retain `awaiting_staff`; emit `staff -> paused` for a staff-owned predecessor,
  or `conversation.active_handoff_changed` for a requested predecessor while
  remaining paused, then emit `paused -> staff` after successor assignment/start;
- resolve/cancel/expire an active handoff => require `resume_ai`,
  `resolve_conversation`, or `successor_handoff` and apply the selected
  disposition atomically; no default or implicit AI resume.

## 13. Attendance and revenue outcome facts

Attendance and attributed revenue are P0 minimal manual outcomes because the
product must measure the complete ROI funnel. They are not appointment-request
statuses and do not alter booking confirmation history.

- Authorized staff may record attendance as
  `attended|did_not_attend|unknown` after the offered start, with actor, source,
  occurrence/recorded timestamps, and correction lineage.
- Authorized staff may record zero or more revenue attribution entries with
  integer minor units, ISO currency, category, source, actor, and correction/
  reversal link.
- AI cannot infer, create, edit, total authoritatively, or authorize these facts.
- Corrections append a superseding/reversal fact; audit and analytics preserve
  provenance.
- Requests must have reached `confirmed` before attendance or revenue is
  attributed, unless a future explicit policy supports walk-in conversion.

## 14. Transaction and concurrency boundaries

| Command | Single database transaction must include |
| --- | --- |
| Accept inbound provider message | webhook receipt/idempotency result, canonical message append, contact/lead/conversation creation or version update, domain event/outbox rows |
| Apply AI decision | lock/version checks for triggering message/conversation, validated action result, affected aggregate mutation/transition, response message intent, AI policy result, outbox |
| Create appointment request | request + preference rows, transition, lead transition/version, audit where staff-assisted, domain/outbox events |
| Staff accept | request mutation/version, `requested -> staff_accepted` transition, staff actor/audit, event, confirmation-preparation outbox |
| Staff reject | request mutation/version, `requested -> rejected` transition, staff actor/audit, event, customer-notice outbox |
| Prepare customer confirmation | confirmation grant/task and delivery intent, `staff_accepted -> awaiting_customer_confirmation` transition/version, event/outbox |
| Confirm customer | consume/bind confirmation evidence, request transition/version, lead conversion, audit, event/outbox |
| Create/assign/resolve handoff | handoff transition/version, coupled conversation state where applicable, audit, staff in-app task/outbox |
| Change business knowledge | new immutable version/effective record, audit event, cache-invalidation outbox |
| Record attendance/revenue | append outcome/correction fact, audit, analytics outbox |

External provider calls never occur inside these transactions. Workers lease
outbox/jobs, call with stable idempotency keys, and record results in a later
transaction.

## 15. State-machine test obligations

For each machine:

1. table-driven unit tests cover every allowed edge and every disallowed pair;
2. property tests assert terminal-state and monotonic-version invariants;
3. integration tests assert aggregate, transition, audit, and outbox atomicity;
4. concurrency tests race duplicate accept/reject/confirm/expire commands;
5. idempotency tests repeat the same command with identical and conflicting
   payloads;
6. cross-tenant tests substitute every referenced ID from another organization
   and assert no existence leak or mutation;
7. clock-controlled tests cover UTC boundaries, DST gaps/overlaps, expiry, and
   stale jobs;
8. multilingual/AI tests prove extracted language never changes allowed
   transitions;
9. confirmation tests distinguish staff acceptance, direct customer
   confirmation, and staff-attested external customer confirmation;
10. cancellation tests preserve prior confirmed/conversion history.
11. conversation/handoff coupling tests prove `awaiting_staff -> resolved`
    atomically resolves/cancels the active handoff and rejects an orphaning
    transition.
12. event tests preserve V1 `lead.reopened` decoding and require exactly the two
    V2 variants for new facts.
13. Conversation tests prove specialized creation/resolution/closure events are
    mutually exclusive with `conversation.status_changed` for the same edge.
14. Handoff tests cover all three terminal dispositions, exact automation modes,
    and reassignment version/provenance while its status remains `assigned`.
15. confirmation tests reject either stale aggregate or offer version and reject
    `now == expires_at` using an explicitly supplied clock value.
16. successor-Handoff tests distinguish `staff -> paused` mode provenance from
    requested-to-requested active-reference provenance, reject equal Handoff IDs,
    and preserve terminal-current, successor-requested, Conversation-event order.

## 16. Domain-model open questions

1. Exact permission-bundle granularity within canonical
   `owner|admin|staff|analyst` roles, including which role/capability and
   location scope represent the location-manager persona.
2. Exact channel-specific resolved-conversation reopen/new-cycle windows. The
   active grouping identity itself is frozen and is not an open question.
3. Whether each fixed V1 staff-attestation method (`phone|in_person`) is
   permitted in the launch jurisdiction and what evidence/retention applies.
   Adding another method requires a versioned contract and architecture review.
4. Customer confirmation and staff review expiry defaults and reminder cadence.
5. Whether staff may replace an offered slot; recommended invariant is cancel
   the current offer/request and create a new version/request rather than mutate
   evidence in place.
6. Whether revenue attribution allows partial/multiple currencies per request;
   reporting must never sum unlike currencies.
7. Final retention and legal-hold rules for messages, AI payloads, consent,
   audit, and outcome facts.
