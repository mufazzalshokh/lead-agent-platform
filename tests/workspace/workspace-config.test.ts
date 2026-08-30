import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const expectedApps = ["api", "web", "worker"];
const expectedPackages = [
  "ai",
  "application",
  "config",
  "contracts",
  "database",
  "domain",
  "integrations",
  "observability",
  "security",
  "testing",
  "ui",
];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const readManifest = (manifestPath: string): Record<string, unknown> => {
  const parsed: unknown = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

  if (!isRecord(parsed)) {
    throw new TypeError(`${manifestPath} must contain a JSON object`);
  }

  return parsed;
};

describe("workspace configuration", () => {
  it("pins the approved runtime and package manager", () => {
    const manifest = readManifest(path.resolve("package.json"));

    expect(manifest["packageManager"]).toBe("pnpm@11.24.0");
    expect(manifest["engines"]).toEqual({
      node: ">=24.0.0 <25.0.0",
      pnpm: "11.24.0",
    });
    expect(fs.readFileSync(path.resolve(".node-version"), "utf8").trim()).toBe("24.14.0");
  });

  it.each([
    ...expectedApps.map((name) => ["apps", name]),
    ...expectedPackages.map((name) => ["packages", name]),
  ])("provides an explicit manifest for %s/%s", (kind, name) => {
    const manifestPath = path.resolve(kind, name, "package.json");
    const manifest = readManifest(manifestPath);

    expect(manifest["name"]).toBe(`@lead-agent/${name}`);
    expect(manifest["private"]).toBe(true);

    if (kind === "packages") {
      expect(manifest["exports"]).toEqual({
        ".": {
          import: "./dist/index.js",
          types: "./dist/index.d.ts",
        },
      });
    }
  });
});
