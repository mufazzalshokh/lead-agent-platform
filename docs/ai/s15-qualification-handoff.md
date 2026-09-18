# S15 — Qualification & Handoff

One deterministic sales application flow extends S12 orchestration and S14 grounding.
Widget, Telegram and Instagram share worker composition and encrypted outbound
Message/audit/Outbox persistence. The approved Gemini profile is unchanged. There is
no migration, public contract, dependency or new questionnaire/playbook subsystem.

## Qualification and evidence

Published QualificationPolicy V1 alone is executable: service interest, effective
Service/Location fit, positive customer next-step intent and contactability. Phone,
name, email, budget, preferred time and medical eligibility are not universal
requirements. A valid bound Widget session or trusted bound messaging identity
suffices. A phone/email string alone cannot replace the required usable bound
channel/Conversation identity or establish ownership/deliverability/consent.
Location selection is optional when an effective offering already proves fit.

Published tenant records supply entity identities/offerings. Customer-only messages
and previously validated evidence supply literal service/location mentions and
affirmative next-step statements. Finite case endings and existing transliteration
support Uzbek Latin/Cyrillic/mixed-script and Russian/English controls. Ambiguity never
silently switches interests or merges Contacts. Model extraction must agree with
evidence. Customer prices, hours, guarantees and appointment claims are not trusted
business knowledge.

Immutable `lead_qualification_evaluations` / `lead_qualification_evidence` retain
validated facts, policy identity/version and customer source Message IDs, no raw
customer text or contact PII in plaintext facts. Optional names/phones/emails and
date/time wording remain in existing encrypted inbound Messages; S15 does not
implicitly update/merge identities or infer consent. Evidence must belong to this
Conversation/tenant and reference an unredacted customer inbound no later than the
current sequence.

Incomplete evaluation does not mutate Lead status/interests or increment its version.
All requirements satisfied: `qualifyLead` plus existing S5 persistence commits one
expected-version transition, validated Service/Location storage facts, evidence,
required audit and canonical `lead.qualified` Outbox atomically. S9 already records
engagement. No automatic disqualification, reopening or new grouping rule is added.

Reuse the Lead's explicit applicable policy; otherwise require exactly one applicable
published V1 policy. Missing/ambiguous configuration fails closed to staff, never
arbitrarily selecting a policy key.

## Wording and staff policy

Direct price/hours/location/duration questions use approved S14 rendering first,
followed by at most one actually missing qualification question. Known facts are
reused. A date/affirmative next step reaches typed `appointment_boundary`, without
reserving/promising a slot. Raw model drafts are never delivered. Uzbek uses Latin;
Russian/English use localized defaults. Oversized/unsupported factual replies fail
closed rather than truncate qualifiers. Objections never invent discounts.

Finite application triggers, never model `request_handoff`, authorize escalation:

- explicit human request: `customer_requested`;
- missing approved knowledge or unusable policy: `missing_authoritative_information`;
- known unsupported Service/Location fit or unusable channel binding: `policy_blocked`;
- terminal provider failure, timeout, refusal or exhausted repair: `ai_unavailable`.

Explicit human requests skip inference; internal AI-run `staff_requested` provenance
is not a provider/network failure. `requestHandoffWorkflow` creates one Handoff and
routes/pauses the Conversation to `awaiting_staff`. Product default queue: `staff`;
internal SLA: one hour. Neither a customer delivery nor response deadline is promised.
Configurable tenant playbooks/custom escalation rules remain S19; staff handling is
S17. No new notification delivery subsystem is introduced.

The encrypted acknowledgment queues in the same transaction after workflow success.
Source Message, current Conversation/Lead versions, latest inbound sequence,
effective knowledge and contactability are revalidated under tenant locks. Duplicate,
concurrent, reordered or stale work cannot duplicate state/events/responses or regress
state. Paused/terminal Conversations never auto-reopen. `AIOutcome.applied=false`
still describes the untrusted proposal; internal `salesResult` describes trusted
application persistence, not model authorization.

## Deferred boundaries

Medical/emergency/symptom/urgent-health inputs return `grounding_insufficient` with
`medical_safety_wording_unapproved`: no customer wording, Handoff, AppointmentRequest,
contact mutation or protected action. Model medical flags are a second conservative
gate. Reviewed wording remains owner-deferred to S21b. Healthcare emergency handling
is NOT PRODUCTION-READY; its staging/launch acceptance remains blocked.

S16 owns AppointmentRequest/preferences/booking/availability workflows. S15 never
reserves, confirms, declines, cancels or changes appointments. S19 owns tenant sales
playbooks and qualification beyond frozen V1. Unsupported paraphrases deliberately
remain incomplete rather than trusting model-only facts. No live-model evaluation or
customer-perceived latency claim is added.

## Verification boundary

Focused S15/S9/S12/S14/domain regressions, affected typechecks/builds, lint/format,
boundaries and diff/privacy review precede one authoritative GitHub Actions
`pnpm ci:verify`. The existing deterministic harness registers real PostgreSQL
journey/concurrency/duplicate/tenant/stale/terminal/revocation/medical/injection/
rollback cases beside prior persistence regressions. Exact-commit promotion requires
that gate green; no local aggregate, WSL or verification weakening is used.
