# Notifications

How Blue Seal's notification system fits together, and how to add a new notification type without re-inventing the pattern.

---

## Architecture (one paragraph)

A notification is a single document in the `notifications/` Firestore collection, owned by a single recipient (`userId`). All writes go through one Cloud Function helper — [functions/src/lib/notify.ts](../functions/src/lib/notify.ts) — which atomically writes the in-app inbox doc, and (depending on a `priority` flag) fans the same content to email (via the `mail/` collection consumed by Firebase's Trigger Email extension) and SMS (via the `sms/` collection consumed by the Twilio extension). Clients only ever read their own notifications and can only flip `read`/`readAt` — every other field is pinned by rules. The header bell ([src/components/AppHeader.vue](../src/components/AppHeader.vue)) subscribes to the 30 most recent and renders them in [src/components/NotificationsPanel.vue](../src/components/NotificationsPanel.vue) with a click-to-navigate + mark-read flow.

---

## Adding a new notification type

The five places you touch (in order):

1. **Add the type literal** to `NotificationType` in [src/firebase/interfaces.ts](../src/firebase/interfaces.ts) (client-side union). Then add the same literal to the parallel union in [functions/src/lib/notify.ts](../functions/src/lib/notify.ts) — they're a deliberate copy because the `src/` and `functions/` packages can't share types.
2. **Pick an icon** for the type in [src/components/NotificationsPanel.vue](../src/components/NotificationsPanel.vue) → `ICON` record. Use a PrimeIcons class — see [primefaces.org/primevue/icons](https://primefaces.org/primevue/icons/list/) for the full list.
3. **Call `notify()`** from wherever the event happens. For Firestore-trigger-driven events (status change, doc create, etc.), that's a new file under `functions/src/<domain>/` exported from [functions/src/index.ts](../functions/src/index.ts). For callable-driven events (admin action, user-initiated callable), tack a `notify()` call onto the end of the existing callable.
4. **Set `priority` carefully** — see [Priority levels](#priority-levels) below.
5. **Update [skills/notifications.md](./notifications.md)** (this file) → "Notification types" section with the new type, its trigger, its recipient, and its priority. Future sessions should be able to read this and know the full inventory at a glance.

That's it. No interface changes, no rules changes, no service changes. The `notify()` helper is the only write path; the inbox UI auto-picks up the new type.

---

## Priority levels

Every `notify()` call MUST pick a priority. The default is `normal`. The mapping:

| Priority | In-app inbox | Email | SMS | When to use |
|---|---|---|---|---|
| `low` | ✅ | ❌ | ❌ | High-volume / low-stakes events (chat messages, dupe triggers). The bell badge and inbox are enough. |
| `normal` | ✅ | ✅ | ❌ | Standard events the user should see today but not be paged about (new applicant — at normal — review received, application rejected). |
| `high` | ✅ | ✅ | ✅ | Time-critical events where every minute counts: new direct-request job for a tradesperson, vetting approval, application accepted. |

Two rules of thumb to keep cost + spam down:

- **Default to `normal`** unless you have a reason to escalate. SMS is metered (~$0.0079 CAD per message in Canada); a typo cascade can balloon spend.
- **If the caller already emails directly** (e.g. `sendInvoice` calls `enqueueMail` separately to ship the PDF), set the notify priority to `low` to avoid a second email from the same event. Two emails for one action looks broken.

---

## Notification types (current inventory)

Keep this table up to date when you add a type.

| Type | Trigger | Recipient | Priority | Notes |
|---|---|---|---|---|
| `message_received` | `chats/{chatId}/messages/{msgId}` created | The non-sender party of the chat | `low` | Chat is high-volume; the bell badge is enough |
| `job_requested` | `jobs/{jobId}` created (non-marketplace) | The assigned tradesperson | `high` | Marketplace conversions are skipped (acceptApplication already paged them) |
| `new_application` | Application created (callable + trigger belt-and-suspenders) | The job-post owner (client) | `high` from `submitApplication`, `low` from `onApplicationCreated` (dedup) | |
| `application_accepted` | `acceptApplication` callable | The selected applicant (tradesperson) | `high` | Big moment for the tradie |
| `application_rejected` | `onJobPostClosed` fan-out | Each still-pending applicant | `normal` | Don't SMS bad news |
| `application_returned` | `returnToApplicants` callable | The previously-selected applicant | `normal` | Their application is back to pending |
| `vetting_approved` | `approveApplication` callable | The approved tradesperson | `high` | They're going live |
| `vetting_rejected` | `rejectApplication` callable | The rejected tradesperson | `normal` | Sensitive — never SMS |
| `vetting_info_requested` | `requestApplicationInfo` callable | The applicant | `normal` | Direct them back to `/onboarding` |
| `cert_approved` | `certifications/{id}.status → "approved"` | The owning tradesperson | `normal` | |
| `id_approved` | `idVerifications/{tradieId}.status → "approved"` | The tradesperson | `normal` | |
| `invoice_sent` | `sendInvoice` callable | The client | `low` | `sendInvoice` already emails the PDF — don't double-email |
| `review_received` | `reviews/{id}` created | The reviewed tradesperson | `normal` | |

---

## Security model

Rules live in [firestore.rules](../firestore.rules) under `match /notifications/{notifId}`. The contract:

- **Read:** owner only (`resource.data.userId == uid()`). No public reads, no admin shortcut — admins use the audit log if they need to debug.
- **Update:** owner only, and only the `read` + `readAt` fields can change. Every other field (`userId`, `type`, `title`, `body`, `link`, `createdAt`, `jobId`, `chatId`, `actorUid`) is pinned by `==` checks. A compromised client cannot rewrite a notification's content or routing context.
- **Create / Delete:** `if false`. Only Cloud Functions (which bypass rules via the admin SDK) can create or delete notifications.

If you add a new field to `NotificationDoc`, **you must also pin it in the update rule** or a client could mutate it on mark-as-read.

---

## Extending channels (FCM push, in-app banners, digest emails)

The current channels (in-app, email, SMS) cover the immediate-delivery cases. Two natural follow-ups:

- **Daily digest email** instead of per-event email — kinder for `normal`-priority events. Would be a scheduled function that groups unread `normal` notifications per user once a day and ships a single email; the per-event email at `normal` would become opt-out.
- **FCM push** for the PWA install + future native shells. Would replace SMS for `high`-priority events on devices where push is registered (cheaper, faster, less intrusive). Add a `fcmTokens: string[]` field to `UserDoc`, register on PWA install, and have `notify()` push when present.

Both belong in the same `notify()` helper — keep the fan-out single-pathed.

---

## Common pitfalls

- **Type union out of sync.** The `NotificationType` in `src/firebase/interfaces.ts` and `functions/src/lib/notify.ts` is a manual duplicate. If you add a value to one and not the other, the function build will succeed but the icon map will throw at render time. Update both atomically.
- **Forgetting to handle `null` link.** `link` is optional. The `NotificationsPanel.vue` click handler tolerates `null` (no navigation), and `notify()` writes `link: null` for typeless notifications. Don't pass `undefined` — pass `null` or omit.
- **Using `priority: "high"` casually.** SMS is metered and notifications fatigue real users fast. Reserve `high` for genuinely time-critical events; everything else gets `normal` or `low`.
- **Caller emails AND notify-emails the same person.** Look for an existing `enqueueMail` call near where you're adding `notify()`. If found, use `priority: "low"` to keep notify in-app-only.
