import { useRef, useState, type FormEvent } from "react";
import type {
  BusinessHoursInterval,
  LocationClosureRecord,
  LocationRoot,
} from "@lead-agent/contracts";
import { clinicLanguages } from "../../lib/staff-clinic-configuration";
import {
  getClinicLocation,
  listClinicLocations,
  prepareLocationCommand,
  readLocationCandidate,
  readNewLocation,
  writeClinicLocation,
  type PreparedLocationCommand,
} from "../../lib/staff-clinic-locations";
import { writeLocationClosure, type PreparedClosure } from "../../lib/staff-location-closures";
import type { StaffRequest } from "../../lib/staff-request";
import { readCsrfCookie } from "../../lib/staff-ui";
import { StaffLocationClosures } from "./StaffLocationClosures";

const weekdays = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

function OpeningHours({ initial }: Readonly<{ initial: readonly BusinessHoursInterval[] }>) {
  const [rows, setRows] = useState<{ id: number; interval?: BusinessHoursInterval }[]>(() =>
    initial.map((interval, index) => ({ id: index, interval })),
  );
  const nextId = useRef(initial.length);

  return (
    <fieldset className="opening-hours">
      <legend>Weekly opening hours</legend>
      <p>Use local time at this location. A day with no opening interval is closed.</p>
      {rows.map(({ id, interval }, index) => (
        <div
          className="opening-interval"
          key={id}
          role="group"
          aria-label={`Opening interval ${index + 1}`}
        >
          <label>
            Day
            <select name="weekday" defaultValue={interval?.day_of_week ?? 1}>
              {weekdays.map((day, dayIndex) => (
                <option key={day} value={dayIndex + 1}>
                  {day}
                </option>
              ))}
            </select>
          </label>
          <label>
            Opens
            <input
              type="time"
              name="opens"
              step="1"
              defaultValue={interval?.opens_at_local}
              required
            />
          </label>
          <label>
            Closes
            <input
              type="time"
              name="closes"
              step="1"
              defaultValue={interval?.closes_at_local}
              required
            />
          </label>
          <button
            className="secondary-button"
            type="button"
            aria-label={`Remove interval ${index + 1}`}
            onClick={() => setRows((current) => current.filter((row) => row.id !== id))}
          >
            Remove
          </button>
        </div>
      ))}
      <button
        className="secondary-button"
        type="button"
        disabled={rows.length >= 224}
        onClick={() => {
          const id = nextId.current++;
          setRows((current) => [...current, { id }]);
        }}
      >
        Add opening interval
      </button>
    </fieldset>
  );
}

function LocationFields({ location }: Readonly<{ location: LocationRoot }>) {
  const profile = location.current_version;
  return (
    <>
      <p>Enter the name and address in at least the clinic’s default language.</p>
      {clinicLanguages.map(([locale, name]) => (
        <div className="clinic-form-grid" key={locale}>
          <label>
            Name in {name}
            <input
              name={`name_${locale}`}
              maxLength={4000}
              defaultValue={profile?.name_i18n[locale]}
            />
          </label>
          <label>
            Address in {name}
            <input
              name={`address_${locale}`}
              maxLength={4000}
              defaultValue={profile?.address_i18n[locale]}
            />
          </label>
        </div>
      ))}
      <div className="clinic-form-grid">
        <label>
          Time zone
          <input
            name="time_zone"
            placeholder="Asia/Tashkent"
            maxLength={255}
            defaultValue={profile?.time_zone}
            required
          />
        </label>
        <label>
          Public phone (optional)
          <input
            name="phone"
            type="tel"
            maxLength={64}
            defaultValue={profile?.public_contact.phone}
          />
        </label>
        <label>
          Public email (optional)
          <input
            name="email"
            type="email"
            maxLength={254}
            defaultValue={profile?.public_contact.email}
          />
        </label>
        <label>
          Public website (optional)
          <input
            name="website"
            type="url"
            maxLength={2048}
            defaultValue={profile?.public_contact.website}
          />
        </label>
      </div>
      <OpeningHours initial={profile?.business_hours.intervals ?? []} />
    </>
  );
}

