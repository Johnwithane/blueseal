// ---------------------------------------------------------------------------
// Site-wide SEO constants — the single source of truth for canonical origin,
// brand strings, default social-share metadata, and Organization facts.
//
// This module is imported by BOTH the Vue app (runtime <head> via useSeo) AND
// the build-time prerender script (scripts/prerender.ts), which runs under
// plain Node. So it must stay framework-free and must not assume Vite's
// `import.meta.env` exists — we read it defensively and fall back to the
// production origin.
// ---------------------------------------------------------------------------

// `import.meta.env` is injected by Vite in the browser/build, but is undefined
// when this file is loaded by Node (tsx) during prerendering. Read it safely.
const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;

/** Canonical production origin, no trailing slash. */
export const SITE_URL = (env?.VITE_APP_URL ?? "https://blueseal.app").replace(/\/+$/, "");

export const SITE_NAME = "Blue Seal";
export const SITE_TAGLINE = "Trusted trades. Sealed with proof.";

/** Default <title> shown on the homepage and used as the suffix elsewhere. */
export const TITLE_DEFAULT = `${SITE_NAME} — Verified Canadian tradespeople`;
/** Appended to per-page titles, e.g. "Find a plumber | Blue Seal". */
export const TITLE_SUFFIX = ` | ${SITE_NAME}`;

export const DEFAULT_DESCRIPTION =
  "Blue Seal connects Canadian homeowners with verified tradespeople — every pro " +
  "is checked for government ID, trade certification, insurance and WSIB. Search, " +
  "quote, schedule, pay and review, all in one trusted job thread.";

/**
 * Default social-share image. Square 2048×2048 brand mark — an interim until a
 * dedicated 1200×630 OG card ships (see HUMANTASKS.md). Absolute URL because
 * crawlers require it.
 */
export const DEFAULT_OG_IMAGE = `${SITE_URL}/icons/blueseal_logo_LARGE.png`;
export const LOGO_URL = `${SITE_URL}/icons/blueseal_logo.png`;

export const OG_LOCALE = "en_CA";

/** Country we operate in (schema.org areaServed / addressCountry). */
export const COUNTRY = "Canada";

/** Build an absolute URL from a route path (e.g. "/help" → full canonical). */
export function absoluteUrl(path: string): string {
  if (path.startsWith("http")) return path;
  return `${SITE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}

/** Compose a full document title from a page title (homepage uses the default). */
export function pageTitle(title?: string): string {
  if (!title) return TITLE_DEFAULT;
  return `${title}${TITLE_SUFFIX}`;
}
