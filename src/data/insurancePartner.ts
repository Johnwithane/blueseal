// Insurance partner referral configuration.
//
// Blue Seal refers tradespeople who need general-liability cover to our
// insurance partner (Foxquilt), and reminds them to renew before their policy
// lapses. A Foxquilt policy names Blue Seal as an additional insured, so going
// through this referral also satisfies the additional-insured check on upload.
//
// `name` is INTERNAL only — the user-facing CTAs are deliberately partner-
// agnostic ("Get insured in minutes"), so we don't surface it. `url` is the
// interim destination opened in a new tab.
//
// FUTURE: once fully signed up, Foxquilt provides an embeddable HTML quote
// widget — at that point we swap the external link for an in-app embed (iframe
// in a dialog) so pros get insured without leaving Blue Seal. See HUMANTASKS.md.
//
// PLACEHOLDER: `url` currently points at Foxquilt's public site so the CTA works
// today. Set VITE_INSURANCE_PARTNER_URL (client) — and INSURANCE_PARTNER_URL on
// the Cloud Functions runtime for the renewal-reminder emails — to override it.
const FALLBACK_URL = "https://www.foxquilt.com/";

export const INSURANCE_PARTNER = {
  name: "Foxquilt",
  url: (import.meta.env.VITE_INSURANCE_PARTNER_URL ?? "").trim() || FALLBACK_URL,
} as const;
