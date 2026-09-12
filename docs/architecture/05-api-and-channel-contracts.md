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
| Staff/private | Human user | Auth0 OIDC Authorization Code + PKCE establishes an opaque, revocable application session in a Secure, HttpOnly, SameSite=Lax cookie; production MFA is required for every tenant role | Active organization selector is verified against server-side active membership on every request; Auth0 Organization claims have no authority. |
| Anonymous widget | Widget session | Short-lived, audience-scoped widget bearer token issued by the session bootstrap | Publishable widget key resolves configuration; token binds immutable `organization_id`, `channel_connection_id`, origin, and conversation/session. |
| Telegram webhook | Provider delivery | Adapter verifies provider secret/signature against raw bytes before parsing | Opaque route connection key plus verified provider account resolves one active channel connection. |
| Future Instagram/WhatsApp webhook | Provider delivery | Adapter-specific signature, timestamp, and replay verification | Verified provider account/connection mapping; never a payload `organization_id`. |
| Background worker | Workload identity | Separate least-privilege database/application credential | Tenant carried in a trusted job created from an already resolved transaction and re-established for each job. |
| Platform operations | Platform operator | Separate admin audience, mandatory MFA, and fresh step-up for sensitive actions | No implicit tenant scope; an explicit, two-operator-approved, audited support grant is required. |

The closed V1 permission vocabulary is `organization.read`,
`organization.update`, `memberships.read`, `memberships.invite`,
`memberships.manage`, `ownership.transfer`, `configuration.read`,
`configuration.write`, `configuration.publish`, `integrations.read`,
`integrations.manage`, `contacts.read`, `contacts.read_sensitive`, `leads.read`,
`leads.manage`, `conversations.read`, `conversations.manage`,
`appointments.read`, `appointments.manage`, `attendance.manage`,
`revenue_attribution.manage`, `handoffs.read`, `handoffs.manage`,
`notifications.read`, `analytics.read`, `audit.read`, `privacy.read`, and
`privacy.manage`. Unknown permissions deny.

Owners receive every permission. Admins receive every permission except
`ownership.transfer` and cannot create/promote, demote, suspend, or revoke an
owner. Staff receive the operational read/manage permissions enumerated in
`07-tenancy-security-privacy.md`, including sensitive contact access, but no
membership/configuration/integration/analytics/audit/privacy administration.
Analysts receive only `organization.read`, `configuration.read`, and
`analytics.read`.

Owners/admins are always all-location. Staff/analysts may be all-location or
restricted to an explicit location allowlist. Role permission and location
scope must both pass; an empty restricted set grants no location access and a
restricted actor is denied when the resource has no deterministic allowed
location.

Role checks are permissions in application policy, not UI visibility checks.
Membership must be active. High-risk actions require fresh MFA step-up within
15 minutes and produce an `audit_event`. Customer/widget actors are not
organization members.

For cookie-authenticated mutations, the API validates an anti-CSRF token bound
to the session and checks `Origin`/Fetch Metadata where available; cookies use
`Secure`, `HttpOnly`, and `SameSite=Lax` by default. Staff CORS is deny-by-default
with environment-specific origins, is independent from widget allowed origins,
and does not grant authorization.

The application session idles out after 60 minutes and ends absolutely after
12 hours, with no remember-me. Its token rotates every four hours and after
authentication, MFA/step-up, organization switch, role/location/privilege
change, or recovery. A User may have at most five active sessions; revoked or
expired metadata is retained for 30 days. Current Membership authority is
reloaded for authorization-sensitive work rather than trusted from a session
snapshot.

Auth endpoints are separate from tenant resource routes: login initiation and
callback complete Auth0 Authorization Code + PKCE with state/nonce; session
inspection returns no token; logout revokes the current local session;
sign-out-all revokes every local session; organization selection validates an
active Membership and rotates the session token; invitation acceptance receives
the opaque token in a non-logged request body after OIDC authentication. Auth0
logout alone never substitutes for local revocation.

