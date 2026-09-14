import type { WorkerHandlerRegistry } from "./handler-registry.js";
import { createWorkerJobExecutor } from "./job-executor.js";
import type { OutboxDispatcher, TenantCanonicalEventSourcePort } from "./outbox-dispatcher.js";
import type { QueueInfrastructure, QueueWorkRegistration } from "./queue-infrastructure.js";

export const WORKER_DISPATCH_POLL_MILLISECONDS = 1_000;
export const WORKER_DISPATCH_JITTER_MAX_MILLISECONDS = 250;

export type WorkerLifecycleState =
  "created" | "starting" | "ready" | "stopping" | "stopped" | "failed";

export type WorkerReadiness = Readonly<{
  activeHandlerCount: number;
  activeQueueCount: number;
  activeRouteCount: number;
  ready: boolean;
  state: WorkerLifecycleState;
}>;

export type WorkerRuntimeObservability = Readonly<{
  onDispatcherError: (error: unknown) => void;
}>;

export type WorkerTenantRuntimeReadiness = Readonly<{
  verifyReady: () => Promise<void>;
}>;

export type WorkerRuntime = Readonly<{
  readiness: () => WorkerReadiness;
  start: () => Promise<void>;
  stop: () => Promise<void>;
}>;

export class WorkerLifecycleError extends Error {
  readonly code = "worker_lifecycle_invalid" as const;

  constructor() {
    super("Worker lifecycle transition is invalid");
    this.name = "WorkerLifecycleError";
  }
}

type Sleeper = (milliseconds: number, signal: AbortSignal) => Promise<void>;

const asError = (error: unknown): Error =>
  error instanceof Error ? error : new Error("Unknown worker resource cleanup failure");

const defaultSleeper: Sleeper = async (milliseconds, signal): Promise<void> => {
  if (signal.aborted) return;
  await new Promise<void>((resolve) => {
    const onAbort = (): void => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    signal.addEventListener("abort", onAbort, { once: true });
  });
};

class WorkerRuntimeImplementation implements WorkerRuntime {
  readonly #closeTenantRuntime: (() => Promise<void>) | undefined;
  readonly #dispatcher: OutboxDispatcher | undefined;
  readonly #observability: WorkerRuntimeObservability;
  readonly #queue: QueueInfrastructure;
  readonly #random: () => number;
  readonly #registry: WorkerHandlerRegistry;
  readonly #sleeper: Sleeper;
  readonly #tenantEvents: TenantCanonicalEventSourcePort | undefined;
  readonly #tenantRuntime: WorkerTenantRuntimeReadiness | undefined;
  #abortController: AbortController | undefined;
  #dispatcherLoop: Promise<void> | undefined;
  #queueStarted = false;
  #registrations: QueueWorkRegistration[] = [];
  #startPromise: Promise<void> | undefined;
  #state: WorkerLifecycleState = "created";
  #stopPromise: Promise<void> | undefined;

  constructor(input: {
    closeTenantRuntime?: () => Promise<void>;
    dispatcher?: OutboxDispatcher;
    observability: WorkerRuntimeObservability;
    queue: QueueInfrastructure;
    random?: () => number;
    registry: WorkerHandlerRegistry;
    sleeper?: Sleeper;
    tenantEvents?: TenantCanonicalEventSourcePort;
    tenantRuntime?: WorkerTenantRuntimeReadiness;
  }) {
    if (
      input.registry.registrations.length > 0 &&
      (input.dispatcher === undefined ||
        input.tenantEvents === undefined ||
        input.tenantRuntime === undefined)
    ) {
      throw new WorkerLifecycleError();
    }
    this.#closeTenantRuntime = input.closeTenantRuntime;
    this.#dispatcher = input.dispatcher;
    this.#observability = input.observability;
    this.#queue = input.queue;
    this.#random = input.random ?? Math.random;
    this.#registry = input.registry;
    this.#sleeper = input.sleeper ?? defaultSleeper;
    this.#tenantEvents = input.tenantEvents;
    this.#tenantRuntime = input.tenantRuntime;
  }

  readiness(): WorkerReadiness {
    return Object.freeze({
      activeHandlerCount: this.#registry.registrations.length,
      activeQueueCount: this.#registry.activeQueues.length,
      activeRouteCount: this.#registry.activeRoutes.length,
      ready: this.#state === "ready",
      state: this.#state,
    });
  }

