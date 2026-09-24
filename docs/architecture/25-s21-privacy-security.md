# S21 privacy and security freeze

Status: implementation freeze in progress (2026-09-19)

This document records the S21 controls that are specific to the implemented
system. It supplements, and does not replace, the retention, subject-request,
security, and threat-model requirements in
[`07-tenancy-security-privacy.md`](07-tenancy-security-privacy.md).

## Thread automation eligibility

Thread automation eligibility is not Conversation automation ownership.

- `thread_automation_controls` answers whether a mixed-use external social
  thread may enter business automation. It exists before Contact, Lead,
  Conversation, Message, or AI state.
- `conversations.automation_mode` continues to answer who owns responses in an
  already-created business Conversation (`ai`, `paused`, or `staff`).
- A previously unseen Telegram Business or Instagram Direct thread is
  `uncertain`. Customer text, business-like words, and model output cannot
  authorize it.
- Only `business_eligible` enters customer identity/content protection and
  canonical business ingestion. `uncertain`, `excluded_personal`, and
  `staff_only` are safely acknowledged at the provider boundary without an AI
  call or business record.
- A staff transition requires an authenticated active same-tenant Membership,
  `conversations.manage`, expected-version CAS, bounded reason code, and an
  audit event. Customer content is absent from that audit.
- The Widget is already an explicitly business-scoped, origin-bound surface and
  does not acquire this mixed-use-social classification layer.
- Personal/excluded content is not copied to analytics, eval, or training
  storage. A bounded non-content eligibility outcome may be measured later.

The table is tenant-owned, FORCE-RLS protected, and uniquely/indexed by
`(organization_id, channel_connection_id, external_thread_hash)`. Migration
`0029_s21_thread_automation_controls.sql` is additive: it does not backfill or
reinterpret historical Conversations.

## Implemented data inventory

`Policy` below means tenant retention rules and legal holds govern removal;
provisional periods in the main privacy architecture are not active legal
defaults. `Anonymize` means subject plaintext/identifiers are removed while the
minimum non-content operational evidence remains.

