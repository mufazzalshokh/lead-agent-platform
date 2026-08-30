import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import ts from "typescript";

const WORKSPACE_PREFIX = "@lead-agent/";
const SOURCE_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts"];
const JAVASCRIPT_EXTENSIONS = new Set([".js", ".jsx", ".mjs", ".cjs"]);

const rootArgumentIndex = process.argv.indexOf("--root");
const requestedRoot = rootArgumentIndex === -1 ? "." : process.argv[rootArgumentIndex + 1];

if (requestedRoot === undefined) {
  throw new Error("--root requires a directory path");
}

const workspaceRoot = path.resolve(process.cwd(), requestedRoot);

const listDirectories = (directory) => {
  if (!fs.existsSync(directory)) {
    return [];
  }

  return fs
    .readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
};

const discoverUnits = () => {
  const units = [];

  for (const kind of ["apps", "packages"]) {
    const kindRoot = path.join(workspaceRoot, kind);

    for (const name of listDirectories(kindRoot)) {
      const unitRoot = path.join(kindRoot, name);
      const sourceRoot = path.join(unitRoot, "src");

      if (fs.existsSync(sourceRoot)) {
        units.push({
          id: `${kind}/${name}`,
          kind: kind === "apps" ? "app" : "package",
          name,
          root: unitRoot,
          sourceRoot,
        });
      }
    }
  }

  return units;
};

const collectSourceFiles = (directory) => {
  const files = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...collectSourceFiles(entryPath));
    } else if (SOURCE_EXTENSIONS.includes(path.extname(entry.name))) {
      files.push(entryPath);
    }
  }

  return files.sort();
};

const units = discoverUnits();
const packageUnits = new Map(
  units.filter((unit) => unit.kind === "package").map((unit) => [unit.name, unit]),
);
const allFiles = units.flatMap((unit) => collectSourceFiles(unit.sourceRoot));
const fileToUnit = new Map(
  allFiles.map((file) => [
    file,
    units.find((unit) => file.startsWith(`${unit.sourceRoot}${path.sep}`)),
  ]),
);

const relativePath = (file) => path.relative(workspaceRoot, file).split(path.sep).join("/");

const resolveRelativeImport = (sourceFile, specifier) => {
  const unresolved = path.resolve(path.dirname(sourceFile), specifier);
  const currentExtension = path.extname(unresolved);
  const withoutJavaScriptExtension = JAVASCRIPT_EXTENSIONS.has(currentExtension)
    ? unresolved.slice(0, -currentExtension.length)
    : unresolved;
  const candidates = [unresolved, withoutJavaScriptExtension];

  for (const base of candidates) {
    for (const candidate of [
      base,
      ...SOURCE_EXTENSIONS.map((extension) => `${base}${extension}`),
      ...SOURCE_EXTENSIONS.map((extension) => path.join(base, `index${extension}`)),
    ]) {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        return path.resolve(candidate);
      }
    }
  }

  return undefined;
};

