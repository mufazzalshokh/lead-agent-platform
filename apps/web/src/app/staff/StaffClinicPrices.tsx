import { useRef, useState, type FormEvent } from "react";
import type {
  LocationRoot,
  ServicePriceRecord,
  ServicePriceTerms,
  ServicePriceType,
  ServiceRoot,
} from "@lead-agent/contracts";
import { clinicLanguages, readConfigurationCatalog } from "../../lib/staff-clinic-configuration";
import { listClinicLocations } from "../../lib/staff-clinic-locations";
import {
  listClinicPrices,
  preparePriceChange,
  priceCurrency,
  readPriceDraft,
  writeClinicPrice,
  type PreparedPriceChange,
} from "../../lib/staff-clinic-prices";
import { getClinicService, listClinicServices } from "../../lib/staff-clinic-services";
import type { StaffRequest } from "../../lib/staff-request";
import { readCsrfCookie } from "../../lib/staff-ui";

const labels = {
  fixed: "Fixed price",
  from: "From",
  range: "Range",
  quote_required: "Quote required",
};
const nameOf = (row: LocationRoot | ServiceRoot) => {
  const name = row.current_version?.name_i18n;
  return name?.en ?? name?.uz ?? name?.ru ?? row.code;
};

const showTerms = (terms: ServicePriceTerms) => {
  const currency = priceCurrency(terms);
  switch (terms.price_type) {
    case "fixed":
      return `${terms.amount.amount_minor} ${currency} minor units`;
    case "from":
      return `From ${terms.minimum.amount_minor} ${currency} minor units`;
    case "range":
      return `${terms.minimum.amount_minor}–${terms.maximum.amount_minor} ${currency} minor units`;
    case "quote_required":
      return `Quote required (${currency})`;
  }
};

