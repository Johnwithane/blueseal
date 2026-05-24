import { onDocumentUpdated } from "firebase-functions/v2/firestore";
import { Timestamp } from "firebase-admin/firestore";
import { db } from "../lib/admin";
import { notify } from "../lib/notify";

/**
 * When an insurance verification flips to "approved", mirror the badge
 * onto the public tradesperson doc (insuranceVerified + insuranceExpiresAt)
 * so the public profile + search cards can render it without an extra
 * read. Also drops an in-app + email notification for the tradesperson.
 */
export const onInsuranceApproved = onDocumentUpdated(
  "insuranceVerifications/{tradieId}",
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
      insuranceVerified: true,
      insuranceExpiresAt: after.expiresAt ?? null,
    });

    await notify({
      userId: tradieId,
      type: "insurance_approved",
      title: "Insurance verified",
      body:
        "Your insurance proof was approved. The 'Insurance Verified' badge is now showing on your public profile.",
      link: "/dashboard/tradie",
      recipientRole: "tradesperson",
    });
  },
);
