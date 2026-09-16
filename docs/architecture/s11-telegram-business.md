# S11 — Messaging channel integrations

S11.A is Telegram Business DM integration. S11.B is Instagram Business DM
integration (mandatory Commercial V1). S11.C owns combined hostile channel and
GitHub Actions aggregate acceptance. S11 is not complete after Telegram alone.

## Approved Telegram customer experience

The obsolete standalone tenant/customer-facing `@ClinicBot` model is superseded.
Customers keep messaging the business's existing Telegram account in their normal
private DM. One platform-owned Business/Secretary bot operates behind that
account through the official Bot API Business Connection mechanism. No business
passwords, login codes, MTProto automation, or `.session` files are involved.

The platform owns the bot token, username and webhook secret. They are process
configuration secrets, never per-tenant credentials in `channel_connections`.
There is one `POST /v1/webhooks/telegram` endpoint authenticated by
`X-Telegram-Bot-Api-Secret-Token`, compared in constant time and redacted from logs.
`setWebhook` subscribes only to `message`, `business_connection`,
`business_message` and `callback_query`.

## Tenant association and migration 0026

Authorized staff with `integrations.manage` creates a pending Telegram connection
and a 15-minute, high-entropy one-time nonce. Only its SHA-256 hash is persisted as
the active Telegram route. The staff response contains an opaque `/start` link,
not tenant authority or provider credentials. A human private `/start nonce`
rotates that route to a domain-separated owner-user hash; this never creates
Contact/Lead/Conversation state. A verified `business_connection` event must match
that owner, be enabled, and grant `can_reply`. It rotates the route to the
domain-separated Business Connection hash and activates the connection.

Migration `0026_s11_telegram_inbound_route_management.sql` adds only:

- `app.create_telegram_inbound_route(uuid, uuid, bytea)` — pending Telegram only,
  exact same-route replay allowed, different active route rejected.
- `app.rotate_telegram_inbound_route(uuid, bytea, bytea)` — pending/active Telegram,
  exactly-one-row expected-hash CAS; stale or colliding rotations fail closed.
- `app.disable_telegram_inbound_route(uuid)` — disables tenant Telegram routes
  without deleting history; safe idempotent repeat.

These are fixed-search-path, no-dynamic-SQL SECURITY DEFINER functions owned by
the existing dedicated NOLOGIN route definer. Each derives tenant authority only
from `app.current_organization_id()` and explicitly checks tenant/channel/type.
Both hashes must be exactly 32 bytes, and rotations must change the hash.
Underlying grants are limited to required route columns and minimum channel
identity/status reads. Runtime receives EXECUTE-only controlled mutation authority;
it still has no direct route-table privileges. Ingress remains lookup-only, PUBLIC
execution is denied, and FORCE RLS and `app.resolve_inbound_route` are unchanged.
Global `(route_type, route_key_hash)` uniqueness cannot be reassigned or exposed.
Historical migrations remain unchanged; production tables remain 51.

## Inbound behavior

Only private human `business_message` updates create customer business state.
The route hash resolves trusted tenant/channel authority; the active exact
Telegram connection is revalidated under TenantDbSession. Names, usernames,
phone numbers, client IDs, and arbitrary payload/header tenant fields are not
authority. Owner/self and Business bot echoes are suppressed.

Canonical customer identity is the numeric user ID; thread identity combines the
Business Connection and private chat. Message identity is scoped to that thread;
update ID is stable event identity. S9 owns durable dedupe, concurrency,
Contact/Lead/Conversation grouping, protected customer data, and atomic
audit/Outbox persistence. Phone is optional. Active conversations continue;
resolved/closed conversations remain terminal and the next distinct message
creates a new cycle. There is no reopen timer or automatic terminal mutation.

Text is plain customer data. Attachments retain bounded opaque `file_id` metadata
only, with no `getFile`, downloads, OCR, transcription, document execution or AI.
Callbacks require a valid Business Connection, same private customer participant
and 1–64 UTF-8 bytes of opaque action data. They are durably accepted before
acknowledgement; no booking action is executed. Edits/deletions and unsupported
updates are intentionally ignored in S11.A.

Accepted/duplicate/ignored updates return non-enumerating 2xx. Malformed JSON/root
returns 400, oversized bodies 413, bad secrets 401, and temporary pre-acceptance
failures 503 for provider retry. Provider payloads, raw IDs, nonce links and
token-bearing Bot API URLs must not appear in operational logs.

## Outbound and provider constraints

The canonical `message.response_queued` Outbox event routes through S8's private
`outbound_message` envelope, tenant reload and finite handler registry. Telegram
delivery loads a tenant-qualified existing outbound message, decrypts its trusted
recipient and plain-text body, and proves that recipient matches the protected
conversation thread. Non-Telegram delivery remains on its existing path.

`sendMessage` includes `business_connection_id`, the same customer `chat_id`, and
plain text of at most 4000 characters, with no `parse_mode`. No cold messages are
sent. The connection must remain active/enabled with `can_reply`, and the latest
actual provider inbound timestamp must be within the 24-hour eligibility window.
Disconnect disables the route and connection without auto-reactivation or history
deletion. Loss of reply rights may leave inbound reading active but blocks sends.

Structured provider codes map to typed authentication, permanent rejection,
rate-limited (bounded `retry_after`), unsupported-content or unavailable results.
Provider responses and timeouts are bounded; raw descriptions are not exposed.
S8 records execution attempts. Message sent/failed state records delivery results.
External delivery is at-least-once, not physically exactly-once: a provider send
followed by a crash before durable completion can be ambiguous and require
operator reconciliation. Software cannot override Telegram eligibility or rights.

Provider reference: [Telegram Bot API](https://core.telegram.org/bots/api), including
BusinessConnection, BusinessBotRights, Message, CallbackQuery and sendMessage.
Focused local PostgreSQL evidence may be deferred when no safe runtime is
available; S11.C must execute the complete PostgreSQL and aggregate gate remotely.
