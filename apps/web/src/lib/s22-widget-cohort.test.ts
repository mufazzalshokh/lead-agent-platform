import { readFileSync } from "node:fs";

import { isSchemaValue, S22WidgetCohortCandidateSchema } from "@lead-agent/contracts";
import { describe, expect, it, vi } from "vitest";
import type { StaffRequest } from "./staff-request";

import {
  createS22WidgetCohort,
  formatS22UsdMicros,
  isS22WidgetCandidateCurrent,
  S22_WIDGET_COHORT_PATH,
} from "./s22-widget-cohort";

const SESSION = "01a11c48-dbc2-76de-a873-f41664da5ccb";
const SECOND_SESSION = "01a11b7d-ddbf-759e-b4e3-1602d9e2238c";
const NOW = Date.parse("2026-10-08T17:01:00.000Z");
const candidate = (sessionId = SESSION) => {
  const value = {
    session_id: sessionId,
    session_version: 2,
    issued_at: "2026-10-08T17:00:00.000Z",
    idle_deadline: "2026-10-08T17:30:00.000Z",
    expires_at: "2026-10-08T19:00:00.000Z",
  };
  if (!isSchemaValue(S22WidgetCohortCandidateSchema, value)) throw new Error("invalid fixture");
  return value;
};
const snapshot = (version = 0, selectedSession: string | null = null) => ({
  selection_version: version,
  selected_session_id: selectedSession,
  can_select: true,
  candidates: [candidate(), candidate(SECOND_SESSION)],
  blocked: true,
  reason: "widget_session_unavailable",
  known_cost_micros: "8714",
  combined_exposure_micros: "1042110",
  unresolved_reserve_micros: "0",
});
const data = (value: unknown) =>
  Response.json({ data: value, meta: { request_id: "request:s22-widget-cohort" } });
