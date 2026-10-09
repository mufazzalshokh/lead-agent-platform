import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const runtimeAddresses = new Map([
  ["google_cloud_run_v2_service.api[0]", "api"],
  ["google_cloud_run_v2_service.web[0]", "web"],
  ["google_cloud_run_v2_worker_pool.worker[0]", "worker"],
  ["google_cloud_run_v2_job.migrator[0]", "migrator"],
]);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const requireSafe = (condition) => {
  if (!condition) throw new Error("S22_FULL_RUNTIME_CONFIGURATION_DENIED");
};
const canonical = (value) => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])]),
    );
  return value;
};
const unknown = (mask) => {
  if (mask === undefined || mask === false) return false;
  if (mask === true) return true;
  requireSafe(mask !== null && typeof mask === "object");
  return Object.values(mask).some(unknown);
};
const configurable = (block) =>
  Object.values(block.attributes ?? {}).some(
    (attribute) => attribute.optional || attribute.required,
  ) || Object.values(block.block_types ?? {}).some((nested) => configurable(nested.block));

// Provider-computed revisions/timestamps may change. Every configurable value,
// including optional+computed attributes, must be known and independently compared.
function configuration(value, block, mask = {}) {
  requireSafe(value !== null && typeof value === "object" && !Array.isArray(value));
  requireSafe(mask !== true && (mask === false || (mask !== null && typeof mask === "object")));
  const attributes = block.attributes ?? {};
  const blocks = block.block_types ?? {};
  requireSafe(Object.keys(value).every((key) => key in attributes || key in blocks));
  const result = {};
  for (const key of Object.keys(attributes).sort()) {
    const attribute = attributes[key];
    if (!attribute.optional && !attribute.required) continue;
    requireSafe(!unknown(mask?.[key]));
    result[key] = canonical(value[key] ?? null);
    if (Array.isArray(attribute.type) && attribute.type[0] === "set" && Array.isArray(result[key]))
      result[key].sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  }
  for (const key of Object.keys(blocks).sort()) {
    const nested = blocks[key];
    if (!configurable(nested.block)) continue;
    const field = value[key];
    const fieldMask = mask?.[key] ?? {};
    requireSafe(fieldMask !== true);
    if (field === null || field === undefined) {
      requireSafe(!unknown(fieldMask));
      result[key] = null;
    } else if (["list", "set"].includes(nested.nesting_mode)) {
      requireSafe(Array.isArray(field));
      result[key] = field.map((entry, index) =>
        configuration(entry, nested.block, fieldMask[index] ?? {}),
      );
      if (nested.nesting_mode === "set")
        result[key].sort((left, right) =>
          JSON.stringify(left).localeCompare(JSON.stringify(right)),
        );
    } else if (nested.nesting_mode === "map") {
      result[key] = Object.fromEntries(
        Object.keys(field)
          .sort()
          .map((entry) => [
            entry,
            configuration(field[entry], nested.block, fieldMask[entry] ?? {}),
          ]),
      );
    } else {
      requireSafe(["single", "group"].includes(nested.nesting_mode));
      result[key] = configuration(field, nested.block, fieldMask);
    }
  }
  return result;
}

