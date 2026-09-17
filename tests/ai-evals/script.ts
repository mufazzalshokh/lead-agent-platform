export interface ScriptAnalysis {
  readonly compliant: boolean;
  readonly ordinaryCyrillicLetters: number;
  readonly ordinaryLatinLetters: number;
  readonly excludedLiteralCount: number;
}

/** Script test only, NOT proof of Uzbek fluency, factuality or safe wording. */
export const analyzeUzbekLatin = (
  text: string,
  literalAllowlist: readonly string[] = [],
  original: string | null = null,
): ScriptAnalysis => {
  if (
    text.length > 4_000 ||
    (original !== null && original.length > 4_000) ||
    literalAllowlist.length > 8 ||
    literalAllowlist.some((literal) => literal.length === 0 || literal.length > 100)
  )
    throw new TypeError("Script-analysis bounds exceeded");
  let prose = text.replaceAll(/https?:\/\/[^\s<>"“”]+/giu, " ");
  let excludedLiteralCount = 0;
  // Only short exact quotes of original input, once each, never arbitrary prose.
  const quoted = new Set<string>();
  if (original !== null)
    prose = prose.replaceAll(/["“«]([^"”»\n]{1,100})["”»]/gu, (match: string, inner: string) => {
      if (quoted.size >= 8 || quoted.has(inner) || !original.includes(inner)) return match;
      quoted.add(inner);
      excludedLiteralCount++;
      return " ";
    });
  for (const literal of literalAllowlist) {
    // Exact, case-sensitive, source-bound proper noun. Exclude at most one occurrence,
    // not arbitrary quoted instructions or a prose-length wildcard.
    const offset = prose.indexOf(literal);
    if (offset < 0) continue;
    const before = prose.slice(0, offset);
    const after = prose.slice(offset + literal.length);
    if (/\p{L}$/u.test(before) || /^\p{L}/u.test(after)) continue;
    prose = before + " " + after;
    excludedLiteralCount++;
  }
  const ordinaryCyrillicLetters = [...prose.matchAll(/\p{Script=Cyrillic}/gu)].length;
  const ordinaryLatinLetters = [...prose.matchAll(/\p{Script=Latin}/gu)].length;
  return Object.freeze({
    compliant: ordinaryCyrillicLetters === 0 && ordinaryLatinLetters > 0,
    ordinaryCyrillicLetters,
    ordinaryLatinLetters,
    excludedLiteralCount,
  });
};
