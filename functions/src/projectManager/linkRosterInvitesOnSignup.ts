import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { FieldValue } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";
import { db } from "../lib/admin";

/**
 * When a /users/{uid} doc is created, link any pending roster invites addressed
 * to that user's email — but only if they signed up as a tradesperson (the
 * roster is tradespeople). For each matching invite:
 *   - add them to the inviting PM's savedTradies (their roster), idempotent.
 *   - stamp referredByPmId (only if not already set) so the free Pro month is
 *     granted at go-live — maybeMarkVisible reads it off the user doc.
 *   - flip the invite to joined.
 *
 * The savedTradies add mirrors provisionAccount's pmCode path, so an invited
 * tradesperson lands on the roster exactly like a share-link recruit. Idempotent:
 * pending_signup is the trigger condition, so a re-run finds nothing.
 */
export const linkRosterInvitesOnSignup = onDocumentCreated("users/{uid}", async (event) => {
  const uid = event.params.uid;
  const data = event.data?.data() as
    | { email?: string; roles?: string[]; referredByPmId?: string | null }
    | undefined;

  const email = typeof data?.email === "string" ? data.email.trim().toLowerCase() : null;
  if (!email) return;
  // The roster is tradespeople only — a client who happens to share the email
  // doesn't get pulled onto anyone's roster.
  if (!Array.isArray(data?.roles) || !data.roles.includes("tradesperson")) return;

  const pendingSnap = await db
    .collection("rosterInvites")
    .where("emailLower", "==", email)
    .where("status", "==", "pending_signup")
    .get();
  if (pendingSnap.empty) return;

  let firstPmId: string | null = null;
  const batch = db.batch();
  for (const docSnap of pendingSnap.docs) {
    const pmId = docSnap.get("pmId") as string;
    if (!firstPmId) firstPmId = pmId;
    batch.set(
      db.doc(`users/${pmId}/savedTradies/${uid}`),
      { createdAt: FieldValue.serverTimestamp() },
      { merge: true },
    );
    batch.update(docSnap.ref, {
      status: "joined",
      tradieId: uid,
      joinedAt: FieldValue.serverTimestamp(),
    });
  }

  // Attribute the free month to the first inviting PM, but never overwrite an
  // attribution already set at provisionAccount (a rep ?ref= or a pm code link).
  if (firstPmId && !data?.referredByPmId) {
    batch.update(db.doc(`users/${uid}`), { referredByPmId: firstPmId });
  }

  await batch.commit();
  logger.info("linkRosterInvitesOnSignup: linked invites", {
    uid,
    email,
    count: pendingSnap.size,
  });
});
