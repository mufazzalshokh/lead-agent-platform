# S16 — Appointment request

## Authority and owner-approved temporary provenance

Creation uses fixed internal `s16_appointment_submission.v1`, not configurable
tenant booking policies. Model intent, extracted preferences and actions are
proposals only. The application independently requires same-tenant active
Conversation/Contact/Lead context, Qualification V1 evidence, published service
and location versions, authoritative hours/closures/duration, usable bound
Widget/Telegram/Instagram contactability, customer date/time evidence, future
validity, current versions and idempotency. Phone remains optional.

`business_policy_id` records the applied existing Qualification V1 provenance.
It is **not** a tenant-configurable booking policy or the authority for booking.
Every creation separately records `submission_profile_version`, qualification
policy ID/version, customer date/time source message IDs and approximate-time
status in immutable required audit metadata. No new public contract or field,
booking-policy table, arbitrary booking JSON, dependency or migration is needed.
Qualification V1 semantics remain unchanged. The frozen separate future booking
policy decision remains required; future work must not reinterpret historical
S16 requests without an explicit compatibility/migration decision.

## Customer flow and dates

One shared application path serves Widget, Telegram Business and Instagram Direct.
S14 grounded facts and S15 qualification/Handoff are reused. Direct business
questions are answered first, followed by at most one useful missing question.
Only actual customer messages supply request preferences; staff/system messages,
model dates and customer availability/approval claims are not authority.

Relative today/tomorrow/day-after-tomorrow in Uzbek Latin/Cyrillic, Russian and
English are anchored to the original server receipt in the authoritative Location
timezone. Canonical dates remain YYYY-MM-DD, UTC instants are persisted, and
Uzbekistan customer dates display DD-MM-YYYY. Exact HH:mm and explicit AM/PM keep
their minutes. Bare `3 da`, `5larda` and `around 5` resolve only when authoritative
hours admit one interpretation; approximate phrasing remains customer preference,
never availability. Pure fuzzy `kechroq`, `kechqurun`, `ertalab`, `вечером` and
`in the evening`, competing dates/times, invalid dates and DST gaps/overlaps require
clarification. No invented exact time or unsupported fuzzy-range schema.

The published duration defines the preferred end; the full interval must fit
effective offering dates and the day's hours/closure override and remain future.
Missing authoritative duration/context follows the existing deterministic
missing-information staff Handoff, never a guessed duration. Hours are not slots.
The only appointment state created is `requested`; offered slot columns remain
null and offer version remains zero. Submitted wording acknowledges staff review,
never confirmation, reservation, availability or guaranteed booking.

## Atomicity and replay

Terminal AI persistence locks current Conversation/Lead, authoritative roots and
bound contactability, rechecks context and computes the current plan. Advancing
projection clock/locale metadata alone is not treated as changed authority; changed
effective records still invalidate it. Existing S3 workflow and S5 atomic writer
create the request/preferences/history, Lead `booking_requested`, required audits
and canonical Outbox together with the encrypted customer reply and AI/source
processing pointers. A minimal tenant-owned durable in-app staff task with audit
and canonical Outbox is created in the same transaction; no S17 inbox UX/API or
optional alert delivery is implemented.

Logical source dedupe, expected-version CAS, current latest inbound and the locked
Lead serialize duplicate jobs/channel delivery and concurrent workers. Repeated
proposals cannot add another active request. After a prior terminal request and an
already authorized domain Lead retry, a genuinely later customer request may be
created distinctly; S16 does not itself authorize expiry, cancellation or retry
policy. Prior terminal source sequences cannot supply new booking intent/date/time.
Stale/terminal state, active staff Handoff, redaction, revoked bindings, foreign
references, fake authority and model confirmation fail closed. Required audit,
Outbox, task or reply failure rolls back all creation writes.

## Scope and verification

No calendar/availability source, slot reservation, staff acceptance/rejection,
customer confirmation, cancellation UX, configurable booking policy or S17 work.
The S14–S16 medical/emergency fail-closed deferral remains unchanged: typed
`grounding_insufficient`, no improvised medical/safety response, Handoff or request.
Healthcare emergency handling remains NOT PRODUCTION-READY until S21b approves
reviewed Uzbek/Russian/English wording.

Focused application/provider and affected S9/S12/S14/S15 regression tests run
locally; creation, provenance, race, hostile-tenant, stale-state and required-write
rollback PostgreSQL tests run in the existing real PG17 Linux acceptance harness.
One authoritative GitHub Actions `pnpm ci:verify` is the acceptance boundary.
Synthetic planning timing measures only deterministic application overhead, not
DB/provider latency or customer-perceived TTFR. No S13 benchmark is repeated.

Next stage after accepted exact-commit promotion: **S17 — Staff inbox / private
operations**. S17 is not implemented by this change.
