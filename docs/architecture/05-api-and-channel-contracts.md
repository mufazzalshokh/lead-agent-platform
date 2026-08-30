# 05. API and Channel Contracts

Status: **Stage 0 normative specification**
Scope: V1 REST boundaries and provider-neutral messaging adapters. This document
defines contracts, not handlers or integration code.

## Contract principles

- The public HTTP base path is `/v1`. A new major version is required for a
  breaking semantic or structural change.
- All external input is runtime-validated against JSON Schema before it reaches
  application or domain code. Unknown object properties are rejected unless a
  contract explicitly marks an extension map.
- API schemas, generated TypeScript types, OpenAPI, webhook fixtures, and domain
  command DTOs are generated from or checked against one source in
  `packages/contracts`; handwritten duplicate interfaces are prohibited.
- JSON property names and enum values use `snake_case`. Resource identifiers are
  UUIDv7 strings. Canonical timestamps are UTC RFC 3339 strings; business time
  input includes an IANA time-zone identifier or is interpreted using the
  selected location's configured time zone.
- Money is `{ "amount_minor": integer, "currency": "ISO-4217" }`; floating-point
  amounts are invalid. API clients never submit an authoritative price when
  creating an appointment request.
- Tenant identity is resolved and authorized on the server. Any tenant-like
  value from a client is only an untrusted selector and never proof of access.
- Mutations use explicit application commands. A PATCH or action endpoint may
  request a transition, but only the domain state machine can accept it.
- External side effects are not performed inside request/database transaction
  sequences. A successful domain transaction appends an outbox event; workers
  deliver notifications and channel messages.

## Shared HTTP conventions

### Headers and media types

| Header | Direction | Rule |
|---|---|---|
| `Content-Type: application/json` | request | Required when a body is present. Webhook adapters may require the provider's exact media type. |
| `Accept: application/json` | request | Default response representation. Errors use `application/problem+json`. |
| `X-Request-Id` | both | Client may supply a valid non-PII identifier; otherwise the API creates one. It is returned and propagated to traces/jobs. |
| `Idempotency-Key` | request | Required on the designated create/command operations below. 8-128 printable ASCII characters; never contains PII. |
| `If-Match` | request | Required for configuration updates and state-changing staff commands. Value is the resource version ETag. |
| `ETag` | response | Returned for mutable resources. |
| `Retry-After` | response | Included for `429` and temporary `503` responses when known. |

Request bodies have endpoint-specific byte and field-length limits. The edge
rejects oversized requests before parsing. UTF-8 is required. HTML supplied in
message or knowledge fields is treated as text; the API never promises it is
safe to render.

### Success envelope

Single-resource responses use:

```json
{
  "data": {
    "id": "0193f1a8-7f65-7c28-a434-a10796c41c2b",
    "resource_type": "appointment_request"
  },
  "meta": {
    "request_id": "req_01J..."
  }
}
```

Collections add pagination metadata:

```json
{
  "data": [],
  "meta": {
    "request_id": "req_01J...",
    "next_cursor": "opaque_base64url_value_or_null",
    "has_more": false
  }
}
```

Creation returns `201`; accepted asynchronous work returns `202`; a command
that produced no representation returns `204`. A duplicate idempotent request
returns the original status and representation, with
`Idempotency-Replayed: true`.

### Error model

Errors follow an RFC 9457-style problem shape and stable application codes:

```json
{
  "type": "https://api.lead-agent.example/problems/invalid-transition",
  "title": "Invalid state transition",
  "status": 409,
  "code": "appointment_transition_invalid",
  "detail": "The appointment request cannot be accepted from its current state.",
  "instance": "/v1/staff/appointment-requests/0193.../accept",
  "request_id": "req_01J...",
  "errors": [
    {
      "path": "/expected_version",
      "code": "stale_version",
      "message": "Refresh the resource and try again."
    }
  ]
}
```

`detail` and validation messages are safe for clients and contain no stack,
SQL, provider payload, secret, or cross-tenant existence information. `errors`
is optional. Stable codes include:

