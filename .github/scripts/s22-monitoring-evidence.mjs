import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { monitoringProfile, monitoringRequestFilter } from "./s22-monitoring-plan-check.mjs";

const project = monitoringProfile.project_id;
const root = `projects/${project}`;
const origin = "https://monitoring.googleapis.com";
const errorFilter = `${monitoringRequestFilter} AND metric.label.response_code_class = "5xx"`;
const group = ["resource.label.service_name", "resource.label.location"];
class EvidenceError extends Error {
  constructor(code, stage = "response_validation") {
    super(code);
    this.code = code;
    this.stage = stage;
  }
}
const requireEvidence = (condition, code = "MONITORING_RESPONSE_INVALID") => {
  if (!condition) throw new EvidenceError(code);
};
const same = (left, right) => requireEvidence(isDeepStrictEqual(left, right));
const timestamp = (value) =>
  typeof value === "string" &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.[0-9]{1,9})?Z$/u.test(value) &&
  Number.isFinite(Date.parse(value));

export function validateEvidenceRequest(env) {
  requireEvidence(
    env.S22_PHASE === "monitoring-evidence" &&
      env.ACTION === "plan" &&
      env.PROJECT_ID === project &&
      /^[a-f0-9]{40}$/u.test(env.REQUESTED_SHA ?? "") &&
      env.GITHUB_SHA === env.REQUESTED_SHA &&
      ["main", "verify/s22-staging-recovery-capacity"].includes(env.GITHUB_REF_NAME) &&
      !env.APPROVAL_TOKEN &&
      !env.PLAN_RUN_ID &&
      !env.APPROVED_PLAN_SHA256,
    "MONITORING_REQUEST_DENIED",
  );
}

// Only authenticated GETs to these fixed metadata endpoints; no redirects or retries.
export function googleMonitoringGet(token, fetcher = fetch) {
  requireEvidence(
    typeof token === "string" && token.length > 0 && !/\s/u.test(token),
    "MONITORING_AUTH_UNAVAILABLE",
  );
  return async (path, query = new URLSearchParams()) => {
    requireEvidence(
      new RegExp(`^${root}/(?:alertPolicies|timeSeries|notificationChannels/[0-9]+)$`, "u").test(
        path,
      ),
      "MONITORING_REQUEST_DENIED",
    );
    const response = await fetcher(`${origin}/v3/${path}?${query}`, {
      method: "GET",
      redirect: "error",
      signal: AbortSignal.timeout(15000),
      headers: { Authorization: `Bearer ${token}` },
    });
    requireEvidence(response.status !== 401 && response.status !== 403, "MONITORING_ACCESS_DENIED");
    requireEvidence(response.ok && response.body, "MONITORING_READ_UNAVAILABLE");
    const reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        requireEvidence(size <= 1048576);
        chunks.push(value);
      }
    } finally {
      await reader.cancel();
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  };
}

function checkAggregation(values) {
  requireEvidence(Array.isArray(values) && values.length === 1);
  const value = values[0];
  requireEvidence(
    value.alignmentPeriod === "60s" &&
      value.perSeriesAligner === "ALIGN_RATE" &&
      value.crossSeriesReducer === "REDUCE_SUM",
  );
  same([...(value.groupByFields ?? [])].sort(), [...group].sort());
}

function metricPoints(body, start, end) {
  requireEvidence(
    body && typeof body === "object" && !Array.isArray(body) && !body.error && !body.nextPageToken,
  );
  requireEvidence(
    body.executionErrors === undefined ||
      (Array.isArray(body.executionErrors) && body.executionErrors.length === 0),
  );
  const rows = body.timeSeries ?? [];
  requireEvidence(Array.isArray(rows) && rows.length <= 1);
  const points = new Map();
  for (const row of rows) {
    requireEvidence(
      row.resource?.type === "cloud_run_revision" &&
        row.metric?.type === "run.googleapis.com/request_count",
    );
    const labels = row.resource.labels;
    requireEvidence(
      labels?.service_name === "lead-agent-staging-api" &&
        labels.location === monitoringProfile.region,
    );
    requireEvidence(!labels.project_id || labels.project_id === project);
    requireEvidence(Array.isArray(row.points) && row.points.length <= 12);
    for (const point of row.points) {
      const time = point.interval?.endTime;
      const value = point.value?.doubleValue;
      requireEvidence(timestamp(time) && Date.parse(time) > start && Date.parse(time) <= end);
      const key = new Date(time).toISOString();
      requireEvidence(
        typeof value === "number" && Number.isFinite(value) && value >= 0 && !points.has(key),
      );
      points.set(key, value);
    }
  }
  return { series: rows.length, points };
}

