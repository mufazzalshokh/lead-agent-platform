# S14 — Grounded FAQ / pricing response

One application path consumes trusted canonical `message.received` work from
Widget, Telegram Business, and Instagram Direct. S13's paid Gemini API,
`gemini-3.8-flash`, low thinking, stateless AgentDecision.v1 JSON, 4,000-output-token
profile is unchanged. S14 uses versioned `s14-grounded-answers.v1` product
instructions; the historical S13 evaluated prompt and non-default OpenAI adapter
are preserved. No live evaluations, generic tools, or provider conversation state.

## Approved knowledge and retrieval

The conversation-bound reader requires the existing immutable TenantDbSession.
It derives Contact, Lead, channel, and optional Location/Service context from the
same-tenant Conversation, never from model organization IDs or a fabricated staff
membership. It shares S7's published projection query and validation with the
staff reader: active/current immutable Service and Location versions, published
effective ServicePrices and FAQs, active/effective service-location relationships.
Drafts, expired/retired prices, internal staff notes, qualification policy rules,
publisher identities, and private configuration are not provider facts.

ADR-012 remains unchanged: relational retrieval, bounded existing tenant
projections (100 locations / 500 services / 500 FAQs), lightweight retrieval-only
Latin/Cyrillic normalization, named-service lexical ranking, category matching,
and deterministic FAQ overlap. Original customer text/history remains unchanged.
The existing organization/status/current-version/effective and relationship
indexes support projection reads; generated multilingual tsvector/GIN indexes
remain available without requiring vector infrastructure or a new migration.

Only relevant rendered facts enter S12's context seam: at most 12 references,
2,000 characters/fact, 12,000 fact/reference characters; S12's 24-fact/20,000-total
context limits still fail closed. Application-only rendering metadata is omitted
from provider input. An ambiguous/no-service price request is not a license to
choose an arbitrary service. Multiple named services can have a direct bounded
answer; a partial unknown price does not become a guessed answer.

## Deterministic answer boundary

`grounded_answer` and `grounding_insufficient` are internal application results,
not new public contracts. AgentDecision intent, language, references, safety, and
action are validated. Unsupported/stale citations or protected-action proposals
fail closed. The raw model draft is never delivered: exact approved FAQ wording
or localized deterministic structured templates replace it in full. This also
removes uncited invented numbers, guarantees, availability, or private prose.

Prices use integer minor units and currency scale, preserve fixed/from/range/
quote-required semantics and exact published qualifiers, and reuse S7's
location-specific-over-global precedence. Conflicting same-scope prices or
different prices across unresolved Locations produce typed insufficiency.
Hours come only from published intervals or exact approved FAQs. Missing Sunday
hours do not imply open **or closed**. Explicit Sunday closure in the journey
fixture is an approved FAQ, not an inferred absent interval. Today/tomorrow/
holiday schedules without exact FAQ evidence fail closed; weekly hours never
prove an appointment slot. No booking, qualification, or Handoff action occurs.

Requested published translations are preferred. An exact organization-default
published translation may be quoted with an explicit language clarification;
there is no model-authored authoritative translation. Uzbek replies use Latin;
an unavailable Latin translation fails closed rather than inventing one. English
and Russian use the same rules. Business voice is neutral/direct, without random
first-person singular or unnecessary service clarification.

## Freshness, atomic persistence, and delivery

Existing S12 Message/source/Conversation/version/automation checks run again in
the terminal tenant transaction. The approved fact manifest is reloaded and
hashed; changed or expired facts mark the run stale. Bounded shared Service and
Location root locks coordinate with existing publishers through answer commit;
FAQ row locks protect replacement/retirement. No provider request occurs inside
this transaction and no business retry is introduced.

Validated text is encrypted with existing purpose-/tenant-/channel-bound Message
protection. Message sequence/version allocation, trigger pointer, AI run/evaluation,
bounded source manifest, required tenant audit, and `message.response_queued.v1`
Outbox insertion commit atomically. Duplicate/concurrent terminal attempts cannot
queue another authoritative reply. No hidden reasoning, raw provider envelope,
or full plaintext inference snapshot is stored or logged.

The roadmap authorizes S14's first customer-answer slice; queued encrypted Message
is the accepted outbound boundary. Existing Widget polling and Telegram/Instagram
outbound handlers consume that same persisted text. They retain their existing
recipient binding, origin/authentication, provider-window, credential, and delivery
checks; S14 adds no provider adapter. Replies use the smallest supported plain-text
budget (1,000 UTF-8 bytes) rather than truncating a factual claim or qualifier.
Ordinary insufficient knowledge can queue a deterministic localized uncertainty
message, not a false claim that staff were notified. Stale, unsafe, suppressed,
medical, and unauthorized/protected-action results do not queue a reply.

## Owner-approved medical/emergency deferral and limitations

The original before-S14/S21b reviewed medical/emergency wording requirement is
retained but explicitly deferred to **S21b Security / Safety Hardening** by the
owner. Medical/emergency/symptom/urgent-health inputs and medical model intents/
risk flags return only typed `grounding_insufficient` with internal reason
`medical_safety_wording_unapproved`. No clinical wording, urgency assessment,
diagnosis, treatment/medication recommendation, customer-facing emergency template,
Handoff, AppointmentRequest, or protected action is generated. Customer medical
claims never become approved knowledge. Conservative lexical checks are guards,
not medical classifiers or evidence of clinical readiness.

**Medical/emergency customer-facing handling is NOT PRODUCTION-READY.** Healthcare/
clinic emergency-message staging and launch acceptance are blocked until reviewed
Uzbek/Russian/English jurisdiction-specific wording is approved in S21b. S14 proves
safe fail-closed behavior only. Other limitations: lexical retrieval may decline
semantic paraphrases, missing approved translations and date-specific schedules;
source freshness is checked through persistence commit, not a distributed snapshot
at provider delivery; no physical exactly-once delivery or customer TTFR claim.
Gemini production-data/privacy approval remains the separate launch gate.

## Verification

Focused deterministic tests cover the representative Laser 250,000 UZS /
Consultation 100,000 UZS / Mon–Sat 09:00–18:00 / explicitly closed Sunday journey,
Uzbek Latin/Cyrillic/mixed/slang, Russian/English, ambiguity/missing/conflicting/
irrelevant facts, fake customer/model claims, injection, tenant scope, stale
pricing, protected actions, no clinical content, duplicate concurrency, and
Outbox rollback. S12/S13 regression tests remain deterministic; no paid calls.
Local fixture retrieval timing is observational only, not end-to-end TTFR or a
live-model benchmark. Authoritative acceptance uses one Linux GitHub Actions
`pnpm ci:verify`, including the isolated real PostgreSQL test harness.

Public contracts: unchanged (329). Domain events: unchanged (63 names / 65 variants).
Production tables: unchanged (51). Migration head: unchanged (`0027`).
