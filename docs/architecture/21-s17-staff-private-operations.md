# S17 — Staff inbox / private operations

S17 builds the private staff backend, not the S19a interface. Existing S9/S11
versioned Contact, Lead, Conversation and message readers remain authoritative;
V1 identity compatibility is unchanged, and Instagram identity uses V2.

## Owner-approved no-migration freeze

Membership-targeted in-app notifications may be acknowledged only by their
intended recipient using the existing recipient-specific `read_at` semantics.
Shared queue items do **not** have independent per-staff read receipts. Their
shared `read_at` is not exposed as a personal read receipt or used to authorize
business actions. Independent staff queue read receipts are explicitly deferred;
their absence is an accepted S17 limitation, not an acceptance blocker.

Queue actionability comes from trusted domain state: active Handoff, Conversation
awaiting staff, or requested AppointmentRequest. Reading/acknowledging a task never
accepts, confirms or resolves a business resource.

Appointment staff acceptance atomically persists the `staff_accepted` transition,
audit and the existing `appointment_request.staff_accepted` Outbox event. That
event is durable evidence that staff acceptance occurred and downstream customer
confirmation preparation will be required. Its existing analytics category,
routing and use remain unchanged. It does **not** mean confirmation was sent,
the appointment is confirmed, or the confirmation workflow executed.

S18 must deliberately decide how to consume this durable preparation intent. S17
adds no confirmation consumer, capability, delivery, calendar entry or automatic
confirmation. Any later new event/routing contract requires an explicit S18
decision. These owner-approved arrangements preserve the original requirements;
they defer independent read receipts and actual confirmation execution rather
than claiming them complete. No migration or new semantic event is authorized.

## Private operations boundary

All routes use the existing staff session, current server-resolved membership,
role/location permission model and mutation Origin/CSRF controls. Repository
reads and writes recheck that membership inside the tenant transaction, explicitly
qualify tenant/location scope, and preserve FORCE RLS. Resource IDs from another
tenant map to local not-found. Opaque keyset cursors bind actor, tenant, scope,
resource and filters. Pages are bounded; message histories are not loaded per row.

Protected decisions use expected-version CAS and the existing idempotency table
and reservation/completion mechanism. Replays require current authorization and
use authenticated encrypted response storage. State, transition history, audit,
required canonical Outbox and idempotency completion commit or roll back together.
There is no automatic business-conflict retry.

Handoff claim/start and resolution use the frozen S3 Conversation-coupled workflows.
Resolution requires explicit `resume_ai` or `resolve_conversation` disposition and
both resource versions. No successor scheduling policy is invented. Appointment
acceptance/rejection uses S3 commands; terminal Conversations cannot be accepted.
Staff chooses a concrete future UTC interval; its local representation is derived
server-side in the pinned location/preference time zone. Acceptance is HTTP 202
with `staff_accepted`, never `confirmed` or `awaiting_customer_confirmation`.

Manual attendance/no-show and exact-minor-unit revenue attribution are private,
audited immutable facts for already-confirmed appointments. Attendance corrections
supersede the current fact without overwriting history; reversals append once in
the original currency. These facts never confirm an appointment.

Work responses are explicit projections, not raw rows: identifiers, state/version,
channel connection, trusted service/location references and bounded preferences.
Sensitive identity/message content stays in the existing authorized staff readers.
No provider payload, hidden reasoning, ciphertext, confirmation capability or
private audit metadata enters the work projection, customer APIs or AI grounding.
Phone remains optional. No summary subsystem, live model call or frontend is added.

Medical/emergency customer responses remain **NOT PRODUCTION-READY** pending S21b
approved wording. S14 fail-closed behavior is unchanged; authorized staff may read
the underlying conversation privately. S17 does not add medical advice or triage.

## Verification boundary

The owner-approved Windows memory exception preserves the 17 passing application
tests and delegates memory-blocked compilation/API checks and local PostgreSQL
proof to one authoritative GitHub Actions `pnpm ci:verify`. Feasible lightweight
checks and additive contract compatibility validation still precede that gate.
Registered PostgreSQL cases cover tenant/location isolation, stable pagination,
CAS races, replay, Handoff coupling, attendance corrections, exact-money reversals,
and required audit/Outbox rollback. Their execution is required on the runner.
No local aggregate or Docker/WSL maintenance is required
merely to reproduce the authoritative runner. Acceptance requires a green real
PostgreSQL gate and promotion of the exact verified commit; this document alone
does not certify implementation acceptance.
