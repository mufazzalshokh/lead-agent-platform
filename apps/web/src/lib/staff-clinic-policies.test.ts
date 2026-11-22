import {
  BusinessPolicySchema,
  CreateBusinessPolicyDraftInputSchema,
  isSchemaValue,
} from "@lead-agent/contracts";
import { describe, expect, it, vi } from "vitest";
import {
  preparePolicyChange,
  qualificationPolicyKey,
  writeQualificationPolicy,
} from "./staff-clinic-policies";

const id = "0193f1a8-7f65-7c28-a434-a10796c47701";
const actor = "0193f1a8-7f65-7c28-a434-a10796c47702";
const at = "2026-11-21T10:00:00.000Z";
const key = "lead.qualification";

const draftCommand = () => {
  const command = preparePolicyChange({ action: "create", key }, "draft-command");
  if (command === null) throw new Error("Expected draft command");
  return command;
};

const draft = () => {
  const body: unknown = JSON.parse(draftCommand().body);
  if (!isSchemaValue(CreateBusinessPolicyDraftInputSchema, body))
    throw new Error("Invalid draft payload");
  const policy = {
    ...body,
    content_hash: "ab",
    created_at: at,
    effective_from: null,
    effective_to: null,
    policy_id: id,
    published_by_user_id: null,
    status: "draft",
    version_no: 2,
  };
  if (!isSchemaValue(BusinessPolicySchema, policy) || policy.policy_type !== "qualification")
    throw new Error("Invalid policy fixture");
  return policy;
};

const published = () => {
  const policy = {
    ...draft(),
    status: "published",
    effective_from: at,
    published_by_user_id: actor,
  };
  if (!isSchemaValue(BusinessPolicySchema, policy) || policy.policy_type !== "qualification")
    throw new Error("Invalid published fixture");
  return policy;
};

const response = (data: unknown) => Response.json({ data, meta: { request_id: "request-policy" } });

describe("staff qualification policy", () => {
  it("creates a draft using the fixed V1 rules without publishing it", async () => {
    const command = draftCommand();
    const body: unknown = JSON.parse(command.body);
    expect(body).toMatchObject({
      policy_type: "qualification",
      schema_version: 1,
      rules: {
        require_contactability: true,
        require_medical_eligibility: false,
      },
    });
    const request = vi.fn().mockResolvedValue(response(draft()));
    expect(await writeQualificationPolicy(request, command, "csrf-token")).toMatchObject({
      kind: "saved",
      resource: { status: "draft" },
    });
    expect(request).toHaveBeenCalledWith(
      "/v1/staff/business-policies",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("uses the existing policy key and stops publication when the active policy is ambiguous", () => {
    const policy = published();
    expect(qualificationPolicyKey([])).toBe(key);
    expect(
      qualificationPolicyKey([draft(), { ...policy, policy_key: "clinic.qualification" }]),
    ).toBe("clinic.qualification");
    expect(
      qualificationPolicyKey([policy, { ...policy, policy_key: "clinic.qualification" }]),
    ).toBeNull();
    expect(preparePolicyChange({ action: "publish", policy }, "publish-command")).toBeNull();
    expect(preparePolicyChange({ action: "retire", policy: draft() }, "retire-command")).toBeNull();
  });

  it("retries the exact saved-version publication command after losing a response", async () => {
    const command = preparePolicyChange({ action: "publish", policy: draft() }, "publish-command");
    if (command === null) throw new Error("Expected publication command");
    const request = vi
      .fn()
      .mockRejectedValueOnce(new Error("Connection lost"))
      .mockResolvedValueOnce(response(published()));
    expect(await writeQualificationPolicy(request, command, "csrf-token")).toMatchObject({
      kind: "uncertain",
    });
    expect(await writeQualificationPolicy(request, command, "csrf-token")).toEqual({
      kind: "saved",
      resource: published(),
    });
    expect(request).toHaveBeenLastCalledWith(`/v1/staff/business-policies/${id}/publish`, {
      method: "POST",
      body: "{}",
      headers: {
        "content-type": "application/json",
        "x-csrf-token": "csrf-token",
        "idempotency-key": "staff.policy.publish-command",
        "if-match": `"${id}:2"`,
      },
    });
    expect(request.mock.calls[0]).toEqual(request.mock.calls[1]);
  });
});
