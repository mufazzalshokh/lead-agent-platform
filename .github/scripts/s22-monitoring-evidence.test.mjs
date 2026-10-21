import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  collectMonitoringEvidence,
  googleMonitoringGet,
  validateEvidenceRequest,
} from "./s22-monitoring-evidence.mjs";
import { monitoringRequestFilter } from "./s22-monitoring-plan-check.mjs";

const root = "projects/lead-agent-stg-739284";
const channel = `${root}/notificationChannels/123`;
const now = "2026-10-21T18:50:00.000Z";
const time = "2026-10-21T18:47:00Z";
const commit = "a".repeat(40);
const aggregation = () => ({
  alignmentPeriod: "60s",
  perSeriesAligner: "ALIGN_RATE",
  crossSeriesReducer: "REDUCE_SUM",
  groupByFields: ["resource.label.location", "resource.label.service_name"],
});
const policies = () => ({
  alertPolicies: [
    {
      name: `${root}/alertPolicies/123`,
      displayName: "Lead Agent staging API server errors",
      enabled: true,
      combiner: "OR",
      notificationChannels: [channel],
      conditions: [
        {
          conditionThreshold: {
            filter: `${monitoringRequestFilter} AND metric.label.response_code_class = "5xx"`,
            denominatorFilter: monitoringRequestFilter,
            comparison: "COMPARISON_GT",
            thresholdValue: 0.01,
            duration: "300s",
            aggregations: [aggregation()],
            denominatorAggregations: [aggregation()],
          },
        },
      ],
    },
  ],
});
const series = (value = 10) => ({
  timeSeries: [
    {
      resource: {
        type: "cloud_run_revision",
        labels: { service_name: "lead-agent-staging-api", location: "me-central1" },
      },
      metric: { type: "run.googleapis.com/request_count", labels: { private: "sensitive-value" } },
      points: [{ interval: { endTime: time }, value: { doubleValue: value } }],
    },
  ],
});
const fixture = () => ({
  policies: policies(),
  channel: {
    name: channel,
    enabled: true,
    type: "email",
    labels: { email_address: "sensitive-value" },
  },
  total: series(10),
  errors: series(0.2),
});
function reader(data, calls = []) {
  return async (path, query) => {
    calls.push({ path, query });
    if (path.endsWith("/alertPolicies")) return data.policies;
    if (path === channel) return data.channel;
    assert.equal(path, `${root}/timeSeries`);
    return query.get("filter").includes('response_code_class = "5xx"') ? data.errors : data.total;
  };
}
const inspect = (data = fixture(), calls) =>
  collectMonitoringEvidence(reader(data, calls), commit, now);

test("reads exactly the fixed policy, channel and two scoped aggregates without claiming delivery", async () => {
  const calls = [];
  const result = await inspect(fixture(), calls);
  assert.equal(calls.length, 4);
  assert.equal(result.outcome, "BASELINE_COLLECTED");
  assert.equal(result.metrics.maximum_observed_ratio, 0.02);
  assert.equal(result.notification_delivery_proven, false);
  assert.equal(result.sustained_condition_proven, false);
  assert.equal(result.infrastructure_mutated, false);
  assert.equal(result.database_executed, false);
  assert.equal(result.provider_calls, 0);
  assert.equal(result.monitoring_get_requests, 4);
  assert.ok(!JSON.stringify(result).includes("sensitive-value"));
  for (const call of calls.filter((value) => value.path.endsWith("/timeSeries"))) {
    assert.equal(call.query.get("aggregation.perSeriesAligner"), "ALIGN_RATE");
    assert.equal(call.query.get("aggregation.crossSeriesReducer"), "REDUCE_SUM");
    assert.equal(call.query.get("aggregation.alignmentPeriod"), "60s");
    assert.equal(call.query.get("interval.startTime"), "2026-10-21T18:38:00.000Z");
    assert.equal(call.query.get("interval.endTime"), "2026-10-21T18:48:00.000Z");
    assert.deepEqual(call.query.getAll("aggregation.groupByFields"), [
      "resource.label.service_name",
      "resource.label.location",
    ]);
  }
});
test("absent numerator is unknown, not an invented zero-percent error rate", async () => {
  const data = fixture();
  data.errors = {};
  const result = await inspect(data);
  assert.equal(result.metrics.maximum_observed_ratio, null);
  assert.equal(result.metrics.missing_numerator_buckets, 1);
  assert.equal(result.metrics.matched_positive_total_buckets, 0);
});
test("empty and explicit zero-total traffic are distinct from a measured positive-total zero ratio", async () => {
  const data = fixture();
  data.total = {};
  data.errors = {};
  assert.equal((await inspect(data)).metrics.total_buckets, 0);
  data.total = series(0);
  data.errors = series(0);
  assert.equal((await inspect(data)).metrics.zero_total_buckets, 1);
  assert.equal((await inspect(data)).metrics.maximum_observed_ratio, null);
  data.total = series(10);
  assert.equal((await inspect(data)).metrics.maximum_observed_ratio, 0);
});
for (const [name, mutate] of [
  [
    "old absolute-rate policy",
    (data) => {
      data.policies.alertPolicies[0].conditions[0].conditionThreshold.denominatorFilter = "";
    },
  ],
  [
    "changed grouping",
    (data) => {
      data.policies.alertPolicies[0].conditions[0].conditionThreshold.denominatorAggregations[0].groupByFields =
        [];
    },
  ],
  [
    "ambiguous policy",
    (data) => {
      data.policies.alertPolicies.push(structuredClone(data.policies.alertPolicies[0]));
    },
  ],
  [
    "foreign channel",
    (data) => {
      data.policies.alertPolicies[0].notificationChannels = [
        "projects/foreign/notificationChannels/123",
      ];
    },
  ],
  [
    "disabled channel",
    (data) => {
      data.channel.enabled = false;
    },
  ],
  [
    "foreign metric scope",
    (data) => {
      data.total.timeSeries[0].resource.labels.service_name = "foreign";
    },
  ],
  [
    "future metric point",
    (data) => {
      data.total.timeSeries[0].points[0].interval.endTime = now;
    },
  ],
  [
    "non-numeric metric",
    (data) => {
      data.total.timeSeries[0].points[0].value.doubleValue = "sensitive-value";
    },
  ],
  [
    "duplicate bucket",
    (data) => {
      data.total.timeSeries[0].points.push(structuredClone(data.total.timeSeries[0].points[0]));
    },
  ],
  [
    "truncated metrics",
    (data) => {
      data.total.nextPageToken = "sensitive-value";
    },
  ],
  [
    "partial metric failure",
    (data) => {
      data.total.executionErrors = [{ message: "sensitive-value" }];
    },
  ],
  [
    "error count above total",
    (data) => {
      data.errors = series(11);
    },
  ],
])
  test(`rejects ${name} without returning an evidence success`, async () => {
    const data = fixture();
    mutate(data);
    await assert.rejects(
      inspect(data),
      (error) => /^MONITORING_/u.test(error.message) && !error.message.includes("sensitive-value"),
    );
  });
