// Insurance partner referral configuration.
//
// Blue Seal refers tradespeople who need general-liability cover to a vetted
// Canadian insurer, and reminds them to renew before their policy lapses. The
// URL is the affiliate/referral link.
//
// PLACEHOLDER: `url` currently points at Zensurance's public site so the CTA
// works today. Swap in the approved Fintel Connect affiliate link by setting
// VITE_INSURANCE_PARTNER_URL (client) — and INSURANCE_PARTNER_URL on the Cloud
// Functions runtime for the renewal-reminder emails. No code change needed.
//
// Zensurance is a flat-referral program covering all of Canada except Quebec
// and the territories. See HUMANTASKS.md for the affiliate-approval task.
const FALLBACK_URL = "https://www.zensurance.com/";

export const INSURANCE_PARTNER = {
  name: "Zensurance",
  url: (import.meta.env.VITE_INSURANCE_PARTNER_URL ?? "").trim() || FALLBACK_URL,
} as const;