| HTTP | Representative codes | Meaning |
|---:|---|---|
| 400 | `request_malformed`, `validation_failed` | Syntax/schema failure. |
| 401 | `authentication_required`, `token_invalid`, `webhook_signature_invalid` | No valid principal/provider proof. |
| 403 | `permission_denied`, `origin_not_allowed`, `csrf_invalid` | Authenticated/resolved actor lacks permission. |
| 404 | `resource_not_found` | Missing or inaccessible tenant resource; do not reveal which. |
| 409 | `idempotency_conflict`, `version_conflict`, `appointment_transition_invalid` | Same key/different payload, stale write, or domain conflict. |
| 422 | `business_rule_failed`, `customer_confirmation_invalid` | Valid JSON cannot satisfy a domain invariant. |
| 429 | `rate_limited` | Per-IP/session/account/tenant budget exceeded. |
| 503 | `dependency_unavailable`, `temporarily_unavailable` | Safe retry or handoff path is active. |

Unexpected errors map to a generic `500 internal_error`; details remain in
PII-redacted telemetry correlated by `request_id`.

### Pagination, filtering, and ordering

- Collections use keyset pagination: `?limit=50&cursor=<opaque>`. Default `50`,
  maximum `100`. A cursor is signed or server-opaque and binds route, tenant,
  filters, sort order, and last sort values.
- Offset pagination is prohibited for mutable operational collections.
- Default ordering is stable: `(created_at DESC, id DESC)`. Routes may expose a
  documented allowlist such as `sort=updated_at` and `status=...`; arbitrary
  field or SQL-like filters are rejected.
- A cursor from another tenant, actor scope, or query is invalid, not re-scoped.

### Idempotency and concurrency

For designated REST operations, the server stores a hash of the authenticated
principal, resolved `organization_id`, route/command, idempotency key, and
canonical request body in `idempotency_keys` in the same transaction as the
domain change. Rules:

1. Same scope, key, and body returns the recorded result.
2. Same scope and key with a different body returns `409 idempotency_conflict`.
3. A key cannot cross an organization or authenticated principal boundary.
4. Records remain available for at least 24 hours; client retry windows must not
   exceed the configured retention.
5. Provider webhooks use provider event/message identity, not the REST header,
   and are deduplicated before domain commands.

Mutable resources carry an integer `version`. The ETag is derived from resource
identity and version. `If-Match` plus a transactional version predicate prevents
lost updates and double staff decisions. Idempotency does not replace optimistic
concurrency.

## Authentication and authorization

### Principal types

| Surface | Principal | Authentication | Tenant resolution |
|---|---|---|---|
| Staff/private | Human user | OIDC-compatible login establishes an opaque, revocable server-side session in a Secure, HttpOnly, SameSite cookie; short idle/absolute lifetime; MFA required for owners/admins | Active organization selector is verified against server-side active membership on every request. |
| Anonymous widget | Widget session | Short-lived, audience-scoped widget bearer token issued by the session bootstrap | Publishable widget key resolves configuration; token binds immutable `organization_id`, `channel_connection_id`, origin, and conversation/session. |
| Telegram webhook | Provider delivery | Adapter verifies provider secret/signature against raw bytes before parsing | Opaque route connection key plus verified provider account resolves one active channel connection. |
| Future Instagram/WhatsApp webhook | Provider delivery | Adapter-specific signature, timestamp, and replay verification | Verified provider account/connection mapping; never a payload `organization_id`. |
| Background worker | Workload identity | Separate least-privilege database/application credential | Tenant carried in a trusted job created from an already resolved transaction and re-established for each job. |
| Platform operations | Platform operator | Separate admin audience, MFA, step-up for sensitive actions | No implicit tenant scope; an explicit, audited support grant is required. |

The V1 tenant membership roles are:

- `owner`: organization lifecycle, memberships, channel credentials, privacy
  export/deletion approval, and all tenant administration;
- `admin`: operational configuration, memberships except ownership transfer,
  integrations, conversations, leads, bookings, handoffs, and reporting;
- `staff`: conversations, leads, appointment decisions, handoffs, and the
  minimum customer/contact data needed to serve them;
- `analyst`: read-only funnel and aggregate reporting; no integration secrets
  and no message/contact body access by default.

Each tenant membership can additionally be restricted to an explicit set of
locations. Role permission and location scope must both pass; an empty restricted
set grants no location access.

Role checks are permissions in application policy, not UI visibility checks.
Membership must be active. High-risk actions require recent authentication and
produce an `audit_event`. Customer/widget actors are not organization members.

