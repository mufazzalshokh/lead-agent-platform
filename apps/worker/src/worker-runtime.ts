import type { WorkerHandlerRegistry } from "./handler-registry.js";
import { createWorkerJobExecutor } from "./job-executor.js";
import type { OutboxDispatcher, TenantCanonicalEventSourcePort } from "./outbox-dispatcher.js";
import type { QueueInfrastructure, QueueWorkRegistration } from "./queue-infrastructure.js";
import {
  WORKER_OPERATIONS_POLL_MILLISECONDS,
  collectWorkerOperationalMetrics,
  type WorkerOutboxBacklogProbe,
  type WorkerQueueDepthProbe,
} from "./worker-operations.js";
import {
  NOOP_WORKER_TELEMETRY,
  createSafeWorkerTelemetry,
  type WorkerTelemetry,
} from "./worker-telemetry.js";

export const WORKER_DISPATCH_POLL_MILLISECONDS = 1_000;
export const WORKER_DISPATCH_JITTER_MAX_MILLISECONDS = 250;
export const WORKER_SHUTDOWN_DRAIN_MILLISECONDS = 25_000;
export const WORKER_TELEMETRY_FLUSH_MILLISECONDS = 1_000;
export const WORKER_QUEUE_RECOVERY_STOP_MILLISECONDS = 1_000;

export type WorkerLifecycleState =
  "created" | "starting" | "ready" | "stopping" | "stopped" | "failed";

export type WorkerLiveness = Readonly<{ live: true }>;

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
  liveness: () => WorkerLiveness;
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
type DrainResult = "drained" | "timed_out";
type DrainWaiter = (
  pending: readonly Promise<void>[],
  timeoutMilliseconds: number,
) => Promise<DrainResult>;

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

const defaultDrainWaiter: DrainWaiter = async (
  pending,
  timeoutMilliseconds,
): Promise<DrainResult> => {
  if (pending.length === 0) return "drained";
  return new Promise<DrainResult>((resolve) => {
    let settled = false;
    const finish = (result: DrainResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => finish("timed_out"), timeoutMilliseconds);
    void Promise.allSettled(pending).then(() => finish("drained"));
  });
};

const waitAtMost = async (operation: Promise<void>, timeoutMilliseconds: number): Promise<void> => {
  await new Promise<void>((resolve) => {
    let settled = false;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(finish, timeoutMilliseconds);
    void operation.then(finish, finish);
  });
};

class WorkerRuntimeImplementation implements WorkerRuntime {
  readonly #closeTenantRuntime: (() => Promise<void>) | undefined;
  readonly #dispatcher: OutboxDispatcher | undefined;
  readonly #drainWaiter: DrainWaiter;
  readonly #observability: WorkerRuntimeObservability;
  readonly #outboxBacklog: WorkerOutboxBacklogProbe | undefined;
  readonly #queue: QueueInfrastructure;
  readonly #random: () => number;
  readonly #registry: WorkerHandlerRegistry;
  readonly #sleeper: Sleeper;
  readonly #telemetry: WorkerTelemetry;
  readonly #tenantEvents: TenantCanonicalEventSourcePort | undefined;
  readonly #tenantRuntime: WorkerTenantRuntimeReadiness | undefined;
  #abortController: AbortController | undefined;
  #dispatcherLoop: Promise<void> | undefined;
  #operationsLoop: Promise<void> | undefined;
  #queueStarted = false;
  #registrations: QueueWorkRegistration[] = [];
  #startPromise: Promise<void> | undefined;
  #state: WorkerLifecycleState = "created";
  #stopPromise: Promise<void> | undefined;

