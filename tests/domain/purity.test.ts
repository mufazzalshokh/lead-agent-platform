import fs from "node:fs";
import { builtinModules } from "node:module";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const domainRoot = path.resolve("packages/domain");
const sourceRoot = path.join(domainRoot, "src");

const allowedWorkspaceImports = new Set(["@lead-agent/contracts"]);
const prohibitedDependencySections = [
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
] as const;

const nodeModuleSpecifiers = new Set(
  builtinModules.flatMap((specifier) => [specifier, `node:${specifier}`]),
);

const infrastructureTokenPattern =
  /(?:^|[^a-z0-9])(?:filesystem|network|database|provider|framework|fastify|nextjs|react|postgres|postgresql|drizzle|pg-boss|pgboss|openai|telegram|auth0|typebox)(?:[^a-z0-9]|$)/i;

const infrastructureIdentifierPattern =
  /(?:filesystem|network|database|provider|framework|fastify|nextjs|react|postgres|postgresql|drizzle|pgboss|openai|telegram|auth0|typebox)/i;

const forbiddenRuntimeIdentifiers = new Set([
  "Buffer",
  "Bun",
  "Date",
  "Deno",
  "EventSource",
  "NodeJS",
  "WebSocket",
  "XMLHttpRequest",
  "__dirname",
  "__filename",
  "fetch",
  "fs",
  "module",
  "performance",
  "process",
  "require",
]);

const aggregateModulePattern =
  /(?:^|\/)(?:lead|conversation|handoff|appointment[-_]?request)(?:[./_-]|$)/i;

const aggregateMachineIdentifierPatterns = [
  /^(?:Lead|Conversation|Handoff|AppointmentRequest)$/,
  /^(?:Lead|Conversation|Handoff|AppointmentRequest).*(?:Aggregate|Command|Machine|State|Status|Transition)$/,
  /^(?:advance|assign|cancel|close|confirm|create|disqualify|expire|qualify|reject|reopen|resolve|transition|update)(?:Lead|Conversation|Handoff|AppointmentRequest)$/,
  /^(?:lead|conversation|handoff|appointment_request)_(?:command|state|status|transition)$/,
] as const;

const aggregateEventPrefixes = [
  "appointment_request.",
  "conversation.",
  "handoff.",
  "lead.",
] as const;

const toPosixPath = (filePath: string) => filePath.split(path.sep).join("/");

const collectTypeScriptFiles = (directory: string): string[] =>
  fs
    .readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const entryPath = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        return collectTypeScriptFiles(entryPath);
      }

      return entry.isFile() && entry.name.endsWith(".ts") ? [entryPath] : [];
    })
    .sort();

const sourceFiles = collectTypeScriptFiles(sourceRoot);

const parseSource = (filePath: string) =>
  ts.createSourceFile(
    filePath,
    fs.readFileSync(filePath, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );

const recordStringLiteral = (values: Set<string>, node: ts.Node | undefined) => {
  if (node !== undefined && ts.isStringLiteralLike(node)) {
    values.add(node.text);
  }
};

const collectModuleSpecifiers = (sourceFile: ts.SourceFile) => {
  const specifiers = new Set<string>();

  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      recordStringLiteral(specifiers, node.moduleSpecifier);
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference)
    ) {
      recordStringLiteral(specifiers, node.moduleReference.expression);
    } else if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteralLike(node.argument.literal)
    ) {
      specifiers.add(node.argument.literal.text);
    } else if (ts.isCallExpression(node)) {
      const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      const isRequire = ts.isIdentifier(node.expression) && node.expression.text === "require";

      if (isDynamicImport || isRequire) {
        const argument = node.arguments[0];

        if (argument === undefined || !ts.isStringLiteralLike(argument)) {
          specifiers.add("<non-literal module specifier>");
        } else {
          specifiers.add(argument.text);
        }
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return [...specifiers].sort();
};

const isInsideSourceRoot = (targetPath: string) => {
  const relativeTarget = path.relative(sourceRoot, targetPath);

  return (
    relativeTarget === "" ||
    (!relativeTarget.startsWith(`..${path.sep}`) &&
      relativeTarget !== ".." &&
      !path.isAbsolute(relativeTarget))
  );
};

const readManifest = (): Record<string, unknown> => {
  const parsed: unknown = JSON.parse(
    fs.readFileSync(path.join(domainRoot, "package.json"), "utf8"),
  );

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new TypeError("packages/domain/package.json must contain a JSON object");
  }

  return parsed as Record<string, unknown>;
};