For cookie-authenticated mutations, the API validates an anti-CSRF token bound
to the session and checks `Origin`/`Sec-Fetch-Site`; cookies use `Secure`,
`HttpOnly`, and an appropriate `SameSite` policy. CORS is deny-by-default and
does not grant authorization.

## Staff/private API

Prefix: `/v1/staff`
Authentication: staff session required.
Organization selection: `X-Organization-Context: <uuid>` is an untrusted
selector. Middleware loads an active membership and installs the verified
tenant context before any repository call. Single-organization clients still
send or negotiate this context; no default can accidentally inherit another
request's tenant.

### Resource surface

| Method and path | Permission | Contract/notes |
|---|---|---|
| `GET /me` | authenticated | Current user, active memberships, and allowed organization selectors. |
| `GET /organization` | member | Current organization profile and privacy/configuration versions. |
| `PATCH /organization` | `organization:write` | Owner/admin; `If-Match`; JSON Merge Patch allowlist. |
| `GET, POST /memberships` | `membership:read/write` | Owner/admin; invite/create is idempotent; role elevation is audited. |
| `PATCH, DELETE /memberships/{id}` | `membership:write` | Cannot remove/demote final owner; `If-Match`. |
| `GET, POST /locations` | `configuration:read/write` | Location name, IANA time zone, address, contact details. |
| `GET, PATCH /locations/{id}` | `configuration:read/write` | Configuration changes are versioned and audited. |
| `GET, PUT /locations/{id}/business-hours` | `configuration:read/write` | Versioned weekly local-time schedule evaluated in the location IANA zone; `If-Match`. |
| `GET, POST /locations/{id}/closures` | `configuration:read/write` | Date/time closures with reason and effective interval; idempotent create. |
| `DELETE /locations/{id}/closures/{closure_id}` | `configuration:write` | Versioned retire/cancel semantics; no destructive history loss. |
| `GET, POST /services` | `configuration:read/write` | Service facts only; no free-form authoritative price. |
| `GET, PATCH /services/{id}` | `configuration:read/write` | Disable rather than silently remove referenced services. |
| `GET, PUT /services/{id}/locations` | `configuration:read/write` | Active/effective service-location mappings; all referenced locations are same-tenant. |
| `GET, POST /services/{id}/prices` | `pricing:read/write` | Integer minor units, currency, effective range; overlap rule is domain-validated. |
| `GET, POST /faqs` | `configuration:read/write` | Lists immutable versions or creates a `draft` with stable `faq_key`, optional service/location scope, effective interval, and atomic `question_i18n`/`answer_i18n` maps whose only locale keys are `uz`, `ru`, and `en`; content remains untrusted data. |
| `GET /faqs/{id}` | `configuration:read` | Returns one exact version, including `version_no` and `draft`, `published`, or `retired` status; it never silently substitutes a different version. |
| `POST /faqs/{id}/publish` | `configuration:write` | Publishes a draft with `If-Match`; validates both bounded locale maps and the organization default locale, then atomically retires any current version for the same key/scope. Published content is immutable. |
| `POST /faqs/{id}/retire` | `configuration:write` | Idempotently retires a published version with `If-Match`; referenced history remains immutable. |
| `GET, PUT /business-policy` | `configuration:read/write` | Qualification, handoff, appointment, and response policies; `If-Match`. |
| `GET, POST /channel-connections` | `integration:read/write` | Metadata returned; credentials accepted only through secret-specific write fields and never echoed. |
| `PATCH /channel-connections/{id}` | `integration:write` | Versioned allowlisted metadata/status change; secret values are never returned. |
| `POST /channel-connections/{id}/rotate-credential` | `integration:write` | Step-up, idempotency and audit required; encrypted replacement with bounded overlap/revocation. |
| `POST /channel-connections/{id}/disable` | `integration:write` | Step-up, `If-Match`, idempotency and audit; disables ingress/egress without deleting history. |
| `GET, PUT /channel-connections/{id}/widget-origins` | `integration:read/write` | Widget connections only; canonical exact/wildcard origins, versioned with `If-Match` and audited. |
| `GET /contacts/{id}` | `contact:read` | Minimum masked/full fields according to role/location and purpose; no cross-tenant existence disclosure. |
| `PATCH /contacts/{id}` | `contact:write` | Validated correction/merge-independent fields; `If-Match`, audit, and consent/purpose policy. |
| `GET /leads` | `lead:read` | Cursor list; filters by documented status, location, assignee, timestamps. |
| `GET, PATCH /leads/{id}` | `lead:read/write` | Assignment/labels via allowlist; lifecycle transitions use domain commands. |
| `POST /leads/{id}/disqualify` | `lead:write` | Reasoned, versioned/idempotent domain transition; cannot be inferred solely by AI. |
| `POST /leads/{id}/close` | `lead:write` | Reasoned, versioned/idempotent close command. |
| `POST /leads/{id}/reopen` | `lead:write` | Only from a permitted state under business policy; versioned/idempotent. |
| `GET /conversations` | `conversation:read` | Cursor list; filters by status/channel/assignment. |
| `GET /conversations/{id}` | `conversation:read` | Metadata and participant summary. |
| `GET /conversations/{id}/messages` | `conversation:read` | Cursor list with redacted/authorized message representations. |
| `GET /conversations/{id}/ai-runs` | `ai:read` | Redacted run/action-evaluation/source/policy summaries; no raw prompts, hidden reasoning, secrets, or unrestricted provider bodies. |
| `GET /ai-runs/{id}` | `ai:read` | Tenant/location-authorized diagnostic representation with model/profile/schema/prompt versions, usage, outcome and safe failure codes. |
| `POST /conversations/{id}/messages` | `conversation:reply` | Staff reply; requires `Idempotency-Key`; persists message + outbox atomically. |
| `POST /conversations/{id}/resolve` | `conversation:write` | `If-Match`, `Idempotency-Key`; state machine validates. |
| `POST /conversations/{id}/reopen` | `conversation:write` | `If-Match`, `Idempotency-Key`; policy-controlled. |
| `GET /appointment-requests` | `appointment:read` | Cursor list; status/location/date filters. |
| `GET /appointment-requests/{id}` | `appointment:read` | Includes transition history visible to staff. |
| `POST /appointment-requests/{id}/accept` | `appointment:decide` | Staff supplies proposed appointment instant/location/optional staff note; `If-Match` and `Idempotency-Key`. Commits `staff_accepted` plus a prepare-confirmation outbox event and returns `202` with that durable state. |
| `POST /appointment-requests/{id}/reject` | `appointment:decide` | Reason code plus optional customer-safe message; `If-Match` and idempotency. |
| `POST /appointment-requests/{id}/cancel` | `appointment:decide` | Policy-authorized cancellation; idempotent command. |
| `POST /appointment-requests/{id}/attest-customer-confirmation` | `appointment:decide` | For an offline/unreachable customer only: requires recent auth, an `attestation_method` of `phone` or `in_person`, actual confirmation time, `If-Match`, idempotency, and an audit event with source `staff_attested_external`. |
| `GET /appointment-requests/{id}/attendance` | `outcome:read` | Current attendance fact plus immutable correction history. |
| `POST /appointment-requests/{id}/attendance` | `outcome:write` | Record an initial `attended`, `did_not_attend`, or `unknown` fact for a confirmed request after its offered start; `If-Match`, idempotency, actor/source/audit required. |
| `POST /appointment-requests/{id}/attendance/{attendance_id}/correct` | `outcome:write` | Append a superseding attendance fact and reason; never overwrite history; `If-Match` current fact and idempotency required. |
| `GET /appointment-requests/{id}/revenue-attributions` | `outcome:read` | Cursor list of immutable charge/adjustment/reversal facts; currencies are never silently summed. |
| `POST /appointment-requests/{id}/revenue-attributions` | `outcome:write` | Add a staff-manual `charge` or `adjustment` for a confirmed request using positive integer minor units, ISO currency, category, recognized time, actor/source/audit; idempotency required. |
| `POST /appointment-requests/{id}/revenue-attributions/{attribution_id}/reverse` | `outcome:write` | Append one same-currency reversal linked to an unreversed attribution; reason and idempotency required; original row remains immutable. |
| `GET /handoffs` | `handoff:read` | Cursor list; state/assignee filters. |
| `POST /handoffs/{id}/assign` | `handoff:write` | Assignee membership is checked in this organization. |
| `POST /handoffs/{id}/start` | `handoff:write` | Transition to `in_progress`. |
| `POST /handoffs/{id}/resolve` | `handoff:write` | Resolution code; versioned/idempotent. |
| `POST /handoffs/{id}/cancel` | `handoff:write` | Authorized actor, reason, `If-Match`, and idempotency; terminal transition only when policy permits. |
| `GET /notifications` | `notification:read` | Durable in-app staff inbox; cursor list filtered by assignment/type/read state and membership location scope. This is the P0 notification authority. |
| `POST /notifications/{id}/mark-read` | `notification:read` | Idempotent actor-specific read acknowledgement; it never changes the referenced domain state. |
| `GET /audit-events` | `audit:read` | Owner/admin; append-only event metadata, no unrestricted payload dumps. |
| `GET /analytics/funnel` | `analytics:read` | Aggregate results; explicit time range, location and time-zone semantics. |
| `POST /contacts/{id}/consents/{purpose}/withdraw` | `privacy:manage` | **P1 reserved:** append withdrawal evidence; idempotent and audited; never rewrite the original grant. |
| `POST /privacy/exports` | `privacy:manage` | **P1 reserved:** owner-authorized asynchronous tenant export; idempotent and audited. |
| `POST /privacy/deletion-requests` | `privacy:manage` | **P1 reserved:** validated deletion workflow, not immediate ad hoc SQL deletion. |

