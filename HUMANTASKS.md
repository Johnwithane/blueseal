# Human-required tasks

Setup work that requires your access — accounts, dashboards, secrets, third-party extensions. Claude can scaffold the code; only you can complete these. Check items off as you complete them.

Tasks are grouped by the phase that introduced them so you can see why each one exists. Newest at the top.

---

## Notifications (added 2026-05-21)

Phase 3 wired email + SMS fan-out into the `notify()` helper. The code writes to two collections (`mail/` and `sms/`) shaped for Firebase Extensions that you need to install and configure. Until the extensions are installed, the docs queue silently and flush retroactively once they are — nothing is lost.

### [ ] Install "Trigger Email" Firebase extension

- **Why:** The `notify()` helper writes to `mail/` for every notification with priority `normal` or `high` (defined in [functions/src/lib/notify.ts](functions/src/lib/notify.ts)). Vetting decisions in [functions/src/vetting/decisions.ts](functions/src/vetting/decisions.ts) and invoice sends in [functions/src/invoicing/sendInvoice.ts](functions/src/invoicing/sendInvoice.ts) also rely on it directly via `enqueueMail`. Without the extension, queued docs accumulate and no email is sent.
- **What:** In the Firebase console → Extensions → install **Trigger Email** (by Firebase). When configuring:
  - Collection path: `mail`
  - SMTP connection URI: your SMTP provider (SendGrid, Mailgun, Postmark, AWS SES) — get the SMTP URL with embedded credentials from their dashboard.
  - Default FROM: e.g. `Blue Seal <no-reply@blueseal.app>` (set up domain verification first with the SMTP provider).
- **Verify:** After install, trigger a test by approving a vetting decision in admin. Check the `mail/` collection in Firestore — new docs should get a `delivery.state: "SUCCESS"` field within a minute.

### [ ] Install "Send SMS with Twilio" Firebase extension

- **Why:** High-priority notifications (vetting approval, new direct-request job, application accepted, new applicant) also fan out via SMS through [functions/src/lib/sms.ts](functions/src/lib/sms.ts). The notify helper writes to `sms/` for these. Without the extension, no texts are sent.
- **What:**
  1. Sign up at twilio.com (Canadian phone numbers ~$1.15 CAD/mo + ~$0.0079/SMS to Canada).
  2. Buy a Canadian phone number from the Twilio console.
  3. Grab your Account SID + Auth Token from the Twilio console.
  4. In Firebase console → Extensions → install **Send SMS with Twilio** (by Twilio Labs). When configuring:
     - Collection path: `sms`  ← **important: don't leave it on the default `messages`, which collides with our chat messages collection**
     - Twilio Account SID + Auth Token from step 3
     - Twilio phone number from step 2 (in E.164 format, e.g. `+15875551234`)
- **Verify:** After install, set a phone number on a test user via the account page, then trigger any high-priority event (admin approval is easiest). The user should receive a text within seconds.
- **Cost watch:** SMS is metered. The `notify()` helper only sends SMS on `priority: "high"` calls — currently 4 events. If your monthly bill creeps higher than expected, audit the `aiUsage`-style spend in the Twilio dashboard and consider downgrading some types to `priority: "normal"` (email-only).

### [ ] Set `APP_BASE_URL` env var on Cloud Functions

- **Why:** Email + SMS deep-links need absolute URLs (e.g. `https://blueseal.app/jobs/abc123`). The helper defaults to `https://blueseal.app` if unset — fine for production once you own that domain, wrong for staging. See [functions/src/lib/notify.ts](functions/src/lib/notify.ts) → `absoluteUrl()`.
- **What:** From the repo root, with the Firebase CLI authenticated against your project:
  ```
  firebase functions:config:set runtime.app_base_url="https://blueseal.app"
  ```
  Or in the Google Cloud console → Cloud Functions → for each function → Edit → Runtime environment variables → add `APP_BASE_URL = https://blueseal.app`.

  For staging environments, deploy a separate Firebase project with `APP_BASE_URL = https://staging.blueseal.app` (or whatever your staging domain is).
- **Verify:** Open the Cloud Functions logs after triggering any normal/high-priority notification. The enqueued mail doc in `mail/` should contain links matching the URL you set.

### [ ] (Optional) Configure SPF / DKIM for your sending domain

- **Why:** Vetting emails are landing in the spam folder per the audit's user research (Marcus's approval email went to spam). Setting up SPF + DKIM authentication for your sending domain dramatically improves deliverability.
- **What:** Follow your SMTP provider's instructions to add DNS records for your domain. SendGrid, Mailgun, etc. all have step-by-step guides. Usually takes ~30 min plus DNS propagation.
- **Verify:** Use [mail-tester.com](https://www.mail-tester.com) — send a test from your prod environment to the address they give you, then check the score. Aim for 9+/10.
