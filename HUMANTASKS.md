# Human-required tasks

Setup work that requires your access — accounts, dashboards, secrets, third-party extensions. Claude can scaffold the code; only you can complete these. Check items off as you complete them.

Tasks are grouped by the phase that introduced them so you can see why each one exists. Newest at the top.

---

## PM feature expansion — deploy (added 2026-06-28)

A batch of project-manager features (Pro paywall enablement, plus more landing in
following commits). **Deploy the functions once when you pull this branch:**
`firebase deploy --only functions` (and `firestore:rules` where noted below).

### [ ] Deploy functions: PM welcome email

- **Why:** New PMs got no welcome (tradespeople get a "you're approved" email). A
  best-effort `pm_welcome` notification (email + in-app) now fires the first time a
  user becomes a PM, from both real provisioning paths (addRoleToSelf + provisionAccount).
- **What:** `firebase deploy --only functions`. Uses the existing notify()/mail queue
  (Resend) — no new config beyond the CASL mailing-address env already used by other
  account emails.
- **Verify:** Become a PM (new account or add the role) → a "Welcome to Blue Seal"
  email + in-app notification arrives, linking to /manage.

### [ ] (Covered by the functions deploy) Multi-unit properties

- **Why:** A property can now carry a list of **unit labels** (e.g. "Unit 1",
  "Basement"), and a project can be scoped to one unit. `createProject` +
  `updateProject` now persist the optional `unit` field — so they must be redeployed
  with the rest (`firebase deploy --only functions`). **No firestore.rules change**
  (the properties `units` array is additive and not field-locked; the project `unit`
  is server-written via the callables).
- **Verify:** Edit a property → add a couple of units → New project on that property →
  a Unit picker appears → pick one → the project shows the unit.

### [ ] Deploy functions: PM can edit a project before it's accepted

- **Why:** New `updateProject` callable lets the owning PM edit a project's label,
  client name, photo, property, and job list while it's still `invited`/`claimed`
  (before the client accepts and dispatch fans the jobs out). Previously the only
  option was cancel. Server rejects edits once accepted.
- **What:** `firebase deploy --only functions`. The project detail page's "Edit
  project" button calls it; until deployed the button errors and cancel still works.
- **Verify:** Open a pending project → Edit project → change the label / add a job →
  Save changes → the detail updates. Editing an accepted project is rejected.

### [ ] Deploy functions: PM AI — "catch me up" projects digest

- **Why:** New callable `aiProjectsDigest` gives a PM a plain-language status
  catch-up across their projects + the jobs their trades won. Reads ONLY
  PM-readable status (never the client/tradesperson chat or invoices — the
  firewall holds). Gated behind Blue Seal Pro + the AI daily cap.
- **What:** `firebase deploy --only functions`. The dashboard's "Catch me up"
  button calls it. Reuses the existing projects/jobs indexes (same queries the
  cockpit already runs), so no new Firestore index.
- **Verify:** As a Pro PM with a few projects, dashboard → Catch me up → a short
  status summary appears. Non-Pro PM → the Blue Seal Pro paywall.

### [ ] Deploy functions: PM AI — draft a project from a prompt

- **Why:** New callable `aiGenerateProjectFromPrompt` lets a PM describe work in
  plain language and get the project's trade jobs drafted (they review/edit before
  creating). Gated behind Blue Seal Pro (`requireAiEntitlement` → "pmProject") and
  the shared AI daily cap. Reuses the existing Vertex/Gemini setup — no new config.
- **What:** `firebase deploy --only functions`. The new-project form's "Draft jobs"
  button calls it; until deployed it returns a not-found and the form's manual entry
  still works.
- **Verify:** As a Pro PM, open New project → type a description → Draft jobs → the
  job rows populate with trade + title + description to review. As a non-Pro PM, the
  button opens the Blue Seal Pro paywall.

### [ ] Deploy functions: project managers can subscribe to Blue Seal Pro

- **Why:** The AI tools, clients CRM, branded-profile tools, and global calendar are
  gated behind the **same** Blue Seal Pro subscription tradespeople have. The checkout
  callable previously required the tradesperson role, so a pure PM couldn't subscribe.
- **What:** `createSubscriptionCheckout` now accepts **tradesperson OR projectManager**
  (`requireAnyRole`). Same plan, same 30-day trial, same Stripe flow — nothing new to
  configure. Deploy: `firebase deploy --only functions`.
- **Verify:** As a PM (no tradesperson role), hit any Pro feature → the paywall → Start
  trial → Stripe Checkout opens (test mode). Tradesperson checkout still works.

---

## Project-manager onboarding pass (added 2026-06-27)

### [ ] Deploy the `resendProjectInvite` function (re-copyable project invite link)

- **Why:** PMs (esp. agents) share invite links directly (text/DM), not just by
  email. `resendProjectInvite` now **re-mints the token on every resend** and hands
  back a fresh shareable link for the *same* client email (previously only an
  email-change returned a link; the raw token is hash-only, so re-sharing requires a
  re-mint). The cockpit UI already surfaces the returned link — it just stays empty
  on a same-email resend until the new function is live.
- **What:** `firebase deploy --only functions` (confirm `✔ Deploy complete!`). No
  rules/indexes changed; the client change is backward-compatible (degrades to the
  current email-only resend against the old function), so deploying after the
  hosting release won't break anything — it only lights up the direct-share link.
- **Verify:** Open a pending project → **Resend invite** → a "Shareable sign-in
  link" with a Copy button appears for the same client email; opening it in a fresh
  session signs the client in. The previous link for that project stops working
  (latest-wins).

---

## Google One Tap — "Continue as <name>" popup (added 2026-06-25)