The three privacy routes above are contracts reserved for P1 and are not exposed
in P0. In P0, an explicit withdrawal received by widget, Telegram, or staff
creates a durable privacy task and suppresses the affected optional purpose
pending resolution. The verified operator runbook authenticates the subject and
tenant, determines the exact purpose, appends `withdrawn` consent evidence and
an audit event, and records completion; it does not rewrite the original grant
or imply deletion. Required service/booking communications continue only under
their separately recorded lawful basis. Counsel may elevate a productized route
to P0 before launch.

### Representative request schemas

Staff acceptance does not create a confirmed booking. Its database transaction
records the concrete accepted-slot facts, the distinct `requested ->
staff_accepted` transition, audit data, and a prepare-confirmation outbox event.
The HTTP command returns `202` with the durable `staff_accepted` representation.
An idempotent worker later locks the aggregate and, in a new tenant-scoped
transaction, creates the current customer-confirmation capability/task and
delivery intent and records `staff_accepted -> awaiting_customer_confirmation`
atomically. A retryable preparation failure leaves the explicit
`staff_accepted` state recoverable and observable; exhausted retries create a
staff inbox incident task. Provider delivery from the durable intent remains
asynchronous.

```json
{
  "$id": "StaffAcceptAppointmentRequest.v1",
  "type": "object",
  "additionalProperties": false,
  "required": ["scheduled_start_at", "location_id"],
  "properties": {
    "scheduled_start_at": { "type": "string", "format": "date-time" },
    "location_id": { "type": "string", "format": "uuid" },
    "duration_minutes": { "type": ["integer", "null"], "minimum": 5, "maximum": 480 },
    "customer_message": { "type": ["string", "null"], "maxLength": 1000 }
  }
}
```

