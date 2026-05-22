# Human-required tasks

Setup work that requires your access — accounts, dashboards, secrets, third-party extensions. Claude can scaffold the code; only you can complete these. Check items off as you complete them.

Tasks are grouped by the phase that introduced them so you can see why each one exists. Newest at the top.

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
