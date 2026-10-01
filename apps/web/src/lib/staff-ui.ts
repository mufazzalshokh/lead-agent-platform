export const ORGANIZATION_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

const statusLabels: Readonly<Record<string, string>> = Object.freeze({
  appointment_request: "Appointment request",
  awaiting_customer_confirmation: "Waiting for customer confirmation",
  awaiting_lead: "Learning what the customer needs",
  awaiting_staff: "Needs staff attention",
  claimed: "Being handled",
  closed: "Closed",
  confirmed: "Confirmed",
  conversation: "Conversation",
  handoff: "Human requested",
  notification: "Notification",
  open: "In progress",
  rejected: "Not accepted",
  requested: "Needs staff review",
  resolved: "Resolved",
  staff_accepted: "Waiting for customer confirmation",
});

export const humanizeStaffStatus = (value: string): string =>
  statusLabels[value] ??
  value
    .split("_")
    .filter((part) => part.length > 0)
    .map((part, index) => (index === 0 ? part.charAt(0).toUpperCase() + part.slice(1) : part))
    .join(" ");

export const formatStaffDateTime = (value: string, locale = "en-GB"): string => {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return "Time unavailable";
  const parts = new Intl.DateTimeFormat(locale, {
    day: "2-digit",
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    month: "2-digit",
    timeZone: "Asia/Tashkent",
    year: "numeric",
  }).formatToParts(parsed);
  const read = (name: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === name)?.value ?? "";
  return `${read("day")}-${read("month")}-${read("year")}, ${read("hour")}:${read("minute")}`;
};

export const formatStaffLocalDateTime = (value: string): string => {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/u.exec(value);
  if (match === null) return value;
  const [, year, month, day, hour, minute] = match;
  const date = `${day}-${month}-${year}`;
  return hour === undefined || minute === undefined ? date : `${date}, ${hour}:${minute}`;
};

export const readOrganizationContext = (value: unknown): string | null =>
  typeof value === "string" && ORGANIZATION_ID_PATTERN.test(value) ? value : null;

export type StaffAuthRecovery = "denied" | "reauthenticate";

export const readStaffAuthRecovery = (value: unknown): StaffAuthRecovery | null =>
  value === "denied" || value === "reauthenticate" ? value : null;

export const buildStaffSignInPath = (
  organizationId: string | null,
  recovery: StaffAuthRecovery | null,
): string => {
  const returnPath =
    organizationId === null
      ? "/staff"
      : `/staff?organization=${encodeURIComponent(organizationId)}`;
  const parameters = new URLSearchParams({ return_to: returnPath });
  if (recovery === "reauthenticate") parameters.set("reauthenticate", "true");
  return `/v1/staff/auth/login?${parameters.toString()}`;
};

export const readCsrfCookie = (cookieHeader: string): string | null => {
  for (const entry of cookieHeader.split(";")) {
    const [rawName, ...rawValue] = entry.trim().split("=");
    if (rawName !== "__Host-lead-csrf") continue;
    const value = rawValue.join("=");
    return value.length > 0 ? decodeURIComponent(value) : null;
  }
  return null;
};

export const staffActionMessage = (status: number, code?: string): string => {
  if (status === 401) return "Your session ended. Please sign in again.";
  if (status === 403) return "You do not have access to this workspace action.";
  if (status === 409 || code === "version_conflict" || code === "state_conflict") {
    return "This request was already handled.";
  }
  if (status === 429) return "Too many requests. Please wait a moment and try again.";
  return "We could not complete that action. Please try again.";
};

export const makeIdempotencyKey = (scope: string, randomValue: string): string =>
  `staff.${scope}.${randomValue}`.replace(/[^A-Za-z0-9._:-]/gu, "-").slice(0, 128);

export type StaffMembershipRole = "admin" | "analyst" | "owner" | "staff";

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const readStaffMembershipRole = (value: unknown): StaffMembershipRole | null => {
  if (!isRecord(value)) return null;
  const activeOrganization = value["active_organization"];
  if (!isRecord(activeOrganization)) return null;
  const role = activeOrganization["role"];
  return role === "admin" || role === "analyst" || role === "owner" || role === "staff"
    ? role
    : null;
};

export const canManageIntegrations = (role: StaffMembershipRole | null): boolean =>
  role === "owner" || role === "admin";

export type IntegrationConnectionStatus =
  "connected" | "connection_pending" | "needs_attention" | "not_connected";

export type TelegramIntegrationStatus = Readonly<{
  nextStep: "connect_business" | "open_bot" | null;
  status: IntegrationConnectionStatus;
}>;

const readIntegrationStatus = (value: unknown): IntegrationConnectionStatus | null =>
  value === "connected" ||
  value === "connection_pending" ||
  value === "needs_attention" ||
  value === "not_connected"
    ? value
    : null;

export const readInstagramIntegrationStatus = (
  value: unknown,
): IntegrationConnectionStatus | null => {
  if (!isRecord(value)) return null;
  return readIntegrationStatus(value["status"]);
};

export const readTelegramIntegrationStatus = (value: unknown): TelegramIntegrationStatus | null => {
  if (!isRecord(value)) return null;
  const status = readIntegrationStatus(value["status"]);
  const nextStep = value["next_step"];
  if (
    status === null ||
    !(nextStep === null || nextStep === "connect_business" || nextStep === "open_bot")
  ) {
    return null;
  }
  return Object.freeze({ nextStep, status });
};