| Data category | Purpose and source | Ownership / sensitivity | Persistence | Current retention and recipients/processors | Deletion/redaction |
|---|---|---|---|---|---|
| Staff account identity and external identity | Authenticate staff; Auth0 OIDC and staff onboarding | Platform identity plus tenant Membership; confidential | `users`, `external_identities`, `auth_sessions` | Policy; Auth0 and application DB | Revoke sessions/identity; subject workflow minimizes retained audit evidence |
| Membership and location scope | Authorize tenant/staff operations; owner/admin actions | Tenant-owned authorization data; security-critical | `memberships`, `membership_location_scopes`, invitations | Policy; application DB | Revoke rather than erase active evidence; deletion subject to owner/audit constraints |
| Contact identity, phone, email | Resolve/contact a customer; channel/customer supplied | Tenant-owned PII; phone remains optional | `contacts`, encrypted/hashed `contact_identities` | Policy; application DB and applicable channel | Anonymization primitives remove plaintext/ciphertext mappings while preserving minimal integrity evidence |
| Telegram and Instagram identity | Route a verified business DM and deduplicate | Tenant-owned pseudonymous identity; confidential | protected contact identity plus bounded channel/message IDs | Policy; Telegram/Meta and application DB | Tenant subject workflow; provider deletion where supported |
| Widget session identity | Origin-bound conversation continuity and abuse control | Tenant-owned pseudonymous identifier; security-sensitive | `widget_sessions`; hashes, not bearer token plaintext | Short-lived session plus policy; application DB | Expiry/revocation and subject workflow |
| Thread automation eligibility | Keep personal/uncertain social threads out of automation | Tenant-owned keyed hash and bounded provenance; no message content | `thread_automation_controls`, audit transition | Policy; application DB only | Can be removed with channel/tenant lifecycle subject to audit policy; no raw personal content exists here |
| Messages and Conversation state | Serve business conversation and staff review; customer/staff | Tenant-owned customer content; potentially sensitive | encrypted `messages`, `conversations` | Policy; application DB; bounded context to paid Gemini API only when eligible | Subject anonymization/purge; no ordinary log/analytics copy |
| Lead and qualification facts | Sales workflow and deterministic qualification; customer evidence plus policy | Tenant-owned business/customer data | `leads`, qualification evaluations/evidence | Policy; application DB | Subject anonymization/purge; immutable evidence minimizes plaintext |
| Consent/notice evidence | Prove notice/purpose decision | Tenant-owned legal evidence; confidential | `consent_records` | Approved legal schedule; application DB | Supersede/withdraw; minimum evidence retained only under approved policy |
| Appointment requests/preferences/evidence/outcomes/revenue | Staff-reviewed booking flow and measured outcome | Tenant-owned customer and commercial data; sensitive | appointment tables | Policy; application DB and supported channels | Subject workflow with audit/legal-hold exceptions; exact money remains internal where applicable |
| Handoffs and notifications | Human takeover and staff work | Tenant-owned operational/customer linkage | handoff/notification tables | Policy; application DB; optional provider only when enabled | Resolve/purge under policy; notification content is bounded |
| Published business knowledge | Grounded customer answers | Tenant-owned approved public/internal business facts | location/service/price/FAQ/policy tables | Versioned history; application DB; selected approved facts to AI provider | Retire/supersede; immutable historical provenance retained by policy |
| AI runs, evaluations, token use, provider metadata | Reliability, safety, cost, reproducibility | Tenant-owned operational metadata; no hidden reasoning/provider body | `ai_runs`, `ai_action_evaluations` | Policy; application DB and Gemini API processor | Purge/aggregate; only hashes, bounded failure classes, model/usage metadata retained |
| Audit and security events | Tamper-evident authorization/security evidence | Tenant-owned or platform-only; security-sensitive | `audit_events`, `platform_audit_events` | Longer approved schedule; restricted operators | Immutable minimum non-content evidence; subject fields anonymized where policy allows |
| Analytics, attendance, attributed revenue | Tenant value funnel and internal operations | Tenant aggregate; internal cost/margin operator-only | `analytics_events`, outcome/attribution records | Policy; application DB/observability sinks | Idempotent projection removal/aggregation; aggregate APIs return no phone/email/message body |
| Widget performance telemetry | Content-free TTFR and reliability | Tenant aggregate; low-sensitivity when bounded | observability metrics/events | Operational telemetry policy | No body/prompt/identity payload to redact; labels remain allowlisted |
| Provider/channel operational metadata | Delivery, retry, dedupe, usage, failure class | Tenant-scoped identifiers; confidential | receipts/outbox/attempts and bounded logs | Operational policy; Telegram, Meta, Gemini as applicable | Payload expiry/purge; error bodies and credentials are not logged |

## Data minimization and secondary use

- Bound channel identity or a valid Widget session is sufficient contactability;
  phone, email, and free-form medical history are not universally required.
- Provider envelopes, hidden reasoning, raw prompts/responses, bearer/session
  tokens, connection strings, phone/email, and message bodies are forbidden in
  normal logs and metrics.
- `sensitive_fields_visible=false` is a server projection boundary. The browser
  does not receive unauthorized plaintext.
- Customer statements remain conversation data, never trusted price, hours,
  policy, staff authorization, or cross-tenant training truth.
- Production quality signals are bounded categories, language/script, versions,
  usage, latency, staff outcome, and safety result. There is no raw-chat to
  training/eval/prompt deployment path. Any future example requires authorized
  minimization/redaction, corpus separation, versioned evaluation, and
  controlled promotion.
- Broad CSV/support exports remain deferred. Applicable subject requests use the
  restricted, authenticated, audited operator procedure described in the main
  privacy architecture until a separately approved productized workflow exists.

## Gemini paid API data controls (checked 2026-09-19)

