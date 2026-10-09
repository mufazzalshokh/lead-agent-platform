import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sessionId = "01923456-1234-7123-8123-123456789abc";
const state = (value: string | null = "booking", session?: string) => ({
  version: 4,
  resources: [
    {
      mode: "managed",
      type: "google_cloud_run_v2_worker_pool",
      name: "worker",
      instances: [
        {
          attributes: {
            project: "lead-agent-stg-739284",
            location: "me-central1",
            name: "lead-agent-staging-worker",
            template: [
              {
                containers: [
                  {
                    env: [
                      ...(value === null ? [] : [{ name: "AI_JOURNEY_MODE", value }]),
                      ...(session === undefined
                        ? []
                        : [{ name: "AI_JOURNEY_WIDGET_SESSION_ID", value: session }]),
                    ],
                  },
                ],
              },
            ],
          },
        },
      ],
    },
  ],
});
const run = (input: unknown, phase = "full", mode = "preserve", session = "", output = "mode") =>
  spawnSync(
    process.execPath,
    [".github/scripts/s22-ai-journey-mode.mjs", phase, mode, session, output],
    {
      input: JSON.stringify(input),
      encoding: "utf8",
      timeout: 5000,
    },
  );

describe("S22 tracked AI journey deployment mode", () => {
  it.each(["api-image-update", "migrator-image-update", "load", "dormant", "full"])(
    "preserves booking during %s without silently pausing it",
    (phase) => {
      expect(run(state(), phase).stdout).toBe("booking\n");
    },
  );
  it("requires explicit full-runtime selection to change the gate", () => {
    expect(run(state(), "full", "paused").stdout).toBe("paused\n");
    expect(run(state("paused"), "full", "booking").stdout).toBe("booking\n");
    expect(run(state(), "migrator-image-update", "booking").status).toBe(1);
  });
  it("defaults new code to paused when authoritative old state has no mode", () => {
    expect(run(state(null)).stdout).toBe("paused\n");
    expect(run({ version: 4, resources: [] }).stdout).toBe("paused\n");
  });
  it("requires an explicit canonical Widget session UUID in a full-runtime selection", () => {
    expect(run(state(), "full", "widget_booking", sessionId, "json").stdout).toBe(
      `${JSON.stringify({ mode: "widget_booking", widgetSessionId: sessionId })}\n`,
    );
    for (const [phase, mode, session] of [
      ["full", "widget_booking", ""],
      ["full", "widget_booking", "not-a-uuid"],
      ["full", "widget_booking", sessionId.replace("-7123-", "-4123-")],
      ["full", "widget_booking", sessionId.toUpperCase()],
      ["api-image-update", "widget_booking", sessionId],
      ["full", "booking", sessionId],
      ["full", "paused", sessionId],
    ])
      expect(run(state(), phase, mode, session).status).toBe(1);
  });
  it.each(["api-image-verify", "api-image-update", "migrator-image-update", "load", "full"])(
    "preserves the exact existing Widget binding during %s",
    (phase) => {
      const result = run(state("widget_booking", sessionId), phase, "preserve", "", "json");
      expect(result.status).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual({
        mode: "widget_booking",
        widgetSessionId: sessionId,
      });
    },
  );
  it("rejects a conflicting preserved session and leaves legacy bindings empty", () => {
    expect(run(state("widget_booking", sessionId), "full", "preserve", sessionId).status).toBe(0);
    expect(
      run(
        state("widget_booking", sessionId),
        "full",
        "preserve",
        "01923456-1234-7123-8123-123456789abd",
      ).status,
    ).toBe(1);
    expect(run(state(), "full", "preserve", sessionId).status).toBe(1);
    expect(run(state(), "full", "preserve", "", "json").stdout).toBe(
      `${JSON.stringify({ mode: "booking", widgetSessionId: "" })}\n`,
    );
  });
  it("rejects missing, malformed, duplicated, or inactive prior Widget bindings", () => {
    const duplicate = state("widget_booking", sessionId);
    duplicate.resources[0]!.instances[0]!.attributes.template[0]!.containers[0]!.env.push({
      name: "AI_JOURNEY_WIDGET_SESSION_ID",
      value: sessionId,
    });
    for (const input of [
      state("widget_booking"),
      state("widget_booking", "bad"),
      state("widget_booking", sessionId.replace("-7123-", "-4123-")),
      duplicate,
      state("booking", sessionId),
      state("paused", sessionId),
      state(null, sessionId),
    ]) {
      const result = run(input);
      expect(result.status).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr.trim()).toBe("S22_AI_JOURNEY_MODE_STATE_INVALID");
    }
    expect(run(state("widget_booking", sessionId), "full", "booking", "", "json").stdout).toBe(
      `${JSON.stringify({ mode: "booking", widgetSessionId: "" })}\n`,
    );
  });
  it("invalid mode/state/scope fails closed without leaking state", () => {
    for (const input of [
      {},
      state("not-approved"),
      { ...state(), resources: [...state().resources, ...state().resources] },
    ]) {
      const result = run(input);
      expect(result.status).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr.trim()).toBe("S22_AI_JOURNEY_MODE_STATE_INVALID");
    }
    const foreign = state();
    foreign.resources[0]!.instances[0]!.attributes.project = "foreign";
    expect(run(foreign).status).toBe(1);
  });
  it("runs full-runtime and read-only session-selection boundary regressions in ordinary CI", () => {
    const result = spawnSync(
      process.execPath,
      [
        "--test",
        ".github/scripts/s22-full-runtime-config-check.test.mjs",
        ".github/scripts/s22-widget-session-select.test.mjs",
      ],
      {
        encoding: "utf8",
        timeout: 15000,
      },
    );
    expect(result.status, result.stdout + result.stderr).toBe(0);
  });
  it("binds saved-plan mode and Worker environment without expanding IAM or executing migrations", () => {
    const check = readFileSync(".github/scripts/s22-full-runtime-plan-check.sh", "utf8");
    const workflow = readFileSync(".github/workflows/staging-terraform.yml", "utf8");
    expect(check).toContain(".variables.ai_journey_mode.value == $journey_mode");
    expect(check).toContain('select(.name == "AI_JOURNEY_MODE")');
    expect(check).toContain(".variables.ai_journey_widget_session_id.value == $widget_session");
    expect(check).toContain('select(.name == "AI_JOURNEY_WIDGET_SESSION_ID")');
    expect(check).toContain('if [[ "$PLAN_MODE" == "reconciliation" ]]');
    expect(check).toContain("s22-full-runtime-config-check.mjs");
    expect(workflow).toContain("ai_journey_widget_session_id:");
    expect(workflow).toContain(
      "terraform -chdir=infra/deploy/gcp/staging state pull | node .github/scripts/s22-ai-journey-mode.mjs",
    );
    expect(check).toContain("full_runtime_migrator_execution=DISABLED");
  });
});
