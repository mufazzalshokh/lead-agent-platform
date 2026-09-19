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
