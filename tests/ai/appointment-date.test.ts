import { describe, expect, it } from "vitest";
import {
  appointmentDateMentioned,
  parseAppointmentDate,
} from "../../packages/application/src/ai/appointment-time.js";

const receivedAt = "2026-10-11T17:49:00.000Z";
const zone = "Asia/Tashkent";

describe("customer-authored named appointment dates", () => {
  it.each([
    "12-oktabr kuni soat 17:00 ga yozilmoqchiman",
    "12 oktabr 2026",
    "12 октябр 2026",
    "12 октября 2026",
    "12 October 2026",
    "October 12, 2026",
    "12-oktyabr 2026",
    "12 ОКТЯБРЯ 2026",
    "October 12 at 17:00",
  ])("recognizes %s", (text) => {
    expect(parseAppointmentDate(text, receivedAt, zone)).toBe("2026-10-12");
  });

  it.each([
    ["yanvar", "января", "January"],
    ["fevral", "февраля", "February"],
    ["mart", "марта", "March"],
    ["aprel", "апреля", "April"],
    ["may", "мая", "May"],
    ["iyun", "июня", "June"],
    ["iyul", "июля", "July"],
    ["avgust", "августа", "August"],
    ["sentabr", "сентября", "September"],
    ["oktabr", "октября", "October"],
    ["noyabr", "ноября", "November"],
    ["dekabr", "декабря", "December"],
  ])("shares date rules across month names %s / %s / %s", (uz, ru, en) => {
    const month =
      [
        "yanvar",
        "fevral",
        "mart",
        "aprel",
        "may",
        "iyun",
        "iyul",
        "avgust",
        "sentabr",
        "oktabr",
        "noyabr",
        "dekabr",
      ].indexOf(uz) + 1;
    for (const name of [uz, ru, en])
      expect(parseAppointmentDate(`12 ${name} 2027`, receivedAt, zone)).toBe(
        `2027-${String(month).padStart(2, "0")}-12`,
      );
  });

  it.each([
    "31-fevral 2026",
    "31-aprel 2026",
    "29-fevral 2026",
    "0-oktabr",
    "32-oktabr",
    "12-oktabr yoki 13-oktabr",
    "12-oktabr yoki ertaga",
    "12-oktabr or 2026-10-13",
    "12-13 oktabr",
    "12 yoki 13 oktabr",
    "October 12 or 13",
    "12-oktabr 20267",
    "12-oktabr 999",
    "2027 yil 12-oktabr",
    "12 октября 2027г",
    "112 October",
    "October or tomorrow",
    "12th October",
  ])("clarifies invalid or competing preferences: %s", (text) => {
    expect(parseAppointmentDate(text, receivedAt, zone)).toBeNull();
  });

  it("validates a leap day without relying on Date rollover", () => {
    expect(parseAppointmentDate("29-fevral 2028", receivedAt, zone)).toBe("2028-02-29");
  });

  it("does not mistake the English modal may for a customer date", () => {
    expect(parseAppointmentDate("I may come at 17:00", receivedAt, zone)).toBeNull();
    expect(appointmentDateMentioned("I may come at 17:00")).toBe(false);
    expect(parseAppointmentDate("May I book tomorrow at 17:00?", receivedAt, zone)).toBe(
      "2026-10-12",
    );
    expect(parseAppointmentDate("12 May book at 17:00", receivedAt, zone)).toBe("2026-05-12");
  });

  it.each(["oktabr", "October", "May", "12th October"])(
    "a named month without a supported day cannot reuse an older date: %s",
    (text) => {
      expect(appointmentDateMentioned(text)).toBe(true);
      expect(parseAppointmentDate(text, receivedAt, zone)).toBeNull();
    },
  );

  it("anchors an omitted year to receipt in the location timezone, not processing or next occurrence", () => {
    expect(parseAppointmentDate("1-yanvar", "2026-12-31T20:00:00Z", zone)).toBe("2027-01-01");
    expect(parseAppointmentDate("1-yanvar", "2026-12-31T20:00:00Z", "UTC")).toBe("2026-01-01");
    expect(parseAppointmentDate("10-oktabr", receivedAt, zone)).toBe("2026-10-10");
  });
});
