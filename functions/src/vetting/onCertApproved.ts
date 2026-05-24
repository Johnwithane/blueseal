import { onDocumentUpdated } from "firebase-functions/v2/firestore";
import { FieldValue } from "firebase-admin/firestore";
import { db } from "../lib/admin";
import { notify } from "../lib/notify";
import { maybeMarkVisible } from "./visibility";

/**
 * When a cert flips to "approved", append its trade to `verifiedTrades`
 * on the tradie doc. Then check whether the application can go live.
 */
export const onCertApproved = onDocumentUpdated("certifications/{certId}", async (event) => {
  const before = event.data?.before.data() as { status?: string } | undefined;
  const after = event.data?.after.data() as
    | { status?: string; trade?: string; tradespersonId?: string }
    | undefined;
  if (!after) return;
  if (before?.status === after.status) return;
  if (after.status !== "approved" || !after.trade || !after.tradespersonId) return;

  await db.doc(`tradespeople/${after.tradespersonId}`).update({
    verifiedTrades: FieldValue.arrayUnion(after.trade),
  });
  await maybeMarkVisible(after.tradespersonId);

  await notify({
    userId: after.tradespersonId,
    type: "cert_approved",
    title: "Certification approved",
    body: `Your ${after.trade} certification was verified. It's now showing on your public profile.`,
    link: "/dashboard/tradie",
    recipientRole: "tradesperson",
  });
});
