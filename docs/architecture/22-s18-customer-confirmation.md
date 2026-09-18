# S18 — Customer confirmation

Status: implementation checkpoint; formal acceptance is gated by authoritative
GitHub Actions verification and exact-commit promotion.

## Owner-approved boundaries

Staff acceptance is preparation intent, never customer confirmation.
The existing analytics-owned `appointment_request.staff_accepted.v1` handler
prepares the current offer in a later tenant transaction. The state transition,
history, required audit, existing `customer_confirmation_requested` fact,
encrypted customer prompt, and `message.response_queued` intent commit together.
The existing event category, queue ownership, and analytics meaning are retained.

The response is delivered through the accepted Widget, Telegram Business DM,
or Instagram Business DM infrastructure. Phone is optional. One durable prompt
does not imply exactly-once external delivery or customer receipt. Existing
provider reconciliation, bounded retries, and visible dead-letter evidence
remain authoritative; transport acknowledgment never confirms an appointment.

## Fixed confirmation profile

`s18_customer_confirmation.v1` uses trusted UTC instants:

```text
issued_at = time of the successful preparation transaction
expires_at = min(issued_at + 24 hours, accepted_start_at)
valid evidence window = [issued_at, expires_at)
```

An accepted start at/before issuance expires the request without opening a
window. Equal-expiry evidence is rejected. Retries, redelivery, new channel
sessions, duplicate messages, and model output cannot renew issuance or expiry.
Provider reply windows independently limit delivery and cannot extend this
domain window. There is no tenant-configurable expiry, reminder, automatic
renewal, re-offer, or rescheduling policy in S18.

The existing `appointment_request.customer_confirmation_requested.v1` Outbox
fact is available at the immutable deadline and drives the finite expiry
handler under its unchanged analytics ownership. A premature execution retries
through existing reliability infrastructure; a terminal/stale task is obsolete.
The separate `message.response_queued` intent is available immediately.

## Evidence and state authority

Explicit EN/RU/UZ confirmation/decline text is interpreted deterministically.
A bare affirmation requires exactly one current prepared offer in the bound
Conversation. Multiple offers or a counteroffer produce clarification, never
arbitrary UUID selection. An untrusted model-selected target is not authority.
Uzbek understanding normalization does not change stored customer text or
domain rules; generated Uzbek wording uses Latin script.

The source must be an unredacted trusted inbound customer Message belonging
to the same Organization, Contact, Conversation, and channel connection.
Current channel binding, current aggregate/offer versions, durable prompt
context, server ordering, receipt time, and provider-source time are checked.
Newer contradictory input, stale offers, terminal requests, invalid bindings,
wrong tenants, and late evidence fail closed.

Confirmation atomically persists the AppointmentRequest transition/evidence,
Lead conversion, required history/audit/Outbox, response intent, and source
processing pointer. Duplicate or racing workers cannot create a second fact set.
Decline uses the already-approved `cancelled` transition. Changed time preferences
do not confirm or automatically reschedule.

## Instagram additive compatibility

V1 remains unchanged: `customer_session | telegram | staff_attested_external`.
The additive `appointment_request.confirmed.v2` supports those sources plus
`instagram`, derived only from accepted S11 Instagram ingress/binding.
Existing producers remain V1; Instagram produces V2. There are still 63 semantic
event names, now 66 registered variants and 347 cataloged schemas.

Migration 0028 changes only confirmation source/version CHECK compatibility:
no tables, indexes, role/RLS broadening, data rewrite, or historical backfill.
All 345 accepted pre-S18 schemas and all historical V1 evidence retain their
original meaning. Production tables remain 51.

Existing audited `staff_attested_external` domain/persistence support remains
unchanged, including its existing method and fresh-MFA requirements. S18 does
not introduce a new staff attestation endpoint or claim that staff acceptance
is independent customer evidence.

## Explicit deferrals

- No external calendar writes, slot reservation, configurable booking policy,
  automatic confirmation, or automatic re-offer.
- S16 `business_policy_id` remains Qualification V1 provenance; the fixed
  submission profile remains creation authority.
- Shared staff-queue actor-specific read receipts remain deferred as frozen
  in S17. Business state, not read acknowledgment, determines actionability.
- Medical/emergency/symptom content returns typed `grounding_insufficient`
  with `medical_safety_wording_unapproved`; no clinical wording or protected
  action is generated. Healthcare emergency-response readiness remains blocked
  until the owner-approved S21b reviewed EN/RU/UZ safety wording gate.
- End-to-end customer-perceived latency and production launch readiness are
  not proven by S18.

## Verification ownership

Focused application/worker tests cover multilingual intent, expiry boundaries,
tenant context, existing queue ownership, and model bypass prevention.
Real PostgreSQL tests cover the staff-acceptance/customer-response journey,
duplicate/concurrent execution, latest-message ordering, stale/ambiguous offers,
hostile bindings, atomic rollback, source/version constraints, and historical
V1 preservation through 0028. The single authoritative GitHub aggregate owns
final acceptance; passing local checks alone are not an acceptance claim.

Next roadmap slices: S19a Staff UX and S19b Widget UX.
