# Human-required tasks

Setup work that requires your access — accounts, dashboards, secrets, third-party extensions. Claude can scaffold the code; only you can complete these. Check items off as you complete them.

Tasks are grouped by the phase that introduced them so you can see why each one exists. Newest at the top.

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

### [ ] Enable email-link (passwordless) sign-in + authorize the claim domain

- **Why:** The claim flow uses a Firebase magic sign-in link — clicking it proves the prospect controls their inbox and signs them in with a verified email (`claimProspect` gates on `email_verified`). Without this, `generateSignInWithEmailLink` throws and outreach silently skips the email.
- **What:** Firebase Console → Authentication → Sign-in method → enable **Email link (passwordless sign-in)**. Then Authentication → Settings → Authorized domains → ensure your app domain (and `localhost` for testing) is listed so the `/claim` continue URL is allowed.
- **Verify:** Request a seeded prospect as a client (with the env below set) → the outreach email arrives with a "See the request" magic link → clicking it lands on `/claim`, signs you in, and converts the request into a job.

### [ ] Set the CASL outreach env vars on Cloud Functions

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

### [ ] Install "Trigger Email" Firebase extension

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

### [ ] (Optional) Configure SPF / DKIM for your sending domain
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