export async function collectMonitoringEvidence(get, commit, now) {
  requireEvidence(
    /^[a-f0-9]{40}$/u.test(commit ?? "") && timestamp(now),
    "MONITORING_REQUEST_DENIED",
  );
  // Cloud Run request_count is sampled every minute and can arrive two minutes late.
  const end = Date.parse(now) - 120000;
  const start = end - 600000;
  const read = async (stage, path, query) => {
    try {
      return await get(path, query);
    } catch (error) {
      throw new EvidenceError(
        error instanceof EvidenceError ? error.code : "MONITORING_READ_UNAVAILABLE",
        stage,
      );
    }
  };
  const policies = await read(
    "policy_read",
    `${root}/alertPolicies`,
    new URLSearchParams({ pageSize: "100" }),
  );
  requireEvidence(
    policies &&
      !policies.nextPageToken &&
      Array.isArray(policies.alertPolicies) &&
      policies.alertPolicies.length <= 100,
  );
  const selected = policies.alertPolicies.filter(
    (value) => value.displayName === "Lead Agent staging API server errors",
  );
  requireEvidence(selected.length === 1, "MONITORING_POLICY_MISMATCH");
  const policy = selected[0];
  requireEvidence(
    new RegExp(`^${root}/alertPolicies/[0-9]+$`, "u").test(policy.name) &&
      policy.enabled === true &&
      policy.combiner === "OR",
  );
  requireEvidence(policy.conditions?.length === 1);
  const threshold = policy.conditions[0].conditionThreshold;
  requireEvidence(
    threshold?.filter === errorFilter &&
      threshold.denominatorFilter === monitoringRequestFilter &&
      threshold.comparison === "COMPARISON_GT" &&
      threshold.thresholdValue === 0.01 &&
      threshold.duration === "300s",
    "MONITORING_POLICY_MISMATCH",
  );
  checkAggregation(threshold.aggregations);
  checkAggregation(threshold.denominatorAggregations);
  const channels = policy.notificationChannels;
  requireEvidence(
    Array.isArray(channels) &&
      channels.length > 0 &&
      channels.length <= 8 &&
      new Set(channels).size === channels.length,
  );
  const types = [];
  for (const name of channels) {
    requireEvidence(new RegExp(`^${root}/notificationChannels/[0-9]+$`, "u").test(name));
    const channel = await read("channel_read", name);
    requireEvidence(channel?.name === name && channel.enabled === true);
    types.push(
      [
        "email",
        "slack",
        "sms",
        "pubsub",
        "webhook_tokenauth",
        "webhook_basicauth",
        "pagerduty",
      ].includes(channel.type)
        ? channel.type
        : "other",
    );
  }
  const query = (filter) =>
    new URLSearchParams([
      ["filter", filter],
      ["interval.startTime", new Date(start).toISOString()],
      ["interval.endTime", new Date(end).toISOString()],
      ["view", "FULL"],
      ["pageSize", "20"],
      ["aggregation.alignmentPeriod", "60s"],
      ["aggregation.perSeriesAligner", "ALIGN_RATE"],
      ["aggregation.crossSeriesReducer", "REDUCE_SUM"],
      ...group.map((field) => ["aggregation.groupByFields", field]),
    ]);
  const total = metricPoints(
    await read("total_metrics_read", `${root}/timeSeries`, query(monitoringRequestFilter)),
    start,
    end,
  );
  const errors = metricPoints(
    await read("error_metrics_read", `${root}/timeSeries`, query(errorFilter)),
    start,
    end,
  );
  const ratios = [];
  let zeroTotal = 0;
  let missingNumerator = 0;
  for (const [time, value] of total.points) {
    if (value === 0) zeroTotal++;
    const numerator = errors.points.get(time);
    if (numerator === undefined) {
      missingNumerator++;
      continue;
    }
    requireEvidence(numerator <= value);
    if (value > 0) ratios.push(numerator / value);
  }
  return {
    operation: "s22_monitoring_baseline",
    outcome: "BASELINE_COLLECTED",
    evidence_commit: commit,
    observed_at: now,
    window_start: new Date(start).toISOString(),
    window_end: new Date(end).toISOString(),
    policy_matches_reviewed_ratio: true,
    enabled_channel_count: channels.length,
    channel_types: types,
    metrics: {
      total_series: total.series,
      error_series: errors.series,
      total_buckets: total.points.size,
      error_buckets: errors.points.size,
      matched_positive_total_buckets: ratios.length,
      zero_total_buckets: zeroTotal,
      missing_numerator_buckets: missingNumerator,
      missing_denominator_buckets: [...errors.points.keys()].filter(
        (time) => !total.points.has(time),
      ).length,
      maximum_observed_ratio: ratios.length ? Math.max(...ratios) : null,
    },
    monitoring_get_requests: 3 + channels.length,
    notification_delivery_proven: false,
    sustained_condition_proven: false,
    infrastructure_mutated: false,
    database_executed: false,
    provider_calls: 0,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let result;
  let stage = "request";
  try {
    validateEvidenceRequest(process.env);
    stage = "authentication";
    const token = execFileSync("gcloud", ["auth", "print-access-token"], {
      encoding: "utf8",
      timeout: 15000,
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
    stage = "collection";
    result = await collectMonitoringEvidence(
      googleMonitoringGet(token),
      process.env.REQUESTED_SHA,
      new Date().toISOString(),
    );
  } catch (error) {
    result = {
      operation: "s22_monitoring_baseline",
      outcome: "BLOCKED",
      reason:
        error instanceof EvidenceError
          ? error.code
          : stage === "authentication"
            ? "MONITORING_AUTH_UNAVAILABLE"
            : "MONITORING_READ_UNAVAILABLE",
      failure_stage: error instanceof EvidenceError && stage === "collection" ? error.stage : stage,
      evidence_commit: /^[a-f0-9]{40}$/u.test(process.env.REQUESTED_SHA ?? "")
        ? process.env.REQUESTED_SHA
        : null,
      observed_at: new Date().toISOString(),
      infrastructure_mutated: false,
      database_executed: false,
      provider_calls: 0,
      notification_delivery_proven: false,
      sustained_condition_proven: false,
    };
    process.exitCode = 1;
  }
  const receipt = `${JSON.stringify(result, null, 2)}\n`;
  writeFileSync("s22-monitoring-evidence.json", receipt);
  process.stdout.write(receipt);
}
