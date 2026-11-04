import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

/** @param {unknown} value @returns {Record<string, unknown> | undefined} */
const object = (value) =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? /** @type {Record<string, unknown>} */ (value)
    : undefined;
/** @param {unknown} value @param {readonly string[]} allowed */
const finite = (value, allowed) =>
  typeof value === "string" && allowed.includes(value) ? value : null;
/** @param {unknown} value @param {RegExp} pattern */
const matched = (value, pattern) =>
  typeof value === "string" && pattern.test(value) ? value : null;
/** @param {unknown} value */
const numeric = (value) =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;

/** Project only approved diagnostic fields; never emit raw logs or error messages.
 * @param {unknown} logs @param {string} requestId
 */
export const instagramCallbackEvidence = (logs, requestId) => {
  if (!/^req-[A-Za-z0-9_-]{1,64}$/u.test(requestId) || !Array.isArray(logs))
    throw new Error("S22I201_INVALID_DIAGNOSTIC_INPUT");
  const entries = [];
  for (const raw of logs) {
    const entry = object(raw);
    const payload = object(entry?.jsonPayload);
    const labels = object(object(entry?.resource)?.labels);
    if (labels?.service_name !== "lead-agent-staging-api" || payload?.requestId !== requestId)
      continue;
    const provider = object(payload.providerDiagnostic);
    entries.push({
      request_id: requestId,
      revision: matched(labels.revision_name, /^lead-agent-staging-api-[a-z0-9-]+$/u),
      timestamp: matched(entry?.timestamp, /^\d{4}-\d{2}-\d{2}T[0-9:.]+Z$/u),
      failure: finite(payload.instagramCallbackFailure, [
        "provider",
        "application",
        "unexpected",
        "unclassified",
        "provider_authorization_denied",
      ]),
      stage: finite(payload.instagramCallbackStage, [
        "state_validation",
        "code_exchange",
        "message_subscription",
        "credential_storage",
        "activation",
      ]),
      application_code: finite(payload.applicationCode, [
        "business_rule_failed",
        "channel_unavailable",
        "permission_denied",
        "validation_failed",
      ]),
      provider_category: finite(payload.providerCategory, [
        "authentication_failed",
        "rate_limited",
        "provider_unavailable",
        "permanent_rejection",
        "unsupported_content",
      ]),
      provider_operation: finite(provider?.operation, [
        "short_token",
        "long_token",
        "profile",
        "subscription",
        "refresh",
        "send",
      ]),
      provider_reason: finite(provider?.reason, [
        "http_rejection",
        "invalid_json",
        "invalid_response",
        "network",
        "oversized_response",
      ]),
      invalid_field: finite(provider?.invalidField, [
        "response_shape",
        "access_token",
        "user_id",
        "expires_in",
        "token_type",
        "account_type",
        "success",
      ]),
      provider_http_status: numeric(provider?.httpStatus),
      provider_code: numeric(provider?.providerCode),
      provider_subcode: numeric(provider?.providerSubcode),
      database_code: matched(payload.databaseCode, /^[0-9A-Z]{5}$/u),
    });
  }
  if (entries.length === 0) throw new Error("S22I202_REQUEST_DIAGNOSTIC_NOT_FOUND");
  return {
    diagnostic: "instagram_callback",
    request_id: requestId,
    entries,
    secret_payloads_read: false,
  };
};

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [path, requestId] = process.argv.slice(2);
  if (path === undefined || requestId === undefined)
    throw new Error("S22I201_INVALID_DIAGNOSTIC_INPUT");
  console.log(
    JSON.stringify(instagramCallbackEvidence(JSON.parse(await readFile(path, "utf8")), requestId)),
  );
}
