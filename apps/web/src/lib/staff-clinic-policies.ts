import {
  BusinessPolicySchema,
  CreateBusinessPolicyDraftInputSchema,
  createCollectionEnvelopeSchema,
  createSuccessEnvelopeSchema,
  isSchemaValue,
  type BusinessPolicy,
  type QualificationPolicyV1Rules,
} from "@lead-agent/contracts";
import {
  readConfigurationCatalog,
  readConfigurationPage,
  writeClinicConfiguration,
} from "./staff-clinic-configuration";
import type { StaffRequest } from "./staff-request";
import { makeIdempotencyKey } from "./staff-ui";

const path = "/v1/staff/business-policies";
const Policies = createCollectionEnvelopeSchema(
  BusinessPolicySchema,
  "StaffConfigurationPolicyCollectionResponse.v1",
);
const Policy = createSuccessEnvelopeSchema(
  BusinessPolicySchema,
  "StaffConfigurationPolicyResponse.v1",
);
type QualificationPolicy = Extract<BusinessPolicy, { policy_type: "qualification" }>;

const rules: QualificationPolicyV1Rules = {
  disqualification_reasons: [
    "service_not_offered",
    "location_not_served",
    "not_interested",
    "outside_business_scope",
    "spam_or_abuse",
  ],
  require_budget: false,
  require_contactability: true,
  require_medical_eligibility: false,
  require_positive_next_step_intent: true,
  require_preferred_time: false,
  require_service_interest: true,
  require_supported_service_location: true,
};

export const listQualificationPolicies = async (request: StaffRequest) => {
  const rows = await readConfigurationCatalog((cursor) =>
    readConfigurationPage(request, `${path}?policy_type=qualification`, Policies, cursor),
  );
  return rows.filter((row): row is QualificationPolicy => row.policy_type === "qualification");
};

export const qualificationPolicyKey = (policies: readonly QualificationPolicy[]) => {
  const active = policies.filter((policy) => policy.status === "published");
  return active.length <= 1
    ? (active[0]?.policy_key ?? policies[0]?.policy_key ?? "lead.qualification")
    : null;
};

type PolicyAction =
  { action: "create"; key: string } | { action: "publish" | "retire"; policy: QualificationPolicy };

export const preparePolicyChange = (change: PolicyAction, randomId: string) => {
  const body =
    change.action === "create"
      ? { policy_key: change.key, policy_type: "qualification", schema_version: 1, rules }
      : {};
  if (change.action === "create") {
    if (!isSchemaValue(CreateBusinessPolicyDraftInputSchema, body)) return null;
  } else if (change.policy.status !== (change.action === "publish" ? "draft" : "published"))
    return null;

  return {
    change,
    method: "POST" as const,
    path: change.action === "create" ? path : `${path}/${change.policy.policy_id}/${change.action}`,
    body: JSON.stringify(body),
    idempotencyKey: makeIdempotencyKey("policy", randomId),
  };
};

export type PreparedPolicyChange = NonNullable<ReturnType<typeof preparePolicyChange>>;

export const writeQualificationPolicy = (
  request: StaffRequest,
  command: PreparedPolicyChange,
  csrf: string | null,
) => {
  const { change } = command;
  const condition =
    change.action === "create"
      ? null
      : { id: change.policy.policy_id, version: change.policy.version_no };
  const status =
    change.action === "create" ? "draft" : change.action === "publish" ? "published" : "retired";
  return writeClinicConfiguration(
    request,
    command,
    csrf,
    condition,
    (value) => {
      if (
        !isSchemaValue(Policy, value) ||
        value.data.policy_type !== "qualification" ||
        value.data.status !== status
      )
        return null;
      const policy = value.data;
      if (change.action === "create") return policy.policy_key === change.key ? policy : null;
      return policy.policy_id === change.policy.policy_id &&
        policy.policy_key === change.policy.policy_key &&
        policy.version_no === change.policy.version_no
        ? policy
        : null;
    },
    {
      denied: "Your current session lacks access to this policy action.",
      invalid:
        "The policy could not be saved. Refresh and review the current qualification version.",
      stale: "The policy changed. Refresh policies before trying again.",
    },
  );
};
