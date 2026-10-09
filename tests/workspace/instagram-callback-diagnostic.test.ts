import { readFile } from "node:fs/promises";
import { Script } from "node:vm";
import { describe, expect, it } from "vitest";

const diagnosticSource = await readFile(
  ".github/scripts/s22-instagram-callback-diagnose.mjs",
  "utf8",
);
const projectionSource = diagnosticSource
  .slice(diagnosticSource.indexOf("/** @param"), diagnosticSource.indexOf("\nif (process.argv"))
  .replace("export const instagramCallbackEvidence", "const instagramCallbackEvidence");
const projection = new Script(`${projectionSource}\ninstagramCallbackEvidence(logs, requestId)`);
const instagramCallbackEvidence = (logs: unknown, requestId: string): unknown =>
  projection.runInNewContext({ logs, requestId });

const entry = {
  resource: {
    labels: {
      service_name: "lead-agent-staging-api",
      revision_name: "lead-agent-staging-api-00013-ct4",
    },
  },
  timestamp: "2026-10-03T15:40:00Z",
  jsonPayload: {
    requestId: "req-1j",
    instagramCallbackFailure: "provider",
    instagramCallbackStage: "code_exchange",
    providerCategory: "permanent_rejection",
    providerDiagnostic: {
      operation: "profile",
      reason: "http_rejection",
      httpStatus: 400,
      providerCode: 100,
      providerSubcode: 33,
    },
    message: "private token",
    authorizationCode: "private code",
    state: "private nonce",
  },
};
describe("request-scoped Instagram callback evidence", () => {
  it("configures API and worker with the same trusted canonical credential namespace", async () => {
    const runtime = await readFile("infra/deploy/gcp/staging/runtime.tf", "utf8");
    expect(runtime).toContain(
      'channel_credential_resource = "projects/${data.google_project.staging.number}/secrets/${google_secret_manager_secret.channel_credentials.secret_id}"',
    );
    expect(
      runtime.match(/CREDENTIAL_SECRET_RESOURCE\s*= local.channel_credential_resource/gu),
    ).toHaveLength(2);
    expect(runtime).not.toMatch(
      /CREDENTIAL_SECRET_RESOURCE\s*= google_secret_manager_secret.channel_credentials.id/u,
    );
  });
  it("projects the exact request and finite failure fields, excluding sensitive/foreign content", () => {
    const result = instagramCallbackEvidence(
      [entry, { ...entry, jsonPayload: { ...entry.jsonPayload, requestId: "req-other" } }],
      "req-1j",
    );
    expect(result).toHaveProperty("entries.length", 1);
    expect(result).toMatchObject({
      entries: [
        {
          stage: "code_exchange",
          provider_operation: "profile",
          provider_code: 100,
          provider_subcode: 33,
        },
      ],
    });
    expect(JSON.stringify(result)).not.toMatch(/private|req-other|authorizationCode|nonce/u);
  });
  it("does not echo attacker-controlled diagnostic fields", () => {
    const result = instagramCallbackEvidence(
      [
        {
          ...entry,
          jsonPayload: {
            ...entry.jsonPayload,
            instagramCallbackStage: "private-token",
            databaseCode: "private-sql",
            providerDiagnostic: { operation: "private-url", providerCode: "private" },
          },
        },
      ],
      "req-1j",
    );
    expect(JSON.stringify(result)).not.toContain("private");
    expect(result).toMatchObject({ entries: [{ stage: null }] });
  });
  it("fails closed on missing request evidence or malformed input", () => {
    expect(() => instagramCallbackEvidence([], "req-1j")).toThrow("S22I202");
    expect(() => instagramCallbackEvidence([entry], 'req-1j" OR true')).toThrow("S22I201");
    expect(() => instagramCallbackEvidence([entry], "req-other")).toThrow("S22I202");
  });
  it("uses only the plan-only diagnostic phase and skips the unrelated auth reader", async () => {
    const workflow = await readFile(".github/workflows/staging-terraform.yml", "utf8");
    expect(workflow).toContain("Read request-scoped sanitized Instagram callback failure");
    expect(workflow).toContain('jsonPayload.requestId=\\"$REQUEST_ID\\"');
    expect(workflow).toContain(
      "env.S22_ACTION == 'plan' && startsWith(env.S22_AUTH_CALLBACK_REQUEST_ID, 'instagram:')",
    );
    expect(workflow).toContain(
      "env.S22_ACTION == 'plan' && !startsWith(env.S22_AUTH_CALLBACK_REQUEST_ID, 'instagram:')",
    );
    expect(workflow).toContain("--format='json(name,createTime,state)'");
    const reader = workflow.slice(
      workflow.indexOf("- name: Read request-scoped sanitized Instagram"),
      workflow.indexOf("- name: Upload sanitized Instagram callback"),
    );
    expect(reader).not.toContain("versions access");
    expect(reader).not.toContain("versions add");
    expect(reader).not.toContain("versions destroy");
  });
});
