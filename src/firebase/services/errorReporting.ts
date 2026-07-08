// errorLogs/{id} — client-side error telemetry.
//
// Two concerns share this file because they share the collection:
//  - reportClientError(): fire-and-forget reporter used by the global error
//    handlers (main.ts) and any catch block that wants a failure recorded for
//    admins. It must NEVER throw and never await into the caller.
//  - listErrorLogs() / setErrorResolved(): the admin queue read + resolve
//    toggle (AdminErrorsView). Reads go direct under admin-only rules.

import {
  collection,
  doc,
  getDocs,
  limit,
  orderBy,
  query,
  updateDoc,
  where,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "@/firebase/config";
import { typedConverter } from "@/firebase/converters";
import {
  ADMIN_QUEUE_ACTIONABLE_LIMIT,
  ADMIN_QUEUE_RECENT_LIMIT,
  mergeQueueDocs,
} from "@/utils/adminQueue";
import type { ErrorLogDoc, ErrorLogSource, WithId } from "@/firebase/interfaces";

export interface ClientErrorReport {
  message: string;
  stack?: string;
  source: ErrorLogSource;
  /** Where it happened — Vue `info`, a file:line, or a component tag. */
  context?: string;
}

const callable = httpsCallable<Record<string, unknown>, { ok: boolean }>(
  functions,
  "reportClientError",
);

// Best-effort throttle so a render loop or a repeated failure can't flood the
// collection (and the bill): dedupe identical signatures and cap per page load.
const seen = new Set<string>();
let sent = 0;
const MAX_PER_SESSION = 25;

/**
 * Record a client-side error for admin visibility. Fire-and-forget: swallows
 * its own failures so it's safe to call from global handlers and finally blocks
 * without risk of a reporting error becoming another error.
 */
export function reportClientError(report: ClientErrorReport): void {
  try {
    const message = (report.message || "").trim().slice(0, 1000);
    if (!message) return;

    const sig = `${report.source}|${report.context ?? ""}|${message}`;
    if (seen.has(sig) || sent >= MAX_PER_SESSION) return;
    seen.add(sig);
    sent += 1;

    void callable({
      message,
      stack: report.stack?.slice(0, 4000),
      source: report.source,
      context: report.context?.slice(0, 300),
      // pathname only — keep tokens/redirect targets in the query string out of logs.
      route: typeof location !== "undefined" ? location.pathname : undefined,
      userAgent: typeof navigator !== "undefined" ? navigator.userAgent : undefined,
      appVersion: import.meta.env.VITE_APP_VERSION || undefined,
    }).catch(() => {
      /* telemetry is best-effort — a reporting failure must stay silent */
    });
  } catch {
    /* the reporter must never throw into its caller */
  }
}

const col = () =>
  collection(db, "errorLogs").withConverter(typedConverter<ErrorLogDoc>());

/**
 * Admin queue (P3-06). Merges every UNRESOLVED error so an old unresolved log
 * can't fall off the list, plus the most-recent N (incl. resolved) for context.
 * Both are single-field-indexed queries — no composite index needed.
 */
export async function listErrorLogs(): Promise<WithId<ErrorLogDoc>[]> {
  const [unresolvedSnap, recentSnap] = await Promise.all([
    getDocs(query(col(), where("resolved", "==", false), limit(ADMIN_QUEUE_ACTIONABLE_LIMIT))),
    getDocs(query(col(), orderBy("createdAt", "desc"), limit(ADMIN_QUEUE_RECENT_LIMIT))),
  ]);
  return mergeQueueDocs(
    unresolvedSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
    recentSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
  );
}

/** Admin resolve toggle. Rules restrict the mutation to the `resolved` field. */
export async function setErrorResolved(id: string, resolved: boolean): Promise<void> {
  await updateDoc(doc(db, "errorLogs", id), { resolved });
}
