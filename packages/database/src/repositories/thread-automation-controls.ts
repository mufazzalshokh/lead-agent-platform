import {
  ThreadAutomationControlError,
  type InboundEligibilityDecision,
  type PreparedThreadAutomationTransition,
  type ThreadAutomationControlStore,
  type ThreadAutomationEligibilityStore,
} from "@lead-agent/application";
import {
  ThreadAutomationControlSchema,
  isSchemaValue,
  type ThreadAutomationControl,
  type ThreadAutomationDecisionSource,
  type ThreadAutomationEligibilityState,
} from "@lead-agent/contracts";
import { createSecurityIdentifierFactory } from "@lead-agent/security";
import type { QueryResultRow } from "pg";

import type { TenantDatabaseRuntime, TenantDbSession } from "../runtime/tenant.js";
import { requireStaffActor } from "./staff-work.js";
import {
  executeTenantRead,
  executeTenantWrite,
  mapChannelConnectionId,
  mapEnum,
  mapMembershipId,
  mapNullableString,
  mapResourceId,
  mapSafeBigInt,
  mapString,
  mapUtcTimestamp,
} from "./shared.js";

const ELIGIBILITY_STATES = [
  "business_eligible",
  "excluded_personal",
  "uncertain",
  "staff_only",
] as const;
const DECISION_SOURCES = [
  "system_default",
  "staff",
  "owner_configuration",
  "provider_rule",
  "platform_policy",
] as const;

type ControlRow = QueryResultRow & {
  channel_connection_id: unknown;
  created_at: unknown;
  decided_by_membership_id: unknown;
  decision_source: unknown;
  eligibility_state: unknown;
  id: unknown;
  reason_code: unknown;
  updated_at: unknown;
  version: unknown;
};

const mapControl = (row: ControlRow): ThreadAutomationControl => {
  const membership = mapNullableString(row.decided_by_membership_id);
  const value: unknown = {
    id: mapResourceId(row.id),
    channel_connection_id: mapChannelConnectionId(row.channel_connection_id),
    eligibility_state: mapEnum(row.eligibility_state, ELIGIBILITY_STATES),
    decision_source: mapEnum(row.decision_source, DECISION_SOURCES),
    reason_code: mapString(row.reason_code),
    decided_by_membership_id: membership === null ? null : mapMembershipId(membership),
    version: mapSafeBigInt(row.version),
    created_at: mapUtcTimestamp(row.created_at),
    updated_at: mapUtcTimestamp(row.updated_at),
  };
  if (!isSchemaValue(ThreadAutomationControlSchema, value)) {
    throw new TypeError("Invalid persisted thread automation control");
  }
  return value;
};

const selectControl = async (
  session: TenantDbSession,
  controlId: string,
  lock: "for share" | "for update" | "",
): Promise<ThreadAutomationControl | null> => {
  const rows = await executeTenantRead<ControlRow>(
    session,
    `select id::text,channel_connection_id::text,eligibility_state,decision_source,
            reason_code,decided_by_membership_id::text,version::text,created_at,updated_at
       from thread_automation_controls
      where organization_id=$1 and id=$2 ${lock}`,
    [controlId],
  );
  return rows[0] === undefined ? null : mapControl(rows[0]);
};

const resolveInSession = async (
  session: TenantDbSession,
  input: Parameters<ThreadAutomationEligibilityStore["resolveInbound"]>[0],
  controlId: string,
): Promise<InboundEligibilityDecision> => {
  const channel = await executeTenantRead<QueryResultRow>(
    session,
    `select id from channel_connections
      where organization_id=$1 and id=$2 and channel_type=$3 and status='active' for share`,
    [input.context.channelConnectionId, input.channel],
  );
  if (channel.length !== 1) throw new ThreadAutomationControlError("resource_not_found");
  await executeTenantWrite(
    session,
    `insert into thread_automation_controls
      (organization_id,id,channel_connection_id,external_thread_hash,eligibility_state,
       decision_source,reason_code,decided_by_membership_id,version,created_at,updated_at)
     values ($1,$2,$3,$4,'uncertain','system_default','unseen_social_thread',null,1,$5,$5)
     on conflict (organization_id,channel_connection_id,external_thread_hash) do nothing`,
    [controlId, input.context.channelConnectionId, Buffer.from(input.threadHash), input.occurredAt],
  );
  const rows = await executeTenantRead<QueryResultRow>(
    session,
    `select id::text,eligibility_state,version::text from thread_automation_controls
      where organization_id=$1 and channel_connection_id=$2 and external_thread_hash=$3 for share`,
    [input.context.channelConnectionId, Buffer.from(input.threadHash)],
  );
  const row = rows[0];
  if (row === undefined) throw new ThreadAutomationControlError("resource_not_found");
  return Object.freeze({
    controlId: mapResourceId(row["id"]),
    state: mapEnum(row["eligibility_state"], ELIGIBILITY_STATES),
    version: mapSafeBigInt(row["version"]),
  });
};

