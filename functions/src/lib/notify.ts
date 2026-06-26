import { FieldValue } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";
import { db, messaging } from "./admin";
import { enqueueMail } from "./mail";
import { brandedEmailHtml } from "./emailTemplate";
import { enqueueWhatsApp } from "./whatsapp";
// sms.ts is intentionally not imported here. The SMS queue + helper are
// kept in the repo as a future opt-in fallback (a preferences UI could
// let users pick SMS over WhatsApp once we have one), but every notify
// call routes "high" through WhatsApp by default to keep cost near zero.

// Recipient view-modes for a notification. Mirrors src/firebase/interfaces.ts
// → Role, MINUS "qa": qa is a capability claim, never a notification target
// (it has no view/dashboard to land in), so it can never be a recipientRole.
export type Role = "client" | "tradesperson" | "admin" | "sales" | "projectManager";

// Keep in sync with src/firebase/interfaces.ts → NotificationType.
// Cross-package boundary means we can't share the type literally; the
// NotificationsPanel renderer + service consume the src/ copy.
export type NotificationType =
  | "message_received"
  | "job_requested"
  | "job_cancelled"
  | "new_application"
  | "application_accepted"
  | "application_rejected"
  | "application_returned"
  // Pre-acceptance applicant Q&A (sendApplicationMessage / reviseApplication /
  // declineApplication). Kept in sync with src/firebase/interfaces.ts.
  | "application_message"
  | "application_declined"
  | "vetting_approved"
  | "vetting_rejected"
  | "vetting_info_requested"
  | "cert_approved"
  | "id_approved"
  | "insurance_approved"
  | "wsib_approved"
  | "invoice_sent"
  | "invoice_paid"
  | "invoice_payment_failed"
  | "invoice_refunded"
  | "dispute_opened"
  | "review_received"
  // Mutual-review loop. See src/firebase/interfaces.ts → NotificationType
  // for the trigger semantics; these three drive the AirBnB-style blind-
  // reveal review window.
  | "review_requested"
  | "review_reminder"
  | "review_revealed"
  // "vouch_*" stay for back-compat with notifications written before the
  // Recommendations rename; new writes use the "recommendation_*" variants.
  | "vouch_requested"
  | "vouch_accepted"
  | "recommendation_received"
  | "recommendation_accepted"
  | "new_job_posting"
  // Fires to the requesting client when a seeded prospect they asked for signs
  // up and their held lead converts into a real job.
  | "prospect_claimed"
  // Fires to the tradesperson when their off-platform client accepts a job
  // invite (claimJobInvite) and the solo job becomes two-party.
  | "invite_claimed"
  // Client cancel/postpone request loop (requestJobChange / respondJobChange /
  // withdrawJobChange / resumeJob). Kept in sync with src/firebase/interfaces.ts.
  | "job_change_requested"
  | "job_change_accepted"
  | "job_change_declined"
  | "job_change_withdrawn"
  | "job_resumed"
  // Mid-job change-order loop (proposeExtra / respondExtra). The tradesperson
  // proposes an out-of-scope charge; the client approves/declines it up front.
  | "change_order_proposed"
  | "change_order_approved"
  | "change_order_declined"
  // Pre-quote site-visit loop (proposeSiteVisit / respondSiteVisit). The
  // tradesperson asks to see the job before quoting; the client agrees/declines.
  | "site_visit_proposed"
  | "site_visit_agreed"
  | "site_visit_declined"
  // Job-board referrals (sendJobReferral / submitApplication conversion hook).
  // Kept in sync with src/firebase/interfaces.ts.
  | "job_referred"
  | "referral_applied"
  // Daily insurance renewal nudge — fires to a tradesperson 30 and 7 days
  // before their verified insurance expires (scheduledInsuranceExpiry).
  | "insurance_expiry_reminder"
  // A project manager featured this tradesperson on their public profile (P5b).
  | "pm_featured"
  // A project manager dispatched a scoped job to this hand-picked contractor
  // (project accept → dispatchScopedPostings). Links to /jobs/browse.
  | "invited_to_quote";

