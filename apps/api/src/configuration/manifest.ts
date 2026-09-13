import type { ConfigurationPermission } from "@lead-agent/application";

export type StaffConfigurationOperation =
  | "cancelClosure"
  | "changeServiceLocation"
  | "createClosure"
  | "createFaqDraft"
  | "createLocation"
  | "createPolicyDraft"
  | "createPriceDraft"
  | "createService"
  | "deactivateLocation"
  | "deactivateService"
  | "getFaq"
  | "getLocation"
  | "getPolicy"
  | "getPrice"
  | "getService"
  | "listFaqs"
  | "listLocations"
  | "listPolicies"
  | "listPrices"
  | "listServices"
  | "publishFaq"
  | "publishLocation"
  | "publishPolicy"
  | "publishPrice"
  | "publishService"
  | "retireFaq"
  | "retirePolicy"
  | "retirePrice"
  | "supersedeClosure"
  | "updateFaqDraft"
  | "updatePolicyDraft"
  | "updatePriceDraft";

export type StaffConfigurationRouteDefinition = Readonly<{
  idempotencyKey: boolean;
  ifMatch: boolean;
  method: "GET" | "PATCH" | "POST" | "PUT";
  mutation: boolean;
  operation: StaffConfigurationOperation;
  path: string;
  permission: ConfigurationPermission;
}>;

