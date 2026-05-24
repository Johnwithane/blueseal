import { onCall, HttpsError } from "firebase-functions/v2/https";
import { FieldValue } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";
import { z } from "zod";
import { db } from "../lib/admin";
import { requireRole } from "../lib/auth";
import { postSystemMessage } from "../lib/chatSystemMessage";
import { notify } from "../lib/notify";

const Input = z.object({
  jobId: z.string().min(1).max(128),
  reason: z.string().trim().min(1).max(1000),
});

interface JobData {
  tradespersonId: string;
  clientId: string;
  status: string;
  chatId: string;
}

interface QuoteData {
  quoteNumber: string;
  status: string;
}

/**
 * Client declines (or "discusses") the quote — the conversation continues
 * but the quote is no longer the active proposal. Job stays in "quoted"
 * so the tradesperson can revise the line items / total and call
 * submitQuote again, which resets the quote doc to status="sent" and
 * stamps a fresh sentAt + validUntil.
 *
 * declinedReason is preserved on the quote until the next accept (cleared
 * by clientAcceptQuote) so the tradesperson sees the history while
 * revising. We don't move the job status — the kanban + dashboards stay
 * showing it in "Quoted" with the chat thread carrying the discussion.
 *
 * onJobUpdated never fires for this path because status doesn't change.
 */
export const clientDeclineQuote = onCall({ enforceAppCheck: false }, async (req) => {
  const uid = requireRole(req, "client");
  const parsed = Input.safeParse(req.data);
  if (!parsed.success) throw new HttpsError("invalid-argument", parsed.error.message);
  const { jobId, reason } = parsed.data;

  const jobRef = db.doc(`jobs/${jobId}`);
  const quoteRef = db.doc(`quotes/${jobId}`);

  const result = await db.runTransaction(async (tx) => {
    const [jobSnap, quoteSnap] = await Promise.all([tx.get(jobRef), tx.get(quoteRef)]);
    if (!jobSnap.exists) throw new HttpsError("not-found", "Job not found.");
    const job = jobSnap.data() as JobData;
    if (job.clientId !== uid) {
      throw new HttpsError("permission-denied", "Not your job.");
    }
    if (job.status !== "quoted") {
      throw new HttpsError(
        "failed-precondition",
        `Job must be in quoted status to decline. Current: ${job.status}.`,
      );
    }
    if (!quoteSnap.exists) {
      throw new HttpsError("not-found", "Quote not found.");
    }
    const quote = quoteSnap.data() as QuoteData;
    if (!["sent", "viewed"].includes(quote.status)) {
      throw new HttpsError(
        "failed-precondition",
        `Quote can't be declined from status "${quote.status}".`,
      );
    }

    tx.update(quoteRef, {
      status: "declined",
      declinedAt: FieldValue.serverTimestamp(),
      declinedReason: reason,
    });
    // Job stays in "quoted" — the chat keeps the discussion and the
    // tradesperson can revise + re-submitQuote.
    return {
      tradespersonId: job.tradespersonId,
      chatId: job.chatId,
      quoteNumber: quote.quoteNumber,
    };
  });

  if (result.chatId) {
    await postSystemMessage(
      result.chatId,
      `Client wants to discuss quote ${result.quoteNumber} — "${reason}"`,
    );
  }

  await notify({
    userId: result.tradespersonId,
    type: "invoice_sent",
    title: "Client wants to discuss your quote",
    body: reason.length > 200 ? reason.slice(0, 197) + "..." : reason,
    link: `/jobs/${jobId}`,
    actorUid: uid,
    jobId,
    chatId: result.chatId ?? null,
    priority: "high",
  });

  logger.info("clientDeclineQuote", {
    jobId,
    clientId: uid,
    quoteNumber: result.quoteNumber,
  });
  return { ok: true };
});
