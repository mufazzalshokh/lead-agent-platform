import { queueForEvent } from "./event-routing.js";
import type { WorkerHandlerRegistry } from "./handler-registry.js";
import type { QueueName } from "./queue-names.js";

export type OperatorAuditContext = Readonly<{
  approvalReference: string;
  auditEventId: string;
  operatorPrincipalId: string;
  reasonCode: string;
  requestId: string;
  sourceIpHash: Uint8Array;
}>;

export type OperatorWorkerRedriveRequest = OperatorAuditContext &
  Readonly<{
    dlqJobId: string;
    eventType: string;
    expectedState: "created";
    handlerVersion: string;
    outboxEventId: string;
    schemaVersion: string;
    sourceQueue: QueueName;
  }>;

export type OperatorOutboxRequeueRequest = OperatorAuditContext &
  Readonly<{
    eventType: string;
    expectedErrorCategory: string;
    expectedState: "dead_lettered";
    organizationId: string;
    outboxEventId: string;
    schemaVersion: string;
  }>;

export type OperatorMaintenancePersistencePort = Readonly<{
  redriveWorkerDlqJob: (input: OperatorWorkerRedriveRequest) => Promise<string>;
  requeueDeadOutboxEvent: (input: OperatorOutboxRequeueRequest) => Promise<void>;
}>;

export class OperatorMaintenanceDeniedError extends Error {
  readonly code = "operator_maintenance_denied" as const;

  constructor() {
    super("Operator maintenance request denied");
    this.name = "OperatorMaintenanceDeniedError";
  }
}

export type OperatorMaintenanceService = Readonly<{
  redriveWorkerDlqJob: (input: OperatorWorkerRedriveRequest) => Promise<string>;
  requeueDeadOutboxEvent: (input: OperatorOutboxRequeueRequest) => Promise<void>;
}>;

export const createOperatorMaintenanceService = (input: {
  persistence: OperatorMaintenancePersistencePort;
  registry: WorkerHandlerRegistry;
}): OperatorMaintenanceService => {
  const requireActiveRegistration = (
    eventType: string,
    schemaVersion: string,
    sourceQueue?: QueueName,
    handlerVersion?: string,
  ): void => {
    const registration = input.registry.registrations.find(
      (candidate) => candidate.eventType === eventType && candidate.schemaVersion === schemaVersion,
    );
    if (
      registration === undefined ||
      (sourceQueue !== undefined &&
        (registration.queue !== sourceQueue ||
          queueForEvent(registration.eventType) !== sourceQueue)) ||
      (handlerVersion !== undefined && registration.handlerVersion !== handlerVersion)
    ) {
      throw new OperatorMaintenanceDeniedError();
    }
  };

  return Object.freeze({
    redriveWorkerDlqJob: async (request): Promise<string> => {
      requireActiveRegistration(
        request.eventType,
        request.schemaVersion,
        request.sourceQueue,
        request.handlerVersion,
      );
      return input.persistence.redriveWorkerDlqJob(request);
    },
    requeueDeadOutboxEvent: async (request): Promise<void> => {
      requireActiveRegistration(request.eventType, request.schemaVersion);
      await input.persistence.requeueDeadOutboxEvent(request);
    },
  });
};