export const STAFF_CONFIGURATION_ROUTE_MANIFEST = Object.freeze([
  {
    idempotencyKey: false,
    ifMatch: false,
    method: "GET",
    mutation: false,
    operation: "listLocations",
    path: "/v1/staff/locations",
    permission: "configuration.read",
  },
  {
    idempotencyKey: true,
    ifMatch: false,
    method: "POST",
    mutation: true,
    operation: "createLocation",
    path: "/v1/staff/locations",
    permission: "configuration.write",
  },
  {
    idempotencyKey: false,
    ifMatch: false,
    method: "GET",
    mutation: false,
    operation: "getLocation",
    path: "/v1/staff/locations/{id}",
    permission: "configuration.read",
  },
  {
    idempotencyKey: true,
    ifMatch: true,
    method: "POST",
    mutation: true,
    operation: "publishLocation",
    path: "/v1/staff/locations/{id}/publish",
    permission: "configuration.publish",
  },
  {
    idempotencyKey: true,
    ifMatch: true,
    method: "POST",
    mutation: true,
    operation: "deactivateLocation",
    path: "/v1/staff/locations/{id}/deactivate",
    permission: "configuration.publish",
  },
  {
    idempotencyKey: true,
    ifMatch: true,
    method: "POST",
    mutation: true,
    operation: "createClosure",
    path: "/v1/staff/locations/{id}/closures",
    permission: "configuration.publish",
  },
  {
    idempotencyKey: true,
    ifMatch: true,
    method: "POST",
    mutation: true,
    operation: "supersedeClosure",
    path: "/v1/staff/locations/{id}/closures/{closure_id}/supersede",
    permission: "configuration.publish",
  },
  {
    idempotencyKey: true,
    ifMatch: true,
    method: "POST",
    mutation: true,
    operation: "cancelClosure",
    path: "/v1/staff/locations/{id}/closures/{closure_id}/cancel",
    permission: "configuration.publish",
  },
  {
    idempotencyKey: false,
    ifMatch: false,
    method: "GET",
    mutation: false,
    operation: "listServices",
    path: "/v1/staff/services",
    permission: "configuration.read",
  },
  {
    idempotencyKey: true,
    ifMatch: false,
    method: "POST",
    mutation: true,
    operation: "createService",
    path: "/v1/staff/services",
    permission: "configuration.write",
  },
  {
    idempotencyKey: false,
    ifMatch: false,
    method: "GET",
    mutation: false,
    operation: "getService",
    path: "/v1/staff/services/{id}",
    permission: "configuration.read",
  },
  {
    idempotencyKey: true,
    ifMatch: true,
    method: "POST",
    mutation: true,
    operation: "publishService",
    path: "/v1/staff/services/{id}/publish",
    permission: "configuration.publish",
  },
  {
    idempotencyKey: true,
    ifMatch: true,
    method: "POST",
    mutation: true,
    operation: "deactivateService",
    path: "/v1/staff/services/{id}/deactivate",
    permission: "configuration.publish",
  },
  {
    idempotencyKey: true,
    ifMatch: true,
    method: "PUT",
    mutation: true,
    operation: "changeServiceLocation",
    path: "/v1/staff/services/{id}/locations",
    permission: "configuration.publish",
  },
  {
    idempotencyKey: false,
    ifMatch: false,
    method: "GET",
    mutation: false,
    operation: "listPrices",
    path: "/v1/staff/prices",
    permission: "configuration.read",
  },
  {
    idempotencyKey: true,
    ifMatch: true,
    method: "POST",
    mutation: true,
    operation: "createPriceDraft",
    path: "/v1/staff/services/{id}/prices",
    permission: "configuration.write",
  },
  {
    idempotencyKey: false,
    ifMatch: false,
    method: "GET",
    mutation: false,
    operation: "getPrice",
    path: "/v1/staff/prices/{price_id}",
    permission: "configuration.read",
  },
  {
    idempotencyKey: true,
    ifMatch: true,
    method: "PATCH",
    mutation: true,
    operation: "updatePriceDraft",
    path: "/v1/staff/prices/{price_id}",
    permission: "configuration.write",
  },
  {
    idempotencyKey: true,
    ifMatch: true,
    method: "POST",
    mutation: true,
    operation: "publishPrice",
    path: "/v1/staff/prices/{price_id}/publish",
    permission: "configuration.publish",
  },
  {
    idempotencyKey: true,
    ifMatch: true,
    method: "POST",
    mutation: true,
    operation: "retirePrice",
    path: "/v1/staff/prices/{price_id}/retire",
    permission: "configuration.publish",
  },
  {
    idempotencyKey: false,
    ifMatch: false,
    method: "GET",
    mutation: false,
    operation: "listFaqs",
    path: "/v1/staff/faqs",
    permission: "configuration.read",
  },
  {
    idempotencyKey: true,
    ifMatch: false,
    method: "POST",
    mutation: true,
    operation: "createFaqDraft",
    path: "/v1/staff/faqs",
    permission: "configuration.write",
  },
  {
    idempotencyKey: false,
    ifMatch: false,
    method: "GET",
    mutation: false,
    operation: "getFaq",
    path: "/v1/staff/faqs/{id}",
    permission: "configuration.read",
  },
  {
    idempotencyKey: true,
    ifMatch: true,
    method: "PATCH",
    mutation: true,
    operation: "updateFaqDraft",
    path: "/v1/staff/faqs/{id}",
    permission: "configuration.write",
  },
  {
    idempotencyKey: true,
    ifMatch: true,
    method: "POST",
    mutation: true,
    operation: "publishFaq",
    path: "/v1/staff/faqs/{id}/publish",
    permission: "configuration.publish",
  },
  {
    idempotencyKey: true,
    ifMatch: true,
    method: "POST",
    mutation: true,
    operation: "retireFaq",
    path: "/v1/staff/faqs/{id}/retire",
    permission: "configuration.publish",
  },
  {
    idempotencyKey: false,
    ifMatch: false,
    method: "GET",
    mutation: false,
    operation: "listPolicies",
    path: "/v1/staff/business-policies",
    permission: "configuration.read",
  },
  {
    idempotencyKey: true,
    ifMatch: false,
    method: "POST",
    mutation: true,
    operation: "createPolicyDraft",
    path: "/v1/staff/business-policies",
    permission: "configuration.write",
  },
  {
    idempotencyKey: false,
    ifMatch: false,
    method: "GET",
    mutation: false,
    operation: "getPolicy",
    path: "/v1/staff/business-policies/{id}",
    permission: "configuration.read",
  },
  {
    idempotencyKey: true,
    ifMatch: true,
    method: "PATCH",
    mutation: true,
    operation: "updatePolicyDraft",
    path: "/v1/staff/business-policies/{id}",
    permission: "configuration.write",
  },
  {
    idempotencyKey: true,
    ifMatch: true,
    method: "POST",
    mutation: true,
    operation: "publishPolicy",
    path: "/v1/staff/business-policies/{id}/publish",
    permission: "configuration.publish",
  },
  {
    idempotencyKey: true,
    ifMatch: true,
    method: "POST",
    mutation: true,
    operation: "retirePolicy",
    path: "/v1/staff/business-policies/{id}/retire",
    permission: "configuration.publish",
  },
] as const satisfies readonly StaffConfigurationRouteDefinition[]);

export const configurationRoute = (
  operation: StaffConfigurationOperation,
): StaffConfigurationRouteDefinition => {
  const route = STAFF_CONFIGURATION_ROUTE_MANIFEST.find(
    (candidate) => candidate.operation === operation,
  );
  if (route === undefined)
    throw new TypeError(`Unknown staff configuration operation: ${operation}`);
  return route;
};

export const toFastifyPath = (path: string): string => path.replace(/\{([a-z_]+)\}/gu, ":$1");