The response representation contains `status`, `preferred_time_text`, parsed
preference fields if available, staff-approved `scheduled_start_at`,
`location_id`, `version`, and timestamps. It never labels the lead's preferred
time as available.

Attendance and revenue are manual ROI facts, not appointment states and never AI
outputs. Representative command bodies are:

```json
{
  "$id": "RecordAppointmentAttendance.v1",
  "type": "object",
  "additionalProperties": false,
  "required": ["outcome", "occurred_at"],
  "properties": {
    "outcome": { "enum": ["attended", "did_not_attend", "unknown"] },
    "occurred_at": { "type": ["string", "null"], "format": "date-time" },
    "reason_code": { "type": ["string", "null"], "maxLength": 100 }
  }
}
```

```json
{
  "$id": "CreateRevenueAttribution.v1",
  "type": "object",
  "additionalProperties": false,
  "required": ["entry_type", "amount_minor", "currency", "category_code", "recognized_at"],
  "properties": {
    "entry_type": { "enum": ["charge", "adjustment"] },
    "amount_minor": { "type": "integer", "minimum": 1 },
    "currency": { "type": "string", "pattern": "^[A-Z]{3}$" },
    "category_code": { "type": "string", "minLength": 1, "maxLength": 100 },
    "recognized_at": { "type": "string", "format": "date-time" },
    "reason_code": { "type": ["string", "null"], "maxLength": 100 }
  }
}
```

