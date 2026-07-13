# Terms of Use & Privacy Policy — plain-English draft outline (Loadout)

> Content for `src/views/TermsView.vue` + `src/views/PrivacyView.vue`, versioned by `src/legal/version.ts` (`LEGAL_VERSION` — bump on any change that needs renewed consent; users re-accept on next sign-in, mirroring Blue Seal's `termsAcceptedVersion`).
>
> ⚠️ **This is a plain-English DRAFT for review — not legal advice and not launch-ready.** Have a lawyer review before you go live, especially the parts on **payments/subscriptions**, **user-generated content & moderation**, and **sensitive personal data (passport/visa/carnet)**. Fill bracketed `[…]` placeholders (company name, jurisdiction, contact, retention periods) with real values.

---

## Part A — Terms of Use

**1. Who we are & what this is.** Loadout (operated by `[Company]`, `[jurisdiction]`) is a tour-management app plus a band community. These terms govern your use. By creating an account you accept them.

**2. Eligibility & accounts.** You must be at least `[16/18]`. You're responsible for your account and anything done under it; keep your login secure. One person, one account (you can hold multiple roles).

**3. Roles & access.** Access is per-tour. Tour owners/managers control who is invited and what each person can see. Being invited to a tour doesn't give you rights to that tour's data beyond what the owner grants.

**4. Acceptable use.** Don't: break the law; upload content you don't have the right to; harass, defame, or endanger anyone; scrape or reverse-engineer the service; abuse the APIs or attempt to bypass paywalls, rate limits, or security; upload malware; or misuse others' personal data you enter (see Privacy, §B7).

**5. Your content & the community.** You keep ownership of what you post (notes, recommendations, profiles, tour data). You grant us a license to host, display, and share it **as needed to run the service** (e.g. showing your recommendation to other bands, or your day sheet to your crew). Community posts are **attributed** to your band. We may **remove content and suspend accounts** that break these terms; posts are **reportable**, screened for spam/abuse, and **rate-limited**. We don't pre-approve content and aren't responsible for what users post — but we act on reports.

**6. Public links & profiles.** You can make certain things public: your **band profile** and **share links** (e.g. a stage plot/tech pack sent to a venue). You control publishing; **share links are revocable** and expose only the item shared. Anything you make public can be viewed by anyone with the link.

**7. Subscriptions & payments.** Core features are free. **Premium** unlocks AI tools, the community/map, and advanced privacy controls. Payments are processed by **Stripe** — we don't store your card details. Subscriptions renew automatically until cancelled; cancel anytime in settings (access continues to the end of the paid period). Prices, taxes, and `[refund policy]` as shown at checkout. `[State your refund stance clearly.]`

**8. Third-party data (no guarantees).** Features rely on third-party data — flight status (FlightAware), maps/places/routes (Google), weather `[provider]`. We surface this to help you but **can't guarantee its accuracy or availability**; don't rely on it as the sole basis for critical decisions (e.g. catching a flight).

**9. Disclaimers & liability.** The service is provided "as is." We're not liable for logistics decisions, missed connections, third-party data errors, or lost data beyond `[limitation]`, to the extent the law allows. `[Insert jurisdiction-appropriate limitation of liability + warranty disclaimer.]`

**10. Termination.** You can delete your account anytime. We may suspend/terminate for breach. On deletion we remove your data per the Privacy Policy.

**11. Changes.** We may update these terms; material changes bump `LEGAL_VERSION` and we'll ask you to re-accept. Continued use means acceptance.

**12. Contact.** `[support email / address]`. Governing law: `[jurisdiction]`.

---

## Part B — Privacy Policy

**1. What we collect.**
- **Account:** name, email, sign-in method, role(s).
- **Tour data you enter:** tours, days, schedules, venues, travel, guest lists, settlements/budgets, notes, files you upload.
- **People you add:** personnel/contacts (their names, contact details) and **travel documents** you record — including **sensitive data like passport/visa/carnet details** (§B7).
- **Community:** your band profile, posts, recommendations, and — **only if you opt in** — **city-level presence** (never live GPS).
- **Payments:** billing status via Stripe (we don't store card numbers).
- **Technical:** device/app info, usage analytics, and **error logs** (to fix bugs).

**2. How we use it.** To run the service — build/sync tours, send notifications, generate day sheets; process documents you upload with **AI** (see §B5); power community features you opt into; handle billing and support; and keep the service secure (abuse/spam prevention, rate limiting).

**3. Who we share it with.**
- **People on your tour** — per the visibility you/your manager set.
- **The community** — only what you make public/opt into.
- **Processors that run the service:** Google/Firebase (hosting, database, auth, AI via Vertex), Stripe (payments), FlightAware (flight status), `[email provider]` (email), Google Places/Maps (venue/place data). They process data on our behalf under their terms.
- **Legal** — if required by law.
- We **don't sell your personal data.**

**4. Location.** Map/presence features are **opt-in** and shared at **city level only** — we don't track or share your real-time location.

**5. AI processing.** When you forward a confirmation or upload a rider/PDF, its contents are sent to our AI processor (**Google Vertex AI / Gemini**) to extract structured info for you. The assistant answers using **your own tour data**. `[Confirm with the processor's terms:]` we don't use your content to train third-party models.

**6. Payments.** Handled by **Stripe**; we receive subscription status, not card details. See Stripe's privacy policy.

**7. Data about other people.** When you add crew, contacts, or their travel documents, **you're responsible** for having a lawful basis to do so and for telling them as needed; we process that data on your behalf to provide the tour.

**8. Retention & your rights.** We keep data while your account is active and for `[period]` after, then delete or anonymize it. You can **access, export, or delete** your data from settings (we reuse a self-serve export + account-deletion flow). `[Add GDPR/CCPA-specific rights + how to exercise them, per your users' regions.]`

**9. Security.** Data is encrypted in transit; access is controlled by security rules and App Check; sensitive fields (financials, travel docs) are permission-gated. No system is perfectly secure, but we take reasonable measures.

**10. Offline/local storage.** For offline use, tour data is cached on your device. Removing the app or signing out clears it.

**11. Children.** Not intended for anyone under `[16/18]`.

**12. International transfers.** Data may be processed in `[regions]` via our providers (e.g. Google/Firebase), with appropriate safeguards.

**13. Changes & contact.** Material changes bump `LEGAL_VERSION` and prompt re-acceptance. Questions or requests: `[privacy contact]`.

---

## Where each part maps in code
- Terms → `src/views/TermsView.vue`; Privacy → `src/views/PrivacyView.vue` (reuse Blue Seal's `LegalDocument.vue` renderer).
- `src/legal/version.ts` → set `LEGAL_VERSION` to the go-live date; bump on any material change (the §19 per-feature Legal gate reminds you when a feature changes what you collect/share/process — community, payments, AI, location, and travel-docs are the usual triggers).
