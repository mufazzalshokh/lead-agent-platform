import type { DomainEvent, LeadReopenedDomainEventV2 } from "@lead-agent/contracts";

import type { DeepReadonly } from "./immutable.js";

export type CanonicalDomainEvent = DomainEvent | LeadReopenedDomainEventV2;

/**
 * Projects only domain-known fields from an accepted canonical event contract.
 * The application attaches envelope identity, tenant/actor provenance, time,
 * and correlation metadata later; this type publishes or authorizes nothing.
 */
export type DomainEventDraft<Event extends CanonicalDomainEvent> = Readonly<{
  aggregate_version: Event["aggregate_version"];
  event_type: Event["event_type"];
  payload: DeepReadonly<Event["payload"]>;
  schema_id: Event["schema_id"];
  schema_version: Event["schema_version"];
}>;