const collectModuleSpecifiers = (file) => {
  const sourceText = fs.readFileSync(file, "utf8");
  const scriptKind = file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(
    file,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    scriptKind,
  );
  const specifiers = new Set();

  const recordStringLiteral = (node) => {
    if (node !== undefined && ts.isStringLiteralLike(node)) {
      specifiers.add(node.text);
    }
  };

  const visit = (node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      recordStringLiteral(node.moduleSpecifier);
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference)
    ) {
      recordStringLiteral(node.moduleReference.expression);
    } else if (ts.isCallExpression(node) && node.arguments.length > 0) {
      const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      const isRequire = ts.isIdentifier(node.expression) && node.expression.text === "require";

      if (isDynamicImport || isRequire) {
        recordStringLiteral(node.arguments[0]);
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return [...specifiers].sort();
};

const violations = new Set();
const fileGraph = new Map(allFiles.map((file) => [file, new Set()]));
const unitGraph = new Map(units.map((unit) => [unit.id, new Set()]));
const uiForbiddenPackages = new Set([
  "ai",
  "application",
  "database",
  "domain",
  "integrations",
  "observability",
  "security",
]);

const addViolation = (rule, sourceFile, specifier) => {
  violations.add(`${rule}: ${relativePath(sourceFile)} -> ${specifier}`);
};

for (const sourceFile of allFiles) {
  const sourceUnit = fileToUnit.get(sourceFile);

  if (sourceUnit === undefined) {
    throw new Error(`No workspace unit owns ${sourceFile}`);
  }

  for (const specifier of collectModuleSpecifiers(sourceFile)) {
    const isRelative = specifier.startsWith(".");
    const workspacePackageName = specifier.startsWith(WORKSPACE_PREFIX)
      ? specifier.slice(WORKSPACE_PREFIX.length).split("/")[0]
      : undefined;
    const targetFile = isRelative
      ? resolveRelativeImport(sourceFile, specifier)
      : workspacePackageName === undefined
        ? undefined
        : path.join(packageUnits.get(workspacePackageName)?.sourceRoot ?? "", "index.ts");
    const targetUnit =
      workspacePackageName === undefined
        ? targetFile === undefined
          ? undefined
          : fileToUnit.get(targetFile)
        : packageUnits.get(workspacePackageName);

    if (workspacePackageName !== undefined && targetUnit === undefined) {
      addViolation("unknown-workspace-package", sourceFile, specifier);
      continue;
    }

    if (targetFile !== undefined && fileGraph.has(targetFile)) {
      fileGraph.get(sourceFile)?.add(targetFile);
    }

    if (targetUnit !== undefined && targetUnit.id !== sourceUnit.id) {
      unitGraph.get(sourceUnit.id)?.add(targetUnit.id);
    }

    if (sourceUnit.kind === "package" && targetUnit?.kind === "app") {
      addViolation("packages-must-not-import-apps", sourceFile, specifier);
    }

    if (
      sourceUnit.kind === "app" &&
      targetUnit?.kind === "app" &&
      targetUnit.id !== sourceUnit.id
    ) {
      addViolation("apps-must-not-import-apps", sourceFile, specifier);
    }

    if (sourceUnit.name === "domain") {
      const allowedInternalTarget =
        targetUnit === undefined || targetUnit.name === "domain" || targetUnit.name === "contracts";
      const isExternalDependency = !isRelative && workspacePackageName === undefined;

      if (!allowedInternalTarget || isExternalDependency) {
        addViolation("domain-must-remain-pure", sourceFile, specifier);
      }
    }

    if (sourceUnit.id === "apps/web" && targetUnit?.id === "packages/database") {
      addViolation("web-must-not-import-database", sourceFile, specifier);
    }

    if (
      sourceUnit.id === "packages/ui" &&
      targetUnit?.kind === "package" &&
      uiForbiddenPackages.has(targetUnit.name)
    ) {
      addViolation("ui-must-not-own-server-authority", sourceFile, specifier);
    }
  }
}

const findCycle = (graph) => {
  const visited = new Set();
  const active = new Set();
  const stack = [];

  const visit = (node) => {
    if (active.has(node)) {
      const cycleStart = stack.indexOf(node);
      return [...stack.slice(cycleStart), node];
    }

    if (visited.has(node)) {
      return undefined;
    }

    visited.add(node);
    active.add(node);
    stack.push(node);

    for (const dependency of graph.get(node) ?? []) {
      const cycle = visit(dependency);

      if (cycle !== undefined) {
        return cycle;
      }
    }

    stack.pop();
    active.delete(node);
    return undefined;
  };

  for (const node of graph.keys()) {
    const cycle = visit(node);

    if (cycle !== undefined) {
      return cycle;
    }
  }

  return undefined;
};

const unitCycle = findCycle(unitGraph);
if (unitCycle !== undefined) {
  violations.add(`workspace-units-must-not-cycle: ${unitCycle.join(" -> ")}`);
}

const fileCycle = findCycle(fileGraph);
if (fileCycle !== undefined) {
  violations.add(`source-files-must-not-cycle: ${fileCycle.map(relativePath).join(" -> ")}`);
}

if (violations.size > 0) {
  console.error("Dependency boundary check failed:");
  for (const violation of [...violations].sort()) {
    console.error(`- ${violation}`);
  }
  process.exitCode = 1;
} else {
  console.log(`Dependency boundary check passed for ${allFiles.length} source files.`);
}
