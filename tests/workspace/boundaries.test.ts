import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { describe, expect, it } from "vitest";

describe("dependency boundary enforcement", () => {
  it("rejects a domain import from the database package", () => {
    const checker = path.resolve("scripts/check-boundaries.mjs");
    const fixture = path.resolve("tests/fixtures/boundaries/invalid");
    const result = spawnSync(process.execPath, [checker, "--root", fixture], {
      encoding: "utf8",
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("domain-must-remain-pure");
    expect(result.stderr).toContain("@lead-agent/database");
  });
});