S6 reuses the canonical problem vocabulary: missing authentication maps to
`authentication_required`; malformed, expired, revoked, mismatched, or replayed
authentication/invitation proof maps to `token_invalid`; a valid principal that
lacks active Membership, named permission, MFA freshness, or location/resource
scope maps to `permission_denied`, except inaccessible tenant resources use the
non-enumerating `resource_not_found`; CSRF and staff-origin failures remain
`csrf_invalid` and `origin_not_allowed`. Provider-specific errors are never
exposed as a competing public vocabulary.

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
| `GET /organization` | `organization.read` | Current organization profile and privacy/configuration versions. |
| `PATCH /organization` | `organization.update` | Owner/admin; `If-Match`; JSON Merge Patch allowlist. |
| `GET /memberships` | `memberships.read` | Tenant membership list; no external-identity or session data. |
| `POST /membership-invitations` | `memberships.invite` | Owner/admin target-role rules; seven-day hash-only invitation; idempotent request and audited grant. |
| `POST /membership-invitations/{id}/resend` | `memberships.invite` | Revokes the active token before issuing a replacement; never returns or logs stored token material. |
| `DELETE /membership-invitations/{id}` | `memberships.invite` | Explicit revocation; idempotent and audited. |
| `PATCH, DELETE /memberships/{id}` | `memberships.manage`; `ownership.transfer` for owner operations | Delete means audited revocation, not hard deletion; cannot suspend, revoke, or demote the final active owner; `If-Match`. |
| `GET, POST /locations` | `configuration.read` / `configuration.write` | Lists authorized Location roots or creates a stable inactive root. POST does not persist a Location-version draft and does not publish business facts. |
| `GET, PATCH /locations/{id}` | `configuration.read` / `configuration.write` | Reads the authorized root/current-version summary or changes only allowlisted stable-root metadata with `If-Match`; it cannot silently replace published presentation/hours or deactivate the Location. |
| `POST /locations/{id}/publish` | `configuration.publish` | `If-Match` and `Idempotency-Key`; validates a complete Location candidate, bounded locale maps, IANA zone and weekly hours, then immediately inserts one immutable version plus hours, activates the root and atomically advances `current_version_id` when the transaction commits. There is no persisted Location-version draft or scheduled publication. |
| `POST /locations/{id}/deactivate` | `configuration.publish` | `If-Match` and `Idempotency-Key`; deactivates without deleting current or historical versions and emits the applicable authoritative change atomically. |
| `GET /locations/{id}/business-hours` | `configuration.read` | Returns hours belonging to the exact current published Location version. Changes are submitted only as part of `/locations/{id}/publish`; hours are not independently published. |
| `GET, POST /locations/{id}/closures` | `configuration.read` / `configuration.publish` | Lists applicable history or immediately publishes one same-tenant local-date `closed|override` record. POST requires Location `If-Match` and `Idempotency-Key`; a future closure date is authoritative knowledge published now, not scheduled publication. |
| `POST /locations/{id}/closures/{closure_id}/supersede` | `configuration.publish` | Location `If-Match` and `Idempotency-Key`; atomically supersedes with a validated replacement while retaining history. |
| `POST /locations/{id}/closures/{closure_id}/cancel` | `configuration.publish` | Location `If-Match` and `Idempotency-Key`; idempotently cancels without destructive deletion. |
| `GET, POST /services` | `configuration.read` / `configuration.write` | Lists authorized Service roots or creates a stable inactive root. POST does not persist a Service-version draft and publishes no service facts or price. |
| `GET, PATCH /services/{id}` | `configuration.read` / `configuration.write` | Reads the root/current-version summary or changes only allowlisted stable-root metadata with `If-Match`; published facts and status use explicit commands. |
| `POST /services/{id}/publish` | `configuration.publish` | `If-Match` and `Idempotency-Key`; validates a complete localized candidate, immediately creates one immutable Service version, activates the root, and advances `current_version_id` atomically. There is no persisted Service-version draft or scheduled publication. |
| `POST /services/{id}/deactivate` | `configuration.publish` | `If-Match` and `Idempotency-Key`; deactivates without deleting referenced versions and emits `service.deactivated` atomically. |
| `GET, PUT /services/{id}/locations` | `configuration.read` / `configuration.publish` | Service `If-Match` for PUT; immediately opens/closes same-tenant active Service/Location intervals at commit. It never claims slot availability and accepts no future activation time. |
| `GET, POST /services/{id}/prices` | `configuration.read` / `configuration.write` | Lists authorized versions or creates a `draft` using an exact price type, integer minor units, uppercase currency, optional same-tenant Location and bounded localized display text. POST does not publish. |
| `GET, PATCH /services/{id}/prices/{price_id}` | `configuration.read` / `configuration.write` | Returns one exact version or updates only a draft with `If-Match`; published/retired versions are immutable. |
| `POST /services/{id}/prices/{price_id}/publish` | `configuration.publish` | `If-Match` and `Idempotency-Key`; immediately publishes at commit after amount, scope, locale and non-overlap validation, atomically retiring/closing any replaced applicable version. Future activation is rejected. |
| `POST /services/{id}/prices/{price_id}/retire` | `configuration.publish` | `If-Match` and `Idempotency-Key`; immediately and idempotently retires without deleting price history. |
| `GET, POST /faqs` | `configuration.read` / `configuration.write` | Lists authorized exact versions or creates a `draft` with stable `faq_key`, optional same-tenant Service/Location scope, and atomic bounded `question_i18n`/`answer_i18n` maps whose only locale keys are `uz`, `ru`, and `en`; content remains untrusted data. |
| `GET, PATCH /faqs/{id}` | `configuration.read` / `configuration.write` | Returns one exact version or updates only a draft with `If-Match`; it never substitutes a different version or mutates published content. |
| `POST /faqs/{id}/publish` | `configuration.publish` | `If-Match` and `Idempotency-Key`; immediately publishes a draft, validates both bounded locale maps and the organization default locale, and atomically retires any current version for the same key/scope. No future activation is accepted. |
| `POST /faqs/{id}/retire` | `configuration.publish` | `If-Match` and `Idempotency-Key`; immediately and idempotently retires a published version while retaining referenced history. |
| `GET, POST /business-policies` | `configuration.read` / `configuration.write` | Lists authorized exact versions or creates a finite schema-versioned `draft`; qualification, booking, handoff, safety and consent are the only policy types. POST does not publish. |
| `GET, PATCH /business-policies/{id}` | `configuration.read` / `configuration.write` | Returns one exact version or updates only a draft with `If-Match`; no executable rule language or arbitrary evaluator is accepted. |
| `POST /business-policies/{id}/publish` | `configuration.publish` | `If-Match` and `Idempotency-Key`; immediately publishes a validated draft and atomically retires the current version for the same key/type. No future activation is accepted. |
| `POST /business-policies/{id}/retire` | `configuration.publish` | `If-Match` and `Idempotency-Key`; immediately and idempotently retires while preserving referenced policy history. |
| `GET, POST /channel-connections` | `integrations.read` / `integrations.manage` | Metadata returned; credentials accepted only through secret-specific write fields and never echoed. |
| `PATCH /channel-connections/{id}` | `integrations.manage` | Versioned allowlisted metadata/status change; secret values are never returned. |
| `POST /channel-connections/{id}/rotate-credential` | `integrations.manage` | Step-up, idempotency and audit required; encrypted replacement with bounded overlap/revocation. |
| `POST /channel-connections/{id}/disable` | `integrations.manage` | Step-up, `If-Match`, idempotency and audit; disables ingress/egress without deleting history. |
| `GET, PUT /channel-connections/{id}/widget-origins` | `integrations.read` / `integrations.manage` | Widget connections only; canonical exact/wildcard origins, versioned with `If-Match` and audited. |
| `GET /contacts/{id}` | `contacts.read`; `contacts.read_sensitive` for unmasked fields | Minimum masked/full fields according to role/location and purpose; no cross-tenant existence disclosure. |
| `PATCH /contacts/{id}` | `contacts.read_sensitive` + `leads.manage` | Validated correction/merge-independent fields; `If-Match`, audit, and consent/purpose policy. |
| `GET /leads` | `leads.read` | Cursor list; filters by documented status, location, assignee, timestamps. |
| `GET, PATCH /leads/{id}` | `leads.read` / `leads.manage` | Assignment/labels via allowlist; lifecycle transitions use domain commands. |
| `POST /leads/{id}/disqualify` | `leads.manage` | Reasoned, versioned/idempotent domain transition; cannot be inferred solely by AI. |
| `POST /leads/{id}/close` | `leads.manage` | Reasoned, versioned/idempotent close command. |
| `POST /leads/{id}/reopen` | `leads.manage` | Only from a permitted state under business policy; versioned/idempotent. |
| `GET /conversations` | `conversations.read` | Cursor list; filters by status/channel/assignment. |
| `GET /conversations/{id}` | `conversations.read` | Metadata and participant summary. |
| `GET /conversations/{id}/messages` | `conversations.read` | Cursor list with redacted/authorized message representations. |
| `GET /conversations/{id}/ai-runs` | `conversations.read` | Redacted run/action-evaluation/source/policy summaries; no raw prompts, hidden reasoning, secrets, or unrestricted provider bodies. |
| `GET /ai-runs/{id}` | `conversations.read` | Tenant/location-authorized diagnostic representation with model/profile/schema/prompt versions, usage, outcome and safe failure codes. |
| `POST /conversations/{id}/messages` | `conversations.manage` | Staff reply; requires `Idempotency-Key`; persists message + outbox atomically. |
| `POST /conversations/{id}/resolve` | `conversations.manage` | `If-Match`, `Idempotency-Key`; state machine validates. |
| `POST /conversations/{id}/reopen` | `conversations.manage` | `If-Match`, `Idempotency-Key`; policy-controlled. |
| `GET /appointment-requests` | `appointments.read` | Cursor list; status/location/date filters. |
| `GET /appointment-requests/{id}` | `appointments.read` | Includes transition history visible to staff. |
| `POST /appointment-requests/{id}/accept` | `appointments.manage` | Staff supplies proposed appointment instant/location/optional staff note; `If-Match` and `Idempotency-Key`. Commits `staff_accepted` plus a prepare-confirmation outbox event and returns `202` with that durable state. |
| `POST /appointment-requests/{id}/reject` | `appointments.manage` | Reason code plus optional customer-safe message; `If-Match` and idempotency. |
| `POST /appointment-requests/{id}/cancel` | `appointments.manage` | Policy-authorized cancellation; idempotent command. |
| `POST /appointment-requests/{id}/attest-customer-confirmation` | `appointments.manage` | For an offline/unreachable customer only: requires MFA step-up within 15 minutes, an `attestation_method` of `phone` or `in_person`, actual confirmation time, `If-Match`, idempotency, and an audit event with source `staff_attested_external`. |
| `GET /appointment-requests/{id}/attendance` | `appointments.read` | Current attendance fact plus immutable correction history. |
| `POST /appointment-requests/{id}/attendance` | `attendance.manage` | Record an initial `attended`, `did_not_attend`, or `unknown` fact for a confirmed request after its offered start; `If-Match`, idempotency, actor/source/audit required. |
| `POST /appointment-requests/{id}/attendance/{attendance_id}/correct` | `attendance.manage` | Append a superseding attendance fact and reason; never overwrite history; `If-Match` current fact and idempotency required. |
| `GET /appointment-requests/{id}/revenue-attributions` | `appointments.read` | Cursor list of immutable charge/adjustment/reversal facts; currencies are never silently summed. |
| `POST /appointment-requests/{id}/revenue-attributions` | `revenue_attribution.manage` | Add a staff-manual `charge` or `adjustment` for a confirmed request using positive integer minor units, ISO currency, category, recognized time, actor/source/audit; idempotency required. |
| `POST /appointment-requests/{id}/revenue-attributions/{attribution_id}/reverse` | `revenue_attribution.manage` | Append one same-currency reversal linked to an unreversed attribution; reason and idempotency required; original row remains immutable. |
| `GET /handoffs` | `handoffs.read` | Cursor list; state/assignee filters. |
| `POST /handoffs/{id}/assign` | `handoffs.manage` | Assignee membership is checked in this organization; `If-Match` and idempotency are required. Reassignment is a versioned `assigned -> assigned` transition whose history records old and new assignees while its event carries the new assignee only. |
| `POST /handoffs/{id}/start` | `handoffs.manage` | Transition to `in_progress`. |
| `POST /handoffs/{id}/resolve` | `handoffs.manage` | Resolution code plus explicit conversation disposition `resume_ai\|resolve_conversation\|successor_handoff`; versioned/idempotent. |
| `POST /handoffs/{id}/cancel` | `handoffs.manage` | Authorized actor, reason, explicit conversation disposition, `If-Match`, and idempotency; terminal transition only when policy permits. |
| `GET /notifications` | `notifications.read` | Durable in-app staff inbox; cursor list filtered by assignment/type/read state and membership location scope. This is the P0 notification authority. |
| `POST /notifications/{id}/mark-read` | `notifications.read` | Idempotent actor-specific read acknowledgement; it never changes the referenced domain state. |
| `GET /audit-events` | `audit.read` | Owner/admin; append-only event metadata, no unrestricted payload dumps. |
| `GET /analytics/funnel` | `analytics.read` | Aggregate results; explicit time range, location and time-zone semantics. |
| `POST /contacts/{id}/consents/{purpose}/withdraw` | `privacy.manage` | **P1 reserved:** append withdrawal evidence; idempotent and audited; never rewrite the original grant. |
| `POST /privacy/exports` | `privacy.manage` | **P1 reserved:** owner/admin-authorized asynchronous tenant export; idempotent, step-up protected, and audited. |
| `POST /privacy/deletion-requests` | `privacy.manage` | **P1 reserved:** validated, step-up-protected deletion workflow, not immediate ad hoc SQL deletion. |

