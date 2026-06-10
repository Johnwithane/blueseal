import { FieldValue } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";
import { db } from "./admin";
import { enqueueMail } from "./mail";
import { enqueueWhatsApp } from "./whatsapp";
// sms.ts is intentionally not imported here. The SMS queue + helper are
// kept in the repo as a future opt-in fallback (a preferences UI could
// let users pick SMS over WhatsApp once we have one), but every notify
// call routes "high" through WhatsApp by default to keep cost near zero.

// Keep in sync with src/firebase/interfaces.ts → Role.
export type Role = "client" | "tradesperson" | "admin";

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
  | "referral_applied";

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
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  link?: string | null;
  jobId?: string | null;
  chatId?: string | null;
  actorUid?: string | null;
  priority?: NotifyPriority;
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
      emailEnabled: prefs.emailEnabled !== false,
      whatsappEnabled: prefs.whatsappEnabled !== false,
      newJobPostingEnabled: prefs.newJobPostingEnabled !== false,
    };
  } catch (err) {
    logger.warn("notify: failed to load user contact", { uid, err });
    return {
      email: null,
      phone: null,
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
  const url = absoluteUrl(link);
  const cta = url ? `\n\nOpen Blue Seal: ${url}` : "";

  // Email on normal + high (unless the user has opted out).
  if (contact.email && contact.emailEnabled) {
    try {
      await enqueueMail({
        to: contact.email,
        subject: title,
        text: `${body}${cta}`,
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
