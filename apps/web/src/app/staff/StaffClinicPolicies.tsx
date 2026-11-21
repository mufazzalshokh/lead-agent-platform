import { useRef, useState } from "react";
import {
  listQualificationPolicies,
  preparePolicyChange,
  qualificationPolicyKey,
  writeQualificationPolicy,
  type PreparedPolicyChange,
} from "../../lib/staff-clinic-policies";
import type { StaffRequest } from "../../lib/staff-request";
import { readCsrfCookie } from "../../lib/staff-ui";

type Policies = Awaited<ReturnType<typeof listQualificationPolicies>>;

export function StaffClinicPolicies({ request }: Readonly<{ request: StaffRequest }>) {
  const [policies, setPolicies] = useState<Policies | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const [pending, setPending] = useState<PreparedPolicyChange | null>(null);
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

  const load = async () => {
    try {
      setPolicies(await listQualificationPolicies(request));
      setNeedsRefresh(false);
    } catch {
      setNeedsRefresh(true);
      setError("Policies could not be loaded. Refresh before making another change.");
    }
  };

  const save = (command: PreparedPolicyChange) =>
    run(async () => {
      setNotice(null);
      let csrf: string | null;
      try {
        csrf = readCsrfCookie(document.cookie);
      } catch {
        csrf = null;
      }
      const result = await writeQualificationPolicy(request, command, csrf);
      if (result.kind !== "saved") {
        if (result.kind === "uncertain") setPending(command);
        else if (csrf !== null) setPending(null);
        if (result.kind === "stale") setNeedsRefresh(true);
        setError(result.message);
        return;
      }
      setPending(null);
      setSelectedId(result.resource.policy_id);
      setPolicies((rows) => [
        result.resource,
        ...(rows ?? []).filter((row) => row.policy_id !== result.resource.policy_id),
      ]);
      setNotice(
        result.resource.status === "draft"
          ? "Qualification draft created."
          : result.resource.status === "published"
            ? "Qualification policy published."
            : "Qualification policy retired.",
      );
      await load();
    });

  const act = (change: Parameters<typeof preparePolicyChange>[0]) => {
    const command = preparePolicyChange(change, crypto.randomUUID());
    if (command !== null) void save(command);
  };

  const selected = policies?.find((row) => row.policy_id === selectedId);
  const key = policies === null ? null : qualificationPolicyKey(policies);
  const current = policies?.find((row) => row.status === "published" && row.policy_key === key);
  const locked = busy || pending !== null;
  const disabled = locked || needsRefresh;
  const canPublish =
    selected?.status === "draft" &&
    selected.policy_key === key &&
    (current === undefined || selected.version_no > current.version_no);

  return (
    <details
      className="clinic-knowledge-panel"
      onToggle={(event) => {
        if (event.currentTarget.open && policies === null && error === null) void run(load);
      }}
    >
      <summary>Qualification policy</summary>
      {busy && <p role="status">Updating qualification policies…</p>}
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
      <div className="action-row">
        <button
          type="button"
          className="secondary-button"
          disabled={locked}
          onClick={() => void run(load)}
        >
          Refresh policies
        </button>
        <button
          type="button"
          className="primary-button"
          disabled={disabled || key === null}
          onClick={() => {
            if (key !== null) act({ action: "create", key });
          }}
        >
          Create qualification draft
        </button>
      </div>
      {policies !== null && key === null && (
        <p>
          More than one qualification policy is published. Review and retire the extra policy before
          publishing another version.
        </p>
      )}
      {policies?.length === 0 && <p>No qualification policy versions yet.</p>}
      {policies !== null && policies.length > 0 && (
        <ul className="clinic-record-list">
          {policies.map((row) => (
            <li key={row.policy_id}>
              <button
                className="secondary-button"
                type="button"
                disabled={locked}
                onClick={() => {
                  setSelectedId(row.policy_id);
                  setNotice(null);
                }}
              >
                {row.policy_key} · v{row.version_no} · {row.status}
              </button>
            </li>
          ))}
        </ul>
      )}
      {selected !== undefined && (
        <div className="action-box clinic-editor" key={selected.policy_id + selected.status}>
          <h3>
            {selected.policy_key} · v{selected.version_no} · {selected.status}
          </h3>
          <p>
            Qualification requires interest in a service, a supported location, intent to take a
            next step, and a way to contact the customer.
          </p>
          <p>Disqualification reasons</p>
          <ul>
            {selected.rules.disqualification_reasons.map((reason) => (
              <li key={reason}>{reason.replaceAll("_", " ")}</li>
            ))}
          </ul>
          {selected.status === "draft" && (
            <>
              <p>
                {canPublish
                  ? "Publishing makes this saved version active for the clinic."
                  : "Review the current policy key and version before publishing this draft."}
              </p>
              <button
                type="button"
                className="primary-button"
                disabled={disabled || !canPublish}
                onClick={() => act({ action: "publish", policy: selected })}
              >
                Publish qualification policy
              </button>
            </>
          )}
          {selected.status === "published" && (
            <details>
              <summary>Retire policy</summary>
              <p>Retirement takes this version out of effect and keeps its history.</p>
              <button
                type="button"
                className="danger-button"
                disabled={disabled}
                onClick={() => act({ action: "retire", policy: selected })}
              >
                Confirm retirement
              </button>
            </details>
          )}
        </div>
      )}
    </details>
  );
}
