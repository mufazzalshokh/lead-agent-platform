import {
  ChangeServiceLocationInputSchema,
  CreateServiceInputSchema,
  PublishServiceInputSchema,
  ServiceLocationRecordSchema,
  ServiceRootSchema,
  createCollectionEnvelopeSchema,
  createSuccessEnvelopeSchema,
  isSchemaValue,
  type ChangeServiceLocationInput,
  type CreateServiceInput,
  type LocalizedText,
  type LocationId,
  type PublishServiceInput,
  type ServiceId,
  type ServiceLocationRecord,
  type ServiceRoot,
} from "@lead-agent/contracts";
import {
  clinicLanguages,
  readConfigurationCatalog,
  readConfigurationPage,
  readFormText,
  writeClinicConfiguration,
} from "./staff-clinic-configuration";
import type { StaffRequest } from "./staff-request";
import { makeIdempotencyKey } from "./staff-ui";

const path = "/v1/staff/services";
const Services = createCollectionEnvelopeSchema(
  ServiceRootSchema,
  "StaffConfigurationServiceCollectionResponse.v1",
);
const ServiceResponse = createSuccessEnvelopeSchema(
  ServiceRootSchema,
  "StaffConfigurationServiceResponse.v1",
);
const OfferingResponse = createSuccessEnvelopeSchema(
  ServiceLocationRecordSchema,
  "StaffConfigurationServiceLocationResponse.v1",
);

export const listClinicServices = (
  request: StaffRequest,
  cursor: string | null,
  location?: LocationId,
) =>
  readConfigurationPage(
    request,
    location === undefined
      ? path
      : `${path}?status=active&location_id=${encodeURIComponent(location)}`,
    Services,
    cursor,
  );

export const readServiceOffering = async (
  request: StaffRequest,
  service: ServiceId,
  location: LocationId,
) => {
  const services = await readConfigurationCatalog((cursor) =>
    listClinicServices(request, cursor, location),
  );
  return services.some((row) => row.service_id === service);
};

export const getClinicService = async (request: StaffRequest, id: ServiceId) => {
  const response = await request(`${path}/${id}`);
  if (!response.ok) throw new Error("Service could not be loaded");
  const value: unknown = await response.json();
  if (!isSchemaValue(ServiceResponse, value) || value.data.service_id !== id)
    throw new Error("Invalid service response");
  return value.data;
};

export const readNewService = (form: FormData) => {
  const body = { code: readFormText(form, "code") };
  return isSchemaValue(CreateServiceInputSchema, body) ? body : null;
};

const readTranslation = (form: FormData, field: string) => {
  const result: LocalizedText = {};
  for (const [locale] of clinicLanguages) {
    const text = readFormText(form, `${field}_${locale}`);
    if (text !== "") result[locale] = text;
  }
  return result;
};

export const readServiceCandidate = (form: FormData) => {
  const minutes = readFormText(form, "duration");
  if (minutes !== "" && !/^\d+$/u.test(minutes)) return null;
  const body = {
    name_i18n: readTranslation(form, "name"),
    description_i18n: readTranslation(form, "description"),
    disclaimer_i18n: readTranslation(form, "disclaimer"),
    duration_guidance_minutes: minutes === "" ? null : Number(minutes),
  };
  return isSchemaValue(PublishServiceInputSchema, body) ? body : null;
};

export const serviceOfferingChange = (location: LocationId, offered: boolean) => {
  const body = { location_id: location, status: offered ? "inactive" : "active" };
  return isSchemaValue(ChangeServiceLocationInputSchema, body) ? body : null;
};

type ServiceChange =
  | { action: "create"; body: CreateServiceInput }
  | { action: "publish"; target: ServiceRoot; body: PublishServiceInput }
  | { action: "deactivate"; target: ServiceRoot; body: Record<string, never> }
  | { action: "locations"; target: ServiceRoot; body: ChangeServiceLocationInput };

export const prepareServiceChange = (change: ServiceChange, randomId: string) => ({
  change,
  method: change.action === "locations" ? ("PUT" as const) : ("POST" as const),
  path: change.action === "create" ? path : `${path}/${change.target.service_id}/${change.action}`,
  body: JSON.stringify(change.body),
  idempotencyKey: makeIdempotencyKey("service", randomId),
});

export type PreparedServiceChange = ReturnType<typeof prepareServiceChange>;

type ServiceReceipt =
  { kind: "service"; service: ServiceRoot } | { kind: "offering"; relation: ServiceLocationRecord };

export const writeClinicService = (
  request: StaffRequest,
  command: PreparedServiceChange,
  csrf: string | null,
) => {
  const { change } = command;
  const condition =
    change.action === "create"
      ? null
      : { id: change.target.service_id, version: change.target.version };
  return writeClinicConfiguration<ServiceReceipt>(
    request,
    command,
    csrf,
    condition,
    (value) => {
      if (change.action === "locations") {
        if (!isSchemaValue(OfferingResponse, value)) return null;
        const relation = value.data;
        return relation.service_id === change.target.service_id &&
          relation.location_id === change.body.location_id &&
          relation.status === change.body.status &&
          (relation.effective_to === null) === (relation.status === "active")
          ? ({ kind: "offering", relation } as const)
          : null;
      }
      if (!isSchemaValue(ServiceResponse, value)) return null;
      const service = value.data;
      if (change.action === "create") {
        return service.code === change.body.code &&
          service.current_version === null &&
          service.status === "inactive"
          ? ({ kind: "service", service } as const)
          : null;
      }
      if (
        service.service_id !== change.target.service_id ||
        service.code !== change.target.code ||
        service.version <= change.target.version
      )
        return null;
      const valid =
        change.action === "publish"
          ? service.status === "active" &&
            service.current_version?.service_id === service.service_id
          : service.status === "inactive";
      return valid ? ({ kind: "service", service } as const) : null;
    },
    {
      denied: "Your current session lacks access to this service action.",
      invalid:
        "The clinic could not save this change. Check the details and the clinic’s default language.",
      stale:
        "The service changed or the code is already in use. Refresh services before trying again.",
    },
  );
};
