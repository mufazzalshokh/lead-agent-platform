import {
  StaffOperationError,
  staffMutationPermission,
  type StaffOperationsStore,
} from "@lead-agent/application";
import {
  StaffMutationResultSchema,
  isSchemaValue,
  type StaffMutationResult,
  type ResourceId,
} from "@lead-agent/contracts";
import { createSecurityIdentifierFactory } from "@lead-agent/security";
import type { TenantDatabaseRuntime } from "../runtime/tenant.js";
import {
  finalizeRepositoryIdempotency,
  reserveRepositoryIdempotency,
  LocationConfigurationIdempotencyError,
  type LocationConfigurationReplayProtector,
} from "./location-configuration.js";
import { persistStaffAppointmentDecision, persistStaffHandoff } from "./staff-domain.js";
import { persistStaffOutcome, appendStaffAudit } from "./staff-outcomes.js";
import { getStaffWork, readStaffWork, readStaffOutcomes, requireStaffActor } from "./staff-work.js";
import {
  executeTenantWrite,
  RepositoryVersionConflictError,
  RepositoryNotFoundError,
  RepositoryDatabaseError,
} from "./shared.js";

/** All commands, idempotency completion, audit/history and Outbox writes share one transaction. */
export const createStaffOperationsStore = (
  runtime: TenantDatabaseRuntime,
  protector: LocationConfigurationReplayProtector,
  nextId: () => string = () => createSecurityIdentifierFactory().issueResourceId(new Date()),
): StaffOperationsStore =>
  Object.freeze<StaffOperationsStore>({
    list: (input) =>
      runtime.withTenantTransaction(input.authorization.organizationId, (session) =>
        readStaffWork(session, input.authorization, input.kind, input),
      ),
    get: (input) =>
      runtime.withTenantTransaction(input.authorization.organizationId, (session) =>
        getStaffWork(session, input.authorization, input.kind, input.id),
      ),
    outcomes: (input) =>
      runtime.withTenantTransaction(input.authorization.organizationId, (session) =>
        readStaffOutcomes(session, input),
      ),
    mutate: async (input) => {
      try {
        return await runtime.withTenantTransaction(
          input.authorization.organizationId,
          async (session) => {
            await requireStaffActor(
              session,
              input.authorization,
              staffMutationPermission(input.operation),
            );
            // Replay must still pass current membership/location/resource authorization.
            const before = await getStaffWork(session, input.authorization, input.kind, input.id);
            if (input.operation.action === "acknowledge" && !before.acknowledgment_supported)
              throw new StaffOperationError("business_rule_failed");
            const replay = await reserveRepositoryIdempotency(session, input);
            if (replay !== null) {
              if (
                replay.status !== "succeeded" ||
                !(replay.response_ciphertext instanceof Uint8Array)
              )
                throw new StaffOperationError("idempotency_conflict");
              const value: unknown = JSON.parse(
                new TextDecoder("utf-8", { fatal: true }).decode(
                  protector.reveal(input.idempotency.scope, replay.response_ciphertext),
                ),
              );
              if (!isSchemaValue(StaffMutationResultSchema, value))
                throw new TypeError("Invalid protected staff replay");
              return value;
            }
            if (before.version !== input.expectedVersion)
              throw new StaffOperationError("version_conflict");
            let outcomeId: ResourceId | null = null;
            if (input.operation.action === "accept" || input.operation.action === "reject")
              await persistStaffAppointmentDecision(session, input, nextId);
            else if (input.operation.action === "claim" || input.operation.action === "resolve")
              await persistStaffHandoff(session, input, nextId);
            else if (input.operation.action === "acknowledge") {
              const updated = await executeTenantWrite(
                session,
                `update notifications set read_at=$4,version=version+1,updated_at=$4 where organization_id=$1 and id=$2 and recipient_membership_id=$3 and audience_type='membership' and read_at is null and version=$5 returning id`,
                [
                  input.id,
                  input.authorization.membershipId,
                  input.occurredAt,
                  input.expectedVersion,
                ],
              );
              if (updated.rowCount !== 1) throw new StaffOperationError("version_conflict");
              await appendStaffAudit(session, input, nextId);
            } else outcomeId = await persistStaffOutcome(session, input, nextId);
            const result: StaffMutationResult = {
              resource: await getStaffWork(session, input.authorization, input.kind, input.id),
              outcome_id: outcomeId,
            };
            const ciphertext = protector.protect(
              input.idempotency.scope,
              new TextEncoder().encode(JSON.stringify(result)),
            );
            if (ciphertext.byteLength < 1 || ciphertext.byteLength > 65_536)
              throw new TypeError("Invalid protected staff replay size");
            if (input.kind === "conversation") throw new StaffOperationError("validation_failed");
            await finalizeRepositoryIdempotency(session, input, input.kind, input.id, ciphertext);
            return result;
          },
        );
      } catch (error) {
        if (error instanceof LocationConfigurationIdempotencyError)
          throw new StaffOperationError("idempotency_conflict");
        if (error instanceof RepositoryVersionConflictError)
          throw new StaffOperationError("version_conflict");
        if (error instanceof RepositoryNotFoundError)
          throw new StaffOperationError("resource_not_found");
        // Do not turn unexpected database/audit/event failures into business success or retry them.
        if (error instanceof RepositoryDatabaseError) throw error;
        throw error;
      }
    },
  });
