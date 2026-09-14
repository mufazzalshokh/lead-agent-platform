import { describe, expect, it, vi } from "vitest";

import { createWorkerHandlerRegistry } from "../../apps/worker/src/handler-registry.js";
import {
  OperatorMaintenanceDeniedError,
  createOperatorMaintenanceService,
  type OperatorMaintenancePersistencePort,
  type OperatorOutboxRequeueRequest,
  type OperatorWorkerRedriveRequest,
} from "../../apps/worker/src/operator-maintenance.js";

const baseAudit = {
  approvalReference: "OPS-8421",
  auditEventId: "0193f1a8-7f65-7c28-a434-000000000010",
  operatorPrincipalId: "0193f1a8-7f65-7c28-a434-000000000011",
  reasonCode: "root_cause_repaired",
  requestId: "request.s85.operator.001",
  sourceIpHash: new Uint8Array(32),
} as const;

const redriveRequest: OperatorWorkerRedriveRequest = {
  ...baseAudit,
  dlqJobId: "123e4567-e89b-42d3-a456-426614174000",
  eventType: "organization.created",
  expectedState: "created",
  handlerVersion: "v1",
  outboxEventId: "0193f1a8-7f65-7c28-a434-000000000012",
  schemaVersion: "1",
  sourceQueue: "maintenance",
};

const requeueRequest: OperatorOutboxRequeueRequest = {
  ...baseAudit,
  eventType: "organization.created",
  expectedErrorCategory: "permanent",
  expectedState: "dead_lettered",
  organizationId: "0193f1a8-7f65-7c28-a434-000000000013",
  outboxEventId: "0193f1a8-7f65-7c28-a434-000000000012",
  schemaVersion: "1",
};

const createPersistence = () => {
  const redriveWorkerDlqJob = vi.fn(() => Promise.resolve("123e4567-e89b-42d3-a456-426614174001"));
  const requeueDeadOutboxEvent = vi.fn(() => Promise.resolve());
  const persistence: OperatorMaintenancePersistencePort = {
    redriveWorkerDlqJob,
    requeueDeadOutboxEvent,
  };
  return { persistence, redriveWorkerDlqJob, requeueDeadOutboxEvent };
};

describe("S8.5 internal operator maintenance boundary", () => {
  it("permits only an exact active route, queue, and handler version", async () => {
    const memory = createPersistence();
    const service = createOperatorMaintenanceService({
      persistence: memory.persistence,
      registry: createWorkerHandlerRegistry([
        {
          eventType: "organization.created",
          handler: () => Promise.resolve(),
          handlerVersion: "v1",
          queue: "maintenance",
          schemaVersion: "1",
        },
      ]),
    });
    await expect(service.redriveWorkerDlqJob(redriveRequest)).resolves.toMatch(/^[0-9a-f-]{36}$/u);
    await expect(service.requeueDeadOutboxEvent(requeueRequest)).resolves.toBeUndefined();
    expect(memory.redriveWorkerDlqJob).toHaveBeenCalledWith(redriveRequest);
    expect(memory.requeueDeadOutboxEvent).toHaveBeenCalledWith(requeueRequest);
  });

  it("denies arbitrary queues, handler versions, inactive routes, and successful bulk replay", async () => {
    const memory = createPersistence();
    const service = createOperatorMaintenanceService({
      persistence: memory.persistence,
      registry: createWorkerHandlerRegistry([]),
    });
    await expect(service.redriveWorkerDlqJob(redriveRequest)).rejects.toBeInstanceOf(
      OperatorMaintenanceDeniedError,
    );
    await expect(service.requeueDeadOutboxEvent(requeueRequest)).rejects.toBeInstanceOf(
      OperatorMaintenanceDeniedError,
    );
    expect(memory.redriveWorkerDlqJob).not.toHaveBeenCalled();
    expect(memory.requeueDeadOutboxEvent).not.toHaveBeenCalled();
    expect(service).not.toHaveProperty("replayEverything");
  });
});
