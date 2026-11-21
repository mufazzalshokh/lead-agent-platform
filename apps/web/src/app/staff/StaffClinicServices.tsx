import { useRef, useState, type FormEvent } from "react";
import type { LocationId, LocationRoot, ServiceRoot } from "@lead-agent/contracts";
import { clinicLanguages, readConfigurationCatalog } from "../../lib/staff-clinic-configuration";
import { listClinicLocations } from "../../lib/staff-clinic-locations";
import {
  getClinicService,
  listClinicServices,
  prepareServiceChange,
  readNewService,
  readServiceCandidate,
  readServiceOffering,
  serviceOfferingChange,
  writeClinicService,
  type PreparedServiceChange,
} from "../../lib/staff-clinic-services";
import type { StaffRequest } from "../../lib/staff-request";
import { readCsrfCookie } from "../../lib/staff-ui";

const displayName = (row: LocationRoot | ServiceRoot) => {
  const names = row.current_version?.name_i18n;
  return names?.en ?? names?.uz ?? names?.ru ?? row.code;
};

function ServiceFields({ service }: Readonly<{ service: ServiceRoot }>) {
  const profile = service.current_version;
  return (
    <>
      <p>Enter a name, description and disclaimer in at least the clinic’s default language.</p>
      {clinicLanguages.map(([locale, language]) => (
        <div className="clinic-form-grid" key={locale}>
          <label>
            Name in {language}
            <input
              name={`name_${locale}`}
              maxLength={4000}
              defaultValue={profile?.name_i18n[locale]}
            />
          </label>
          <label>
            Description in {language}
            <textarea
              name={`description_${locale}`}
              rows={3}
              maxLength={4000}
              defaultValue={profile?.description_i18n[locale]}
            />
          </label>
          <label>
            Disclaimer in {language}
            <textarea
              name={`disclaimer_${locale}`}
              rows={3}
              maxLength={4000}
              defaultValue={profile?.disclaimer_i18n[locale]}
            />
          </label>
        </div>
      ))}
      <label>
        Typical duration in minutes (optional)
        <input
          name="duration"
          inputMode="numeric"
          maxLength={5}
          defaultValue={profile?.duration_guidance_minutes ?? ""}
        />
      </label>
    </>
  );
}