  constructor(input: {
    closeTenantRuntime?: () => Promise<void>;
    dispatcher?: OutboxDispatcher;
    drainWaiter?: DrainWaiter;
    observability: WorkerRuntimeObservability;
    outboxBacklog?: WorkerOutboxBacklogProbe;
    queue: QueueInfrastructure;
    random?: () => number;
    registry: WorkerHandlerRegistry;
    sleeper?: Sleeper;
    telemetry?: WorkerTelemetry;
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
    this.#drainWaiter = input.drainWaiter ?? defaultDrainWaiter;
    this.#observability = input.observability;
    this.#outboxBacklog = input.outboxBacklog;
    this.#queue = input.queue;
    this.#random = input.random ?? Math.random;
    this.#registry = input.registry;
    this.#sleeper = input.sleeper ?? defaultSleeper;
    this.#telemetry = createSafeWorkerTelemetry(input.telemetry ?? NOOP_WORKER_TELEMETRY);
    this.#tenantEvents = input.tenantEvents;
    this.#tenantRuntime = input.tenantRuntime;
  }

  liveness(): WorkerLiveness {
    return Object.freeze({ live: true });
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

    this.#setState("starting");
    this.#startPromise = this.#startInternal();
    return this.#startPromise;
  }

  stop(): Promise<void> {
    if (this.#stopPromise !== undefined) return this.#stopPromise;
    if (this.#state === "stopped") return Promise.resolve();
    this.#stopPromise = this.#stopInternal();
    return this.#stopPromise;
  }

  #setState(state: WorkerLifecycleState): void {
    this.#state = state;
    this.#telemetry.metric({
      labels: { state },
      name: "worker.readiness",
      value: state === "ready" ? 1 : 0,
    });
    this.#telemetry.log({
      attributes: { state },
      event: "worker.lifecycle.changed",
      severity: state === "failed" ? "error" : "info",
    });
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
          telemetry: this.#telemetry,
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
      if (this.#outboxBacklog !== undefined || this.#queue.observeQueueDepths !== undefined) {
        this.#operationsLoop = this.#runOperationsLoop(this.#abortController.signal);
      }
      this.#setState("ready");
    } catch (error) {
      this.#setState("failed");
      await this.#cleanup();
      throw error;
    }
  }

  async #stopInternal(): Promise<void> {
    if (this.#state === "created") {
      this.#setState("stopped");
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
    this.#setState("stopping");
    try {
      await this.#cleanup();
      this.#setState("stopped");
    } catch (error) {
      this.#setState("failed");
      throw error;
    }
  }

  async #runDispatcherLoop(signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      try {
        await this.#dispatcher?.dispatchOnce(this.#registry.activeRoutes, signal);
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

  async #runOperationsLoop(signal: AbortSignal): Promise<void> {
    const observeQueueDepths = this.#queue.observeQueueDepths;
    const queueProbe: WorkerQueueDepthProbe | undefined =
      observeQueueDepths === undefined ? undefined : { observeQueueDepths };
    while (!signal.aborted) {
      await collectWorkerOperationalMetrics({
        activeQueues: this.#registry.activeQueues,
        activeRoutes: this.#registry.activeRoutes,
        ...(this.#outboxBacklog === undefined ? {} : { outbox: this.#outboxBacklog }),
        ...(queueProbe === undefined ? {} : { queue: queueProbe }),
        telemetry: this.#telemetry,
      });
      if (signal.aborted) return;
      await this.#sleeper(WORKER_OPERATIONS_POLL_MILLISECONDS, signal);
    }
  }

  async #cleanup(): Promise<void> {
    this.#abortController?.abort();

    let firstError: Error | undefined;
    const guard = async (operation: Promise<void>): Promise<void> => {
      try {
        await operation;
      } catch (error) {
        firstError ??= asError(error);
      }
    };
    const drainOperations: Promise<void>[] = [];
    if (this.#dispatcherLoop !== undefined) drainOperations.push(guard(this.#dispatcherLoop));
    if (this.#operationsLoop !== undefined) drainOperations.push(guard(this.#operationsLoop));
    for (const registration of [...this.#registrations].reverse()) {
      drainOperations.push(guard(this.#queue.stopWorker(registration, { waitForActive: true })));
    }
    const drainResult = await this.#drainWaiter(
      drainOperations,
      WORKER_SHUTDOWN_DRAIN_MILLISECONDS,
    );
    if (drainResult === "timed_out") {
      this.#telemetry.metric({
        labels: { outcome: "timed_out" },
        name: "worker.shutdown.drain_timeout_total",
        value: 1,
      });
      this.#telemetry.log({
        attributes: {},
        event: "worker.shutdown.drain_timed_out",
        severity: "warn",
      });
    }

    this.#dispatcherLoop = undefined;
    this.#operationsLoop = undefined;
    this.#abortController = undefined;
    this.#registrations = [];

    await waitAtMost(this.#telemetry.flush(), WORKER_TELEMETRY_FLUSH_MILLISECONDS);
    if (this.#queueStarted) {
      try {
        await this.#queue.stop({
          recoveryTimeoutMilliseconds: WORKER_QUEUE_RECOVERY_STOP_MILLISECONDS,
          unfinishedWork: "fail_for_retry",
        });
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
  drainWaiter?: DrainWaiter;
  observability: WorkerRuntimeObservability;
  outboxBacklog?: WorkerOutboxBacklogProbe;
  queue: QueueInfrastructure;
  random?: () => number;
  registry: WorkerHandlerRegistry;
  sleeper?: Sleeper;
  telemetry?: WorkerTelemetry;
  tenantEvents?: TenantCanonicalEventSourcePort;
  tenantRuntime?: WorkerTenantRuntimeReadiness;
}): WorkerRuntime => new WorkerRuntimeImplementation(input);
