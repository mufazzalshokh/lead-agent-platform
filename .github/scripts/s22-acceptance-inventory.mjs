import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

/** @param {unknown} value @returns {Record<string, unknown> | undefined} */
const object = (value) =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? /** @type {Record<string, unknown>} */ (value)
    : undefined;
/** @param {unknown} value */
const timestamp = (value) =>
  typeof value === "string" &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/u.test(value) &&
  Number.isFinite(Date.parse(value))
    ? value
    : null;

/** Allowlisted metadata only. This is prerequisite evidence, not restore/load proof.
 * @param {unknown} sqlValue @param {unknown} backupsValue
 * @param {unknown} alertsValue @param {unknown} workerValue
 * @param {{apiStatus: string, webStatus: string, commit: string, now: string}} context
 */
export const acceptanceInventory = (sqlValue, backupsValue, alertsValue, workerValue, context) => {
  if (!/^[0-9a-f]{40}$/u.test(context.commit) || timestamp(context.now) === null)
    throw new Error("S22A001_INVALID_EVIDENCE_CONTEXT");
  const sql = object(sqlValue);
  const settings = object(sql?.settings);
  const backupConfiguration = object(settings?.backupConfiguration);
  const ip = object(settings?.ipConfiguration);
  const backups = Array.isArray(backupsValue) ? backupsValue : [];
  const successful = backups
    .map(object)
    .filter(
      (entry) =>
        entry?.status === "SUCCESSFUL" &&
        entry.instance === "lead-agent-staging-postgres17" &&
        timestamp(entry.endTime) !== null &&
        Date.parse(String(entry.endTime)) <= Date.parse(context.now),
    )
    .sort((left, right) => Date.parse(String(right?.endTime)) - Date.parse(String(left?.endTime)));
  const latest = successful[0];
  const alertList = object(alertsValue)?.alertPolicies;
  const policies = Array.isArray(alertList) ? alertList.map(object) : [];
  const alertNames = [
    "Lead Agent staging API server errors",
    "Lead Agent staging Cloud SQL CPU saturation",
  ];
  const alerts = alertNames.map((name) => {
    const policy = policies.find((candidate) => candidate?.displayName === name);
    const channels = Array.isArray(policy?.notificationChannels) ? policy.notificationChannels : [];
    return {
      name,
      enabled: policy?.enabled === true,
      notifications_configured: channels.some(
        (channel) =>
          typeof channel === "string" &&
          /^projects\/lead-agent-stg-739284\/notificationChannels\/\d+$/u.test(channel),
      ),
    };
  });
  const worker = object(workerValue);
  const workerStatus = object(worker?.status);
  const conditions = workerStatus?.conditions ?? worker?.conditions;
  const ready =
    object(worker?.terminalCondition)?.state === "CONDITION_SUCCEEDED" ||
    (Array.isArray(conditions) &&
      conditions.some((value) => {
        const condition = object(value);
        return condition?.type === "Ready" && condition.status === "True";
      }));
  const assertions = {
    correct_instance:
      sql?.name === "lead-agent-staging-postgres17" &&
      sql.project === "lead-agent-stg-739284" &&
      sql.region === "me-central1",
    database_running: sql?.state === "RUNNABLE" && settings?.activationPolicy === "ALWAYS",
    postgresql_17: sql?.databaseVersion === "POSTGRES_17",
    shared_core: settings?.tier === "db-f1-micro",
    private_ip_only:
      ip?.ipv4Enabled === false &&
      Array.isArray(sql?.ipAddresses) &&
      sql.ipAddresses.some((value) => object(value)?.type === "PRIVATE") &&
      !sql.ipAddresses.some((value) => object(value)?.type === "PRIMARY"),
    backups_enabled: backupConfiguration?.enabled === true,
    pitr_enabled: backupConfiguration?.pointInTimeRecoveryEnabled === true,
    successful_backup_exists: latest !== undefined,
    api_http_200: context.apiStatus === "200",
    web_http_200: context.webStatus === "200",
    worker_ready: ready,
    alert_policies_configured: alerts.every(
      (alert) => alert.enabled && alert.notifications_configured,
    ),
  };
  return {
    operation: "s22_acceptance_inventory",
    evidence_commit: context.commit,
    observed_at: context.now,
    assertions,
    latest_successful_backup:
      latest === undefined
        ? null
        : {
            id: typeof latest.id === "string" && /^\d+$/u.test(latest.id) ? latest.id : null,
            started_at: timestamp(latest.startTime),
            completed_at: timestamp(latest.endTime),
            age_seconds: Math.max(
              0,
              Math.floor((Date.parse(context.now) - Date.parse(String(latest.endTime))) / 1000),
            ),
          },
    alerts,
    restore_proven: false,
    capacity_proven: false,
    secret_payloads_read: false,
    infrastructure_mutated: false,
    outcome: Object.values(assertions).every(Boolean) ? "PASS" : "PREREQUISITE_NOT_VERIFIED",
  };
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const directory = process.argv[2];
  if (!directory) throw new Error("S22A002_INPUT_DIRECTORY_REQUIRED");
  const inputs = await Promise.all(
    ["sql", "backups", "alerts", "worker"].map(async (name) =>
      JSON.parse(await readFile(join(directory, `${name}.json`), "utf8")),
    ),
  );
  const result = acceptanceInventory(...inputs, {
    apiStatus: process.env.S22_API_HEALTH_STATUS ?? "unavailable",
    webStatus: process.env.S22_WEB_HEALTH_STATUS ?? "unavailable",
    commit: process.env.REQUESTED_SHA ?? "unavailable",
    now: new Date().toISOString(),
  });
  console.log(JSON.stringify(result, null, 2));
  if (result.outcome !== "PASS") process.exitCode = 1;
}
