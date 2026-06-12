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
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "@/firebase/config";
import { typedConverter } from "@/firebase/converters";
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
 * Admin queue. Newest first; `resolved` is filtered client-side so no composite
 * index is needed (createdAt is a single-field auto index).
 */
export async function listErrorLogs(): Promise<WithId<ErrorLogDoc>[]> {
  const snap = await getDocs(query(col(), orderBy("createdAt", "desc"), limit(200)));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/** Admin resolve toggle. Rules restrict the mutation to the `resolved` field. */
export async function setErrorResolved(id: string, resolved: boolean): Promise<void> {
  await updateDoc(doc(db, "errorLogs", id), { resolved });
}