The server sets `source=staff_manual`, actor membership, and recorded time. A
correction/reversal body supplies the replacement values or reversal reason;
route identity supplies the immutable row being superseded/reversed. Policy
rechecks same-tenant/location ownership and that the appointment request is
`confirmed` in the transaction. It emits audit and analytics outbox facts
exactly once.

## Anonymous widget API

Prefix: `/v1/widget`
Authentication: only session bootstrap is unauthenticated. A publishable widget
key is an identifier, not a secret and not authorization.

### Bootstrap

`POST /v1/widget/sessions` accepts:

```json
{
  "widget_key": "wpk_live_public_identifier",
  "page_url": "https://clinic.example/services/implants",
  "requested_locale": "uz"
}
```

The server derives and validates the browser `Origin`, resolves one enabled
widget `channel_connection`, checks its exact/wildcard domain allowlist, and
returns only public presentation configuration plus a short-lived widget token.
The token has an audience, expiry, unique ID, immutable organization/channel
binding, and minimal scopes. `page_url` is context data and cannot establish an
origin or tenant. Bootstrap is rate-limited per IP, widget key, origin, and
tenant budget.

### Widget resources

| Method and path | Authentication | Contract/notes |
|---|---|---|
| `POST /sessions` | widget key + allowed browser origin | Issues scoped short-lived token and public configuration. |
| `POST /conversations` | widget token | Creates a conversation when the token has none, or idempotently resumes only the immutable conversation already bound into the token/server session; the body cannot select a conversation ID. Requires `Idempotency-Key`. |
| `GET /conversations/{id}` | conversation-bound token | Returns only the lead-visible state. Cross-conversation IDs return `404`. |
| `GET /conversations/{id}/messages` | conversation-bound token | Cursor/`after` retrieval; only customer-visible messages. |
| `POST /conversations/{id}/messages` | conversation-bound token | Text only in V1; idempotency required. Returns `202` when orchestration is queued. |
| `POST /appointment-requests/{id}/confirm` | conversation-bound token + one-time confirmation grant | Deterministically confirms only from `awaiting_customer_confirmation`; idempotent. |
| `POST /appointment-requests/{id}/decline` | same | Deterministically cancels/declines according to policy; idempotent. |
| `POST /handoffs` | conversation-bound token | Explicit human request; idempotent and safe if one active handoff already exists. |
| `POST /consents/{purpose}/withdraw` | conversation-bound token | **P1 reserved:** withdraws only consent bound to this subject/session/tenant and appends evidence without exposing other contact data. |

Message input V1 is deliberately small:

```json
{
  "$id": "WidgetMessageCreate.v1",
  "type": "object",
  "additionalProperties": false,
  "required": ["client_message_id", "kind", "text"],
  "properties": {
    "client_message_id": { "type": "string", "minLength": 8, "maxLength": 128 },
    "kind": { "const": "text" },
    "text": { "type": "string", "minLength": 1, "maxLength": 4000 },
    "locale_hint": { "enum": ["uz", "ru", "en", null] }
  }
}
```

The unique tuple `(organization_id, channel_connection_id,
client_message_id)` protects against browser retries in addition to the HTTP
idempotency record. The service sanitizes output at render time; neither inbound
text nor AI output is trusted HTML.

### Customer confirmation grants

A successful prepare-confirmation worker creates a short-lived, random,
single-use confirmation grant bound to the appointment request, conversation,
customer channel identity, intended action set, and current appointment version,
then makes its channel delivery intent durable in the same transaction.
The grant is stored hashed. Telegram/other provider callback payloads contain an
opaque lookup token, not PII or an organization ID. Expired/stale grants fail
safely; replay returns the original result only for the same customer and action.
Natural-language confirmation may be interpreted by AI but still must produce a
validated application action and pass the same binding and state policy.

## Integration/webhook API

Prefix: `/v1/webhooks`
Webhook routes are not browser APIs, do not use staff sessions, and are exempt
from CSRF because each adapter performs provider authentication. They remain
rate- and size-limited.

