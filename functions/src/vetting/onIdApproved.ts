import { onDocumentUpdated } from "firebase-functions/v2/firestore";
import { db } from "../lib/admin";
import { notify } from "../lib/notify";
import { maybeMarkVisible } from "./visibility";

export const onIdApproved = onDocumentUpdated("idVerifications/{tradieId}", async (event) => {
  const before = event.data?.before.data() as { status?: string } | undefined;
  const after = event.data?.after.data() as { status?: string } | undefined;
  if (!after) return;
  if (before?.status === after.status) return;
  if (after.status !== "approved") return;

  const tradieId = event.params.tradieId;
  await db.doc(`tradespeople/${tradieId}`).update({ idVerified: true });
  await maybeMarkVisible(tradieId);

  await notify({
    userId: tradieId,
    type: "id_approved",
    title: "ID verified",
    body: "Your government ID was approved. One step closer to going live.",
    link: "/dashboard/tradie",
  });
});
