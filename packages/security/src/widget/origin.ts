import { WidgetOriginInvalidError } from "./errors.js";

export type WidgetAllowedOriginRule = Readonly<{
  matchType: "exact" | "subdomain_wildcard";
  normalizedHost: string;
  port: number | null;
  scheme: "https";
}>;

export const normalizeWidgetOrigin = (value: unknown): string => {
  if (
    typeof value !== "string" ||
    value.length < 9 ||
    value.length > 2_048 ||
    value !== value.trim()
  ) {
    throw new WidgetOriginInvalidError();
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new WidgetOriginInvalidError();
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.origin === "null" ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.pathname !== "/" ||
    parsed.search !== "" ||
    parsed.hash !== "" ||
    parsed.hostname.length < 3 ||
    parsed.hostname.length > 253
  ) {
    throw new WidgetOriginInvalidError();
  }
  return parsed.origin;
};

export const widgetOriginMatches = (origin: string, rule: WidgetAllowedOriginRule): boolean => {
  let parsed: URL;
  try {
    parsed = new URL(normalizeWidgetOrigin(origin));
  } catch {
    return false;
  }
  const port = parsed.port === "" ? null : Number(parsed.port);
  if (rule.scheme !== "https") return false;
  if (rule.matchType === "exact") {
    return parsed.hostname === rule.normalizedHost && port === rule.port;
  }
  if (port !== null) return false;
  const suffix = "." + rule.normalizedHost;
  if (!parsed.hostname.endsWith(suffix)) return false;
  const prefix = parsed.hostname.slice(0, -suffix.length);
  return prefix.length > 0 && !prefix.includes(".");
};
