import { StaffOperationError, type StaffPreparedOperation } from "@lead-agent/application";
import {
  DomainEventSchema,
  DomainEventSchemas,
  isSchemaValue,
  type ResourceId,
} from "@lead-agent/contracts";
import type { TenantDbSession } from "../runtime/tenant.js";
import { executeTenantRead, executeTenantWrite, mapResourceId, mapUtcTimestamp } from "./shared.js";
import { staffActor } from "./staff-domain.js";

export const appendStaffAudit = async (
  session: TenantDbSession,
  input: StaffPreparedOperation,
  nextId: () => string,
  metadata: Readonly<Record<string, unknown>> = {},
): Promise<void> => {
  await executeTenantWrite(
    session,
    `insert into audit_events
    (organization_id,id,event_type,actor_type,actor_id,actor_membership_id,target_type,target_id,action,result,request_id,correlation_id,metadata_redacted_jsonb,occurred_at)
    values ($1,$2,$3,'member',$4,$4,$5,$6,$3,'succeeded',$7,$8,$9::jsonb,$10)`,
    [
      nextId(),
      `staff.${input.operation.action}`,
      input.authorization.membershipId,
      input.kind,
      input.id,
      input.requestId,
      input.correlationId,
      JSON.stringify(metadata),
      input.occurredAt,
    ],
  );
};
/** Immutable business outcome facts do not confirm bookings or modify calendar state. */
export const persistStaffOutcome = async (
  session: TenantDbSession,
  input: StaffPreparedOperation,
  nextId: () => string,
): Promise<ResourceId> => {
  const rows = await executeTenantRead(
      session,
      `select status,version,start_at from appointment_requests where organization_id=$1 and id=$2 for update`,
      [input.id],
    ),
    request = rows[0];
  if (request === undefined) throw new StaffOperationError("resource_not_found");
  if (Number(request["version"]) !== input.expectedVersion)
    throw new StaffOperationError("version_conflict");
  if (request["status"] !== "confirmed") throw new StaffOperationError("business_rule_failed");
  const id = mapResourceId(nextId());
  let eventType:
      | "appointment.attendance_recorded"
      | "appointment.attendance_corrected"
      | "appointment.revenue_attributed"
      | "appointment.revenue_reversed",
    payload: Readonly<Record<string, unknown>>;
  if (input.operation.action === "attendance") {
    const fact = input.operation.input;
    if (
      request["start_at"] === null ||
      Date.parse(mapUtcTimestamp(request["start_at"])) > Date.parse(input.occurredAt) ||
      (fact.occurred_at !== undefined &&
        (Date.parse(fact.occurred_at) > Date.parse(input.occurredAt) ||
          Date.parse(fact.occurred_at) < Date.parse(mapUtcTimestamp(request["start_at"]))))
    )
      throw new StaffOperationError("business_rule_failed");
    const prior = await executeTenantRead(
      session,
      `select id from appointment_request_attendance where organization_id=$1 and appointment_request_id=$2 and is_current for update`,
      [input.id],
    );
    if (fact.supersedes_attendance_id === undefined) {
      if (prior.length !== 0) throw new StaffOperationError("version_conflict");
    } else {
      if (fact.reason_code === undefined) throw new StaffOperationError("validation_failed");
      if (prior[0]?.["id"] !== fact.supersedes_attendance_id || prior.length !== 1)
        throw new StaffOperationError("version_conflict");
      await executeTenantWrite(
        session,
        `update appointment_request_attendance set is_current=false where organization_id=$1 and id=$2 and appointment_request_id=$3 and is_current`,
        [fact.supersedes_attendance_id, input.id],
      );
    }
    await executeTenantWrite(
      session,
      `insert into appointment_request_attendance (organization_id,id,appointment_request_id,outcome,occurred_at,recorded_by_membership_id,recorded_at,source,is_current,supersedes_id,reason_code) values ($1,$2,$3,$4,$5,$6,$7,'staff_manual',true,$8,$9)`,
      [
        id,
        input.id,
        fact.outcome,
        fact.occurred_at ?? null,
        input.authorization.membershipId,
        input.occurredAt,
        fact.supersedes_attendance_id ?? null,
        fact.reason_code ?? null,
      ],
    );
    eventType =
      fact.supersedes_attendance_id === undefined
        ? "appointment.attendance_recorded"
        : "appointment.attendance_corrected";
    payload = {
      attendance_record_id: id,
      outcome: fact.outcome,
      source: "staff_manual",
      ...(fact.supersedes_attendance_id === undefined
        ? {}
        : {
            supersedes_attendance_record_id: fact.supersedes_attendance_id,
            reason_code: fact.reason_code,
          }),
    };
  } else if (input.operation.action === "revenue") {
    const fact = input.operation.input;
    if (fact.entry_type === "reversal") {
      const originals = await executeTenantRead<Record<string, unknown>>(
          session,
          `select amount_minor,currency,category_code,recognized_at,entry_type from appointment_revenue_attributions where organization_id=$1 and id=$2 and appointment_request_id=$3 for share`,
          [fact.reverses_attribution_id, input.id],
        ),
        original = originals[0];
      if (original === undefined) throw new StaffOperationError("resource_not_found");
      if (original["entry_type"] === "reversal")
        throw new StaffOperationError("business_rule_failed");
      const existing = await executeTenantRead(
        session,
        `select id from appointment_revenue_attributions where organization_id=$1 and reverses_attribution_id=$2 limit 1`,
        [fact.reverses_attribution_id],
      );
      if (existing.length !== 0) throw new StaffOperationError("version_conflict");
      await executeTenantWrite(
        session,
        `insert into appointment_revenue_attributions (organization_id,id,appointment_request_id,amount_minor,currency,entry_type,category_code,recognized_at,recorded_by_membership_id,recorded_at,source,reverses_attribution_id,reason_code) values ($1,$2,$3,$4,$5,'reversal',$6,$7,$8,$9,'staff_manual',$10,$11)`,
        [
          id,
          input.id,
          original["amount_minor"],
          original["currency"],
          original["category_code"],
          original["recognized_at"],
          input.authorization.membershipId,
          input.occurredAt,
          fact.reverses_attribution_id,
          fact.reason_code,
        ],
      );
      eventType = "appointment.revenue_reversed";
      payload = {
        revenue_attribution_id: id,
        reverses_revenue_attribution_id: fact.reverses_attribution_id,
        money: { amount_minor: Number(original["amount_minor"]), currency: original["currency"] },
        reason_code: fact.reason_code,
        source: "staff_manual",
      };
    } else {
      if (Date.parse(fact.recognized_at) > Date.parse(input.occurredAt))
        throw new StaffOperationError("business_rule_failed");
      await executeTenantWrite(
        session,
        `insert into appointment_revenue_attributions (organization_id,id,appointment_request_id,amount_minor,currency,entry_type,category_code,recognized_at,recorded_by_membership_id,recorded_at,source) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'staff_manual')`,
        [
          id,
          input.id,
          fact.amount_minor,
          fact.currency,
          fact.entry_type,
          fact.category_code,
          fact.recognized_at,
          input.authorization.membershipId,
          input.occurredAt,
        ],
      );
      eventType = "appointment.revenue_attributed";
      payload = {
        revenue_attribution_id: id,
        entry_type: fact.entry_type,
        category_code: fact.category_code,
        money: { amount_minor: fact.amount_minor, currency: fact.currency },
        source: "staff_manual",
      };
    }
  } else throw new StaffOperationError("validation_failed");
  await appendStaffAudit(session, input, nextId, { outcome_id: id, event_type: eventType });
  const schemaName: unknown = Reflect.get(DomainEventSchemas[eventType], "$id");
  const envelope: unknown = {
    schema_id: schemaName,
    schema_version: "1",
    event_id: nextId(),
    event_type: eventType,
    organization_id: session.organizationId,
    aggregate_type: "appointment_request",
    aggregate_id: input.id,
    aggregate_version: input.expectedVersion,
    actor: staffActor(input),
    occurred_at: input.occurredAt,
    correlation_id: input.correlationId,
    causation_id: null,
    request_id: input.requestId,
    payload,
  };
  // Canonical validation retains event identity/routing and exact-money guarantees.
  if (!isSchemaValue(DomainEventSchema, envelope))
    throw new TypeError("Invalid canonical staff outcome event");
  await executeTenantWrite(
    session,
    `insert into outbox_events (organization_id,id,event_type,schema_version,aggregate_type,aggregate_id,aggregate_version,payload_jsonb,correlation_id,causation_id,occurred_at,status,attempt_count,available_at) values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,'pending',0,$11)`,
    [
      envelope.event_id,
      envelope.event_type,
      envelope.schema_version,
      envelope.aggregate_type,
      envelope.aggregate_id,
      envelope.aggregate_version,
      JSON.stringify(envelope),
      envelope.correlation_id,
      envelope.causation_id,
      envelope.occurred_at,
    ],
  );
  return id;
};
