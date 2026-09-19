import { Script } from "node:vm";

import { describe, expect, it } from "vitest";

import {
  formatStaffDateTime,
  formatStaffLocalDateTime,
  humanizeStaffStatus,
  readCsrfCookie,
  readOrganizationContext,
  staffActionMessage,
} from "./staff-ui.js";
import {
  buildWidgetFrameDocument,
  buildWidgetLoader,
  requireHttpsOrigin,
  requireWidgetGrant,
} from "./widget-embed.js";

const API_ORIGIN = "https://api.example.test";
const HOST_ORIGIN = "https://clinic.example.test";
const GRANT = `wex1.${"a".repeat(16)}.${"b".repeat(80)}.${"c".repeat(22)}`;

describe("S19 staff presentation policy", () => {
  it("maps authoritative states without claiming early confirmation", () => {
    expect(humanizeStaffStatus("requested")).toBe("Needs staff review");
    expect(humanizeStaffStatus("staff_accepted")).toBe("Waiting for customer confirmation");
    expect(humanizeStaffStatus("confirmed")).toBe("Confirmed");
    expect(staffActionMessage(409)).toBe("This request was already handled.");
  });

  it("uses Tashkent time with the DD-MM-YYYY product format", () => {
    expect(formatStaffDateTime("2026-09-19T10:05:00.000Z")).toBe("19-09-2026, 15:05");
    expect(formatStaffLocalDateTime("2026-09-20T17:00:00")).toBe("20-09-2026, 17:00");
  });

  it("accepts only canonical organization selectors and the exact CSRF cookie", () => {
    expect(readOrganizationContext("0193f1a8-7f65-7c28-a434-a10796c46703")).not.toBeNull();
    expect(readOrganizationContext("not-an-organization")).toBeNull();
    expect(readCsrfCookie("other=x; __Host-lead-csrf=proof%2Dvalue")).toBe("proof-value");
    expect(readCsrfCookie("lead-csrf=wrong")).toBeNull();
  });
});

describe("S19 secure Widget documents", () => {
  it("builds a loader that keeps the bearer inside a sandboxed exact-origin iframe", () => {
    const loader = buildWidgetLoader(API_ORIGIN);
    expect(() => new Script(loader)).not.toThrow();
    expect(loader).toContain('next.sandbox = "allow-scripts allow-same-origin"');
    expect(loader).toContain("event.source !== frame.contentWindow");
    expect(loader).toContain("event.origin !== frameOrigin");
    expect(loader).not.toContain("bearer_token");
    expect(loader).not.toMatch(/postMessage\([^)]*,\s*["']\*["']\)/u);
    expect(loader).not.toContain("allow-top-navigation");
    expect(loader).not.toContain("allow-popups");
  });

  it("builds a text-only, cookie-independent, exact-origin iframe client", () => {
    const document = buildWidgetFrameDocument({
      apiOrigin: API_ORIGIN,
      embeddingOrigin: HOST_ORIGIN,
      exchangeGrant: GRANT,
      instance: "instance_1234567890",
      nonce: "n".repeat(32),
    });
    const script = /<script nonce="[^"]+">([\s\S]+)<\/script>/u.exec(document)?.[1];
    if (script === undefined) throw new TypeError("Expected Widget frame script");
    expect(() => new Script(script)).not.toThrow();
    expect(document).toContain("text.textContent=item.text");
    expect(document).not.toContain("innerHTML");
    expect(document).toContain('maxlength="4000"');
    expect(document).toContain('event.key==="Enter"&&!event.shiftKey');
    expect(document).toContain("idempotency-key");
    expect(document).toContain("performance.now()");
    expect(document).toContain("/v1/widget/telemetry");
    expect(document).toContain(
      'JSON.stringify({duration_ms:duration,kind:"meaningful_first_response"})',
    );
    expect(document).not.toContain("client_sent_at");
    expect(document).not.toContain("Uzbek");
    expect(document).not.toContain("Gemini");
    expect(document).not.toContain("JWT");
    expect(document).not.toContain("document.cookie");
    expect(document).not.toMatch(/postMessage\([^)]*,\s*["']\*["']\)/u);
  });

  it("rejects non-HTTPS origins and malformed opaque grants", () => {
    expect(() => requireHttpsOrigin("http://clinic.example", "origin")).toThrow();
    expect(() => requireHttpsOrigin("https://clinic.example/path", "origin")).toThrow();
    expect(requireHttpsOrigin(HOST_ORIGIN, "origin")).toBe(HOST_ORIGIN);
    expect(requireWidgetGrant(GRANT)).toBe(GRANT);
    expect(() => requireWidgetGrant("visible-token")).toThrow();
  });
});
