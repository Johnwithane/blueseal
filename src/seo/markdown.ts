// ---------------------------------------------------------------------------
// Markdown helpers for SEO output. Help article bodies and FAQ answers are
// authored in Markdown (src/data/help.ts); search engines and the JSON-LD
// `articleBody` / FAQ `acceptedAnswer` fields want either clean HTML or plain
// text. These two helpers cover both. Framework-free + Node-safe (used by the
// prerender script as well as the app).
// ---------------------------------------------------------------------------

import { marked } from "marked";

// Deterministic, synchronous output — no async plugins, no GitHub-flavour
// extensions we don't use. Matches how the app renders article bodies.
marked.setOptions({ async: false, gfm: true, breaks: false });

/** Render trusted, in-repo Markdown to an HTML string (for prerendered bodies). */
export function mdToHtml(md: string): string {
  return marked.parse(md) as string;
}

/**
 * Collapse Markdown to a single line of plain text — for meta descriptions and
 * JSON-LD text fields. Strips formatting, links (keeps the label), list markers
 * and headings, then normalises whitespace.
 */
export function mdToText(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, " ") // fenced code
    .replace(/`([^`]+)`/g, "$1") // inline code
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ") // images
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1") // links → label
    .replace(/^#{1,6}\s+/gm, "") // headings
    .replace(/^\s*[-*+]\s+/gm, "") // bullet markers
    .replace(/^\s*\d+\.\s+/gm, "") // ordered markers
    .replace(/[*_~>]/g, "") // emphasis / blockquote marks
    .replace(/\s+/g, " ")
    .trim();
}

/** Truncate plain text to a meta-description-friendly length on a word break. */
export function clampDescription(text: string, max = 160): string {
  if (text.length <= max) return text;
  const slice = text.slice(0, max);
  const lastSpace = slice.lastIndexOf(" ");
  return `${slice.slice(0, lastSpace > 40 ? lastSpace : max).trimEnd()}…`;
}

/** Escape a string for safe interpolation into prerendered HTML. */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
