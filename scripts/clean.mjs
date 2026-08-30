import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const workspaceRoot = process.cwd();
const packageNames = [
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
const targets = [
  "coverage",
  "apps/api/dist",
  "apps/api/tsconfig.tsbuildinfo",
  "apps/web/.next",
  "apps/web/out",
  "apps/web/tsconfig.tsbuildinfo",
  "apps/worker/dist",
  "apps/worker/tsconfig.tsbuildinfo",
  ...packageNames.flatMap((packageName) => [
    `packages/${packageName}/dist`,
    `packages/${packageName}/tsconfig.tsbuildinfo`,
  ]),
];

let removed = 0;

for (const target of targets) {
  const absoluteTarget = path.resolve(workspaceRoot, target);
  const isInsideWorkspace = absoluteTarget.startsWith(`${workspaceRoot}${path.sep}`);

  if (!isInsideWorkspace || absoluteTarget === workspaceRoot) {
    throw new Error(`Refusing to clean unsafe target: ${target}`);
  }

  if (fs.existsSync(absoluteTarget)) {
    fs.rmSync(absoluteTarget, { force: true, recursive: true });
    removed += 1;
  }
}

console.log(`Cleaned ${removed} generated artifact target(s).`);
