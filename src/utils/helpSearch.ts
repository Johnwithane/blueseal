import type { FaqItem, HelpArticle } from "@/firebase/interfaces";

// ---------------------------------------------------------------------------
// Dependency-free fuzzy search for the Help Center.
//
// Small, deterministic, and good enough to feel instant: token-based scoring
// over titles / keywords / body, with single-edit typo tolerance on longer
// terms. No backend, no per-query cost. Returns ranked results plus the title
// split into highlight segments so the UI can <mark> matches without v-html.
// ---------------------------------------------------------------------------

export type HelpResultKind = "article" | "faq";

export interface HelpSearchItem {
  kind: HelpResultKind;
  /** Article slug, or `faq:<n>` for FAQ entries. */
  ref: string;
  categoryId: string;
  title: string; // article title / FAQ question
  subtitle: string; // article excerpt / FAQ answer (first line)
  /** Pre-lowercased haystacks, weighted by where they came from. */
  titleNorm: string;
  keywordsNorm: string;
  bodyNorm: string;
}

export interface Segment {
  text: string;
  hit: boolean;
}

export interface HelpSearchResult {
  item: HelpSearchItem;
  score: number;
  titleSegments: Segment[];
}

/** Lowercase, strip accents, collapse whitespace. */
function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(s: string): string[] {
  return normalize(s)
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/** True when `a` and `b` are within one insert/delete/substitution. */
function within1(a: string, b: string): boolean {
  if (a === b) return true;
  const la = a.length;
  const lb = b.length;
  if (Math.abs(la - lb) > 1) return false;
  // Walk both strings allowing a single divergence.
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < la && j < lb) {
    if (a[i] === b[j]) {
      i++;
      j++;
      continue;
    }
    if (++edits > 1) return false;
    if (la > lb) i++;
    else if (lb > la) j++;
    else {
      i++;
      j++;
    }
  }
  if (i < la || j < lb) edits++;
  return edits <= 1;
}

export function buildHelpIndex(
  articles: HelpArticle[],
  faqs: FaqItem[],
): HelpSearchItem[] {
  const items: HelpSearchItem[] = articles.map((a) => ({
    kind: "article" as const,
    ref: a.slug,
    categoryId: a.categoryId,
    title: a.title,
    subtitle: a.excerpt,
    titleNorm: normalize(a.title),
    keywordsNorm: normalize([...a.keywords, a.excerpt].join(" ")),
    bodyNorm: normalize(a.body),
  }));

  faqs.forEach((f, i) => {
    items.push({
      kind: "faq",
      ref: `faq:${i}`,
      categoryId: f.categoryId,
      title: f.question,
      subtitle: f.answer,
      titleNorm: normalize(f.question),
      keywordsNorm: "",
      bodyNorm: normalize(f.answer),
    });
  });

  return items;
}

function scoreItem(item: HelpSearchItem, terms: string[], queryNorm: string): number {
  let score = 0;

  // Whole-query substring in the title is the strongest signal.
  if (queryNorm.length >= 2 && item.titleNorm.includes(queryNorm)) score += 12;

  const titleWords = item.titleNorm.split(" ");
  const keywordWords = item.keywordsNorm.split(" ");

  for (const term of terms) {
    let termHit = 0;

    if (titleWords.includes(term)) termHit = Math.max(termHit, 10);
    else if (titleWords.some((w) => w.startsWith(term))) termHit = Math.max(termHit, 7);
    else if (item.titleNorm.includes(term)) termHit = Math.max(termHit, 6);

    if (keywordWords.includes(term)) termHit = Math.max(termHit, 5);
    else if (item.keywordsNorm.includes(term)) termHit = Math.max(termHit, 4);

    if (termHit === 0 && item.bodyNorm.includes(term)) termHit = 2;

    // Typo tolerance on longer terms only (avoids matching short noise).
    if (termHit === 0 && term.length >= 4) {
      if (titleWords.some((w) => within1(w, term))) termHit = 4;
      else if (keywordWords.some((w) => within1(w, term))) termHit = 3;
    }

    score += termHit;
  }

  return score;
}

export function searchHelp(
  index: HelpSearchItem[],
  query: string,
  limit = 8,
): HelpSearchResult[] {
  const queryNorm = normalize(query);
  const terms = tokenize(query);
  if (terms.length === 0) return [];

  const results: HelpSearchResult[] = [];
  for (const item of index) {
    const score = scoreItem(item, terms, queryNorm);
    if (score > 0) {
      results.push({ item, score, titleSegments: highlight(item.title, terms) });
    }
  }

  results.sort((a, b) => b.score - a.score || a.item.title.length - b.item.title.length);
  return results.slice(0, limit);
}

/**
 * Split `text` into segments, flagging the spans that match any query term so
 * the UI can wrap them in <mark>. Case/accent-insensitive on a per-character
 * basis (normalised text is the same length as the source for our content).
 */
export function highlight(text: string, terms: string[]): Segment[] {
  const norm = normalize(text);
  // normalize() can change length (accents); fall back to no-highlight then.
  if (norm.length !== text.length || terms.length === 0) {
    return [{ text, hit: false }];
  }

  const flags = new Array<boolean>(text.length).fill(false);
  for (const term of terms) {
    if (!term) continue;
    let from = 0;
    let idx = norm.indexOf(term, from);
    while (idx !== -1) {
      for (let k = idx; k < idx + term.length; k++) flags[k] = true;
      from = idx + term.length;
      idx = norm.indexOf(term, from);
    }
  }

  const segments: Segment[] = [];
  let buf = "";
  let cur = flags[0] ?? false;
  for (let i = 0; i < text.length; i++) {
    if (flags[i] === cur) {
      buf += text[i];
    } else {
      segments.push({ text: buf, hit: cur });
      buf = text[i];
      cur = flags[i];
    }
  }
  if (buf) segments.push({ text: buf, hit: cur });
  return segments;
}
