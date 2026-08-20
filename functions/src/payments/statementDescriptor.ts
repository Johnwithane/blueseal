// Per-charge statement descriptor suffix for the two destination-charge paths.
//
// Blue Seal is the merchant of record on these charges, so without a suffix
// every card statement reads a bare "BLUESEAL" — a name the CLIENT never
// hired. They hired "Smith Electric". An unrecognized descriptor is the most
// common trigger for a "I don't recognize this charge" dispute, and under
// destination charges that dispute lands on the PLATFORM balance. Appending
// the tradesperson's business name makes the line read
// "BLUESEAL* SMITH ELECTRIC" instead.
//
// Stripe caps the whole rendered descriptor (platform prefix + "* " + suffix)
// at 22 characters. Our shortened platform descriptor is "BLUESEAL" (8) plus
// the "* " separator (2), which leaves 12 for the suffix. Stripe also rejects
// < > \ ' " * outright and requires at least one letter, so anything unsafe is
// stripped here rather than 400-ing an otherwise-good payment at charge time.

export const STATEMENT_SUFFIX_MAX = 12;

// Unicode combining marks, left behind by NFD decomposition.
const COMBINING_MARKS = /[̀-ͯ]/g;

/**
 * Normalize a business name into a Stripe-safe statement descriptor suffix.
 * Returns null when nothing usable survives, in which case the caller should
 * omit the field entirely and let the charge fall back to a bare "BLUESEAL".
 */
export function toStatementDescriptorSuffix(
  name: string | null | undefined,
): string | null {
  if (!name) return null;
  // Decompose + strip accents rather than dropping the letters outright:
  // "Café Électrique" should read "Cafe Electri", not "Caf lectriq".
  const ascii = name.normalize("NFD").replace(COMBINING_MARKS, "");
  const safe = ascii
    .replace(/[^A-Za-z0-9 &.-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  // Hard clip, then drop any separator the clip left dangling at the end.
  const clipped = safe.slice(0, STATEMENT_SUFFIX_MAX).replace(/[^A-Za-z0-9]+$/, "");
  return /[A-Za-z]/.test(clipped) ? clipped : null;
}
