import { execFileSync, spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import {
  connectionFaultBaseline,
  connectionFaultProfileReceipt,
  verifyConnectionFaultProfilePlan,
} from "./s22-connection-fault-profile-plan-check.mjs";

// Fixed mock-provider test only. No auth, backend, arbitrary CLI or cloud-run mode.
const root = "infra/deploy/gcp/staging";
try {
  const source = readFileSync(`${root}/tests/connection_fault.tftest.hcl`, "utf8");
  if (
    !/^mock_provider "google" \{/mu.test(source) ||
    /^\s*provider\s+"/mu.test(source) ||
    /\bmodule\s*\{/u.test(source)
  )
    throw new Error("mock boundary");
  if (process.env.S22_CONNECTION_FAULT_PROFILE || process.env.TF_VAR_s22_connection_fault_profile)
    throw new Error("private input");
  const engine = JSON.parse(
    execFileSync("terraform", ["version", "-json"], {
      encoding: "utf8",
      stdio: "pipe",
      timeout: 10_000,
      maxBuffer: 16_384,
      windowsHide: true,
    }),
  );
  if (engine.terraform_version !== "1.14.7") throw new Error("engine version");
  const child = spawn(
    "terraform",
    [
      `-chdir=${root}`,
      "test",
      `-filter=${join("tests", "connection_fault.tftest.hcl")}`,
      "-json",
      "-verbose",
      "-no-color",
    ],
    {
      timeout: 180_000,
      stdio: "pipe",
      windowsHide: true,
    },
  );
  const finished = new Promise((resolve) => {
    child.once("error", () => resolve(false));
    child.once("close", (code) => resolve(code === 0));
  });
  let errorBytes = 0;
  child.stderr.on("data", (chunk) => {
    errorBytes += chunk.length;
    if (errorBytes > 256_000) child.kill();
  });
  let summary;
  const plans = new Map();
  let outputBytes = 0;
  try {
    for await (const line of createInterface({ input: child.stdout, crlfDelay: Infinity })) {
      outputBytes += Buffer.byteLength(line);
      if (outputBytes > 256 * 1024 * 1024 || line.length > 32 * 1024 * 1024)
        throw new Error("output bound");
      const message = JSON.parse(line);
      if (message.type === "test_summary") summary = message.test_summary;
      if (message.type === "test_plan") {
        const generated = message.test_plan;
        // Discard thousands of unused provider schemas before reading another
        // line. Never buffer/print the full verbose stream or parser exceptions.
        const types = new Set(generated.resource_changes.map((row) => row.type));
        generated.provider_schemas = Object.fromEntries(
          Object.entries(generated.provider_schemas).map(([name, schema]) => [
            name,
            {
              resource_schemas: Object.fromEntries(
                Object.entries(schema.resource_schemas).filter(([type]) => types.has(type)),
              ),
            },
          ]),
        );
        plans.set(message["@testrun"], generated);
      }
    }
    if (!(await finished)) throw new Error("mock execution");
  } catch {
    child.kill();
    await finished;
    throw new Error("mock execution");
  }
  if (!summary || summary.status !== "pass" || summary.passed !== 9 || summary.skipped !== 0)
    throw new Error("mock tests");
  const enable = plans.get("enable_plan");
  const api = enable?.resource_changes?.find(
    (row) => row.address === "google_cloud_run_v2_service.api[0]",
  );
  const rawProfile = api?.change.after.template[0].containers[0].env.find(
    (entry) => entry.name === "S22_CONNECTION_FAULT_PROFILE",
  )?.value;
  if (typeof rawProfile !== "string") throw new Error("mock profile");
  for (const [name, mode, stage] of [
    ["default_off_plan", "remove", "verify"],
    ["enable_plan", "enable", "plan"],
    ["remove_plan", "remove", "plan"],
    ["removed_converges", "remove", "verify"],
  ]) {
    const generated = plans.get(name);
    if (!generated) throw new Error("mock plan");
    // Terraform test emits changes/schema, not a saved binary's full inventory
    // wrapper/variables. Derive inventories from its actual before/after rows;
    // never present these fixture wrappers as a deployable saved plan.
    const inventory = (side) => ({
      resources: generated.resource_changes
        .filter((row) => row.mode === "managed")
        .map((row) => ({
          address: row.address,
          type: row.type,
          provider_name: row.provider_name,
          mode: row.mode,
          values: row.change[side],
        })),
    });
    const plan = {
      format_version: generated.plan_format_version,
      terraform_version: engine.terraform_version,
      resource_changes: generated.resource_changes,
      resource_drift: generated.resource_drift,
      variables: Object.fromEntries(
        Object.entries({
          ...connectionFaultBaseline,
          s22_connection_fault_enabled: mode === "enable" ? "true" : "false",
          s22_connection_fault_profile: mode === "enable" ? rawProfile : "",
        }).map(([key, value]) => [key, { value }]),
      ),
      prior_state: { values: { root_module: inventory("before") } },
      planned_values: { root_module: inventory("after") },
    };
    console.log(`mock_check=${name}`);
    const result = verifyConnectionFaultProfilePlan(
      plan,
      { provider_schemas: generated.provider_schemas },
      {
        mode,
        stage,
        rawProfile,
        activationReceipt: connectionFaultProfileReceipt(rawProfile),
        now: Date.parse("2030-01-01T00:00:00.000Z"),
      },
    );
    console.log(
      `mock_${name}=PASS; configurations=${result.managedResources}; changes=${result.changedResources}`,
    );
  }
  console.log(`terraform_mock_runs=PASS; live_resources=0; live_authority=false`);
} catch {
  console.error("S22_CONNECTION_FAULT_TERRAFORM_MOCK_DENIED");
  process.exitCode = 1;
}
