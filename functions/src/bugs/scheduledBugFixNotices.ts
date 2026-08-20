// Daily "your bug reports are fixed" digest for QA reporters.
//
// Admins triage bugReports/{id} from /admin/bug-reports and flip status to
// "fixed" as the work lands. Nobody tells the reporter, so a tester has no way
// to know a report is closed short of re-checking the console — and the ones
// who file the most get the least feedback.
//
// BATCHED ON PURPOSE. A per-doc onUpdate trigger would page a tester five
// times during one triage session. This sweeps once a day and sends each
// reporter ONE notice listing every report of theirs that was fixed since the
// last sweep, then stamps `fixNotifiedAt` on each doc so it never re-sends.
//
// Why filter fixNotifiedAt in code rather than in the query: Firestore has no
// "field is missing" predicate — `where("fixNotifiedAt", "==", null)` matches
// docs that hold an explicit null, NOT docs where the field is absent, and
// every report predating this feature is the latter. Querying on status alone
// (a single-field index, so no composite needed) and skipping stamped docs in
// the loop is both correct and cheap at this volume.
//
// Only "fixed" notifies. "wontfix" is a decision the reporter may disagree
// with — that's a conversation for triage notes, not an automated ping.
//
// Runs at 09:00 America/Vancouver, the same slot as the other daily nudges.
// Capped at 500 docs/run: far above real volume, but a real ceiling.

import { onSchedule } from "firebase-functions/v2/scheduler";
import { FieldValue } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";
import { db } from "../lib/admin";
import { notify } from "../lib/notify";

const SCAN_LIMIT = 500;
// How many titles to spell out in the notice before summarising the rest. The
// notification body is capped at 500 chars by notify(); five 140-char titles
// would blow past that, so keep the list short and let the link do the work.
const MAX_TITLES = 3;

/** "a", "a and b", "a, b and c" — Oxford-comma-free, matches the app's voice. */
function joinTitles(titles: string[]): string {
  if (titles.length === 1) return titles[0];
  return `${titles.slice(0, -1).join(", ")} and ${titles[titles.length - 1]}`;
}

/** The one-line body for a reporter's digest of `titles` fixed reports. */
export function fixNoticeBody(titles: string[]): string {
  const shown = titles.slice(0, MAX_TITLES).map((t) => `“${t}”`);
  const rest = titles.length - shown.length;
  // The overflow count is just another list item, so joinTitles places the
  // single "and" — otherwise you get «“A”, “B” and “C” and 2 more».
  const list = joinTitles(rest > 0 ? [...shown, `${rest} more`] : shown);
  return titles.length === 1
    ? `The bug you reported — ${list} — is marked fixed. Give it another go and reopen it if it isn't.`
    : `${titles.length} bugs you reported are marked fixed: ${list}. Give them another go and reopen any that aren't.`;
}

export const scheduledBugFixNotices = onSchedule(
  { schedule: "every day 09:00", timeZone: "America/Vancouver" },
  async () => {
    const snap = await db
      .collection("bugReports")
      .where("status", "==", "fixed")
      .limit(SCAN_LIMIT)
      .get();

    if (snap.empty) {
      logger.info("scheduledBugFixNotices: no fixed reports");
      return;
    }

    // reporterUid -> the reports of theirs that were fixed and not yet announced.
    const pending = new Map<string, { title: string; ref: FirebaseFirestore.DocumentReference }[]>();
    for (const docSnap of snap.docs) {
      const data = docSnap.data();
      // Already announced on an earlier run.
      if (data.fixNotifiedAt) continue;
      const reporterUid = data.reporterUid;
      if (typeof reporterUid !== "string" || reporterUid.length === 0) {
        logger.warn("scheduledBugFixNotices: report has no reporterUid", { reportId: docSnap.id });
        continue;
      }
      const title = typeof data.title === "string" && data.title ? data.title : "Untitled report";
      const list = pending.get(reporterUid) ?? [];
      list.push({ title, ref: docSnap.ref });
      pending.set(reporterUid, list);
    }

    if (pending.size === 0) {
      logger.info("scheduledBugFixNotices: every fixed report already announced", {
        scanned: snap.size,
      });
      return;
    }

    let notified = 0;
    let stamped = 0;
    for (const [reporterUid, reports] of pending) {
      const titles = reports.map((r) => r.title);
      try {
        await notify({
          userId: reporterUid,
          type: "bug_report_fixed",
          title:
            reports.length === 1 ? "Your bug report is fixed" : `${reports.length} of your bug reports are fixed`,
          body: fixNoticeBody(titles),
          link: "/admin/bug-reports",
          // Bug reporting is a qa/admin surface, and "qa" is a capability
          // claim rather than a view-mode — so the console is the right
          // landing context for every reporter.
          recipientRole: "admin",
          priority: "normal",
        });
        notified += 1;
      } catch (err) {
        // Don't stamp what we failed to announce — leave it for tomorrow's run.
        logger.error("scheduledBugFixNotices: notify failed", { reporterUid, err });
        continue;
      }

      // Stamp only after the notice went out, so a mid-sweep crash re-announces
      // (a duplicate digest) rather than silently swallowing the notice.
      try {
        const batch = db.batch();
        for (const r of reports) batch.update(r.ref, { fixNotifiedAt: FieldValue.serverTimestamp() });
        await batch.commit();
        stamped += reports.length;
      } catch (err) {
        logger.error("scheduledBugFixNotices: stamp failed", { reporterUid, err });
      }
    }

    logger.info("scheduledBugFixNotices: done", {
      scanned: snap.size,
      reporters: pending.size,
      notified,
      stamped,
    });
  },
);
