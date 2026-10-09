"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";

import {
  createS22WidgetCohort,
  formatS22UsdMicros,
  isS22WidgetCandidateCurrent,
} from "../../lib/s22-widget-cohort";
import type { StaffRequest } from "../../lib/staff-request";
import { formatStaffDateTime, readCsrfCookie } from "../../lib/staff-ui";

export function S22WidgetCohort({
  request,
  onAuthenticationRequired,
}: Readonly<{
  request: StaffRequest;
  onAuthenticationRequired: () => void;
}>) {
  const controller = useMemo(
    () =>
      createS22WidgetCohort({
        request,
        csrf: () => readCsrfCookie(document.cookie),
        onAuthenticationRequired,
      }),
    [request, onAuthenticationRequired],
  );
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    void controller.refresh();
    return () => controller.invalidatePending();
  }, [controller]);
  useEffect(() => {
    // Only the display clock updates. There is no background API polling,
    // session renewal, session creation or paid dispatch.
    if (!state.visible || state.snapshot?.candidates.length === 0) return;
    const handle = globalThis.setInterval(() => setNow(Date.now()), 1_000);
    return () => globalThis.clearInterval(handle);
  }, [state.visible, state.snapshot?.candidates.length]);
  if (!state.visible) return null;
  const snapshot = state.snapshot;
  return (
    <section aria-label="S22 synthetic Website Chat test" className="s22-widget-cohort">
      <h4>S22 synthetic Website Chat test</h4>
      <p className="integration-detail">
        After the reviewed runtime is deployed, open one fresh empty chat on the approved test
        website. Then refresh here and choose its exact session. Reopening an old chat does not
        create a fresh session. Selection does not authorize Send or renew the session. Choose it
        within five minutes of opening the fresh frame.
      </p>
      {state.notice !== null && <p role="status">{state.notice}</p>}
      {state.error !== null && <p role="alert">{state.error}</p>}
      <button
        type="button"
        className="ghost-button"
        disabled={state.loading || state.working}
        onClick={() => void controller.refresh()}
      >
        {state.loading ? "Refreshing test sessions..." : "Refresh test sessions"}
      </button>
      {snapshot !== null && (
        <>
          <p className="integration-detail">
            Current selection: <code>{snapshot.selected_session_id ?? "None"}</code>
            <br />
            Known AI cost: {formatS22UsdMicros(snapshot.known_cost_micros)}; total reserved
            exposure: {formatS22UsdMicros(snapshot.combined_exposure_micros)}; pending reserve:{" "}
            {formatS22UsdMicros(snapshot.unresolved_reserve_micros)}.
            <br />
            Paid dispatch: {snapshot.blocked ? "blocked" : "budget check ready"}. Historical unknown
            costs remain visible in the evidence register. This snapshot is not paid-test approval.
          </p>
          {snapshot.candidates.length === 0 ? (
            <p className="integration-detail">No fresh eligible empty session is available.</p>
          ) : (
            <fieldset disabled={state.loading || state.working || !state.versionsCurrent}>
              <legend>Choose only the fresh frame you just opened</legend>
              {snapshot.candidates.map((candidate) => {
                const current = isS22WidgetCandidateCurrent(candidate, now);
                return (
                  <label key={candidate.session_id}>
                    <input
                      type="radio"
                      name="s22-widget-session"
                      checked={state.candidateId === candidate.session_id}
                      disabled={!current}
                      onChange={() => controller.choose(candidate.session_id)}
                    />
                    <code>{candidate.session_id}</code>
                    <br />
                    Opened {formatStaffDateTime(candidate.issued_at)}; idle deadline{" "}
                    {formatStaffDateTime(candidate.idle_deadline)}; absolute expiry{" "}
                    {formatStaffDateTime(candidate.expires_at)} (Asia/Tashkent).
                    {!current &&
                      " Fresh-selection window or session lifetime elapsed: unavailable."}
                    <br />
                  </label>
                );
              })}
            </fieldset>
          )}
          {!snapshot.can_select && (
            <p className="integration-detail">
              Session selection is blocked by the authoritative cohort guard. Refresh after the
              blocker is resolved; do not send a message or replace the installation.
            </p>
          )}
          <label>
            <input
              type="checkbox"
              checked={state.freshFrameConfirmed}
              disabled={
                state.candidateId === null ||
                state.loading ||
                state.working ||
                !state.versionsCurrent
              }
              onChange={(event) => controller.confirmFreshFrame(event.target.checked)}
            />
            I confirm this exact session is the fresh empty test frame I just opened.
          </label>
          <div className="action-row">
            <button
              type="button"
              className="secondary-button"
              disabled={!controller.canSelect()}
              onClick={() => void controller.select()}
            >
              {state.working ? "Selecting test session..." : "Select this test session"}
            </button>
          </div>
        </>
      )}
    </section>
  );
}
