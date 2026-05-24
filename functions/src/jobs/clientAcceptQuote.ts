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
});

interface JobData {
  tradespersonId: string;
  clientId: string;
  status: string;
  chatId: string;
}

interface QuoteData {
  quoteNumber: string;
  total: number;
  status: string;
}

/**
 * Client accepts the quote. Atomically transitions the job to
 * "quote_accepted" and the quote doc to "accepted"; the tradesperson is
 * notified to pick a schedule (the existing schedule card on the job page
 * handles the date pick and flips the job to "scheduled").
 *
 * onJobUpdated suppresses its generic line for the quoted →
 * quote_accepted transition (richer message posted here).
 */
export const clientAcceptQuote = onCall({ enforceAppCheck: false }, async (req) => {
  const uid = requireRole(req, "client");
  const parsed = Input.safeParse(req.data);
  if (!parsed.success) throw new HttpsError("invalid-argument", parsed.error.message);
  const { jobId } = parsed.data;

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
        `Job must be in quoted status to accept. Current: ${job.status}.`,
      );
    }
    if (!quoteSnap.exists) {
      throw new HttpsError(
        "not-found",
        "Quote not found — ask the tradesperson to re-send.",
      );
    }
    const quote = quoteSnap.data() as QuoteData;
    if (!["sent", "viewed"].includes(quote.status)) {
      throw new HttpsError(
        "failed-precondition",
        `Quote can't be accepted from status "${quote.status}".`,
      );
    }
    if (quote.total <= 0) {
      throw new HttpsError("failed-precondition", "Quote has zero total.");
    }

    tx.update(jobRef, { status: "quote_accepted" });
    tx.update(quoteRef, {
      status: "accepted",
      acceptedAt: FieldValue.serverTimestamp(),
      declinedReason: null,
    });
    return {
      tradespersonId: job.tradespersonId,
      chatId: job.chatId,
      quoteNumber: quote.quoteNumber,
      total: quote.total,
    };
  });

  if (result.chatId) {
    await postSystemMessage(
      result.chatId,
      `Client accepted quote ${result.quoteNumber} ($${(result.total / 100).toFixed(2)}). Pick a date to schedule.`,
    );
  }

  await notify({
    userId: result.tradespersonId,
    type: "invoice_sent",
    title: "Client accepted your quote",
    body: `${result.quoteNumber} ($${(result.total / 100).toFixed(2)}). Open the job to schedule.`,
    link: `/jobs/${jobId}`,
    actorUid: uid,
    jobId,
    chatId: result.chatId ?? null,
    recipientRole: "tradesperson",
    priority: "high",
  });

  logger.info("clientAcceptQuote", {
    jobId,
    clientId: uid,
    quoteNumber: result.quoteNumber,
  });
  return { ok: true };
});
