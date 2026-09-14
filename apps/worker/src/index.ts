import process from "node:process";
import { pathToFileURL } from "node:url";

import { loadQueueDatabaseRuntimeConfig } from "@lead-agent/config";

import { PRODUCTION_HANDLER_REGISTRY } from "./handler-registry.js";
import { createQueueInfrastructure } from "./queue-infrastructure.js";
import { createWorkerRuntime, type WorkerRuntime } from "./worker-runtime.js";
import { createWorkerShutdownCoordinator } from "./worker-signals.js";
import { createStructuredConsoleWorkerTelemetry } from "./worker-telemetry.js";

const safeErrorMetadata = (error: unknown): Readonly<{ code?: string; name: string }> => {
  if (!(error instanceof Error)) return Object.freeze({ name: "UnknownError" });
  const code: unknown = Reflect.get(error, "code");
  return Object.freeze({
    ...(typeof code === "string" ? { code } : {}),
    name: error.name,
  });
};

export const createProductionWorkerRuntime = (
  environment: NodeJS.ProcessEnv = process.env,
): WorkerRuntime => {
  const telemetry = createStructuredConsoleWorkerTelemetry({ service: "lead-agent-worker" });
  return createWorkerRuntime({
    observability: {
      onDispatcherError: (error) => {
        console.error("Worker dispatcher iteration failed", safeErrorMetadata(error));
      },
    },
    queue: createQueueInfrastructure(loadQueueDatabaseRuntimeConfig(environment), { telemetry }),
    registry: PRODUCTION_HANDLER_REGISTRY,
    telemetry,
  });
};

export const startWorker = async (
  environment: NodeJS.ProcessEnv = process.env,
): Promise<WorkerRuntime> => {
  const runtime = createProductionWorkerRuntime(environment);
  await runtime.start();
  console.info("Lead Agent Platform worker is ready", runtime.readiness());
  return runtime;
};

const isMainModule = (): boolean => {
  const entrypoint = process.argv[1];
  return entrypoint !== undefined && pathToFileURL(entrypoint).href === import.meta.url;
};

const runWorkerProcess = async (): Promise<void> => {
  try {
    const runtime = createProductionWorkerRuntime();
    const shutdown = createWorkerShutdownCoordinator({
      onShutdownError: (error) => {
        console.error("Lead Agent Platform worker shutdown failed", safeErrorMetadata(error));
        process.exitCode = 1;
      },
      runtime,
    });
    const stopFor = (signal: "SIGINT" | "SIGTERM") => (): void => {
      void shutdown.request(signal).catch(() => undefined);
    };
    process.once("SIGTERM", stopFor("SIGTERM"));
    process.once("SIGINT", stopFor("SIGINT"));
    await runtime.start();
    console.info("Lead Agent Platform worker is ready", runtime.readiness());
  } catch (error) {
    console.error("Lead Agent Platform worker startup failed", safeErrorMetadata(error));
    process.exitCode = 1;
  }
};

if (isMainModule()) void runWorkerProcess();

export {
  PRODUCTION_HANDLER_REGISTRY,
  createWorkerHandlerIdentity,
  createWorkerHandlerRegistry,
  type WorkerEventHandler,
  type WorkerEventReconciler,
  type WorkerHandlerContext,
  type WorkerHandlerRegistration,
  type WorkerHandlerRegistry,
} from "./handler-registry.js";
export { createWorkerJobExecutor, type WorkerJobExecutor } from "./job-executor.js";
export {
  WORKER_OPERATIONS_POLL_MILLISECONDS,
  collectWorkerOperationalMetrics,
  type OutboxBacklogSnapshot,
  type WorkerOutboxBacklogProbe,
  type WorkerQueueDepth,
  type WorkerQueueDepthProbe,
} from "./worker-operations.js";
export {
  OperatorMaintenanceDeniedError,
  createOperatorMaintenanceService,
  type OperatorAuditContext,
  type OperatorMaintenancePersistencePort,
  type OperatorMaintenanceService,
  type OperatorOutboxRequeueRequest,
  type OperatorWorkerRedriveRequest,
} from "./operator-maintenance.js";
export {
  WORKER_ACTIVE_EXPIRATION_SECONDS,
  WORKER_FAILURE_CATEGORIES,
  WORKER_HEARTBEAT_SECONDS,
  WORKER_INITIAL_RETRY_SECONDS,
  WORKER_MAX_EXECUTIONS,
  WORKER_MAX_GENERIC_AGE_MILLISECONDS,
  WORKER_MAX_RETRY_SECONDS,
  WorkerExecutionFailure,
  decideWorkerRetry,
  fullJitterCapSeconds,
  sampleFullJitterSeconds,
  type WorkerFailureCategory,
  type WorkerRetryDecision,
} from "./reliability-policy.js";
export {
  WORKER_DISPATCH_JITTER_MAX_MILLISECONDS,
  WORKER_DISPATCH_POLL_MILLISECONDS,
  WORKER_QUEUE_RECOVERY_STOP_MILLISECONDS,
  WORKER_SHUTDOWN_DRAIN_MILLISECONDS,
  WORKER_TELEMETRY_FLUSH_MILLISECONDS,
  createWorkerRuntime,
  type WorkerLiveness,
  type WorkerLifecycleState,
  type WorkerReadiness,
  type WorkerRuntime,
  type WorkerTenantRuntimeReadiness,
} from "./worker-runtime.js";
export {
  WORKER_PROCESS_HARD_SHUTDOWN_MILLISECONDS,
  WorkerShutdownConfigurationError,
  createWorkerShutdownCoordinator,
  type WorkerShutdownCoordinator,
  type WorkerShutdownSignal,
} from "./worker-signals.js";
export {
  WORKER_METRIC_NAMES,
  createSafeWorkerTelemetry,
  createStructuredConsoleWorkerTelemetry,
  type WorkerLogRecord,
  type WorkerMetricLabels,
  type WorkerMetricName,
  type WorkerMetricRecord,
  type WorkerSafeTelemetryAttributes,
  type WorkerSpanEnd,
  type WorkerSpanStart,
  type WorkerTelemetry,
  type WorkerTelemetryOutcome,
  type WorkerTelemetrySink,
  type WorkerTraceLink,
} from "./worker-telemetry.js";