| Method and path | V1 | Tenant routing |
|---|---:|---|
| `POST /telegram/{connection_key}` | yes | Opaque high-entropy route key narrows the candidate connection; verified secret and bot/account identity must match it. |
| `POST /instagram/{connection_key}` | later | Same core ingress port; Meta-specific signature/account verification. |
| `POST /whatsapp/{connection_key}` | later | Same core ingress port; Meta-specific signature/account verification. |

Processing order is fixed:

1. Enforce TLS, method, media type, byte limit, and coarse edge rate limit.
2. Capture raw bytes; look up only the candidate connection needed to verify.
3. Verify provider secret/signature with constant-time comparison, timestamp
   window where supported, and expected provider account identity.
4. Parse the payload using the adapter's versioned runtime schema.
5. Derive the active `channel_connection` and organization server-side.
6. In one transaction, insert `webhook_receipt` under a provider-scoped unique
   event key and enqueue a canonical inbound event. A uniqueness conflict is a
   successful duplicate, not a second domain action.
7. Acknowledge promptly. New durable receipts normally return `202`; known
   duplicates return `200`. Authentication/schema failures use safe `4xx` codes
   subject to provider retry requirements.
8. A worker normalizes and processes events. Individual bad events in a batch
   are isolated and observable; successful siblings are not repeated.

Do not trust delivery order. Provider event IDs, external message IDs, and
callback/query IDs participate in separate uniqueness constraints because a
provider update may contain several events or retry them in different envelopes.
Webhook bodies are retained only as encrypted, access-controlled forensic data
when required; the normalized minimum is preferred.

## Provider-neutral channel contract

Core conversation code depends on ports in `packages/contracts` and domain
commands, never Telegram/widget SDK types.

### Canonical inbound message

```json
{
  "$id": "CanonicalInboundEvent.v1",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "event_id", "channel", "channel_connection_id", "external_conversation_id",
    "external_sender_id", "kind", "occurred_at", "received_at", "content"
  ],
  "properties": {
    "event_id": { "type": "string", "minLength": 1, "maxLength": 255 },
    "channel": { "enum": ["widget", "telegram", "instagram", "whatsapp"] },
    "channel_connection_id": { "type": "string", "format": "uuid" },
    "external_account_id": { "type": ["string", "null"], "maxLength": 255 },
    "external_conversation_id": { "type": "string", "maxLength": 255 },
    "external_message_id": { "type": ["string", "null"], "maxLength": 255 },
    "external_sender_id": { "type": "string", "maxLength": 255 },
    "kind": { "enum": ["text", "quick_reply", "attachment", "delivery_status", "unsupported"] },
    "occurred_at": { "type": ["string", "null"], "format": "date-time" },
    "received_at": { "type": "string", "format": "date-time" },
    "content": {
      "oneOf": [
        {
          "type": "object",
          "additionalProperties": false,
          "required": ["type", "text"],
          "properties": {
            "type": { "const": "text" },
            "text": { "type": "string", "maxLength": 4000 },
            "locale_hint": { "enum": ["uz", "ru", "en", null] }
          }
        },
        {
          "type": "object",
          "additionalProperties": false,
          "required": ["type", "action_token"],
          "properties": {
            "type": { "const": "quick_reply" },
            "action_token": { "type": "string", "maxLength": 512 },
            "display_text": { "type": ["string", "null"], "maxLength": 500 }
          }
        },
        {
          "type": "object",
          "additionalProperties": false,
          "required": ["type", "media_kind", "provider_media_ref"],
          "properties": {
            "type": { "const": "attachment" },
            "media_kind": { "enum": ["image", "document", "audio", "other"] },
            "provider_media_ref": { "type": "string", "maxLength": 1000 },
            "caption": { "type": ["string", "null"], "maxLength": 1000 }
          }
        },
        {
          "type": "object",
          "additionalProperties": false,
          "required": ["type"],
          "properties": {
            "type": { "enum": ["delivery_status", "unsupported"] },
            "provider_status": { "type": ["string", "null"], "maxLength": 100 }
          }
        }
      ]
    }
  }
}
```

`organization_id` is intentionally absent at the untrusted adapter boundary.
The ingress application adds it only after resolving the verified
`channel_connection_id`. Provider metadata is reduced to an allowlist and never
passed wholesale into prompts. The provider-neutral contract can classify an
attachment so adapters remain extensible, but V1 treats arbitrary attachments
as unsupported/quarantined metadata, does not download them, and never sends
them to the model.

