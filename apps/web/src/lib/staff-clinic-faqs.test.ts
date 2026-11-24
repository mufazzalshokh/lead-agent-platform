import { describe, expect, it, vi } from "vitest";
import { FaqSchema, isSchemaValue } from "@lead-agent/contracts";
import {
  faqPublication,
  listClinicFaqs,
  prepareFaqCommand,
  readFaqDraft,
  writeClinicFaq,
} from "./staff-clinic-faqs";

const faqId = "0193f1a8-7f65-7c28-a434-a10796c47709";
const locationId = "0193f1a8-7f65-7c28-a434-a10796c47701";
const at = "2026-11-20T12:00:00.000Z";
const draft = {
  answer_i18n: { en: "Parking is beside the clinic." },
  content_hash: "ab",
  created_at: at,
  effective_from: null,
  effective_to: null,
  faq_id: faqId,
  faq_key: "parking",
  location_id: locationId,
  published_by_user_id: null,
  question_i18n: { en: "Is there parking?" },
  service_id: null,
  status: "draft",
  version_no: 3,
};

const requireFaq = (value: unknown) => {
  if (!isSchemaValue(FaqSchema, value)) throw new Error("Invalid FAQ fixture");
  return value;
};

const published = requireFaq({
  ...draft,
  effective_from: at,
  status: "published",
  published_by_user_id: "0193f1a8-7f65-7c28-a434-a10796c47711",
});

const form = () => {
  const values = new FormData();
  values.set("faq_key", "parking");
  values.set("question_en", "Is there parking?");
  values.set("answer_en", " Parking is beside the clinic. ");
  values.set("location_id", locationId);
  return values;
};

describe("staff clinic FAQs", () => {
  it("keeps creation and editing as scoped draft commands with complete translation pairs", () => {
    const values = form();
    expect(readFaqDraft(values, null)).toMatchObject({
      method: "POST",
      path: "/v1/staff/faqs",
      body: {
        faq_key: "parking",
        location_id: locationId,
        service_id: null,
        question_i18n: { en: "Is there parking?" },
        answer_i18n: { en: "Parking is beside the clinic." },
      },
    });
    values.set("question_uz", "Avtoturargoh bormi?");
    expect(readFaqDraft(values, null)).toBeNull();
    values.set("answer_uz", "Avtoturargoh klinika yonida.");
    expect(readFaqDraft(values, requireFaq(draft))).toMatchObject({
      method: "PATCH",
      path: `/v1/staff/faqs/${faqId}`,
      body: { answer_i18n: { uz: "Avtoturargoh klinika yonida." } },
    });
    expect(readFaqDraft(values, requireFaq(draft))?.body).not.toHaveProperty("faq_key");
    expect(readFaqDraft(values, published)).toBeNull();
    expect(faqPublication(published, "publish")).toBeNull();
  });

  it("publishes the saved draft version and replays the same conditional command after ambiguity", async () => {
    const publish = faqPublication(requireFaq(draft), "publish");
    if (publish === null) throw new Error("Expected publication command");
    const command = prepareFaqCommand(publish, "synthetic-request-1");
    const request = vi.fn().mockRejectedValueOnce(new Error("Connection lost"));
    request.mockResolvedValueOnce(
      Response.json({ data: published, meta: { request_id: "test-request" } }),
    );
    expect(await writeClinicFaq(request, command, null)).toMatchObject({ kind: "rejected" });
    expect(request).not.toHaveBeenCalled();
    expect(await writeClinicFaq(request, command, "csrf-token")).toMatchObject({
      kind: "uncertain",
    });
    expect(await writeClinicFaq(request, command, "csrf-token")).toEqual({
      kind: "saved",
      faq: published,
    });
    expect(request).toHaveBeenCalledWith(`/v1/staff/faqs/${faqId}/publish`, {
      method: "POST",
      body: "{}",
      headers: {
        "content-type": "application/json",
        "x-csrf-token": "csrf-token",
        "if-match": `"${faqId}:3"`,
        "idempotency-key": "staff.faq.synthetic-request-1",
      },
    });
    expect(request.mock.calls[1]).toEqual(request.mock.calls[0]);
  });

  it("requires refresh on conflict and rejects a response for a different FAQ", async () => {
    const patch = readFaqDraft(form(), requireFaq(draft));
    if (patch === null) throw new Error("Expected draft command");
    const command = prepareFaqCommand(patch, "synthetic-request-2");
    const request = vi.fn().mockResolvedValueOnce(new Response(null, { status: 409 }));
    expect(await writeClinicFaq(request, command, "csrf-token")).toMatchObject({ kind: "stale" });
    expect(request).toHaveBeenCalledTimes(1);
    request.mockResolvedValueOnce(
      Response.json({
        data: { ...draft, faq_id: locationId },
        meta: { request_id: "test-request" },
      }),
    );
    expect(await writeClinicFaq(request, command, "csrf-token")).toMatchObject({
      kind: "uncertain",
    });
  });

  it("uses the FAQ collection cursor and refuses unvalidated list data", async () => {
    const request = vi.fn().mockResolvedValueOnce(
      Response.json({
        data: [draft],
        meta: { request_id: "test-request", has_more: false, next_cursor: null },
      }),
    );
    expect((await listClinicFaqs(request, "bW9yZQ")).data).toEqual([draft]);
    expect(request).toHaveBeenCalledWith("/v1/staff/faqs?cursor=bW9yZQ");
    request.mockResolvedValueOnce(
      Response.json({
        data: [{ ...draft, status: "active" }],
        meta: { request_id: "test-request", has_more: false },
      }),
    );
    await expect(listClinicFaqs(request)).rejects.toThrow("Invalid configuration response");
  });
});
