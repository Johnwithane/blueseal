// Shared bounds + normalizer for a tradesperson's free-text "services offered"
// list. Used by all three editing surfaces (onboarding wizard, account
// dashboard, admin prospect editor) so they apply identical limits, and by the
// save paths so a malformed list never reaches Firestore. Services are
// finer-grained than `trades` — e.g. "Boiler installation" or "Emergency
// callout" under the Plumber trade — and are entered as free text.

export const SERVICES_MAX = 20;
export const SERVICE_NAME_MAX = 60;

/**
 * Clean a raw services list for storage: collapse internal whitespace + trim
 * each entry, drop empties, cap each name to SERVICE_NAME_MAX chars,
 * de-duplicate case-insensitively (keeping the first-seen casing), and cap the
 * list to SERVICES_MAX entries. Input order is preserved. Non-string / non-array
 * input is treated as an empty list so callers can pass unknown Firestore data.
 */
export function normalizeServices(raw: readonly unknown[] | unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    if (typeof entry !== "string") continue;
    const name = entry.replace(/\s+/g, " ").trim().slice(0, SERVICE_NAME_MAX).trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
    if (out.length >= SERVICES_MAX) break;
  }
  return out;
}