const transitionInSession = async (
  session: TenantDbSession,
  input: PreparedThreadAutomationTransition,
  nextId: () => string,
): Promise<ThreadAutomationControl> => {
  await requireStaffActor(session, input.authorization, "conversations.manage");
  const before = await selectControl(session, input.controlId, "for update");
  if (before === null) throw new ThreadAutomationControlError("resource_not_found");
  if (before.version !== input.expectedVersion) {
    throw new ThreadAutomationControlError("version_conflict");
  }
  const updated = await executeTenantWrite<ControlRow>(
    session,
    `update thread_automation_controls
        set eligibility_state=$3,decision_source='staff',reason_code=$4,
            decided_by_membership_id=$5,version=version+1,updated_at=$6
      where organization_id=$1 and id=$2 and version=$7
      returning id::text,channel_connection_id::text,eligibility_state,decision_source,
                reason_code,decided_by_membership_id::text,version::text,created_at,updated_at`,
    [
      input.controlId,
      input.input.eligibility_state,
      input.input.reason_code,
      input.authorization.membershipId,
      input.occurredAt,
      input.expectedVersion,
    ],
  );
  const row = updated.rows[0];
  if (updated.rowCount !== 1 || row === undefined) {
    throw new ThreadAutomationControlError("version_conflict");
  }
  await executeTenantWrite(
    session,
    `insert into audit_events
      (organization_id,id,event_type,actor_type,actor_id,actor_membership_id,target_type,target_id,
       action,result,reason_code,request_id,correlation_id,metadata_redacted_jsonb,occurred_at)
     values ($1,$2,'thread_automation_control.transitioned','member',$3,$3,
       'thread_automation_control',$4,'thread_automation_control.transition','succeeded',$5,$6,$7,$8::jsonb,$9)`,
    [
      nextId(),
      input.authorization.membershipId,
      input.controlId,
      input.input.reason_code,
      input.requestId,
      input.correlationId,
      JSON.stringify({
        channel_connection_id: before.channel_connection_id,
        decision_source: "staff" satisfies ThreadAutomationDecisionSource,
        new_state: input.input.eligibility_state,
        old_state: before.eligibility_state,
      }),
      input.occurredAt,
    ],
  );
  return mapControl(row);
};

export const createThreadAutomationControlStore = (
  runtime: TenantDatabaseRuntime,
  nextId: () => string = () => createSecurityIdentifierFactory().issueResourceId(new Date()),
): ThreadAutomationControlStore =>
  Object.freeze({
    resolveInbound: async (input: Parameters<ThreadAutomationControlStore["resolveInbound"]>[0]) =>
      await runtime.withTenantTransaction(input.context.organizationId, (session) =>
        resolveInSession(session, input, nextId()),
      ),
    get: async (
      authorization: Parameters<ThreadAutomationControlStore["get"]>[0],
      controlId: Parameters<ThreadAutomationControlStore["get"]>[1],
    ) =>
      await runtime.withTenantTransaction(authorization.organizationId, async (session) => {
        await requireStaffActor(session, authorization, "conversations.read");
        const value = await selectControl(session, controlId, "");
        if (value === null) throw new ThreadAutomationControlError("resource_not_found");
        return value;
      }),
    transition: async (input: Parameters<ThreadAutomationControlStore["transition"]>[0]) =>
      await runtime.withTenantTransaction(input.authorization.organizationId, (session) =>
        transitionInSession(session, input, nextId),
      ),
  });

export const requireBusinessEligibleInbound = async (
  session: TenantDbSession,
  input: Readonly<{
    channelConnectionId: string;
    controlId: string;
    threadHash: Uint8Array;
  }>,
): Promise<Readonly<{ state: ThreadAutomationEligibilityState; version: number }> | null> => {
  const rows = await executeTenantRead<QueryResultRow>(
    session,
    `select eligibility_state,version::text from thread_automation_controls
      where organization_id=$1 and id=$2 and channel_connection_id=$3
        and external_thread_hash=$4 for share`,
    [input.controlId, input.channelConnectionId, Buffer.from(input.threadHash)],
  );
  const row = rows[0];
  if (row === undefined) return null;
  return Object.freeze({
    state: mapEnum(row["eligibility_state"], ELIGIBILITY_STATES),
    version: mapSafeBigInt(row["version"]),
  });
};
