import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";

it("passes bounded read-only monitoring evidence and privacy regressions", () => {
  const result = spawnSync(
    process.execPath,
    ["--test", ".github/scripts/s22-monitoring-evidence.test.mjs"],
    {
      encoding: "utf8",
      timeout: 30_000,
      maxBuffer: 1024 * 1024,
    },
  );
  expect(result.error, result.stderr).toBeUndefined();
  expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
}, 35_000);
