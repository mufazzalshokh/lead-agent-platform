# S8 platform-operator async recovery

This is an internal, platform-operator-only maintenance boundary. It is not a
tenant permission or an HTTP endpoint. Use the dedicated
`lead_agent_async_operator` database credential through the typed S8 operator
maintenance service; never use the tenant or worker queue credential.

Before a redrive or requeue, the operator must confirm the root cause is fixed,
record an external approval reference and bounded reason code, and name one
exact failed job or dead-lettered outbox event. Bulk filters, arbitrary queue
names, and replay of a known successful logical effect are intentionally not
supported.

For a workload DLQ redrive, supply the exact DLQ job ID, original workload
queue, handler version, outbox event ID, event type, schema version, and expected
DLQ state. The active handler registry, canonical published outbox provenance,
durable execution ledger, and database state are revalidated. A new physical
pg-boss job may be created, but the logical identity remains
`(handler_version, outbox_event_id)`.

For a relay dead-letter requeue, supply the exact organization, outbox event,
event type, schema version, previous safe error category, and expected
dead-letter state. The same canonical outbox ID is returned to pending relay
work; no replacement event is created.

Both actions write `platform_audit_events` in the same database statement as
the state mutation. If audit insertion fails, the mutation rolls back. Never
include customer content, canonical payloads, provider responses, database
URLs, or credentials in arguments, logs, approval references, or reason codes.
