import {
  UtcTimestampSchema,
  isSchemaValue,
  type DomainEventFor,
  type Locale,
  type UtcTimestamp,
} from "@lead-agent/contracts";
import { groundingPreflight, normalizeGroundingQuery } from "../ai/grounding-query.js";
import { medicalSafetyText } from "../ai/medical-safety.js";
import type { AIWorkReference } from "../ai/ports.js";

export const CUSTOMER_CONFIRMATION_PROFILE = "s18_customer_confirmation.v1";
export type ConfirmationReplyIntent = "confirm" | "decline" | "clarify" | "medical";
export type ConfirmationProcessingResult = Readonly<{
  kind:
    | "confirmed"
    | "declined"
    | "clarification"
    | "grounding_insufficient"
    | "ignored"
    | "not_applicable";
  reason: string | null;
}>;
export interface CustomerConfirmationStore {
  prepare(
    event: DomainEventFor<"appointment_request.staff_accepted">,
  ): Promise<"prepared" | "already_prepared" | "expired" | "unavailable">;
  expire(
    event: DomainEventFor<"appointment_request.customer_confirmation_requested">,
  ): Promise<"expired" | "not_due" | "obsolete">;
  respond(reference: AIWorkReference): Promise<ConfirmationProcessingResult>;
}

/** Fixed owner-approved P0 window. Transport retries never call this to renew an offer. */
export const customerConfirmationExpiry = (
  issuedAt: string,
  acceptedStart: string,
): UtcTimestamp | null => {
  if (
    !isSchemaValue(UtcTimestampSchema, issuedAt) ||
    !isSchemaValue(UtcTimestampSchema, acceptedStart)
  )
    throw new TypeError("Invalid confirmation clock");
  if (Date.parse(acceptedStart) <= Date.parse(issuedAt)) return null;
  const expiry = new Date(
    Math.min(Date.parse(issuedAt) + 86_400_000, Date.parse(acceptedStart)),
  ).toISOString();
  if (!isSchemaValue(UtcTimestampSchema, expiry))
    throw new TypeError("Invalid confirmation expiry");
  return expiry;
};

/** Conservative explicit statements only: uncertain language is clarification, not authority.
 * The caller must separately verify persisted offer, customer, channel, receipt time and sequence.
 */
