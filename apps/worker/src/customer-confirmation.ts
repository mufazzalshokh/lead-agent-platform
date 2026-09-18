import type { AIWorkReference, CustomerConfirmationStore } from "@lead-agent/application";
import { DomainEventSchemasByVersion, isSchemaValue } from "@lead-agent/contracts";
import type { WorkerEventHandler } from "./handler-registry.js";
import { WorkerJobInvariantError } from "./job-executor.js";
import { WorkerExecutionFailure } from "./reliability-policy.js";

export const createCustomerConfirmationPreparationHandler =
  (store: CustomerConfirmationStore): WorkerEventHandler =>
  async (context) => {
    const event = context.canonicalEvent;
    if (
      !isSchemaValue(
        DomainEventSchemasByVersion["appointment_request.staff_accepted"]["1"],
        event,
      ) ||
      event.organization_id !== context.organizationId
    )
      throw new WorkerJobInvariantError();
    const result = await store.prepare(event);
    if (result === "unavailable") throw new WorkerExecutionFailure("PERMANENT_BUSINESS");
  };
export const createCustomerConfirmationExpiryHandler =
  (store: CustomerConfirmationStore): WorkerEventHandler =>
  async (context) => {
    const event = context.canonicalEvent;
    if (
      !isSchemaValue(
        DomainEventSchemasByVersion["appointment_request.customer_confirmation_requested"]["1"],
        event,
      ) ||
      event.organization_id !== context.organizationId
    )
      throw new WorkerJobInvariantError();
    if ((await store.expire(event)) === "not_due")
      throw new WorkerExecutionFailure("RETRYABLE_INFRASTRUCTURE");
  };
export const createCustomerConfirmationMessageHandler =
  (store: CustomerConfirmationStore, fallback?: WorkerEventHandler): WorkerEventHandler =>
  async (context) => {
    const event = context.canonicalEvent;
    if (
      !isSchemaValue(DomainEventSchemasByVersion["message.received"]["1"], event) ||
      event.organization_id !== context.organizationId
    )
      throw new WorkerJobInvariantError();
    const reference: AIWorkReference = {
      organizationId: event.organization_id,
      conversationId: event.aggregate_id,
      messageId: event.payload.message_id,
      correlationId: event.correlation_id,
      causationId: event.event_id,
    };
    const result = await store.respond(reference);
    if (result.kind === "not_applicable") await fallback?.(context);
  };
