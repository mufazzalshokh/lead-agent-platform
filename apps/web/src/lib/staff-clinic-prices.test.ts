import { ServicePriceRecordSchema, ServiceRootSchema, isSchemaValue } from "@lead-agent/contracts";
import { describe, expect, it, vi } from "vitest";
import { preparePriceChange, readPriceDraft, writeClinicPrice } from "./staff-clinic-prices";

const serviceId = "0193f1a8-7f65-7c28-a434-a10796c47701";
const priceId = "0193f1a8-7f65-7c28-a434-a10796c47702";
const locationId = "0193f1a8-7f65-7c28-a434-a10796c47703";
const at = "2026-11-21T12:00:00.000Z";
const service = {
  code: "consultation",
  service_id: serviceId,
  version: 7,
  status: "active",
  current_version: {
    description_i18n: { en: "Consultation" },
    disclaimer_i18n: { en: "Duration may vary." },
    name_i18n: { en: "Consultation" },
    duration_guidance_minutes: null,
    service_id: serviceId,
    provenance: {
      content_hash: "ab",
      published_at: at,
      published_by_user_id: locationId,
      record_id: priceId,
      version_no: 1,
    },
  },
};

const fields = (type: string) => {
  const form = new FormData();
  form.set("price_type", type);
  form.set("currency", "uzs");
  form.set("amount", "1200");
  form.set("maximum", "1850");
  form.set("display_en", "Consultation price");
  return form;
};

const draft = () => {
  const body = readPriceDraft(fields("fixed"));
  if (body === null) throw new Error("Invalid price fixture");
  const value = {
    ...body,
    created_at: at,
    effective_from: null,
    effective_to: null,
    status: "draft",
    price_id: priceId,
    service_id: serviceId,
    version_no: 2,
    published_by_user_id: null,
  };
  if (!isSchemaValue(ServicePriceRecordSchema, value)) throw new Error("Invalid record fixture");
  return value;
};

const response = (data: unknown) => Response.json({ data, meta: { request_id: "request-price" } });

describe("staff clinic service prices", () => {
  it("builds each approved price model and keeps quote-required free of amounts", () => {
    const minimum = { currency: "UZS", amount_minor: 1200 };
    expect(readPriceDraft(fields("fixed"))?.pricing).toEqual({
      price_type: "fixed",
      amount: minimum,
    });
    expect(readPriceDraft(fields("from"))?.pricing).toEqual({ price_type: "from", minimum });
    expect(readPriceDraft(fields("range"))?.pricing).toEqual({
      price_type: "range",
      minimum,
      maximum: { currency: "UZS", amount_minor: 1850 },
    });
    expect(readPriceDraft(fields("quote_required"))).toMatchObject({
      location_id: null,
      pricing: { price_type: "quote_required", currency: "UZS" },
    });
    const scoped = fields("fixed");
    scoped.set("location_id", locationId);
    expect(readPriceDraft(scoped)?.location_id).toBe(locationId);
  });

  it("rejects fractional, negative, overflowing and reversed ranges", () => {
    for (const invalid of ["1.5", "1e3", "-1", "9007199254740992"]) {
      const form = fields("fixed");
      form.set("amount", invalid);
      expect(readPriceDraft(form)).toBeNull();
    }
    const range = fields("range");
    range.set("maximum", "1100");
    expect(readPriceDraft(range)).toBeNull();
    const zero = fields("fixed");
    zero.set("amount", "0");
    expect(readPriceDraft(zero)?.pricing).toEqual({
      price_type: "fixed",
      amount: { currency: "UZS", amount_minor: 0 },
    });
  });

  it("uses the current service version for creation and the price version for edits", async () => {
    const body = readPriceDraft(fields("fixed"));
    const current = draft();
    if (body === null || !isSchemaValue(ServiceRootSchema, service))
      throw new Error("Invalid fixture");
    const create = preparePriceChange({ action: "create", service, body }, "create-draft");
    const edit = preparePriceChange({ action: "edit", price: current, body }, "edit-draft");
    if (create === null || edit === null) throw new Error("Expected draft commands");
    const request = vi
      .fn()
      .mockResolvedValueOnce(response(current))
      .mockResolvedValueOnce(response({ ...current, version_no: 3 }));
    expect(await writeClinicPrice(request, create, "csrf-token")).toMatchObject({ kind: "saved" });
    expect(await writeClinicPrice(request, edit, "csrf-token")).toMatchObject({ kind: "saved" });
    expect(request.mock.calls[0]).toMatchObject([
      `/v1/staff/services/${serviceId}/prices`,
      { method: "POST", headers: { "if-match": `"${serviceId}:7"` } },
    ]);
    expect(request.mock.calls[1]).toMatchObject([
      `/v1/staff/prices/${priceId}`,
      { method: "PATCH", headers: { "if-match": `"${priceId}:2"` } },
    ]);
  });

  it("publishes only the saved draft and retries an uncertain request with the same key", async () => {
    const price = draft();
    const command = preparePriceChange({ action: "publish", price, body: {} }, "publish-draft");
    if (command === null) throw new Error("Expected publish command");
    const published = {
      ...price,
      status: "published",
      effective_from: at,
      published_by_user_id: locationId,
    };
    const request = vi
      .fn()
      .mockRejectedValueOnce(new Error("Connection lost"))
      .mockResolvedValueOnce(response(published));
    expect(await writeClinicPrice(request, command, "csrf-token")).toMatchObject({
      kind: "uncertain",
    });
    expect(await writeClinicPrice(request, command, "csrf-token")).toEqual({
      kind: "saved",
      resource: published,
    });
    expect(request).toHaveBeenLastCalledWith(`/v1/staff/prices/${priceId}/publish`, {
      method: "POST",
      body: "{}",
      headers: {
        "content-type": "application/json",
        "x-csrf-token": "csrf-token",
        "idempotency-key": "staff.price.publish-draft",
        "if-match": `"${priceId}:2"`,
      },
    });
    expect(request.mock.calls[0]).toEqual(request.mock.calls[1]);
  });
});
