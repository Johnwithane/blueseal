// Server-authoritative copy of the vanity-handle rules (mirrors
// src/utils/slug.ts on the client). claimProfileSlug re-validates here so a
// crafted request can't bypass the client checks.

export const SLUG_MIN = 3;
export const SLUG_MAX = 30;

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

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