function permittedRuntime(configurationValue, workload, variables, after) {
  const value = structuredClone(configurationValue);
  const container =
    workload === "migrator"
      ? value.template?.[0]?.template?.[0]?.containers?.[0]
      : value.template?.[0]?.containers?.[0];
  requireSafe(container !== undefined && Array.isArray(container.env));
  const environment = new Map();
  for (const entry of container.env) {
    requireSafe(typeof entry.name === "string" && !environment.has(entry.name));
    environment.set(entry.name, entry.value);
  }
  if (after) {
    requireSafe(container.image === variables[`${workload}_image`].value);
    requireSafe(value.labels?.["git-sha"] === variables.git_commit_sha.value.slice(0, 12));
    for (const [name, expected] of [
      ["DEPLOYMENT_GIT_SHA", variables.git_commit_sha.value],
      ["DEPLOYMENT_TIMESTAMP", variables.deployment_timestamp.value],
      ["DEPLOYMENT_MIGRATION_HEAD", "0031_s22_widget_inbound_route_management"],
    ])
      requireSafe(environment.get(name) === expected);
    if (["api", "migrator"].includes(workload))
      requireSafe(
        environment.get("DEPLOYMENT_IMAGE_DIGEST") === variables[`${workload}_image`].value,
      );
  }
  const permitted = new Set(["DEPLOYMENT_GIT_SHA", "DEPLOYMENT_TIMESTAMP"]);
  if (["api", "migrator"].includes(workload)) permitted.add("DEPLOYMENT_IMAGE_DIGEST");
  if (workload === "worker") {
    const mode = environment.get("AI_JOURNEY_MODE");
    const session = environment.get("AI_JOURNEY_WIDGET_SESSION_ID") ?? "";
    requireSafe(["paused", "booking", "widget_booking"].includes(mode));
    requireSafe(
      typeof session === "string" &&
        (mode === "widget_booking" ? uuid.test(session) : session === ""),
    );
    if (after) {
      requireSafe(mode === variables.ai_journey_mode.value);
      requireSafe(session === variables.ai_journey_widget_session_id.value);
    }
    permitted.add("AI_JOURNEY_MODE");
    permitted.add("AI_JOURNEY_WIDGET_SESSION_ID");
  }
  requireSafe(
    container.env
      .filter((entry) => permitted.has(entry.name))
      .every(
        (entry) =>
          entry.value_source === null ||
          (Array.isArray(entry.value_source) && entry.value_source.length === 0),
      ),
  );
  container.env = container.env
    .filter((entry) => !permitted.has(entry.name))
    .sort((left, right) => left.name.localeCompare(right.name));
  delete container.image;
  delete value.labels["git-sha"];
  return value;
}

export function verifyFullRuntimeConfiguration(plan, providerSchema) {
  requireSafe(Array.isArray(plan.resource_changes) && plan.variables !== null);
  const variables = plan.variables;
  const mode = variables.ai_journey_mode?.value;
  const session = variables.ai_journey_widget_session_id?.value;
  requireSafe(["paused", "booking", "widget_booking"].includes(mode));
  requireSafe(
    typeof session === "string" &&
      (mode === "widget_booking" ? uuid.test(session) : session === ""),
  );
  const schemas =
    providerSchema.provider_schemas?.["registry.terraform.io/hashicorp/google"]?.resource_schemas;
  requireSafe(schemas !== undefined);
  const seen = new Set();
  let managed = 0;
  let changed = 0;
  for (const resource of plan.resource_changes) {
    if (resource.mode !== "managed") continue;
    requireSafe(resource.provider_name === "registry.terraform.io/hashicorp/google");
    requireSafe(!seen.has(resource.address));
    seen.add(resource.address);
    const block = schemas[resource.type]?.block;
    requireSafe(block !== undefined);
    const change = resource.change;
    const after = configuration(change.after, block, change.after_unknown);
    const workload = runtimeAddresses.get(resource.address);
    requireSafe(
      ["update", "no-op"].some(
        (action) => JSON.stringify(change.actions) === JSON.stringify([action]),
      ),
    );
    requireSafe((change.replace_paths ?? []).length === 0);
    const before = configuration(change.before, block);
    if (change.actions[0] === "update") {
      requireSafe(workload !== undefined);
      requireSafe(
        JSON.stringify(canonical(permittedRuntime(before, workload, variables, false))) ===
          JSON.stringify(canonical(permittedRuntime(after, workload, variables, true))),
      );
      changed++;
    } else {
      requireSafe(JSON.stringify(canonical(before)) === JSON.stringify(canonical(after)));
    }
    managed++;
  }
  requireSafe(changed === 4 && [...runtimeAddresses.keys()].every((address) => seen.has(address)));
  return { managedResources: managed, changedResources: changed };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = verifyFullRuntimeConfiguration(
      JSON.parse(readFileSync(process.argv[2], "utf8")),
      JSON.parse(readFileSync(process.argv[3], "utf8")),
    );
    console.log(`full_runtime_configuration_verified=${result.managedResources}`);
    console.log("full_runtime_configurable_unknowns=NONE");
    console.log("full_runtime_unreviewed_configuration_changes=NONE");
  } catch {
    console.error("S22_FULL_RUNTIME_CONFIGURATION_DENIED");
    process.exitCode = 1;
  }
}
