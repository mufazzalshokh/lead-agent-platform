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
  const chosen = snapshot?.candidates.find(
    (candidate) => candidate.session_id === state.candidateId,
  );
  const alreadySelected =
    state.versionsCurrent &&
    snapshot !== null &&
    snapshot.selected_session_id !== null &&
    (state.candidateId === null || state.candidateId === snapshot.selected_session_id);
  const confirmationAvailable =
    !state.loading &&
    !state.working &&
    state.versionsCurrent &&
    !alreadySelected &&
    snapshot?.can_select === true &&
    chosen !== undefined &&
    isS22WidgetCandidateCurrent(chosen, now);
  const selectionHelp = () => {
    if (state.working) return "Selecting your chat and checking the saved selection...";
    if (state.loading) return "Refreshing session details. Please wait.";
    if (!state.versionsCurrent) return "Refresh needed before choosing or confirming a chat.";
    if (alreadySelected)
      return "You do not need to select it again. Selection does not authorize Send or renew the session.";
    if (!snapshot?.can_select)
      return "Selection is blocked by the cohort guard. Do not send a message or replace the installation.";
    if (snapshot.candidates.length === 0)
      return "No fresh eligible empty chat is available. Reopening an old chat does not create a fresh session.";
    if (chosen === undefined)
      return "Choose the circle next to your chat first, then tick the confirmation below.";
    if (!isS22WidgetCandidateCurrent(chosen, now))
      return "This chat can no longer be selected. Its selection window or session lifetime ended.";
    if (!state.freshFrameConfirmed)
      return "Tick the confirmation below, then select this test session.";
    return "Ready to save your choice. This does not authorize Send or increase the budget.";
  };
  return (
    <section aria-label="S22 synthetic Website Chat test" className="s22-widget-cohort">
      <h4>S22 synthetic Website Chat test</h4>
      <p className="integration-detail">
        Choose the fresh empty chat you opened on the approved test website, then confirm it is
        yours. Both steps are required. Select within five minutes of opening it; this does not
        authorize Send or renew the session.
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
          <div className="s22-widget-cohort__summary">
            <strong>
              {state.versionsCurrent && snapshot.selected_session_id !== null
                ? "Session selected"
                : !state.versionsCurrent
                  ? "Refresh needed"
                  : "No chat selected yet"}
            </strong>
            <span>
              Current selection: <code>{snapshot.selected_session_id ?? "None"}</code>
            </span>
          </div>
          <p className="integration-detail">
            Known AI cost: {formatS22UsdMicros(snapshot.known_cost_micros)}; total reserved
            exposure: {formatS22UsdMicros(snapshot.combined_exposure_micros)}; pending reserve:{" "}
            {formatS22UsdMicros(snapshot.unresolved_reserve_micros)}.
            <br />
            {state.versionsCurrent
              ? `Last budget check: ${snapshot.blocked ? "blocked" : "budget check ready"}.`
              : "Budget snapshot needs refresh."}{" "}
            Historical unknown costs remain visible in the evidence register. This snapshot is not
            paid-test approval.
          </p>
          {snapshot.candidates.length === 0 ? (
            <p className="integration-detail">No fresh eligible empty session is available.</p>
          ) : (
            <fieldset
              className="s22-widget-cohort__choices"
              disabled={
                state.loading || state.working || !state.versionsCurrent || !snapshot.can_select
              }
            >
              <legend>1. Choose your chat</legend>
              <p className="integration-detail">
                Choose only the fresh frame you just opened. All times are Asia/Tashkent.
              </p>
              {snapshot.candidates.map((candidate) => {
                const current = isS22WidgetCandidateCurrent(candidate, now);
                const selected = candidate.session_id === snapshot.selected_session_id;
                const selectionDeadline = new Date(
                  Math.min(
                    Date.parse(candidate.issued_at) + 300_000,
                    Date.parse(candidate.idle_deadline),
                    Date.parse(candidate.expires_at),
                  ),
                ).toISOString();
                return (
                  <label
                    key={candidate.session_id}
                    className="s22-widget-cohort__candidate"
                    data-available={current && !selected}
                  >
                    <input
                      type="radio"
                      name="s22-widget-session"
                      checked={state.candidateId === candidate.session_id}
                      disabled={!current || selected}
                      onChange={() => controller.choose(candidate.session_id)}
                    />
                    <span className="s22-widget-cohort__candidate-details">
                      <strong>Opened {formatStaffDateTime(candidate.issued_at)}</strong>
                      <span className="s22-widget-cohort__availability">
                        {selected
                          ? "Already selected"
                          : current
                            ? `Select before ${formatStaffDateTime(selectionDeadline)}`
                            : "Selection window ended"}
                      </span>
                      <span>
                        Idle deadline: {formatStaffDateTime(candidate.idle_deadline)}. Absolute
                        expiry: {formatStaffDateTime(candidate.expires_at)}.
                      </span>
                      <code>Session: {candidate.session_id}</code>
                    </span>
                  </label>
                );
              })}
            </fieldset>
          )}
          <h5>2. Confirm your choice</h5>
          <p id="s22-widget-confirmation-help" className="s22-widget-cohort__help">
            {selectionHelp()}
          </p>
          <label className="s22-widget-cohort__confirmation" aria-disabled={!confirmationAvailable}>
            <input
              type="checkbox"
              checked={state.freshFrameConfirmed}
              disabled={!confirmationAvailable}
              aria-describedby="s22-widget-confirmation-help"
              onChange={(event) => controller.confirmFreshFrame(event.target.checked)}
            />
            <span>I confirm this exact session is the fresh empty test frame I just opened.</span>
          </label>
          <div className="action-row">
            <button
              type="button"
              className="secondary-button"
              disabled={!controller.canSelect()}
              onClick={() => void controller.select()}
            >
              {state.working
                ? "Selecting test session..."
                : alreadySelected
                  ? "Session already selected"
                  : "Select this test session"}
            </button>
          </div>
        </>
      )}
    </section>
  );
}
