import { readFile } from "node:fs/promises";
import { Script } from "node:vm";
import { describe, expect, it } from "vitest";

const source = await readFile(".github/scripts/s22-acceptance-inventory.mjs", "utf8");
const projection = new Script(
  `${source.slice(source.indexOf("/** @param"), source.indexOf("\nif (process.argv")).replace("export const acceptanceInventory", "const acceptanceInventory")}\nacceptanceInventory(sql, backups, alerts, worker, context)`,
);
const context = {
  apiStatus: "200",
  webStatus: "200",
  commit: "a".repeat(40),
  now: "2026-10-03T17:00:00Z",
};
const sql = {
  name: "lead-agent-staging-postgres17",
  project: "lead-agent-stg-739284",
  region: "me-central1",
  state: "RUNNABLE",
  databaseVersion: "POSTGRES_17",
  ipAddresses: [{ type: "PRIVATE", ipAddress: "private-address" }],
  settings: {
    activationPolicy: "ALWAYS",
    tier: "db-f1-micro",
    ipConfiguration: { ipv4Enabled: false },
    backupConfiguration: { enabled: true, pointInTimeRecoveryEnabled: true },
  },
};
const backup = {
  instance: sql.name,
  id: "123",
  status: "SUCCESSFUL",
  startTime: "2026-10-03T16:50:00Z",
  endTime: "2026-10-03T16:55:00Z",
  privateData: "sensitive-value",
};
const alerts = {
  alertPolicies: [
    "Lead Agent staging API server errors",
    "Lead Agent staging Cloud SQL CPU saturation",
  ].map((displayName) => ({
    displayName,
    enabled: true,
    notificationChannels: ["projects/lead-agent-stg-739284/notificationChannels/123"],
  })),
};
const worker = {
  status: { conditions: [{ type: "Ready", status: "True", message: "sensitive-value" }] },
};
const inspect = (overrides: Record<string, unknown> = {}): unknown =>
  projection.runInNewContext({ sql, backups: [backup], alerts, worker, context, ...overrides });

describe("read-only staging acceptance inventory", () => {
  it("records actual successful backup and configured prerequisites without claiming recovery/load", () => {
    expect(inspect()).toMatchObject({
      outcome: "PASS",
      latest_successful_backup: { id: "123", age_seconds: 300 },
      restore_proven: false,
      capacity_proven: false,
      infrastructure_mutated: false,
      secret_payloads_read: false,
    });
  });
  it("never substitutes configured backups for an actual completed backup", () => {
    for (const backups of [
      [],
      [{ ...backup, status: "FAILED" }],
      [{ ...backup, instance: "foreign-instance" }],
      [{ ...backup, endTime: "2026-10-03T17:30:00Z" }],
    ]) {
      expect(inspect({ backups })).toMatchObject({
        outcome: "PREREQUISITE_NOT_VERIFIED",
        latest_successful_backup: null,
        assertions: { successful_backup_exists: false },
      });
    }
  });
  it("fails closed on public IP, stopped worker, disabled alert or unavailable health", () => {
    for (const override of [
      { sql: { ...sql, ipAddresses: [...sql.ipAddresses, { type: "PRIMARY" }] } },
      { worker: { status: { conditions: [{ type: "Ready", status: "False" }] } } },
      { alerts: { alertPolicies: [] } },
      { context: { ...context, apiStatus: "503" } },
      { sql: { ...sql, project: "foreign-project" } },
    ])
      expect(inspect(override)).toHaveProperty("outcome", "PREREQUISITE_NOT_VERIFIED");
  });
  it("emits only allowlisted metadata, excluding credentials, IPs and provider contents", () => {
    expect(
      JSON.stringify(
        inspect({
          sql: { ...sql, password: "sensitive-value" },
          worker: { ...worker, secret: "sensitive-value" },
        }),
      ),
    ).not.toMatch(/sensitive-value|private-address|password|privateData/u);
    expect(() => inspect({ context: { ...context, commit: "sensitive-value" } })).toThrow(
      "S22A001_INVALID_EVIDENCE_CONTEXT",
    );
  });
  it("isolates the workflow from Terraform, deployment, migrations and secret payload access", async () => {
    const workflow = await readFile(".github/workflows/staging-terraform.yml", "utf8");
    const job = workflow.slice(
      workflow.indexOf("  acceptance-inventory:"),
      workflow.indexOf("  terraform:"),
    );
    expect(job).toContain('[[ "$ACTION" == "plan" ]]');
    expect(job).toContain('[[ "$PROJECT_ID" == "lead-agent-stg-739284" ]]');
    expect(job).toContain('git merge-base --is-ancestor "$REQUESTED_SHA" FETCH_HEAD');
    expect(job).toContain("timeout-minutes: 10");
    expect(workflow).toContain("if: inputs.phase != 'acceptance-inventory'");
    expect(job).not.toMatch(/terraform (?:apply|plan)|run jobs execute|versions access|secrets\./u);
    const script = await readFile(".github/scripts/s22-acceptance-inventory.sh", "utf8");
    expect(script).not.toMatch(
      /versions (?:access|add|destroy)|(?:sql|run) .* (?:create|update|delete|execute)|terraform/u,
    );
    expect(script).toContain("--max-time 30");
    expect(script).toContain("timeout 90s");
  });
});
