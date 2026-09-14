import type { WorkerFailureCategory } from "./reliability-policy.js";

export type WorkerExecutionAcquisition =
  | Readonly<{ state: "acquired"; leaseToken: string }>
  | Readonly<{ state: "busy"; leaseExpiresAt: Date }>
  | Readonly<{
      state: "collision" | "known_permanent_failure" | "known_success" | "reconciliation_required";
    }>;

export type WorkerExecutionIdentityInput = Readonly<{
  executionNumber: number;
  fingerprint: Uint8Array;
  handlerVersion: string;
  organizationId: string;
  outboxEventId: string;
}>;

export type WorkerExecutionFinishState =
  "permanent_failure" | "reconciliation_required" | "retryable_failure" | "succeeded";

export type WorkerReliabilityPersistencePort = Readonly<{
  acquireExecution: (input: WorkerExecutionIdentityInput) => Promise<WorkerExecutionAcquisition>;
  finishExecution: (
    input: WorkerExecutionIdentityInput &
      Readonly<{
        category: WorkerFailureCategory | null;
        leaseToken: string;
        state: WorkerExecutionFinishState;
      }>,
  ) => Promise<boolean>;
  prepareRetry: (
    input: Readonly<{
      delaySeconds: number;
      physicalJobId: string;
      queue: string;
      retryCount: number;
    }>,
  ) => Promise<boolean>;
  resolveReconciliation: (
    input: WorkerExecutionIdentityInput &
      Readonly<{
        category: WorkerFailureCategory | null;
        resolution: "permanent_failure" | "succeeded" | "unresolved";
      }>,
  ) => Promise<boolean>;
  resumeAfterReconciliation: (input: WorkerExecutionIdentityInput) => Promise<string | null>;
}>;
