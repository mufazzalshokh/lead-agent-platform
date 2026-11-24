import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";

it("enforces the offline S22 preflight, controller and transport boundaries", () => {
  const result = spawnSync(
    process.execPath,
    [
      "--test",
      ".github/scripts/s22-failure-preflight.test.mjs",
      ".github/scripts/s22-failure-controller.test.mjs",
      ".github/scripts/s22-failure-adapters.test.mjs",
      ".github/scripts/s22-solo-recovery-protocol.test.mjs",
    ],
    { encoding: "utf8", timeout: 30_000, maxBuffer: 1024 * 1024 },
  );
  expect(result.error, result.stderr).toBeUndefined();
  expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
}, 35_000);
