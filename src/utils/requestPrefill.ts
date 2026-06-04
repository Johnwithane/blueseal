import type { Urgency } from "@/firebase/interfaces";

// ---------------------------------------------------------------------------
// Request pre-fill carrier.
//
// When a client describes their problem in the search box ("my dishwasher is
// leaking onto the kitchen floor"), we don't want them to retype it in the
// request form two clicks later. We stash that text here on search, and
// RequestQuoteView reads it back to pre-fill the description, a derived title,
// and a heuristic urgency — all locally, no AI call.
//
// localStorage (not a query param) because the journey is search → tradesperson
// profile → request, so the text has to survive two navigations. Matches the
// existing `searchLocation` / `jobPostDraft` conventions. A freshness stamp
// means a description from a previous session never silently pre-fills a brand
// new request.
// ---------------------------------------------------------------------------

const KEY = "requestPrefill";
const DEFAULT_MAX_AGE_MS = 2 * 60 * 60 * 1000; // 2 hours

interface StoredPrefill {
  text: string;
  ts: number;
}

// Guarded so prerender/SSR (no localStorage) and private-mode quota errors are
// non-fatal — pre-fill is a convenience, never load-bearing.
function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** Stash the client's free-text description for the upcoming request form. */
export function saveRequestPrefill(text: string): void {
  const trimmed = text.trim();
  if (trimmed.length < 3) return;
  const store = storage();
  if (!store) return;
  try {
    store.setItem(KEY, JSON.stringify({ text: trimmed, ts: Date.now() } satisfies StoredPrefill));
  } catch {
    /* quota / private mode — skip, pre-fill just won't happen */
  }
}

/** Read a fresh pre-fill description, or null if absent/stale/corrupt. */
export function readRequestPrefill(maxAgeMs = DEFAULT_MAX_AGE_MS): string | null {
  const store = storage();
  if (!store) return null;
  try {
    const raw = store.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredPrefill>;
    if (typeof parsed.text !== "string" || typeof parsed.ts !== "number") return null;
    if (Date.now() - parsed.ts > maxAgeMs) return null;
    return parsed.text;
  } catch {
    return null;
  }
}

export function clearRequestPrefill(): void {
  storage()?.removeItem(KEY);
}

/**
 * Derive a short job title from the free-text description. Takes the first
 * sentence/clause, caps it, and capitalises it. Returns "" when there's
 * nothing usable (so the caller leaves the field blank rather than forcing a
 * bad title) — the title input stays fully editable either way.
 */
export function deriveTitle(text: string): string {
  // First sentence-ish chunk: stop at . ! ? or a line break.
  const firstClause = text.trim().split(/[.!?\n]/)[0]?.trim() ?? "";
  if (firstClause.length < 3) return "";

  let title = firstClause;
  if (title.length > 80) {
    // Truncate on a word boundary near 80 chars, then add an ellipsis.
    const cut = title.slice(0, 80);
    const lastSpace = cut.lastIndexOf(" ");
    title = (lastSpace > 40 ? cut.slice(0, lastSpace) : cut).trimEnd() + "…";
  }
  return title.charAt(0).toUpperCase() + title.slice(1);
}

// Phrases that signal an emergency vs. a soon-ish job. Substring match against
// the lowercased description — these are a starting guess the client reviews,
// not a hard classification, so a little over-reach is fine.
const URGENT_MARKERS = [
  "emergency", "urgent", "asap", "right away", "flooding", "flooded",
  "gas leak", "gas smell", "sewage", "burst pipe", "no heat", "no hot water",
  "sparking", "sparks", "smoke", "can't lock", "locked out", "overflowing",
  "actively leaking", "leaking everywhere", "won't stop",
];
const SOON_MARKERS = [
  "this week", "few days", "couple days", "couple of days", "by friday",
  "by the weekend", "this weekend", "soon", "next day",
];

/** Best-guess urgency from the description; defaults to "flexible". */
export function deriveUrgency(text: string): Urgency {
  const t = text.toLowerCase();
  if (URGENT_MARKERS.some((m) => t.includes(m))) return "urgent";
  if (SOON_MARKERS.some((m) => t.includes(m))) return "this_week";
  return "flexible";
}