describe("domain package purity", () => {
  it("uses only internal relative modules and no environment or infrastructure APIs", () => {
    expect(sourceFiles.length).toBeGreaterThan(0);

    const violations = new Set<string>();

    for (const filePath of sourceFiles) {
      const relativeFile = toPosixPath(path.relative(sourceRoot, filePath));
      const sourceFile = parseSource(filePath);

      for (const specifier of collectModuleSpecifiers(sourceFile)) {
        if (nodeModuleSpecifiers.has(specifier) || specifier.startsWith("node:")) {
          violations.add(`${relativeFile}: Node import ${specifier}`);
          continue;
        }

        if (!specifier.startsWith(".")) {
          if (!allowedWorkspaceImports.has(specifier)) {
            violations.add(`${relativeFile}: unapproved package import ${specifier}`);
          }
          continue;
        }

        if (!isInsideSourceRoot(path.resolve(path.dirname(filePath), specifier))) {
          violations.add(`${relativeFile}: import escapes domain source ${specifier}`);
        }

        if (infrastructureTokenPattern.test(specifier)) {
          violations.add(`${relativeFile}: infrastructure module token ${specifier}`);
        }
      }

      if (infrastructureTokenPattern.test(relativeFile)) {
        violations.add(`${relativeFile}: infrastructure token in module path`);
      }

      const visit = (node: ts.Node) => {
        if (ts.isIdentifier(node)) {
          if (forbiddenRuntimeIdentifiers.has(node.text)) {
            violations.add(`${relativeFile}: forbidden runtime identifier ${node.text}`);
          }

          if (infrastructureIdentifierPattern.test(node.text)) {
            violations.add(`${relativeFile}: infrastructure identifier ${node.text}`);
          }
        }

        if (ts.isStringLiteralLike(node) && infrastructureTokenPattern.test(node.text)) {
          violations.add(`${relativeFile}: infrastructure token in string literal`);
        }

        ts.forEachChild(node, visit);
      };

      visit(sourceFile);
    }

    expect([...violations].sort()).toEqual([]);
  });

  it("declares only the canonical contracts workspace dependency", () => {
    const manifest = readManifest();
    const declaredProhibitedSections = prohibitedDependencySections.filter((section) =>
      Object.hasOwn(manifest, section),
    );

    expect(manifest["dependencies"]).toEqual({
      "@lead-agent/contracts": "workspace:*",
    });
    expect(declaredProhibitedSections).toEqual([]);
  });

  it("contains no aggregate-specific state-machine or transition modules", () => {
    const violations = new Set<string>();

    for (const filePath of sourceFiles) {
      const relativeFile = toPosixPath(path.relative(sourceRoot, filePath));
      const sourceFile = parseSource(filePath);

      if (aggregateModulePattern.test(relativeFile)) {
        violations.add(`${relativeFile}: aggregate-specific module path`);
      }

      const visit = (node: ts.Node) => {
        if (
          ts.isIdentifier(node) &&
          aggregateMachineIdentifierPatterns.some((pattern) => pattern.test(node.text))
        ) {
          violations.add(`${relativeFile}: aggregate-specific identifier ${node.text}`);
        }

        if (
          ts.isStringLiteralLike(node) &&
          aggregateEventPrefixes.some((prefix) => node.text.startsWith(prefix))
        ) {
          violations.add(`${relativeFile}: aggregate-specific event literal ${node.text}`);
        }

        ts.forEachChild(node, visit);
      };

      visit(sourceFile);
    }

    expect([...violations].sort()).toEqual([]);
  });
});