export function StaffClinicServices({ request }: Readonly<{ request: StaffRequest }>) {
  const [catalog, setCatalog] = useState<ServiceRoot[] | null>(null);
  const [service, setService] = useState<ServiceRoot | null>(null);
  const [creating, setCreating] = useState(false);
  const [locations, setLocations] = useState<LocationRoot[] | null>(null);
  const [locationId, setLocationId] = useState("");
  const [offering, setOffering] = useState<{ locationId: LocationId; active: boolean } | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const [pending, setPending] = useState<PreparedServiceChange | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
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

  const close = () => {
    setService(null);
    setCreating(false);
    setLocations(null);
    setLocationId("");
    setOffering(null);
    setError(null);
    setNotice(null);
  };

  const refresh = () =>
    run(async () => {
      try {
        setCatalog(await readConfigurationCatalog((cursor) => listClinicServices(request, cursor)));
        setNeedsRefresh(false);
        close();
      } catch {
        setError("Services could not be loaded. Try again.");
      }
    });

  const updateService = (updated: ServiceRoot) => {
    setCatalog((previous) => {
      const rows = new Map(previous?.map((row) => [row.service_id, row]));
      rows.set(updated.service_id, updated);
      return [...rows.values()];
    });
    setService(updated);
  };

  const save = (command: PreparedServiceChange) =>
    run(async () => {
      setNotice(null);
      let csrf: string | null;
      try {
        csrf = readCsrfCookie(document.cookie);
      } catch {
        csrf = null;
      }
      const result = await writeClinicService(request, command, csrf);
      if (result.kind !== "saved") {
        if (result.kind === "uncertain") setPending(command);
        else if (csrf !== null) setPending(null);
        if (result.kind === "stale") setNeedsRefresh(true);
        setError(result.message);
        return;
      }
      setPending(null);
      if (result.resource.kind === "offering") {
        const { relation } = result.resource;
        setNotice(
          relation.status === "active" ? "Service offering enabled." : "Service offering ended.",
        );
        setLocationId("");
        setOffering(null);
        try {
          updateService(await getClinicService(request, relation.service_id));
        } catch {
          setNeedsRefresh(true);
          setError(
            "The offering change was saved. Refresh services to load the current version before making another change.",
          );
        }
        return;
      }
      updateService(result.resource.service);
      setCreating(false);
      setNotice(
        command.change.action === "create"
          ? "Service added. Publish its details to activate it."
          : command.change.action === "publish"
            ? "Service published."
            : "Service deactivated.",
      );
    });

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy || needsRefresh || pending !== null) return;
    const form = new FormData(event.currentTarget);
    const id = crypto.randomUUID();
    if (creating) {
      const body = readNewService(form);
      if (body === null)
        setError("Use a service code with lowercase letters, numbers and single hyphens.");
      else void save(prepareServiceChange({ action: "create", body }, id));
    } else if (service !== null) {
      const body = readServiceCandidate(form);
      if (body === null)
        setError("Check the name, description, disclaimer and duration in whole minutes.");
      else void save(prepareServiceChange({ action: "publish", target: service, body }, id));
    }
  };

  const openLocations = () =>
    run(async () => {
      try {
        const rows = await readConfigurationCatalog((cursor) =>
          listClinicLocations(request, cursor),
        );
        setLocations(rows.filter((row) => row.status === "active"));
      } catch {
        setError("Locations could not be loaded. Try again.");
      }
    });

  const checkOffering = (value: string) => {
    setLocationId(value);
    setOffering(null);
    const location = locations?.find((row) => row.location_id === value);
    if (service === null || location === undefined) return;
    void run(async () => {
      try {
        const active = await readServiceOffering(request, service.service_id, location.location_id);
        const current = await getClinicService(request, service.service_id);
        if (current.version !== service.version || current.status !== "active") {
          setNeedsRefresh(true);
          setError("The service changed. Refresh services before changing its offering.");
          return;
        }
        setOffering({ locationId: location.location_id, active });
      } catch {
        setLocationId("");
        setError("Could not check this location’s offering. Select it to try again.");
      }
    });
  };

  const locked = busy || pending !== null;
  const disabled = locked || needsRefresh;
  const listOpen = !creating && service === null;

  return (
    <details
      className="clinic-knowledge-panel"
      onToggle={(event) => {
        if (event.currentTarget.open && catalog === null && error === null) void refresh();
      }}
    >
      <summary>Services</summary>
      {busy && <p role="status">Updating services…</p>}
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
          type="button"
          className="secondary-button"
          disabled={busy}
          onClick={() => void save(pending)}
        >
          Retry command
        </button>
      )}
      {(listOpen || needsRefresh) && (
        <div className="action-row">
          <button
            type="button"
            className="secondary-button"
            disabled={locked}
            onClick={() => void refresh()}
          >
            Refresh services
          </button>
          <button
            type="button"
            className="primary-button"
            disabled={disabled || catalog === null}
            onClick={() => setCreating(true)}
          >
            Add service
          </button>
        </div>
      )}
      {listOpen &&
        catalog !== null &&
        (catalog.length === 0 ? (
          <p>No services yet.</p>
        ) : (
          <ul className="clinic-record-list">
            {catalog.map((row) => (
              <li key={row.service_id}>
                <button
                  type="button"
                  className="secondary-button"
                  disabled={disabled}
                  onClick={() => {
                    setService(row);
                    setError(null);
                  }}
                >
                  {displayName(row)} · {row.code} · {row.status}
                </button>
              </li>
            ))}
          </ul>
        ))}
      {creating && (
        <form className="action-box clinic-editor" onSubmit={submit}>
          <label>
            Service code
            <input
              name="code"
              placeholder="consultation"
              maxLength={64}
              required
              disabled={disabled}
            />
          </label>
          <div className="action-row">
            <button type="submit" className="primary-button" disabled={disabled}>
              Create inactive service
            </button>
            <button type="button" className="secondary-button" disabled={locked} onClick={close}>
              Cancel
            </button>
          </div>
        </form>
      )}
      {service !== null && (
        <div className="action-box clinic-editor" key={`${service.service_id}:${service.version}`}>
          <h3>
            {displayName(service)} · {service.status}
          </h3>
          {locations === null ? (
            <form onSubmit={submit}>
              <fieldset disabled={disabled}>
                <ServiceFields service={service} />
                <p>
                  Publishing makes these details eligible for customer answers. Set offerings
                  separately for each location.
                </p>
                <button type="submit" className="primary-button">
                  Publish service details
                </button>
              </fieldset>
            </form>
          ) : (
            <>
              <label>
                Location
                <select
                  value={locationId}
                  disabled={disabled}
                  onChange={(event) => checkOffering(event.target.value)}
                >
                  <option value="">Select an active location</option>
                  {locations.map((row) => (
                    <option key={row.location_id} value={row.location_id}>
                      {displayName(row)} · {row.code}
                    </option>
                  ))}
                </select>
              </label>
              {locations.length === 0 && (
                <p>Publish a location before setting a service offering.</p>
              )}
              {offering !== null && (
                <>
                  <p>
                    {offering.active
                      ? "Offered at this location"
                      : "No active offering at this location"}
                  </p>
                  <button
                    type="button"
                    className="primary-button"
                    disabled={disabled}
                    onClick={() => {
                      const body = serviceOfferingChange(offering.locationId, offering.active);
                      if (body !== null)
                        void save(
                          prepareServiceChange(
                            { action: "locations", target: service, body },
                            crypto.randomUUID(),
                          ),
                        );
                    }}
                  >
                    {offering.active ? "End offering" : "Offer service here"}
                  </button>
                </>
              )}
            </>
          )}
          <div className="action-row">
            <button type="button" className="secondary-button" disabled={locked} onClick={close}>
              Back to services
            </button>
            {service.status === "active" && locations === null && (
              <>
                <button
                  type="button"
                  className="secondary-button"
                  disabled={disabled}
                  onClick={() => void openLocations()}
                >
                  Manage location offerings
                </button>
                <details>
                  <summary>Deactivate service</summary>
                  <p>This removes the service from active knowledge and retains its history.</p>
                  <button
                    type="button"
                    className="danger-button"
                    disabled={disabled}
                    onClick={() => {
                      void save(
                        prepareServiceChange(
                          { action: "deactivate", target: service, body: {} },
                          crypto.randomUUID(),
                        ),
                      );
                    }}
                  >
                    Confirm deactivation
                  </button>
                </details>
              </>
            )}
            {locations !== null && (
              <button
                type="button"
                className="secondary-button"
                disabled={locked}
                onClick={() => {
                  setLocations(null);
                  setLocationId("");
                  setOffering(null);
                }}
              >
                Edit service details
              </button>
            )}
          </div>
        </div>
      )}
    </details>
  );
}
