# S12 — AI orchestration harness

Historical S12 baseline: [S13.D](s13-production-model.md) now pins the owner-approved
paid-tier Gemini production profile. OpenAI remains supported non-default
infrastructure; the application-owned provider/policy boundary below is unchanged.

S12 provides proposal-only infrastructure. It does not send model-generated
messages, qualify Leads, create Handoffs or AppointmentRequests, confirm bookings,
or implement FAQ/pricing answers. S13 owns model selection, multilingual quality
evaluation, pinning and commercial budgets; S14–S16 own subsequent product policy
and execution. No vector database, migration or public contract is introduced.

## Provider and trust boundary

The application owns `AIProvider.decide`, bounded context, canonical local
`AgentDecision.v1` validation and deterministic policy. `packages/ai` supplies the
first adapter using native fetch rather than another SDK dependency.

The adapter implements the official [Responses API](https://developers.openai.com/api/reference/cli/resources/responses/methods/create)
and [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs):
fixed HTTPS `/v1/responses`, `store:false`, no tools, no provider conversation or
previous-response state, strict `text.format` JSON Schema, bounded output tokens,
non-streaming response, disabled automatic truncation, and an abort deadline.
Redirects are rejected so authorization headers cannot follow another endpoint.

All model output remains untrusted. The schema is mechanically projected from the
unchanged canonical TypeBox schema. Unsupported string-length constraints and
annotation IDs/descriptions are omitted only in the provider projection; types,
required keys, closed objects, finite enums/unions and supported bounds remain.
Local validation enforces the complete canonical schema, including lengths.
Compatibility tests walk both schemas. Actual model/schema capability evaluation
belongs to S13, not a live S12 call.

Versioned immutable application instructions never interpolate customer text.
Customer/history/fact text is separately serialized as explicitly untrusted user
data. A typed whitelist excludes arbitrary row dumps, staff-private content,
credentials, database URLs and authorization. Prompt-injection fixtures do not
gain tools, policy authority or a protected write path.

## Bounds and failure behavior

- Trigger text: 1–4,000 JavaScript characters; recent history: newest 12 messages
  selected by sequence, then sent oldest-to-newest.
- Selected history text: at most 4,000 characters per message; approved facts:
  at most 24, each at most 2,000 characters; aggregate data budget: 20,000
  characters including fact references. Oversized facts are rejected, not
  meaning-changing truncated.
- Provider HTTP response: at most 65,536 bytes; decision text: at most 32,000
  characters; at most one completed assistant text result. Refusal is classified
  before parsing; incomplete/tool-like/multiple/malformed responses cannot become
  a customer response. Reasoning output is discarded, never persisted or logged.
- `OPENAI_API_KEY` and `AI_MODEL` are required only when explicitly opting into
  the worker AI handler. `AI_REQUEST_TIMEOUT_MS` defaults to 15,000 and is bounded
  at 120,000. No production model is selected or pinned by these syntax checks.
- One schema repair maximum: two provider decisions per orchestration, sharing
  one total deadline and the same schema/authority. Each physical invocation has
  its own `ai_runs` attempt. Refusal, timeout, incomplete, policy denial and HTTP
  authentication/request/rate-limit/server failures are not schema-repaired.
  Malformed provider envelopes without known model/decision-output provenance
  are not schema-repaired either.
- Transport retries are **zero** in S12. Clear 429/5xx retryability is recorded in
  the typed provider result; bounded numeric Retry-After is metadata, not a blind
  retry instruction. Ambiguous network errors are non-retryable here.

The internal result is `decision` or `fallback_required` with a finite reason.
Every result has `applied:false`. A candidate draft is **not** verified truth,
permission to send, or evidence that an action happened. Confidence and
`safe_to_send` cannot override policy. Request-information requires a missing
field; phone is not mandatory where a bound channel can continue the flow.
Widget contactability requires an existing active, unexpired session bound to
the same Contact, Conversation and connection; a Widget identity alone is not
treated as a live session. This reads S10 validity, not a new renewal/timing policy.
Confirmation/decline require trusted current target/binding context. The S12
worker supplies no confirmation bindings, so these actions fail closed there.
S15 may later map a fallback to an actual Handoff; S12 never does so itself.

## Tenant persistence and async integration

The existing `message.received` route owns queue `ai`. The private queue envelope
remains reference-only; the handler translates Conversation aggregate ID and
payload Message ID into a fresh tenant-bound load. A source from another tenant
or Conversation is absent, not an authority change.

The store reuses `TenantDatabaseRuntime`/immutable `TenantDbSession`, explicit
tenant-qualified repository primitives and existing Conversation/Contact/Lead
readers. No raw pool/database handle is exposed. The provider is called outside
business transactions. Before terminal persistence the store locks the source and
Conversation, checks current version/automation/state, Contact status, source
redaction, latest inbound sequence and supplied reference freshness. Stale
results are suppressed; no domain state regresses.

S12 defaults to an empty approved-fact set. A finite tenant-session knowledge seam
accepts approved references/text without inventing staff membership or changing
the S7 staff-reader authorization contract. Grounded retrieval/product answers
remain S14 work. Free-form fact text never becomes system instructions.

Existing `ai_runs` holds requested/resolved model, schema/prompt/policy/orchestrator
versions, expected Conversation version, bounded source manifest, hashes, attempt,
UTC lifecycle, finite failure and nullable usage. Unknown usage/cost stays NULL.
Provenance source references use an explicit four-field whitelist; invalid or
over-limit reference sets are omitted from failed-run manifests, not copied as
arbitrary objects. The provider still receives no context when bounds fail.
`not-priced.v1` explicitly denotes no S12 estimate. USD is a storage denomination,
not a claimed price. Commercial cost catalogs and authoritative pricing are later
work.

Snapshots and capture-policy IDs remain NULL. Evaluations persist only encrypted
finite action arguments, bound by AES-GCM tenant/run/purpose AAD; no plaintext
draft, extracted contact facts or hidden reasoning is copied into provenance.
Valid JSON output hashes are derived from the output; unavailable raw output is
not fabricated. Malformed decision JSON with known model/hash can be schema
rejected; malformed provider envelopes without that evidence are finite failures.

Terminal run + evaluation + required tenant audit + canonical Outbox event +
Message processing pointer are one transaction. Existing `ai_run.completed`,
`failed`, `schema_rejected` and `policy_denied` events are sufficient. Completion
requires local schema and policy approval; evaluation is always `not_applied`.
A rejected first attempt remains eligible for one repair; the terminal winner
owns the Message pointer. Concurrent invocations can record distinct attempts,
but only one authoritative completion survives. Duplicate jobs suppress work.

**Physical provider exactly-once is not claimed.** A crash after an external
call can require another invocation. Existing worker logical idempotency plus
transactional source serialization protects authoritative persistence, not
external-call billing exactly-once. Unfinished runs remain evidence, not success.

Telemetry contains only finite operation/outcome/failure, bounded model identity,
schema version, duration, usage and repair/zero-transport-retry metadata,
never prompts, draft prose, fact text, customer identifiers or auth headers.
Provider response IDs are bounded adapter metadata, not domain identifiers.

`store:false` is not a complete privacy/legal retention guarantee. Before enabling
production customer processing, operations must verify provider project data
controls, region, applicable agreements and lawful healthcare/privacy processing.
No live key is needed for deterministic tests; environment examples contain
empty placeholders.

## Verification

Deterministic provider/fetch/context/policy/orchestration/worker tests run offline.
Real PostgreSQL persistence tests register under the existing isolated S4A test
database harness and cover concurrency, symmetric tenant denial, stale results,
repair history, no protected writes, nullable usage, encryption failure and
Outbox failure rollback. Ubuntu GitHub Actions runs the full required aggregate;
no local full aggregate or WSL PostgreSQL setup is required for S12.
