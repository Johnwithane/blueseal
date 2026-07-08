import type { NotificationDoc, Role } from "@/firebase/interfaces";

// Job-detail notifications where the user's natural next action lives on
// the Invoice tab. Landing them on Brief and making them hunt is the
// wrong default — the bell ringing implies "act on this now."
const INVOICE_TAB_TYPES = new Set<NotificationDoc["type"]>([
  "invoice_sent",
  "quote_received", // reviewed on the Invoice tab (same as a sent invoice)
  "invoice_paid",
  "invoice_payment_failed",
  "invoice_refunded",
  "dispute_opened",
  "review_received",
  "review_requested",
  "review_reminder",
  "review_revealed",
]);

// Mutual-review notifications also pop the review modal automatically via
// the ?review=1 query — JobDetailView watches for it and opens the
// ReviewPrompt dialog directly so the click → modal experience is one tap.
// review_received is the legacy single-side "your peer left a review"
// notification; treat it the same as the new mutual flow so existing
// notifications keep working.
const REVIEW_MODAL_TYPES = new Set<NotificationDoc["type"]>([
  "review_received",
  "review_requested",
  "review_reminder",
  "review_revealed",
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

  // A rejected applicant loses read access to the job post, so an old
  // `/jobs/posted/:postId` link 'permission denied's. Their own applications
  // list is the safe, useful landing page (it surfaces the "client chose
  // another tradesperson" message). Self-heals notifications created before
  // acceptApplicationQuote.ts switched to linking here.
  if (notif.type === "application_rejected") return "/my-applications";

  const isJobDetail =
    notif.link.startsWith("/jobs/") && !notif.link.startsWith("/jobs/posted/");
  if (!isJobDetail) return notif.link;

  const [pathname, existingQs = ""] = notif.link.split("?", 2);
  const qs = new URLSearchParams(existingQs);
  if (notif.type === "message_received") qs.set("chat", "open");
  else if (INVOICE_TAB_TYPES.has(notif.type)) qs.set("tab", "invoice");
  if (REVIEW_MODAL_TYPES.has(notif.type)) qs.set("review", "1");
  const query = qs.toString();
  return query ? `${pathname}?${query}` : pathname;
}

// ---------------------------------------------------------------------------
// Per-role visual identity for notifications.
//
// Multi-role accounts (e.g. an admin who is also a tradesperson and a sales
// rep) get a stream of notifications spanning several views. The bell stamps
// each row with its recipient role so it's instantly clear WHICH hat the
// notification is for. Labels + icons mirror the RoleSwitcher pills; colours
// map onto the semantic token set (info/success/danger/warning) so each role
// is unmistakable at a glance. The email channel mirrors this via its own
// raw-hex copy in functions/src/lib/emailTemplate.ts (ROLE_PILL) — keep the
// two in lockstep.
//
// `qa` is present only to satisfy the exhaustive Record<Role>; it's a
// capability, never a notification recipient view-mode (no dashboard to land
// in), so in practice it never renders.
// ---------------------------------------------------------------------------
export interface RoleBadge {
  label: string;
  /** PrimeVue icon class, e.g. "pi pi-user". */
  icon: string;
  /** Solid accent colour (CSS var) — used for the row's left edge. */
  accent: string;
  /** Soft background tint (CSS var) for the chip. */
  tint: string;
  /** Readable text colour (CSS var) for the chip. */
  text: string;
}

const ROLE_BADGES: Record<Role, RoleBadge> = {
  client: {
    label: "Client",
    icon: "pi pi-user",
    accent: "var(--bs-info)",
    tint: "var(--bs-info-tint)",
    text: "var(--bs-info-text)",
  },
  projectManager: {
    label: "Project manager",
    icon: "pi pi-briefcase",
    accent: "var(--bs-info)",
    tint: "var(--bs-info-tint)",
    text: "var(--bs-info-text)",
  },
  tradesperson: {
    label: "Tradesperson",
    icon: "pi pi-wrench",
    accent: "var(--bs-success)",
    tint: "var(--bs-success-tint)",
    text: "var(--bs-success-text)",
  },
  admin: {
    label: "Admin",
    icon: "pi pi-shield",
    accent: "var(--bs-danger)",
    tint: "var(--bs-danger-tint)",
    text: "var(--bs-danger-text)",
  },
  sales: {
    label: "Sales",
    icon: "pi pi-map-marker",
    accent: "var(--bs-warning)",
    tint: "var(--bs-warning-tint)",
    text: "var(--bs-warning-text)",
  },
  qa: {
    label: "QA",
    icon: "pi pi-bug",
    accent: "var(--bs-muted)",
    tint: "var(--bs-surface-alt)",
    text: "var(--bs-text)",
  },
};

/**
 * Visual identity (label, icon, colours) for a notification's recipient role,
 * or null when the notification carries no role (legacy docs created before
 * recipientRole existed).
 */
export function roleBadge(role: Role | null): RoleBadge | null {
  if (!role) return null;
  return ROLE_BADGES[role] ?? null;
}