const deferred = () => {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
const harness = () => {
  let clock = NOW;
  const request = vi.fn<StaffRequest>(() => Promise.resolve(data(snapshot())));
  const csrf = vi.fn<() => string | null>(() => "private-csrf-proof");
  const onAuthenticationRequired = vi.fn();
  const controller = createS22WidgetCohort({
    request,
    csrf,
    now: () => clock,
    onAuthenticationRequired,
  });
  const prepare = async () => {
    await controller.refresh();
    controller.choose(SESSION);
    controller.confirmFreshFrame(true);
  };
  return {
    controller,
    request,
    csrf,
    onAuthenticationRequired,
    prepare,
    setClock: (value: number) => {
      clock = value;
    },
  };
};
const receipt = (version = 1) => data({ selection_version: version, selected_session_id: SESSION });

describe("owner S22 Widget cohort presentation workflow", () => {
  it("does not auto-select a candidate, create sessions, authorize Send or call a provider", async () => {
    const test = harness();
    await test.controller.refresh();
    expect(test.controller.getSnapshot()).toMatchObject({
      visible: true,
      candidateId: null,
      freshFrameConfirmed: false,
      versionsCurrent: true,
    });
    await test.controller.select();
    test.controller.choose(SESSION);
    await test.controller.select();
    expect(test.request).toHaveBeenCalledTimes(1);
    expect(test.request).toHaveBeenCalledWith(S22_WIDGET_COHORT_PATH, { cache: "no-store" });
  });

  it("requires exact candidate choice and explicit acknowledgement for every command", async () => {
    const test = harness();
    await test.prepare();
    expect(test.controller.canSelect()).toBe(true);
    test.controller.choose(SECOND_SESSION);
    expect(test.controller.canSelect()).toBe(false);
    test.controller.choose("not-in-authorized-candidates");
    expect(test.controller.getSnapshot().candidateId).toBe(SECOND_SESSION);
    test.controller.confirmFreshFrame(true);
    expect(test.controller.canSelect()).toBe(true);
    await test.controller.refresh();
    expect(test.controller.getSnapshot().candidateId).toBe(SECOND_SESSION);
    expect(test.controller.canSelect()).toBe(false);
  });

  it("sends only the authenticated CSRF/CAS command and refreshes before enabling another", async () => {
    const test = harness();
    await test.prepare();
    const pendingRefresh = deferred();
    test.request.mockImplementationOnce(() => Promise.resolve(receipt()));
    test.request.mockImplementationOnce(() => pendingRefresh.promise);
    const selecting = test.controller.select();
    await vi.waitFor(() => expect(test.request).toHaveBeenCalledTimes(3));
    expect(test.request.mock.calls[1]).toEqual([
      `${S22_WIDGET_COHORT_PATH}/selection`,
      {
        method: "POST",
        headers: { "content-type": "application/json", "x-csrf-token": "private-csrf-proof" },
        body: JSON.stringify({
          session_id: SESSION,
          expected_session_version: 2,
          expected_selection_version: 0,
        }),
      },
    ]);
    expect(test.controller.getSnapshot()).toMatchObject({ working: true, versionsCurrent: false });
    expect(test.controller.getSnapshot().notice).toContain("does not authorize");
    await test.controller.select();
    await test.controller.refresh();
    expect(test.request).toHaveBeenCalledTimes(3);
    pendingRefresh.resolve(data(snapshot(1, SESSION)));
    await selecting;
    expect(test.controller.getSnapshot()).toMatchObject({
      snapshot: { selection_version: 1, selected_session_id: SESSION },
      candidateId: SESSION,
      working: false,
      versionsCurrent: true,
      freshFrameConfirmed: false,
    });
    expect(test.controller.canSelect()).toBe(false);
  });

  it("preserves successful feedback and context when refresh fails, with obsolete versions disabled", async () => {
    const test = harness();
    await test.prepare();
    test.request.mockImplementationOnce(() => Promise.resolve(receipt()));
    test.request.mockImplementationOnce(() => Promise.resolve(new Response(null, { status: 503 })));
    await test.controller.select();
    expect(test.controller.getSnapshot()).toMatchObject({
      candidateId: SESSION,
      versionsCurrent: false,
      working: false,
    });
    expect(test.controller.getSnapshot().notice).toContain("Test session selected");
    expect(test.controller.getSnapshot().error).toContain("paused");
    test.controller.confirmFreshFrame(true);
    await test.controller.select();
    expect(test.request.mock.calls.filter((call) => call[1]?.method === "POST")).toHaveLength(1);
    test.request.mockImplementationOnce(() => Promise.resolve(data(snapshot(2, SECOND_SESSION))));
    await test.controller.refresh();
    test.controller.choose(SESSION);
    test.controller.confirmFreshFrame(true);
    test.request.mockImplementationOnce(() => Promise.resolve(receipt(3)));
    await test.controller.select();
    const secondPost = test.request.mock.calls.filter((call) => call[1]?.method === "POST")[1];
    expect(secondPost?.[1]?.body).toContain('"expected_selection_version":2');
  });

  it("does not reselect the current session as a renewal", async () => {
    const test = harness();
    test.request.mockImplementationOnce(() => Promise.resolve(data(snapshot(1, SESSION))));
    await test.prepare();
    expect(test.controller.canSelect()).toBe(false);
    await test.controller.select();
    expect(test.request).toHaveBeenCalledTimes(1);
  });

  it("rejects a post-action snapshot older than the successful selection receipt", async () => {
    const test = harness();
    await test.prepare();
    test.request.mockImplementationOnce(() => Promise.resolve(receipt()));
    test.request.mockImplementationOnce(() => Promise.resolve(data(snapshot(0))));
    await test.controller.select();
    expect(test.controller.getSnapshot().versionsCurrent).toBe(false);
    expect(test.controller.getSnapshot().error).toContain("paused");
    expect(test.controller.getSnapshot().notice).toContain("Test session selected");
    test.controller.confirmFreshFrame(true);
    await test.controller.select();
    expect(test.request.mock.calls.filter((call) => call[1]?.method === "POST")).toHaveLength(1);
  });

  it.each([412, 403, 500])(
    "refreshes an unsuccessful command (%s) without a mutation retry",
    async (status) => {
      const test = harness();
      await test.prepare();
      test.request.mockImplementationOnce(() => Promise.resolve(new Response(null, { status })));
      test.request.mockImplementationOnce(() => Promise.resolve(data(snapshot(2, SECOND_SESSION))));
      await test.controller.select();
      expect(test.request.mock.calls.map((call) => call[1]?.method ?? "GET")).toEqual([
        "GET",
        "POST",
        "GET",
      ]);
      expect(test.controller.getSnapshot().snapshot?.selected_session_id).toBe(SECOND_SESSION);
      expect(test.controller.getSnapshot().notice).toContain("could not");
      expect(test.controller.getSnapshot().notice).not.toContain("Test session selected.");
      expect(test.controller.getSnapshot().freshFrameConfirmed).toBe(false);
    },
  );

  it("does not guess whether a failed transport committed and never exposes dependency details", async () => {
    const test = harness();
    await test.prepare();
    test.request.mockImplementationOnce(() =>
      Promise.reject(new Error("private bearer or connection detail")),
    );
    test.request.mockImplementationOnce(() => Promise.resolve(data(snapshot(1, SESSION))));
    await test.controller.select();
    expect(test.controller.getSnapshot().notice).toContain("could not confirm");
    expect(test.controller.getSnapshot().notice).not.toContain("private");
    expect(test.controller.getSnapshot().snapshot?.selected_session_id).toBe(SESSION);
    expect(test.request.mock.calls.filter((call) => call[1]?.method === "POST")).toHaveLength(1);
  });

  it.each([404, 403])("hides a disabled/non-owner route (%s), without polling", async (status) => {
    const test = harness();
    test.request.mockImplementationOnce(() => Promise.resolve(new Response(null, { status })));
    await test.controller.refresh();
    expect(test.controller.getSnapshot()).toMatchObject({
      visible: false,
      snapshot: null,
      versionsCurrent: false,
      loading: false,
    });
    expect(test.request).toHaveBeenCalledTimes(1);
  });

  it("fails closed on malformed or secret-bearing snapshot fields", async () => {
    const test = harness();
    test.request.mockImplementationOnce(() =>
      Promise.resolve(data({ ...snapshot(), credential: "must-not-display" })),
    );
    await test.controller.refresh();
    expect(test.controller.getSnapshot()).toMatchObject({ snapshot: null, versionsCurrent: false });
    expect(JSON.stringify(test.controller.getSnapshot())).not.toContain("must-not-display");
    test.controller.choose(SESSION);
    test.controller.confirmFreshFrame(true);
    await test.controller.select();
    expect(test.request).toHaveBeenCalledTimes(1);
  });

  it("honors the authoritative selection gate without treating an expired old selection as permission to spend", async () => {
    const test = harness();
    test.request.mockImplementationOnce(() =>
      Promise.resolve(data({ ...snapshot(), can_select: false, reason: "message_limit" })),
    );
    await test.prepare();
    expect(test.controller.canSelect()).toBe(false);
    await test.controller.select();
    expect(test.request).toHaveBeenCalledTimes(1);
  });

  it("rejects malformed/mismatched success receipts and reads current state instead of trusting them", async () => {
    const test = harness();
    await test.prepare();
    test.request.mockImplementationOnce(() =>
      Promise.resolve(data({ selection_version: 1, selected_session_id: SECOND_SESSION })),
    );
    await test.controller.select();
    expect(test.controller.getSnapshot().notice).toContain("could not confirm");
    expect(test.request.mock.calls.map((call) => call[1]?.method ?? "GET")).toEqual([
      "GET",
      "POST",
      "GET",
    ]);
  });

  it("ignores late successful and failed reads after a newer snapshot", async () => {
    const test = harness();
    const first = deferred();
    test.request.mockImplementationOnce(() => first.promise);
    const older = test.controller.refresh();
    test.request.mockImplementationOnce(() => Promise.resolve(data(snapshot(5, SECOND_SESSION))));
    await test.controller.refresh();
    first.resolve(data(snapshot(0)));
    await older;
    expect(test.controller.getSnapshot().snapshot?.selection_version).toBe(5);
    const failing = deferred();
    test.request.mockImplementationOnce(() => failing.promise);
    const obsolete = test.controller.refresh();
    test.request.mockImplementationOnce(() => Promise.resolve(data(snapshot(6, SESSION))));
    await test.controller.refresh();
    failing.resolve(new Response(null, { status: 503 }));
    await obsolete;
    expect(test.controller.getSnapshot()).toMatchObject({
      error: null,
      versionsCurrent: true,
      snapshot: { selection_version: 6 },
    });
  });

  it("invalidates pending reads on navigation and cannot refresh after an obsolete mutation", async () => {
    const test = harness();
    await test.prepare();
    const post = deferred();
    test.request.mockImplementationOnce(() => post.promise);
    const selecting = test.controller.select();
    test.controller.invalidatePending();
    post.resolve(receipt());
    await selecting;
    expect(test.request).toHaveBeenCalledTimes(2);
    expect(test.controller.getSnapshot()).toMatchObject({
      notice: null,
      versionsCurrent: false,
      working: false,
    });
    const read = deferred();
    test.request.mockImplementationOnce(() => read.promise);
    const loading = test.controller.refresh();
    test.controller.invalidatePending();
    read.resolve(data(snapshot(5, SESSION)));
    await loading;
    expect(test.controller.getSnapshot().snapshot?.selection_version).toBe(0);
  });

  it.each(["absent", "throws"])("does not post without readable CSRF (%s)", async (failure) => {
    const test = harness();
    await test.prepare();
    if (failure === "absent") test.csrf.mockReturnValue(null);
    else
      test.csrf.mockImplementation(() => {
        throw new Error("private-cookie-read");
      });
    await test.controller.select();
    expect(test.request).toHaveBeenCalledTimes(1);
    expect(test.onAuthenticationRequired).toHaveBeenCalledOnce();
    expect(test.controller.getSnapshot().versionsCurrent).toBe(false);
  });

  it("disables selection at the five-minute freshness boundary without renewing it", async () => {
    const test = harness();
    await test.prepare();
    test.setClock(Date.parse(candidate().issued_at) + 300_000 - 1);
    expect(test.controller.canSelect()).toBe(true);
    test.setClock(Date.parse(candidate().issued_at) + 300_000);
    expect(test.controller.canSelect()).toBe(false);
    await test.controller.select();
    expect(test.request).toHaveBeenCalledTimes(1);
    expect(isS22WidgetCandidateCurrent(candidate(), Date.parse(candidate().issued_at) - 1)).toBe(
      false,
    );
    expect(isS22WidgetCandidateCurrent(candidate(), Date.parse(candidate().expires_at))).toBe(
      false,
    );
  });

  it.each(["idle_deadline", "expires_at"] as const)(
    "rejects a fresh candidate at its precise %s without relying on the five-minute window",
    (field) => {
      const deadline = "2026-10-08T17:02:00.000Z";
      const value = { ...candidate(), [field]: deadline };
      expect(isS22WidgetCandidateCurrent(value, Date.parse(deadline) - 1)).toBe(true);
      expect(isS22WidgetCandidateCurrent(value, Date.parse(deadline))).toBe(false);
    },
  );

  it("formats safe integer money without floating-point arithmetic", () => {
    expect(formatS22UsdMicros("0")).toBe("USD0.000000");
    expect(formatS22UsdMicros("8714")).toBe("USD0.008714");
    expect(formatS22UsdMicros("1042110")).toBe("USD1.042110");
    expect(formatS22UsdMicros("9007199254740993")).toBe("USD9007199254.740993");
  });

  it("integrates only for the authenticated owner and renders an explicit selection-only control", () => {
    const workspace = readFileSync(
      new URL("../app/staff/StaffWorkspace.tsx", import.meta.url),
      "utf8",
    );
    const component = readFileSync(
      new URL("../app/staff/S22WidgetCohort.tsx", import.meta.url),
      "utf8",
    );
    expect(workspace).toMatch(/membershipRole === "owner"[\s\S]*?<S22WidgetCohort/u);
    expect(component).toContain("does not authorize Send");
    expect(component).toContain('type="checkbox"');
    expect(component).toContain("disabled={!controller.canSelect()}");
    expect(component).toContain("Choose only the fresh frame you just opened");
    expect(component).not.toContain("/v1/widget/");
  });
});
