export const LEXICON_VERSION = "s13-uz-hints.v1";
export const LEXICON = Object.freeze([
  {
    forms: ["oka", "ока"],
    likely: "aka",
    context: "addressing a person, not a name",
    uncertain: true,
  },
  {
    forms: ["okajon", "окажон"],
    likely: "akajon",
    context: "friendly address only",
    uncertain: true,
  },
  {
    forms: ["xop", "xup", "hop", "hup", "xo'p", "xo‘p", "хўп"],
    likely: "xo‘p",
    context: "acknowledgement; hop may have another meaning",
    uncertain: true,
  },
  {
    forms: ["boladi", "buladi", "bo'ladi", "bo‘ladi", "булади", "бўлади"],
    likely: "bo‘ladi",
    context: "possibility/permission; NOT booking confirmation by itself",
    uncertain: true,
  },
  {
    forms: ["skidka", "скидка"],
    likely: "chegirma",
    context: "discount query, never proof of an approved discount",
    uncertain: false,
  },
  {
    forms: ["otmena", "отмена"],
    likely: "bekor qilish",
    context: "cancellation request, not authorization of an unbound appointment",
    uncertain: false,
  },
  {
    forms: ["завтра", "zavtra"],
    likely: "ertaga",
    context: "relative date resolved only with authoritative time context",
    uncertain: false,
  },
  {
    forms: ["ilt", "plz"],
    likely: "iltimos",
    context: "polite abbreviation only",
    uncertain: true,
  },
  {
    forms: ["qanca", "qanch", "nma"],
    likely: "qancha / nima",
    context: "informal question; choose interpretation from surrounding words",
    uncertain: true,
  },
]);

/** Interpretation metadata only: never return a replacement customer message. */
export const normalizationHint = (original: string): string | null => {
  const tokens = new Set(original.toLocaleLowerCase("uz").split(/[^\p{L}‘'’]+/u));
  const matched = LEXICON.filter((entry) => entry.forms.some((form) => tokens.has(form)));
  if (matched.length === 0) return null;
  return `${LEXICON_VERSION}: ${matched.map((entry) => `${entry.forms.join("/")} ≈ ${entry.likely}; ${entry.context}${entry.uncertain ? "; uncertain" : ""}`).join(" | ")}`.slice(
    0,
    512,
  );
};
