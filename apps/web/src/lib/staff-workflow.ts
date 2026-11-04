import { makeIdempotencyKey, staffActionMessage } from "./staff-ui";

export type RecordValue = Readonly<Record<string, unknown>>;
export type AppointmentPreference = Readonly<{
  localStart: string | null;
  precision: string;
  startAt: string | null;
  timeZone: string;
}>;
export type WorkItem = Readonly<{
  actionable: boolean;
  activityAt: string;
  appointmentRequestId: string | null;
  appointmentStatus: string | null;
  contactId: string | null;
  conversationId: string | null;
  conversationVersion: number | null;
  handoffId: string | null;
  handoffStatus: string | null;
  id: string;
  kind: string;
  leadId: string | null;
  preferences: readonly AppointmentPreference[];
  status: string;
  version: number;
}>;

export type DetailState = Readonly<{
  appointment: RecordValue | null;
  contact: RecordValue | null;
  conversation: RecordValue | null;
  handoff: RecordValue | null;
  lead: RecordValue | null;
  messages: readonly RecordValue[];
}>;

const isRecord = (value: unknown): value is RecordValue =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const stringValue = (value: unknown): string | null => (typeof value === "string" ? value : null);
const numberValue = (value: unknown): number | null =>
  typeof value === "number" && Number.isSafeInteger(value) ? value : null;
const recordValue = (value: unknown): RecordValue | null => (isRecord(value) ? value : null);
const parseAppointmentPreference = (value: unknown): AppointmentPreference | null => {
  if (!isRecord(value)) return null;
  const precision = stringValue(value["precision"]);
  const timeZone = stringValue(value["time_zone"]);
  if (precision === null || timeZone === null) return null;
  return Object.freeze({
    localStart: stringValue(value["local_start"]),
    precision,
    startAt: stringValue(value["start_at"]),
    timeZone,
  });
};

export const parseWorkItem = (value: unknown): WorkItem | null => {
  if (!isRecord(value)) return null;
  const id = stringValue(value["id"]);
  const kind = stringValue(value["kind"]);
  const status = stringValue(value["status"]);
  const activityAt = stringValue(value["activity_at"]);
  const version = numberValue(value["version"]);
  if (
    id === null ||
    kind === null ||
    status === null ||
    activityAt === null ||
    version === null ||
    typeof value["actionable"] !== "boolean"
  ) {
    return null;
  }
  return Object.freeze({
    actionable: value["actionable"],
    activityAt,
    appointmentRequestId: stringValue(value["appointment_request_id"]),
    appointmentStatus: stringValue(value["appointment_status"]),
    contactId: stringValue(value["contact_id"]),
    conversationId: stringValue(value["conversation_id"]),
    conversationVersion: numberValue(value["conversation_version"]),
    handoffId: stringValue(value["handoff_id"]),
    handoffStatus: stringValue(value["handoff_status"]),
    id,
    kind,
    leadId: stringValue(value["lead_id"]),
    preferences: Array.isArray(value["preferences"])
      ? value["preferences"].map(parseAppointmentPreference).filter((item) => item !== null)
      : [],
    status,
    version,
  });
};

const responseData = async (response: Response): Promise<unknown> => {
  const body: unknown = await response.json();
  return isRecord(body) ? body["data"] : null;
};

export const actionIdentity = (
  resource: RecordValue | null,
): Readonly<{ id: string; version: number }> | null => {
  const id = stringValue(resource?.["id"]);
  const version = numberValue(resource?.["version"]);
  return id === null || version === null ? null : { id, version };
};

export type StaffWorkView = "active" | "history";
type WorkflowState = Readonly<{
  view: StaffWorkView;
  items: readonly WorkItem[];
  summaries: Readonly<Record<string, string>>;
  nextCursor: string | null;
  selected: WorkItem | null;
  detail: DetailState | null;
  loading: boolean;
  detailLoading: boolean;
  working: boolean;
  versionsCurrent: boolean;
  listError: string | null;
  detailError: string | null;
  notice: string | null;
}>;
type Request = (path: string, init?: RequestInit) => Promise<Response>;

export const focusStaffConversation = (
  region: Pick<HTMLElement, "focus" | "scrollIntoView"> | null,
): void => {
  region?.focus({ preventScroll: true });
  region?.scrollIntoView({ block: "start", behavior: "auto" });
};

