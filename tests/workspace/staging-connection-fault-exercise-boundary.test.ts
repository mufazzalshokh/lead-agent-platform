import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";

it("passes offline profile and browser exercise boundaries without network access", () => {
  const result = spawnSync(
    process.execPath,
    [
      "--test",
      ".github/scripts/s22-connection-fault-profile-plan-check.test.mjs",
      ".github/scripts/s22-connection-fault-browser.test.mjs",
      ".github/scripts/s22-connection-fault-profile-workflow.test.mjs",
    ],
    {
      encoding: "utf8",
      timeout: 30_000,
      maxBuffer: 1024 * 1024,
    },
  );
  expect(result.error, result.stderr).toBeUndefined();
  expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
}, 35_000);
