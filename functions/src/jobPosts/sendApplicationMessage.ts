import { onCall, HttpsError } from "firebase-functions/v2/https";
import { CALLABLE_OPTS } from "../lib/callable";
import { FieldValue } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";
import { z } from "zod";
import { db } from "../lib/admin";
import { requireAuth } from "../lib/auth";
import { rateLimitKey } from "./helpers";
import { notify } from "../lib/notify";
import { applicationDocRef, applicationMessagesCol } from "./applicationThread";

// Pre-acceptance applicant Q&A. Either party (the post-owning client OR the
// applicant) can send. This is application-scoped negotiation messaging, NOT the
// job chat — chats/ is jobId-keyed and only created at acceptance. Do not
// "unify" this into the chat system: that would create pre-job chat docs with a
// null jobId and break onMessageCreated's /jobs/{jobId} linking. The accepted
// pair continues in the real job chat after acceptApplicationQuote.
const Input = z.object({
  postId: z.string().min(1).max(128),
  applicationId: z.string().min(1).max(128),
  text: z.string().trim().min(1).max(2000),
});

const DAILY_MESSAGE_CAP = 100;

interface ApplicationData {
  clientId: string;
  tradespersonId: string;
  status: string;
}

interface UserDoc {
  displayName?: string | null;
  photoURL?: string | null;
}

export const sendApplicationMessage = onCall(CALLABLE_OPTS, async (req) => {
  // Either party sends — auth is party-membership, not a single role.
  const uid = requireAuth(req);
  const parsed = Input.safeParse(req.data);
  if (!parsed.success) {
    throw new HttpsError("invalid-argument", parsed.error.issues[0]?.message ?? "Invalid input");
  }
  const { postId, applicationId, text } = parsed.data;
  const ctx = { fn: "sendApplicationMessage", uid, postId, applicationId };

  const appRef = applicationDocRef(postId, applicationId);
  const msgRef = applicationMessagesCol(postId, applicationId).doc();
  const rateRef = db.doc(`rateLimits/${rateLimitKey(uid, "appMessage")}`);

  // Denormalize the sender's name/photo so the recipient renders the bubble
  // without reading the counterparty's user doc (rules block that). Best-effort.
  let sender: UserDoc = {};
  try {
    sender = ((await db.doc(`users/${uid}`).get()).data() as UserDoc) ?? {};
  } catch (err) {
    logger.warn("sendApplicationMessage: actor snapshot failed", { ...ctx, err });
  }

  let recipientUid: string;
  let clientId: string;
  try {
    recipientUid = await db.runTransaction(async (tx) => {
      const [appSnap, rateSnap] = await Promise.all([tx.get(appRef), tx.get(rateRef)]);
      if (!appSnap.exists) throw new HttpsError("not-found", "Application not found.");
      const app = appSnap.data() as ApplicationData;
      if (uid !== app.clientId && uid !== app.tradespersonId) {
        throw new HttpsError("permission-denied", "Not a participant in this application.");
      }
      if (app.status !== "pending") {
        throw new HttpsError(
          "failed-precondition",
          "This application is no longer open for messages.",
        );
      }
      const rateCount = (rateSnap.data() as { count?: number } | undefined)?.count ?? 0;
      if (rateCount >= DAILY_MESSAGE_CAP) {
        throw new HttpsError(
          "resource-exhausted",
          `Daily message limit reached (${DAILY_MESSAGE_CAP}). Try again tomorrow.`,
        );
      }
      clientId = app.clientId;
      const recipient = uid === app.clientId ? app.tradespersonId : app.clientId;

      tx.set(msgRef, {
        senderId: uid,
        text,
        createdAt: FieldValue.serverTimestamp(),
        type: "text",
        senderName: (sender.displayName ?? "").trim() || null,
        senderPhotoURL: sender.photoURL ?? null,
      });
      tx.update(appRef, {
        threadLastMessageAt: FieldValue.serverTimestamp(),
        threadLastMessagePreview: text.slice(0, 120),
        [`threadUnreadCounts.${recipient}`]: FieldValue.increment(1),
      });
      tx.set(
        rateRef,
        {
          uid,
          action: "appMessage",
          count: FieldValue.increment(1),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
      return recipient;
    });
  } catch (err) {
    if (err instanceof HttpsError) throw err;
    logger.error("sendApplicationMessage failed", { ...ctx, err });
    throw new HttpsError("internal", "Couldn't send your message.");
  }

  // In-app/bell only (priority low) — negotiation chatter shouldn't email or
  // WhatsApp on every line, same rationale as message_received.
  const senderIsClient = uid === clientId!;
  await notify({
    userId: recipientUid,
    type: "application_message",
    title: senderIsClient ? "New question about your quote" : "An applicant replied",
    body: text.slice(0, 200),
    link: `/jobs/posted/${postId}`,
    actorUid: uid,
    recipientRole: senderIsClient ? "tradesperson" : "client",
    priority: "low",
  });

  logger.info("sendApplicationMessage success", ctx);
  return { ok: true };
});
