import {
  AgentActionTypeSchema,
  AgentIntentSchema,
  AgentRiskFlagSchema,
  isSchemaValue,
  type AgentActionType,
  type AgentIntent,
  type AgentRiskFlag,
} from "@lead-agent/contracts";

export const SLICES = [
  "EN_STANDARD",
  "RU_STANDARD",
  "UZ_LATIN_STANDARD",
  "UZ_CYRILLIC",
  "UZ_MIXED_SCRIPT",
  "UZ_SLANG",
  "UZ_TYPOS_PHONETIC",
  "UZ_POLITENESS",
  "UZ_REGIONAL",
  "UZ_RU_CODE_SWITCH",
  "UZ_SHORT_MESSAGES",
  "UZ_LATIN_OUTPUT_COMPLIANCE",
  "PROMPT_INJECTION",
  "SAFETY_ACTION_AUTHORITY",
] as const;
export type Slice = (typeof SLICES)[number];

export interface EvalCase {
  readonly case_id: string;
  readonly slice: Slice;
  readonly input_original: string;
  readonly optional_normalization_hint: string | null;
  readonly expected_language: "uz" | "ru" | "en";
  readonly expected_output_script: "latin" | "cyrillic";
  readonly accepted_intents: readonly AgentIntent[];
  readonly allowed_actions: readonly AgentActionType[];
  readonly forbidden_actions: readonly AgentActionType[];
  readonly safety: Readonly<{
    required_flags: readonly AgentRiskFlag[];
    require_safe_fallback: boolean;
    refusal_allowed: boolean;
    review_requirements: readonly string[];
  }>;
  readonly scenario:
    "ordinary" | "missing_knowledge" | "bound_offer" | "unbound_offer" | "staff_control";
  readonly literal_allowlist: readonly string[];
  readonly provenance: Readonly<{
    kind: "synthetic";
    version: "s13-corpus.v1";
    seed_cluster: string;
    native_review: "pending";
  }>;
  readonly notes: string;
}
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const closed = (value: Record<string, unknown>, keys: readonly string[]): boolean =>
  Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
const text = (value: unknown, max: number): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= max;
const oneOf = (value: unknown, values: readonly string[]): boolean =>
  typeof value === "string" && values.includes(value);
const list = (
  value: unknown,
  predicate: (entry: unknown) => boolean,
  min = 0,
  max = 20,
): value is readonly unknown[] =>
  Array.isArray(value) &&
  value.length >= min &&
  value.length <= max &&
  new Set(value).size === value.length &&
  value.every(predicate);
const disjoint = (left: readonly unknown[], right: readonly unknown[]): boolean =>
  !left.some((entry) => right.includes(entry));
const sourceBound = (literals: readonly unknown[], original: string): boolean =>
  literals.every((literal) => typeof literal === "string" && original.includes(literal));

// Closed, bounded test-data schema. Canonical vocabulary is validated by the
// installed contracts validator; no root dependency or public schema is added.
export const validateEvalCase = (value: unknown): value is EvalCase => {
  if (
    !record(value) ||
    !closed(value, [
      "case_id",
      "slice",
      "input_original",
      "optional_normalization_hint",
      "expected_language",
      "expected_output_script",
      "accepted_intents",
      "allowed_actions",
      "forbidden_actions",
      "safety",
      "scenario",
      "literal_allowlist",
      "provenance",
      "notes",
    ])
  )
    return false;
  const safety = value["safety"],
    provenance = value["provenance"];
  return (
    text(value["case_id"], 100) &&
    /^s13-[a-z0-9-]+$/.test(value["case_id"]) &&
    oneOf(value["slice"], SLICES) &&
    text(value["input_original"], 4_000) &&
    (value["optional_normalization_hint"] === null ||
      text(value["optional_normalization_hint"], 512)) &&
    oneOf(value["expected_language"], ["uz", "ru", "en"]) &&
    oneOf(value["expected_output_script"], ["latin", "cyrillic"]) &&
    list(value["accepted_intents"], (entry) => isSchemaValue(AgentIntentSchema, entry), 1) &&
    list(value["allowed_actions"], (entry) => isSchemaValue(AgentActionTypeSchema, entry), 1) &&
    list(value["forbidden_actions"], (entry) => isSchemaValue(AgentActionTypeSchema, entry)) &&
    disjoint(value["allowed_actions"], value["forbidden_actions"]) &&
    record(safety) &&
    closed(safety, [
      "required_flags",
      "require_safe_fallback",
      "refusal_allowed",
      "review_requirements",
    ]) &&
    list(safety["required_flags"], (entry) => isSchemaValue(AgentRiskFlagSchema, entry)) &&
    typeof safety["require_safe_fallback"] === "boolean" &&
    typeof safety["refusal_allowed"] === "boolean" &&
    list(safety["review_requirements"], (entry) => text(entry, 500), 1) &&
    oneOf(value["scenario"], [
      "ordinary",
      "missing_knowledge",
      "bound_offer",
      "unbound_offer",
      "staff_control",
    ]) &&
    list(value["literal_allowlist"], (entry) => text(entry, 100), 0, 8) &&
    sourceBound(value["literal_allowlist"], value["input_original"]) &&
    record(provenance) &&
    closed(provenance, ["kind", "version", "seed_cluster", "native_review"]) &&
    provenance["kind"] === "synthetic" &&
    provenance["version"] === "s13-corpus.v1" &&
    provenance["native_review"] === "pending" &&
    text(provenance["seed_cluster"], 80) &&
    text(value["notes"], 1_000)
  );
};

const SOURCE_TYPES = [
  "provider_documentation",
  "provider_terms",
  "company_documentation",
  "company_engineering",
  "vendor_product",
  "vendor_case_study",
  "research_preprint",
  "benchmark_repository",
  "peer_reviewed_research",
  "indexed_vendor_product",
  "indexed_provider_documentation",
];
export const validateResearchManifest = (value: unknown): boolean =>
  record(value) &&
  closed(value, ["version", "sources"]) &&
  value["version"] === "s13-research.v1" &&
  list(
    value["sources"],
    (source) =>
      record(source) &&
      closed(source, [
        "title",
        "publisher",
        "url",
        "retrieved_at",
        "source_type",
        "supports_claims",
      ]) &&
      text(source["title"], 200) &&
      text(source["publisher"], 200) &&
      text(source["url"], 500) &&
      /^https:\/\/[a-z0-9.-]+\//i.test(source["url"]) &&
      text(source["retrieved_at"], 10) &&
      /^\d{4}-\d{2}-\d{2}$/.test(source["retrieved_at"]) &&
      !Number.isNaN(Date.parse(source["retrieved_at"])) &&
      new Date(source["retrieved_at"]).toISOString().slice(0, 10) === source["retrieved_at"] &&
      oneOf(source["source_type"], SOURCE_TYPES) &&
      list(source["supports_claims"], (claim) => text(claim, 100), 1, 12),
    20,
    80,
  );
