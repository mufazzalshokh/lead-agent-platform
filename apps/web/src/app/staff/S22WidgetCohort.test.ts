import { readFileSync } from "node:fs";

import {
  isSchemaValue,
  ResourceIdSchema,
  S22WidgetCohortStatusSchema,
  type S22WidgetCohortStatus,
} from "@lead-agent/contracts";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as cohort from "../../lib/s22-widget-cohort";
import type { StaffRequest } from "../../lib/staff-request";
import { S22WidgetCohort } from "./S22WidgetCohort";

const resourceId = (value: string) => {
  if (!isSchemaValue(ResourceIdSchema, value)) throw new Error("Invalid fixture ID");
  return value;
};
const SESSION = resourceId("01a1211b-84ef-7d87-b561-91440f04e5a2");
const NOW = Date.parse("2026-10-09T14:41:00.000Z");
const snapshot = (): S22WidgetCohortStatus => {
  const value = {
    selection_version: 0,
    selected_session_id: null,
    can_select: true,
    candidates: [
      {
        session_id: SESSION,
        session_version: 2,
        issued_at: "2026-10-09T14:40:00.000Z",
        idle_deadline: "2026-10-09T15:10:00.000Z",
        expires_at: "2026-10-09T16:40:00.000Z",
      },
    ],
    blocked: true,
    reason: "widget_session_unavailable",
    known_cost_micros: "8714",
    combined_exposure_micros: "1042110",
    unresolved_reserve_micros: "0",
  };
  if (!isSchemaValue(S22WidgetCohortStatusSchema, value))
    throw new Error("Invalid fixture snapshot");
  return value;
};

const harness = async (value = snapshot()) => {
  const request = vi.fn<StaffRequest>(() =>
    Promise.resolve(Response.json({ data: value, meta: { request_id: "request:ui-regression" } })),
  );
  const onAuthenticationRequired = vi.fn();
  // Use the real controller/CAS guards; only its HTTP transport is mocked.
  const controller = cohort.createS22WidgetCohort({
    request,
    csrf: () => null,
    onAuthenticationRequired,
  });
  await controller.refresh();
  vi.spyOn(cohort, "createS22WidgetCohort").mockReturnValue(controller);
  return {
    controller,
    request,
    render: () =>
      renderToStaticMarkup(createElement(S22WidgetCohort, { request, onAuthenticationRequired })),
  };
};

const inputTag = (markup: string, type: "radio" | "checkbox") => {
  const tag = markup.match(new RegExp(`<input[^>]*type="${type}"[^>]*>`, "u"))?.[0];
  if (tag === undefined) throw new Error(`Missing ${type} control`);
  return tag;
};
const actionButton = (markup: string) => {
  const tag = markup.match(/<button[^>]*class="secondary-button"[^>]*>[\s\S]*?<\/button>/u)?.[0];
  if (tag === undefined) throw new Error("Missing selection action");
  return tag;
};

