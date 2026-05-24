import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { logger } from "firebase-functions/v2";
import { db } from "../lib/admin";
import { notify } from "../lib/notify";

interface AppLike {
  tradespersonId: string;
  clientId: string;
  postId: string;
}

/**
 * Belt-and-suspenders notification on application create. submitApplication
 * also writes a notification synchronously; this trigger covers the case
 * where someone bypasses the callable (admin restoration, etc) or where the
 * callable write was retried. Trigger-side dedup is intentional: identical
 * notifications a minute apart are harmless and the UI groups them anyway.
 */
export const onApplicationCreated = onDocumentCreated(
  "jobPosts/{postId}/applications/{tradieId}",
  async (event) => {
    const app = event.data?.data() as AppLike | undefined;
    if (!app?.clientId) return;
    const postId = event.params.postId;
    try {
      const postSnap = await db.doc(`jobPosts/${postId}`).get();
      const post = postSnap.data() as { title?: string } | undefined;
      await notify({
        userId: app.clientId,
        type: "new_application",
        title: "New tradesperson applied",
        body: `Someone applied to your job${post?.title ? ` "${post.title}"` : ""}.`,
        link: `/jobs/posted/${postId}`,
        actorUid: app.tradespersonId,
        recipientRole: "client",
        // Belt-and-suspenders dupe: submitApplication callable already
        // fanned email + SMS; stay in-app-only here to avoid double-paging.
        priority: "low",
      });
    } catch (err) {
      logger.error("onApplicationCreated notify failed", { postId, err });
    }
  },
);