One Tap is built and wired into `/sign-in` and `/sign-up`, but stays **OFF** until
you set the OAuth client ID below. With it blank, nothing changes (the "Continue
with Google" button still works); set it and the One Tap card starts appearing for
logged-out Google users. New accounts route to the forced `/welcome` role choice.

### [ ] Provision the OAuth Web Client ID and authorize the site origin

- **Why:** One Tap needs the OAuth 2.0 **Web Client ID** to render the card, and
  it must be the *same* client ID that backs Firebase Auth's Google provider so
  `signInWithCredential` accepts the token (audience match). The site's origin
  must be on that client's **Authorized JavaScript origins** or the prompt is
  silently suppressed by Google.
- **What:**
  1. GCP Console → **APIs & Services → Credentials** (project `blueseal-762af`) →
     open **"Web client (auto created by Google Service)"** (the one Firebase made).
  2. Under **Authorized JavaScript origins** add `https://blueseal.app` (and any
     preview/staging origins, plus `http://localhost:5173` for local dev).
  3. Copy the **Client ID** and set `VITE_GOOGLE_OAUTH_CLIENT_ID=<that id>` in the
     hosting env (and your local `.env`). Rebuild/redeploy hosting.
- **Verify:** Open `/sign-in` logged out in a browser signed into a Google account
  → the "Continue as <name>" One Tap card appears top-right. Picking it signs you
  in; a brand-new account lands on `/welcome`.
- **Note (FedCM):** One Tap uses FedCM (`use_fedcm_for_prompt: true`), so it keeps
  working as Chrome removes third-party cookies. No extra setup, just don't block
  the prompt in browser settings when testing.

---

## Business card generator — print & mail-out (added 2026-06-17)

The admin tool at `/admin/business-cards` generates print-ready two-sided card
PDFs (3.5 × 2 in + bleed, QR-coded). The generator is done; these tasks are only
needed for the **"mail a card to the first 500 annual members"** gift idea. Full
plan in [`docs/BUSINESS_CARD_PRINT.md`](./docs/BUSINESS_CARD_PRINT.md). None of
these block using the generator today.

### [x] Configure Storage CORS so profile photos render on profile cards — DONE 2026-06-17

- **Why:** The profile card embeds the tradesperson's photo on a `<canvas>`. A
  cross-origin image taints the canvas (breaking PNG/PDF export), so we load it
  with `crossOrigin="anonymous"` — which requires the photo host to send CORS
  headers. Without it the card fell back to an initials avatar.
- **What:** Applied a GET/HEAD CORS policy to `gs://blueseal-762af.firebasestorage.app`
  via `gsutil cors set storage.cors.json` (policy committed at repo root as
  [`storage.cors.json`](./storage.cors.json) — origin `*`, GET/HEAD only; the
  objects themselves are still guarded by Storage rules + download tokens). This
  also fixes remote tradie logos/banners in invoice PDFs. Re-apply with the same
  command if the bucket is ever recreated. (Google account photos on
  `googleusercontent.com` are a different host and rely on Google's own CORS.)
- **Also fixed in code:** the card image loader was running `encodeURI` on the
  photo URL, double-encoding `%2F` in Storage download URLs (404 → initials).

### [ ] Order a proof pack before any run

- **Why:** The QR is live — a typo or wrong link wastes the whole print order.
- **What:** Generate the card, scan the QR from the preview, then order **one
  proof pack** from a Canadian gang-run printer (Jukebox or Vistaprint.ca cheap;
  MOO for premium gift feel — 16pt + soft-touch recommended). See doc §2.

### [ ] Capture a mailing address for annual members (the blocker for auto-mail)

- **Why:** We only collect a *service area*, not a postal address to receive mail.
  Mailing the gift **requires** a verified shipping address.
- **What:** Add an opt-in "where should we send your welcome card?" step to the
  annual-membership flow (or a one-time prompt). Verify it (PostGrid AddressComplete).

### [ ] (If automating) PostGrid/Lob account + server-side renderer

- **Why:** End-to-end auto-mail (Path B in the doc) needs a print-&-mail API and a
  way to render the card outside the browser.
- **What:** PostGrid (Canadian, primary) or Lob account + API key as a Functions
  secret; a Cloud Run/`node-canvas` renderer reusing `drawCardFace`; a
  `cardFulfillments/{uid}` collection to dedupe + enforce the 500 cap.
- **Note:** Start with the **semi-automated** path (Path A: batch-export PDFs + a
  CSV to the provider's dashboard) for the first 500 — no new backend.

---

## Support desk — monitored reply inbox (added 2026-06-17)

Admins can now reply to Help Center tickets from `/admin/support` (AI-drafted +
branded send). When sent in **"reply"** mode, the email's **Reply-To** is set to
`hello@blueseal.app` (override via the `SUPPORT_REPLY_TO` env var on the Cloud
Functions runtime) so the customer's reply reaches a human. The branded email is
sent **From** the verified no-reply sender via the Trigger Email extension; we do
NOT ingest inbound email — replies land in that mailbox and are read manually.

### [ ] Stand up `hello@blueseal.app` as a real, monitored mailbox

- **Why:** Customer replies to support emails go there. If it doesn't exist (or
  isn't watched), replies bounce / are lost.
- **What:**
  1. Create/route `hello@blueseal.app` (a real inbox or a forward to wherever
     support is read), and confirm the `blueseal.app` domain can RECEIVE mail
     (MX records). Sending already works via the verified domain.
  2. (Optional) If you'd rather use a different reply address, set
     `SUPPORT_REPLY_TO=<address>` on the Functions runtime and redeploy
     `sendSupportTicketReply`.
- **Verify:** Send yourself a reply from `/admin/support` in "reply" mode, hit
  reply in your mail client → it arrives at the monitored inbox.

---

## QA toolkit — disable before public launch (added 2026-06-16)

A self-serve QA toolkit shipped so the QA team can stand up their own test state without admin power: a new **`qa`** role (admin-granted only, via Admin → Users), a `/qa` view to provision an approved tradesperson on any trade + toggle their own Pro + reset their own data, a global **Report a bug** button (`bugReports` + `/admin/bug-reports` triage), and QA read/resolve access to the existing `errorLogs`. The two *fabrication* callables (`qaProvisionSelfTradesperson`, `qaSetSelfPro`) are env-gated by **`QA_TOOLKIT_ENABLED`**, currently **`true`** in `functions/.env.blueseal-762af` (safe pre-launch — no live users). Provisioned QA tradesperson profiles are tagged `tradespeople/{uid}.isQa = true`.

### [ ] Before real users arrive: turn the toolkit off + sweep QA data

- **Why:** The provisioning callables can fabricate an approved/visible tradesperson and grant Pro with no Stripe — fine for a no-users test deployment, but it must not be reachable once real clients can find these accounts in search.
- **What:**
  1. Set `QA_TOOLKIT_ENABLED=false` (or remove the line) in `functions/.env.blueseal-762af`, then `firebase deploy --only functions:qaProvisionSelfTradesperson,functions:qaSetSelfPro`. The callables then throw `failed-precondition` ("QA toolkit is disabled in this environment").
  2. Revoke the `qa` role from tester accounts (Admin → Users → untick **qa**).
  3. Sweep QA-created data — delete `tradespeople` docs where `isQa == true` (and their jobs/posts), or have each tester run **Reset my data** first.
  4. Optional hardening: exclude `isQa` pros from public search by adding a `discoverable`-style `if (data.isQa) continue;` at the two query sites in `src/firebase/services/tradespeople.ts`.
- **Verify:** As a qa tester after the flip, `/qa` → *Provision me* returns the "disabled in this environment" error; search returns no `isQa` profiles.

---

## Uninsured-work waiver — legal review (added 2026-06-16)

Blue Seal now records explicit, signed acknowledgments around insurance so work can proceed safely:

1. **No insurance at all.** The **client** signs off (at request time + on the quote-acceptance signature) that they were told the tradesperson is uninsured; the **tradesperson** signs an in-app waiver before they can clock in (sole liability + release). Records live in `insuranceWaivers/{jobId}`.
2. **Own policy that doesn't name Blue Seal.** When a tradesperson uploads their own liability policy, they declare whether **Blue Seal is an additional insured**. If yes → an admin confirms it against the certificate before approving. If no → the tradesperson signs an in-app **liability release** (stored on `insuranceVerifications/{uid}.liabilityRelease`, signature at `tradespeople/{uid}/signatures/`). Foxquilt (the insurance partner) names Blue Seal automatically, so those answer "yes".

Supporting contract language is in **Terms of Service § 4.3** (and §§ 4.1, 4.2, 14, 15, 16). All code is live.

### [ ] Have a lawyer review the waiver / disclosure / release wording

- **Why:** This is the legal shield protecting Blue Seal, clients, and tradespeople. The copy was written by Claude, not a lawyer — it needs a real review to be relied on, especially the liability releases and the "no assumption of liability by Blue Seal" framing.
- **What to review:**
  - ToS § 4.3 "Acknowledging and proceeding with an uninsured Tradesperson" — `legal/terms-of-service.md`.
  - All disclosure / waiver / release copy — `src/data/insuranceWaiver.ts` (`clientUninsuredBody`, `TRADIE_WAIVER_POINTS`, `INSURANCE_RELEASE_POINTS`, etc.).
- **If wording changes materially:** bump the matching version constant in **both** `src/data/insuranceWaiver.ts` and `functions/src/lib/insurance.ts` (they must stay in sync) so new signatures stamp the new version, then redeploy functions. Two versions: `UNINSURED_DISCLOSURE_VERSION` (per-job uninsured waiver) and `INSURANCE_RELEASE_VERSION` (own-policy release).
- **Operating legal name (now load-bearing):** for "additional insured" to mean anything, the certificate must name the correct legal entity. Resolve the `[OPERATOR LEGAL NAME]` placeholder in the ToS (§§ intro, 21) and decide the exact entity name tradespeople (and Foxquilt) should put on policies as the additional insured.

---

## Insurance partner referral (added 2026-06-15)

Blue Seal surfaces a partner-agnostic "Get covered" / "Get insured in minutes" insurance referral throughout the tradesperson experience (onboarding card, dashboard banner — which also has an "Upload my insurance" popup — the soft bid/quote reminder dialog, and the uninsured-work waiver) and sends automated renewal reminders before a verified policy lapses. **Partner: Foxquilt** — a Foxquilt policy names Blue Seal as an additional insured, which also satisfies the additional-insured check on upload. The CTAs deliberately don't name the partner. The code is live; the CTA currently points at **Foxquilt's public site as a placeholder** (`src/data/insurancePartner.ts`).

### [ ] Get the Foxquilt embeddable quote widget (preferred) — or, interim, a tracked link

- **Foxquilt is providing an embeddable HTML quote widget once fully signed up.** That's the better integration: pros get a quote / buy in-app instead of being bounced to an external site.
  - **When you have the embed snippet, ping Claude** — I'll swap the external "Get insured" links for an in-app embed (iframe in a dialog), reusing the same CTA buttons. Small change.
- **Interim (until the embed is ready):** set the tracked referral link so clicks are attributed:
  1. `.env` as `VITE_INSURANCE_PARTNER_URL=...` (local builds).
  2. GitHub → **Settings → Secrets and variables → Actions** → add `VITE_INSURANCE_PARTNER_URL` (deploy.yml / ci.yml already read the `VITE_*` build env). Then push to main / run the Deploy workflow so hosting rebuilds with it.
- **Verify:** On a tradesperson account, the dashboard banner / bid-without-insurance dialog / waiver "Get insured" button opens **your** link (not the generic site) in a new tab.

### [ ] (Optional, partner-dependent) Real policy / renewal sync

- **Why:** Renewal reminders currently fire off our **own** verified-insurance expiry date, not the insurer's records. A signed embedded/API partnership (e.g. Foxquilt or APOLLO) could feed real policy status + renewal dates back, so reminders reflect the actual policy and a pro can buy/renew without leaving the app.
- **What:** Raise this in the partner conversation; if they expose a quote/policy API or webhook, we wire it then. No action until a partnership is signed.

---

## Supplies marketplace — affiliate program sign-ups (added 2026-06-16)

The job view's **Work order** tab has a tradesperson-only **Supplies** panel (`src/components/SuppliesPanel.vue`) — search a vetted Canadian supplier for what a job needs, then log the purchase as a job expense in one tap. Full per-supplier setup walkthrough: [docs/AFFILIATE_SETUP.md](docs/AFFILIATE_SETUP.md); local-dealer strategy: [docs/LOCAL_SUPPLIER_STRATEGY.md](docs/LOCAL_SUPPLIER_STRATEGY.md).

**Status: built but NOT live — kept dark behind a flag.** The whole panel is gated on `import.meta.env.VITE_SUPPLIES_ENABLED === "true"` (`src/features/jobDetail/WorkOrderTab.vue`), default **off**, so it doesn't render in the app yet. Supplier links currently point at retailers' **public sites as placeholders** (`src/data/supplyPartners.ts`) — it's revenue-ready, not revenue-live.

### [ ] Launch the Supplies section (when it's ready)

- **Why:** the feature is finished but intentionally hidden until we decide it's ready for users.
- **What:**
  1. Set `VITE_SUPPLIES_ENABLED=true` in `.env.production` (and `.env.local` to preview locally), then redeploy hosting (`npm run deploy:prod`). No code change — same pattern as `VITE_GOOGLE_BUSINESS_ENABLED`.
  2. Restore the **Supplies help content** in `src/data/help.ts` (the "Finding supplies" paragraph in the work-order article + the two Supplies FAQs were removed while the feature is hidden, so the Help Center stays accurate). They're in git history on the Phase 0/3 commits if you want the exact copy back.
  3. Ideally set at least the **Amazon tag** first (below) so it launches revenue-live, not just live.
- **Verify:** on a tradesperson account, open a job → Work order tab → the **Supplies** panel renders above Expenses.

### [ ] Apply to the affiliate programs and set each tracking link

- **Why:** Until each approved affiliate/tracking URL is set, the "Shop" links point at the retailer's generic site — clicks aren't attributed to Blue Seal, so no commission is tracked. (Click intent is already logged via Firebase Analytics: `supply_partner_click` / `supply_expense_prefill`.)
- **What:** Apply to each program, then set the issued tracking link via the matching env var (no code change). The fallback public URLs keep the panel working in the meantime.

  | Partner (`id`) | Program / network | Env var |
  | --- | --- | --- |
  | Amazon.ca (`amazon_ca`) | Amazon Associates Canada — **also set the tag** below | `VITE_SUPPLY_AMAZON_CA_URL` |
  | The Home Depot Canada (`homedepot_ca`) | Impact / Rakuten | `VITE_SUPPLY_HOMEDEPOT_CA_URL` |
  | Home Depot Tool Rental (`homedepot_rental`) | (same program as above) | `VITE_SUPPLY_HOMEDEPOT_RENTAL_URL` |
  | RONA (`rona`) | RONA affiliate program | `VITE_SUPPLY_RONA_URL` |
  | Canadian Tire (`canadian_tire`) | Rakuten | `VITE_SUPPLY_CANADIAN_TIRE_URL` |
  | Sunbelt Rentals Canada (`sunbelt_rentals`) | direct partner deal | `VITE_SUPPLY_SUNBELT_URL` |
  | Mark's (`marks`) | Rakuten (Canadian Tire group) | `VITE_SUPPLY_MARKS_URL` |
  | Work Authority (`work_authority`) | direct / network | `VITE_SUPPLY_WORK_AUTHORITY_URL` |
  | QuickBooks Canada (`quickbooks_ca`) | Intuit affiliate (Impact) | `VITE_SUPPLY_QUICKBOOKS_URL` |
  | FreshBooks (`freshbooks`) | FreshBooks affiliate | `VITE_SUPPLY_FRESHBOOKS_URL` |

  Set each in **both**: (1) `.env` for local builds, and (2) GitHub → **Settings → Secrets and variables → Actions** (deploy.yml / ci.yml already pass `VITE_*` into the build), then push / run the Deploy workflow so hosting rebuilds.

  **Amazon is the easy win — do this one first.** Amazon Associates attributes via a `?tag=` query param, so once you have your store tag (e.g. `blueseal-20`), set **`VITE_SUPPLY_AMAZON_CA_TAG`** and *every* Amazon link in the panel — the tiles **and the search box / shopping deep-links** — is affiliate-tracked automatically. No tracking redirect needed; leave `VITE_SUPPLY_AMAZON_CA_URL` at the default. (Other retailers use redirect wrappers, so only their tile link is attributed until the network supports query-level tracking.)
- **Disclosure:** the panel already shows an "we may earn a commission" line, and there's a transparent Help Center FAQ ("Does Blue Seal earn from the supplier links?") — keep these accurate to satisfy program terms (Amazon Associates in particular **requires** a visible disclosure).
- **Verify:** on a tradesperson account, open a job → Work order tab → Supplies → "Shop" opens **your** tracking link (not the generic site) in a new tab.

### [ ] (Optional, fast-follow) Search-level attribution + per-trade catalog

- **Why:** v1 attributes the tile "Shop" click via the partner `url`; the search box deep-links the retailer's public search, which most networks won't attribute. Amazon Associates is the easy win — its tag appends to any search URL.
- **What:** when the Amazon tag is issued, fold it into `buildSearchUrl()` so searches are attributed too. A future per-trade quick-pick catalog (Phase 2) is purely additive — no human task.

---

## Web push notifications (added 2026-06-10)

Push notifications (FCM) ship **safe-by-default**: until the key below is set, the
Account → Notifications push toggle stays hidden and nothing sends. The code is
live (client `src/firebase/services/push.ts`, SW `public/firebase-messaging-sw.js`,
server fan-out in `functions/src/lib/notify.ts`, `users/{uid}/devices` rules).

### [ ] Generate the Web Push certificate (VAPID key) and set it in the env

- **Why:** The browser push subscription requires a Web Push certificate key pair; without it `getToken()` can't run, so the whole feature stays dormant.
- **What:** Firebase Console → **Project settings → Cloud Messaging → Web configuration** → **Generate key pair**. Copy the public key into:
  1. `.env` as `VITE_FIREBASE_VAPID_KEY=...` (for local builds) — ✅ done 2026-06-10
  2. GitHub → repo **Settings → Secrets and variables → Actions → New repository secret**, name `VITE_FIREBASE_VAPID_KEY`, value = the same key (deploy.yml already reads it). It's a *public* key (ships in the JS bundle) — Secrets is just where the workflow sources build config, matching the other `VITE_*` values.
  Then push to main (or run the Deploy workflow) so hosting rebuilds with it.
- **Verify:** Account → Notifications now shows the **Push notifications** toggle. Enable it on a desktop Chrome profile → permission prompt → toggle sticks, and a doc appears under `users/{your-uid}/devices`. Send yourself a test (e.g. have a second account message you on a job) with the tab **closed** → an OS notification arrives and tapping it opens the right job. On iPhone: install the PWA to the home screen first, then enable push inside it (iOS 16.4+).

---

## Google Business reviews integration (added 2026-06-06)

Opt-in "Connect Google Business" for verified tradespeople: they OAuth-connect their Google Business Profile and we display their Google reviews in a separate, attributed section on their public profile (never merged into the native Blue Seal rating). The whole feature ships **safe-by-default** — the callables return "Google Business integration isn't configured yet", the scheduled daily sync no-ops, and the profile section stays hidden until everything below is set. Nothing breaks while it's unset.

The code is live (functions `startGoogleBusinessConnect`, `googleOAuthCallback`, `syncGoogleReviews`, `disconnectGoogleBusiness`, `scheduledGoogleReviewsSync`; the public `tradespeople/{uid}.googleReviews` snapshot; the server-only `tradespeople/{uid}/secure/google` credential doc). The setup below is all yours.

> ⚠️ **Start the access request FIRST — it's the long pole.** Google's reviews endpoint is access-gated and approval runs **several days to several weeks** (some applicants report 3+ months or denials). Everything else here is quick, but none of it produces reviews until this clears. Kick it off before doing the rest.

### [ ] Request access to the Business Profile APIs (the long pole — do this first)

- **Why:** Reviews live on the legacy `mybusiness.googleapis.com/v4` endpoint, which a new Google Cloud project has **zero quota** for until Google manually approves an access request.
- **What:** In the GCP project, request access via Google's [Business Profile APIs access form](https://developers.google.com/my-business/content/prereqs). You'll need a verified Google Business Profile active 60+ days, a valid business website (`https://blueseal.app`), and a description of the use case ("display a connected tradesperson's own Google reviews on their Blue Seal profile, with their consent, via OAuth").
- **Verify:** In **APIs & Services → Enabled APIs**, the My Business APIs show quota > 0 (not "0 / day"). Until then, `listReviews` returns 403 and the sync records a soft `syncError` on the snapshot.

### [ ] Enable the three Google APIs on the project

- **What:** `gcloud services enable mybusinessaccountmanagement.googleapis.com mybusinessbusinessinformation.googleapis.com mybusiness.googleapis.com --project blueseal-762af` (or Enable each in Cloud Console). The first two (accounts + locations) are open; the third (reviews) needs the access request above to actually return data.

### [ ] Create the OAuth consent screen + OAuth client

- **Why:** Tradespeople grant access via OAuth; we need a client ID/secret and the `business.manage` scope.
- **What:**
  1. **APIs & Services → OAuth consent screen** → External. Add the scope `https://www.googleapis.com/auth/business.manage`. Add your support + developer emails. Publish the app (or add test tradespeople while in "testing").
  2. **APIs & Services → Credentials → Create credentials → OAuth client ID → Web application.**
  3. Under **Authorized redirect URIs**, add the deployed `googleOAuthCallback` function URL (see next task) — it must match `GOOGLE_OAUTH_REDIRECT_URI` **exactly**.
  4. Note the **Client ID** and **Client secret**.

### [ ] Deploy the functions + rules, then capture the callback URL

- **Why:** The redirect URI registered on the OAuth client must be the live function URL, and the field-lock + server-only rules must be live before the snapshot writes land (CLAUDE.md rule #8).
- **What:**
  1. `firebase deploy --only firestore:rules` (adds the `googleReviews` field lock + the server-only `tradespeople/{uid}/secure/{docId}` rule).
  2. `firebase deploy --only functions:googleOAuthCallback` and note the printed HTTPS URL (looks like `https://googleoauthcallback-xxxxxx-uc.a.run.app`). That URL is `GOOGLE_OAUTH_REDIRECT_URI`. (Optionally front it with a hosting rewrite to `https://blueseal.app/api/google/callback` for a cleaner URL — if you do, use *that* as the redirect URI instead.)
  3. Add the URL to the OAuth client's Authorized redirect URIs (previous task).
  4. Deploy the rest: `firebase deploy --only functions`.

### [ ] Set the secrets + env vars on Cloud Functions

- **Why:** `config.ts` reads these; `isConfigured()` gates the whole feature on all four being present. Secrets appear in the runtime env once bound.
- **What:**
  ```
  firebase functions:secrets:set GOOGLE_OAUTH_CLIENT_SECRET   # the OAuth client secret
  firebase functions:secrets:set GOOGLE_TOKEN_ENC_KEY         # 32 random bytes, base64 — generate with: openssl rand -base64 32
  ```
  > **⚠️ Placeholder values are currently set.** Both secrets were given throwaway values (a literal `PLACEHOLDER…` string for the OAuth secret; a random base64 key for the enc key) so that *unrelated* function deploys aren't blocked by the non-interactive "no value for the secret" error. They are **not real** — overwrite both with the commands above before flipping `VITE_GOOGLE_BUSINESS_ENABLED` on, or the connect flow will fail. The enc-key placeholder is unused while the feature is off, so replacing it now is safe (no connections exist yet to orphan).
  And set the two non-secret env vars on the functions runtime (e.g. Cloud Console → each `google*` function → Runtime env vars, or your env file):
  - `GOOGLE_OAUTH_CLIENT_ID` — the OAuth client ID (public half).
  - `GOOGLE_OAUTH_REDIRECT_URI` — the exact callback URL from the task above.
  Then redeploy so the functions pick them up: `firebase deploy --only functions`.
- **Verify:** As a verified tradesperson, **Account → Tradesperson → Google reviews → Connect Google Business** → Google consent → you land back on the Tradesperson tab with a "Google Business connected" toast, and your Google rating shows on your public profile. Disconnect removes it immediately.
- **⚠️ Don't rotate `GOOGLE_TOKEN_ENC_KEY` after tradespeople connect** — it decrypts their stored refresh tokens. Rotating it orphans every existing connection (they'd each have to reconnect).

### [ ] Flip `VITE_GOOGLE_BUSINESS_ENABLED=true` to unhide the connect UI (do LAST)

- **Why:** The "Connect Google Business" panel in **Account → Tradesperson** is hidden behind a frontend flag (`VITE_GOOGLE_BUSINESS_ENABLED`, OFF by default) so tradespeople don't see a connect button that errors with "not configured" while the setup above is incomplete. The public-profile Google reviews section self-gates on real data and needs no flag. Do this step **only after** the OAuth client, function deploy, and the four env/secret values above are all live and the verify step passed.
- **What:** Set `VITE_GOOGLE_BUSINESS_ENABLED=true` in `.env.production` (and `.env.local` for local testing against real Google), then redeploy hosting (`npm run deploy:prod`). No code change — the gate is `import.meta.env.VITE_GOOGLE_BUSINESS_ENABLED === "true"` in `src/views/AccountView.vue`.
- **Verify:** As a verified tradesperson, **Account → Tradesperson** now shows the "Google reviews" accordion. With the flag unset/`false`, that accordion is absent.

---

## "Describe what you need" search — AI matcher REMOVED (updated 2026-06-05)

The public "Ask Blue Seal AI" trade-matcher was **removed**. We didn't want a Vertex/Gemini endpoint any signed-in user could trigger on the public search page; the deterministic, offline keyword matcher (`src/data/tradeKeywords.ts`) is now the sole trade-finder and was made substantially more robust to compensate. The `aiSuggestTrades` callable, its client wrapper, and the "Ask Blue Seal AI" button are all gone from the codebase.

### [x] Deleted the live `aiSuggestTrades` function from prod (2026-06-05)

- **What happened:** Despite the original deploy task never being checked off, `aiSuggestTrades` *was* live in prod (us-central1) — so the public Vertex endpoint really did exist. Removed it surgically with `firebase functions:delete aiSuggestTrades --region us-central1 --force` (a targeted delete, not a full functions redeploy — the other ~80 functions were left untouched).
- **Verified:** `firebase functions:list` no longer shows `aiSuggestTrades`.

---

## SEO + LLM discoverability pass (added 2026-06-03)

The full SEO foundation shipped in code: per-route metadata + Open Graph/Twitter cards + JSON-LD (`@unhead/vue` via `useSeo`), build-time prerendering of all public content pages (so crawlers and LLMs that don't run JavaScript get real HTML — `scripts/prerender.ts`), a generated `sitemap.xml` + `llms.txt`, 57 per-trade landing pages (`/trades`, `/trades/:trade`), a tightened `robots.txt`, and a fix for the PWA install icons (the manifest pointed at non-existent `android-chrome-*` files). Everything deploys with a normal `firebase deploy --only hosting`. A few things only you can do:

### [x] Open Graph share image — accepted: using the brand logo for now (2026-06-03)

- Decision: ship with the square 2048×2048 brand mark (`public/icons/blueseal_logo_LARGE.png`) as the default share image. It's valid and renders fine; a dedicated 1200×630 landscape card can be added later by saving it to `public/og/default.png` and pointing `DEFAULT_OG_IMAGE` (`src/seo/site.ts`) at it.

### [ ] Verify the site in Google Search Console + Bing, submit the sitemap

- **Why:** Verification unlocks indexing insight (coverage, queries, Core Web Vitals) and lets you submit the sitemap so discovery isn't left to chance.
- **What:** Add `blueseal.app` in [Google Search Console](https://search.google.com/search-console) and [Bing Webmaster Tools](https://www.bing.com/webmasters) (DNS TXT or HTML-file verification — if HTML-file, drop it in `public/`). Submit `https://blueseal.app/sitemap.xml` in both. Confirm `https://blueseal.app/robots.txt` and `https://blueseal.app/llms.txt` resolve.
- **Verify:** Use GSC's **URL Inspection** on `/`, a `/trades/:trade` page, and a `/help/:slug` page — each should report the baked title/description and be eligible for indexing. Run the [Rich Results Test](https://search.google.com/test/rich-results) on the homepage (Organization + FAQ) and a trade page (Service).

### [ ] (Optional) Dynamic per-profile social images for tradespeople

- **Why:** Tradesperson profiles (`/tradies/:uid`) are indexable and carry `Person` JSON-LD, but their share image is the generic default and they rely on JS rendering (they're dynamic, so not prerendered). A small Cloud Function that renders a per-profile OG card — and/or on-demand prerendering for verified profiles — would sharpen sharing + non-JS-crawler visibility. Deferred; not needed for launch.

---

## Help Center + support portal (added 2026-06-03)

The Help Center (`/help`), FAQ (`/faq`), and homepage feature showcase shipped fully working. Content is hardcoded in `src/data/help.ts` (no CMS — edit it in code; see CLAUDE.md → "Help Center & FAQ upkeep"). The contact form now files real support tickets that admins triage at `/admin/support`. Two follow-ups need you:

### [ ] ⚠️ Deploy the `supportTickets` Firestore rules (REQUIRED before the ticket form works in prod)

- **Why:** The Help Center contact form writes a `supportTickets` doc for signed-in users, and `/admin/support` reads/triages them. The new security rules for that collection are committed in `firestore.rules` but **were not deployed from the web session (it can't run `firebase deploy`)** — so per CLAUDE.md rule #8 they must be deployed before this ships to prod.
- **Safe by design:** until the rules are live, the contact form **automatically falls back to the email (mailto) flow** on a permission error, so nothing is user-visibly broken in the meantime — you just won't see tickets in `/admin/support` yet.
- **What:** `firebase deploy --only firestore:rules` → confirm `✔ Deploy complete!`. (Rules-only; no functions/indexes/storage changed.)
- **Verify:** Signed in, open `/help` → **Contact support** → send a message → it appears in `/admin/support`; change its status; a non-admin can't read tickets. The rules tests already cover all of this (`tests/rules/supportTickets.test.ts`, green locally).

### [ ] Confirm the support email address

- **Why:** Signed-out visitors (and the fallback path) compose a prefilled email to a support inbox. The address is currently a **placeholder** (`SUPPORT_EMAIL = "support@blueseal.ca"` in `src/data/support.ts`). The admin "Reply" button also emails the ticket's sender.
- **What:** Set up the real support inbox and update `SUPPORT_EMAIL` to match. No deploy needed beyond shipping hosting.
- **Verify:** Signed out, open `/help` → **Contact support** → **Send message** opens your mail client addressed to the right inbox with subject/body prefilled.

---

## Seeded prospects — outreach + magic-link claim (added 2026-06-01)

The seeded-prospect directory + claim flow ships safe-by-default: leads are
created, but **no outreach email is sent and no magic-link claim works** until
the items below are set. Nothing breaks while they're unset.

### [x] Enable email-link (passwordless) sign-in + authorize the claim domain — ✅ DONE 2026-06-12

- **Why:** The claim flow uses a Firebase magic sign-in link — clicking it proves the prospect controls their inbox and signs them in with a verified email (`claimProspect` gates on `email_verified`). Without this, `generateSignInWithEmailLink` throws and outreach silently skips the email.
- **What:** Firebase Console → Authentication → Sign-in method → enable **Email link (passwordless sign-in)**. Then Authentication → Settings → Authorized domains → ensure your app domain (and `localhost` for testing) is listed so the `/claim` continue URL is allowed.
- **Verify:** Request a seeded prospect as a client (with the env below set) → the outreach email arrives with a "See the request" magic link → clicking it lands on `/claim`, signs you in, and converts the request into a job.

### [x] Set the CASL outreach env vars on Cloud Functions — ✅ DONE 2026-06-12 (`BLUE_SEAL_MAILING_ADDRESS` + `PROSPECT_UNSUB_SECRET` set in `functions/.env`; `BLUE_SEAL_LEGAL_NAME` left at default "Blue Seal")

- **Why:** CASL requires every outreach email to carry the sender's physical mailing address + a working unsubscribe. These are gated: until set, `sendOutreachEmail` returns without sending.
- **What:** set on the functions runtime:
  - `BLUE_SEAL_MAILING_ADDRESS` — a valid physical mailing address (registered office or PO box), current ≥60 days. **Required for any send.**
  - `BLUE_SEAL_LEGAL_NAME` — optional; legal entity name in the footer (defaults to "Blue Seal").
  - `PROSPECT_UNSUB_SECRET` — a long random secret. The unsubscribe token is `HMAC(secret, prospectId)` (never stored), so this must be set for unsubscribe links to validate. **Required for any send.**
- **Verify:** With all set, the outreach footer shows the mailing address + a working "Unsubscribe" link; clicking it drops the prospect from search and tombstones them (never re-imported).

### [ ] Legal sign-off on the CASL consent basis

- **Why:** Outreach relies on the "conspicuous publication" implied-consent basis (only rows with `emailConspicuouslyPublished: true` are emailed) + the "only on a real client request" relevance argument.
- **What:** Have counsel confirm the basis before the first real send. The footer wording is row-accurate (varies by `dataConsentBasis`), and provenance (`sourceUrl`, `dataConsentBasis`) is retained on every prospect for the audit trail.

> **Also depends on the two items above (added 2026-06-11):** the
> **bring-your-own-client job invite emails** (`createInviteJob` /
> `resendJobInvite` / `sendJobInviteSignInLink`) reuse this exact setup —
> email-link sign-in + authorized domain (the continue URL is `/claim-job`),
> `BLUE_SEAL_MAILING_ADDRESS`, and `PROSPECT_UNSUB_SECRET` (invite unsubscribe
> tokens are `HMAC(secret, "invite_" + jobId)`). Until those are set, invite
> jobs still work but degrade to **copy-link-only** delivery (the tradesperson
> texts the link; the client confirms their email on `/invite/:token` —
> which then ALSO needs email-link sign-in enabled to actually send the
> magic link). Net: solo mode works fully today; client claiming needs the
> email-link toggle at minimum.

---

## Monetization pivot — Stripe Connect Express (added 2026-05-24)

Replacing the AI subscription with a 12% commission via Stripe Connect Express. Phase A wires the connection: callable to create Connect Express accounts, hosted onboarding link, login link, and an `account.updated` webhook that mirrors Stripe state onto `tradespeople/{uid}.payouts`. Payment / payout / refund / dispute webhook events land in Phase B alongside the `sendInvoice` rewrite.

Until the items below are done, the Connect callables return a "Stripe is not configured" error (because the secrets aren't bound) and the webhook 400s on every event (signature verification fails without `STRIPE_WEBHOOK_SECRET`). Existing offline-payment flow continues to work.

See `PROFESSIONAL_TASKS.md` for the parallel lawyer + accountant work that gates launch (FINTRAC opinion, GST/HST treatment, etc.).

### [ ] Enable Stripe Connect on the platform account

- **Why:** Express accounts can only be created if Connect is activated on the Blue Seal Stripe account and the platform agreement is signed.
- **What:**
  1. Sign in to the [Stripe dashboard](https://dashboard.stripe.com) on the production Blue Seal account.
  2. Connect → Get started → choose **Express** as the account type. Accept Stripe's Platform & Connected Account Agreements.
  3. Complete the platform profile: legal entity (matches what the lawyer/accountant set up), website (`https://blueseal.app`), support email, business model description ("home-services marketplace connecting verified Canadian tradespeople with clients").
  4. Configure the **branding** (colour, logo, icon) — Express onboarding shows Blue Seal branding to the tradesperson during sign-up.
- **Verify:** The Connect overview shows "Live: Yes" and the "Connected accounts" tab is empty (we haven't created any in prod yet).

### [ ] Set Stripe secrets on Cloud Functions

- **Why:** `createConnectAccount`, `createConnectOnboardingLink`, `createConnectLoginLink`, and `stripeWebhook` all declare `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` as `defineSecret(...)` params. Without them bound, the callables throw at first use and the webhook can't verify signatures.
- **What:** From the repo root with the Firebase CLI authenticated:
  ```
  firebase functions:secrets:set STRIPE_SECRET_KEY
  firebase functions:secrets:set STRIPE_WEBHOOK_SECRET
  ```
  Paste the live `sk_live_…` key (Dashboard → Developers → API keys) when prompted for `STRIPE_SECRET_KEY`. `STRIPE_WEBHOOK_SECRET` you'll get after the next task (it's the signing secret of the webhook endpoint you create).
- **Verify:** `firebase functions:secrets:access STRIPE_SECRET_KEY` returns the expected key. Redeploy is required after a new secret is set so the function reads the new value: `firebase deploy --only functions:createConnectAccount,functions:createConnectOnboardingLink,functions:createConnectLoginLink,functions:stripeWebhook`.
- **Also do at the same time:**
  1. Re-enable the 5 Stripe-binding exports in [functions/src/index.ts](functions/src/index.ts) — `sendInvoice`, `createConnectAccount`, `createConnectOnboardingLink`, `createConnectLoginLink`, `stripeWebhook`. They were commented out so deploys could go through before the secrets existed (search for `TODO(stripe-setup)`).
  2. Grant the CI service account Secret Manager permissions so future deploys can bind the secrets to function runtime SAs:
     ```
     gcloud projects add-iam-policy-binding blueseal-762af \
       --member="serviceAccount:blueseal-ci@blueseal-762af.iam.gserviceaccount.com" \
       --role="roles/secretmanager.admin"
     ```

### [ ] Register the Stripe webhook endpoint

- **Why:** Stripe needs to know where to POST event notifications. The endpoint URL is the Cloud Function HTTPS URL of `stripeWebhook` after deploy.
- **What:**
  1. Deploy Functions once so the URL exists: `firebase deploy --only functions:stripeWebhook`. Note the URL Firebase prints (looks like `https://stripewebhook-xxxxxx-uc.a.run.app`).
  2. Stripe Dashboard → Developers → Webhooks → Add endpoint. URL = the deployed function URL. Events to listen for:
     - **Phase A (Connect)**: `account.updated`
     - **Phase B (payments) — wired**: `payment_intent.processing`, `payment_intent.succeeded`, `payment_intent.payment_failed`, `charge.refunded`
     - **Disputes — wired**: `charge.dispute.created`, `charge.dispute.closed`
     - **Payouts — wired**: `payout.created`, `payout.paid`, `payout.failed` (these are Connect events delivered with `event.account = acct_…`; ensure the webhook endpoint is registered to receive Connect events, not just platform events)
  3. After creating the endpoint, Stripe reveals its **signing secret** (`whsec_…`). Use that as the value when running `firebase functions:secrets:set STRIPE_WEBHOOK_SECRET`. Redeploy `stripeWebhook` so it picks up the new secret.
- **Verify:** From the dashboard's webhook detail view, click "Send test webhook" → choose `account.updated` → check that the response is 200 and that the `webhookEvents/` Firestore collection has a new doc with `status: "processed"`.

### [ ] Set `VITE_STRIPE_PUBLISHABLE_KEY` in the frontend env

- **Why:** The Stripe Elements payment form (`/invoices/:id/pay`) bootstraps Stripe.js with the publishable key. Without it, the view renders "Online payments aren't configured for this environment" and the Pay button is disabled.
- **What:** In `.env.production` (and `.env.local` for local dev against real Stripe), add:
  ```
  VITE_STRIPE_PUBLISHABLE_KEY=pk_live_...
  ```
  Use the live key (Dashboard → Developers → API keys) in prod and the test key (`pk_test_…`) in staging / local. The key is safe to ship to browsers — it's the public half of the keypair whose secret is `STRIPE_SECRET_KEY`.
- **Verify:** Build the frontend; in DevTools console, `import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY` should be the expected key. Test a payment in test mode using card `4242 4242 4242 4242` with any future expiry / any CVC / any zip.

### [ ] Run the one-shot payouts backfill in production

- **Why:** Tradesperson docs created before the Stripe Connect cutover don't carry the `payouts` field. The deferred `maybeMarkVisible()` tightening (Phase A residual) gates visibility on `payouts.payoutsEnabled === true` — without backfilling first, every existing approved tradie would drop out of search the moment the gate flips. The backfill seeds the `not_started` default so the gate-flip is a controlled rollout, not a cliff.
- **What:** Sign in as admin → Admin console → Migration tools → "Backfill payouts field" button. Single click triggers the `backfillPayoutsField` callable; it pages through all `vettingStatus == approved` tradies in batches of 400 and merge-writes `payouts: emptyPayoutsState()` onto any without the field. Idempotent.
- **Verify:** The toast on completion shows `scanned / updated / alreadyPresent / pages`. Re-running should report `updated: 0, alreadyPresent: <full count>`. Spot-check a few tradesperson docs in Firestore — every `vettingStatus == approved` doc should have `payouts.onboardingStatus = "not_started"` after the run.

### [ ] Configure `APP_BASE_URL` for the Connect onboarding redirects

- **Why:** `createConnectOnboardingLink` builds `refresh_url` + `return_url` from this env var (same one notify.ts uses for deep-links). Without it set, the tradesperson is redirected to `https://blueseal.app/payouts/return` regardless of environment.
- **What:** Already documented in the Notifications section above for the prod domain. For staging environments, set it to the staging hostname so test sign-ups don't bounce people to prod.
- **Verify:** Call `createConnectOnboardingLink` from a logged-in tradesperson session in staging → returned URL contains `staging.blueseal.app` (or whatever staging is) in the redirect query params.

---

## Blue Seal Pro + payment service fee — Stripe setup (added 2026-06-11)

This rolls out BOTH monetization layers (MONETIZATION.md): the client-paid
service fee on card payments (5%, $2 floor, capped $99/job, waived for Pro) and
the **Blue Seal Pro** subscription ($29 CAD/mo or $290 CAD/yr, 30-day
card-required trial). Most of the Stripe-side wiring is automated by
[`functions/scripts/stripe-setup.mjs`](functions/scripts/stripe-setup.mjs) —
the steps below are only what genuinely needs your account/identity/dashboard
access. **Do the whole thing in TEST mode first; only do the LIVE-mode tasks
once the sandbox passes end-to-end.** The code ships behind these secrets — until
they're set, the Stripe callables throw "not configured" and the rest of the app
(offline payments, the free app) keeps working.

### Stage 0 — Sandbox account (do first; blocks the Pro 3 deploy)

#### [ ] Create the Stripe account + enable Connect (test mode)
- **What:** Sign up at [dashboard.stripe.com](https://dashboard.stripe.com) (country **Canada**). No activation/KYC needed yet — test mode works immediately. Then, in test mode: **Connect → Get started → Express**, accept the Platform & Connected Account agreements. (If you already created the prod account for the earlier Connect task, just stay in **Test mode** via the dashboard toggle.)
- **Verify:** The dashboard shows Test mode; Connect → Settings is reachable.

#### [ ] Hand the test keys to Claude (or set them yourself)
- **What:** Dashboard → Developers → API keys (Test mode). Then:
  ```
  firebase functions:secrets:set STRIPE_SECRET_KEY        # paste sk_test_…
  firebase functions:secrets:set STRIPE_WEBHOOK_SECRET    # paste any placeholder for now (e.g. whsec_placeholder)
  ```
  And in `.env.local`: `VITE_STRIPE_PUBLISHABLE_KEY=pk_test_…`
- **Why:** The deploy needs both secrets to *exist* (the functions bind them); the real webhook secret is set after the endpoint is registered (next stage).

### Stage 1 — Automated (Claude runs these once the test key is set)

These are scripted, listed here so you know what's happening:
1. `STRIPE_SECRET_KEY=sk_test_… node functions/scripts/stripe-setup.mjs` → creates the **Blue Seal Pro** product, the **$29/mo + $290/yr CAD** prices, and the **Customer Portal** config (cancel-at-period-end, update card, switch monthly↔annual). Prints `STRIPE_PRICE_PRO_MONTHLY` / `STRIPE_PRICE_PRO_ANNUAL` → set as functions runtime **env params** (not secrets).
2. Deploy the functions (this is the Pro 3 / Pro 5 deploy that un-comments the Stripe exports), then re-run the script with `WEBHOOK_URL=<deployed stripeWebhook URL>` → registers the **one** webhook endpoint with the full event set (Connect + payment-intent + charge/dispute/payout + `checkout.session.completed` + `customer.subscription.*` + `invoice.payment_failed`) and prints the signing secret → `firebase functions:secrets:set STRIPE_WEBHOOK_SECRET` → redeploy `stripeWebhook`.
3. Run the existing `backfillPayoutsField` migration (see the Connect section above).

#### [ ] Configure subscription lifecycle (dashboard-only — you do this once)
- **What:** Dashboard → Settings → Billing → **Subscriptions and emails**: turn **Smart Retries** ON, and set "after all retries fail" → **Cancel subscription**. (This is what ends our `past_due` grace window — the resulting `customer.subscription.deleted` webhook flips the tradesperson out of Pro.) Optionally enable the trial-ending reminder email.
- **Verify:** The retry schedule shows "then cancel".

### Stage 2 — Go live (only after the full sandbox matrix passes)

#### [ ] Activate the Stripe account for live payments
- **What:** Complete business details + KYC; add Blue Seal's bank account (this is where the service-fee + subscription revenue settles); set the platform **statement descriptor** to `BLUESEAL` (Settings → Business → Public details) so card statements read `BLUESEAL* <tradie>`. Complete the **live-mode** Connect platform profile + agreements.
- **Verify:** Dashboard shows "Payments: active" and Connect "Live: Yes".

#### [ ] Swap to live keys + re-run the script in live mode
- **What:** Hand Claude the live keys (`sk_live_…` → `STRIPE_SECRET_KEY` secret; `pk_live_…` → `.env.production` `VITE_STRIPE_PUBLISHABLE_KEY`). Claude re-runs `stripe-setup.mjs` against the live key (product/prices/portal/webhook) and sets the live env params + webhook secret, then deploys functions + hosting.
- **Verify:** A small real card payment ($2–5 invoice) clears end-to-end and refunds from the dashboard; a real Pro checkout on your own card starts a trial ($0 charged) and cancels cleanly in the portal.

#### [ ] Legal sign-off (gates public LAUNCH, not the code) — see PROFESSIONAL_TASKS / MONETIZATION.md Phase 0
- GST/PST treatment of the service fee + the $29 subscription (BC: 5% GST + 7% PST — is the platform a marketplace facilitator obligated to collect?).
- ToS update: in-app-payment + capped service-fee disclosure (fee-payer + that it's avoidable via offline payment), subscription auto-renewal terms (BC consumer rules), 30-day trial terms, and the "Featured" paid-placement disclosure.
- FINTRAC/MSB comfort: Stripe Connect holds the funds (not Blue Seal) — defensible "not an MSB", but get the fintech/AML lawyer's confirmation in writing.

#### [ ] Run the founding-member comp grants (after Pro 5 ships, before the AI gate in Pro 7)
- **What:** Admin console → user search → each verified Okanagan tradesperson → **Blue Seal Pro (founding comp) → Grant 3 months**. (Backed by the `adminGrantFoundingPro` callable; sets `proCompUntil` with no Stripe involved.) Message them "Founding Tradesperson — 3 months of Blue Seal Pro on us." Do this BEFORE the AI gate deploys so nobody loses the assistant.
- **Verify:** The granted tradesperson's `tradespeople/{uid}.isPro` is `true`; their AI assistant stays unlocked after Pro 7.

---

## QuickBooks Online sync (Pro fast-follow — added 2026-06-11)

A Pro feature on the roadmap: one-way push of paid invoices (Customer + Invoice
+ Payment) into the tradesperson's QuickBooks Online company. The code is NOT
built yet — it's a fast-follow after launch — but Intuit's app review has a long
external lead time, so **start the developer-app approval now** and it'll be
ready by the time the sync ships.

### [ ] Create the Intuit developer app + submit for production
- **What:** Sign up at [developer.intuit.com](https://developer.intuit.com), create an app under the **Accounting** API, and capture the **Client ID / Client secret** (sandbox first). Add the OAuth **redirect URI** (`https://blueseal.app/integrations/quickbooks/callback` — final path TBD when the code lands). Then submit the app for **production** review (Intuit assesses security + OAuth handling; this is the slow, external step — days to weeks).
- **Why:** Production QBO access requires Intuit's approval. Submitting early means the approval runs in parallel with the rest of the launch instead of blocking the fast-follow.
- **Verify:** The app shows "Development" keys immediately (usable for sandbox testing); "Production" keys unlock after Intuit approves.
- **Note:** Live QuickBooks *sync* is roadmap-only — don't promise it on the pricing page until it ships. The accountant-ready **CSV export** (Reports → Export) is the launch-version substitute and is already live.

---

## AI assistant chatbot (added 2026-05-22)

Floating-panel assistant for tradespeople + admins. Backend lives in [functions/src/ai/chat.ts](functions/src/ai/chat.ts), conversations persist under `assistantConversations/{id}/messages/`. Runs on Vertex AI Gemini 2.5 Flash (same auth path as the existing `aiDiagnose` tools — no API keys needed once the API is enabled).

### [x] Re-enable the subscription gate before launch (obsolete 2026-05-24)

- **Resolution:** Cancelled by the monetization pivot. AI tools are now bundled into the platform offering — revenue comes from the 12% Stripe Connect commission per payment, not a separate AI subscription. The `REQUIRE_SUBSCRIPTION` flag + the subscription check in `chat.ts` / `tools.ts` were removed in the cutover commit. The dead `hasActiveSubscription` + `stripeCustomerId` fields on user docs were torn out in a follow-up commit (interface, signup writer, rules `hasOnly` allowlists + create/update equality locks all updated together). Existing user docs in prod still carry the fields as orphan booleans — harmless, ignored by rules and code, will fall off naturally as docs are next edited or via a one-shot cleanup script if it ever bothers anyone.

### [x] Stand up Firestore rules tests (done 2026-05-24)

- **Why:** CLAUDE.md mandates an allow + deny rules test for every collection, but the repo had no test harness — every new collection shipped without rules tests.
- **Done:** `@firebase/rules-unit-testing@^4` + `firebase-tools@^15` installed as devDeps. Harness lives at [tests/rules/setup.ts](tests/rules/setup.ts), separate vitest config at [vitest.rules.config.ts](vitest.rules.config.ts), runner script `npm run test:rules` wraps `firebase emulators:exec --only firestore` so the emulator starts/stops around the test command. Initial specs cover the four touch-points from the monetization-pivot Phase A schema commit (`payouts/`, `webhookEvents/`, `tradespeople` server-managed field locks, `invoices.payment` field lock). Future rules changes are expected to ship with matching tests in the same folder.
- **Outstanding:** Backfill specs for existing collections (`chats`, `jobs`, `jobPosts`, `assistantConversations`, etc.) — non-blocking. Add the script to CI as a separate job (needs Java in the runner image).
- **Verify:** `npm run test:rules` passes locally. Needs `firebase-tools` (devDep, ✓) + Java 11+ on the runner (CI runner image needs `openjdk-jre`).

### [ ] Confirm Vertex AI API is enabled on the GCP project

- **Why:** The chatbot reuses the existing Vertex AI plumbing from [functions/src/ai/tools.ts](functions/src/ai/tools.ts). If the API was already enabled for `aiDiagnose`, nothing more to do — this task is just a checkpoint so it's not forgotten on a fresh staging project.
- **What:** `gcloud services enable aiplatform.googleapis.com --project blueseal-762af` (or whichever project), or click Enable in Cloud Console → APIs & Services.
- **Verify:** Send a message from any tradesperson account; the function logs `aiChat: success` and the `aiUsage` collection gets a new doc with `tool: "chat"`.

---

## Notifications (added 2026-05-21, WhatsApp swap 2026-05-21)

Phase 3 wired email + WhatsApp fan-out into the `notify()` helper. The code writes to two collections (`mail/` and `whatsapp/`) — `mail/` is shaped for the Firebase Trigger Email extension you install; `whatsapp/` is processed by a function we ship in this repo ([functions/src/messaging/processWhatsAppMessage.ts](functions/src/messaging/processWhatsAppMessage.ts)) that calls Meta's WhatsApp Cloud API. Until the email extension is installed and WhatsApp credentials are set, the queues accumulate silently and flush retroactively once you complete the setup — nothing is lost.

> **About SMS:** Phase 3 originally shipped with SMS-via-Twilio as the high-priority channel. We swapped to WhatsApp on the same day because WhatsApp's free tier (1,000 conversations/month from Meta) makes it cost-effective at launch. SMS code stays dormant in [functions/src/lib/sms.ts](functions/src/lib/sms.ts) and the `sms/` rule remains in [firestore.rules](firestore.rules) — a future preferences UI can let users pick SMS over WhatsApp without re-introducing the schema.

### [x] Install "Trigger Email" Firebase extension — ✅ DONE 2026-06-12 (sender: **Resend**. SMTP `smtps://resend@smtp.resend.com:465`, FROM `Blue Seal <noreply@blueseal.app>`, REPLY-TO `hello@blueseal.app`. Pipeline verified end-to-end: mail/ → extension → Resend → inbox, `delivery.state=SUCCESS`.)

- **Why:** The `notify()` helper writes to `mail/` for every notification with priority `normal` or `high` (defined in [functions/src/lib/notify.ts](functions/src/lib/notify.ts)). Vetting decisions in [functions/src/vetting/decisions.ts](functions/src/vetting/decisions.ts) and invoice sends in [functions/src/invoicing/sendInvoice.ts](functions/src/invoicing/sendInvoice.ts) also rely on it directly via `enqueueMail`. Without the extension, queued docs accumulate and no email is sent.
- **What:** In the Firebase console → Extensions → install **Trigger Email** (by Firebase). When configuring:
  - Collection path: `mail`
  - SMTP connection URI: your SMTP provider (SendGrid, Mailgun, Postmark, AWS SES) — get the SMTP URL with embedded credentials from their dashboard.
  - Default FROM: e.g. `Blue Seal <no-reply@blueseal.app>` (set up domain verification first with the SMTP provider).
- **Verify:** After install, trigger a test by approving a vetting decision in admin. Check the `mail/` collection in Firestore — new docs should get a `delivery.state: "SUCCESS"` field within a minute.

### [ ] Set up WhatsApp Cloud API (Meta — free tier)

High-priority notifications (vetting approval, new direct-request job, application accepted, new applicant) fan out via WhatsApp. Meta gives 1,000 free service conversations/month per business; above that, charges per conversation (24-hour message window) at ~$0.005–0.10 CAD depending on country.

This is a multi-step setup with a ~1–3 day wait for template approval. Until you finish it, queued WhatsApp messages stay in the `whatsapp/` collection unsent — the in-app inbox + email still deliver normally.

**Sub-steps:**

1. **[ ] Create a Meta Business account + WhatsApp Business Account (WABA).** Follow [Meta's WhatsApp Cloud API setup guide](https://developers.facebook.com/docs/whatsapp/cloud-api/get-started). You'll need to verify your business (corporate registration docs) and add a phone number that's not already on consumer WhatsApp.
2. **[ ] Generate a system user access token + grab the phone number ID.** Both live in the Meta App Dashboard → WhatsApp → API Setup once your WABA is approved. Save these — you'll need them in step 4.
3. **[ ] Submit a notification template for approval.** Meta requires pre-approved templates for any message sent outside the 24-hour customer-service window — which is most of ours, since users haven't messaged the Blue Seal business number first. Submit a single-parameter "transactional" template:
   - **Name:** `blue_seal_notification` (or any name; remember it for step 4)
   - **Language:** `en_US`
   - **Category:** UTILITY (not MARKETING — utility templates are cheaper and faster to approve)
   - **Body:** `{{1}}` (just one parameter, which our helper fills with the notification title + body + link)
   - Approval usually arrives in 24–72 hours.
4. **[ ] Set three env vars on Cloud Functions:**
   ```
   firebase functions:config:set runtime.whatsapp_token="EAAxxxxx..." runtime.whatsapp_phone_id="123456789" runtime.whatsapp_template_name="blue_seal_notification"
   ```
   Or in the Google Cloud console → Cloud Functions → `processWhatsAppMessage` → Edit → Runtime environment variables. The processor reads `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_ID`, and optionally `WHATSAPP_TEMPLATE_NAME` + `WHATSAPP_TEMPLATE_LANG` (defaults `en_US`).
- **Verify:** Set a phone number on a test user via the account page, then trigger any high-priority event (admin approval is easiest). The user should receive a WhatsApp message within seconds. The `whatsapp/{id}` doc's `status` field flips to `sent` (success) or `failed` (with an `error` field — check the Meta response).
- **If you skip this for now:** Set `WHATSAPP_TOKEN` and `WHATSAPP_PHONE_ID` to empty strings (or just leave them unset). The processor logs and exits without erroring. High-priority notifications still deliver via in-app inbox + email; only the WhatsApp leg is dormant.
- **Cost watch:** Each delivered notification = one "service conversation" billed for 24 hours. If a user gets 3 WhatsApp notifications in 24h, that's 1 conversation. Watch the Meta Business Manager → WhatsApp Manager → Insights tab.

### [ ] Set `APP_BASE_URL` env var on Cloud Functions

- **Why:** Email + WhatsApp deep-links need absolute URLs (e.g. `https://blueseal.app/jobs/abc123`). The helper defaults to `https://blueseal.app` if unset — fine for production once you own that domain, wrong for staging. See [functions/src/lib/notify.ts](functions/src/lib/notify.ts) → `absoluteUrl()`.
- **What:** From the repo root, with the Firebase CLI authenticated against your project:
  ```
  firebase functions:config:set runtime.app_base_url="https://blueseal.app"
  ```
  Or in the Google Cloud console → Cloud Functions → for each function → Edit → Runtime environment variables → add `APP_BASE_URL = https://blueseal.app`.

  For staging environments, deploy a separate Firebase project with `APP_BASE_URL = https://staging.blueseal.app` (or whatever your staging domain is).
- **Verify:** Open the Cloud Functions logs after triggering any normal/high-priority notification. The enqueued mail doc in `mail/` should contain links matching the URL you set.

### [x] (Optional) Configure SPF / DKIM for your sending domain — ✅ DONE 2026-06-12 (Resend auto-configured SPF + DKIM on `send.blueseal.app` via Cloudflare. **DMARC still TODO:** add a `TXT` at `_dmarc.blueseal.app` = `v=DMARC1; p=none;`)
> *Listed under notifications above, repeated here for emphasis since the PIPEDA confirmation + export emails need it most.*

---

## Account deletion + data export (PIPEDA, added 2026-05-21)

Phase 6 added a self-serve "Delete my account" + "Export my data" flow that satisfies PIPEDA's right-to-deletion and right-to-access. The export emails a 30-day signed URL; the deletion goes through a 30-day grace period and then `scheduledHardDelete` wipes the account from Firestore + Storage + Firebase Auth.

### [ ] Confirm `scheduledHardDelete` is running daily

- **Why:** The function is registered (see [functions/src/auth/scheduledHardDelete.ts](functions/src/auth/scheduledHardDelete.ts)) and runs on a cron schedule (`0 3 * * *` = daily at 03:00 UTC). Cloud Scheduler needs to be enabled on the GCP project the first time you deploy. After that it self-manages.
- **What:** Run `firebase deploy --only functions` once (or use the existing CI deploy). On first deploy, Firebase prompts to enable Cloud Scheduler for your project — accept.
- **Verify:** In the Google Cloud console → Cloud Scheduler → confirm `firebase-schedule-scheduledHardDelete` exists and shows recent successful runs (after ~24h). Cloud Functions logs (`firebase functions:log --only scheduledHardDelete`) will show "no accounts due" entries on quiet days, which is the right state pre-launch.

### [ ] Set up a monitored support inbox for recovery requests

- **Why:** Users who accidentally delete their account have 30 days to recover by replying to their deletion confirmation email. There's no self-serve un-delete by design — recovery has to be deliberate. If nobody reads the inbox, recoveries fall through.
- **What:** The confirmation email is sent from your SMTP default-FROM address (set during Trigger Email setup). Make sure that inbox is monitored, ideally daily. Recovery is manual today — an admin sets `users/{uid}.deletedAt = null` via the Firebase console, then `tradespeople/{uid}.isVisible = true` if applicable.
- **Verify:** Trigger a deletion on a test account, reply to the email, and walk through the recovery steps.

### [ ] (Optional, future) Build admin-side recovery UI

- **Why:** Manual Firebase-console recovery works but is error-prone. A small admin screen at `/admin/users/{uid}` with a "Restore account" button would prevent typos.
- **What:** Not built yet. Would extend `ApplicationReviewView` or land a new `UserDetailView`. Tracked in the strategic plan as part of the "admin tooling" P0 cluster.

- **Why:** Vetting emails are landing in the spam folder per the audit's user research (Marcus's approval email went to spam). Setting up SPF + DKIM authentication for your sending domain dramatically improves deliverability.
- **What:** Follow your SMTP provider's instructions to add DNS records for your domain. SendGrid, Mailgun, etc. all have step-by-step guides. Usually takes ~30 min plus DNS propagation.
- **Verify:** Use [mail-tester.com](https://www.mail-tester.com) — send a test from your prod environment to the address they give you, then check the score. Aim for 9+/10.

### [ ] (Optional, future) Install "Send SMS with Twilio" extension if you decide to offer SMS as a paid fallback

- **Why:** Some users won't have WhatsApp (or won't want it for business use). SMS via Twilio still works — the code in [functions/src/lib/sms.ts](functions/src/lib/sms.ts) is intact; you just need to install the extension and wire `notify()` to pick SMS based on a user preference. That preference UI doesn't exist yet (it's a future phase).
- **What (when you're ready):** See the Twilio setup steps that used to live here — sign up at twilio.com, buy a Canadian number (~$1.15 CAD/mo + $0.0079/SMS to Canada), install the **Send SMS with Twilio** Firebase extension pointed at the `sms` collection (NOT the default `messages`, which collides with chat).
- **Cost watch:** SMS is metered per message — much more expensive than WhatsApp's per-conversation pricing for high-frequency users.

---

## Security hardening pass (branch: claude/app-security-mvp-readiness-cRet7)

**Status: DEPLOYED to prod 2026-06-01** — functions, firestore rules, and
indexes deployed; both data migrations run successfully (private notes: 6
jobs; tradesperson location: 4 tradies). The items below are kept for the
record; only App Check enforcement (and the optional `ping` cleanup) remain.

### [x] Deploy the AI cost/abuse hardening (functions only) — DONE 2026-06-01

- **Why:** Adds a per-user 100/day cap across all Vertex AI callables, fences prompt-injection, and removes the unauthenticated `ping`. App Check is still off, so this rate limit is currently the main guard against a single account running up the Vertex bill.
- **What:** `firebase deploy --only functions`. ✅ deployed.
- **Verify:** Call an AI tool 100+ times as one user → the 101st returns `resource-exhausted`. (`ping` removal: if you answered "No" on the delete prompt during deploy, run `firebase functions:delete ping --region us-central1 --force` to finish it.)

### [x] Deploy F2 (private job notes) + run the migration — DONE 2026-06-01

- **Why:** The tradesperson's private notes (incl. AI behavioural notes about the client) were on the client-readable job doc. Moved to a tradie-only subdoc.
- **What:** `firebase deploy --only firestore:rules,functions` → Admin dashboard → **"Migrate private job notes"**. ✅ deployed + migrated (scanned 6, moved 2, stripped-only 3, skipped 1).
- **Verify:** As a client, open an old job → you can't read its `private/notes` subdoc. As the tradie → your notes are intact.

### [x] Deploy F1 (tradesperson location/address) + run the migration — DONE 2026-06-01

- **Why:** Every visible tradesperson's **exact home coordinates + street address** were world-readable, unauthenticated. Moved to a private subdoc; the public doc now carries only a coarse (~1 km) location for search.
- **What:** indexes → rules+functions → Admin dashboard **"Migrate tradesperson location"**. ✅ deployed + migrated (scanned 4, migrated 4, skipped 0). The new `geohashPublic` indexes were deployed (the legacy `geohash` index was intentionally left in place, not deleted).
- **Verify:** Search returns nearby tradies; open a public tradie profile while logged out → no street address shown; as the tradie, the profile + onboarding editors still show your saved address/pin.

### [ ] Turn on App Check (wiring is DONE — only the key + flip remain)

- **Why:** Every callable was `enforceAppCheck: false`. The AI rate limit is a stopgap; App Check is the real bot/replay/abuse guard. Flagged by the audit as "the single biggest pre-launch fix."
- **Already done in this branch:** client-side init (`src/firebase/config.ts`, gated on `VITE_RECAPTCHA_SITE_KEY`), and all 49 callables now read a single env-driven flag (`functions/src/lib/callable.ts`, `ENFORCE_APP_CHECK`). Nothing breaks while the key is unset.
- **What's left (do in THIS order — enforcing before the client init is live rejects every call):**
  1. Provision a **reCAPTCHA Enterprise** site key in Google Cloud and register the web app under Firebase Console → App Check. (If you provision a reCAPTCHA **v3** key instead, swap `ReCaptchaEnterpriseProvider` → `ReCaptchaV3Provider` in `config.ts`.)
  2. Set `VITE_RECAPTCHA_SITE_KEY` in the frontend env and deploy hosting. Confirm in the App Check console that requests show as verified.
  3. Only then set `ENFORCE_APP_CHECK=true` on the Cloud Functions runtime and `firebase deploy --only functions`.
  4. For local testing, set `VITE_APPCHECK_DEBUG_TOKEN` and register the printed debug token in the console.
- **Verify:** With enforcement on, a call from a non-attested client (curl/Postman, no App Check token) returns `unauthenticated`; the real web app keeps working.

### [ ] Add the Unsplash Access Key to the production build (image picker)

- **Why:** Tradespeople can pick a banner / portfolio image from Unsplash (profile inline editor + onboarding/account image fields). The picker reads `VITE_UNSPLASH_ACCESS_KEY` at build time and **hides itself when it's unset**, so it works locally (key in the gitignored `.env`) but is invisible in prod until the key ships in the build.
- **What:** Add `VITE_UNSPLASH_ACCESS_KEY` to the CI build env. Per `.github/workflows/deploy.yml`, public `VITE_*` config is inlined as literals (it ships in the browser bundle) — add the Unsplash **Access Key** there the same way (read-only Search/Download API; never the Secret Key). Then redeploy hosting.
- **Compliance note (Unsplash API Guidelines):** we trigger the required download endpoint on selection and credit the photographer in the picker, and we re-host the chosen image to our own Storage rather than hot-linking. Persistent on-profile attribution + any hotlink-vs-rehost decision should get a quick review before heavy use. Production apps also need Unsplash to approve the app beyond the 50 req/hr demo limit.
- **Verify:** In prod, open a tradesperson's profile as the owner → Edit → the banner / portfolio image controls show a "Choose from Unsplash" button; searching returns results and picking one sets the image.
