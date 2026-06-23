// Shared rules for a tradesperson's vanity profile handle (blueseal.app/u/<slug>).
// Used by the inline "your link" editor for instant validation + suggestions;
// the claimProfileSlug Cloud Function re-validates server-side (the authority)
// with a mirror of these rules in functions/src/lib/slug.ts.

export const SLUG_MIN = 3;
export const SLUG_MAX = 30;

// Lowercase alphanumerics in hyphen-separated groups: no leading/trailing or
// doubled hyphens. e.g. "bellweather-plumbing".
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

// Handles that would shadow real routes or read as official. Keep in sync with
// the server copy.
export const RESERVED_SLUGS = new Set<string>([
  "u", "p", "tradies", "tradie", "admin", "account", "accounts", "search",
  "help", "api", "jobs", "job", "dashboard", "dashboards", "settings",
  "setting", "login", "signin", "sign-in", "signup", "sign-up", "logout",
  "pricing", "about", "contact", "terms", "privacy", "support", "request",
  "onboarding", "new", "edit", "me", "profile", "profiles", "www", "static",
  "assets", "blueseal", "blue-seal", "auth", "verify", "app",
]);

export function isValidSlug(s: string): boolean {
  return (
    typeof s === "string" &&
    s.length >= SLUG_MIN &&
    s.length <= SLUG_MAX &&
    SLUG_RE.test(s) &&
    !RESERVED_SLUGS.has(s)
  );
}

// Human-readable reason a handle is rejected, or null when it's valid. Drives
// the inline validation message in the editor.
export function slugError(s: string): string | null {
  const v = (s ?? "").trim();
  if (!v) return "Choose a handle for your link.";
  if (v.length < SLUG_MIN) return `Use at least ${SLUG_MIN} characters.`;
  if (v.length > SLUG_MAX) return `Keep it under ${SLUG_MAX} characters.`;
  if (!SLUG_RE.test(v)) return "Use lowercase letters, numbers and hyphens only.";
  if (RESERVED_SLUGS.has(v)) return "That handle is reserved. Try another.";
  return null;
}

// Suggest a handle from a company / display name. May fall short of SLUG_MIN
// for very short names; the editor still validates the final value.
export function suggestSlug(name: string): string {
  return (name ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SLUG_MAX)
    .replace(/-+$/g, "");
}
