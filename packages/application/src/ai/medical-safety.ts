import type { Locale } from "@lead-agent/contracts";

/** Owner-approved S21 wording. Deterministic application policy selects it; the model does not. */
export const MEDICAL_SAFETY_WORDING_V1: Readonly<Record<Locale, string>> = Object.freeze({
  uz: "Men tibbiy holatni baholay olmayman, tashxis qo‘ya olmayman yoki davolashni tavsiya qila olmayman. Agar vaziyat shoshilinch bo‘lishi mumkin deb xavotirda bo‘lsangiz, mahalliy shoshilinch yordam xizmatiga darhol murojaat qiling. Boshqa hollarda malakali tibbiyot mutaxassisi bilan bog‘laning.",
  ru: "Я не могу оценить медицинское состояние, поставить диагноз или рекомендовать лечение. Если вы опасаетесь, что ситуация может быть неотложной, немедленно обратитесь в местную экстренную службу. В остальных случаях обратитесь к квалифицированному медицинскому специалисту.",
  en: "I cannot assess a medical condition, diagnose it, or recommend treatment. If you are concerned that the situation may be an emergency, contact your local emergency service now. Otherwise, contact a qualified medical professional.",
});

export const medicalSafetyText = (locale: Locale): string => MEDICAL_SAFETY_WORDING_V1[locale];
