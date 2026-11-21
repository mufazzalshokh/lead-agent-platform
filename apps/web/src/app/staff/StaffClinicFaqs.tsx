import { useRef, useState, type FormEvent } from "react";
import type { Faq, LocalizedText } from "@lead-agent/contracts";
import {
  faqLanguages,
  faqPublication,
  listClinicFaqs,
  loadFaqScope,
  prepareFaqCommand,
  readFaqDraft,
  writeClinicFaq,
  type PreparedFaqCommand,
} from "../../lib/staff-clinic-faqs";
import type { StaffRequest } from "../../lib/staff-request";
import { readCsrfCookie } from "../../lib/staff-ui";

type Scope = Awaited<ReturnType<typeof loadFaqScope>>;
type Editor = { mode: "view" | "edit"; faq: Faq } | { mode: "create"; faq: Faq | null };

const localized = (content: LocalizedText | undefined) => content?.en ?? content?.uz ?? content?.ru;
const locationName = (location: Scope["locations"][number]) =>
  localized(location.current_version?.name_i18n) ?? location.code;
const serviceName = (service: Scope["services"][number]) =>
  localized(service.current_version?.name_i18n) ?? service.code;

function FaqDraftFields({ editor, scope }: Readonly<{ editor: Editor; scope: Scope }>) {
  const { faq } = editor;
  const location = faq?.location_id;
  const service = faq?.service_id;
  return (
    <>
      {faq === null && (
        <label>
          FAQ key
          <input name="faq_key" placeholder="parking" maxLength={128} required />
        </label>
      )}
      {editor.mode === "create" && faq !== null && (
        <input name="faq_key" type="hidden" value={faq.faq_key} />
      )}
      <div className="clinic-faq-scope">
        <label>
          Location
          <select name="location_id" defaultValue={location ?? ""}>
            <option value="">All locations</option>
            {location != null && !scope.locations.some((row) => row.location_id === location) && (
              <option value={location}>Current location (unlisted)</option>
            )}
            {scope.locations.map((row) => (
              <option key={row.location_id} value={row.location_id}>
                {locationName(row)}
                {row.status === "inactive" && " (inactive)"}
              </option>
            ))}
          </select>
        </label>
        <label>
          Service
          <select name="service_id" defaultValue={service ?? ""}>
            <option value="">All services</option>
            {service != null && !scope.services.some((row) => row.service_id === service) && (
              <option value={service}>Current service (unlisted)</option>
            )}
            {scope.services.map((row) => (
              <option key={row.service_id} value={row.service_id}>
                {serviceName(row)}
                {row.status === "inactive" && " (inactive)"}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p>Enter a question and answer in at least your clinic’s default language.</p>
      {faqLanguages.map(([locale, name]) => (
        <div key={locale} className="clinic-faq-translation">
          <label>
            Question in {name}
            <input
              name={`question_${locale}`}
              maxLength={4000}
              defaultValue={faq?.question_i18n[locale]}
            />
          </label>
          <label>
            Answer in {name}
            <textarea
              name={`answer_${locale}`}
              maxLength={4000}
              rows={3}
              defaultValue={faq?.answer_i18n[locale]}
            />
          </label>
        </div>
      ))}
    </>
  );
}

export function StaffClinicFaqs({ request }: Readonly<{ request: StaffRequest }>) {
  const [faqs, setFaqs] = useState<Faq[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [scope, setScope] = useState<Scope | null>(null);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [busy, setBusy] = useState(false);
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState<PreparedFaqCommand | null>(null);
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

  const load = async () => {
    try {
      const [page, choices] = await Promise.all([listClinicFaqs(request), loadFaqScope(request)]);
      setScope(choices);
      setFaqs(page.data);
      setCursor(page.meta.next_cursor ?? null);
      setNeedsRefresh(false);
      return true;
    } catch {
      setNeedsRefresh(true);
      setError("FAQs and scope could not be loaded. Refresh to try again.");
      return false;
    }
  };

  const refresh = () =>
    run(async () => {
      if (await load()) {
        setEditor(null);
        setNotice(null);
      }
    });

  const loadMore = () =>
    run(async () => {
      if (cursor === null) return;
      try {
        const page = await listClinicFaqs(request, cursor);
        const next = page.meta.next_cursor ?? null;
        if (next === cursor) throw new Error("Repeated FAQ cursor");
        setFaqs((previous) => [
          ...new Map([...previous, ...page.data].map((faq) => [faq.faq_id, faq])).values(),
        ]);
        setCursor(next);
      } catch {
        setError("More FAQs could not be loaded. Try again.");
      }
    });

  const save = (command: PreparedFaqCommand) =>
    run(async () => {
      setNotice(null);
      let csrf: string | null;
      try {
        csrf = readCsrfCookie(document.cookie);
      } catch {
        csrf = null;
      }
      const result = await writeClinicFaq(request, command, csrf);
      if (result.kind !== "saved") {
        if (result.kind === "uncertain") setPending(command);
        else if (csrf !== null) setPending(null);
        if (result.kind === "stale") setNeedsRefresh(true);
        setError(result.message);
        return;
      }
      setPending(null);
      setEditor({ mode: "view", faq: result.faq });
      setNotice(
        result.faq.status === "draft"
          ? "Draft saved."
          : result.faq.status === "published"
            ? "FAQ published."
            : "FAQ retired.",
      );
      await load();
    });

  const startEdit = (next: Editor | null) => {
    setError(null);
    setNotice(null);
    setEditor(next);
  };

  const submitDraft = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (inFlight.current || pending !== null || needsRefresh || editor === null) return;
    const draft = readFaqDraft(
      new FormData(event.currentTarget),
      editor.mode === "edit" ? editor.faq : null,
    );
    if (draft === null) {
      setError(
        "Enter a valid FAQ key and a complete question and answer for each language you use.",
      );
      return;
    }
    void save(prepareFaqCommand(draft, crypto.randomUUID()));
  };

  const publishOrRetire = (faq: Faq, action: "publish" | "retire") => {
    if (inFlight.current || pending !== null || needsRefresh) return;
    const command = faqPublication(faq, action);
    if (command !== null) void save(prepareFaqCommand(command, crypto.randomUUID()));
  };

  const locked = busy || pending !== null;
  const editing = editor !== null && editor.mode !== "view";
  const faq = editor?.faq;

  return (
    <section className="integrations-overview" aria-label="Clinic knowledge">
      <div className="integrations-overview__heading">
        <h2>Clinic knowledge</h2>
      </div>
      <details
        className="clinic-faqs"
        onToggle={(event) => {
          if (event.currentTarget.open && scope === null && !needsRefresh) void refresh();
        }}
      >
        <summary>FAQs</summary>
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
        {busy && <p role="status">Updating FAQs…</p>}
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
        {(!editing || needsRefresh) && (
          <div className="action-row">
            <button
              className="secondary-button"
              type="button"
              disabled={locked}
              onClick={() => void refresh()}
            >
              Refresh FAQs
            </button>
            <button
              className="primary-button"
              type="button"
              disabled={locked || needsRefresh || scope === null}
              onClick={() => startEdit({ mode: "create", faq: null })}
            >
              New FAQ
            </button>
          </div>
        )}
        {scope !== null && !editing && (
          <>
            {faqs.length === 0 ? (
              <p>No FAQs yet.</p>
            ) : (
              <ul className="clinic-faq-list">
                {faqs.map((row) => (
                  <li key={row.faq_id}>
                    <button
                      className="secondary-button"
                      disabled={locked || needsRefresh}
                      type="button"
                      onClick={() => startEdit({ mode: "view", faq: row })}
                    >
                      {localized(row.question_i18n)} · {row.faq_key} · v{row.version_no} ·{" "}
                      {row.status}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {cursor !== null && (
              <button
                className="secondary-button"
                type="button"
                disabled={locked || needsRefresh}
                onClick={() => void loadMore()}
              >
                Load more FAQs
              </button>
            )}
          </>
        )}
        {editor !== null && scope !== null && (
          <div
            className="action-box clinic-faq-editor"
            key={`${editor.mode}:${faq?.faq_id ?? "new"}:${faq?.version_no ?? 0}`}
          >
            {editor.mode === "view" ? (
              <>
                <h3>
                  {editor.faq.faq_key} · v{editor.faq.version_no} · {editor.faq.status}
                </h3>
                <p>
                  {editor.faq.location_id === null
                    ? "All locations"
                    : (scope.locations.find((row) => row.location_id === editor.faq.location_id)
                        ?.code ?? "Unlisted location")}{" "}
                  ·{" "}
                  {editor.faq.service_id === null
                    ? "All services"
                    : (scope.services.find((row) => row.service_id === editor.faq.service_id)
                        ?.code ?? "Unlisted service")}
                </p>
                {faqLanguages.map(
                  ([locale, name]) =>
                    (editor.faq.question_i18n[locale] !== undefined ||
                      editor.faq.answer_i18n[locale] !== undefined) && (
                      <div key={locale} className="clinic-faq-preview" lang={locale}>
                        <p>
                          <strong>{editor.faq.question_i18n[locale]}</strong>{" "}
                          <small lang="en">{name}</small>
                        </p>
                        <p>{editor.faq.answer_i18n[locale]}</p>
                      </div>
                    ),
                )}
                {editor.faq.status === "draft" && (
                  <>
                    <p>
                      Publishing makes this saved version available for customer answers
                      immediately.
                    </p>
                    <div className="action-row">
                      <button
                        className="secondary-button"
                        type="button"
                        disabled={locked || needsRefresh}
                        onClick={() => startEdit({ mode: "edit", faq: editor.faq })}
                      >
                        Edit draft
                      </button>
                      <button
                        className="primary-button"
                        type="button"
                        disabled={locked || needsRefresh}
                        onClick={() => publishOrRetire(editor.faq, "publish")}
                      >
                        Publish FAQ
                      </button>
                    </div>
                  </>
                )}
                {editor.faq.status === "published" && (
                  <div className="action-row">
                    <button
                      className="secondary-button"
                      type="button"
                      disabled={locked || needsRefresh}
                      onClick={() => startEdit({ mode: "create", faq: editor.faq })}
                    >
                      Create revision
                    </button>
                    <details>
                      <summary>Retire FAQ</summary>
                      <p>
                        Retiring removes this version from customer answers and keeps its history.
                      </p>
                      <button
                        className="danger-button"
                        type="button"
                        disabled={locked || needsRefresh}
                        onClick={() => publishOrRetire(editor.faq, "retire")}
                      >
                        Confirm retirement
                      </button>
                    </details>
                  </div>
                )}
              </>
            ) : (
              <form onSubmit={submitDraft}>
                <h3>
                  {editor.mode === "edit"
                    ? "Edit FAQ draft"
                    : faq === null
                      ? "New FAQ draft"
                      : "New FAQ revision"}
                </h3>
                <fieldset disabled={locked || needsRefresh}>
                  <FaqDraftFields editor={editor} scope={scope} />
                </fieldset>
                <div className="action-row">
                  <button
                    className="primary-button"
                    type="submit"
                    disabled={locked || needsRefresh}
                  >
                    Save draft
                  </button>
                  <button
                    className="secondary-button"
                    type="button"
                    disabled={locked}
                    onClick={() => startEdit(faq == null ? null : { mode: "view", faq })}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            )}
          </div>
        )}
      </details>
    </section>
  );
}
