// One-shot admin callable: migrate legacy `privateNotes` (+ the
// `privateNotesLastAutoUpdateAt` watermark) off the client-readable job doc
// and into the tradie-only jobs/{jobId}/private/notes subdoc.
//
// WHY THIS IS REQUIRED, not optional: until it runs, every pre-existing job's
// notes still physically sit on the job doc, which the CLIENT can read — so
// the F2 leak stays open for old jobs, AND the tradie's existing notes don't
// show in the UI (the app now reads the subdoc). Both problems are closed by
// (a) copying the content into the subdoc and (b) deleting the old fields.
//
// Idempotent: a job with no `privateNotes` field is skipped, so re-running
// after a partial run is safe. To avoid clobbering notes a tradie wrote after
// the migration, an existing non-empty subdoc is left untouched (we still
// strip the stale job-doc fields).
//
// Paged by doc id (default __name__ ordering) so an interrupted long run can
// be re-invoked and pick up where it left off.

import { HttpsError, onCall } from "firebase-functions/v2/https";
import { FieldValue } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";

import { db } from "../lib/admin";
import { requireAdmin } from "../lib/auth";
import { logAdminAction } from "../lib/audit";

const PAGE_SIZE = 200;

interface BackfillResult {
  scanned: number;
  copied: number; // notes content moved into a fresh subdoc
  strippedOnly: number; // legacy fields removed but subdoc already had notes
  skipped: number; // no legacy privateNotes field present
  pages: number;
}

export const backfillJobPrivateNotes = onCall(
  { enforceAppCheck: false },
  async (req): Promise<BackfillResult> => {
    const actor = requireAdmin(req);

    let scanned = 0;
    let copied = 0;
    let strippedOnly = 0;
    let skipped = 0;
    let pages = 0;
    let lastDocId: string | null = null;

    while (true) {
      let query = db.collection("jobs").limit(PAGE_SIZE);
      if (lastDocId) {
        const cursor = await db.doc(`jobs/${lastDocId}`).get();
        query = query.startAfter(cursor);
      }
      const snap = await query.get();
      if (snap.empty) break;
      pages += 1;
      scanned += snap.size;

      for (const jobSnap of snap.docs) {
        // `has('privateNotes')` semantics: docSnap.get returns undefined when
        // the field is absent. A legacy job always has it (even if ""); a job
        // created after the F2 change never does.
        const legacyNotes = jobSnap.get("privateNotes");
        if (legacyNotes === undefined) {
          skipped += 1;
          continue;
        }

        const notesRef = jobSnap.ref.collection("private").doc("notes");
        const notesSnap = await notesRef.get();
        const existingSubNotes = (notesSnap.get("notes") as string | undefined) ?? "";

        // Strip the stale fields off the job doc regardless — that's what
        // actually closes the client-readable leak.
        const stripUpdate: Record<string, unknown> = {
          privateNotes: FieldValue.delete(),
          privateNotesLastAutoUpdateAt: FieldValue.delete(),
        };

        const legacyText = typeof legacyNotes === "string" ? legacyNotes : "";
        if (legacyText.trim() && !existingSubNotes.trim()) {
          // Move content into a fresh/empty subdoc.
          await notesRef.set(
            {
              notes: legacyText,
              lastAutoUpdateAt: jobSnap.get("privateNotesLastAutoUpdateAt") ?? null,
            },
            { merge: true },
          );
          copied += 1;
        } else {
          strippedOnly += 1;
        }

        await jobSnap.ref.update(stripUpdate);
      }

      lastDocId = snap.docs[snap.docs.length - 1].id;
      if (snap.size < PAGE_SIZE) break;
    }

    await logAdminAction({
      actorUid: actor,
      action: "backfillJobPrivateNotes",
      targetType: "jobs",
      targetId: "*",
      metadata: { scanned, copied, strippedOnly, skipped, pages },
    });

    logger.info("backfillJobPrivateNotes: done", {
      scanned,
      copied,
      strippedOnly,
      skipped,
      pages,
      actor,
    });

    if (scanned === 0) {
      throw new HttpsError("not-found", "No jobs found. Backfill had nothing to do.");
    }

    return { scanned, copied, strippedOnly, skipped, pages };
  },
);