  start(): Promise<void> {
    if (this.#state === "starting" && this.#startPromise !== undefined) return this.#startPromise;
    if (this.#state === "ready") return Promise.resolve();
    if (this.#state !== "created") return Promise.reject(new WorkerLifecycleError());

    this.#state = "starting";
    this.#startPromise = this.#startInternal();
    return this.#startPromise;
  }

  stop(): Promise<void> {
    if (this.#stopPromise !== undefined) return this.#stopPromise;
    if (this.#state === "stopped") return Promise.resolve();
    this.#stopPromise = this.#stopInternal();
    return this.#stopPromise;
  }

  async #startInternal(): Promise<void> {
    try {
      await this.#queue.start();
      this.#queueStarted = true;
      await this.#tenantRuntime?.verifyReady();
      if (this.#tenantEvents !== undefined) {
        const executor = createWorkerJobExecutor({
          random: this.#random,
          registry: this.#registry,
          reliability: this.#queue,
          tenantEvents: this.#tenantEvents,
        });
        for (const queue of this.#registry.activeQueues) {
          this.#registrations.push(
            await this.#queue.registerWorker(queue, (job) => executor.execute(job)),
          );
        }
      }
      this.#abortController = new AbortController();
      if (this.#dispatcher !== undefined) {
        this.#dispatcherLoop = this.#runDispatcherLoop(this.#abortController.signal);
      }
      this.#state = "ready";
    } catch (error) {
      this.#state = "failed";
      await this.#cleanup();
      throw error;
    }
  }

  async #stopInternal(): Promise<void> {
    if (this.#state === "created") {
      this.#state = "stopped";
      return;
    }
    if (this.#state === "starting" && this.#startPromise !== undefined) {
      try {
        await this.#startPromise;
      } catch {
        return;
      }
    }
    if (this.#state === "failed") return;
    this.#state = "stopping";
    await this.#cleanup();
    this.#state = "stopped";
  }

  async #runDispatcherLoop(signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      try {
        await this.#dispatcher?.dispatchOnce(this.#registry.activeRoutes);
      } catch (error) {
        this.#observability.onDispatcherError(error);
      }
      if (signal.aborted) return;
      const random = this.#random();
      const boundedRandom = Number.isFinite(random) ? Math.min(Math.max(random, 0), 1) : 0;
      const jitter = Math.min(
        WORKER_DISPATCH_JITTER_MAX_MILLISECONDS,
        Math.floor(boundedRandom * (WORKER_DISPATCH_JITTER_MAX_MILLISECONDS + 1)),
      );
      await this.#sleeper(WORKER_DISPATCH_POLL_MILLISECONDS + jitter, signal);
    }
  }

  async #cleanup(): Promise<void> {
    this.#abortController?.abort();
    await this.#dispatcherLoop;
    this.#dispatcherLoop = undefined;
    this.#abortController = undefined;

    let firstError: Error | undefined;
    for (const registration of this.#registrations.reverse()) {
      try {
        await this.#queue.stopWorker(registration);
      } catch (error) {
        firstError ??= asError(error);
      }
    }
    this.#registrations = [];
    if (this.#queueStarted) {
      try {
        await this.#queue.stop();
      } catch (error) {
        firstError ??= asError(error);
      }
      this.#queueStarted = false;
    }
    if (this.#closeTenantRuntime !== undefined) {
      try {
        await this.#closeTenantRuntime();
      } catch (error) {
        firstError ??= asError(error);
      }
    }
    if (firstError !== undefined) throw firstError;
  }
}

export const createWorkerRuntime = (input: {
  closeTenantRuntime?: () => Promise<void>;
  dispatcher?: OutboxDispatcher;
  observability: WorkerRuntimeObservability;
  queue: QueueInfrastructure;
  random?: () => number;
  registry: WorkerHandlerRegistry;
  sleeper?: Sleeper;
  tenantEvents?: TenantCanonicalEventSourcePort;
  tenantRuntime?: WorkerTenantRuntimeReadiness;
}): WorkerRuntime => new WorkerRuntimeImplementation(input);
