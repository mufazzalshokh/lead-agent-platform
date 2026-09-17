// Private evaluation diagnostics. Never return/log an HTTP body, message, ID, header or credential.
export interface HTTPDiagnostic {
  readonly status: number;
  readonly code: string | null;
  readonly category: string | null;
}
const CODES = new Set([
  "credit_balance_exhausted",
  "organization_spend_limit_exceeded",
  "project_spend_limit_exceeded",
  "organization_usage_limit_exceeded",
  "insufficient_quota",
  "rate_limit_exceeded",
  "slow_down",
  "RESOURCE_EXHAUSTED",
  "RATE_LIMIT_EXCEEDED",
  "UNAVAILABLE",
  "INTERNAL",
  "DEADLINE_EXCEEDED",
]);
const CATEGORIES = new Set([
  "insufficient_quota",
  "rate_limit_error",
  "invalid_request_error",
  "authentication_error",
  "server_error",
  "RESOURCE_EXHAUSTED",
  "UNAVAILABLE",
  "INTERNAL",
  "DEADLINE_EXCEEDED",
]);
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const allowed = (value: unknown, values: ReadonlySet<string>) =>
  typeof value === "string" ? (values.has(value) ? value : "unrecognized") : null;
export const diagnosticFetch =
  (request: typeof fetch, onError: (value: HTTPDiagnostic) => void): typeof fetch =>
  async (url, options) => {
    if (
      url !== "https://api.openai.com/v1/responses" &&
      url !==
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent"
    )
      throw new TypeError("Unexpected diagnostic transport");
    const response = await request(url, options);
    if (response.ok) return response;
    let code: string | null = null,
      category: string | null = null;
    // Consume the original error stream (not a tee/clone); then give the adapter an empty equivalent error.
    const reader = response.body?.getReader();
    if (reader !== undefined) {
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          const part: ReadableStreamReadResult<unknown> = await reader.read();
          if (part.done) break;
          if (!(part.value instanceof Uint8Array)) {
            await reader.cancel();
            break;
          }
          size += part.value.byteLength;
          if (size > 16384) {
            await reader.cancel();
            chunks.length = 0;
            break;
          }
          chunks.push(part.value);
        }
        const value: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        if (record(value) && record(value["error"])) {
          code = allowed(value["error"]["code"], CODES);
          category = allowed(value["error"]["type"] ?? value["error"]["status"], CATEGORIES);
          const details: unknown = value["error"]["details"];
          if (
            Array.isArray(details) &&
            details
              .slice(0, 8)
              .some((entry: unknown) => record(entry) && entry["reason"] === "RATE_LIMIT_EXCEEDED")
          )
            code = "RATE_LIMIT_EXCEEDED";
        }
      } catch {
        /* Diagnostic parse/stream failure cannot alter the original HTTP status. */
      } finally {
        reader.releaseLock();
      }
    }
    onError({ status: response.status, code, category });
    return new Response(null, { status: response.status, headers: response.headers });
  };
import type { ReadableStreamReadResult } from "node:stream/web";
