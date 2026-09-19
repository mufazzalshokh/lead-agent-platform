# S19 — Product UX

Status: implementation checkpoint; formal acceptance remains gated by focused
verification, the single authoritative GitHub Actions gate, and exact-commit
promotion.

## Staff application boundary

The staff application consumes only authenticated S17/S18 private projections.
`GET /v1/staff/me` is an additive private endpoint that validates the requested
organization through the current membership authorization resolver. A client
organization selector never creates authority; non-membership and suspended or
revoked membership fail closed. The response contains only the authenticated
user identifier and the active authorized membership context needed by the UI.

`sensitive_fields_visible` is derived server-side from the current role. When
false, sensitive plaintext must already be absent from staff API projections;
CSS hiding is not an authorization mechanism. The staff browser never receives
hidden reasoning, provider envelopes, ciphertext, secrets, audit/Outbox
internals, policy implementation details, or another tenant/context's data.
Authorized customer-authored messages may be displayed, including
health-adjacent text, but S19 does not diagnose, triage, or clinically interpret
that content. The S21b medical/emergency production-readiness gate remains.

Shared work actionability continues to come from domain state. S17's deferral of
independent per-staff read receipts remains: shared `read_at` is not presented as
an actor-specific receipt. Appointment staff acceptance is shown as waiting for
customer confirmation, never as a confirmed booking.

Bulk exports, CSV exports, support impersonation, unrestricted platform support
access, and a support data browser remain deferred.

## Widget iframe isolation

The host integrates a small loader. The loader creates a cross-origin platform
iframe with `sandbox="allow-scripts allow-same-origin"`; it grants no top
navigation, downloads, popups, host DOM access, or device permissions. The
platform frame is required to be deployed on the frozen Widget platform HTTPS
origin. The Widget does not depend on third-party cookies.

An allowed host may request a short-lived opaque exchange grant. The API derives
tenant and channel solely from the existing Widget key route resolver and
validates the actual browser `Origin` against the existing active
`widget_allowed_origins` record. `page_url`, query parameters, `postMessage`
payloads, and host-provided tenant identifiers are never authority.

The encrypted grant:

- contains 256-bit random JTI material;
- expires after at most 60 seconds;
- is bound to tenant, Widget channel, session, and validated embedding Origin;
- is atomically single-use through the existing Widget-session JTI hash;
- can be redeemed only from the configured platform Widget Origin.

The loader submits the grant directly to the named sandboxed iframe with a
cross-origin form POST. It is not placed in a query string, URL fragment,
browser history entry, or referrer.

Redemption rotates the persisted exchange JTI hash into a normal signed S10
Widget bearer. The host page never receives that bearer, Contact, Lead,
Conversation, or private message data. The iframe keeps the bearer only in
process memory. Existing 30-minute idle and two-hour absolute limits, tenant and
conversation binding, rate limits, idempotency, terminal-state behavior, and
customer/staff projection boundaries remain unchanged. Opening the iframe
creates only a WidgetSession; the first meaningful message remains the business
object creation boundary.

The frame response uses a per-response nonce and restrictive CSP with an exact
trusted `frame-ancestors` Origin, exact API `connect-src`, `default-src 'none'`,
and no wildcard. Host/frame messages use `lead-agent.widget.v1`, a random
instance correlation value, exact target Origin, source-window validation,
origin validation, finite message types, and bounded payloads. Unknown or
malformed messages are ignored. `targetOrigin="*"` is prohibited.

## Product behavior

The staff workspace provides active work, stable pagination, authorized
conversation/customer/lead context, Handoff actions, appointment accept/reject,
stale-action recovery, and explicit loading/empty/error states. Raw identifiers
and backend/provider terminology are not presented to staff.

The customer Widget provides a discoverable launcher, responsive conversation
frame, text-only 1–4000 character composer, Enter/Shift+Enter behavior,
optimistic pending/accepted/failed states, idempotent retry, message polling,
Unicode-safe text rendering, human session recovery, and a customer-perceived
response timing hook. It never labels a submitted or staff-accepted request as
confirmed. No file/media input, theming system, medical guidance, or S20
analytics infrastructure is introduced.

## Compatibility and persistence

The original direct S10 Widget session endpoint remains backward compatible.
The embed endpoints and private `/me` endpoint are additive. Existing frozen V1
contracts and migration history remain intact. The additive catalog contains 357
schemas (347 prior entries plus 10 S19 entries). S19 adds no migration; the head
remains `0028` and the production table count remains 51.
