"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import {
  buildStaffSignInPath,
  formatStaffDateTime,
  formatStaffLocalDateTime,
  humanizeStaffStatus,
  buildWidgetInstallSnippet,
  canManageIntegrations,
  initiateIntegrationConnection,
  readCsrfCookie,
  readInstagramIntegrationStatus,
  readOrganizationContext,
  type StaffAuthRecovery,
  readStaffMembershipRole,
  readTelegramIntegrationStatus,
  readWidgetManagementConfiguration,
  staffActionMessage,
  TELEGRAM_BUSINESS_SETTINGS_URL,
  type IntegrationConnectionStatus,
  type InstagramCallbackResult,
  type StaffMembershipRole,
  type TelegramIntegrationStatus,
  type WidgetManagementConfiguration,
} from "../../lib/staff-ui";
import {
  actionIdentity,
  createStaffWorkflow,
  focusStaffConversation,
  type DetailState,
  type RecordValue,
  type WorkItem,
} from "../../lib/staff-workflow";

type AnalyticsView = Readonly<{
  appointmentRequests: number;
  confirmed: number;
  leadToConfirmedBasisPoints: number | null;
  leads: number;
  p50Ms: number | null;
  p95Ms: number | null;
  p99Ms: number | null;
  within60: number;
  samples: number;
}>;

const isRecord = (value: unknown): value is RecordValue =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const stringValue = (value: unknown): string | null => (typeof value === "string" ? value : null);
const numberValue = (value: unknown): number | null =>
  typeof value === "number" && Number.isSafeInteger(value) ? value : null;
const recordValue = (value: unknown): RecordValue | null => (isRecord(value) ? value : null);
const parseAnalytics = (value: unknown): AnalyticsView | null => {
  if (!isRecord(value)) return null;
  const funnel = recordValue(value["funnel"]),
    conversion = recordValue(value["conversion_basis_points"]),
    latency = recordValue(value["latency"]),
    platform = recordValue(latency?.["platform_meaningful_raw"]);
  const leads = numberValue(funnel?.["leads"]),
    requests = numberValue(funnel?.["appointment_requests"]),
    confirmed = numberValue(funnel?.["confirmed_appointments"]),
    samples = numberValue(platform?.["count"]),
    within60 = numberValue(platform?.["within_60_seconds"]);
  if (
    leads === null ||
    requests === null ||
    confirmed === null ||
    samples === null ||
    within60 === null
  )
    return null;
  return {
    appointmentRequests: requests,
    confirmed,
    leadToConfirmedBasisPoints: numberValue(conversion?.["lead_to_confirmed"]),
    leads,
    p50Ms: numberValue(platform?.["p50_ms"]),
    p95Ms: numberValue(platform?.["p95_ms"]),
    p99Ms: numberValue(platform?.["p99_ms"]),
    samples,
    within60,
  };
};
const durationLabel = (value: number | null): string =>
  value === null ? "Unavailable" : `${(value / 1_000).toFixed(1)}s`;

const responseData = async (response: Response): Promise<unknown> => {
  const body: unknown = await response.json();
  return isRecord(body) ? body["data"] : null;
};

const customerLabel = (detail: DetailState | null): string => {
  const contact = detail?.contact;
  if (contact !== null && contact !== undefined) {
    const displayName = stringValue(contact["display_name"]);
    if (displayName !== null) return displayName;
    const identities = contact["identities"];
    if (Array.isArray(identities)) {
      const first = identities.find(isRecord);
      const display = first === undefined ? null : stringValue(first["display_value"]);
      if (display !== null) return display;
    }
  }
  const participant = recordValue(detail?.conversation?.["participant"]);
  return stringValue(participant?.["display_redacted"]) ?? "Customer";
};

const messageClass = (message: RecordValue): string => {
  const direction = stringValue(message["direction"]);
  return direction === "inbound"
    ? "staff-message staff-message--customer"
    : direction === "staff_internal"
      ? "staff-message staff-message--private"
      : "staff-message staff-message--business";
};

