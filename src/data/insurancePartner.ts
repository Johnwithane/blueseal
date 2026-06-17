// Insurance partner referral configuration.
//
// Blue Seal refers tradespeople who need general-liability cover to our
// insurance partner, Foxquilt, and reminds them to renew before their policy
// lapses. A Foxquilt policy names Blue Seal as an additional insured, so going
// through this referral also satisfies the additional-insured check on upload.
// The URL is the affiliate/referral link.
//
// PLACEHOLDER: `url` currently points at Foxquilt's public site so the CTA works
// today. Swap in the approved tracked partner link by setting
// VITE_INSURANCE_PARTNER_URL (client) — and INSURANCE_PARTNER_URL on the Cloud
// Functions runtime for the renewal-reminder emails. No code change needed.
//
// See HUMANTASKS.md for the partner-signup / tracked-link task.
const FALLBACK_URL = "https://www.foxquilt.com/";

export const INSURANCE_PARTNER = {
  name: "Foxquilt",
  url: (import.meta.env.VITE_INSURANCE_PARTNER_URL ?? "").trim() || FALLBACK_URL,
} as const;
