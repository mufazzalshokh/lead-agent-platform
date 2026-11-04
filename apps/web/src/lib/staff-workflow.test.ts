import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import { createStaffWorkflow, focusStaffConversation, parseWorkItem } from "./staff-workflow";

const item = (id = "conversation-a") => {
  const parsed = parseWorkItem({
    id,
    kind: "conversation",
    status: "awaiting_staff",
    activity_at: "2026-10-04T10:00:00Z",
    version: 7,
    actionable: true,
    conversation_id: id,
    conversation_version: 7,
    handoff_id: `handoff-${id}`,
    handoff_status: "requested",
  });
  if (parsed === null) throw new Error("invalid fixture");
  return parsed;
};
const deferred = () => {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
const data = (value: unknown) => Response.json({ data: value });
const page = (values: unknown[] = [], cursor: string | null = null) =>
  Response.json({ data: values, meta: { next_cursor: cursor } });
const listItem = (id: string) => ({
  id,
  kind: "conversation",
  status: "open",
  activity_at: "2026-10-04T10:00:00Z",
  version: 7,
  actionable: false,
  conversation_id: id,
});

const harness = () => {
  let conversationVersion = 7,
    handoffVersion = 1,
    handoffStatus = "requested";
  let failDetail = false,
    failList = false,
    conflict = false,
    networkFailure = false;
  const request = vi.fn(async (path: string, init?: RequestInit): Promise<Response> => {
    await Promise.resolve();
    if (init?.method === "POST") {
      if (networkFailure) throw new Error("private dependency details must not reach UI");
      if (conflict) return Response.json({ code: "version_conflict" }, { status: 412 });
      conversationVersion++;
      handoffVersion++;
      handoffStatus = path.endsWith("/claim") ? "in_progress" : "resolved";
      return data({});
    }
    if (path.startsWith("/v1/staff/inbox"))
      return failList ? new Response(null, { status: 503 }) : page();
    if (failDetail) return new Response(null, { status: 503 });
    if (path.startsWith("/v2/staff/conversations/")) {
      const id = path.split("/").at(-1);
      return data({
        id,
        version: conversationVersion,
        status: handoffStatus === "resolved" ? "open" : "awaiting_staff",
        active_handoff_id: handoffStatus === "resolved" ? null : `handoff-${id}`,
      });
    }
    if (path.includes("/messages?"))
      return data([{ id: "message-a", body_text: "Synthetic customer message" }]);
    if (path.startsWith("/v1/staff/handoffs/"))
      return data({
        id: path.split("/").at(-1),
        version: handoffVersion,
        conversation_version: conversationVersion,
        status: handoffStatus,
      });
    throw new Error(`unexpected fixture request: ${path}`);
  });
  const csrf = vi.fn((): string | null => "synthetic-csrf");
  const workflow = createStaffWorkflow({ request, csrf, randomId: () => "synthetic-request-id" });
  return {
    workflow,
    request,
    csrf,
    setDetailFailure: (value: boolean) => {
      failDetail = value;
    },
    setListFailure: (value: boolean) => {
      failList = value;
    },
    setConflict: () => {
      conflict = true;
    },
    setNetworkFailure: () => {
      networkFailure = true;
    },
  };
};
const claim = async (test: ReturnType<typeof harness>, version = 1, conversationVersion = 7) =>
  test.workflow.mutate(
    "/v1/staff/handoffs/handoff-conversation-a/claim",
    { id: "handoff-conversation-a", version },
    { conversation_version: conversationVersion },
  );

describe("S22 staff conversation workflow", () => {
  it("uses the real history contract, paginates, and does not close an open conversation", async () => {
    const test = harness();
    await test.workflow.open(item());
    await test.workflow.changeView("history");
    expect(test.request).toHaveBeenCalledWith("/v1/staff/inbox?limit=25&view=history");
    await test.workflow.loadList("opaque-cursor", true);
    expect(test.request).toHaveBeenCalledWith(
      "/v1/staff/inbox?limit=25&view=history&cursor=opaque-cursor",
    );
    expect(test.workflow.getSnapshot().selected?.id).toBe("conversation-a");
    expect(test.workflow.getSnapshot().detail?.messages).toHaveLength(1);
  });

  it("retains transcript and feedback through Claim then Resolve, using both fresh versions", async () => {
    const test = harness();
    await test.workflow.open(item());
    await claim(test);
    expect(test.workflow.getSnapshot()).toMatchObject({
      selected: { conversationVersion: 8, handoffStatus: "in_progress" },
      versionsCurrent: true,
      working: false,
    });
    expect(test.workflow.getSnapshot().notice).toContain("claimed");
    await test.workflow.mutate(
      "/v1/staff/handoffs/handoff-conversation-a/resolve",
      { id: "handoff-conversation-a", version: 2 },
      { conversation_version: 8, disposition: "resume_ai", resolution_code: "staff_resolved" },
    );
    const posts = test.request.mock.calls.filter((call) => call[1]?.method === "POST");
    expect(posts).toHaveLength(2);
    expect(posts[1]?.[1]).toMatchObject({
      body: JSON.stringify({
        conversation_version: 8,
        disposition: "resume_ai",
        resolution_code: "staff_resolved",
      }),
      headers: { "if-match": '"handoff-conversation-a:2"', "x-csrf-token": "synthetic-csrf" },
    });
    expect(test.workflow.getSnapshot()).toMatchObject({
      selected: {
        id: "conversation-a",
        actionable: false,
        handoffStatus: "resolved",
        conversationVersion: 9,
      },
      items: [],
      versionsCurrent: true,
    });
    expect(test.workflow.getSnapshot().notice).toContain("History");
    expect(test.workflow.getSnapshot().detail?.messages).toHaveLength(1);
  });

  it.each(["detail", "list"])(
    "pauses further actions after a successful command when %s refresh fails, then recovers explicitly",
    async (failedPart) => {
      const test = harness();
      await test.workflow.open(item());
      if (failedPart === "detail") test.setDetailFailure(true);
      else test.setListFailure(true);
      await claim(test);
      expect(test.workflow.getSnapshot()).toMatchObject({
        selected: { id: "conversation-a" },
        versionsCurrent: false,
      });
      expect(test.workflow.getSnapshot().notice).toContain("claimed");
      expect(test.workflow.getSnapshot().detail?.messages).toHaveLength(1);
      await claim(test);
      expect(test.request.mock.calls.filter((call) => call[1]?.method === "POST")).toHaveLength(1);
      test.setDetailFailure(false);
      test.setListFailure(false);
      await test.workflow.refresh();
      expect(test.workflow.getSnapshot()).toMatchObject({
        versionsCurrent: true,
        selected: { conversationVersion: 8 },
        detail: { handoff: { version: 2 } },
      });
    },
  );

  it("preserves context on rejected commands, refreshes versions, and never claims success", async () => {
    const test = harness();
    await test.workflow.open(item());
    test.setConflict();
    await claim(test);
    expect(test.workflow.getSnapshot()).toMatchObject({
      selected: { id: "conversation-a" },
      versionsCurrent: true,
      notice: "This request was already handled.",
    });
    expect(test.workflow.getSnapshot().detail?.messages).toHaveLength(1);
    expect(test.workflow.getSnapshot().notice).not.toContain("claimed");
  });

  it("does not expose network errors or retry a possibly committed command", async () => {
    const test = harness();
    await test.workflow.open(item());
    test.setNetworkFailure();
    await claim(test);
    expect(test.workflow.getSnapshot().notice).toContain("could not confirm");
    expect(test.workflow.getSnapshot().notice).not.toContain("private");
    expect(test.request.mock.calls.filter((call) => call[1]?.method === "POST")).toHaveLength(1);
    expect(test.workflow.getSnapshot().selected).not.toBeNull();
  });

  it("does not submit obsolete resource/conversation versions", async () => {
    const test = harness();
    await test.workflow.open(item());
    await claim(test, 99);
    expect(test.workflow.getSnapshot().versionsCurrent).toBe(false);
    expect(test.request.mock.calls.some((call) => call[1]?.method === "POST")).toBe(false);
    await test.workflow.refresh();
    await claim(test, 1, 99);
    expect(test.workflow.getSnapshot().versionsCurrent).toBe(false);
    expect(test.request.mock.calls.some((call) => call[1]?.method === "POST")).toBe(false);
  });

  it.each(["absent", "malformed"])(
    "requires %s CSRF proof without losing the conversation",
    async (failure) => {
      const test = harness();
      await test.workflow.open(item());
      if (failure === "absent") test.csrf.mockReturnValue(null);
      else
        test.csrf.mockImplementation(() => {
          throw new Error("malformed cookie");
        });
      await claim(test);
      expect(test.request.mock.calls.some((call) => call[1]?.method === "POST")).toBe(false);
      expect(test.workflow.getSnapshot().notice).toContain("session");
      expect(test.workflow.getSnapshot().selected).not.toBeNull();
    },
  );

  it("blocks double submission and selecting another conversation while the command is pending", async () => {
    const test = harness();
    await test.workflow.open(item());
    const pending = deferred();
    test.request.mockImplementationOnce(() => pending.promise);
    const first = claim(test);
    await claim(test);
    await test.workflow.open(item("conversation-b"));
    expect(test.workflow.getSnapshot()).toMatchObject({
      working: true,
      versionsCurrent: false,
      selected: { id: "conversation-a" },
    });
    pending.resolve(data({}));
    await first;
    expect(test.request.mock.calls.filter((call) => call[1]?.method === "POST")).toHaveLength(1);
  });

  it("reports failed or malformed lists instead of presenting a false empty Inbox", async () => {
    const test = harness();
    test.setListFailure(true);
    await test.workflow.loadList();
    expect(test.workflow.getSnapshot()).toMatchObject({
      loading: false,
    });
    expect(test.workflow.getSnapshot().listError).toContain("could not be loaded");
    test.setListFailure(false);
    test.request.mockImplementationOnce(() => Promise.resolve(page([{ id: "invalid" }])));
    await test.workflow.loadList();
    expect(test.workflow.getSnapshot().listError).not.toBeNull();
    await test.workflow.loadList();
    expect(test.workflow.getSnapshot().listError).toBeNull();
  });

  it("retains existing messages on failed refresh and fails closed on inconsistent versions", async () => {
    const test = harness();
    await test.workflow.open(item());
    test.setDetailFailure(true);
    await test.workflow.refresh();
    expect(test.workflow.getSnapshot()).toMatchObject({
      versionsCurrent: false,
    });
    expect(test.workflow.getSnapshot().detailError).toContain("Actions are paused");
    expect(test.workflow.getSnapshot().detail?.messages).toHaveLength(1);
    test.setDetailFailure(false);
    const original = test.request.getMockImplementation();
    if (original === undefined) throw new Error("fixture missing");
    test.request.mockImplementation((path, init) =>
      path.startsWith("/v1/staff/handoffs/")
        ? Promise.resolve(
            data({
              id: "handoff-conversation-a",
              version: 1,
              conversation_version: 99,
              status: "requested",
            }),
          )
        : original(path, init),
    );
    await test.workflow.refresh();
    expect(test.workflow.getSnapshot().versionsCurrent).toBe(false);
  });

  it("ignores late detail replies after a different conversation is opened", async () => {
    const test = harness(),
      pending = deferred();
    test.request.mockImplementationOnce(() => pending.promise);
    const old = test.workflow.open(item());
    await test.workflow.open(item("conversation-b"));
    pending.resolve(
      data({
        id: "conversation-a",
        version: 7,
        status: "awaiting_staff",
        active_handoff_id: "handoff-conversation-a",
      }),
    );
    await old;
    expect(test.workflow.getSnapshot()).toMatchObject({
      selected: { id: "conversation-b" },
      detail: { conversation: { id: "conversation-b" } },
      versionsCurrent: true,
    });
  });

  it("ignores an old Inbox response after History was requested", async () => {
    const test = harness(),
      pending = deferred();
    test.request.mockImplementationOnce(() => pending.promise);
    const old = test.workflow.loadList();
    await test.workflow.changeView("history");
    pending.resolve(page([listItem("conversation-a")]));
    await old;
    expect(test.workflow.getSnapshot()).toMatchObject({
      view: "history",
      items: [],
      loading: false,
    });
  });

  it("does not let stale participant summaries leak into a later History page", async () => {
    const test = harness(),
      summary = deferred();
    test.request.mockImplementationOnce(() => Promise.resolve(page([listItem("conversation-a")])));
    test.request.mockImplementationOnce(() => summary.promise);
    await test.workflow.loadList();
    await test.workflow.changeView("history");
    summary.resolve(data({ participant: { display_redacted: "Old view label" } }));
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(test.workflow.getSnapshot().summaries).toEqual({});
  });

  it("fails closed when a referenced detail disappears or a new active handoff replaced it", async () => {
    const test = harness();
    await test.workflow.open(item());
    test.request.mockImplementationOnce(() => Promise.resolve(new Response(null, { status: 404 })));
    await test.workflow.open(item());
    expect(test.workflow.getSnapshot().versionsCurrent).toBe(false);
    test.request.mockImplementationOnce(() =>
      Promise.resolve(
        data({
          id: "conversation-a",
          version: 7,
          status: "awaiting_staff",
          active_handoff_id: "another-handoff",
        }),
      ),
    );
    await test.workflow.open(item());
    expect(test.workflow.getSnapshot().versionsCurrent).toBe(false);
    expect(test.workflow.getSnapshot().detail?.messages).toHaveLength(1);
  });

  it("refreshes appointment resource versions before the next review command", async () => {
    const test = harness();
    const appointmentItem = {
      ...item(),
      handoffId: null,
      handoffStatus: null,
      appointmentRequestId: "appointment-a",
      appointmentStatus: "requested",
    };
    let version = 1;
    test.request.mockImplementation(async (path, init) => {
      await Promise.resolve();
      if (init?.method === "POST") {
        version++;
        return data({});
      }
      if (path.startsWith("/v1/staff/inbox")) return page();
      if (path.includes("/messages?")) return data([]);
      if (path.startsWith("/v2/staff/conversations/"))
        return data({ id: "conversation-a", version: 7, status: "open", active_handoff_id: null });
      return data({ id: "appointment-a", version, conversation_version: 7, status: "requested" });
    });
    await test.workflow.open(appointmentItem);
    await test.workflow.mutate(
      "/v1/staff/appointment-requests/appointment-a/accept",
      { id: "appointment-a", version: 1 },
      {},
    );
    expect(test.workflow.getSnapshot().detail?.appointment?.["version"]).toBe(2);
    await test.workflow.mutate(
      "/v1/staff/appointment-requests/appointment-a/reject",
      { id: "appointment-a", version: 2 },
      { reason_code: "time_unavailable" },
    );
    expect(
      test.request.mock.calls.filter((call) => call[1]?.method === "POST")[1]?.[1],
    ).toMatchObject({ headers: { "if-match": '"appointment-a:2"' } });
  });

  it("ignores pending work after component cleanup", async () => {
    const test = harness(),
      pending = deferred();
    test.request.mockImplementationOnce(() => pending.promise);
    const old = test.workflow.loadList();
    test.workflow.invalidatePending();
    const snapshot = test.workflow.getSnapshot();
    pending.resolve(page([listItem("conversation-a")]));
    await old;
    expect(test.workflow.getSnapshot()).toBe(snapshot);
  });

  it("focuses and scrolls the transcript, and keeps work before settings in the actual component", () => {
    const region = { focus: vi.fn(), scrollIntoView: vi.fn() };
    focusStaffConversation(region);
    expect(region.focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(region.scrollIntoView).toHaveBeenCalledWith({ block: "start", behavior: "auto" });
    const source = readFileSync(
      new URL("../app/staff/StaffWorkspace.tsx", import.meta.url),
      "utf8",
    );
    expect(source.indexOf('id="work"')).toBeLessThan(source.indexOf('id="integrations"'));
    expect(source.indexOf('id="conversation"')).toBeLessThan(source.indexOf('id="analytics"'));
    expect(source).toContain('workflow.changeView("history")');
    expect(source).toContain("focusStaffConversation(conversationRegion.current)");
    expect(source).toContain("Inbox 0 means no pending staff work");
    expect(source).toContain("!versionsCurrent");
  });
});