`configuration.write` creates or changes draft/configuration state.
`configuration.publish` is additionally required for any request that makes a
service fact, price, FAQ, business policy, hours, or other authoritative content
active/effective; a write route cannot silently publish using only
`configuration.write`.

S7 publication is immediate-only: the new authoritative state becomes visible
when the explicit publication transaction commits. Configuration commands do
not accept `publish_at`, future activation/retirement timestamps, or scheduled
publication. A Location/Service Publish request carries a complete candidate
because the accepted schema has no persisted draft version for those roots;
Price, FAQ and Business Policy retain `draft -> published -> retired`. Successful
publication commits its version/effective change, required audit record and
applicable canonical outbox event together. Failed or stale publication exposes
none of the candidate change and maps to the canonical validation, business-rule
or `version_conflict` problem.

Location publication/status/closure commands compare and advance the Location
root integer version; Service publication/status/Location commands do the same
to the Service root. Price, FAQ and Business Policy drafts use their integer
`version_no` as the optimistic token: a successful draft edit advances it, while
publication validates that exact draft version and content. Published content is
never patched. Every stale token uses the same non-retrying
`409 version_conflict` contract.

The applicable canonical event is `location.changed` for committed Location
details/time-zone/hours/closure/status authority, `service.published` for a new
Service version, `service.deactivated` for deactivation,
`service_price.published`, `faq.published`, or `business_policy.published` for
their corresponding publication. Draft-only edits emit no authoritative event.
S7 does not invent retirement or Service/Location event types: a direct change
without an exact canonical event remains transactionally audited, and any later
asynchronous consumer that requires a new semantic event must pass explicit
contract review first.