The selected production path is the paid Gemini Developer API, with stateless
requests, no tools, bounded context, and no Google Search/Maps grounding.
Google's current official documentation says paid-service prompts and responses
are not used to improve Google products. It also says standard Gemini Developer
API abuse monitoring retains prompts, contextual information, and outputs for
55 days and can involve authorized human review for flagged usage. Therefore the
repository does **not** claim zero retention, healthcare suitability, or a fixed
data-residency region for this path.

Sources:

- <https://ai.google.dev/gemini-api/docs/zdr>
- <https://ai.google.dev/gemini-api/docs/usage-policies>
- <https://ai.google.dev/gemini-api/terms>

S22 launch gates are: confirm the paid billing project is the deployed project;
accept the current Data Processing Addendum and subprocessor/region position;
confirm eligible launch jurisdictions; verify project access, logging, and data
settings; and decide whether workloads requiring guaranteed zero data retention,
enterprise controls, or health-data handling must use an approved Vertex AI
configuration instead. Search/Maps grounding remains disabled unless its
separate 30-day storage and terms are approved.

## S21 threat-model delta

| Threat | Enforced boundary | Focused proof |
|---|---|---|
| Mixed personal/business social account | Pre-entity thread control; default uncertain; only trusted staff CAS transition enables | Unknown/excluded/staff-only create no Contact/Lead/Conversation/Message/AI/analytics; webhook safely acknowledged |
| Customer/model self-enables automation | No eligibility field in customer/model contract; repository accepts trusted app transition only | Prompt-like unknown input remains uncertain; staff permission/provenance required |
| Cross-tenant control or thread-hash collision | Tenant transaction, composite FKs/unique key, FORCE RLS, scoped lookup | Tenant B sees tenant-local not-found; runtime RLS tests |
| Staff takeover races AI ingestion | Eligibility row locked in the business-ingestion transaction before entity writes | Staff-only/excluded state suppresses; stale CAS rejected |
| Prompt injection/general-assistant escape | Pre-provider hostile/off-topic policy, no tools, closed decision schema, deterministic rendering/actions | Uzbek Latin/Cyrillic, Russian, English and mixed-script scope/injection corpus |
| Business-knowledge poisoning | Customer history is untrusted; only published/versioned facts can support claims | Claimed price/discount/hours/confirmation never mutate knowledge or authorize action |
| Continuous-improvement poisoning | Bounded telemetry only; no automatic corpus/training/prompt write path | Excluded traffic produces no business analytics/AI records; documentation and source audit |
| Sensitive browser/analytics exposure | Backend projection, content-free metrics, operator-only cost/economics | Sensitive projection, aggregate response, and Widget telemetry regressions |
| Webhook replay/forgery | Provider verification, trusted route binding, event/message uniqueness, idempotency | Existing S11 duplicate/reorder/wrong-tenant/security suites plus S21 eligibility tests |
| Widget cross-origin/replay | Sandboxed iframe, exact origin/window, single-use short-lived grant, restrictive CSP | Existing S10/S19 origin/window/expiry/redeem tests remain frozen |
| Membership/RBAC staleness | Membership reloaded; active same-tenant permission required | Suspended Membership cannot transition eligibility |
| Error/secret leakage | Typed public problems and bounded failure categories; no raw provider/database body | Focused response/log/secret scans |
| AI cost or request abuse | Dedupe and eligibility before AI, bounded context/output/deadline/budget; Widget/IP/session/tenant limits | Existing S8/S12/S20 reliability/cost tests; S22 edge deployment validates shared-instance limits |

## Medical/emergency wording gate

S14's owner-approved deferral is retained as history. On 2026-09-24 the owner
approved the final Uzbek Latin, Russian, and English texts. They are versioned as
`MEDICAL_SAFETY_WORDING_V1` and selected by deterministic application policy
before provider processing. Medical input produces only the locale-specific
approved response with internal reason `medical_safety_response`; it never uses
model-written medical prose, clinical guidance, diagnosis, treatment/medication
recommendation, AI urgency determination, Handoff, AppointmentRequest, or another
protected action. No jurisdiction-specific emergency number is invented.