### Canonical outbound command

```json
{
  "$id": "SendChannelMessage.v1",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "organization_id", "conversation_id", "channel_connection_id",
    "recipient", "content", "idempotency_key"
  ],
  "properties": {
    "organization_id": { "type": "string", "format": "uuid" },
    "conversation_id": { "type": "string", "format": "uuid" },
    "channel_connection_id": { "type": "string", "format": "uuid" },
    "recipient": { "type": "string", "maxLength": 255 },
    "content": {
      "type": "object",
      "additionalProperties": false,
      "required": ["text", "locale"],
      "properties": {
        "text": { "type": "string", "minLength": 1, "maxLength": 4000 },
        "locale": { "enum": ["uz", "ru", "en"] },
        "quick_replies": {
          "type": "array",
          "maxItems": 5,
          "items": {
            "type": "object",
            "additionalProperties": false,
            "required": ["label", "action_token"],
            "properties": {
              "label": { "type": "string", "maxLength": 80 },
              "action_token": { "type": "string", "maxLength": 512 }
            }
          }
        }
      }
    },
    "reply_to_message_id": { "type": ["string", "null"], "format": "uuid" },
    "idempotency_key": { "type": "string", "minLength": 8, "maxLength": 128 }
  }
}
```

The canonical `ChannelAdapter` is the provider adapter bundle composed of the
following interface-segregated ingress and egress ports:

```text
ChannelWebhookAdapter
  verify(raw_request, candidate_connection) -> VerifiedDelivery | rejection
  normalize(verified_delivery) -> CanonicalInboundEvent[]

ChannelSender
  capabilities(connection) -> ChannelCapabilities
  send(command: SendChannelMessage) -> DeliveryAccepted | typed failure
```

`ChannelCapabilities` describes limits such as maximum text length, quick-reply
support, formatting subset, attachment types, edit support, and delivery-status
support. The application chooses only portable domain behavior; the adapter
renders/splits content and returns stable typed failures:
`invalid_recipient`, `authentication_failed`, `rate_limited`,
`provider_unavailable`, `unsupported_content`, or `permanent_rejection`.
Transient failures are retried by the worker with bounded backoff; permanent
failures trigger staff-visible delivery status and, where appropriate, handoff.

### Adapter extension rule

Adding Instagram or WhatsApp requires a new verifier, normalizer, sender, secret
configuration, contract fixtures, and capability mapping. It must not add
provider branches to qualification, booking, lead, conversation, or AI policy
modules. Provider contract tests replay signed fixtures for valid, forged,
duplicated, reordered, multi-event, oversized, and unsupported payloads.

## Versioning and compatibility policy

- `/v1` changes may add optional response fields, new endpoints, new error
  codes, or new enum values only when clients are required to handle unknown
  values safely. Removing/renaming fields, changing meanings, or making an
  optional request field required needs `/v2`.
- Request schemas reject unknown fields to surface client drift. Response
  consumers must ignore unknown fields.
- Webhook adapter schemas are versioned independently from the public API and
  pin/recognize provider payload versions. Unknown provider versions are
  quarantined rather than guessed.
- Deprecations publish documentation and `Deprecation`/`Sunset` headers with a
  migration window. Security removal may be faster and is recorded.
- Every route has contract tests for authentication, authorization, tenant
  scoping, validation, idempotent replay, error shape, and compatibility
  snapshots. Webhook/channel ports have provider fixture tests.

## Decisions and unresolved configuration

Decisions fixed for V1:

- Versioned JSON REST over Fastify, with JSON Schema as the runtime contract.
- Cookie-authenticated staff/private surface, short-lived widget sessions, and
  separately authenticated webhook routes.
- Customer confirmation is distinct from staff acceptance.
- No API or adapter can write an external calendar in V1.
- Widget keys are public routing identifiers; domain allowlists and session
  grants reduce abuse but do not turn a browser into a trusted environment.

Deployment configuration still must set concrete session lifetimes, rate-limit
budgets, idempotency retention above the minimum, message size limits per
provider, allowed widget domains, and webhook secret rotation windows. These
values must be tested and observable rather than embedded in clients.
