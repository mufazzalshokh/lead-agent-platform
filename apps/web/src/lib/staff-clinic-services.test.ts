import { LocationIdSchema, ServiceRootSchema, isSchemaValue } from "@lead-agent/contracts";
import { describe, expect, it, vi } from "vitest";
import {
  prepareServiceChange,
  readNewService,
  readServiceCandidate,
  readServiceOffering,
  serviceOfferingChange,
  writeClinicService,
} from "./staff-clinic-services";

const serviceId = "0193f1a8-7f65-7c28-a434-a10796c47701";
const locationId = "0193f1a8-7f65-7c28-a434-a10796c47702";
const time = "2026-11-21T10:00:00.000Z";
const inactive = {
  code: "consultation",
  current_version: null,
  service_id: serviceId,
  status: "inactive",
  version: 1,
};
const fields = () => {
  const form = new FormData();
  form.set("name_uz", "Maslahat");
  form.set("description_uz", "Klinikada dastlabki maslahat.");
  form.set("disclaimer_uz", "Qabul vaqtini klinika tasdiqlaydi.");
  form.set("duration", "30");
  return form;
};
const target = () => {
  if (!isSchemaValue(ServiceRootSchema, inactive)) throw new Error("Invalid service fixture");
  return inactive;
};
const location = () => {
  if (!isSchemaValue(LocationIdSchema, locationId)) throw new Error("Invalid location fixture");
  return locationId;
};
const response = (data: unknown) =>
  Response.json({ data, meta: { request_id: "request-service" } });
const activeService = () => {
  const body = readServiceCandidate(fields());
  if (body === null) throw new Error("Invalid candidate fixture");
  const row = {
    ...target(),
    status: "active",
    version: 2,
    current_version: {
      ...body,
      service_id: serviceId,
      provenance: {
        content_hash: "ab",
        published_at: time,
        published_by_user_id: locationId,
        record_id: "0193f1a8-7f65-7c28-a434-a10796c47703",
        version_no: 1,
      },
    },
  };
  if (!isSchemaValue(ServiceRootSchema, row)) throw new Error("Invalid published service fixture");
  return row;
};

describe("staff clinic services", () => {
  it("collects translated facts and accepts only optional whole minutes", () => {
    const form = fields();
    expect(readServiceCandidate(form)).toEqual({
      name_i18n: { uz: "Maslahat" },
      description_i18n: { uz: "Klinikada dastlabki maslahat." },
      disclaimer_i18n: { uz: "Qabul vaqtini klinika tasdiqlaydi." },
      duration_guidance_minutes: 30,
    });
    form.delete("duration");
    expect(readServiceCandidate(form)).toMatchObject({ duration_guidance_minutes: null });
    for (const invalid of ["1.5", "1e3", "10081", "0"]) {
      form.set("duration", invalid);
      expect(readServiceCandidate(form)).toBeNull();
    }
  });

  it("creates only an inactive root and publishes through a distinct versioned command", async () => {
    const code = new FormData();
    code.set("code", "consultation");
    const create = readNewService(code);
    const publish = readServiceCandidate(fields());
    if (create === null || publish === null) throw new Error("Invalid command fixture");
    const active = activeService();
    const request = vi
      .fn()
      .mockResolvedValueOnce(response(target()))
      .mockResolvedValueOnce(response(active));
    const save = (command: Parameters<typeof prepareServiceChange>[0]) =>
      writeClinicService(request, prepareServiceChange(command, "synthetic-request"), "csrf-token");
    expect(await save({ action: "create", body: create })).toMatchObject({
      kind: "saved",
      resource: { service: inactive },
    });
    expect(new Headers(request.mock.calls[0]?.[1]?.headers).get("if-match")).toBeNull();
    expect(await save({ action: "publish", target: target(), body: publish })).toMatchObject({
      kind: "saved",
      resource: { service: active },
    });
    expect(request.mock.calls[1]).toMatchObject([
      `/v1/staff/services/${serviceId}/publish`,
      { method: "POST", headers: { "if-match": `"${serviceId}:1"` } },
    ]);
  });

  it("checks the active offering through the authorized location filter and all pages", async () => {
    const request = vi.fn().mockResolvedValueOnce(
      Response.json({
        data: [],
        meta: { request_id: "request-service", has_more: true, next_cursor: "cGFnZQ" },
      }),
    );
    request.mockResolvedValueOnce(
      Response.json({
        data: [activeService()],
        meta: { request_id: "request-service", has_more: false },
      }),
    );
    expect(await readServiceOffering(request, target().service_id, location())).toBe(true);
    expect(request).toHaveBeenNthCalledWith(
      2,
      `/v1/staff/services?status=active&location_id=${locationId}&cursor=cGFnZQ`,
    );
  });

  it("reuses the same conditional offering request after an uncertain save", async () => {
    const body = serviceOfferingChange(location(), true);
    if (body === null) throw new Error("Invalid offering fixture");
    const service = activeService();
    const command = prepareServiceChange(
      { action: "locations", target: service, body },
      "synthetic-offering",
    );
    const relation = {
      service_id: serviceId,
      location_id: locationId,
      status: "inactive",
      effective_from: time,
      effective_to: "2026-11-21T11:00:00.000Z",
    };
    const request = vi
      .fn()
      .mockRejectedValueOnce(new Error("Connection lost"))
      .mockResolvedValueOnce(response(relation));
    expect(await writeClinicService(request, command, "csrf-token")).toMatchObject({
      kind: "uncertain",
    });
    expect(await writeClinicService(request, command, "csrf-token")).toEqual({
      kind: "saved",
      resource: { kind: "offering", relation },
    });
    expect(request).toHaveBeenLastCalledWith(`/v1/staff/services/${serviceId}/locations`, {
      method: "PUT",
      body: JSON.stringify(body),
      headers: {
        "content-type": "application/json",
        "x-csrf-token": "csrf-token",
        "idempotency-key": "staff.service.synthetic-offering",
        "if-match": `"${serviceId}:2"`,
      },
    });
    expect(request.mock.calls[0]).toEqual(request.mock.calls[1]);
  });
});
