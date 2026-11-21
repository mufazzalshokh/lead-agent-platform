import {
  LocationClosureRecordSchema,
  LocationIdSchema,
  LocationRootSchema,
  isSchemaValue,
} from "@lead-agent/contracts";
import { describe, expect, it, vi } from "vitest";
import {
  prepareClosure,
  readLocationClosure,
  writeLocationClosure,
} from "./staff-location-closures";

const id = "0193f1a8-7f65-7c28-a434-a10796c47701";
const exceptionId = "0193f1a8-7f65-7c28-a434-a10796c47702";
const actor = "0193f1a8-7f65-7c28-a434-a10796c47703";
const at = "2026-11-22T10:00:00.000Z";

const form = () => {
  const fields = new FormData();
  fields.set("kind", "override");
  fields.set("local_date", "2027-01-01");
  fields.set("reason_en", "Holiday hours");
  fields.set("opens_at_local", "10:00");
  fields.set("closes_at_local", "14:30");
  return fields;
};

const fixture = () => {
  const body = readLocationClosure(form());
  const target = {
    code: "city-centre",
    location_id: id,
    status: "active",
    version: 7,
    current_version: {
      location_id: id,
      name_i18n: { en: "City centre" },
      address_i18n: { en: "Clinic street" },
      business_hours: { intervals: [] },
      time_zone: "Asia/Tashkent",
      public_contact: {},
      provenance: {
        content_hash: "ab",
        published_at: at,
        published_by_user_id: actor,
        record_id: exceptionId,
        version_no: 2,
      },
    },
  };
  const record = {
    closure_id: exceptionId,
    location_id: id,
    status: "active",
    supersedes_id: null,
    details: body,
    created_at: at,
    created_by_user_id: actor,
  };
  if (
    body === null ||
    !isSchemaValue(LocationRootSchema, target) ||
    !isSchemaValue(LocationClosureRecordSchema, record)
  )
    throw new Error("Invalid fixture");
  return { target, body, record };
};

describe("staff location closures", () => {
  it("validates one local calendar date and preserves local opening times", () => {
    const fields = form();
    expect(readLocationClosure(fields)).toEqual({
      kind: "override",
      local_date: "2027-01-01",
      reason_i18n: { en: "Holiday hours" },
      opens_at_local: "10:00:00",
      closes_at_local: "14:30:00",
    });
    fields.set("closes_at_local", "09:00");
    expect(readLocationClosure(fields)).toBeNull();
    fields.set("kind", "closed");
    expect(readLocationClosure(fields)).toEqual({
      kind: "closed",
      local_date: "2027-01-01",
      reason_i18n: { en: "Holiday hours" },
    });
    fields.set("local_date", "2027-02-30");
    expect(readLocationClosure(fields)).toBeNull();
  });

  it("limits corrections and cancellation to a confirmed record for this location and date", () => {
    const { target, body, record } = fixture();
    if (!isSchemaValue(LocationIdSchema, actor)) throw new Error("Invalid other location fixture");
    expect(
      prepareClosure(target, { action: "supersede", previous: record, body }, "correct-closure")
        ?.path,
    ).toBe(`/v1/staff/locations/${id}/closures/${exceptionId}/supersede`);
    expect(
      prepareClosure(
        target,
        { action: "supersede", previous: record, body: { ...body, local_date: "2027-01-02" } },
        "correct-closure",
      ),
    ).toBeNull();
    expect(
      prepareClosure(
        target,
        { action: "cancel", previous: { ...record, location_id: actor } },
        "cancel-closure",
      ),
    ).toBeNull();
    expect(
      prepareClosure(target, { action: "cancel", previous: record }, "cancel-closure")?.body,
    ).toBe("{}");
  });

  it("uses the selected location version and rejects a receipt from another location", async () => {
    const { target, body, record } = fixture();
    const command = prepareClosure(target, { action: "create", body }, "create-closure");
    if (command === null) throw new Error("Expected closure command");
    const response = (data: unknown) =>
      Response.json({ data, meta: { request_id: "request-closure" } });
    const request = vi
      .fn()
      .mockResolvedValueOnce(response({ ...record, location_id: actor }))
      .mockResolvedValueOnce(response(record));
    expect(await writeLocationClosure(request, command, "csrf-token")).toMatchObject({
      kind: "uncertain",
    });
    expect(await writeLocationClosure(request, command, "csrf-token")).toEqual({
      kind: "saved",
      resource: record,
    });
    expect(request).toHaveBeenLastCalledWith(
      `/v1/staff/locations/${id}/closures`,
      expect.objectContaining({
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-csrf-token": "csrf-token",
          "idempotency-key": "staff.closure.create-closure",
          "if-match": `"${id}:7"`,
        },
      }),
    );
    expect(request.mock.calls[0]).toEqual(request.mock.calls[1]);
  });
});
