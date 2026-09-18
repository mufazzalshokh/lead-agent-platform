import {
  PublishedBusinessKnowledgeV2Schema,
  isSchemaValue,
  type PublishedBusinessKnowledgeV2,
} from "../../packages/contracts/src/index.js";
import { fixtureId } from "./fixtures.js";

export const groundingId = (offset: number): string => fixtureId(30_000 + offset);
export const GROUNDING_NOW = "2026-09-18T08:00:00.000Z";
export const groundingKnowledge = (): PublishedBusinessKnowledgeV2 => {
  const i18n = (uz: string, ru: string, en: string) => ({ uz, ru, en });
  const provenance = (id: number) => ({
    record_id: groundingId(id),
    version_no: 1,
    content_hash: "ab".repeat(32),
    published_at: GROUNDING_NOW,
    published_by_user_id: groundingId(1),
  });
  const location = {
    location_id: groundingId(2),
    code: "central",
    root_version: 2,
    name_i18n: i18n("Markaziy klinika", "Центральная клиника", "Central clinic"),
    address_i18n: i18n(
      "Toshkent, Markaz ko'chasi 1",
      "Ташкент, улица Марказ 1",
      "Tashkent, Markaz street 1",
    ),
    provenance: provenance(3),
    time_zone: "Asia/Tashkent",
    public_contact: { phone: "+998901234567" },
    closures: [],
    business_hours: Array.from({ length: 6 }, (_, index) => ({
      day_of_week: index + 1,
      opens_at_local: "09:00:00",
      closes_at_local: "18:00:00",
      sequence_no: 1,
    })),
  };
  const service = (
    base: number,
    code: string,
    name: { uz: string; ru: string; en: string },
    amount: number,
  ) => ({
    service_id: groundingId(base),
    code,
    root_version: 2,
    name_i18n: name,
    description_i18n: i18n(
      "Tasdiqlangan xizmat tavsifi.",
      "Утверждённое описание услуги.",
      "Approved service description.",
    ),
    disclaimer_i18n: i18n(
      "Natija kafolatlanmaydi.",
      "Результат не гарантирован.",
      "Results are not guaranteed.",
    ),
    duration_guidance_minutes: 30,
    provenance: provenance(base + 1),
    location_offerings: [
      { location_id: location.location_id, effective_from: GROUNDING_NOW, effective_to: null },
    ],
    price_resolutions: [
      {
        location_id: location.location_id,
        prices: [
          {
            price_id: groundingId(base + 2),
            version_no: 1,
            location_id: null,
            pricing: { price_type: "fixed", amount: { amount_minor: amount, currency: "UZS" } },
            display_text_i18n: i18n("Bir seans uchun.", "За один сеанс.", "Per session."),
            effective_from: GROUNDING_NOW,
            effective_to: null,
            published_by_user_id: groundingId(1),
          },
        ],
      },
    ],
  });
  const candidate: unknown = {
    effective_at: GROUNDING_NOW,
    locale: "uz",
    locations: [location],
    policies: [],
    services: [
      service(10, "laser", i18n("Lazer", "Лазер", "Laser"), 25_000_000),
      service(
        20,
        "consultation",
        i18n("Konsultatsiya", "Консультация", "Consultation"),
        10_000_000,
      ),
    ],
    faqs: [
      {
        faq_id: groundingId(30),
        faq_key: "sunday_hours",
        version_no: 1,
        content_hash: "cd".repeat(32),
        question_i18n: i18n(
          "Yakshanba kuni ishlaysizlarmi?",
          "Работаете в воскресенье?",
          "Are you open on Sunday?",
        ),
        answer_i18n: i18n(
          "Yakshanba kuni klinika yopiq.",
          "В воскресенье клиника закрыта.",
          "The clinic is closed on Sunday.",
        ),
        location_id: location.location_id,
        service_id: null,
        published_by_user_id: groundingId(1),
        effective_from: GROUNDING_NOW,
        effective_to: null,
      },
    ],
  };
  if (!isSchemaValue(PublishedBusinessKnowledgeV2Schema, candidate))
    throw new TypeError("Invalid grounding fixture");
  return candidate;
};
