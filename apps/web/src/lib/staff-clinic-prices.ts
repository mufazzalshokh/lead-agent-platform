import {
  CreateServicePriceDraftInputSchema,
  ServicePriceRecordSchema,
  ServicePriceTypeSchema,
  createCollectionEnvelopeSchema,
  createSuccessEnvelopeSchema,
  isSchemaValue,
  type CreateServicePriceDraftInput,
  type LocalizedText,
  type ServicePriceRecord,
  type ServicePriceTerms,
  type ServiceRoot,
} from "@lead-agent/contracts";
import {
  clinicLanguages,
  readConfigurationPage,
  readFormText,
  writeClinicConfiguration,
} from "./staff-clinic-configuration";
import type { StaffRequest } from "./staff-request";
import { makeIdempotencyKey } from "./staff-ui";

const path = "/v1/staff/prices";
const Prices = createCollectionEnvelopeSchema(
  ServicePriceRecordSchema,
  "StaffConfigurationPriceCollectionResponse.v1",
);
const Price = createSuccessEnvelopeSchema(
  ServicePriceRecordSchema,
  "StaffConfigurationPriceResponse.v1",
);

export const listClinicPrices = (request: StaffRequest, cursor: string | null) =>
  readConfigurationPage(request, path, Prices, cursor);

const amount = (form: FormData, field: string, currency: string) => {
  const raw = readFormText(form, field);
  return { amount_minor: /^\d+$/u.test(raw) ? Number(raw) : NaN, currency };
};

export const readPriceDraft = (form: FormData) => {
  const type = readFormText(form, "price_type");
  if (!isSchemaValue(ServicePriceTypeSchema, type)) return null;
  const currency = readFormText(form, "currency").toUpperCase();
  const minimum = amount(form, "amount", currency);
  const pricing =
    type === "quote_required"
      ? { price_type: type, currency }
      : type === "fixed"
        ? { price_type: type, amount: minimum }
        : type === "from"
          ? { price_type: type, minimum }
          : { price_type: type, minimum, maximum: amount(form, "maximum", currency) };
  const displayText: LocalizedText = {};
  for (const [locale] of clinicLanguages) {
    const text = readFormText(form, `display_${locale}`);
    if (text !== "") displayText[locale] = text;
  }
  const body = {
    pricing,
    location_id: readFormText(form, "location_id") || null,
    display_text_i18n: displayText,
  };
  return isSchemaValue(CreateServicePriceDraftInputSchema, body) ? body : null;
};

export const priceCurrency = (pricing: ServicePriceTerms) =>
  pricing.price_type === "quote_required"
    ? pricing.currency
    : pricing.price_type === "fixed"
      ? pricing.amount.currency
      : pricing.minimum.currency;

type PriceChange =
  | { action: "create"; service: ServiceRoot; body: CreateServicePriceDraftInput }
  | { action: "edit"; price: ServicePriceRecord; body: CreateServicePriceDraftInput }
  | { action: "publish" | "retire"; price: ServicePriceRecord; body: Record<string, never> };

export const preparePriceChange = (change: PriceChange, randomId: string) => {
  if (
    change.action === "create"
      ? change.service.status !== "active"
      : change.price.status !== (change.action === "retire" ? "published" : "draft")
  )
    return null;
  const url =
    change.action === "create"
      ? `/v1/staff/services/${change.service.service_id}/prices`
      : change.action === "edit"
        ? `${path}/${change.price.price_id}`
        : `${path}/${change.price.price_id}/${change.action}`;
  const condition =
    change.action === "create"
      ? { id: change.service.service_id, version: change.service.version }
      : { id: change.price.price_id, version: change.price.version_no };
  return {
    change,
    condition,
    path: url,
    method: change.action === "edit" ? ("PATCH" as const) : ("POST" as const),
    body: JSON.stringify(change.body),
    idempotencyKey: makeIdempotencyKey("price", randomId),
  };
};

export type PreparedPriceChange = NonNullable<ReturnType<typeof preparePriceChange>>;

export const writeClinicPrice = (
  request: StaffRequest,
  command: PreparedPriceChange,
  csrf: string | null,
) => {
  const { change } = command;
  return writeClinicConfiguration(
    request,
    command,
    csrf,
    command.condition,
    (value) => {
      if (!isSchemaValue(Price, value)) return null;
      const row = value.data;
      const status =
        change.action === "publish"
          ? "published"
          : change.action === "retire"
            ? "retired"
            : "draft";
      if (row.status !== status) return null;
      if (change.action === "create") {
        return row.service_id === change.service.service_id &&
          row.location_id === change.body.location_id
          ? row
          : null;
      }
      if (row.price_id !== change.price.price_id || row.service_id !== change.price.service_id)
        return null;
      if (change.action === "edit") {
        return row.version_no > change.price.version_no &&
          row.location_id === change.body.location_id
          ? row
          : null;
      }
      return row.version_no === change.price.version_no &&
        row.location_id === change.price.location_id
        ? row
        : null;
    },
    {
      denied: "Your current session lacks access to this price action.",
      invalid:
        "Could not save the price. Check the active service, location offering, amounts, and the clinic’s default language.",
      stale: "The service or price version changed. Refresh prices before trying again.",
    },
  );
};