function PriceFields({
  base,
  locations,
}: Readonly<{ base: ServicePriceRecord | null; locations: LocationRoot[] }>) {
  const pricing = base?.pricing;
  const [type, setType] = useState<ServicePriceType>(pricing?.price_type ?? "fixed");
  const minimum =
    pricing?.price_type === "fixed"
      ? pricing.amount.amount_minor
      : pricing?.price_type === "range" || pricing?.price_type === "from"
        ? pricing.minimum.amount_minor
        : "";
  const location = base?.location_id;
  return (
    <>
      <div className="clinic-form-grid">
        <label>
          Location
          <select name="location_id" defaultValue={location ?? ""}>
            <option value="">All locations</option>
            {location != null && !locations.some((row) => row.location_id === location) && (
              <option value={location}>Current location (unavailable)</option>
            )}
            {locations.map((row) => (
              <option key={row.location_id} value={row.location_id}>
                {nameOf(row)} · {row.code}
              </option>
            ))}
          </select>
        </label>
        <label>
          Price type
          <select
            name="price_type"
            value={type}
            onChange={(event) => {
              const value = event.target.value;
              if (
                value === "fixed" ||
                value === "from" ||
                value === "range" ||
                value === "quote_required"
              )
                setType(value);
            }}
          >
            {Object.entries(labels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Currency code
          <input
            name="currency"
            maxLength={3}
            required
            placeholder="UZS"
            defaultValue={pricing === undefined ? "" : priceCurrency(pricing)}
          />
        </label>
        {type !== "quote_required" && (
          <label>
            {type === "fixed" ? "Amount in minor units" : "Minimum in minor units"}
            <input
              name="amount"
              inputMode="numeric"
              maxLength={16}
              required
              defaultValue={minimum}
            />
          </label>
        )}
        {type === "range" && (
          <label>
            Maximum in minor units
            <input
              name="maximum"
              inputMode="numeric"
              maxLength={16}
              required
              defaultValue={pricing?.price_type === "range" ? pricing.maximum.amount_minor : ""}
            />
          </label>
        )}
      </div>
      <p>
        A location-specific price requires an active offering at that location. Enter display text
        in the clinic’s default language.
      </p>
      {clinicLanguages.map(([locale, language]) => (
        <label key={locale}>
          Display text in {language}
          <textarea
            name={`display_${locale}`}
            maxLength={4000}
            rows={2}
            defaultValue={base?.display_text_i18n[locale]}
          />
        </label>
      ))}
    </>
  );
}

type Editor =
  | { mode: "new"; base: ServicePriceRecord | null }
  | { mode: "edit" | "view"; base: ServicePriceRecord };
type Scope = { services: ServiceRoot[]; locations: LocationRoot[] };

export function StaffClinicPrices({ request }: Readonly<{ request: StaffRequest }>) {
  const [scope, setScope] = useState<Scope | null>(null);
  const [prices, setPrices] = useState<ServicePriceRecord[]>([]);
  const [serviceId, setServiceId] = useState("");
  const [editor, setEditor] = useState<Editor | null>(null);
  const [busy, setBusy] = useState(false);
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const [pending, setPending] = useState<PreparedPriceChange | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const lock = useRef(false);

  const run = async (operation: () => Promise<void>) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError(null);
    try {
      await operation();
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };

  const loadPrices = () => readConfigurationCatalog((cursor) => listClinicPrices(request, cursor));

  const refresh = () =>
    run(async () => {
      try {
        const [services, locations, records] = await Promise.all([
          readConfigurationCatalog((cursor) => listClinicServices(request, cursor)),
          readConfigurationCatalog((cursor) => listClinicLocations(request, cursor)),
          loadPrices(),
        ]);
        setScope({ services, locations });
        setPrices(records);
        if (!services.some((row) => row.service_id === serviceId)) setServiceId("");
        setEditor(null);
        setNotice(null);
        setNeedsRefresh(false);
      } catch {
        setError("Prices and scope could not be loaded. Refresh to try again.");
      }
    });

  const perform = async (command: PreparedPriceChange) => {
    setNotice(null);
    let csrf: string | null;
    try {
      csrf = readCsrfCookie(document.cookie);
    } catch {
      csrf = null;
    }
    const result = await writeClinicPrice(request, command, csrf);
    if (result.kind !== "saved") {
      if (result.kind === "uncertain") setPending(command);
      else if (csrf !== null) setPending(null);
      if (result.kind === "stale") setNeedsRefresh(true);
      setError(result.message);
      return;
    }
    setPending(null);
    setEditor({ mode: "view", base: result.resource });
    setNotice(
      result.resource.status === "draft"
        ? "Price draft saved."
        : result.resource.status === "published"
          ? "Price published."
          : "Price retired.",
    );
    try {
      setPrices(await loadPrices());
    } catch {
      setNeedsRefresh(true);
      setError(
        "The change was saved. Refresh prices to load the current list before making another change.",
      );
    }
  };

  const selected = scope?.services.find((row) => row.service_id === serviceId);
  const locked = busy || pending !== null;
  const disabled = locked || needsRefresh || selected?.status !== "active";
  const visiblePrices = prices.filter((price) => price.service_id === serviceId);
  const editing = editor !== null && editor.mode !== "view";
  const switchEditor = (next: Editor | null) => {
    setEditor(next);
    setError(null);
    setNotice(null);
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (disabled || editor === null || selected === undefined) return;
    const body = readPriceDraft(new FormData(event.currentTarget));
    if (body === null) {
      setError("Check the currency, whole minor-unit amounts, price range, and display text.");
      return;
    }
    void run(async () => {
      let command: PreparedPriceChange | null;
      if (editor.mode === "edit") {
        command = preparePriceChange(
          { action: "edit", price: editor.base, body },
          crypto.randomUUID(),
        );
      } else {
        try {
          const service = await getClinicService(request, selected.service_id);
          command = preparePriceChange({ action: "create", service, body }, crypto.randomUUID());
        } catch {
          setError("Could not load the current service version. Try again.");
          return;
        }
      }
      if (command === null) {
        setNeedsRefresh(true);
        setError("The service or price changed. Refresh prices before trying again.");
        return;
      }
      await perform(command);
    });
  };

  const changeStatus = (price: ServicePriceRecord, action: "publish" | "retire") => {
    if (disabled) return;
    const command = preparePriceChange({ action, price, body: {} }, crypto.randomUUID());
    if (command !== null) void run(() => perform(command));
  };

  return (
    <details
      className="clinic-knowledge-panel"
      onToggle={(event) => {
        if (event.currentTarget.open && scope === null && error === null) void refresh();
      }}
    >
      <summary>Service prices</summary>
      {busy && <p role="status">Updating prices…</p>}
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
          onClick={() => void run(() => perform(pending))}
        >
          Retry command
        </button>
      )}
      {(!editing || needsRefresh) && (
        <div className="action-row">
          <button
            type="button"
            className="secondary-button"
            disabled={locked}
            onClick={() => void refresh()}
          >
            Refresh prices
          </button>
          <button
            type="button"
            className="primary-button"
            disabled={disabled}
            onClick={() => switchEditor({ mode: "new", base: null })}
          >
            New price draft
          </button>
        </div>
      )}
      {scope !== null && !editing && (
        <div className="clinic-editor action-box">
          <label>
            Service
            <select
              value={serviceId}
              disabled={locked || needsRefresh}
              onChange={(event) => {
                setServiceId(event.target.value);
                switchEditor(null);
              }}
            >
              <option value="">Select a service</option>
              {scope.services.map((row) => (
                <option key={row.service_id} value={row.service_id}>
                  {nameOf(row)} · {row.code} · {row.status}
                </option>
              ))}
            </select>
          </label>
          {selected !== undefined &&
            (visiblePrices.length === 0 ? (
              <p>No prices recorded for this service.</p>
            ) : (
              <ul className="clinic-record-list">
                {visiblePrices.map((price) => (
                  <li key={price.price_id}>
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={locked || needsRefresh}
                      onClick={() => switchEditor({ mode: "view", base: price })}
                    >
                      {showTerms(price.pricing)} ·{" "}
                      {price.location_id === null
                        ? "All locations"
                        : (scope.locations.find((row) => row.location_id === price.location_id)
                            ?.code ?? "Unlisted location")}{" "}
                      · v{price.version_no} · {price.status}
                    </button>
                  </li>
                ))}
              </ul>
            ))}
        </div>
      )}
      {editor !== null && scope !== null && (
        <div
          className="action-box clinic-editor"
          key={`${editor.mode}:${editor.base?.price_id ?? "new"}:${editor.base?.version_no ?? 0}`}
        >
          {editor.mode === "view" ? (
            <>
              <h3>
                {showTerms(editor.base.pricing)} · {editor.base.status}
              </h3>
              <p>
                {editor.base.location_id === null
                  ? "All locations"
                  : (scope.locations.find((row) => row.location_id === editor.base.location_id)
                      ?.code ?? "Unlisted location")}
              </p>
              {clinicLanguages.map(
                ([locale, name]) =>
                  editor.base.display_text_i18n[locale] !== undefined && (
                    <p key={locale}>
                      <strong>{name}</strong>{" "}
                      <span lang={locale}>{editor.base.display_text_i18n[locale]}</span>
                    </p>
                  ),
              )}
              {editor.base.status === "draft" && (
                <>
                  <p>
                    Publishing replaces the current price for this service, location scope, and
                    currency.
                  </p>
                  <div className="action-row">
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={disabled}
                      onClick={() => switchEditor({ ...editor, mode: "edit" })}
                    >
                      Edit draft
                    </button>
                    <button
                      type="button"
                      className="primary-button"
                      disabled={disabled}
                      onClick={() => changeStatus(editor.base, "publish")}
                    >
                      Publish price
                    </button>
                  </div>
                </>
              )}
              {editor.base.status === "published" && (
                <div className="action-row">
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={disabled}
                    onClick={() => switchEditor({ ...editor, mode: "new" })}
                  >
                    Create revision
                  </button>
                  <details>
                    <summary>Retire price</summary>
                    <p>This removes the price from active knowledge and keeps its history.</p>
                    <button
                      type="button"
                      className="danger-button"
                      disabled={disabled}
                      onClick={() => changeStatus(editor.base, "retire")}
                    >
                      Confirm retirement
                    </button>
                  </details>
                </div>
              )}
            </>
          ) : (
            <form onSubmit={submit}>
              <h3>{editor.mode === "edit" ? "Edit price draft" : "New price draft"}</h3>
              <fieldset disabled={disabled}>
                <PriceFields
                  base={editor.base}
                  locations={scope.locations.filter((row) => row.status === "active")}
                />
                <button type="submit" className="primary-button">
                  Save price draft
                </button>
              </fieldset>
              <div className="action-row">
                <button
                  type="button"
                  className="secondary-button"
                  disabled={locked}
                  onClick={() =>
                    switchEditor(editor.base === null ? null : { mode: "view", base: editor.base })
                  }
                >
                  Cancel
                </button>
              </div>
            </form>
          )}
        </div>
      )}
    </details>
  );
}