export const createStaffWorkflow = (
  options: Readonly<{
    request: Request;
    csrf: () => string | null;
    randomId: () => string;
  }>,
) => {
  let state: WorkflowState = Object.freeze({
    view: "active",
    items: [],
    summaries: {},
    nextCursor: null,
    selected: null,
    detail: null,
    loading: false,
    detailLoading: false,
    working: false,
    versionsCurrent: false,
    listError: null,
    detailError: null,
    notice: null,
  });
  let listEpoch = 0,
    detailEpoch = 0,
    mutationEpoch = 0;
  const listeners = new Set<() => void>();
  const update = (patch: Partial<WorkflowState>) => {
    state = Object.freeze({ ...state, ...patch });
    for (const listener of listeners) listener();
  };
  const loadList = async (cursor?: string, append = false): Promise<boolean> => {
    const epoch = ++listEpoch;
    const view = state.view;
    update({ loading: true, listError: null });
    try {
      const query = new URLSearchParams({ limit: "25", view });
      if (cursor !== undefined) query.set("cursor", cursor);
      const response = await options.request(`/v1/staff/inbox?${query}`);
      if (!response.ok) throw new Error("list_unavailable");
      const body: unknown = await response.json();
      if (!isRecord(body) || !Array.isArray(body["data"]) || !isRecord(body["meta"]))
        throw new Error("invalid_list");
      const parsed = body["data"].map(parseWorkItem);
      if (parsed.some((item) => item === null)) throw new Error("invalid_work_item");
      const items = parsed.filter((item) => item !== null);
      if (epoch !== listEpoch) return false;
      update({
        items: append
          ? [...state.items.filter((item) => !items.some((next) => next.id === item.id)), ...items]
          : items,
        nextCursor: stringValue(body["meta"]["next_cursor"]),
        loading: false,
      });
      // Participant summaries are presentation-only; their failure never discards work.
      void Promise.all(
        items.map(async (item) => {
          if (item.conversationId === null) return null;
          const response = await options.request(`/v2/staff/conversations/${item.conversationId}`);
          if (!response.ok) return null;
          const value = recordValue(await responseData(response));
          const label = stringValue(recordValue(value?.["participant"])?.["display_redacted"]);
          return label === null ? null : ([item.id, label] as const);
        }),
      )
        .then((values) => {
          if (epoch !== listEpoch) return;
          const summaries = { ...state.summaries };
          for (const value of values) if (value !== null) summaries[value[0]] = value[1];
          update({ summaries });
        })
        .catch(() => undefined);
      return true;
    } catch {
      if (epoch === listEpoch)
        update({
          loading: false,
          listError: "Customer work could not be loaded. Retry to obtain the current list.",
        });
      return false;
    }
  };
  const readDetail = async (item: WorkItem): Promise<DetailState> => {
    const get = async (path: string | null): Promise<unknown> => {
      if (path === null) return null;
      const response = await options.request(path);
      if (!response.ok) throw new Error("detail_unavailable");
      return responseData(response);
    };
    const [conversation, messages, contact, lead, handoff, appointment] = await Promise.all([
      get(item.conversationId === null ? null : `/v2/staff/conversations/${item.conversationId}`),
      get(
        item.conversationId === null
          ? null
          : `/v1/staff/conversations/${item.conversationId}/messages?limit=100`,
      ),
      get(item.contactId === null ? null : `/v2/staff/contacts/${item.contactId}`),
      get(item.leadId === null ? null : `/v1/staff/leads/${item.leadId}`),
      get(item.handoffId === null ? null : `/v1/staff/handoffs/${item.handoffId}`),
      get(
        item.appointmentRequestId === null
          ? null
          : `/v1/staff/appointment-requests/${item.appointmentRequestId}`,
      ),
    ]);
    const result = {
      conversation: recordValue(conversation),
      messages: Array.isArray(messages) ? messages.filter(isRecord) : [],
      contact: recordValue(contact),
      lead: recordValue(lead),
      handoff: recordValue(handoff),
      appointment: recordValue(appointment),
    };
    for (const [id, resource] of [
      [item.conversationId, result.conversation],
      [item.handoffId, result.handoff],
      [item.appointmentRequestId, result.appointment],
    ] as const) {
      if (
        id !== null &&
        (actionIdentity(resource)?.id !== id || (actionIdentity(resource)?.version ?? 0) < 1)
      )
        throw new Error("invalid_authoritative_resource");
    }
    if (
      item.conversationId !== null &&
      (!Array.isArray(messages) || messages.some((message) => !isRecord(message)))
    )
      throw new Error("invalid_messages");
    const conversationVersion = actionIdentity(result.conversation)?.version;
    for (const resource of [result.handoff, result.appointment]) {
      if (resource !== null && resource["conversation_version"] !== conversationVersion)
        throw new Error("inconsistent_conversation_version");
    }
    const activeHandoffId = result.conversation?.["active_handoff_id"];
    if (activeHandoffId != null && activeHandoffId !== item.handoffId)
      throw new Error("changed_active_handoff");
    return result;
  };
  const refreshDetail = async (item: WorkItem): Promise<boolean> => {
    const epoch = ++detailEpoch;
    update({ detailLoading: true, detailError: null, versionsCurrent: false });
    try {
      const detail = await readDetail(item);
      if (epoch !== detailEpoch || state.selected?.id !== item.id) return false;
      const conversation = actionIdentity(detail.conversation);
      const handoffStatus = stringValue(detail.handoff?.["status"]);
      const appointmentStatus = stringValue(detail.appointment?.["status"]);
      const status = stringValue(detail.conversation?.["status"]) ?? item.status;
      update({
        detail,
        detailLoading: false,
        versionsCurrent: true,
        selected: {
          ...item,
          status,
          conversationVersion: conversation?.version ?? null,
          version:
            item.kind === "conversation" ? (conversation?.version ?? item.version) : item.version,
          handoffStatus,
          appointmentStatus,
          actionable:
            status === "awaiting_staff" ||
            ["requested", "assigned", "in_progress"].includes(handoffStatus ?? "") ||
            appointmentStatus === "requested",
        },
      });
      return true;
    } catch {
      if (epoch === detailEpoch)
        update({
          detailLoading: false,
          versionsCurrent: false,
          detailError:
            "Current conversation details could not be loaded. Actions are paused until refresh succeeds.",
        });
      return false;
    }
  };
  const refresh = async () => {
    const item = state.selected;
    const listTask = loadList();
    const detailTask = item === null ? Promise.resolve(true) : refreshDetail(item);
    const listToken = listEpoch,
      detailToken = detailEpoch;
    const [listReady, detailReady] = await Promise.all([listTask, detailTask]);
    if (
      listToken === listEpoch &&
      detailToken === detailEpoch &&
      state.selected?.id === item?.id &&
      (!listReady || !detailReady)
    )
      update({
        versionsCurrent: false,
        detailError:
          state.detailError ??
          "Current staff work could not be refreshed. Actions are paused until refresh succeeds.",
      });
  };
  const mutate = async (
    path: string,
    resource: Readonly<{ id: string; version: number }>,
    body: RecordValue,
  ): Promise<void> => {
    const item = state.selected;
    if (state.working || item === null || !state.versionsCurrent || state.detailLoading) return;
    const authoritative = path.startsWith("/v1/staff/handoffs/")
      ? actionIdentity(state.detail?.handoff ?? null)
      : actionIdentity(state.detail?.appointment ?? null);
    if (
      authoritative?.id !== resource.id ||
      authoritative.version !== resource.version ||
      (path.startsWith("/v1/staff/handoffs/") &&
        body["conversation_version"] !== item.conversationVersion)
    ) {
      update({
        versionsCurrent: false,
        notice: "The work changed. Refresh before taking another action.",
      });
      return;
    }
    let csrf: string | null;
    try {
      csrf = options.csrf();
    } catch {
      csrf = null;
    }
    if (csrf === null) {
      update({ notice: "Your session needs to be refreshed before this action." });
      return;
    }
    const epoch = ++mutationEpoch;
    update({ working: true, versionsCurrent: false, notice: null });
    let notice: string;
    try {
      const response = await options.request(path, {
        body: JSON.stringify(body),
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": makeIdempotencyKey("work", options.randomId()),
          "if-match": `"${resource.id}:${resource.version}"`,
          "x-csrf-token": csrf,
        },
      });
      if (!response.ok) {
        const problem: unknown = await response.json().catch(() => null);
        notice = staffActionMessage(
          response.status,
          isRecord(problem) ? (stringValue(problem["code"]) ?? undefined) : undefined,
        );
      } else
        notice = path.endsWith("/claim")
          ? "Handoff claimed. You can now continue handling the conversation."
          : path.endsWith("/resolve")
            ? "Handoff resolved. Messages remain available in History when no staff work is pending."
            : "Action saved. The current appointment state is shown below.";
    } catch {
      notice = "We could not confirm that action. Review the refreshed state before trying again.";
    }
    if (epoch !== mutationEpoch) return;
    update({ notice });
    await refresh();
    if (epoch === mutationEpoch) update({ working: false });
  };
  return Object.freeze({
    getSnapshot: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    loadList,
    refresh,
    mutate,
    open: async (item: WorkItem) => {
      if (state.working) return;
      update({
        selected: item,
        detail: state.selected?.id === item.id ? state.detail : null,
        notice: null,
      });
      await refreshDetail(item);
    },
    changeView: async (view: StaffWorkView) => {
      if (state.working || state.view === view) return;
      update({ view, items: [], summaries: {}, nextCursor: null });
      await loadList();
    },
    invalidatePending: () => {
      listEpoch++;
      detailEpoch++;
      mutationEpoch++;
    },
  });
};