test("access denial identifies the exact metric-read stage without exposing response contents", async () => {
  const data = fixture();
  const original = reader(data);
  const denied = googleMonitoringGet(
    "private-token",
    async () => new Response("sensitive-value", { status: 403 }),
  );
  await assert.rejects(
    collectMonitoringEvidence(
      async (path, query) =>
        path.endsWith("/timeSeries") ? denied(path, query) : original(path, query),
      commit,
      now,
    ),
    (error) =>
      error.code === "MONITORING_ACCESS_DENIED" &&
      error.stage === "total_metrics_read" &&
      !error.message.includes("sensitive-value"),
  );
});
test("request boundary denies apply, other project/ref/source and authority tokens before reads", () => {
  const env = {
    S22_PHASE: "monitoring-evidence",
    ACTION: "plan",
    PROJECT_ID: "lead-agent-stg-739284",
    REQUESTED_SHA: commit,
    GITHUB_SHA: commit,
    GITHUB_REF_NAME: "verify/s22-staging-recovery-capacity",
  };
  validateEvidenceRequest(env);
  for (const [key, value] of [
    ["ACTION", "apply"],
    ["PROJECT_ID", "foreign"],
    ["GITHUB_REF_NAME", "other"],
    ["GITHUB_SHA", "b".repeat(40)],
    ["APPROVAL_TOKEN", "anything"],
    ["PLAN_RUN_ID", "123"],
    ["APPROVED_PLAN_SHA256", "a".repeat(64)],
  ])
    assert.throws(
      () => validateEvidenceRequest({ ...env, [key]: value }),
      /MONITORING_REQUEST_DENIED/u,
    );
});
test("transport is fixed-host GET-only with bounded payloads and no redirect or retry", async () => {
  const calls = [];
  const get = googleMonitoringGet("private-token", async (url, options) => {
    calls.push({ url, options });
    return new Response("{}", { status: 200 });
  });
  await get(`${root}/alertPolicies`);
  assert.equal(calls.length, 1);
  assert.ok(calls[0].url.startsWith(`https://monitoring.googleapis.com/v3/${root}/`));
  assert.equal(calls[0].options.method, "GET");
  assert.equal(calls[0].options.redirect, "error");
  for (const path of [
    "https://foreign.example/",
    `${root}/alertPolicies/123:delete`,
    `${root}/secrets/private/versions/latest`,
    "projects/foreign/timeSeries",
  ])
    await assert.rejects(get(path), /MONITORING_REQUEST_DENIED/u);
  assert.equal(calls.length, 1);
  const denied = googleMonitoringGet(
    "private-token",
    async () => new Response("sensitive-value", { status: 403 }),
  );
  await assert.rejects(denied(`${root}/timeSeries`), /MONITORING_ACCESS_DENIED/u);
  const oversized = googleMonitoringGet(
    "private-token",
    async () => new Response("x".repeat(1048577)),
  );
  await assert.rejects(oversized(`${root}/timeSeries`), /MONITORING_RESPONSE_INVALID/u);
});
test("read-only workflow excludes Terraform and has no application, notification or database write step", () => {
  const source = readFileSync(".github/workflows/staging-terraform.yml", "utf8");
  const job = source.slice(
    source.indexOf("  monitoring-evidence:"),
    source.indexOf("  booking-evidence:"),
  );
  assert.ok(source.includes("inputs.phase != 'monitoring-evidence'"));
  assert.ok(job.includes('[[ "$GITHUB_SHA" == "$REQUESTED_SHA" ]]'));
  assert.ok(job.includes('"$ACTION" == "plan"'));
  assert.ok(job.includes("timeout-minutes: 5"));
  assert.ok(
    !/terraform (?:apply|plan)|run jobs execute|versions access|sendVerificationCode|sendTestNotification/u.test(
      job,
    ),
  );
  assert.ok(
    job.indexOf("Enforce monitoring read-only boundary") <
      job.indexOf("Authenticate through existing staging WIF"),
  );
});
