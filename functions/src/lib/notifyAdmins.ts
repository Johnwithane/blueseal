// Operational alerts to the Blue Seal admin team (email-only, best-effort).
//
// Distinct from lib/notify.ts: that routes USER notifications (in-app inbox +
// email + push + WhatsApp keyed on a userId's prefs). Admins don't have those
// per-user channels for ops events, so admin alerts are a plain branded email
// to whoever currently holds the `admin` role. Resolving recipients from the
// role (rather than a hard-coded address or env var) means it self-maintains:
// grant/revoke admin and the alert list follows, no redeploy.

import { logger } from "firebase-functions/v2";
import { db } from "./admin";
import { deliver } from "./brandedMail";

const APP_BASE = (process.env.APP_BASE_URL ?? "https://blueseal.app").replace(/\/$/, "");

/** Absolute URL for an in-app path, for admin-email CTA buttons. */
export function appUrl(path: string): string {
  return `${APP_BASE}${path.startsWith("/") ? path : `/${path}`}`;
}

/**
 * Every current admin's email address. Reads the `users` collection by role
 * (single-field array-contains, no composite index) via the Admin SDK, so it
 * bypasses security rules and sees soft-deleted/disabled accounts too — those
 * are filtered out here so a retired admin stops receiving alerts.
 */
export async function getAdminEmails(): Promise<string[]> {
  const snap = await db.collection("users").where("roles", "array-contains", "admin").get();
  const emails = new Set<string>();
  for (const d of snap.docs) {
    const data = d.data() as { email?: unknown; deletedAt?: unknown };
    if (data.deletedAt) continue; // soft-deleted admin — don't email
    if (typeof data.email === "string" && data.email.includes("@")) {
      emails.add(data.email);
    }
  }
  return [...emails];
}

/**
 * Send a branded email to every admin. Never throws — an admin-alert miss must
 * not break the user-facing action that triggered it (mirrors notify.ts's
 * fail-soft contract). Each recipient is a separate send so one bad address
 * can't suppress the rest, and admins don't see each other on the To line.
 */
export async function notifyAdmins(opts: {
  subject: string;
  title: string;
  bodyLines: string[];
  ctaLabel?: string;
  ctaUrl?: string;
}): Promise<void> {
  let emails: string[];
  try {
    emails = await getAdminEmails();
  } catch (err) {
    logger.error("notifyAdmins: failed to resolve admin recipients", { err });
    return;
  }
  if (emails.length === 0) {
    logger.warn("notifyAdmins: no admin recipients found — alert dropped", {
      subject: opts.subject,
    });
    return;
  }
  await Promise.all(
    emails.map((to) =>
      deliver({ to, ...opts }).catch((err) =>
        logger.error("notifyAdmins: send failed", { to, err }),
      ),
    ),
  );
}
