import type { PublishedBusinessKnowledgeV2 } from "@lead-agent/contracts";
import { normalizeGroundingQuery } from "./grounding-query.js";

type Location = PublishedBusinessKnowledgeV2["locations"][number];
export type ParsedAppointmentTime = Readonly<{
  localDate: string;
  localStart: string;
  localEnd: string;
  startAt: string;
  endAt: string;
  approximate: boolean;
}>;
const DAY = 86_400_000;
const parts = (instant: number, zone: string): string => {
  const values = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(instant));
  const value = (name: Intl.DateTimeFormatPartTypes): string =>
    values.find((part) => part.type === name)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}T${value("hour")}:${value("minute")}:${value("second")}`;
};
export const localAppointmentDate = (instant: string, zone: string): string =>
  parts(Date.parse(instant), zone).slice(0, 10);
const validDate = (date: string): boolean => {
  const instant = Date.parse(`${date}T00:00:00Z`);
  return Number.isFinite(instant) && new Date(instant).toISOString().slice(0, 10) === date;
};
export const parseAppointmentDate = (
  text: string,
  receivedAt: string,
  zone: string,
): string | null => {
  const query = normalizeGroundingQuery(text);
  const absolute = [
    ...text.normalize("NFKC").matchAll(/\b(\d{4}-\d{2}-\d{2}|\d{2}-\d{2}-\d{4})\b/gu),
  ];
  const relative = [
    ...query.matchAll(
      /\b(bugun|ertaga|indin|segodnya|zavtra|poslezavtra|today|tomorrow|day after tomorrow)\b/gu,
    ),
  ];
  // Competing dates are a clarification, never a guessed selection.
  if (absolute.length + relative.length !== 1) return null;
  const raw = absolute[0]?.[1];
  if (raw !== undefined) {
    const date = /^\d{4}-/u.test(raw)
      ? raw
      : `${raw.slice(6)}-${raw.slice(3, 5)}-${raw.slice(0, 2)}`;
    return validDate(date) ? date : null;
  }
  const word = relative[0]?.[1];
  if (word === undefined) return null;
  const offset = ["indin", "poslezavtra", "day after tomorrow"].includes(word)
    ? 2
    : ["ertaga", "zavtra", "tomorrow"].includes(word)
      ? 1
      : 0;
  const date = localAppointmentDate(receivedAt, zone);
  return new Date(Date.parse(`${date}T00:00:00Z`) + offset * DAY).toISOString().slice(0, 10);
};
/** DST gaps/overlaps fail closed; do not select an arbitrary offset. */
export const appointmentLocalInstant = (local: string, zone: string): number | null => {
  const target = Date.parse(`${local}Z`);
  if (!Number.isFinite(target)) return null;
  const candidates = new Set<number>();
  for (const sample of [target - 36 * 3_600_000, target, target + 36 * 3_600_000]) {
    const offset = Date.parse(`${parts(sample, zone)}Z`) - sample;
    const candidate = target - offset;
    if (parts(candidate, zone) === local) candidates.add(candidate);
  }
  return candidates.size === 1 ? ([...candidates][0] ?? null) : null;
};
export const appointmentHours = (
  location: Location,
  date: string,
): readonly Readonly<{ start: string; end: string }>[] => {
  const closure = location.closures.find((entry) => entry.local_date === date);
  if (closure?.kind === "closed") return [];
  if (closure?.kind === "override")
    return [{ start: closure.opens_at_local, end: closure.closes_at_local }];
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay() || 7;
  return location.business_hours
    .filter((entry) => entry.day_of_week === weekday)
    .map((entry) => ({ start: entry.opens_at_local, end: entry.closes_at_local }));
};
export const appointmentTimeMentioned = (text: string): boolean =>
  /\b(?:\d{1,2}:\d{2}|(?:soat|at|around|v)\s*\d{1,2}|\d{1,2}\s*(?:da|larda|am|pm)|ertalab|kechqurun|kechroq|utrom|vecherom|morning|evening)\b/u.test(
    normalizeGroundingQuery(text),
  );
export const resolveAppointmentTime = (
  text: string,
  date: string,
  location: Location,
  duration: number,
  now: string,
): Readonly<{
  value: ParsedAppointmentTime | null;
  reason: "ambiguous_time" | "outside_hours" | "past_time";
}> => {
  const query = normalizeGroundingQuery(text);
  const matches = [
    ...query.matchAll(
      /\b(?:(?:soat|at|around|v)\s*(\d{1,2})(?::(\d{2}))?(?:\s*(da|larda|am|pm))?|(\d{1,2}):(\d{2})(?:\s*(am|pm))?|(\d{1,2})\s*(da|larda|am|pm))\b/gu,
    ),
  ];
  if (matches.length !== 1) return { value: null, reason: "ambiguous_time" };
  const match = matches[0];
  if (match === undefined) return { value: null, reason: "ambiguous_time" };
  const hour = Number(match[1] ?? match[4] ?? match[7]);
  const minute = Number(match[2] ?? match[5] ?? 0),
    period = match[3] ?? match[6] ?? match[8];
  if (hour > 23 || minute > 59 || ((period === "am" || period === "pm") && (hour < 1 || hour > 12)))
    return { value: null, reason: "ambiguous_time" };
  const hours =
    period === "am"
      ? [hour % 12]
      : period === "pm"
        ? [(hour % 12) + 12]
        : match[2] !== undefined || match[5] !== undefined || hour === 0 || hour > 12
          ? [hour]
          : [hour % 12, (hour % 12) + 12];
  const morning = /\b(ertalab|utrom|morning)\b/u.test(query);
  const evening = /\b(kechqurun|vecherom|evening|afternoon)\b/u.test(query);
  if (morning && evening) return { value: null, reason: "ambiguous_time" };
  const values: ParsedAppointmentTime[] = [];
  let past = false;
  let interpretations = 0;
  const seconds = (time: string): number =>
    Number(time.slice(0, 2)) * 3600 + Number(time.slice(3, 5)) * 60 + Number(time.slice(6, 8) || 0);
  for (const candidate of hours) {
    if ((morning && candidate >= 12) || (evening && candidate < 12)) continue;
    const startMinute = candidate * 60 + minute,
      endMinute = startMinute + duration;
    const hhmm = (value: number): string =>
      `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
    const startTime = hhmm(startMinute),
      endTime = hhmm(endMinute);
    if (
      endMinute >= 1440 ||
      !appointmentHours(location, date).some(
        (window) =>
          startMinute * 60 >= seconds(window.start) && endMinute * 60 <= seconds(window.end),
      )
    )
      continue;
    const localStart = `${date}T${startTime}:00`,
      localEnd = `${date}T${endTime}:00`;
    const start = appointmentLocalInstant(localStart, location.time_zone),
      end = appointmentLocalInstant(localEnd, location.time_zone);
    if (start === null || end === null || end <= start) continue;
    interpretations++;
    if (start <= Date.parse(now)) {
      past = true;
      continue;
    }
    values.push({
      localDate: date,
      localStart,
      localEnd,
      startAt: new Date(start).toISOString(),
      endAt: new Date(end).toISOString(),
      approximate: /\b(around|\d{1,2}larda)\b/u.test(query),
    });
  }
  return {
    value: interpretations === 1 && values.length === 1 ? (values[0] ?? null) : null,
    reason: interpretations > 1 ? "ambiguous_time" : past ? "past_time" : "outside_hours",
  };
};