The S7 `BusinessPolicy` contract for `policy_type=qualification` is finite and
runtime validated. Schema version 1 has the conceptual flags
`require_service_interest=true`, `require_supported_service_location=true`,
`require_positive_next_step_intent=true`, `require_contactability=true`,
`require_preferred_time=false`, `require_budget=false`, and
`require_medical_eligibility=false`. Its only disqualification reason codes are
`service_not_offered`, `location_not_served`, `not_interested`,
`outside_business_scope`, and `spam_or_abuse`. It accepts no executable
expression/evaluator or arbitrary reason-code string. The future TypeBox schema
and persisted `rules_jsonb` representation must preserve those exact semantics.

Business-knowledge list endpoints use the shared opaque keyset cursor (default
50, maximum 100), a documented stable sort with a unique tiebreaker, and finite
filters only. `configuration.read` exposes business knowledge, never integration
credentials, Auth0 configuration, webhook/API secrets, database configuration,
or encrypted material. Restricted Staff/Analyst reads require a deterministic
authorized Location scope; organization-wide or otherwise location-ambiguous
knowledge is denied unless an authorized location-filtered projection proves
applicability. Owner/Admin retain all-location access.

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
| `POST /appointment-requests/{id}/confirm` | conversation-bound token + one-time confirmation grant | Deterministically confirms only from `awaiting_customer_confirmation` when expected aggregate version and current `offer_version` both match and explicit `now` is in the grant's half-open validity interval; idempotent. |
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
customer channel identity, intended action set, current appointment aggregate
version, current `offer_version`, `issued_at`, and `expires_at`, then makes its
channel delivery intent durable in the same transaction.
The grant is stored hashed. Telegram/other provider callback payloads contain an
opaque lookup token, not PII or an organization ID. Expired/stale grants fail
safely. A confirmation is valid only when both versions still match and the
application-supplied clock instant satisfies `issued_at <= now < expires_at`;
`now == expires_at` is expired. Replay returns the original result only for the
same customer and action.
Natural-language confirmation may be interpreted by AI but still must produce a
validated application action and pass the same binding and state policy.

