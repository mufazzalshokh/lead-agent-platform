import { useState, type FormEvent } from "react";
import type { StaffOutcome } from "@lead-agent/contracts";
import {
  attendancePath,
  loadAppointmentOutcomes,
  netRevenueByCurrency,
  readAttendance,
  readRevenue,
  readRevenueReversal,
  revenuePath,
  reversibleRevenue,
} from "../../lib/staff-appointment-outcomes";
import type { StaffRequest } from "../../lib/staff-request";
import type { RecordValue } from "../../lib/staff-workflow";

type History = Readonly<{ attendance: StaffOutcome[]; revenue: StaffOutcome[] }>;

const attendanceLabel = (outcome: string | null) => {
  if (outcome === "attended") return "Attended";
  if (outcome === "did_not_attend") return "No-show";
  return "Unknown";
};

const recordedAt = (row: StaffOutcome) => `${row.recorded_at.slice(0, 16).replace("T", " ")} UTC`;

export function StaffAppointmentOutcomes({
  appointmentId,
  startAt,
  canRecord,
  disabled,
  request,
  save,
}: Readonly<{
  appointmentId: string;
  startAt: string | null;
  canRecord: boolean;
  disabled: boolean;
  request: StaffRequest;
  save: (path: string, body: RecordValue) => Promise<boolean>;
}>) {
  const [history, setHistory] = useState<History | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [validation, setValidation] = useState<string | null>(null);

  const refresh = async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const [attendance, revenue] = await Promise.all([
        loadAppointmentOutcomes(request, appointmentId, "attendance"),
        loadAppointmentOutcomes(request, appointmentId, "revenue"),
      ]);
      if (attendance.filter((row) => row.is_current).length > 1) {
        throw new Error("Multiple current attendance outcomes");
      }
      setHistory({ attendance, revenue });
    } catch {
      setHistory(null);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  };

  const submit = async (
    event: FormEvent<HTMLFormElement>,
    path: string,
    read: (form: FormData) => RecordValue | null,
    invalid: string,
  ) => {
    event.preventDefault();
    if (disabled || loading || saving || !canRecord || history === null) return;
    const form = event.currentTarget;
    const body = read(new FormData(form));
    if (body === null) {
      setValidation(invalid);
      return;
    }
    setValidation(null);
    setSaving(true);
    try {
      if (await save(path, body)) form.reset();
      await refresh();
    } finally {
      setSaving(false);
    }
  };

  const current = history?.attendance.find((row) => row.is_current);
  const reversible = history === null ? [] : reversibleRevenue(history.revenue);
  const canRecordAttendance = startAt !== null && Date.parse(startAt) <= Date.now();
  const busy = disabled || loading || saving;

  return (
    <details
      className="action-box"
      onToggle={(event) => {
        if (event.currentTarget.open && history === null && !loading && !loadError) void refresh();
      }}
    >
      <summary>Attendance and revenue</summary>
      {loading && <p role="status">Loading outcome history…</p>}
      {loadError && <p role="alert">Outcome history could not be loaded.</p>}
      {validation !== null && <p role="alert">{validation}</p>}
      <div className="action-row">
        <button type="button" disabled={loading || saving} onClick={() => void refresh()}>
          Refresh outcomes
        </button>
      </div>
      {history !== null && (
        <>
          <h4>Attendance</h4>
          {history.attendance.length === 0 ? (
            <p>No attendance recorded.</p>
          ) : (
            <ul>
              {history.attendance.map((row) => (
                <li key={row.id}>
                  {attendanceLabel(row.outcome)} · {row.is_current ? "Current" : "Superseded"} ·{" "}
                  <time dateTime={row.recorded_at}>{recordedAt(row)}</time>
                  {row.reason_code !== null && ` · ${row.reason_code}`}
                </li>
              ))}
            </ul>
          )}
          {canRecord && !canRecordAttendance && (
            <p className="help-text">Attendance can be recorded once the appointment starts.</p>
          )}
          {canRecord && canRecordAttendance && (
            <form
              key={current?.id ?? "first-attendance"}
              onSubmit={(event) =>
                void submit(
                  event,
                  attendancePath(appointmentId),
                  (form) => readAttendance(form, current?.id),
                  "Select an attendance outcome and enter a valid UTC time or correction reason when applicable.",
                )
              }
            >
              <label>
                Outcome
                <select name="outcome" defaultValue="" required disabled={busy}>
                  <option value="" disabled>
                    Select an outcome
                  </option>
                  <option value="attended">Attended</option>
                  <option value="did_not_attend">No-show</option>
                  <option value="unknown">Unknown</option>
                </select>
              </label>
              <label>
                Occurrence time (UTC, optional)
                <input name="occurred_at" type="datetime-local" disabled={busy} />
              </label>
              {current !== undefined && (
                <label>
                  Correction reason code
                  <input
                    name="reason_code"
                    placeholder="data_entry_error"
                    required
                    disabled={busy}
                  />
                </label>
              )}
              <button type="submit" disabled={busy}>
                {current === undefined ? "Record attendance" : "Correct attendance"}
              </button>
            </form>
          )}
          <h4>Revenue</h4>
          {history.revenue.length === 0 ? (
            <p>No revenue recorded.</p>
          ) : (
            <>
              <ul>
                {history.revenue.map((row) => (
                  <li key={row.id}>
                    {row.entry_type} · {row.amount_minor} {row.currency} minor units ·{" "}
                    <time dateTime={row.recorded_at}>{recordedAt(row)}</time>
                    {row.reason_code !== null && ` · ${row.reason_code}`}
                  </li>
                ))}
              </ul>
              <ul aria-label="Net revenue by currency">
                {[...netRevenueByCurrency(history.revenue)].map(([currency, amount]) => (
                  <li key={currency}>
                    Net {currency} {amount.toString()} minor units
                  </li>
                ))}
              </ul>
            </>
          )}
          {canRecord && (
            <form
              onSubmit={(event) =>
                void submit(
                  event,
                  revenuePath(appointmentId),
                  readRevenue,
                  "Enter a positive whole amount in minor units, a currency code, a category code and a valid UTC time.",
                )
              }
            >
              <label>
                Entry type
                <select name="entry_type" disabled={busy}>
                  <option value="charge">Charge</option>
                  <option value="adjustment">Adjustment</option>
                </select>
              </label>
              <label>
                Amount in minor units
                <input name="amount_minor" inputMode="numeric" required disabled={busy} />
              </label>
              <label>
                Currency code
                <input name="currency" placeholder="UZS" maxLength={3} required disabled={busy} />
              </label>
              <label>
                Category code
                <input name="category_code" placeholder="consultation" required disabled={busy} />
              </label>
              <label>
                Recognition time (UTC)
                <input name="recognized_at" type="datetime-local" required disabled={busy} />
              </label>
              <button type="submit" disabled={busy}>
                Record revenue
              </button>
            </form>
          )}
          {canRecord && reversible.length > 0 && (
            <form
              onSubmit={(event) =>
                void submit(
                  event,
                  revenuePath(appointmentId),
                  (form) => readRevenueReversal(form, history.revenue),
                  "Select an eligible revenue entry and enter a reversal reason code.",
                )
              }
            >
              <label>
                Revenue entry to reverse
                <select name="reverses_attribution_id" defaultValue="" required disabled={busy}>
                  <option value="" disabled>
                    Select an entry
                  </option>
                  {reversible.map((row) => (
                    <option key={row.id} value={row.id}>
                      {row.entry_type} · {row.amount_minor} {row.currency} · {recordedAt(row)} ·{" "}
                      {row.id}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Reversal reason code
                <input name="reason_code" placeholder="data_entry_error" required disabled={busy} />
              </label>
              <button className="danger-button" type="submit" disabled={busy}>
                Reverse revenue
              </button>
            </form>
          )}
        </>
      )}
    </details>
  );
}
