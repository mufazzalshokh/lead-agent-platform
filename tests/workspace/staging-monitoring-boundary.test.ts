import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";

it("passes the native monitoring rollout action, drift, provenance and workflow guards", () => {
  const result = spawnSync(
    process.execPath,
    ["--test", ".github/scripts/s22-monitoring-plan-check.test.mjs"],
    { encoding: "utf8", timeout: 30_000, maxBuffer: 1024 * 1024 },
  );
  expect(result.error, result.stderr).toBeUndefined();
  expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
}, 35_000);