Every handoff terminal command or expiry job supplies one explicit conversation
disposition: `resume_ai`, `resolve_conversation`, or `successor_handoff`. No
endpoint or job derives a default. Requested handoffs produce
`awaiting_staff + paused`, assigned/in-progress handoffs produce
`awaiting_staff + staff`, and those two mode-only ownership changes use
`conversation.automation_mode_changed`. A staff-owned response produces
`awaiting_lead + staff` while the same assigned/in-progress Handoff remains
active; the customer's next reply returns to `awaiting_staff + staff`. AI-owned
responses instead use `awaiting_lead + ai`, whose customer reply returns to
`open + ai`. Explicit resume produces `open + ai`; resolved or closed
conversations use `paused`; cancellation/expiry never resumes AI implicitly.
When a terminal command replaces a requested Handoff with another requested
Handoff while the Conversation remains `awaiting_staff + paused`, it emits
`conversation.active_handoff_changed` with the distinct previous and successor
Handoff IDs. That reference change is never silent and does not misuse either
status- or automation-mode provenance.

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
- Auth0 Authorization Code + PKCE followed by an application-owned staff session
  with 60-minute idle/12-hour absolute expiry, four-hour rotation, five-session
  cap, mandatory production MFA, and 15-minute sensitive-action step-up;
  short-lived widget sessions and separately authenticated webhook routes.
- Customer confirmation is distinct from staff acceptance.
- No API or adapter can write an external calendar in V1.
- Widget keys are public routing identifiers; domain allowlists and session
  grants reduce abuse but do not turn a browser into a trusted environment.

Deployment configuration still must set rate-limit budgets, idempotency
retention above the minimum, message size limits per provider, allowed widget
domains, environment-specific staff origins, and webhook secret rotation
windows. These values must be tested and observable rather than embedded in
clients; configuration cannot override the frozen V1 staff session maxima.
