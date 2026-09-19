"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import {
  formatStaffDateTime,
  formatStaffLocalDateTime,
  humanizeStaffStatus,
  makeIdempotencyKey,
  readCsrfCookie,
  readOrganizationContext,
  staffActionMessage,
} from "../../lib/staff-ui";

type RecordValue = Readonly<Record<string, unknown>>;
type AppointmentPreference = Readonly<{
  localStart: string | null;
  precision: string;
  startAt: string | null;
  timeZone: string;
}>;
type WorkItem = Readonly<{
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

type DetailState = Readonly<{
  appointment: RecordValue | null;
  contact: RecordValue | null;
  conversation: RecordValue | null;
  handoff: RecordValue | null;
  lead: RecordValue | null;
  messages: readonly RecordValue[];
}>;
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

const parseWorkItem = (value: unknown): WorkItem | null => {
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

const actionIdentity = (
  resource: RecordValue | null,
): Readonly<{ id: string; version: number }> | null => {
  const id = stringValue(resource?.["id"]);
  const version = numberValue(resource?.["version"]);
  return id === null || version === null ? null : { id, version };
};

export function StaffWorkspace({
  apiOrigin,
  initialOrganization,
}: Readonly<{ apiOrigin: string; initialOrganization: string | null }>) {
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
    "checking",
  );
  const [items, setItems] = useState<readonly WorkItem[]>([]);
  const [summaries, setSummaries] = useState<Readonly<Record<string, string>>>({});
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [selected, setSelected] = useState<WorkItem | null>(null);
  const [detail, setDetail] = useState<DetailState | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [analytics, setAnalytics] = useState<AnalyticsView | null>(null);
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

  const loadInbox = useCallback(
    async (cursor?: string, append = false) => {
      if (organizationId === null) {
        setAuthState("denied");
        setLoading(false);
        return;
      }
      setError(null);
      if (!append) setLoading(true);
      const query = new URLSearchParams({ limit: "25", view: "active" });
      if (cursor !== undefined) query.set("cursor", cursor);
      const me = await request("/v1/staff/me");
      if (me.status === 401) {
        setAuthState("signed-out");
        setLoading(false);
        return;
      }
      if (!me.ok) {
        setAuthState("denied");
        setLoading(false);
        return;
      }
      setAuthState("ready");
      void loadAnalytics().catch(() => setAnalytics(null));
      const response = await request(`/v1/staff/inbox?${query.toString()}`);
      if (!response.ok) throw new Error("inbox_unavailable");
      const body: unknown = await response.json();
      if (!isRecord(body) || !Array.isArray(body["data"]) || !isRecord(body["meta"])) {
        throw new Error("invalid_inbox_response");
      }
      const parsed = body["data"].map(parseWorkItem).filter((item) => item !== null);
      setItems((current) => (append ? [...current, ...parsed] : parsed));
      void Promise.all(
        parsed.map(async (item) => {
          if (item.conversationId === null) return null;
          const summary = await request(`/v2/staff/conversations/${item.conversationId}`);
          if (!summary.ok) return null;
          const value = recordValue(await responseData(summary));
          const participant = recordValue(value?.["participant"]);
          const label = stringValue(participant?.["display_redacted"]);
          return label === null ? null : ([item.id, label] as const);
        }),
      )
        .then((values) => {
          setSummaries((current) => {
            const next = { ...current };
            for (const value of values) if (value !== null) next[value[0]] = value[1];
            return next;
          });
        })
        .catch(() => undefined);
      setNextCursor(stringValue(body["meta"]["next_cursor"]));
      setLoading(false);
    },
    [loadAnalytics, organizationId, request],
  );

  useEffect(() => {
    const handle = globalThis.setTimeout(() => {
      void loadInbox().catch(() => {
        setError("We could not load active work. Please try again.");
        setLoading(false);
      });
    }, 0);
    return () => globalThis.clearTimeout(handle);
  }, [loadInbox]);

  const loadDetail = useCallback(
    async (item: WorkItem) => {
      setSelected(item);
      setDetail(null);
      setDetailLoading(true);
      setNotice(null);
      const fetchOptional = async (path: string | null): Promise<unknown> => {
        if (path === null) return null;
        const response = await request(path);
        if (response.status === 404) return null;
        if (!response.ok) throw new Error("detail_unavailable");
        return await responseData(response);
      };
      try {
        const [conversation, messages, contact, lead, handoff, appointment] = await Promise.all([
          fetchOptional(
            item.conversationId === null ? null : `/v2/staff/conversations/${item.conversationId}`,
          ),
          fetchOptional(
            item.conversationId === null
              ? null
              : `/v1/staff/conversations/${item.conversationId}/messages?limit=100`,
          ),
          fetchOptional(item.contactId === null ? null : `/v2/staff/contacts/${item.contactId}`),
          fetchOptional(item.leadId === null ? null : `/v1/staff/leads/${item.leadId}`),
          fetchOptional(item.handoffId === null ? null : `/v1/staff/handoffs/${item.handoffId}`),
          fetchOptional(
            item.appointmentRequestId === null
              ? null
              : `/v1/staff/appointment-requests/${item.appointmentRequestId}`,
          ),
        ]);
        setDetail({
          appointment: recordValue(appointment),
          contact: recordValue(contact),
          conversation: recordValue(conversation),
          handoff: recordValue(handoff),
          lead: recordValue(lead),
          messages: Array.isArray(messages) ? messages.filter(isRecord) : [],
        });
      } catch {
        setNotice("Some conversation details could not be loaded. Please retry.");
      } finally {
        setDetailLoading(false);
      }
    },
    [request],
  );

  const mutate = useCallback(
    async (
      path: string,
      resource: Readonly<{ id: string; version: number }>,
      body: RecordValue,
    ) => {
      const csrf = readCsrfCookie(document.cookie);
      if (csrf === null) {
        setNotice("Your session needs to be refreshed before this action.");
        return;
      }
      setWorking(true);
      setNotice(null);
      try {
        const response = await request(path, {
          body: JSON.stringify(body),
          headers: {
            "content-type": "application/json",
            "idempotency-key": makeIdempotencyKey("work", crypto.randomUUID()),
            "if-match": `"${resource.id}:${resource.version}"`,
            "x-csrf-token": csrf,
          },
          method: "POST",
        });
        if (!response.ok) {
          const problem: unknown = await response.json().catch(() => null);
          setNotice(
            staffActionMessage(
              response.status,
              isRecord(problem) ? (stringValue(problem["code"]) ?? undefined) : undefined,
            ),
          );
        } else {
          setNotice("Action saved.");
        }
        await loadInbox();
        setSelected(null);
        setDetail(null);
      } catch {
        setNotice("We could not complete that action. Please try again.");
      } finally {
        setWorking(false);
      }
    },
    [loadInbox, request],
  );

  if (authState === "signed-out") {
    const returnTo =
      organizationId === null
        ? "/staff"
        : `/staff?organization=${encodeURIComponent(organizationId)}`;
    return (
      <main className="staff-auth-shell">
        <section className="staff-auth-card">
          <span className="brand-mark" aria-hidden="true">
            L
          </span>
          <p className="eyebrow">Lead Agent</p>
          <h1>Your customer work, in one place.</h1>
          <p>Sign in to manage conversations, handoffs, and appointment requests.</p>
          <a
            className="primary-button"
            href={`${apiOrigin}/v1/staff/auth/login?return_to=${encodeURIComponent(returnTo)}`}
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
          <a className="staff-nav-link staff-nav-link--active" href="#work">
            Inbox <span>{items.filter((item) => item.actionable).length}</span>
          </a>
          <a className="staff-nav-link" href="#conversation">
            Conversations
          </a>
          <a className="staff-nav-link" href="#context">
            Customer context
          </a>
          <a className="staff-nav-link" href="#analytics">
            Analytics
          </a>
        </nav>
        <section className="staff-list" id="work" aria-busy={loading}>
          <div className="section-heading">
            <div>
              <p className="eyebrow">Active work</p>
              <h1>Inbox</h1>
            </div>
            <button
              className="ghost-button"
              type="button"
              onClick={() => void loadInbox()}
              disabled={loading}
            >
              Refresh
            </button>
          </div>
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
          {error !== null && (
            <div className="notice notice--error" role="alert">
              {error}{" "}
              <button type="button" onClick={() => void loadInbox()}>
                Retry
              </button>
            </div>
          )}
          {loading ? (
            <div className="loading-card" role="status">
              Loading customer work…
            </div>
          ) : items.length === 0 ? (
            <div className="empty-card">
              <h2>No active customer requests right now.</h2>
              <p>New conversations and booking requests will appear here.</p>
            </div>
          ) : (
            <div className="work-list">
              {items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`work-card${selected?.id === item.id ? " work-card--selected" : ""}`}
                  onClick={() => void loadDetail(item)}
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
              onClick={() => void loadInbox(nextCursor, true)}
            >
              Load more
            </button>
          )}
        </section>
        <section className="staff-detail" id="conversation" aria-live="polite">
          {selected === null ? (
            <div className="detail-placeholder">
              <div className="detail-placeholder-icon" aria-hidden="true">
                ↗
              </div>
              <h2>Choose an item to open it.</h2>
              <p>Customer messages and the authorized business context will appear here.</p>
            </div>
          ) : detailLoading ? (
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
              {notice !== null && (
                <div className="notice" role="status">
                  {notice}
                </div>
              )}
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
                  {selected.handoffId !== null && selected.actionable && handoffAction !== null && (
                    <div className="action-box">
                      <h4>Human attention requested</h4>
                      <div className="action-row">
                        <button
                          className="secondary-button"
                          type="button"
                          disabled={working || selected.conversationVersion === null}
                          onClick={() =>
                            void mutate(
                              `/v1/staff/handoffs/${selected.handoffId}/claim`,
                              handoffAction,
                              { conversation_version: selected.conversationVersion },
                            )
                          }
                        >
                          Claim
                        </button>
                        <button
                          className="ghost-button"
                          type="button"
                          disabled={working || selected.conversationVersion === null}
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
                            disabled={working || startAt === "" || endAt === ""}
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
                            disabled={working}
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
    </main>
  );
}
