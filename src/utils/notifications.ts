import type { NotificationDoc, Role } from "@/firebase/interfaces";

// Job-detail notifications where the user's natural next action lives on
// the Invoice tab. Landing them on Brief and making them hunt is the
// wrong default — the bell ringing implies "act on this now."
const INVOICE_TAB_TYPES = new Set<NotificationDoc["type"]>([
  "invoice_sent",
  "invoice_paid",
  "invoice_payment_failed",
  "invoice_refunded",
  "dispute_opened",
]);

/**
 * Decide whether opening this notification should flip the user's
 * `activeRole` before navigating. True only when:
 *   - the notification carries a recipientRole (legacy docs don't)
 *   - it differs from what the user is currently viewing as
 *   - the user actually holds the recipient role (defensive — they
 *     shouldn't have received it otherwise, but skipping the switch
 *     is safer than throwing them into a role they can't use)
 */
export function shouldSwitchRoleForNotification(
  notif: Pick<NotificationDoc, "recipientRole">,
  activeRole: Role | null,
  userRoles: Role[],
): notif is { recipientRole: Role } {
  if (!notif.recipientRole) return false;
  if (notif.recipientRole === activeRole) return false;
  return userRoles.includes(notif.recipientRole);
}

/**
 * Build the final URL to navigate to when a notification is clicked.
 * Returns `null` when the notification has no link at all (defensive).
 *
 * For job-detail links (/jobs/:id, but NOT /jobs/posted/:postId) we
 * sprinkle in the right query param so the page opens in the surface
 * the user needs:
 *   - message_received → ?chat=open (auto-opens the chat overlay)
 *   - invoice_* / dispute_opened → ?tab=invoice
 *
 * Any other link is returned verbatim — adding query params to
 * /payouts or /dashboard/tradie would be noise.
 */
export function resolveNotificationLink(
  notif: Pick<NotificationDoc, "link" | "type">,
): string | null {
  if (!notif.link) return null;
  const isJobDetail =
    notif.link.startsWith("/jobs/") && !notif.link.startsWith("/jobs/posted/");
  if (!isJobDetail) return notif.link;

  const [pathname, existingQs = ""] = notif.link.split("?", 2);
  const qs = new URLSearchParams(existingQs);
  if (notif.type === "message_received") qs.set("chat", "open");
  else if (INVOICE_TAB_TYPES.has(notif.type)) qs.set("tab", "invoice");
  const query = qs.toString();
  return query ? `${pathname}?${query}` : pathname;
}
