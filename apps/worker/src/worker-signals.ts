import type { WorkerRuntime } from "./worker-runtime.js";

export const WORKER_PROCESS_HARD_SHUTDOWN_MILLISECONDS = 29_000;

export type WorkerShutdownSignal = "SIGINT" | "SIGTERM";

export type WorkerShutdownCoordinator = Readonly<{
  request: (signal: WorkerShutdownSignal) => Promise<void>;
}>;

export class WorkerShutdownConfigurationError extends Error {
  readonly code = "worker_shutdown_configuration_invalid" as const;

  constructor() {
    super("Worker shutdown configuration is invalid");
    this.name = "WorkerShutdownConfigurationError";
  }
}

type TimeoutHandle = ReturnType<typeof setTimeout>;

const scheduleHardDeadline = (callback: () => void, milliseconds: number): TimeoutHandle => {
  const timeout = setTimeout(callback, milliseconds);
  timeout.unref();
  return timeout;
};

export const createWorkerShutdownCoordinator = (input: {
  cancelDeadline?: (handle: TimeoutHandle) => void;
  forceExit?: (exitCode: number) => void;
  hardDeadlineMilliseconds?: number;
  onShutdownError?: (error: unknown) => void;
  runtime: Pick<WorkerRuntime, "stop">;
  scheduleDeadline?: (callback: () => void, milliseconds: number) => TimeoutHandle;
}): WorkerShutdownCoordinator => {
  const hardDeadlineMilliseconds =
    input.hardDeadlineMilliseconds ?? WORKER_PROCESS_HARD_SHUTDOWN_MILLISECONDS;
  if (
    !Number.isSafeInteger(hardDeadlineMilliseconds) ||
    hardDeadlineMilliseconds < 1 ||
    hardDeadlineMilliseconds > WORKER_PROCESS_HARD_SHUTDOWN_MILLISECONDS
  ) {
    throw new WorkerShutdownConfigurationError();
  }
  const cancelDeadline = input.cancelDeadline ?? clearTimeout;
  const forceExit = input.forceExit ?? ((exitCode: number) => process.exit(exitCode));
  const scheduleDeadline = input.scheduleDeadline ?? scheduleHardDeadline;
  let shutdown: Promise<void> | undefined;

  return Object.freeze({
    request: (signal): Promise<void> => {
      if (signal !== "SIGINT" && signal !== "SIGTERM") {
        return Promise.reject(new WorkerShutdownConfigurationError());
      }
      if (shutdown !== undefined) return shutdown;
      const deadline = scheduleDeadline(() => forceExit(1), hardDeadlineMilliseconds);
      shutdown = input.runtime
        .stop()
        .catch((error: unknown) => {
          try {
            input.onShutdownError?.(error);
          } catch {
            // Shutdown reporting cannot replace the original failure.
          }
          throw error;
        })
        .finally(() => cancelDeadline(deadline));
      return shutdown;
    },
  });
};
