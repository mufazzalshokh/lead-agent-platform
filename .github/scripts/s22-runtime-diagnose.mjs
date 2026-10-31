import { readFile } from "node:fs/promises";

const [revisionPath, logsPath, loggingExitCode = "unavailable"] = process.argv.slice(2);
if (revisionPath === undefined || logsPath === undefined) {
  throw new TypeError("usage: s22-runtime-diagnose.mjs <revision-json> <logs-json> [logging-exit]");
}

const object = (value) =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? value : undefined;

const safeText = (value) =>
  String(value ?? "unavailable")
    .replace(/postgres(?:ql)?:\/\/[^\s"'<>]+/giu, "postgresql://[REDACTED]")
    .replace(/Bearer\s+[^\s"'<>]+/giu, "Bearer [REDACTED]")
    .replace(
      /((?:password|token|secret|authorization|api[_-]?key|database[_-]?url)\s*[:=]\s*)[^\s,;"'<>]+/giu,
      "$1[REDACTED]",
    )
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/gu, "[REDACTED_IP]")
    .slice(0, 2_000);

const revision = object(JSON.parse(await readFile(revisionPath, "utf8"))) ?? {};
const status = object(revision.status) ?? {};
const conditions = Array.isArray(status.conditions) ? status.conditions : [];
const readyCondition = conditions.find((candidate) => object(candidate)?.type === "Ready");
const ready = object(readyCondition) ?? {};
const metadata = object(revision.metadata) ?? {};

let logEntries = [];
try {
  const parsed = JSON.parse(await readFile(logsPath, "utf8"));
  if (Array.isArray(parsed)) logEntries = parsed;
} catch {
  logEntries = [];
}

const messages = [];
const seen = new Set();
for (const entryValue of logEntries) {
  const entry = object(entryValue);
  if (entry === undefined) continue;
  const jsonPayload = object(entry.jsonPayload);
  const message = entry.textPayload ?? jsonPayload?.message;
  if (typeof message !== "string" || message.trim() === "") continue;
  const sanitized = safeText(message);
  if (seen.has(sanitized)) continue;
  seen.add(sanitized);
  messages.push({
    message: sanitized,
    severity: safeText(entry.severity ?? "unavailable"),
  });
  if (messages.length >= 20) break;
}

console.log(
  JSON.stringify({
    diagnostic: "s22_api_revision_startup",
    logging_access: loggingExitCode === "0" ? "PASS" : "DENIED_OR_UNAVAILABLE",
    ready_message: safeText(ready.message),
    ready_reason: safeText(ready.reason),
    ready_status: safeText(ready.status),
    revision_name: safeText(metadata.name),
    sanitized_error_messages: messages,
    secret_payloads_read: false,
  }),
);
