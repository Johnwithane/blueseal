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

/**
 * Launch phase (supply-first go-to-market). While `onboarding`, the consumer
 * marketplace (search, trade + city pages) is kept OUT of the search index and
 * the homepage is oriented to recruiting Okanagan tradespeople — so we never
 * rank an empty shelf. Flip to `public` (set VITE_LAUNCH_PHASE=public) to index
 * the marketplace and show the client-first homepage. Defaults to `onboarding`
 * so a deploy never accidentally indexes an under-stocked marketplace.
 */
export type LaunchPhase = "onboarding" | "public";
export const LAUNCH_PHASE: LaunchPhase =
  env?.VITE_LAUNCH_PHASE === "public" ? "public" : "onboarding";
export const IS_ONBOARDING = LAUNCH_PHASE === "onboarding";

/** Default <title> shown on the homepage and used as the suffix elsewhere. */
export const TITLE_DEFAULT = `${SITE_NAME}: Verified Canadian Tradespeople`;
/** Appended to per-page titles, e.g. "Find a plumber | Blue Seal". */
export const TITLE_SUFFIX = ` | ${SITE_NAME}`;

export const DEFAULT_DESCRIPTION =
  "Hand-verified tradespeople across Canada. Blue Seal checks a pro's government ID " +
  "and trade ticket before they can work, then runs the whole job in one place: post " +
  "a job, compare quotes, schedule, pay and review.";

/** Homepage description while onboarding (recruiting tradespeople, supply-first). */
export const HOME_RECRUIT_DESCRIPTION =
  "Blue Seal is a verified trades platform built in the Okanagan. Get your trade ticket " +
  "and ID verified, then win and run jobs in one place: quotes, scheduling, invoicing, " +
  "card payments and an AI assistant. We're onboarding founding Okanagan pros now.";

/**
 * Default social-share image. Square 2048×2048 brand mark — an interim until a
 * dedicated 1200×630 OG card ships (see HUMANTASKS.md). Absolute URL because
 * crawlers require it.
 */
export const DEFAULT_OG_IMAGE = `${SITE_URL}/icons/blueseal_logo_LARGE.png`;
export const LOGO_URL = `${SITE_URL}/icons/blueseal_logoCircle_RED.png`;

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
