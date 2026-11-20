import { describe, expect, it, vi } from "vitest";
import { StaffOutcomeSchema, isSchemaValue } from "@lead-agent/contracts";
import {
  loadAppointmentOutcomes,
  netRevenueByCurrency,
  readAttendance,
  readRevenue,
  readRevenueReversal,
  revenuePath,
  reversibleRevenue,
} from "./staff-appointment-outcomes";

const appointmentId = "0194a1c0-0000-7000-8000-000000000001";
const chargeId = "0194a1c0-0000-7000-8000-000000000002";
const adjustmentId = "0194a1c0-0000-7000-8000-000000000003";
const reversalId = "0194a1c0-0000-7000-8000-000000000004";
const recordedAt = "2026-10-04T10:00:00.000Z";

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
};

const row = (id: string, fields: Record<string, unknown> = {}) => {
  const value = {
    id,
    appointment_request_id: appointmentId,
    kind: "revenue",
    recorded_at: recordedAt,
    recorded_by_membership_id: "0194a1c0-0000-7000-8000-000000000007",
    outcome: null,
    amount_minor: Number.MAX_SAFE_INTEGER,
    currency: "UZS",
    entry_type: "charge",
    is_current: null,
    supersedes_id: null,
    reason_code: null,
    ...fields,
  };
  if (!isSchemaValue(StaffOutcomeSchema, value)) throw new Error("Invalid outcome fixture");
  return value;
};

const page = (data: unknown[], cursor?: string) =>
  Response.json({
    data,
    meta: {
      request_id: "test-outcomes",
      has_more: cursor !== undefined,
      ...(cursor === undefined ? {} : { next_cursor: cursor }),
    },
  });

describe("staff appointment outcomes", () => {
  it("uses the current attendance identity and a reason when correcting a no-show", () => {
    const correction = form({ outcome: "did_not_attend" });
    expect(readAttendance(correction)).toEqual({ outcome: "did_not_attend" });
    expect(readAttendance(correction, chargeId)).toBeNull();
    correction.set("reason_code", "data_entry_error");
    correction.set("occurred_at", "2026-10-04T10:00");
    expect(readAttendance(correction, chargeId)).toEqual({
      outcome: "did_not_attend",
      supersedes_attendance_id: chargeId,
      reason_code: "data_entry_error",
      occurred_at: recordedAt,
    });
  });

  it("encodes revenue with exact integer minor units and explicit UTC recognition", () => {
    const entry = form({
      entry_type: "adjustment",
      amount_minor: "9007199254740991",
      currency: "uzs",
      category_code: "consultation",
      recognized_at: "2026-10-04T10:00",
    });
    expect(readRevenue(entry)).toEqual({
      entry_type: "adjustment",
      amount_minor: Number.MAX_SAFE_INTEGER,
      currency: "UZS",
      category_code: "consultation",
      recognized_at: recordedAt,
    });
    for (const invalid of ["1.5", "1e3", "0", "9007199254740992"]) {
      entry.set("amount_minor", invalid);
      expect(readRevenue(entry)).toBeNull();
    }
    entry.set("amount_minor", "100");
    entry.set("recognized_at", "2026-02-30T10:00");
    expect(readRevenue(entry)).toBeNull();
  });

  it("limits reversals to unreversed entries and reconciles exact totals by currency", () => {
    const charge = row(chargeId);
    const adjustment = row(adjustmentId, { entry_type: "adjustment" });
    const secondCurrency = row("0194a1c0-0000-7000-8000-000000000005", {
      currency: "USD",
      amount_minor: 17,
    });
    const history = [charge, adjustment, secondCurrency];
    expect([...netRevenueByCurrency(history)]).toEqual([
      ["UZS", 18014398509481982n],
      ["USD", 17n],
    ]);
    const input = form({ reverses_attribution_id: chargeId, reason_code: "duplicate_entry" });
    expect(readRevenueReversal(input, history)).toEqual({
      entry_type: "reversal",
      reverses_attribution_id: chargeId,
      reason_code: "duplicate_entry",
    });
    history.push(row(reversalId, { entry_type: "reversal", supersedes_id: chargeId }));
    expect([...netRevenueByCurrency(history)]).toEqual([
      ["UZS", 9007199254740991n],
      ["USD", 17n],
    ]);
    expect(reversibleRevenue(history)).toEqual([adjustment, secondCurrency]);
    expect(readRevenueReversal(input, history)).toBeNull();
    input.set("reverses_attribution_id", reversalId);
    expect(readRevenueReversal(input, history)).toBeNull();
  });

  it("reads all history pages and rejects an outcome from a different appointment", async () => {
    const request = vi.fn().mockResolvedValueOnce(page([row(chargeId)], "cGFnZQ"));
    request.mockResolvedValueOnce(page([row(adjustmentId)]));
    expect(await loadAppointmentOutcomes(request, appointmentId, "revenue")).toHaveLength(2);
    expect(request).toHaveBeenNthCalledWith(2, `${revenuePath(appointmentId)}?cursor=cGFnZQ`);
    request.mockResolvedValueOnce(page([row(chargeId, { appointment_request_id: adjustmentId })]));
    await expect(loadAppointmentOutcomes(request, appointmentId, "revenue")).rejects.toThrow(
      "Inconsistent outcome history",
    );
  });
});