export function StaffClinicLocations({ request }: Readonly<{ request: StaffRequest }>) {
  const [locations, setLocations] = useState<LocationRoot[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [openLocation, setOpenLocation] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<PreparedLocationCommand | PreparedClosure | null>(null);
  const [closureRecords, setClosureRecords] = useState<LocationClosureRecord[]>([]);
  const inFlight = useRef(false);

  const run = async (operation: () => Promise<void>) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      await operation();
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  const load = (pageCursor: string | null = null) =>
    run(async () => {
      try {
        const page = await listClinicLocations(request, pageCursor);
        const next = page.meta.next_cursor ?? null;
        if (next !== null && next === pageCursor) throw new Error("Repeated location cursor");
        const previous = pageCursor === null ? [] : (locations ?? []);
        setLocations([
          ...new Map([...previous, ...page.data].map((row) => [row.location_id, row])).values(),
        ]);
        setCursor(next);
        if (pageCursor === null) {
          setNeedsRefresh(false);
          setOpenLocation(null);
          setCreating(false);
          setNotice(null);
        }
      } catch {
        setError("Locations could not be loaded. Try again.");
      }
    });

  const updateLocation = (location: LocationRoot) => {
    setLocations((current) => {
      const rows = new Map(current?.map((row) => [row.location_id, row]));
      rows.set(location.location_id, location);
      return [...rows.values()];
    });
    setCreating(false);
    setOpenLocation(location.location_id);
  };

  const save = (command: PreparedLocationCommand | PreparedClosure) =>
    run(async () => {
      setNotice(null);
      let csrf: string | null;
      try {
        csrf = readCsrfCookie(document.cookie);
      } catch {
        csrf = null;
      }
      const result =
        "closure" in command
          ? await writeLocationClosure(request, command, csrf)
          : await writeClinicLocation(request, command, csrf);
      if (result.kind !== "saved") {
        if (result.kind === "uncertain") setPending(command);
        else if (csrf !== null) setPending(null);
        if (result.kind === "stale") setNeedsRefresh(true);
        setError(result.message);
        return;
      }
      setPending(null);
      const resource = result.resource;
      if ("closure_id" in resource && "closure" in command) {
        setClosureRecords((current) => {
          const remaining = current.filter(
            (row) =>
              row.closure_id !== resource.closure_id && row.closure_id !== resource.supersedes_id,
          );
          return resource.status === "active" ? [...remaining, resource] : remaining;
        });
        setNotice(
          resource.status === "cancelled"
            ? "Schedule change cancelled."
            : "Schedule change published.",
        );
        try {
          const location = await getClinicLocation(request, resource.location_id);
          if (location.version <= command.target.version)
            throw new Error("Location version did not advance");
          updateLocation(location);
        } catch {
          setNeedsRefresh(true);
          setError(
            "The schedule change was saved. Refresh locations to load the latest version before making another change.",
          );
        }
        return;
      }
      if ("closure" in command || "closure_id" in resource) return;
      updateLocation(resource);
      setNotice(
        command.action === "create"
          ? "Location added. Publish its details to make it active."
          : command.action === "publish"
            ? "Location and opening hours published."
            : "Location deactivated.",
      );
    });

  const locked = busy || pending !== null;
  const selected = locations?.find((row) => row.location_id === openLocation) ?? null;

  const add = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (locked || needsRefresh) return;
    const command = readNewLocation(new FormData(event.currentTarget));
    if (command === null) {
      setError("Use a location code with lowercase letters, numbers and single hyphens.");
      return;
    }
    void save(prepareLocationCommand(command, crypto.randomUUID()));
  };

  const publish = (event: FormEvent<HTMLFormElement>, target: LocationRoot) => {
    event.preventDefault();
    if (locked || needsRefresh) return;
    const candidate = readLocationCandidate(new FormData(event.currentTarget));
    if (candidate.kind !== "valid") {
      setError(
        candidate.kind === "invalid-hours"
          ? "Use opening times before closing times on the same day. Intervals cannot overlap."
          : "Check the location name, address, time zone and public contact details.",
      );
      return;
    }
    void save(
      prepareLocationCommand(
        { action: "publish", target, body: candidate.body },
        crypto.randomUUID(),
      ),
    );
  };

  const closeEditor = () => {
    setCreating(false);
    setOpenLocation(null);
    setError(null);
    setNotice(null);
  };

  return (
    <details
      className="clinic-knowledge-panel"
      onToggle={(event) => {
        if (event.currentTarget.open && locations === null && error === null) void load();
      }}
    >
      <summary>Locations and opening hours</summary>
      {busy && <p role="status">Updating locations…</p>}
      {error !== null && (
        <div className="notice notice--error" role="alert">
          {error}
        </div>
      )}
      {notice !== null && (
        <div className="notice" role="status">
          {notice}
        </div>
      )}
      {pending !== null && (
        <button
          className="secondary-button"
          type="button"
          disabled={busy}
          onClick={() => void save(pending)}
        >
          Retry command
        </button>
      )}
      {(needsRefresh || (!creating && selected === null)) && (
        <div className="action-row">
          <button
            className="secondary-button"
            type="button"
            disabled={locked}
            onClick={() => void load()}
          >
            Refresh locations
          </button>
          <button
            className="primary-button"
            type="button"
            disabled={locked || needsRefresh || locations === null}
            onClick={() => {
              setCreating(true);
              setError(null);
              setNotice(null);
            }}
          >
            Add location
          </button>
        </div>
      )}
      {locations !== null && !creating && selected === null && (
        <>
          {locations.length === 0 ? (
            <p>No locations yet.</p>
          ) : (
            <ul className="clinic-record-list">
              {locations.map((row) => {
                const names = row.current_version?.name_i18n;
                return (
                  <li key={row.location_id}>
                    <button
                      className="secondary-button"
                      type="button"
                      disabled={locked || needsRefresh}
                      onClick={() => {
                        setOpenLocation(row.location_id);
                        setError(null);
                      }}
                    >
                      {names?.en ?? names?.uz ?? names?.ru ?? row.code} · {row.status}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {cursor !== null && (
            <button
              className="secondary-button"
              type="button"
              disabled={locked || needsRefresh}
              onClick={() => void load(cursor)}
            >
              Load more locations
            </button>
          )}
        </>
      )}
      {creating && (
        <form className="action-box clinic-editor" onSubmit={add}>
          <label>
            Location code
            <input
              name="code"
              placeholder="city-centre"
              maxLength={64}
              required
              disabled={locked || needsRefresh}
            />
          </label>
          <div className="action-row">
            <button className="primary-button" type="submit" disabled={locked || needsRefresh}>
              Create inactive location
            </button>
            <button
              className="secondary-button"
              type="button"
              disabled={locked}
              onClick={closeEditor}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
      {selected !== null && (
        <div
          className="action-box clinic-editor"
          key={`${selected.location_id}:${selected.version}`}
        >
          <h3>
            {selected.code} · {selected.status}
          </h3>
          <form onSubmit={(event) => publish(event, selected)}>
            <fieldset disabled={locked || needsRefresh}>
              <LocationFields location={selected} />
              <p>
                Publishing makes these location details and hours available for customer answers.
              </p>
              <button className="primary-button" type="submit">
                Publish location and hours
              </button>
            </fieldset>
          </form>
          <StaffLocationClosures
            location={selected}
            records={closureRecords.filter((record) => record.location_id === selected.location_id)}
            disabled={locked || needsRefresh}
            save={(command) => void save(command)}
          />
          <div className="action-row">
            <button
              className="secondary-button"
              type="button"
              disabled={locked}
              onClick={closeEditor}
            >
              Back to locations
            </button>
            {selected.status === "active" && (
              <details>
                <summary>Deactivate location</summary>
                <p>This makes the location inactive and keeps its published history.</p>
                <button
                  className="danger-button"
                  type="button"
                  disabled={locked || needsRefresh}
                  onClick={() => {
                    void save(
                      prepareLocationCommand(
                        { action: "deactivate", target: selected, body: {} },
                        crypto.randomUUID(),
                      ),
                    );
                  }}
                >
                  Confirm deactivation
                </button>
              </details>
            )}
          </div>
        </div>
      )}
    </details>
  );
}