export const confirmationReplyIntent = (text: string): ConfirmationReplyIntent => {
  // The conservative S14 Russian `bol*` stop word also matches Uzbek bo'ladi.
  // Exclude only these finite grammatical tokens in this S18 recognition path;
  // actual health words still fail closed, and the S14 policy is unchanged.
  const safetyText = normalizeGroundingQuery(text).replace(
    /\b(?:boladi|boladimi|bolsin|bolsa|bolmaydi)\b/gu,
    " ",
  );
  if (groundingPreflight(safetyText) === "medical_safety_response") return "medical";
  if (/["«»]/u.test(text)) return "clarify";
  const value = text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[‘’ʻʼ`']/gu, "")
    .trim();
  if (/[?？\d]/u.test(value)) return "clarify";
  // A changed preference, quoted staff authority, negated confirmation or injection is never a bare yes.
  const tokens = value
    .replace(/[.,!✅👍—-]/gu, " ")
    .split(/\s+/u)
    .filter(Boolean);
  if (tokens.length === 0 || tokens.length > 12) return "clarify";
  const matches = (pattern: RegExp, token: string): boolean =>
    pattern.test(token) || pattern.test(normalizeGroundingQuery(token));
  const negative =
    /^(?:yoq|йўқ|йук|нет|no|nope|bormayman|bormiman|бормайман|kerak|emas|не|смогу|отказываюсь|cant|cannot|make|it|i|bomidi|bolmaydi|бўлмайди|unda|ундан|rahmat|спасибо|thanks|thank|you|ertaga|tomorrow)$/u;
  if (
    tokens.some((token) => /^(?:ertaga|tomorrow)$/u.test(token)) &&
    !tokens.some((token) => /^(?:bormayman|bormiman|бормайман|cant|cannot)$/u.test(token))
  )
    return "clarify";
  if (
    tokens.some((token) =>
      matches(
        /^(?:yoq|йўқ|йук|нет|no|nope|bormayman|bormiman|бормайман|отказываюсь|cant|cannot|bomidi|bolmaydi|бўлмайди)$/u,
        token,
      ),
    ) &&
    tokens.every((token) => matches(negative, token))
  )
    return "decline";
  if (/^(?:не смогу|kerak emas|керак эмас)$/u.test(value)) return "decline";
  const affirmative =
    /^(?:ha|ҳа|xa|хa|da|yes|yep|yeah|да|xop|xup|hop|xöp|хоп|хўп|хуп|tasdiq|tasdiqlayman|tasdiqliman|tasdiqliyman|тасдиқлайман|подтверждаю|confirmed|confirm|mayli|майли|boladi|бўлади|boraman|бораман|буду|okay|ok|ill|i|be|there|kelaman|келаман)$/u;
  const polite =
    /^(?:oka|aka|opa|окa|ока|ака|опа|rahmat|рахмат|спасибо|thanks|thank|you|albatta|албатта)$/u;
  if (
    tokens.some((token) => matches(affirmative, token) && !/^(?:i|ill|be|there)$/u.test(token)) &&
    tokens.every((token) => matches(affirmative, token) || matches(polite, token))
  )
    return "confirm";
  return "clarify";
};

/** Presentation only; Uzbek Cyrillic/code-switching never changes business policy. */
export const confirmationLocale = (text: string, preferred: Locale): Locale => {
  const normalized = normalizeGroundingQuery(text);
  if (
    /\b(?:boraman|kelaman|tasdiq\w*|boladi|bormayman|bormiman|yoq|xop|xup|mayli|oka|aka|opa)\b/u.test(
      normalized,
    ) ||
    /[ўқғҳ]/iu.test(text)
  )
    return "uz";
  if (
    /^(?:да|нет|отказываюсь|подтверждаю)(?:[\s,.!]|$)/iu.test(text.trim()) ||
    /\b(?:podtverzhdayu|budu|otkazivayus|otkazyvayus|smogu)\b/u.test(normalized)
  )
    return "ru";
  if (/\b(?:yes|no|nope|confirmed|confirm|cannot|thanks|there)\b/u.test(normalized)) return "en";
  return preferred;
};

export const confirmationText = (
  kind: "prompt" | "confirmed" | "declined" | "clarify" | "expired" | "medical",
  locale: Locale,
  localStart: string,
): string => {
  if (kind === "medical") return medicalSafetyText(locale);
  const date = localStart.slice(0, 10).split("-").reverse().join("-"),
    time = localStart.slice(11, 16);
  const texts = {
    prompt: {
      uz: `${date} soat ${time} uchun so'rovingiz xodim tomonidan qabul qilindi. Shu vaqtni tasdiqlaysizmi?`,
      ru: `Сотрудник принял ваш запрос на ${date} в ${time}. Подтверждаете это время?`,
      en: `Staff accepted your request for ${date} at ${time}. Does that time work for you?`,
    },
    confirmed: {
      uz: `Ajoyib, tasdiqlandi ✅ ${date} soat ${time} da kutamiz.`,
      ru: `Отлично, подтверждено ✅ Ждём вас ${date} в ${time}.`,
      en: `Great, confirmed ✅ We look forward to seeing you on ${date} at ${time}.`,
    },
    declined: {
      uz: "Tushunarli, bu so'rov bekor qilindi. Boshqa vaqt kerak bo'lsa, yozing.",
      ru: "Понятно, этот запрос отменён. Напишите, если нужно другое время.",
      en: "Understood, this request has been cancelled. Let us know if you need another time.",
    },
    clarify: {
      uz: "Qaysi sana va vaqtni tasdiqlamoqchisiz? Vaqtni o'zgartirish kerak bo'lsa, xodim bilan qayta kelishamiz.",
      ru: "Какую дату и время вы хотите подтвердить? Если нужно другое время, согласуем его с сотрудником.",
      en: "Which date and time would you like to confirm? If you need a different time, staff will need to review it.",
    },
    expired: {
      uz: "Bu vaqt uchun tasdiqlash muddati tugagan. Yangi vaqtni xodim bilan kelishish kerak.",
      ru: "Срок подтверждения этого времени истёк. Новое время нужно согласовать с сотрудником.",
      en: "The confirmation window for that time has expired. A new time needs staff review.",
    },
  };
  return texts[kind][locale];
};
