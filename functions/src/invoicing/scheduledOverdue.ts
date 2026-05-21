import { onSchedule } from "firebase-functions/v2/scheduler";
import { logger } from "firebase-functions/v2";
import { db } from "../lib/admin";

export const markInvoiceOverdue = onSchedule("every day 09:00", async () => {
  const now = new Date();
  const snap = await db
    .collection("invoices")
    .where("status", "in", ["sent", "viewed"])
    .get();
  let updated = 0;
  for (const doc of snap.docs) {
    const data = doc.data() as { dueAt?: FirebaseFirestore.Timestamp | null };
    if (data.dueAt && data.dueAt.toMillis() < now.getTime()) {
      await doc.ref.update({ status: "overdue" });
      updated++;
    }
  }
  logger.info("Overdue sweep", { updated });
});
