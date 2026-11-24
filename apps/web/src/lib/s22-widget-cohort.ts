import {
  isSchemaValue,
  S22WidgetCohortSelectionResponseSchema,
  S22WidgetCohortStatusResponseSchema,
  type S22WidgetCohortStatus,
} from "@lead-agent/contracts";

import type { StaffRequest } from "./staff-request";

export const S22_WIDGET_COHORT_PATH = "/v1/staff/s22/widget-cohort";

type CohortState = Readonly<{
  visible: boolean;
  snapshot: S22WidgetCohortStatus | null;
  candidateId: string | null;
  freshFrameConfirmed: boolean;
  versionsCurrent: boolean;
  loading: boolean;
  working: boolean;
  error: string | null;
  notice: string | null;
}>;

// This is a presentation deadline only. The application rechecks lifetime,
// ownership, budget and both versions atomically when selecting the session.
export const isS22WidgetCandidateCurrent = (
  candidate: Pick<
    S22WidgetCohortStatus["candidates"][number],
    "issued_at" | "idle_deadline" | "expires_at"
  >,
  now: number,
): boolean =>
  now >= Date.parse(candidate.issued_at) &&
  now < Date.parse(candidate.issued_at) + 300_000 &&
  now < Date.parse(candidate.idle_deadline) &&
  now < Date.parse(candidate.expires_at);

export const formatS22UsdMicros = (value: string): string => {
  const micros = BigInt(value);
  return `USD${micros / 1_000_000n}.${(micros % 1_000_000n).toString().padStart(6, "0")}`;
};

export const createS22WidgetCohort = (
  options: Readonly<{
    request: StaffRequest;
    csrf: () => string | null;
    onAuthenticationRequired: () => void;
    now?: () => number;
  }>,
) => {
  const now = options.now ?? Date.now;
  let state: CohortState = Object.freeze({
    visible: false,
    snapshot: null,
    candidateId: null,
    freshFrameConfirmed: false,
    versionsCurrent: false,
    loading: false,
    working: false,
    error: null,
    notice: null,
  });
  let readEpoch = 0;
  let mutationEpoch = 0;
  const listeners = new Set<() => void>();
  const update = (patch: Partial<CohortState>) => {
    state = Object.freeze({ ...state, ...patch });
    for (const listener of listeners) listener();
  };

  const fetchSnapshot = async (minimumVersion = 0): Promise<boolean> => {
    const epoch = ++readEpoch;
    update({ loading: true, versionsCurrent: false, freshFrameConfirmed: false, error: null });
    try {
      const response = await options.request(S22_WIDGET_COHORT_PATH, { cache: "no-store" });
      if (epoch !== readEpoch) return false;
      // The route is deliberately absent outside the approved staging profile.
      if (response.status === 404 || response.status === 403) {
        update({
          visible: false,
          snapshot: null,
          candidateId: null,
          loading: false,
          versionsCurrent: false,
        });
        return false;
      }
      if (!response.ok) throw new Error("cohort_unavailable");
      const body: unknown = await response.json();
      if (!isSchemaValue(S22WidgetCohortStatusResponseSchema, body))
        throw new Error("invalid_cohort");
      const snapshot = body.data;
      if (snapshot.selection_version < minimumVersion) throw new Error("obsolete_cohort_snapshot");
      if (epoch !== readEpoch) return false;
      update({
        visible: true,
        snapshot,
        candidateId: snapshot.candidates.some((item) => item.session_id === state.candidateId)
          ? state.candidateId
          : null,
        loading: false,
        versionsCurrent: true,
      });
      return true;
    } catch {
      if (epoch === readEpoch)
        update({
          visible: true,
          loading: false,
          versionsCurrent: false,
          error:
            "Test session details could not be refreshed. Selection is paused until refresh succeeds.",
        });
      return false;
    }
  };

  const canSelect = (): boolean => {
    if (
      !state.visible ||
      state.working ||
      state.loading ||
      !state.versionsCurrent ||
      !state.freshFrameConfirmed ||
      state.snapshot === null ||
      !state.snapshot.can_select ||
      state.candidateId === state.snapshot.selected_session_id
    )
      return false;
    const candidate = state.snapshot.candidates.find(
      (item) => item.session_id === state.candidateId,
    );
    return candidate !== undefined && isS22WidgetCandidateCurrent(candidate, now());
  };

  const select = async (): Promise<void> => {
    if (!canSelect() || state.snapshot === null || state.candidateId === null) return;
    const sessionId = state.candidateId;
    const selectionVersion = state.snapshot.selection_version;
    let csrf: string | null;
    try {
      csrf = options.csrf();
    } catch {
      csrf = null;
    }
    if (csrf === null) {
      update({ versionsCurrent: false, freshFrameConfirmed: false });
      options.onAuthenticationRequired();
      return;
    }
    const epoch = ++mutationEpoch;
    let minimumVersion = selectionVersion;
    ++readEpoch;
    update({ working: true, versionsCurrent: false, freshFrameConfirmed: false, notice: null });
    try {
      const response = await options.request(`${S22_WIDGET_COHORT_PATH}/selection`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-csrf-token": csrf },
        body: JSON.stringify({
          session_id: sessionId,
          expected_session_version: 2,
          expected_selection_version: selectionVersion,
        }),
      });
      if (epoch !== mutationEpoch) return;
      if (!response.ok) {
        update({
          notice:
            "The session could not be selected. Refreshing the current selection; do not retry the command.",
        });
      } else {
        const body: unknown = await response.json();
        if (!isSchemaValue(S22WidgetCohortSelectionResponseSchema, body))
          throw new Error("invalid_selection_receipt");
        const receipt = body.data;
        if (
          receipt.selected_session_id !== sessionId ||
          receipt.selection_version !== selectionVersion + 1
        )
          throw new Error("invalid_selection_receipt");
        if (epoch !== mutationEpoch) return;
        minimumVersion = receipt.selection_version;
        update({
          notice:
            "Test session selected. This does not authorize sending a message or increase the budget.",
        });
      }
    } catch {
      if (epoch === mutationEpoch)
        update({
          notice:
            "We could not confirm the selection command. Refreshing its authoritative state; do not retry the command.",
        });
    }
    if (epoch !== mutationEpoch) return;
    // A response (including an ambiguous network failure) never becomes the
    // next command's authoritative version. No mutation is retried implicitly.
    await fetchSnapshot(minimumVersion);
    if (epoch === mutationEpoch) update({ working: false });
  };

  return Object.freeze({
    getSnapshot: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    refresh: () => (state.working ? Promise.resolve(false) : fetchSnapshot()),
    choose: (sessionId: string) => {
      if (state.working || state.loading || !state.versionsCurrent) return;
      if (!state.snapshot?.candidates.some((item) => item.session_id === sessionId)) return;
      update({ candidateId: sessionId, freshFrameConfirmed: false });
    },
    confirmFreshFrame: (confirmed: boolean) => {
      if (state.working || state.loading || !state.versionsCurrent) return;
      update({ freshFrameConfirmed: confirmed });
    },
    canSelect,
    select,
    invalidatePending: () => {
      ++readEpoch;
      ++mutationEpoch;
      update({
        loading: false,
        working: false,
        versionsCurrent: false,
        freshFrameConfirmed: false,
      });
    },
  });
};
