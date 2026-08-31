import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { canonicalize, canonicalStringify, type JsonValue } from "./canonical.js";
import { getPublicContractCatalog, type PublicContractEntry } from "./catalog.js";
import {
  compareContractSnapshots,
  type ContractSnapshot,
  type SnapshotContract,
} from "./compatibility.js";

export const CONTRACT_SNAPSHOT_PATH = fileURLToPath(
  new URL("../../packages/contracts/snapshots/public-contracts.v1.json", import.meta.url),
);

const SCHEMA_ID_PATTERN = /^[A-Za-z][A-Za-z0-9]*\.v([1-9][0-9]*)$/;

const isJsonObject = (value: unknown): value is { readonly [key: string]: JsonValue } =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const requireStringMember = (
  value: { readonly [key: string]: JsonValue },
  key: string,
  context: string,
) => {
  const member = value[key];

  if (typeof member !== "string") {
    throw new TypeError(`${context} requires a string ${key}`);
  }

  return member;
};

const assertEmbeddedIdentity = (
  schema: { readonly [key: string]: JsonValue },
  schemaId: string,
  schemaVersion: string,
  exportName: string,
) => {
  const properties = schema["properties"];

  if (!isJsonObject(properties)) {
    return;
  }

  const embeddedId = properties["schema_id"];
  if (isJsonObject(embeddedId) && embeddedId["const"] !== schemaId) {
    throw new TypeError(`${exportName} schema_id literal does not match ${schemaId}`);
  }

  const embeddedVersion = properties["schema_version"];
  if (isJsonObject(embeddedVersion) && embeddedVersion["const"] !== schemaVersion) {
    throw new TypeError(`${exportName} schema_version literal does not match ${schemaVersion}`);
  }
};

const snapshotContract = (entry: PublicContractEntry): SnapshotContract => {
  const schema = canonicalize(entry.schema);

  if (!isJsonObject(schema)) {
    throw new TypeError(`${entry.exportName} is not a JSON Schema object`);
  }

  const schemaId = requireStringMember(schema, "$id", entry.exportName);
  const versionMatch = SCHEMA_ID_PATTERN.exec(schemaId);

  if (versionMatch === null) {
    throw new TypeError(`${entry.exportName} has a non-canonical schema ID: ${schemaId}`);
  }

  const schemaVersion = versionMatch[1];
  if (schemaVersion === undefined) {
    throw new TypeError(`${entry.exportName} has no schema version`);
  }

  assertEmbeddedIdentity(schema, schemaId, schemaVersion, entry.exportName);

  return {
    category: entry.category,
    export_name: entry.exportName,
    schema,
    schema_id: schemaId,
    schema_version: schemaVersion,
  };
};

export const buildContractSnapshot = (
  catalog: readonly PublicContractEntry[] = getPublicContractCatalog(),
): ContractSnapshot => {
  const contracts = catalog
    .map(snapshotContract)
    .sort((left, right) => left.export_name.localeCompare(right.export_name));
  const exportNames = new Set<string>();
  const schemaIds = new Set<string>();

  for (const contract of contracts) {
    if (exportNames.has(contract.export_name)) {
      throw new TypeError(`Duplicate public contract export: ${contract.export_name}`);
    }
    exportNames.add(contract.export_name);

    if (schemaIds.has(contract.schema_id)) {
      throw new TypeError(`Duplicate public schema ID: ${contract.schema_id}`);
    }
    schemaIds.add(contract.schema_id);
  }

  return { contracts, snapshot_format_version: 1 };
};

const readSnapshot = async (): Promise<ContractSnapshot> => {
  const serialized = await readFile(CONTRACT_SNAPSHOT_PATH, "utf8");
  return JSON.parse(serialized) as ContractSnapshot;
};

export const checkContractSnapshot = async () => {
  const candidate = buildContractSnapshot();
  const expected = canonicalStringify(candidate);
  let baseline: ContractSnapshot;
  let actual: string;

  try {
    actual = await readFile(CONTRACT_SNAPSHOT_PATH, "utf8");
    baseline = JSON.parse(actual) as ContractSnapshot;
  } catch (error: unknown) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      throw new Error(
        "Contract snapshot is missing. Run `pnpm contracts:snapshot` and review the generated baseline.",
        { cause: error },
      );
    }

    throw error;
  }

  if (actual !== expected) {
    const findings = compareContractSnapshots(baseline, candidate);
    const summary = findings
      .slice(0, 20)
      .map((finding) => `- ${finding.classification}: ${finding.contract} (${finding.detail})`)
      .join("\n");

    throw new Error(
      [
        "Public contract drift detected.",
        summary.length === 0 ? "- non-canonical snapshot serialization" : summary,
        "Run `pnpm contracts:snapshot` only for a deliberate, reviewed contract change.",
      ].join("\n"),
    );
  }

  return candidate;
};

export const writeContractSnapshot = async () => {
  const snapshot = buildContractSnapshot();
  await mkdir(dirname(CONTRACT_SNAPSHOT_PATH), { recursive: true });
  await writeFile(CONTRACT_SNAPSHOT_PATH, canonicalStringify(snapshot), "utf8");
  return snapshot;
};

const main = async () => {
  const operation = process.argv[2];

  if (operation === "--check") {
    const snapshot = await checkContractSnapshot();
    console.log(`Verified ${snapshot.contracts.length} canonical public contracts.`);
    return;
  }

  if (operation === "--write") {
    const snapshot = await writeContractSnapshot();
    const persisted = await readSnapshot();

    if (canonicalStringify(persisted) !== canonicalStringify(snapshot)) {
      throw new Error("Generated contract snapshot did not round-trip canonically");
    }

    console.log(`Wrote ${snapshot.contracts.length} canonical public contracts.`);
    return;
  }

  throw new Error("Expected --check or --write");
};

const entryPoint = process.argv[1];
if (entryPoint !== undefined && pathToFileURL(resolve(entryPoint)).href === import.meta.url) {
  await main();
}
