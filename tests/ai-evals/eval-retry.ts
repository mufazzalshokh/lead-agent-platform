import type { AIProviderResult, AIUsage } from "@lead-agent/application";
import type { ScreenModel, ScreenPhase } from "./screen.js";
import type { TransportDiagnostic } from "./network-diagnostic.js";
import type { HTTPDiagnostic } from "./http-diagnostic.js";

export interface EvalAttempt {
  readonly model: ScreenModel;
  readonly caseId: string;
  readonly phase: ScreenPhase;
  readonly hint: boolean;
  readonly attemptNumber: 1 | 2;
  readonly purpose: "initial" | "schema_repair" | "transient_retry" | "owner_resume";
  readonly resultKind: AIProviderResult["kind"];
  readonly category: string | null;
  readonly transport: TransportDiagnostic | null;
  readonly http: HTTPDiagnostic | null;
  readonly aborted: boolean | null;
  readonly elapsedMs: number | null;
  readonly backoffMs: number | null;
  readonly retrySucceeded: boolean | null;
  readonly usage: AIUsage;
  readonly billableCostUSD: string | null;
  readonly unresolvedReservationUSD: string | null;
  readonly source: "historical" | "current";
}
export interface RetryHooks {
  readonly resetDiagnostics: (model: ScreenModel) => void;
  readonly diagnostics: (model: ScreenModel) => Readonly<{
    transport: TransportDiagnostic | null;
    http: HTTPDiagnostic | null;
  }>;
  readonly sleep?: (milliseconds: number) => Promise<void>;
  readonly random?: () => number;
}
export const attemptKey = (attempt: Pick<EvalAttempt, "model" | "caseId" | "phase" | "hint">) =>
  `${attempt.model}:${attempt.phase}:${attempt.caseId}:${attempt.hint ? "B" : "A"}`;

/** Fixed eligibility only. Unknown errors and ambiguous 429s never qualify. */
export const retryDelay = (
  result: AIProviderResult,
  transport: TransportDiagnostic | null,
  http: HTTPDiagnostic | null,
  random = Math.random,
): number | null => {
  let eligible = result.kind === "timeout";
  if (result.kind === "provider_error") {
    if (result.category === "authentication") return null;
    eligible =
      result.category === "network" &&
      transport !== null &&
      ((transport.classification === "DNS" && transport.codes.includes("EAI_AGAIN")) ||
        transport.classification === "TCP_CONNECT" ||
        transport.classification === "SOCKET_RESET" ||
        transport.classification === "CLIENT_TIMEOUT");
    if (http?.status === 408 || (http !== null && [500, 502, 503, 504].includes(http.status)))
      eligible = true;
    if (http?.status === 429) {
      const billing =
        http.category === "insufficient_quota" ||
        (http.code !== null &&
          [
            "insufficient_quota",
            "credit_balance_exhausted",
            "organization_spend_limit_exceeded",
            "project_spend_limit_exceeded",
            "organization_usage_limit_exceeded",
          ].includes(http.code));
      eligible =
        !billing &&
        (http.code === "rate_limit_exceeded" ||
          http.code === "slow_down" ||
          http.code === "RATE_LIMIT_EXCEEDED" ||
          http.category === "rate_limit_error") &&
        result.retryAfterMs !== null &&
        result.retryAfterMs >= 0 &&
        result.retryAfterMs <= 30000;
    }
  }
  if (!eligible) return null;
  const jitter = jitterDelay(random);
  return result.kind === "provider_error" && http?.status === 429
    ? Math.max(jitter, result.retryAfterMs ?? jitter)
    : jitter;
};
export const jitterDelay = (random = Math.random) => {
  const value = random();
  if (!Number.isFinite(value) || value < 0 || value > 1)
    throw new TypeError("Invalid retry jitter");
  return 1000 + Math.floor(value * 1000);
};
export const waitForRecovery = (milliseconds: number, hooks: RetryHooks) =>
  (hooks.sleep ?? ((delay) => new Promise<void>((resolve) => setTimeout(resolve, delay))))(
    milliseconds,
  );

/** Three distinct decisions sharing one classified cause is a conservative circuit stop. */
export const recurringTransportFailure = (attempts: readonly EvalAttempt[]) => {
  const failures = new Map<string, Set<string>>();
  for (const attempt of attempts) {
    const classification =
      attempt.transport?.classification ??
      (attempt.resultKind === "timeout" ? "CLIENT_TIMEOUT" : null);
    if (
      classification === null ||
      classification === "UNKNOWN_NETWORK" ||
      classification === "ABORT"
    )
      continue;
    const key = `${classification}:${attempt.transport?.causeCode ?? "unavailable"}`;
    const cases = failures.get(key) ?? new Set<string>();
    cases.add(attemptKey(attempt));
    failures.set(key, cases);
    if (cases.size >= 3) return true;
  }
  return false;
};