beforeEach(() => vi.useFakeTimers({ now: NOW, toFake: ["Date"] }));
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("S22 Widget session selection clarity", () => {
  it("explains the two distinct steps and why confirmation is initially disabled", async () => {
    const test = await harness();
    const markup = test.render();
    expect(markup).toContain("1. Choose your chat");
    expect(markup).toContain("2. Confirm your choice");
    expect(markup).toContain("Choose the circle next to your chat first");
    expect(inputTag(markup, "radio")).not.toContain("disabled");
    expect(inputTag(markup, "checkbox")).toContain("disabled");
    expect(actionButton(markup)).toContain("disabled");
    expect(test.request).toHaveBeenCalledTimes(1);
  });

  it("keeps selection disabled until the chosen chat is explicitly confirmed", async () => {
    const test = await harness();
    test.controller.choose(SESSION);
    let markup = test.render();
    expect(markup).toContain("Tick the confirmation below");
    expect(inputTag(markup, "checkbox")).not.toContain("disabled");
    expect(actionButton(markup)).toContain("disabled");
    test.controller.confirmFreshFrame(true);
    markup = test.render();
    expect(actionButton(markup)).not.toContain("disabled");
    expect(markup).toContain("does not authorize Send");
    expect(test.request).toHaveBeenCalledTimes(1);
  });

  it("shows the five-minute selection deadline separately from session expiry", async () => {
    const test = await harness();
    const markup = test.render();
    expect(markup).toContain("Select before 09-10-2026, 19:45");
    expect(markup).toContain("Idle deadline: 09-10-2026, 20:10");
    expect(markup).toContain("Absolute expiry: 09-10-2026, 21:40");
    expect(markup).toContain("Asia/Tashkent");
  });

  it("makes already-selected success distinct from an unavailable action", async () => {
    const test = await harness({
      ...snapshot(),
      selection_version: 1,
      selected_session_id: SESSION,
      blocked: false,
      reason: null,
    });
    test.controller.choose(SESSION);
    const markup = test.render();
    expect(markup).toContain("Session already selected");
    expect(markup).toContain("You do not need to select it again");
    expect(inputTag(markup, "checkbox")).toContain("disabled");
    expect(actionButton(markup)).toContain("disabled");
    expect(markup).toContain("not paid-test approval");
    expect(test.request).toHaveBeenCalledTimes(1);
  });

  it("shows an existing selection after reloading staff without asking for another confirmation", async () => {
    const test = await harness({
      ...snapshot(),
      selected_session_id: SESSION,
      selection_version: 1,
    });
    const markup = test.render();
    expect(markup).toContain("Session already selected");
    expect(actionButton(markup)).toContain("disabled");
    expect(test.controller.getSnapshot().candidateId).toBeNull();
    expect(test.request).toHaveBeenCalledTimes(1);
  });

  it("requires a new explicit choice and confirmation for an eligible unused replacement", async () => {
    const secondSession = resourceId("01a1211b-84ef-7d87-b561-91440f04e5a3");
    const value = snapshot();
    const originalCandidate = value.candidates[0];
    if (originalCandidate === undefined) throw new Error("Missing fixture candidate");
    const test = await harness({
      ...value,
      selected_session_id: SESSION,
      candidates: [originalCandidate, { ...originalCandidate, session_id: secondSession }],
    });
    test.controller.choose(secondSession);
    let markup = test.render();
    expect(actionButton(markup)).not.toContain("Session already selected");
    expect(actionButton(markup)).toContain("disabled");
    expect(inputTag(markup, "checkbox")).not.toContain("disabled");
    test.controller.confirmFreshFrame(true);
    markup = test.render();
    expect(actionButton(markup)).not.toContain("disabled");
    expect(test.request).toHaveBeenCalledTimes(1);
  });

  it.each(["idle_deadline", "expires_at"] as const)(
    "shows an earlier %s as the selection deadline and disables controls at that boundary",
    async (field) => {
      const value = snapshot();
      const candidate = value.candidates[0];
      if (candidate === undefined) throw new Error("Missing fixture candidate");
      const shortened = { ...candidate, [field]: "2026-10-09T14:42:00.000Z" };
      const updated = { ...value, candidates: [shortened] };
      if (!isSchemaValue(S22WidgetCohortStatusSchema, updated)) throw new Error("Invalid fixture");
      const test = await harness(updated);
      test.controller.choose(SESSION);
      test.controller.confirmFreshFrame(true);
      expect(test.render()).toContain("Select before 09-10-2026, 19:42");
      vi.setSystemTime("2026-10-09T14:42:00.000Z");
      const markup = test.render();
      expect(markup).toContain("Selection window ended");
      expect(inputTag(markup, "checkbox")).toContain("disabled");
      expect(actionButton(markup)).toContain("disabled");
      expect(test.request).toHaveBeenCalledTimes(1);
    },
  );

  it("explains exact freshness expiry and does not enable confirmation or renew the session", async () => {
    const test = await harness();
    test.controller.choose(SESSION);
    test.controller.confirmFreshFrame(true);
    vi.setSystemTime("2026-10-09T14:45:00.000Z");
    const markup = test.render();
    expect(markup).toContain("Selection window ended");
    expect(markup).toContain("This chat can no longer be selected");
    expect(inputTag(markup, "radio")).toContain("disabled");
    expect(inputTag(markup, "checkbox")).toContain("disabled");
    expect(actionButton(markup)).toContain("disabled");
    expect(test.request).toHaveBeenCalledTimes(1);
  });

  it("explains the authoritative guard denial without implying selection or spending is permitted", async () => {
    const test = await harness({ ...snapshot(), can_select: false, reason: "message_limit" });
    test.controller.choose(SESSION);
    test.controller.confirmFreshFrame(true);
    const markup = test.render();
    expect(markup).toContain("Selection is blocked by the cohort guard");
    expect(inputTag(markup, "checkbox")).toContain("disabled");
    expect(actionButton(markup)).toContain("disabled");
    expect(test.request).toHaveBeenCalledTimes(1);
  });

  it("labels retained failed-refresh data as stale instead of showing current budget readiness", async () => {
    const test = await harness({ ...snapshot(), selected_session_id: SESSION, blocked: false });
    test.request.mockResolvedValueOnce(new Response(null, { status: 503 }));
    await test.controller.refresh();
    const markup = test.render();
    expect(markup).toContain("Refresh needed");
    expect(markup).toContain("Budget snapshot needs refresh");
    expect(markup).not.toContain("budget check ready");
    expect(markup).not.toContain("Session already selected");
    expect(actionButton(markup)).toContain("disabled");
    expect(inputTag(markup, "checkbox")).toContain("disabled");
    expect(test.request).toHaveBeenCalledTimes(2);
  });

  it("provides scoped accessible cards rather than a browser-default boxed fieldset", async () => {
    const test = await harness();
    const markup = test.render();
    expect(markup).toContain('class="s22-widget-cohort__choices"');
    expect(markup).toContain('class="s22-widget-cohort__candidate"');
    expect(markup).toContain('class="s22-widget-cohort__confirmation"');
    expect(markup).toContain('aria-describedby="s22-widget-confirmation-help"');
    const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
    expect(css).toMatch(/\.s22-widget-cohort__choices\s*\{[^}]*border:\s*0;/u);
    expect(css).toMatch(/\.s22-widget-cohort__candidate:focus-within/u);
    expect(css).toMatch(/\.s22-widget-cohort__candidate input[\s\S]*min-width:\s*1\.15rem/u);
  });
});
