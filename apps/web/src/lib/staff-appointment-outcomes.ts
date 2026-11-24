import {
  StaffAttendanceInputSchema,
  StaffOutcomeCollectionResponseSchema,
  StaffRevenueInputSchema,
  isSchemaValue,
  type StaffOutcome,
} from "@lead-agent/contracts";
import type { StaffRequest } from "./staff-request";

export const attendancePath = (id: string) => `/v1/staff/appointment-requests/${id}/attendance`;
export const revenuePath = (id: string) =>
  `/v1/staff/appointment-requests/${id}/revenue-attributions`;

export const loadAppointmentOutcomes = async (
  request: StaffRequest,
  appointmentId: string,
  kind: StaffOutcome["kind"],
): Promise<StaffOutcome[]> => {
  const path = kind === "attendance" ? attendancePath(appointmentId) : revenuePath(appointmentId);
  const outcomes = new Map<string, StaffOutcome>();
  const cursors = new Set<string>();
  let cursor: string | null = null;
  do {
    const response = await request(
      cursor === null ? path : `${path}?cursor=${encodeURIComponent(cursor)}`,
    );
    if (!response.ok) throw new Error("Outcome history unavailable");
    const page: unknown = await response.json();
    if (!isSchemaValue(StaffOutcomeCollectionResponseSchema, page)) {
      throw new Error("Invalid outcome history");
    }
    for (const row of page.data) {
      if (
        row.kind !== kind ||
        row.appointment_request_id !== appointmentId ||
        outcomes.has(row.id)
      ) {
        throw new Error("Inconsistent outcome history");
      }
      outcomes.set(row.id, row);
    }
    cursor = page.meta.next_cursor ?? null;
    if (cursor !== null) {
      if (cursors.has(cursor)) throw new Error("Repeated outcome cursor");
      cursors.add(cursor);
    }
  } while (cursor !== null);
  return [...outcomes.values()];
};

const readText = (form: FormData, name: string) => {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
};

const readUtcMinute = (value: string): string | null => {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/u.test(value)) return null;
  const date = new Date(`${value}:00.000Z`);
  if (!Number.isFinite(date.getTime())) return null;
  const timestamp = date.toISOString();
  return timestamp.slice(0, 16) === value ? timestamp : null;
};

export const readAttendance = (form: FormData, currentId?: string) => {
  const time = readText(form, "occurred_at");
  const occurredAt = time === "" ? undefined : readUtcMinute(time);
  const reason = readText(form, "reason_code");
  if (occurredAt === null || (currentId !== undefined && reason === "")) return null;
  const body = {
    outcome: readText(form, "outcome"),
    ...(occurredAt === undefined ? {} : { occurred_at: occurredAt }),
    ...(currentId === undefined
      ? {}
      : { supersedes_attendance_id: currentId, reason_code: reason }),
  };
  return isSchemaValue(StaffAttendanceInputSchema, body) ? body : null;
};

export const readRevenue = (form: FormData) => {
  const amount = readText(form, "amount_minor");
  if (!/^\d+$/u.test(amount)) return null;
  const body = {
    entry_type: readText(form, "entry_type"),
    amount_minor: Number(amount),
    currency: readText(form, "currency").toUpperCase(),
    category_code: readText(form, "category_code"),
    recognized_at: readUtcMinute(readText(form, "recognized_at")),
  };
  return isSchemaValue(StaffRevenueInputSchema, body) ? body : null;
};

export const reversibleRevenue = (history: readonly StaffOutcome[]) => {
  const reversed = new Set(
    history.filter((row) => row.entry_type === "reversal").map((row) => row.supersedes_id),
  );
  return history.filter(
    (row) =>
      (row.entry_type === "charge" || row.entry_type === "adjustment") && !reversed.has(row.id),
  );
};

export const readRevenueReversal = (form: FormData, history: readonly StaffOutcome[]) => {
  const id = readText(form, "reverses_attribution_id");
  if (!reversibleRevenue(history).some((row) => row.id === id)) return null;
  const body = {
    entry_type: "reversal",
    reverses_attribution_id: id,
    reason_code: readText(form, "reason_code"),
  };
  return isSchemaValue(StaffRevenueInputSchema, body) ? body : null;
};

export const netRevenueByCurrency = (history: readonly StaffOutcome[]) => {
  const totals = new Map<string, bigint>();
  for (const row of history) {
    if (row.amount_minor === null || row.currency === null) continue;
    const amount = BigInt(row.amount_minor);
    totals.set(
      row.currency,
      (totals.get(row.currency) ?? 0n) + (row.entry_type === "reversal" ? -amount : amount),
    );
  }
  return totals;
};