/**
 * Channel routing per notification.
 *  - "low": in-app inbox only. Use for high-volume/low-stakes (e.g. someone
 *    typing in chat — the inbox is enough; we don't want to email them on
 *    every line).
 *  - "normal" (default): in-app + email. Standard for things the user
 *    should see today but not be paged about.
 *  - "high": in-app + email + WhatsApp. Reserved for time-critical events —
 *    new job request, application accepted, vetting decision. WhatsApp is
 *    the free-tier alternative to SMS (Meta Cloud API: 1,000 conversations
 *    /mo free, then ~$0.005–0.10 per conversation). SMS is dormant in
 *    `lib/sms.ts` for a future preferences UI that lets users pick.
 */
export type NotifyPriority = "low" | "normal" | "high";

export interface NotifyInput {
  // null is tolerated (and skipped with a warn) so job-flow callsites can
  // pass job.clientId directly — it's null on unclaimed bring-your-own-client
  // jobs, where there is simply nobody to notify.
  userId: string | null;
  type: NotificationType;
  title: string;
  body: string;
  link?: string | null;
  jobId?: string | null;
  chatId?: string | null;
  actorUid?: string | null;
  priority?: NotifyPriority;
  // Optional pre-built HTML block injected into the email card between the
  // body line and the CTA button — used for the itemized quote/invoice
  // breakdown (lib/emailBreakdown.ts). Email-only; the in-app row, web push
  // and WhatsApp still use the short `body`. Must be email-safe + escaped.
  emailContentHtml?: string | null;
  // Override the email CTA button label (otherwise derived from `type` via
  // ctaLabelForType). Lets callsites that reuse a generic `type` — e.g.
  // quotes piggy-backing on "invoice_sent" — say "Review & approve" instead
  // of the type's default "View the invoice".
  ctaLabel?: string | null;
  // The role the recipient should be viewing as for the link to make
  // sense. The in-app notifications-bell handler reads this and flips
  // the user's activeRole before navigating, so multi-role accounts
  // land in the right view. Every call site already knows what role it
  // is notifying — pass it; null is reserved for ambiguous / role-
  // agnostic notifications (rare).
  recipientRole?: Role | null;
}

interface UserContact {
  email: string | null;
  phone: string | null;
  // Raw roles array off the user doc (may include "qa", which is not a
  // view-mode) — used only to decide whether to stamp the email with a
  // recipient-role pill. Typed string[] because it can carry "qa".
  roles: string[];
  emailEnabled: boolean;
  whatsappEnabled: boolean;
  newJobPostingEnabled: boolean;
}

interface ActorSnapshot {
  photoURL: string | null;
  displayName: string | null;
}

// Reads the actor's avatar + name for denormalization onto the notification.
// Returns nulls on any failure — a notification miss must never break the
// triggering action, and the UI falls back to the type icon when these are
// null.
async function getActorSnapshot(uid: string): Promise<ActorSnapshot> {
  try {
    const snap = await db.doc(`users/${uid}`).get();
    const data = snap.data() as { photoURL?: string | null; displayName?: string | null } | undefined;
    return {
      photoURL: data?.photoURL ?? null,
      displayName: data?.displayName ?? null,
    };
  } catch (err) {
    logger.warn("notify: failed to load actor snapshot", { uid, err });
    return { photoURL: null, displayName: null };
  }
}

