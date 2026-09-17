// Evaluation-only, allowlisted metadata. Never inspect error messages, requests or headers.
export type TransportClassification =
  "CLIENT_TIMEOUT" | "ABORT" | "DNS" | "TCP_CONNECT" | "TLS" | "SOCKET_RESET" | "UNKNOWN_NETWORK";
export interface TransportDiagnostic {
  readonly errorClass: string | null;
  readonly causeCode: string | null;
  readonly causeName: string | null;
  readonly codes: readonly string[];
  readonly classification: TransportClassification;
  readonly signalAborted: boolean;
  readonly signalReasonName: string | null;
  readonly elapsedMs: number;
}
const NAMES = new Set([
  "Error",
  "TypeError",
  "AggregateError",
  "DOMException",
  "AbortError",
  "TimeoutError",
  "ConnectTimeoutError",
  "HeadersTimeoutError",
  "BodyTimeoutError",
  "SocketError",
]);
const DNS = new Set(["ENOTFOUND", "EAI_AGAIN", "EAI_FAIL", "EAI_NODATA"]);
const CONNECT = new Set(["ECONNREFUSED", "ENETUNREACH", "EHOSTUNREACH", "UND_ERR_CONNECT_TIMEOUT"]);
const TLS = new Set([
  "CERT_HAS_EXPIRED",
  "CERT_NOT_YET_VALID",
  "CERT_UNTRUSTED",
  "CERT_REJECTED",
  "CERT_CHAIN_TOO_LONG",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "UNABLE_TO_GET_ISSUER_CERT",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "ERR_TLS_CERT_ALTNAME_INVALID",
  "ERR_TLS_CERT_SIGNATURE_ALGORITHM_UNSUPPORTED",
  "ERR_SSL_TLSV1_ALERT_PROTOCOL_VERSION",
  "ERR_SSL_WRONG_VERSION_NUMBER",
]);
const SOCKET = new Set(["ECONNRESET", "EPIPE", "UND_ERR_SOCKET"]);
const TIMEOUT = new Set(["UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT"]);
const CODES = new Set([
  ...DNS,
  ...CONNECT,
  ...TLS,
  ...SOCKET,
  ...TIMEOUT,
  "ETIMEDOUT",
  "ABORT_ERR",
]);
const object = (value: unknown): value is object => typeof value === "object" && value !== null;
// Read data descriptors only, with bounded prototype traversal. Never execute an error getter.
const property = (value: unknown, key: string): unknown => {
  let current: unknown = value;
  try {
    for (let depth = 0; depth < 4 && object(current); depth++) {
      const descriptor = Object.getOwnPropertyDescriptor(current, key);
      if (descriptor !== undefined) {
        const result: unknown = descriptor.value;
        return result;
      }
      current = Object.getPrototypeOf(current);
    }
  } catch {
    // Uninspectable diagnostic metadata is unknown; the original transport error is still rethrown.
  }
  return undefined;
};
const allowed = (value: unknown, values: ReadonlySet<string>) =>
  typeof value === "string" && values.has(value) ? value : null;
const errorName = (value: unknown): string | null => {
  try {
    // Node's TimeoutError/AbortError are DOMExceptions with a native name accessor.
    // Call only that known native accessor, never an arbitrary error getter.
    if (value instanceof DOMException) {
      const name: unknown = Reflect.get(DOMException.prototype, "name", value);
      return allowed(name, NAMES);
    }
  } catch {
    return null;
  }
  return allowed(property(value, "name"), NAMES);
};
export const classifyTransportFailure = (
  error: unknown,
  signal: AbortSignal | null,
  elapsedMs: number,
): TransportDiagnostic => {
  const cause = property(error, "cause"),
    codes = new Set<string>();
  const queue: unknown[] = [error],
    seen = new Set<object>();
  let connectTimeout = false;
  for (let visited = 0; visited < 8 && queue.length > 0; visited++) {
    const current = queue.shift();
    if (!object(current) || seen.has(current)) continue;
    seen.add(current);
    const code = allowed(property(current, "code"), CODES);
    if (code !== null) codes.add(code);
    if (code === "ETIMEDOUT" && property(current, "syscall") === "connect") connectTimeout = true;
    const nested = property(current, "cause"),
      errors = property(current, "errors");
    if (object(nested) && queue.length < 8) queue.push(nested);
    if (Array.isArray(errors)) {
      const entries: readonly unknown[] = errors;
      queue.push(...entries.slice(0, Math.max(0, 8 - queue.length)));
    }
  }
  const errorClass = errorName(error);
  const signalAborted = signal?.aborted ?? false;
  const signalReasonName = signalAborted ? errorName(signal?.reason) : null;
  const has = (set: ReadonlySet<string>) => [...codes].some((code) => set.has(code));
  const classification: TransportClassification = signalAborted
    ? signalReasonName === "TimeoutError"
      ? "CLIENT_TIMEOUT"
      : "ABORT"
    : errorClass === "TimeoutError" || has(TIMEOUT)
      ? "CLIENT_TIMEOUT"
      : errorClass === "AbortError" || codes.has("ABORT_ERR")
        ? "ABORT"
        : has(DNS)
          ? "DNS"
          : has(TLS)
            ? "TLS"
            : has(CONNECT) || connectTimeout
              ? "TCP_CONNECT"
              : has(SOCKET)
                ? "SOCKET_RESET"
                : "UNKNOWN_NETWORK";
  return Object.freeze({
    errorClass,
    causeCode: allowed(property(cause, "code"), CODES),
    causeName: errorName(cause),
    codes: Object.freeze([...codes]),
    classification,
    signalAborted,
    signalReasonName,
    elapsedMs: Number.isFinite(elapsedMs)
      ? Math.max(0, Math.min(120000, Math.floor(elapsedMs)))
      : 0,
  });
};
/** Observe only a thrown fetch failure, then rethrow that exact error. No retries/body reads. */
export const transportDiagnosticFetch =
  (
    request: typeof fetch,
    onFailure: (value: TransportDiagnostic) => void,
    clock: () => number = () => performance.now(),
  ): typeof fetch =>
  async (url, options) => {
    const started = clock();
    try {
      return await request(url, options);
    } catch (error) {
      onFailure(classifyTransportFailure(error, options?.signal ?? null, clock() - started));
      throw error;
    }
  };
