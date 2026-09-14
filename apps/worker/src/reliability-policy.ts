export const WORKER_FAILURE_CATEGORIES = Object.freeze([
  "RETRYABLE_INFRASTRUCTURE",
  "RATE_LIMITED",
  "PERMANENT_VALIDATION",
  "UNSUPPORTED_VERSION",
  "TENANT_INTEGRITY",
  "PERMANENT_BUSINESS",
  "AMBIGUOUS_EXTERNAL_EFFECT",
] as const);

export type WorkerFailureCategory = (typeof WORKER_FAILURE_CATEGORIES)[number];

export const WORKER_MAX_EXECUTIONS = 5;
export const WORKER_INITIAL_RETRY_SECONDS = 5;
export const WORKER_MAX_RETRY_SECONDS = 300;
export const WORKER_MAX_GENERIC_AGE_MILLISECONDS = 24 * 60 * 60 * 1_000;
export const WORKER_ACTIVE_EXPIRATION_SECONDS = 15 * 60;
export const WORKER_HEARTBEAT_SECONDS = 60;
export const WORKER_HEARTBEAT_REFRESH_SECONDS = WORKER_HEARTBEAT_SECONDS / 2;

export type WorkerFailureOptions = Readonly<{
  businessDeadline?: Date;
  retryAfterMilliseconds?: unknown;
}>;

export class WorkerExecutionFailure extends Error {
  readonly category: WorkerFailureCategory;
  readonly businessDeadline: Date | undefined;
  readonly retryAfterMilliseconds: number | undefined;

  constructor(category: WorkerFailureCategory, options: WorkerFailureOptions = {}) {
    super("Worker execution failed");
    this.name = "WorkerExecutionFailure";
    this.category = category;
    this.businessDeadline =
      options.businessDeadline instanceof Date &&
      Number.isFinite(options.businessDeadline.getTime())
        ? new Date(options.businessDeadline)
        : undefined;
    this.retryAfterMilliseconds =
      typeof options.retryAfterMilliseconds === "number" &&
      Number.isFinite(options.retryAfterMilliseconds) &&
      options.retryAfterMilliseconds >= 0
        ? options.retryAfterMilliseconds
        : undefined;
  }
}

export const classifyHandlerFailure = (error: unknown): WorkerExecutionFailure =>
  error instanceof WorkerExecutionFailure
    ? error
    : new WorkerExecutionFailure("AMBIGUOUS_EXTERNAL_EFFECT");

export type WorkerRetryDecision =
  | Readonly<{ kind: "dead_letter"; category: WorkerFailureCategory }>
  | Readonly<{
      category: WorkerFailureCategory;
      delaySeconds: number;
      kind: "reconcile" | "retry";
    }>;

const ZERO_RETRY_CATEGORIES: ReadonlySet<WorkerFailureCategory> = new Set([
  "PERMANENT_VALIDATION",
  "UNSUPPORTED_VERSION",
  "TENANT_INTEGRITY",
  "PERMANENT_BUSINESS",
]);

const boundedRandom = (random: () => number): number => {
  const value = random();
  if (!Number.isFinite(value)) return 0;
  return Math.min(Math.max(value, 0), 1 - Number.EPSILON);
};

export const fullJitterCapSeconds = (retryIndex: number): number => {
  if (!Number.isSafeInteger(retryIndex) || retryIndex < 0) return 0;
  return Math.min(
    WORKER_MAX_RETRY_SECONDS,
    WORKER_INITIAL_RETRY_SECONDS * 2 ** Math.min(retryIndex, 30),
  );
};

export const sampleFullJitterSeconds = (retryIndex: number, random: () => number): number => {
  const cap = fullJitterCapSeconds(retryIndex);
  return Math.floor(boundedRandom(random) * (cap + 1));
};

export const decideWorkerRetry = (
  input: Readonly<{
    createdAt: Date;
    executionNumber: number;
    failure: WorkerExecutionFailure;
    now: Date;
    random: () => number;
  }>,
): WorkerRetryDecision => {
  const { category } = input.failure;
  if (
    !Number.isSafeInteger(input.executionNumber) ||
    input.executionNumber < 1 ||
    input.executionNumber >= WORKER_MAX_EXECUTIONS ||
    !Number.isFinite(input.createdAt.getTime()) ||
    !Number.isFinite(input.now.getTime()) ||
    ZERO_RETRY_CATEGORIES.has(category)
  ) {
    return Object.freeze({ category, kind: "dead_letter" });
  }

  const genericDeadline = input.createdAt.getTime() + WORKER_MAX_GENERIC_AGE_MILLISECONDS;
  const businessDeadline = input.failure.businessDeadline?.getTime() ?? Number.POSITIVE_INFINITY;
  const deadline = Math.min(genericDeadline, businessDeadline);
  if (input.now.getTime() >= deadline) {
    return Object.freeze({ category, kind: "dead_letter" });
  }

  const retryIndex = input.executionNumber - 1;
  let delaySeconds = sampleFullJitterSeconds(retryIndex, input.random);
  if (category === "RATE_LIMITED" && input.failure.retryAfterMilliseconds !== undefined) {
    const retryAfterSeconds = Math.ceil(input.failure.retryAfterMilliseconds / 1_000);
    if (
      retryAfterSeconds > WORKER_MAX_RETRY_SECONDS ||
      input.now.getTime() + input.failure.retryAfterMilliseconds > deadline
    ) {
      return Object.freeze({ category, kind: "dead_letter" });
    }
    delaySeconds = retryAfterSeconds;
  }

  if (input.now.getTime() + delaySeconds * 1_000 > deadline) {
    return Object.freeze({ category, kind: "dead_letter" });
  }
  return Object.freeze({
    category,
    delaySeconds,
    kind: category === "AMBIGUOUS_EXTERNAL_EFFECT" ? "reconcile" : "retry",
  });
};
