// Admin triage queues (support tickets, bug reports, error logs) used to load
// "the 300 most recent" and filter status client-side, which silently dropped
// still-actionable items older than the cap (P3-06). The fix each queue applies:
// run a status-scoped query for the ACTIONABLE items (so an open ticket can
// never fall off the list) AND a recent-N query for closed/context, then merge.
// This helper does the merge: dedupe by id, newest first. Both inputs are
// single-field-indexed queries, so no composite index is needed.

/** How many recent (incl. closed) docs each queue pulls for context. */
export const ADMIN_QUEUE_RECENT_LIMIT = 300;
/** Safety cap on the actionable-status query (far above any real open backlog). */
export const ADMIN_QUEUE_ACTIONABLE_LIMIT = 500;

interface HasCreatedAt {
  id: string;
  createdAt?: { toMillis?: () => number } | null;
}

/** Merge two doc lists, dedupe by id, sort newest-first by createdAt. */
export function mergeQueueDocs<T extends HasCreatedAt>(a: T[], b: T[]): T[] {
  const byId = new Map<string, T>();
  for (const d of [...a, ...b]) byId.set(d.id, d);
  return [...byId.values()].sort(
    (x, y) => (y.createdAt?.toMillis?.() ?? 0) - (x.createdAt?.toMillis?.() ?? 0),
  );
}
