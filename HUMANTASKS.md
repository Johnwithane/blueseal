# Human-required tasks

Setup work that requires your access — accounts, dashboards, secrets, third-party extensions. Claude can scaffold the code; only you can complete these. Check items off as you complete them.

Tasks are grouped by the phase that introduced them so you can see why each one exists. Newest at the top.

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

### [ ] Register the Stripe webhook endpoint

- **Why:** Stripe needs to know where to POST event notifications. The endpoint URL is the Cloud Function HTTPS URL of `stripeWebhook` after deploy.
- **What:**
  1. Deploy Functions once so the URL exists: `firebase deploy --only functions:stripeWebhook`. Note the URL Firebase prints (looks like `https://stripewebhook-xxxxxx-uc.a.run.app`).
  2. Stripe Dashboard → Developers → Webhooks → Add endpoint. URL = the deployed function URL. Events to listen for:
     - **Phase A (Connect)**: `account.updated`
     - **Phase B (payments) — now wired**: `payment_intent.processing`, `payment_intent.succeeded`, `payment_intent.payment_failed`, `charge.refunded`
     - **Phase B follow-up (not yet wired)**: `charge.dispute.created`, `charge.dispute.closed`, `payout.created`, `payout.paid`, `payout.failed`
  3. After creating the endpoint, Stripe reveals its **signing secret** (`whsec_…`). Use that as the value when running `firebase functions:secrets:set STRIPE_WEBHOOK_SECRET`. Redeploy `stripeWebhook` so it picks up the new secret.
- **Verify:** From the dashboard's webhook detail view, click "Send test webhook" → choose `account.updated` → check that the response is 200 and that the `webhookEvents/` Firestore collection has a new doc with `status: "processed"`.

### [ ] Configure `APP_BASE_URL` for the Connect onboarding redirects

- **Why:** `createConnectOnboardingLink` builds `refresh_url` + `return_url` from this env var (same one notify.ts uses for deep-links). Without it set, the tradesperson is redirected to `https://blueseal.app/payouts/return` regardless of environment.
- **What:** Already documented in the Notifications section above for the prod domain. For staging environments, set it to the staging hostname so test sign-ups don't bounce people to prod.
- **Verify:** Call `createConnectOnboardingLink` from a logged-in tradesperson session in staging → returned URL contains `staging.blueseal.app` (or whatever staging is) in the redirect query params.

---

## AI assistant chatbot (added 2026-05-22)

Floating-panel assistant for tradespeople + admins. Backend lives in [functions/src/ai/chat.ts](functions/src/ai/chat.ts), conversations persist under `assistantConversations/{id}/messages/`. Runs on Vertex AI Gemini 2.5 Flash (same auth path as the existing `aiDiagnose` tools — no API keys needed once the API is enabled).

### [ ] Re-enable the subscription gate before launch

- **Why:** [functions/src/ai/chat.ts](functions/src/ai/chat.ts) has `REQUIRE_SUBSCRIPTION = false` at the top so we can dogfood the assistant during development. design.md §5.9 says AI tools require an active subscription — the chatbot is the new primary AI surface, so it should respect the same gate before paying users see it.
- **What:** Flip `REQUIRE_SUBSCRIPTION` to `true` (or promote it to a Cloud Functions env var if you want staging vs prod control), then redeploy. The check already exists below the flag — tradespeople without `users/{uid}.hasActiveSubscription === true` will get a `permission-denied` error and the UI shows a paywall.
- **Verify:** Sign in as a tradie with `hasActiveSubscription === false` and try to send a message — should fail with the gate message. Flip the flag on the user doc, refresh token, retry — should work.

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
