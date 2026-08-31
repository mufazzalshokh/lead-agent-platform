import { canonicalStringify, type JsonValue } from "./canonical.js";

export type SnapshotContract = {
  readonly category: string;
  readonly export_name: string;
  readonly schema: JsonValue;
  readonly schema_id: string;
  readonly schema_version: string;
};

export type ContractSnapshot = {
  readonly contracts: readonly SnapshotContract[];
  readonly snapshot_format_version: 1;
};

export type CompatibilityClassification = "additive" | "breaking" | "version-requiring";

export type CompatibilityFinding = {
  readonly classification: CompatibilityClassification;
  readonly contract: string;
  readonly detail: string;
};

export const compareContractSnapshots = (
  baseline: ContractSnapshot,
  candidate: ContractSnapshot,
): readonly CompatibilityFinding[] => {
  const baselineByName = new Map(
    baseline.contracts.map((contract) => [contract.export_name, contract]),
  );
  const candidateByName = new Map(
    candidate.contracts.map((contract) => [contract.export_name, contract]),
  );
  const findings: CompatibilityFinding[] = [];

  for (const [exportName, baselineContract] of baselineByName) {
    const candidateContract = candidateByName.get(exportName);

    if (candidateContract === undefined) {
      findings.push({
        classification: "breaking",
        contract: exportName,
        detail: "public contract was removed",
      });
      continue;
    }

    if (
      baselineContract.schema_id !== candidateContract.schema_id ||
      baselineContract.schema_version !== candidateContract.schema_version
    ) {
      findings.push({
        classification: "version-requiring",
        contract: exportName,
        detail: "schema identity or declared version changed",
      });
      continue;
    }

    if (
      canonicalStringify(baselineContract.schema) !== canonicalStringify(candidateContract.schema)
    ) {
      findings.push({
        classification: "version-requiring",
        contract: exportName,
        detail: "same-version schema content changed",
      });
    }
  }

  for (const exportName of candidateByName.keys()) {
    if (!baselineByName.has(exportName)) {
      findings.push({
        classification: "additive",
        contract: exportName,
        detail: "new independently identified public contract was added",
      });
    }
  }

  return findings.sort(
    (left, right) =>
      left.contract.localeCompare(right.contract) ||
      left.classification.localeCompare(right.classification),
  );
};