export const readTelegramOnboardingUrl = (value: unknown): string | null => {
  if (!isRecord(value) || typeof value["onboarding_url"] !== "string") return null;
  try {
    const url = new URL(value["onboarding_url"]);
    if (
      url.protocol !== "https:" ||
      url.hostname !== "t.me" ||
      !/^\/[A-Za-z][A-Za-z0-9_]{4,31}$/u.test(url.pathname) ||
      !/^[A-Za-z0-9_-]{43}$/u.test(url.searchParams.get("start") ?? "") ||
      [...url.searchParams.keys()].some((name) => name !== "start") ||
      url.hash.length > 0 ||
      url.username.length > 0 ||
      url.password.length > 0
    ) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
};

export const readInstagramAuthorizationUrl = (value: unknown): string | null => {
  if (!isRecord(value) || typeof value["authorization_url"] !== "string") return null;
  try {
    const url = new URL(value["authorization_url"]);
    if (
      url.protocol !== "https:" ||
      url.hostname !== "www.instagram.com" ||
      url.pathname !== "/oauth/authorize" ||
      url.searchParams.get("state") === null ||
      url.searchParams.get("client_id") === null ||
      url.hash.length > 0 ||
      url.username.length > 0 ||
      url.password.length > 0
    ) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
};

type ExternalProviderWindow = {
  readonly closed: boolean;
  close(): void;
  location: Readonly<{ replace(url: string): void }>;
  opener: unknown;
};

export type IntegrationNavigation = Readonly<{
  assign(url: string): void;
  open(): ExternalProviderWindow | null;
}>;

export type IntegrationInitiationResult =
  | Readonly<{ ok: true; provider: "instagram" | "telegram" }>
  | Readonly<{ code?: string; ok: false; status: number }>;

const readProblemCode = (value: unknown): string | undefined => {
  if (!isRecord(value)) return undefined;
  const code = value["code"];
  return typeof code === "string" && /^[a-z][a-z0-9_]{0,63}$/u.test(code) ? code : undefined;
};

const prepareExternalProviderNavigation = (navigation: IntegrationNavigation) => {
  let providerWindow: ExternalProviderWindow | null = null;
  try {
    providerWindow = navigation.open();
    if (providerWindow !== null) providerWindow.opener = null;
  } catch {
    providerWindow = null;
  }
  return Object.freeze({
    cancel: (): void => {
      if (providerWindow === null || providerWindow.closed) return;
      try {
        providerWindow.close();
      } catch {
        // The fallback navigation remains safe even when the browser revokes the popup handle.
      }
    },
    navigate: (url: string): void => {
      if (providerWindow !== null && !providerWindow.closed) {
        try {
          providerWindow.location.replace(url);
          return;
        } catch {
          // Fall back to same-tab navigation when the browser revokes the popup handle.
        }
      }
      navigation.assign(url);
    },
  });
};

export const initiateIntegrationConnection = async (
  input: Readonly<{
    csrfToken: string;
    navigation: IntegrationNavigation;
    provider: "instagram" | "telegram";
    request(path: string, init: RequestInit): Promise<Response>;
  }>,
): Promise<IntegrationInitiationResult> => {
  // Opening the blank destination before the first await preserves the user's click gesture.
  const pendingNavigation = prepareExternalProviderNavigation(input.navigation);
  try {
    const response = await input.request(`/v1/staff/integrations/${input.provider}/onboarding`, {
      body: JSON.stringify({
        display_name:
          input.provider === "telegram" ? "Telegram Business" : "Instagram Professional",
      }),
      headers: { "content-type": "application/json", "x-csrf-token": input.csrfToken },
      method: "POST",
    });
    if (!response.ok) {
      pendingNavigation.cancel();
      const failure: unknown = await response.json().catch(() => null);
      const code = readProblemCode(failure);
      return code === undefined
        ? Object.freeze({ ok: false, status: response.status })
        : Object.freeze({ code, ok: false, status: response.status });
    }
    const body: unknown = await response.json();
    const destination =
      input.provider === "telegram"
        ? readTelegramOnboardingUrl(body)
        : readInstagramAuthorizationUrl(body);
    if (destination === null) {
      pendingNavigation.cancel();
      return Object.freeze({ code: "invalid_provider_response", ok: false, status: 502 });
    }
    pendingNavigation.navigate(destination);
    return Object.freeze({ ok: true, provider: input.provider });
  } catch {
    pendingNavigation.cancel();
    return Object.freeze({ code: "dependency_unavailable", ok: false, status: 503 });
  }
};

export type WidgetManagementConfiguration = Readonly<{
  publishableKey: string;
  websiteOrigin: string;
}>;

export const readWidgetManagementConfiguration = (
  value: unknown,
): WidgetManagementConfiguration | null => {
  if (
    !isRecord(value) ||
    value["status"] !== "active" ||
    typeof value["publishable_key"] !== "string" ||
    !/^[A-Za-z0-9_-]{43}$/u.test(value["publishable_key"]) ||
    typeof value["website_origin"] !== "string"
  ) {
    return null;
  }
  try {
    const origin = new URL(value["website_origin"]);
    if (
      origin.protocol !== "https:" ||
      origin.origin !== value["website_origin"] ||
      origin.username.length > 0 ||
      origin.password.length > 0
    ) {
      return null;
    }
    return Object.freeze({
      publishableKey: value["publishable_key"],
      websiteOrigin: origin.origin,
    });
  } catch {
    return null;
  }
};

export const buildWidgetInstallSnippet = (
  platformOrigin: string,
  configuration: WidgetManagementConfiguration,
): string => {
  const origin = new URL(platformOrigin);
  if (
    origin.protocol !== "https:" ||
    origin.origin !== platformOrigin ||
    origin.username.length > 0 ||
    origin.password.length > 0 ||
    !/^[A-Za-z0-9_-]{43}$/u.test(configuration.publishableKey)
  ) {
    throw new TypeError("Widget installation configuration is invalid");
  }
  return `<script async src="${origin.origin}/embed/widget.js" data-widget-key="${configuration.publishableKey}" data-locale="uz"></script>`;
};
