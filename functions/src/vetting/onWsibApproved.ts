import { onDocumentUpdated } from "firebase-functions/v2/firestore";
import { Timestamp } from "firebase-admin/firestore";
import { db } from "../lib/admin";
import { notify } from "../lib/notify";

/**
 * When a WSIB / provincial workers'-comp clearance flips to "approved",
 * mirror the badge onto the tradesperson doc. The badge auto-hides on the
 * frontend once expiresAt passes (clearance certs are typically 60–90
 * days) but the underlying verification doc + history is kept for audit.
 */
export const onWsibApproved = onDocumentUpdated(
  "wsibVerifications/{tradieId}",
  async (event) => {
    const before = event.data?.before.data() as { status?: string } | undefined;
    const after = event.data?.after.data() as
      | { status?: string; expiresAt?: Timestamp }
      | undefined;
    if (!after) return;
    if (before?.status === after.status) return;
    if (after.status !== "approved") return;

    const tradieId = event.params.tradieId;
    await db.doc(`tradespeople/${tradieId}`).update({
      wsibVerified: true,
      wsibExpiresAt: after.expiresAt ?? null,
    });

    await notify({
      userId: tradieId,
      type: "wsib_approved",
      title: "WSIB clearance verified",
      body:
        "Your workers'-comp clearance was approved. The 'WSIB Verified' badge is now showing on your public profile.",
      link: "/dashboard/tradie",
      recipientRole: "tradesperson",
    });
  },
);
