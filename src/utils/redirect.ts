// Post-login redirect guard. A `?redirect=` target must be a same-origin
// RELATIVE path ("/jobs/123"), never an absolute URL or protocol-relative
// "//evil.com" — otherwise a crafted sign-in link could bounce someone off-site
// after they authenticate (open redirect / phishing). Anything else falls back.
export function safeRedirect(target: unknown, fallback = "/dashboard"): string {
  return typeof target === "string" &&
    target.startsWith("/") &&
    !target.startsWith("//") &&
    !target.startsWith("/\\")
    ? target
    : fallback;
}
