import {
  CreateLocationInputSchema,
  LocalTimeSchema,
  LocationRootSchema,
  PublishLocationInputSchema,
  WeekdaySchema,
  createCollectionEnvelopeSchema,
  createSuccessEnvelopeSchema,
  isSchemaValue,
  type CreateLocationInput,
  type LocationRoot,
  type LocalizedText,
  type PublishLocationInput,
} from "@lead-agent/contracts";
import {
  clinicLanguages,
  readConfigurationPage,
  readFormText,
  writeClinicConfiguration,
} from "./staff-clinic-configuration";
import type { StaffRequest } from "./staff-request";
import { makeIdempotencyKey } from "./staff-ui";

const path = "/v1/staff/locations";
const Locations = createCollectionEnvelopeSchema(
  LocationRootSchema,
  "StaffConfigurationLocationCollectionResponse.v1",
);
const Location = createSuccessEnvelopeSchema(
  LocationRootSchema,
  "StaffConfigurationLocationResponse.v1",
);

export const listClinicLocations = (request: StaffRequest, cursor: string | null = null) =>
  readConfigurationPage(request, path, Locations, cursor);

const withSeconds = (value: FormDataEntryValue | undefined) =>
  typeof value === "string" && /^\d\d:\d\d$/u.test(value) ? `${value}:00` : value;

const readHours = (form: FormData): PublishLocationInput["business_hours"] | null => {
  const days = form.getAll("weekday");
  const start = form.getAll("opens");
  const end = form.getAll("closes");
  if (days.length !== start.length || days.length !== end.length || days.length > 224) return null;

  const intervals: PublishLocationInput["business_hours"]["intervals"] = [];
  for (const [index, day] of days.entries()) {
    const weekday = typeof day === "string" && /^[1-7]$/u.test(day) ? Number(day) : NaN;
    const opens = withSeconds(start[index]);
    const closes = withSeconds(end[index]);
    if (
      !isSchemaValue(WeekdaySchema, weekday) ||
      !isSchemaValue(LocalTimeSchema, opens) ||
      !isSchemaValue(LocalTimeSchema, closes) ||
      opens >= closes
    )
      return null;
    intervals.push({
      day_of_week: weekday,
      opens_at_local: opens,
      closes_at_local: closes,
      sequence_no: 1,
    });
  }
  intervals.sort(
    (a, b) => a.day_of_week - b.day_of_week || a.opens_at_local.localeCompare(b.opens_at_local),
  );
  let prior: (typeof intervals)[number] | undefined;
  for (const interval of intervals) {
    if (prior?.day_of_week === interval.day_of_week) {
      if (prior.closes_at_local > interval.opens_at_local || prior.sequence_no === 32) return null;
      interval.sequence_no = prior.sequence_no + 1;
    }
    prior = interval;
  }
  return { intervals };
};

export const readLocationCandidate = (form: FormData) => {
  const hours = readHours(form);
  if (hours === null) return { kind: "invalid-hours" } as const;
  const name: LocalizedText = {};
  const address: LocalizedText = {};
  for (const [locale] of clinicLanguages) {
    const nameValue = readFormText(form, `name_${locale}`);
    const addressValue = readFormText(form, `address_${locale}`);
    if (nameValue !== "") name[locale] = nameValue;
    if (addressValue !== "") address[locale] = addressValue;
  }
  const phone = readFormText(form, "phone");
  const email = readFormText(form, "email");
  const website = readFormText(form, "website");
  const body = {
    name_i18n: name,
    address_i18n: address,
    time_zone: readFormText(form, "time_zone"),
    business_hours: hours,
    public_contact: {
      ...(phone === "" ? {} : { phone }),
      ...(email === "" ? {} : { email }),
      ...(website === "" ? {} : { website }),
    },
  };
  return isSchemaValue(PublishLocationInputSchema, body)
    ? ({ kind: "valid", body } as const)
    : ({ kind: "invalid-profile" } as const);
};

type LocationAction =
  | { action: "create"; body: CreateLocationInput }
  | { action: "publish"; target: LocationRoot; body: PublishLocationInput }
  | { action: "deactivate"; target: LocationRoot; body: Record<string, never> };

export const readNewLocation = (form: FormData): LocationAction | null => {
  const body = { code: readFormText(form, "code") };
  return isSchemaValue(CreateLocationInputSchema, body) ? { action: "create", body } : null;
};

export const prepareLocationCommand = (change: LocationAction, randomId: string) => ({
  ...change,
  method: "POST" as const,
  path: change.action === "create" ? path : `${path}/${change.target.location_id}/${change.action}`,
  expectedCode: change.action === "create" ? change.body.code : change.target.code,
  body: JSON.stringify(change.body),
  idempotencyKey: makeIdempotencyKey("location", randomId),
});

export type PreparedLocationCommand = ReturnType<typeof prepareLocationCommand>;

export const writeClinicLocation = (
  request: StaffRequest,
  command: PreparedLocationCommand,
  csrf: string | null,
) => {
  const target = command.action === "create" ? null : command.target;
  return writeClinicConfiguration(
    request,
    command,
    csrf,
    target === null ? null : { id: target.location_id, version: target.version },
    (value) => {
      if (!isSchemaValue(Location, value)) return null;
      const { data } = value;
      if (data.code !== command.expectedCode) return null;
      if (
        target !== null &&
        (data.location_id !== target.location_id || data.version <= target.version)
      )
        return null;
      if (command.action === "publish") {
        return data.status === "active" && data.current_version?.location_id === data.location_id
          ? data
          : null;
      }
      return data.status === "inactive" && (target !== null || data.current_version === null)
        ? data
        : null;
    },
    {
      denied: "Your current session lacks access to this location action.",
      invalid:
        "The clinic could not save this location. Check the location details and the clinic’s default language.",
      stale:
        "The location changed or its code is already in use. Refresh locations and review the current state.",
    },
  );
};