export function StaffWorkspace({
  apiOrigin,
  initialAuthRecovery,
  initialInstagramResult,
  initialOrganization,
}: Readonly<{
  apiOrigin: string;
  initialAuthRecovery: StaffAuthRecovery | null;
  initialInstagramResult: InstagramCallbackResult | null;
  initialOrganization: string | null;
}>) {
  const [organizationId] = useState(() => {
    const fromUrl = readOrganizationContext(initialOrganization);
    if (fromUrl !== null) {
      globalThis.sessionStorage?.setItem("lead-agent.organization", fromUrl);
      return fromUrl;
    }
    return readOrganizationContext(
      globalThis.sessionStorage?.getItem("lead-agent.organization") ?? null,
    );
  });
  const [authState, setAuthState] = useState<"checking" | "ready" | "signed-out" | "denied">(
    initialAuthRecovery === "reauthenticate"
      ? "signed-out"
      : initialAuthRecovery === "denied"
        ? "denied"
        : "checking",
  );
  const [workspaceError, setError] = useState<string | null>(null);
  const conversationRegion = useRef<HTMLElement>(null);
  const [analytics, setAnalytics] = useState<AnalyticsView | null>(null);
  const [membershipRole, setMembershipRole] = useState<StaffMembershipRole | null>(null);
  const [integrationNotice, setIntegrationNotice] = useState<string | null>(() =>
    initialInstagramResult === "connected"
      ? "Instagram Professional connected successfully."
      : initialInstagramResult === "failed"
        ? "Instagram authorization did not complete. Please reconnect securely."
        : null,
  );
  const [integrationWorking, setIntegrationWorking] = useState<
    "instagram" | "telegram" | "widget" | null
  >(null);
  const [telegramStatus, setTelegramStatus] = useState<TelegramIntegrationStatus | null>(null);
  const [instagramStatus, setInstagramStatus] = useState<IntegrationConnectionStatus | null>(null);
  const [telegramStatusState, setTelegramStatusState] = useState<
    "loading" | "ready" | "unavailable"
  >("loading");
  const [instagramStatusState, setInstagramStatusState] = useState<
    "loading" | "ready" | "unavailable"
  >("loading");
  const [websiteOrigin, setWebsiteOrigin] = useState("");
  const [widgetConfiguration, setWidgetConfiguration] =
    useState<WidgetManagementConfiguration | null>(null);
  const [widgetStatus, setWidgetStatus] = useState<
    "active" | "loading" | "not_configured" | "unavailable"
  >("loading");
  const [startAt, setStartAt] = useState("");
  const [endAt, setEndAt] = useState("");

  const headers = useMemo(
    () =>
      organizationId === null
        ? Object.freeze({})
        : Object.freeze({ "x-organization-context": organizationId }),
    [organizationId],
  );

  const request = useCallback(
    async (path: string, init: RequestInit = {}): Promise<Response> =>
      await fetch(apiOrigin + path, {
        ...init,
        credentials: "include",
        headers: { ...headers, ...init.headers },
      }),
    [apiOrigin, headers],
  );

  const workflow = useMemo(
    () =>
      createStaffWorkflow({
        request,
        csrf: () => readCsrfCookie(document.cookie),
        randomId: () => crypto.randomUUID(),
      }),
    [request],
  );
  const work = useSyncExternalStore(workflow.subscribe, workflow.getSnapshot, workflow.getSnapshot);
  const {
    items,
    summaries,
    nextCursor,
    selected,
    detail,
    detailLoading,
    notice,
    working,
    view,
    versionsCurrent,
    detailError,
  } = work;
  const loading = authState === "checking" || work.loading;
  const error = workspaceError ?? work.listError;
  const loadInbox = useCallback(
    async (cursor?: string, append = false) => {
      setError(null);
      await workflow.loadList(cursor, append);
    },
    [workflow],
  );
  const loadDetail = (item: WorkItem) => {
    if (working) return;
    setStartAt("");
    setEndAt("");
    focusStaffConversation(conversationRegion.current);
    void workflow.open(item);
  };
  const mutate = workflow.mutate;
  const refreshWork = async () => {
    setError(null);
    await workflow.refresh();
  };

  const loadAnalytics = useCallback(async () => {
    const to = new Date(),
      from = new Date(to.getTime() - 7 * 24 * 60 * 60 * 1_000),
      query = new URLSearchParams({
        from: from.toISOString(),
        to: to.toISOString(),
        group_by: "day",
      });
    const response = await request(`/v1/staff/analytics?${query.toString()}`);
    if (response.status === 403) return;
    if (!response.ok) throw new Error("analytics_unavailable");
    setAnalytics(parseAnalytics(await responseData(response)));
  }, [request]);

  const loadTelegramStatus = useCallback(async () => {
    setTelegramStatusState("loading");
    try {
      const response = await request("/v1/staff/integrations/telegram/status");
      const value = response.ok ? readTelegramIntegrationStatus(await response.json()) : null;
      setTelegramStatus(value);
      setTelegramStatusState(value === null ? "unavailable" : "ready");
    } catch {
      setTelegramStatus(null);
      setTelegramStatusState("unavailable");
    }
  }, [request]);

  const loadInstagramStatus = useCallback(async () => {
    setInstagramStatusState("loading");
    try {
      const response = await request("/v1/staff/integrations/instagram/status");
      const value = response.ok ? readInstagramIntegrationStatus(await response.json()) : null;
      setInstagramStatus(value);
      setInstagramStatusState(value === null ? "unavailable" : "ready");
    } catch {
      setInstagramStatus(null);
      setInstagramStatusState("unavailable");
    }
  }, [request]);

  const loadWidgetStatus = useCallback(async () => {
    setWidgetStatus("loading");
    try {
      const response = await request("/v1/staff/integrations/widget");
      if (!response.ok) {
        setWidgetStatus("unavailable");
        return;
      }
      const configuration = readWidgetManagementConfiguration(await response.json());
      setWidgetConfiguration(configuration);
      setWidgetStatus(configuration === null ? "not_configured" : "active");
      if (configuration !== null) setWebsiteOrigin(configuration.websiteOrigin);
    } catch {
      setWidgetStatus("unavailable");
    }
  }, [request]);

  const loadIntegrationStatuses = useCallback(async () => {
    await Promise.all([loadTelegramStatus(), loadInstagramStatus(), loadWidgetStatus()]);
  }, [loadInstagramStatus, loadTelegramStatus, loadWidgetStatus]);

  useEffect(() => {
    if (initialAuthRecovery !== null) return;
    let cancelled = false;
    const handle = globalThis.setTimeout(() => {
      void (async () => {
        if (organizationId === null) {
          setAuthState("denied");
          return;
        }
        try {
          const me = await request("/v1/staff/me");
          if (cancelled) return;
          if (me.status === 401) {
            setAuthState("signed-out");
            return;
          }
          const role = me.ok ? readStaffMembershipRole(await responseData(me)) : null;
          if (cancelled) return;
          if (role === null) {
            setAuthState("denied");
            return;
          }
          setMembershipRole(role);
          setAuthState("ready");
          if (canManageIntegrations(role)) void loadIntegrationStatuses();
          void loadAnalytics().catch(() => {
            if (!cancelled) setAnalytics(null);
          });
          await workflow.loadList();
        } catch {
          if (!cancelled) {
            setAuthState("ready");
            setError("Workspace could not be loaded. Please refresh this page.");
          }
        }
      })();
    }, 0);
    return () => {
      cancelled = true;
      globalThis.clearTimeout(handle);
      workflow.invalidatePending();
    };
  }, [
    initialAuthRecovery,
    loadAnalytics,
    loadIntegrationStatuses,
    organizationId,
    request,
    workflow,
  ]);

  useEffect(() => {
    if (authState !== "ready" || !canManageIntegrations(membershipRole)) return;
    const refresh = () => void loadIntegrationStatuses();
    globalThis.addEventListener("focus", refresh);
    return () => globalThis.removeEventListener("focus", refresh);
  }, [authState, loadIntegrationStatuses, membershipRole]);

  const startIntegration = useCallback(
    async (provider: "instagram" | "telegram") => {
      const csrf = readCsrfCookie(document.cookie);
      if (csrf === null) {
        setIntegrationNotice("Refresh your secure session before connecting an integration.");
        return;
      }
      setIntegrationWorking(provider);
      setIntegrationNotice(null);
      try {
        const result = await initiateIntegrationConnection({
          csrfToken: csrf,
          navigation: {
            assign: (url) => globalThis.location.assign(url),
            open: () => globalThis.open("about:blank", "_blank"),
          },
          provider,
          request,
        });
        if (!result.ok) {
          setIntegrationNotice(
            result.code === "invalid_provider_response"
              ? "The provider returned an invalid connection link. Please try again later."
              : staffActionMessage(result.status, result.code),
          );
          return;
        }
        if (provider === "telegram") {
          setTelegramStatus({ nextStep: "open_bot", status: "connection_pending" });
          setIntegrationNotice("Telegram opened securely. Press Start to bind this workspace.");
          return;
        }
        setIntegrationNotice("Instagram authorization opened securely.");
      } catch {
        setIntegrationNotice("We could not start the secure connection. Please try again.");
      } finally {
        setIntegrationWorking(null);
      }
    },
    [request],
  );

  const configureWidget = useCallback(async () => {
    const csrf = readCsrfCookie(document.cookie);
    if (csrf === null) {
      setIntegrationNotice("Refresh your secure session before setting up Website Chat.");
      return;
    }
    setIntegrationWorking("widget");
    setIntegrationNotice(null);
    try {
      const response = await request("/v1/staff/integrations/widget/setup", {
        body: JSON.stringify({ website_origin: websiteOrigin }),
        headers: { "content-type": "application/json", "x-csrf-token": csrf },
        method: "POST",
      });
      if (!response.ok) {
        const failed: unknown = await response.json().catch(() => null);
        setIntegrationNotice(
          staffActionMessage(
            response.status,
            isRecord(failed) ? (stringValue(failed["code"]) ?? undefined) : undefined,
          ),
        );
        return;
      }
      const body: unknown = await response.json();
      const configured = readWidgetManagementConfiguration(body);
      if (configured === null) throw new Error("invalid_widget_configuration");
      setWidgetConfiguration(configured);
      setWidgetStatus("active");
      setWebsiteOrigin(configured.websiteOrigin);
      setIntegrationNotice("Website Chat is configured. Copy the new installation code.");
    } catch {
      setIntegrationNotice("We could not configure Website Chat. Check the HTTPS website origin.");
    } finally {
      setIntegrationWorking(null);
    }
  }, [request, websiteOrigin]);

  const copyWidgetSnippet = useCallback(async () => {
    if (widgetConfiguration === null) return;
    try {
      const platformOrigin = apiOrigin.length > 0 ? apiOrigin : globalThis.location.origin;
      await globalThis.navigator.clipboard.writeText(
        buildWidgetInstallSnippet(platformOrigin, widgetConfiguration),
      );
      setIntegrationNotice("Installation code copied.");
    } catch {
      setIntegrationNotice("Copy is unavailable in this browser. Please try again.");
    }
  }, [apiOrigin, widgetConfiguration]);

  if (authState === "signed-out") {
    return (
      <main className="staff-auth-shell">
        <section className="staff-auth-card">
          <span className="brand-mark" aria-hidden="true">
            L
          </span>
          <p className="eyebrow">Lead Agent</p>
          <h1>Your customer work, in one place.</h1>
          <p>
            {initialAuthRecovery === "reauthenticate"
              ? "Your previous session ended. Sign in again to continue."
              : "Sign in to manage conversations, handoffs, and appointment requests."}
          </p>
          <a
            className="primary-button"
            href={`${apiOrigin}${buildStaffSignInPath(organizationId, initialAuthRecovery)}`}
          >
            Sign in securely
          </a>
        </section>
      </main>
    );
  }
  if (authState === "denied") {
    return (
      <main className="staff-auth-shell">
        <section className="staff-auth-card">
          <p className="eyebrow">Workspace access</p>
          <h1>Open your organization’s staff link.</h1>
          <p>Your current membership must be active. A workspace selector never grants access.</p>
        </section>
      </main>
    );
  }

  const handoffAction = actionIdentity(detail?.handoff ?? null);
  const appointmentAction = actionIdentity(detail?.appointment ?? null);
  const appointmentPreference = selected?.preferences[0] ?? null;
  return (
    <main className="staff-shell">
      <header className="staff-topbar">
        <div>
          <span className="brand-mark" aria-hidden="true">
            L
          </span>
          <strong>Lead Agent</strong>
        </div>
        <span className="workspace-pill">Secure workspace</span>
      </header>
      <div className="staff-layout">
        <nav className="staff-nav" aria-label="Staff navigation">
          <p className="staff-nav-label">Workspace</p>
          <button
            className={`staff-nav-link${view === "active" ? " staff-nav-link--active" : ""}`}
            type="button"
            aria-current={view === "active" ? "page" : undefined}
            disabled={working}
            onClick={() => void workflow.changeView("active")}
          >
            Inbox{" "}
            {view === "active" && <span>{items.filter((item) => item.actionable).length}</span>}
          </button>
          <button
            className={`staff-nav-link${view === "history" ? " staff-nav-link--active" : ""}`}
            type="button"
            aria-current={view === "history" ? "page" : undefined}
            disabled={working}
            onClick={() => void workflow.changeView("history")}
          >
            History
          </button>
          <a className="staff-nav-link" href="#conversation">
            Conversations
          </a>
          <a className="staff-nav-link" href="#context">
            Customer context
          </a>
          <a className="staff-nav-link" href="#analytics">
            Analytics
          </a>
          <a className="staff-nav-link" href="#integrations">
            Integrations
          </a>
        </nav>
        <section className="staff-list" id="work" aria-busy={loading}>
          <div className="section-heading">
            <div>
              <p className="eyebrow">
                {view === "active" ? "Pending staff work" : "No pending staff work"}
              </p>
              <h1>{view === "active" ? "Inbox" : "History"}</h1>
            </div>
            <button
              className="ghost-button"
              type="button"
              onClick={() => void refreshWork()}
              disabled={loading || working}
            >
              Refresh
            </button>
          </div>
          {error !== null && (
            <div className="notice notice--error" role="alert">
              {error}{" "}
              <button
                type="button"
                disabled={working || loading}
                onClick={() => void refreshWork()}
              >
                Retry
              </button>
            </div>
          )}
          {loading ? (
            <div className="loading-card" role="status">
              Loading customer work…
            </div>
          ) : error !== null && items.length === 0 ? null : items.length === 0 ? (
            <div className="empty-card">
              <h2>
                {view === "active" ? "No pending staff work." : "No conversation history yet."}
              </h2>
              <p>
                {view === "active"
                  ? "Inbox 0 means no pending staff work. Conversations and messages remain available in History."
                  : "Conversations with no pending staff work will appear here."}
              </p>
              {view === "active" && (
                <button
                  className="ghost-button"
                  type="button"
                  disabled={working}
                  onClick={() => void workflow.changeView("history")}
                >
                  Open History
                </button>
              )}
            </div>
          ) : (
            <div className="work-list">
              {items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`work-card${selected?.id === item.id ? " work-card--selected" : ""}`}
                  disabled={working}
                  onClick={() => loadDetail(item)}
                >
                  <span
                    className={`priority-dot${item.actionable ? " priority-dot--active" : ""}`}
                    aria-hidden="true"
                  />
                  <span className="work-card-copy">
                    <strong>{summaries[item.id] ?? humanizeStaffStatus(item.kind)}</strong>
                    <small>
                      {humanizeStaffStatus(
                        item.appointmentStatus ?? item.handoffStatus ?? item.status,
                      )}
                    </small>
                  </span>
                  <time dateTime={item.activityAt}>{formatStaffDateTime(item.activityAt)}</time>
                </button>
              ))}
            </div>
          )}
          {nextCursor !== null && (
            <button
              type="button"
              className="load-more"
              disabled={loading || working}
              onClick={() => void loadInbox(nextCursor, true)}
            >
              Load more
            </button>
          )}
        </section>
        <section
          className="staff-detail"
          id="conversation"
          aria-label="Conversation details"
          ref={conversationRegion}
          tabIndex={-1}
          aria-busy={detailLoading}
          aria-live="polite"
        >
          {selected !== null && notice !== null && (
            <div className="notice" role="status">
              {notice}
            </div>
          )}
          {selected !== null && detailError !== null && (
            <div className="notice notice--error" role="alert">
              {detailError}{" "}
              <button
                type="button"
                disabled={working || detailLoading}
                onClick={() => void refreshWork()}
              >
                Refresh conversation
              </button>
            </div>
          )}
          {detailLoading && detail !== null && (
            <p role="status">Refreshing current conversation state…</p>
          )}
          {selected === null ? (
            <div className="detail-placeholder">
              <div className="detail-placeholder-icon" aria-hidden="true">
                ↗
              </div>
              <h2>Choose an item to open it.</h2>
              <p>Customer messages and the authorized business context will appear here.</p>
            </div>
          ) : detailLoading && detail === null ? (
            <div className="loading-card" role="status">
              Opening conversation…
            </div>
          ) : (
            <>
              <div className="detail-header">
                <div>
                  <p className="eyebrow">Customer conversation</p>
                  <h2>{customerLabel(detail)}</h2>
                </div>
                <span className="status-chip">
                  {humanizeStaffStatus(
                    selected.appointmentStatus ?? selected.handoffStatus ?? selected.status,
                  )}
                </span>
              </div>
              <div className="detail-grid">
                <div className="message-panel">
                  <h3>Messages</h3>
                  <div className="message-list">
                    {detail?.messages.length === 0 ? (
                      <p className="muted">No messages are available.</p>
                    ) : (
                      detail?.messages.map((message) => {
                        const id =
                          stringValue(message["id"]) ??
                          String(numberValue(message["sequence_no"]) ?? 0);
                        const text = stringValue(message["body_text"]) ?? "Message removed";
                        const created = stringValue(message["created_at"]);
                        return (
                          <article className={messageClass(message)} key={id}>
                            <p>{text}</p>
                            {created !== null && (
                              <time dateTime={created}>{formatStaffDateTime(created)}</time>
                            )}
                          </article>
                        );
                      })
                    )}
                  </div>
                </div>
                <aside className="context-panel" id="context">
                  <h3>Customer context</h3>
                  <dl>
                    <div>
                      <dt>Lead</dt>
                      <dd>
                        {humanizeStaffStatus(
                          stringValue(detail?.lead?.["status"]) ?? "Not yet qualified",
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt>Conversation</dt>
                      <dd>
                        {humanizeStaffStatus(
                          stringValue(detail?.conversation?.["status"]) ?? selected.status,
                        )}
                      </dd>
                    </div>
                    {selected.handoffStatus !== null && (
                      <div>
                        <dt>Handoff</dt>
                        <dd>{humanizeStaffStatus(selected.handoffStatus)}</dd>
                      </div>
                    )}
                    {selected.appointmentStatus !== null && (
                      <div>
                        <dt>Appointment</dt>
                        <dd>{humanizeStaffStatus(selected.appointmentStatus)}</dd>
                      </div>
                    )}
                    {appointmentPreference !== null && (
                      <div>
                        <dt>Requested time</dt>
                        <dd>
                          {appointmentPreference.startAt === null
                            ? appointmentPreference.localStart === null
                              ? "Flexible"
                              : formatStaffLocalDateTime(appointmentPreference.localStart)
                            : formatStaffDateTime(appointmentPreference.startAt)}
                          {` · ${appointmentPreference.timeZone}`}
                        </dd>
                      </div>
                    )}
                  </dl>
                  {selected.handoffId !== null &&
                    ["requested", "assigned", "in_progress"].includes(
                      selected.handoffStatus ?? "",
                    ) &&
                    handoffAction !== null && (
                      <div className="action-box">
                        <h4>{humanizeStaffStatus(selected.handoffStatus ?? "requested")}</h4>
                        <div className="action-row">
                          <button
                            className="secondary-button"
                            type="button"
                            disabled={
                              working ||
                              !versionsCurrent ||
                              selected.conversationVersion === null ||
                              selected.handoffStatus === "in_progress"
                            }
                            onClick={() =>
                              void mutate(
                                `/v1/staff/handoffs/${selected.handoffId}/claim`,
                                handoffAction,
                                { conversation_version: selected.conversationVersion },
                              )
                            }
                          >
                            {selected.handoffStatus === "in_progress"
                              ? "Being handled"
                              : selected.handoffStatus === "assigned"
                                ? "Start handling"
                                : "Claim"}
                          </button>
                          <button
                            className="ghost-button"
                            type="button"
                            disabled={
                              working || !versionsCurrent || selected.conversationVersion === null
                            }
                            onClick={() =>
                              void mutate(
                                `/v1/staff/handoffs/${selected.handoffId}/resolve`,
                                handoffAction,
                                {
                                  conversation_version: selected.conversationVersion,
                                  disposition: "resume_ai",
                                  resolution_code: "staff_resolved",
                                },
                              )
                            }
                          >
                            Resolve
                          </button>
                        </div>
                      </div>
                    )}
                  {selected.appointmentRequestId !== null &&
                    selected.appointmentStatus === "requested" &&
                    appointmentAction !== null && (
                      <div className="action-box">
                        <h4>Review appointment request</h4>
                        <label>
                          Start
                          <input
                            type="datetime-local"
                            value={startAt}
                            onChange={(event) => setStartAt(event.target.value)}
                          />
                        </label>
                        <label>
                          End
                          <input
                            type="datetime-local"
                            value={endAt}
                            onChange={(event) => setEndAt(event.target.value)}
                          />
                        </label>
                        <div className="action-row">
                          <button
                            className="primary-button"
                            type="button"
                            disabled={working || !versionsCurrent || startAt === "" || endAt === ""}
                            onClick={() =>
                              void mutate(
                                `/v1/staff/appointment-requests/${selected.appointmentRequestId}/accept`,
                                appointmentAction,
                                {
                                  start_at: new Date(startAt).toISOString(),
                                  end_at: new Date(endAt).toISOString(),
                                },
                              )
                            }
                          >
                            Accept request
                          </button>
                          <button
                            className="danger-button"
                            type="button"
                            disabled={working || !versionsCurrent}
                            onClick={() =>
                              void mutate(
                                `/v1/staff/appointment-requests/${selected.appointmentRequestId}/reject`,
                                appointmentAction,
                                { reason_code: "time_unavailable" },
                              )
                            }
                          >
                            Reject
                          </button>
                        </div>
                        <p className="help-text">
                          Accepting waits for customer confirmation. It does not confirm the
                          booking.
                        </p>
                      </div>
                    )}
                </aside>
              </div>
            </>
          )}
        </section>
      </div>
      <div className="staff-settings" aria-label="Workspace settings and analytics">
        <section className="integrations-overview" id="integrations" aria-label="Integrations">
          <div className="integrations-overview__heading">
            <div>
              <p className="eyebrow">Settings</p>
              <h2>Integrations</h2>
            </div>
            <span>Owner-managed</span>
          </div>
          <p className="integrations-intro">
            Connect the channels your customers already use. Credentials and tenant identifiers stay
            private.
          </p>
          {integrationNotice !== null && (
            <div className="notice" role="status">
              {integrationNotice}
            </div>
          )}
          <div className="integration-cards">
            <article className="integration-card">
              <div>
                <span className="integration-icon" aria-hidden="true">
                  W
                </span>
                <div>
                  <h3>Website Chat</h3>
                  <p>Secure chat for an approved business website.</p>
                </div>
              </div>
              {canManageIntegrations(membershipRole) ? (
                <>
                  <label className="integration-origin">
                    Business website
                    <input
                      type="url"
                      inputMode="url"
                      placeholder="https://clinic.example"
                      value={websiteOrigin}
                      onChange={(event) => setWebsiteOrigin(event.target.value)}
                    />
                  </label>
                  <div className="action-row">
                    <button
                      className="secondary-button"
                      type="button"
                      disabled={integrationWorking !== null || websiteOrigin.length === 0}
                      onClick={() => void configureWidget()}
                    >
                      {integrationWorking === "widget"
                        ? "Configuring…"
                        : widgetStatus === "active"
                          ? "Replace setup"
                          : "Set up"}
                    </button>
                    {widgetConfiguration !== null && (
                      <button
                        className="ghost-button"
                        type="button"
                        onClick={() => void copyWidgetSnippet()}
                      >
                        Copy installation code
                      </button>
                    )}
                  </div>
                  <p className="integration-detail">
                    {widgetStatus === "active"
                      ? `Active for ${widgetConfiguration?.websiteOrigin ?? websiteOrigin}. Replacing setup invalidates the prior installation key.`
                      : widgetStatus === "not_configured"
                        ? "Not connected. Enter the exact HTTPS origin of the business website."
                        : widgetStatus === "loading"
                          ? "Checking the current setup…"
                          : "Current setup could not be loaded."}
                  </p>
                </>
              ) : (
                <p className="integration-permission">Owner or admin access is required.</p>
              )}
            </article>
            <article className="integration-card">
              <div>
                <span className="integration-icon" aria-hidden="true">
                  T
                </span>
                <div>
                  <h3>Telegram Business</h3>
                  <p>Reply from the same business DM with staff-safe escalation.</p>
                </div>
              </div>
              {canManageIntegrations(membershipRole) ? (
                telegramStatusState !== "ready" ? (
                  <button className="primary-button" type="button" disabled>
                    {telegramStatusState === "loading" ? "Checking…" : "Status unavailable"}
                  </button>
                ) : telegramStatus?.status === "connected" ? (
                  <p className="integration-detail">
                    <strong>Connected.</strong> Telegram Business can receive and reply in the same
                    customer DM.
                  </p>
                ) : telegramStatus?.status === "connection_pending" &&
                  telegramStatus.nextStep === "connect_business" ? (
                  <div className="action-row">
                    <a className="primary-button" href={TELEGRAM_BUSINESS_SETTINGS_URL}>
                      Open Telegram Business settings
                    </a>
                    <button
                      className="ghost-button"
                      type="button"
                      disabled={integrationWorking !== null}
                      onClick={() => void loadTelegramStatus()}
                    >
                      Check connection
                    </button>
                  </div>
                ) : (
                  <button
                    className="primary-button"
                    type="button"
                    disabled={integrationWorking !== null}
                    onClick={() => void startIntegration("telegram")}
                  >
                    {integrationWorking === "telegram"
                      ? "Preparing…"
                      : telegramStatus?.status === "needs_attention"
                        ? "Reconnect Telegram"
                        : "Connect Telegram"}
                  </button>
                )
              ) : (
                <p className="integration-permission">Owner or admin access is required.</p>
              )}
              {telegramStatus?.status === "connection_pending" && (
                <p className="integration-detail">
                  {telegramStatus.nextStep === "connect_business"
                    ? "Bot linked. In Telegram Business → Chatbots, connect @lead_agent_staging_bot and enable reply access, then check the connection."
                    : "Press Start in the bot chat. Then connect @lead_agent_staging_bot under Telegram Business → Chatbots and allow it to reply."}
                </p>
              )}
              {telegramStatus?.status === "needs_attention" && (
                <p className="integration-detail">
                  The connection needs attention. Start a new secure connection.
                </p>
              )}
            </article>
            <article className="integration-card">
              <div>
                <span className="integration-icon" aria-hidden="true">
                  I
                </span>
                <div>
                  <h3>Instagram Professional</h3>
                  <p>Authorize the business account through Instagram.</p>
                </div>
              </div>
              {canManageIntegrations(membershipRole) ? (
                instagramStatusState !== "ready" ? (
                  <button className="primary-button" type="button" disabled>
                    {instagramStatusState === "loading" ? "Checking…" : "Status unavailable"}
                  </button>
                ) : instagramStatus === "connected" ? (
                  <p className="integration-detail">
                    <strong>Connected.</strong> Instagram Professional messaging is active.
                  </p>
                ) : (
                  <button
                    className="primary-button"
                    type="button"
                    disabled={integrationWorking !== null}
                    onClick={() => void startIntegration("instagram")}
                  >
                    {integrationWorking === "instagram"
                      ? "Redirecting…"
                      : instagramStatus === "needs_attention"
                        ? "Reconnect Instagram"
                        : instagramStatus === "connection_pending"
                          ? "Continue Instagram connection"
                          : "Connect Instagram"}
                  </button>
                )
              ) : (
                <p className="integration-permission">Owner or admin access is required.</p>
              )}
              {instagramStatus === "connection_pending" && (
                <p className="integration-detail">Instagram authorization is waiting to finish.</p>
              )}
              {instagramStatus === "needs_attention" && (
                <p className="integration-detail">
                  The connection needs attention. Reconnect securely.
                </p>
              )}
            </article>
          </div>
        </section>
        {analytics !== null && (
          <section
            className="analytics-overview"
            id="analytics"
            aria-label="Last seven days analytics"
          >
            <div className="analytics-overview__heading">
              <div>
                <p className="eyebrow">Last 7 days</p>
                <h2>Business pulse</h2>
              </div>
              <span>Recorded activity</span>
            </div>
            <div className="analytics-cards">
              <article>
                <small>Leads</small>
                <strong>{analytics.leads}</strong>
              </article>
              <article>
                <small>Appointment requests</small>
                <strong>{analytics.appointmentRequests}</strong>
              </article>
              <article>
                <small>Confirmed</small>
                <strong>{analytics.confirmed}</strong>
              </article>
              <article>
                <small>Lead to confirmed</small>
                <strong>
                  {analytics.leadToConfirmedBasisPoints === null
                    ? "N/A"
                    : `${(analytics.leadToConfirmedBasisPoints / 100).toFixed(1)}%`}
                </strong>
              </article>
            </div>
            <div className="analytics-latency">
              <span>Meaningful response</span>
              <b>p50 {durationLabel(analytics.p50Ms)}</b>
              <b>p95 {durationLabel(analytics.p95Ms)}</b>
              <b>p99 {durationLabel(analytics.p99Ms)}</b>
              <b>
                ≤60s{" "}
                {analytics.samples === 0
                  ? "N/A"
                  : `${((analytics.within60 / analytics.samples) * 100).toFixed(1)}%`}
              </b>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
