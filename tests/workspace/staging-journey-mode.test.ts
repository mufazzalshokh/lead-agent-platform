import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const state = (value: string | null = "booking") => ({
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
              { containers: [{ env: value === null ? [] : [{ name: "AI_JOURNEY_MODE", value }] }] },
            ],
          },
        },
      ],
    },
  ],
});
const run = (input: unknown, phase = "full", mode = "preserve") =>
  spawnSync(process.execPath, [".github/scripts/s22-ai-journey-mode.mjs", phase, mode], {
    input: JSON.stringify(input),
    encoding: "utf8",
    timeout: 5000,
  });

describe("S22 tracked AI journey deployment mode", () => {
  it("preserves booking in unrelated API/migrator/load phases rather than silently pausing it", () => {
    for (const phase of ["api-image-update", "migrator-image-update", "load", "dormant", "full"]) {
      expect(run(state(), phase).stdout).toBe("booking\n");
    }
  });
  it("requires explicit full-runtime selection to change the gate", () => {
    expect(run(state(), "full", "paused").stdout).toBe("paused\n");
    expect(run(state("paused"), "full", "booking").stdout).toBe("booking\n");
    expect(run(state(), "migrator-image-update", "booking").status).toBe(1);
  });
  it("defaults new code to paused when authoritative old state has no mode", () => {
    expect(run(state(null)).stdout).toBe("paused\n");
    expect(run({ version: 4, resources: [] }).stdout).toBe("paused\n");
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
  it("binds saved-plan mode and Worker environment without expanding IAM or executing migrations", () => {
    const check = readFileSync(".github/scripts/s22-full-runtime-plan-check.sh", "utf8");
    const workflow = readFileSync(".github/workflows/staging-terraform.yml", "utf8");
    expect(check).toContain(".variables.ai_journey_mode.value == $journey_mode");
    expect(check).toContain('select(.name == "AI_JOURNEY_MODE")');
    expect(workflow).toContain(
      "terraform -chdir=infra/deploy/gcp/staging state pull | node .github/scripts/s22-ai-journey-mode.mjs",
    );
    expect(check).toContain("full_runtime_migrator_execution=DISABLED");
  });
});
