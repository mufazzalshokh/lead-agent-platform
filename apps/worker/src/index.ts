import process from "node:process";
import { pathToFileURL } from "node:url";

import { loadQueueDatabaseRuntimeConfig } from "@lead-agent/config";

import { PRODUCTION_HANDLER_REGISTRY } from "./handler-registry.js";
import { createQueueInfrastructure } from "./queue-infrastructure.js";
import { createWorkerRuntime, type WorkerRuntime } from "./worker-runtime.js";

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
): WorkerRuntime =>
  createWorkerRuntime({
    observability: {
      onDispatcherError: (error) => {
        console.error("Worker dispatcher iteration failed", safeErrorMetadata(error));
      },
    },
    queue: createQueueInfrastructure(loadQueueDatabaseRuntimeConfig(environment)),
    registry: PRODUCTION_HANDLER_REGISTRY,
  });

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
  let runtime: WorkerRuntime | undefined;
  const stop = (): void => {
    void runtime?.stop().catch((error: unknown) => {
      console.error("Lead Agent Platform worker shutdown failed", safeErrorMetadata(error));
      process.exitCode = 1;
    });
  };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
  try {
    runtime = createProductionWorkerRuntime();
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
  type WorkerHandlerContext,
  type WorkerHandlerRegistration,
  type WorkerHandlerRegistry,
} from "./handler-registry.js";
export { createWorkerJobExecutor, type WorkerJobExecutor } from "./job-executor.js";
export {
  createWorkerRuntime,
  type WorkerLifecycleState,
  type WorkerReadiness,
  type WorkerRuntime,
  type WorkerTenantRuntimeReadiness,
} from "./worker-runtime.js";
