import {
  CreateLocationClosureInputSchema,
  LocationClosureRecordSchema,
  createSuccessEnvelopeSchema,
  isSchemaValue,
  type CreateLocationClosureInput,
  type LocalizedText,
  type LocationClosureRecord,
  type LocationRoot,
} from "@lead-agent/contracts";
import {
  clinicLanguages,
  readFormText,
  writeClinicConfiguration,
} from "./staff-clinic-configuration";
import type { StaffRequest } from "./staff-request";
import { makeIdempotencyKey } from "./staff-ui";

const ClosureResponse = createSuccessEnvelopeSchema(
  LocationClosureRecordSchema,
  "StaffConfigurationClosureResponse.v1",
);

const localTime = (value: string) => (/^\d{2}:\d{2}$/u.test(value) ? `${value}:00` : value);

export const readLocationClosure = (form: FormData) => {
  const reason: LocalizedText = {};
  for (const [locale] of clinicLanguages) {
    const value = readFormText(form, `reason_${locale}`);
    if (value !== "") reason[locale] = value;
  }
  const kind = readFormText(form, "kind");
  const body = {
    kind,
    local_date: readFormText(form, "local_date"),
    reason_i18n: reason,
    ...(kind === "override"
      ? {
          opens_at_local: localTime(readFormText(form, "opens_at_local")),
          closes_at_local: localTime(readFormText(form, "closes_at_local")),
        }
      : {}),
  };
  return isSchemaValue(CreateLocationClosureInputSchema, body) ? body : null;
};

type ClosureChange =
  | { action: "create"; body: CreateLocationClosureInput }
  | { action: "supersede"; previous: LocationClosureRecord; body: CreateLocationClosureInput }
  | { action: "cancel"; previous: LocationClosureRecord };

export const prepareClosure = (target: LocationRoot, change: ClosureChange, randomId: string) => {
  if (target.status !== "active" || target.current_version === null) return null;
  if (
    change.action !== "create" &&
    (change.previous.location_id !== target.location_id || change.previous.status !== "active")
  )
    return null;
  if (
    change.action === "supersede" &&
    change.body.local_date !== change.previous.details.local_date
  )
    return null;
  const base = `/v1/staff/locations/${target.location_id}/closures`;
  return {
    closure: change,
    target,
    method: "POST" as const,
    path:
      change.action === "create" ? base : `${base}/${change.previous.closure_id}/${change.action}`,
    body: JSON.stringify(change.action === "cancel" ? {} : change.body),
    idempotencyKey: makeIdempotencyKey("closure", randomId),
  };
};

export type PreparedClosure = NonNullable<ReturnType<typeof prepareClosure>>;

export const writeLocationClosure = (
  request: StaffRequest,
  command: PreparedClosure,
  csrf: string | null,
) => {
  const { closure, target } = command;
  const date =
    closure.action === "cancel" ? closure.previous.details.local_date : closure.body.local_date;
  return writeClinicConfiguration(
    request,
    command,
    csrf,
    { id: target.location_id, version: target.version },
    (value) => {
      if (!isSchemaValue(ClosureResponse, value)) return null;
      const row = value.data;
      if (row.location_id !== target.location_id || row.details.local_date !== date) return null;
      if (closure.action === "cancel") {
        return row.closure_id === closure.previous.closure_id && row.status === "cancelled"
          ? row
          : null;
      }
      if (row.status !== "active" || row.details.kind !== closure.body.kind) return null;
      const supersedes = closure.action === "create" ? null : closure.previous.closure_id;
      return row.supersedes_id === supersedes ? row : null;
    },
    {
      denied: "Your current session lacks access to this schedule change.",
      invalid:
        "The schedule change was rejected. Check the date, opening times, and reason in the clinic’s default language.",
      stale:
        "The location changed or this date already has a schedule exception. Refresh locations and review the current state.",
    },
  );
};
