import { onDocumentUpdated } from "firebase-functions/v2/firestore";
import { FieldValue } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";
import { db } from "../lib/admin";
import { notify } from "../lib/notify";

interface PostLike {
  status?: string;
  title?: string;
  clientId?: string;
}

const TERMINAL = new Set(["closed", "cancelled", "expired"]);

/**
 * When a job post leaves the "open" status, page through its applications
 * subcollection and reject any still-pending ones, with a polite per-applicant
 * notification. Idempotent: only acts on docs whose status is still "pending".
 *
 * For status="closed" the selected applicant is already "selected" (set in
 * acceptApplication); we only fan rejections to the rest.
 */
export const onJobPostClosed = onDocumentUpdated(
  "jobPosts/{postId}",
  async (event) => {
    const before = event.data?.before.data() as PostLike | undefined;
    const after = event.data?.after.data() as PostLike | undefined;
    if (!before || !after) return;
    if (before.status === after.status) return;
    if (!TERMINAL.has(after.status ?? "")) return;
    const postId = event.params.postId;
    const ctx = { fn: "onJobPostClosed", postId, status: after.status };

    const applicationsRef = db.collection(`jobPosts/${postId}/applications`);
    let processed = 0;
    let lastDocId: string | null = null;
    while (true) {
      let q = applicationsRef
        .where("status", "==", "pending")
        .orderBy("__name__")
        .limit(400);
      if (lastDocId) q = q.startAfter(lastDocId);
      const snap = await q.get();
      if (snap.empty) break;
      const batch = db.batch();
      for (const doc of snap.docs) {
        batch.update(doc.ref, {
          status: "rejected",
          updatedAt: FieldValue.serverTimestamp(),
        });
      }
      await batch.commit();

      // Notifications fan out per applicant.
      await Promise.all(
        snap.docs.map(async (doc) => {
          const app = doc.data() as { tradespersonId: string };
          await notify({
            userId: app.tradespersonId,
            type: "application_rejected",
            title: "The client chose another tradesperson",
            body:
              after.status === "expired"
                ? `Job "${after.title ?? "untitled"}" expired before a tradesperson was picked.`
                : `Job "${after.title ?? "untitled"}" is no longer open.`,
            link: `/my-applications`,
          });
        }),
      );

      processed += snap.size;
      lastDocId = snap.docs[snap.docs.length - 1].id;
      if (snap.size < 400) break;
    }

    logger.info("onJobPostClosed fanout complete", { ...ctx, rejected: processed });
  },
);
