import { useState } from "react";
import type { LocationClosureRecord, LocationRoot } from "@lead-agent/contracts";
import { clinicLanguages } from "../../lib/staff-clinic-configuration";
import {
  prepareClosure,
  readLocationClosure,
  type PreparedClosure,
} from "../../lib/staff-location-closures";

export function StaffLocationClosures({
  location,
  records,
  disabled,
  save,
}: Readonly<{
  location: LocationRoot;
  records: readonly LocationClosureRecord[];
  disabled: boolean;
  save: (command: PreparedClosure) => void;
}>) {
  const [previous, setPrevious] = useState<LocationClosureRecord | null>(null);
  const [kind, setKind] = useState<"closed" | "override">("closed");
  const [error, setError] = useState<string | null>(null);
  const profile = location.current_version;
  if (profile === null || location.status !== "active") return null;

  const choose = (record: LocationClosureRecord | null) => {
    setPrevious(record);
    setKind(record?.details.kind ?? "closed");
    setError(null);
  };

  return (
    <details className="action-box">
      <summary>One-day closures and special hours</summary>
      <p>
        Dates and times use {profile.time_zone}. Each change applies to one date at this location.
      </p>
      {records.length > 0 && (
        <>
          <p>Changes published in this workspace session</p>
          <ul className="clinic-record-list">
            {records.map((record) => (
              <li key={record.closure_id}>
                <button
                  className="secondary-button"
                  type="button"
                  disabled={disabled}
                  onClick={() => choose(record)}
                >
                  {record.details.local_date} ·{" "}
                  {record.details.kind === "closed"
                    ? "Closed all day"
                    : `${record.details.opens_at_local}–${record.details.closes_at_local}`}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      {error !== null && <p role="alert">{error}</p>}
      <form
        key={previous?.closure_id ?? "new"}
        onSubmit={(event) => {
          event.preventDefault();
          if (disabled) return;
          const body = readLocationClosure(new FormData(event.currentTarget));
          if (body === null) {
            setError(
              "Enter a valid date, opening times, and a reason in the clinic’s default language.",
            );
            return;
          }
          const change =
            previous === null
              ? { action: "create" as const, body }
              : { action: "supersede" as const, previous, body };
          const command = prepareClosure(location, change, crypto.randomUUID());
          if (command === null) {
            setError("Refresh this location before changing its schedule.");
            return;
          }
          setError(null);
          save(command);
        }}
      >
        <fieldset disabled={disabled}>
          <legend>{previous === null ? "New schedule change" : "Correct schedule change"}</legend>
          <div className="clinic-form-grid">
            <label>
              Date
              <input
                type="date"
                name="local_date"
                required
                readOnly={previous !== null}
                defaultValue={previous?.details.local_date}
              />
            </label>
            <label>
              Schedule
              <select
                name="kind"
                value={kind}
                onChange={(event) =>
                  setKind(event.currentTarget.value === "override" ? "override" : "closed")
                }
              >
                <option value="closed">Closed all day</option>
                <option value="override">Special opening hours</option>
              </select>
            </label>
            {kind === "override" && (
              <>
                <label>
                  Opens
                  <input
                    type="time"
                    name="opens_at_local"
                    step="1"
                    required
                    defaultValue={
                      previous?.details.kind === "override"
                        ? previous.details.opens_at_local
                        : undefined
                    }
                  />
                </label>
                <label>
                  Closes
                  <input
                    type="time"
                    name="closes_at_local"
                    step="1"
                    required
                    defaultValue={
                      previous?.details.kind === "override"
                        ? previous.details.closes_at_local
                        : undefined
                    }
                  />
                </label>
              </>
            )}
          </div>
          {clinicLanguages.map(([language, label]) => (
            <label key={language}>
              Reason in {label}
              <input
                name={`reason_${language}`}
                maxLength={4000}
                defaultValue={previous?.details.reason_i18n[language]}
              />
            </label>
          ))}
          <button className="primary-button" type="submit">
            {previous === null ? "Publish schedule change" : "Publish correction"}
          </button>
        </fieldset>
      </form>
      {previous !== null && (
        <div className="action-row">
          <button
            className="secondary-button"
            type="button"
            disabled={disabled}
            onClick={() => choose(null)}
          >
            New schedule change
          </button>
          <details>
            <summary>Cancel schedule change</summary>
            <p>Cancel this exception to restore the weekly schedule for that date.</p>
            <button
              type="button"
              className="danger-button"
              disabled={disabled}
              onClick={() => {
                const command = prepareClosure(
                  location,
                  { action: "cancel", previous },
                  crypto.randomUUID(),
                );
                if (command !== null) save(command);
              }}
            >
              Confirm cancellation
            </button>
          </details>
        </div>
      )}
    </details>
  );
}
