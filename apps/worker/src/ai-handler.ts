import type { AIWorkReference, createAIOrchestrator } from "@lead-agent/application";
import { DomainEventSchemasByVersion, isSchemaValue } from "@lead-agent/contracts";
import type { WorkerEventHandler } from "./handler-registry.js";
import { WorkerJobInvariantError } from "./job-executor.js";

export const createAIMessageHandler =
  (orchestrator: ReturnType<typeof createAIOrchestrator>): WorkerEventHandler =>
  async (context) => {
    const event = context.canonicalEvent;
    if (
      !isSchemaValue(DomainEventSchemasByVersion["message.received"]["1"], event) ||
      event.organization_id !== context.organizationId
    )
      throw new WorkerJobInvariantError();
    const reference: AIWorkReference = {
      organizationId: event.organization_id,
      messageId: event.payload.message_id,
      conversationId: event.aggregate_id,
      correlationId: event.correlation_id,
      causationId: event.event_id,
    };
    await orchestrator.run(reference, context.signal);
  };