async function getUserContact(uid: string): Promise<UserContact> {
  try {
    const snap = await db.doc(`users/${uid}`).get();
    const data = snap.data() as
      | {
          email?: string;
          phone?: string;
          roles?: string[];
          notificationPrefs?: {
            emailEnabled?: boolean;
            whatsappEnabled?: boolean;
            newJobPostingEnabled?: boolean;
          };
        }
      | undefined;
    // Missing-pref = enabled. Legacy users (created before this field
    // existed) keep getting notifications until they explicitly opt out
    // — turning them off retroactively without consent would be worse.
    const prefs = data?.notificationPrefs ?? {};
    return {
      email: data?.email ?? null,
      phone: data?.phone ?? null,
      roles: data?.roles ?? [],
      emailEnabled: prefs.emailEnabled !== false,
      whatsappEnabled: prefs.whatsappEnabled !== false,
      newJobPostingEnabled: prefs.newJobPostingEnabled !== false,
    };
  } catch (err) {
    logger.warn("notify: failed to load user contact", { uid, err });
    return {
      email: null,
      phone: null,
      roles: [],
      emailEnabled: true,
      whatsappEnabled: true,
      newJobPostingEnabled: true,
    };
  }
}

function absoluteUrl(link: string | null | undefined): string | null {
  if (!link) return null;
  if (/^https?:\/\//i.test(link)) return link;
  const base = (process.env.APP_BASE_URL ?? "https://blueseal.app").replace(/\/$/, "");
  return `${base}${link.startsWith("/") ? "" : "/"}${link}`;
}

// Job-detail notifications whose natural next action lives on the Invoice tab
// (the bell ringing implies "act on this now"). MUST stay in sync with
// src/utils/notifications.ts → INVOICE_TAB_TYPES.
const INVOICE_TAB_TYPES = new Set<NotificationType>([
  "invoice_sent",
  "invoice_paid",
  "invoice_payment_failed",
  "invoice_refunded",
  "dispute_opened",
  "review_received",
  "review_requested",
  "review_reminder",
  "review_revealed",
]);

// Mutual-review notifications also pop the review modal via ?review=1
// (JobDetailView watches for it). MUST stay in sync with
// src/utils/notifications.ts → REVIEW_MODAL_TYPES.
const REVIEW_MODAL_TYPES = new Set<NotificationType>([
  "review_received",
  "review_requested",
  "review_reminder",
  "review_revealed",
]);

/**
 * Server-side mirror of src/utils/notifications.ts → resolveNotificationLink.
 *
 * The in-app bell augments the stored link by type when it's clicked (the
 * Pinia store calls resolveNotificationLink before router.push), so a chat
 * notification opens the chat overlay, an invoice one lands on the Invoice
 * tab, a review one pops the review modal, etc. The email + web-push channels
 * have no such click hook — they navigate to the raw URL — so without this
 * they'd dump the user on the bare job page (wrong tab, no chat/review
 * surface). Apply the same resolution here so every channel routes alike.
 *
 * Kept as a deliberate copy (not an import) because of the functions/ ↔ src/
 * package boundary — same reason NotificationType is duplicated above. Keep
 * the two in lockstep; the client copy carries extra legacy-data repairs
 * (/jobs/pending) that only apply to old in-app rows, not freshly-sent mail.
 */
function augmentNotificationLink(type: NotificationType, link: string | null): string | null {
  if (!link) return null;
  // A rejected applicant loses read access to the job post, so the stored
  // /jobs/posted/:postId link would permission-deny. Send them to their own
  // applications list (which surfaces the "client chose another" message).
  if (type === "application_rejected") return "/my-applications";
  const isJobDetail = link.startsWith("/jobs/") && !link.startsWith("/jobs/posted/");
  if (!isJobDetail) return link;
  const [pathname, existingQs = ""] = link.split("?", 2);
  const qs = new URLSearchParams(existingQs);
  if (type === "message_received") qs.set("chat", "open");
  else if (INVOICE_TAB_TYPES.has(type)) qs.set("tab", "invoice");
  if (REVIEW_MODAL_TYPES.has(type)) qs.set("review", "1");
  const query = qs.toString();
  return query ? `${pathname}?${query}` : pathname;
}

// Per-notification CTA verb for the email button — clearer than a blanket
// "Open Blue Seal". Keyed by string so it never has to stay exhaustive over
// the NotificationType union; anything unmapped falls back to the generic.
const CTA_BY_TYPE: Record<string, string> = {
  message_received: "Reply on Blue Seal",
  application_message: "Reply on Blue Seal",
  invoice_sent: "View the invoice",
  invoice_paid: "View the receipt",
  review_requested: "Leave a review",
  review_reminder: "Leave a review",
  review_revealed: "See the review",
  job_requested: "View the job",
  prospect_claimed: "View the job",
  new_application: "View applicants",
  application_accepted: "View the job",
  vetting_approved: "View your profile",
  vetting_rejected: "See what's needed",
  vetting_info_requested: "See what's needed",
  job_change_requested: "Respond on Blue Seal",
  change_order_proposed: "Review the request",
  site_visit_proposed: "Respond on Blue Seal",
  insurance_expiry_reminder: "Renew your insurance",
};
function ctaLabelForType(type: NotificationType): string {
  return CTA_BY_TYPE[type] ?? "Open Blue Seal";
}

/**
 * Write the notification + (depending on priority) email + SMS. Failures in
 * any channel are logged but never thrown — a notification miss must not
 * break the user-facing action that triggered it.
 */
export async function notify(input: NotifyInput): Promise<void> {
  if (!input.userId) {
    logger.warn("notify: missing userId; skipping", { type: input.type });
    return;
  }
  const priority: NotifyPriority = input.priority ?? "normal";
  const title = input.title.slice(0, 120);
  const body = input.body.slice(0, 500);
  const link = input.link ?? null;

  // Per-type opt-out. new_job_posting is a high-volume broadcast (every
  // matching tradesperson gets one per new marketplace post in their area)
  // so the toggle gates the whole notification, not just channels — there
  // is no "in-app only" silent fallback the way emailEnabled has.
  if (input.type === "new_job_posting") {
    const contact = await getUserContact(input.userId);
    if (!contact.newJobPostingEnabled) return;
  }

  // Denormalize the actor's avatar + display name onto the notification so
  // the inbox can render a profile picture per row without a users/{actorUid}
  // read per item. Only when actorUid is set; defaults to nulls otherwise.
  const actorSnapshot = input.actorUid
    ? await getActorSnapshot(input.actorUid)
    : { photoURL: null, displayName: null };

  // In-app inbox always.
  try {
    await db.collection("notifications").add({
      userId: input.userId,
      type: input.type,
      title,
      body,
      link,
      read: false,
      readAt: null,
      createdAt: FieldValue.serverTimestamp(),
      jobId: input.jobId ?? null,
      chatId: input.chatId ?? null,
      actorUid: input.actorUid ?? null,
      actorPhotoURL: actorSnapshot.photoURL,
      actorDisplayName: actorSnapshot.displayName,
      recipientRole: input.recipientRole ?? null,
    });
  } catch (err) {
    logger.error("notify: in-app write failed", { type: input.type, userId: input.userId, err });
  }

  if (priority === "low") return;

  const contact = await getUserContact(input.userId);
  // The in-app row stores the raw `link`; the email + web-push URL gets the
  // same type-based resolution the in-app bell applies on click, so all
  // channels deep-link to the same surface (chat overlay, Invoice tab,
  // review modal) instead of the bare job page.
  const url = absoluteUrl(augmentNotificationLink(input.type, link));
  const cta = url ? `\n\nOpen Blue Seal: ${url}` : "";

  // Web push on normal + high, to every device the user opted in
  // (users/{uid}/devices, written by the client's enablePush). Token
  // presence IS the opt-in — disabling removes the doc — so there's no
  // separate pref to consult. Dead registrations are pruned on failed
  // sends, which keeps the list self-healing as devices churn.
  try {
    const devicesSnap = await db.collection(`users/${input.userId}/devices`).get();
    if (!devicesSnap.empty) {
      const tokens = devicesSnap.docs.map((d) => d.id);
      const res = await messaging.sendEachForMulticast({
        tokens,
        notification: { title, body },
        webpush: {
          notification: {
            icon: absoluteUrl("/android-icon-192x192.png") ?? undefined,
            badge: absoluteUrl("/android-icon-96x96.png") ?? undefined,
          },
          ...(url ? { fcmOptions: { link: url } } : {}),
        },
      });
      const prunes: Promise<unknown>[] = [];
      res.responses.forEach((r, i) => {
        const code = r.error?.code ?? "";
        if (
          code === "messaging/registration-token-not-registered" ||
          code === "messaging/invalid-argument"
        ) {
          prunes.push(devicesSnap.docs[i].ref.delete());
        }
      });
      await Promise.all(prunes);
      if (res.failureCount > 0) {
        logger.warn("notify: web push partial failure", {
          type: input.type,
          userId: input.userId,
          failureCount: res.failureCount,
          pruned: prunes.length,
        });
      }
    }
  } catch (err) {
    logger.error("notify: web push failed", { type: input.type, userId: input.userId, err });
  }

  // Email on normal + high (unless the user has opted out). Branded HTML
  // shell (logo header, CTA button, signature + CASL footer) plus the plain
  // text fallback for clients that don't render HTML.
  if (contact.email && contact.emailEnabled) {
    // Only stamp the email with a recipient-role pill when the account spans
    // more than one view (e.g. admin who is also a tradesperson + sales rep) —
    // a single-role user has one context, so the tag would be noise. "qa" is a
    // capability, not a view, so it doesn't count. Mirrors NotificationsPanel.
    const multiRole = contact.roles.filter((r) => r !== "qa").length > 1;
    try {
      await enqueueMail({
        to: contact.email,
        subject: title,
        text: `${body}${cta}`,
        html: brandedEmailHtml({
          title,
          // When a breakdown is embedded, it already carries the total — so
          // drop the one-line `body` summary from the EMAIL to avoid showing
          // the price twice. `body` still feeds in-app/push/WhatsApp, which
          // have no breakdown and need the at-a-glance figure.
          bodyLines: input.emailContentHtml ? [] : [body],
          contentHtml: input.emailContentHtml ?? undefined,
          ctaLabel: url ? (input.ctaLabel ?? ctaLabelForType(input.type)) : undefined,
          ctaUrl: url ?? undefined,
          preheader: body,
          // Avatar + name of whoever triggered this (chat sender, the client
          // who accepted, etc) — already fetched above for the in-app row.
          actorPhotoUrl: actorSnapshot.photoURL ?? undefined,
          actorName: actorSnapshot.displayName ?? undefined,
          // Which view this mail is for — only for multi-role recipients.
          recipientRole: multiRole ? (input.recipientRole ?? undefined) : undefined,
        }),
      });
    } catch (err) {
      logger.error("notify: email enqueue failed", {
        type: input.type,
        userId: input.userId,
        err,
      });
    }
  }

  // WhatsApp only on high — and only if the user has a phone on file
  // AND hasn't opted out. Same phone field as SMS: WhatsApp uses the
  // same E.164 number the user already gave us. The
  // processWhatsAppMessage trigger flushes the queue via Meta's Cloud
  // API.
  if (priority === "high" && contact.phone && contact.whatsappEnabled) {
    try {
      // Lead with the title so even a truncated preview is meaningful.
      // Templates (recommended for cold-start messages) interpolate this
      // entire body as their {{1}} parameter.
      const waBody = url ? `${title}\n\n${body}\n\n${url}` : `${title}\n\n${body}`;
      await enqueueWhatsApp({ to: contact.phone, body: waBody });
    } catch (err) {
      logger.error("notify: whatsapp enqueue failed", {
        type: input.type,
        userId: input.userId,
        err,
      });
    }
  }
}

/** Convenience: write the same notification body to multiple recipients. */
export async function notifyMany(
  userIds: string[],
  base: Omit<NotifyInput, "userId">,
): Promise<void> {
  await Promise.all(userIds.map((uid) => notify({ ...base, userId: uid })));
}
