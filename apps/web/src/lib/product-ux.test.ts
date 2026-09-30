import { Script } from "node:vm";

import { describe, expect, it, vi } from "vitest";

import {
  formatStaffDateTime,
  formatStaffLocalDateTime,
  humanizeStaffStatus,
  initiateIntegrationConnection,
  canManageIntegrations,
  buildWidgetInstallSnippet,
  readCsrfCookie,
  readInstagramAuthorizationUrl,
  readInstagramIntegrationStatus,
  readOrganizationContext,
  readStaffAuthRecovery,
  readStaffMembershipRole,
  readTelegramOnboardingUrl,
  readTelegramIntegrationStatus,
  readWidgetManagementConfiguration,
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
    expect(readStaffAuthRecovery("reauthenticate")).toBe("reauthenticate");
    expect(readStaffAuthRecovery("denied")).toBe("denied");
    expect(readStaffAuthRecovery(["reauthenticate"])).toBeNull();
    expect(readStaffAuthRecovery("ready")).toBeNull();
  });

  it("derives integration management from the authenticated membership only", () => {
    expect(readStaffMembershipRole({ active_organization: { role: "owner" } })).toBe("owner");
    expect(canManageIntegrations("owner")).toBe(true);
    expect(canManageIntegrations("admin")).toBe(true);
    expect(canManageIntegrations("staff")).toBe(false);
    expect(readStaffMembershipRole({ active_organization: { role: "manager" } })).toBeNull();
  });

  it("accepts only the intended provider onboarding destinations", () => {
    const nonce = "a".repeat(43);
    expect(
      readTelegramOnboardingUrl({ onboarding_url: `https://t.me/lead_agent_bot?start=${nonce}` }),
    ).toBe(`https://t.me/lead_agent_bot?start=${nonce}`);
    expect(
      readTelegramOnboardingUrl({ onboarding_url: `https://evil.example/?start=${nonce}` }),
    ).toBeNull();
    expect(
      readInstagramAuthorizationUrl({
        authorization_url: `https://www.instagram.com/oauth/authorize?client_id=123&state=${nonce}`,
      }),
    ).not.toBeNull();
    expect(
      readInstagramAuthorizationUrl({
        authorization_url: `https://evil.example/oauth/authorize?client_id=123&state=${nonce}`,
      }),
    ).toBeNull();
  });

  it("opens the tenant-bound Telegram onboarding result from the initiating click", async () => {
    const nonce = "a".repeat(43);
    const replace = vi.fn(),
      close = vi.fn(),
      assign = vi.fn(),
      popup = { closed: false, close, location: { replace }, opener: {} },
      open = vi.fn(() => popup),
      request = vi.fn(async (_path: string, _init: RequestInit) =>
        Response.json(
          { onboarding_url: `https://t.me/lead_agent_bot?start=${nonce}` },
          { status: 201 },
        ),
      );

    const result = await initiateIntegrationConnection({
      csrfToken: "csrf-proof",
      navigation: { assign, open },
      provider: "telegram",
      request,
    });

    expect(request).toHaveBeenCalledWith(
      "/v1/staff/integrations/telegram/onboarding",
      expect.objectContaining({
        body: JSON.stringify({ display_name: "Telegram Business" }),
        headers: { "content-type": "application/json", "x-csrf-token": "csrf-proof" },
        method: "POST",
      }),
    );
    expect(open).toHaveBeenCalledOnce();
    expect(popup.opener).toBeNull();
    expect(replace).toHaveBeenCalledWith(`https://t.me/lead_agent_bot?start=${nonce}`);
    expect(assign).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: true, provider: "telegram" });
    expect(JSON.stringify(result)).not.toContain(nonce);
  });

  it("falls back to same-tab Instagram OAuth navigation when a popup is blocked", async () => {
    const nonce = "b".repeat(43),
      authorizationUrl = `https://www.instagram.com/oauth/authorize?client_id=123&state=${nonce}`,
      assign = vi.fn(),
      request = vi.fn(async (_path: string, _init: RequestInit) =>
        Response.json({ authorization_url: authorizationUrl }, { status: 201 }),
      );

    const result = await initiateIntegrationConnection({
      csrfToken: "csrf-proof",
      navigation: { assign, open: () => null },
      provider: "instagram",
      request,
    });

    expect(request).toHaveBeenCalledWith(
      "/v1/staff/integrations/instagram/onboarding",
      expect.objectContaining({
        body: JSON.stringify({ display_name: "Instagram Professional" }),
        headers: { "content-type": "application/json", "x-csrf-token": "csrf-proof" },
        method: "POST",
      }),
    );
    expect(assign).toHaveBeenCalledWith(authorizationUrl);
    expect(result).toEqual({ ok: true, provider: "instagram" });
    expect(JSON.stringify(result)).not.toContain(nonce);
  });

  it("closes the pending destination and returns only safe failure metadata", async () => {
    const close = vi.fn(),
      replace = vi.fn(),
      popup = { closed: false, close, location: { replace }, opener: {} },
      request = vi.fn(async (_path: string, _init: RequestInit) =>
        Response.json(
          { app_secret: "must-not-enter-client-state", code: "permission_denied" },
          { status: 403 },
        ),
      );

    const result = await initiateIntegrationConnection({
      csrfToken: "csrf-proof",
      navigation: { assign: vi.fn(), open: () => popup },
      provider: "instagram",
      request,
    });

    expect(close).toHaveBeenCalledOnce();
    expect(replace).not.toHaveBeenCalled();
    expect(result).toEqual({ code: "permission_denied", ok: false, status: 403 });
    expect(JSON.stringify(result)).not.toContain("must-not-enter-client-state");
    if (result.ok) throw new TypeError("Expected integration initiation to fail");
    expect(staffActionMessage(result.status, result.code)).toBe(
      "You do not have access to this workspace action.",
    );
  });

  it("accepts only finite secret-free integration status projections", () => {
    expect(readInstagramIntegrationStatus({ status: "connected" })).toBe("connected");
    expect(readInstagramIntegrationStatus({ status: "active", token: "secret" })).toBeNull();
    expect(
      readTelegramIntegrationStatus({
        next_step: "connect_business",
        status: "connection_pending",
      }),
    ).toEqual({ nextStep: "connect_business", status: "connection_pending" });
    expect(
      readTelegramIntegrationStatus({ next_step: "unknown", status: "connection_pending" }),
    ).toBeNull();
  });

  it("builds a safe Widget installation snippet only from persisted public setup", () => {
    const configuration = readWidgetManagementConfiguration({
      publishable_key: "w".repeat(43),
      status: "active",
      website_origin: "https://clinic.example",
    });
    expect(configuration).not.toBeNull();
    if (configuration === null) throw new TypeError("Expected Widget configuration");
    const snippet = buildWidgetInstallSnippet("https://platform.example", configuration);
    expect(snippet).toBe(
      `<script async src="https://platform.example/embed/widget.js" data-widget-key="${"w".repeat(43)}" data-locale="uz"></script>`,
    );
    expect(snippet).not.toContain("organization");
    expect(snippet).not.toContain("bearer");
    expect(
      readWidgetManagementConfiguration({
        publishable_key: "short",
        status: "active",
        website_origin: "https://clinic.example",
      }),
    ).toBeNull();
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
