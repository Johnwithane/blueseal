# Legal — Blue Seal

These are **pre-legal-review drafts**. They are written to be as close to "approve as-is" as we can get, but **must be reviewed by a Canadian lawyer (BC privacy / consumer / marketplace experience preferred) before being published or relied upon**.

## Files

- `privacy-policy.md` — what data we collect, why, how it's stored, and user rights (PIPEDA + BC PIPA aligned)
- `terms-of-service.md` — the contract every account holder agrees to at signup

## Before publishing — fill in these placeholders

Search the docs for the following bracketed tokens and replace:

| Token | What to put |
|---|---|
| `[LEGAL ENTITY NAME]` | The company's registered legal name (e.g. "Blue Seal Technologies Inc.") |
| `[REGISTERED ADDRESS]` | Registered office address |
| `[PRIVACY EMAIL]` | Suggest `privacy@blueseal.app` — must be a real, monitored inbox |
| `[SUPPORT EMAIL]` | Suggest `support@blueseal.app` |
| `[LEGAL EMAIL]` | Suggest `legal@blueseal.app` |
| `[PRIVACY OFFICER NAME]` | The named individual responsible for privacy (required under PIPEDA Principle 1) |
| `[WEBSITE URL]` | Final production URL (e.g. `https://blueseal.app`) |
| `[EFFECTIVE DATE]` | The date these become live |
| `[GOVERNING PROVINCE]` | Default: `British Columbia, Canada` |
| `[AI SUBSCRIPTION PRICE]` | Per design.md § 14 Q2 — currently TBD, suggested $39 CAD/mo |

## Signup integration (separate task)

Once these are approved, we need to:

1. Render them at `/privacy` and `/terms` (Vue views or static markdown render)
2. Add an "I agree to the Terms of Service and Privacy Policy" checkbox to:
   - `src/views/auth/SignUpView.vue` (clients)
   - `src/views/auth/SignUpTradieView.vue` (tradespeople — also needs platform-fee + Stripe subscription disclosures highlighted)
3. Store the agreed-version + timestamp on the user doc (`termsAcceptedAt`, `termsVersion`) so we can re-prompt when terms change.

## Why two documents, both shown at signup

PIPEDA and BC PIPA require **meaningful consent** for personal-information collection — a separate, plain-language privacy policy with a discrete consent moment is the standard way to demonstrate that. The Terms of Service handle the contractual relationship (platform role, fees, dispute resolution, IP).

## Open items for the lawyer to weigh in on

1. **Marketplace classification.** We are explicitly a *platform / introducer* between clients and tradespeople, **not** the contractor of the trades work. The Terms reflect this, but a BC consumer-protection lawyer should confirm the Business Practices and Consumer Protection Act exposure (especially around "supplier" definitions).
2. **Tradesperson liability / insurance representations.** MVP requires cert + government ID but does **not** require proof of liability insurance (insurance upload is v1.1 per design.md § 12). The Terms disclose this; a lawyer should confirm wording is sufficient.
3. **Government-issued ID retention.** We retain ID images for 90 days post-approval, then auto-delete (design.md § 4.1). Privacy policy reflects this. Confirm against OIPC BC guidance.
4. **Private client-reputation scores.** Tradies leave private reviews of clients, visible only to other tradies. This is a sensitive use of personal information — confirm disclosure language is sufficient and consent is meaningful.
5. **AI processing.** AI tools (Diagnose, Quote Helper, Job Summary) send job context including chat messages and photos to Google's Gemini via Firebase AI Logic. Confirm the disclosure is adequate and Google's data-handling commitments under the Firebase DPA satisfy onward-transfer requirements.
6. **Mandatory arbitration / class-action waiver.** Drafted as a moderate-strength clause carved out for small-claims and BC consumer-protection claims. Lawyer may want to strengthen, weaken, or remove entirely depending on appetite.
7. **Age limits.** Minimum 19 (BC age of majority) for tradespeople; 18 for clients in BC. Confirm this is right for our launch region.
