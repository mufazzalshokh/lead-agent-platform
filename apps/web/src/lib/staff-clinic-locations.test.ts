import { describe, expect, it, vi } from "vitest";
import { LocationRootSchema, isSchemaValue } from "@lead-agent/contracts";
import {
  prepareLocationCommand,
  readLocationCandidate,
  readNewLocation,
  writeClinicLocation,
} from "./staff-clinic-locations";

const id = "0193f1a8-7f65-7c28-a434-a10796c47701";
const unpublished = {
  code: "city-centre",
  current_version: null,
  location_id: id,
  status: "inactive",
  version: 1,
};

const fields = () => {
  const form = new FormData();
  form.set("name_uz", "Shahar markazi");
  form.set("address_uz", "Markaz ko'chasi");
  form.set("time_zone", "Asia/Tashkent");
  form.set("phone", "+998 71 000 00 00");
  return form;
};

const addHours = (form: FormData, day: string, opens: string, closes: string) => {
  form.append("weekday", day);
  form.append("opens", opens);
  form.append("closes", closes);
};

const response = (data: unknown) =>
  Response.json({ data, meta: { request_id: "request-location" } });

describe("staff clinic locations", () => {
  it("builds a complete local profile with ordered split intervals and whole-second precision", () => {
    const form = fields();
    addHours(form, "1", "13:05:10", "18:00");
    addHours(form, "6", "10:00", "14:00");
    addHours(form, "1", "09:00", "12:00");
    expect(readLocationCandidate(form)).toEqual({
      kind: "valid",
      body: {
        name_i18n: { uz: "Shahar markazi" },
        address_i18n: { uz: "Markaz ko'chasi" },
        time_zone: "Asia/Tashkent",
        public_contact: { phone: "+998 71 000 00 00" },
        business_hours: {
          intervals: [
            {
              day_of_week: 1,
              sequence_no: 1,
              opens_at_local: "09:00:00",
              closes_at_local: "12:00:00",
            },
            {
              day_of_week: 1,
              sequence_no: 2,
              opens_at_local: "13:05:10",
              closes_at_local: "18:00:00",
            },
            {
              day_of_week: 6,
              sequence_no: 1,
              opens_at_local: "10:00:00",
              closes_at_local: "14:00:00",
            },
          ],
        },
      },
    });
  });

  it("rejects overlaps, overnight intervals, incomplete rows and invalid time zones", () => {
    const overlap = fields();
    addHours(overlap, "1", "09:30", "13:30");
    addHours(overlap, "1", "12:00", "13:00");
    const overnight = fields();
    addHours(overnight, "3", "23:00", "06:00");
    const incomplete = fields();
    incomplete.append("weekday", "5");
    for (const form of [overlap, overnight, incomplete]) {
      expect(readLocationCandidate(form)).toEqual({ kind: "invalid-hours" });
    }
    const wrongZone = fields();
    wrongZone.set("time_zone", "Asia/UnknownCity");
    expect(readLocationCandidate(wrongZone)).toEqual({ kind: "invalid-profile" });
  });

  it("creates only an inactive location with the chosen code before publication", async () => {
    const form = new FormData();
    form.set("code", "city-centre");
    const create = readNewLocation(form);
    if (create === null) throw new Error("Expected creation command");
    const command = prepareLocationCommand(create, "synthetic-request-location");
    const request = vi
      .fn()
      .mockResolvedValueOnce(response({ ...unpublished, code: "another-clinic" }));
    request.mockResolvedValueOnce(response(unpublished));
    expect(await writeClinicLocation(request, command, "csrf-token")).toMatchObject({
      kind: "uncertain",
    });
    expect(await writeClinicLocation(request, command, "csrf-token")).toMatchObject({
      kind: "saved",
      resource: unpublished,
    });
    expect(request).toHaveBeenLastCalledWith("/v1/staff/locations", {
      method: "POST",
      body: '{"code":"city-centre"}',
      headers: {
        "content-type": "application/json",
        "x-csrf-token": "csrf-token",
        "idempotency-key": "staff.location.synthetic-request-location",
      },
    });
    expect(request.mock.calls[0]).toEqual(request.mock.calls[1]);
  });

  it("publishes through a distinct versioned command and asks for refresh after conflict", async () => {
    const candidate = readLocationCandidate(fields());
    if (candidate.kind !== "valid" || !isSchemaValue(LocationRootSchema, unpublished)) {
      throw new Error("Expected valid location and candidate");
    }
    const command = prepareLocationCommand(
      { action: "publish", target: unpublished, body: candidate.body },
      "synthetic-request-publish",
    );
    const request = vi.fn().mockResolvedValue(new Response(null, { status: 409 }));
    expect(await writeClinicLocation(request, command, "csrf-token")).toMatchObject({
      kind: "stale",
    });
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith(`/v1/staff/locations/${id}/publish`, {
      method: "POST",
      body: JSON.stringify(candidate.body),
      headers: {
        "content-type": "application/json",
        "x-csrf-token": "csrf-token",
        "idempotency-key": "staff.location.synthetic-request-publish",
        "if-match": `"${id}:1"`,
      },
    });
    const published = {
      ...unpublished,
      current_version: {
        ...candidate.body,
        location_id: id,
        provenance: {
          content_hash: "ab",
          published_at: "2026-11-20T12:00:00.000Z",
          published_by_user_id: "0193f1a8-7f65-7c28-a434-a10796c47702",
          record_id: "0193f1a8-7f65-7c28-a434-a10796c47703",
          version_no: 1,
        },
      },
      status: "active",
      version: 2,
    };
    request.mockResolvedValueOnce(response(published));
    expect(await writeClinicLocation(request, command, "csrf-token")).toEqual({
      kind: "saved",
      resource: published,
    });
  });
});
