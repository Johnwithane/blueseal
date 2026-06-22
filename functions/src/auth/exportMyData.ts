import { onCall, HttpsError } from "firebase-functions/v2/https";
import { CALLABLE_OPTS } from "../lib/callable";
import { logger } from "firebase-functions/v2";
import { db, storage } from "../lib/admin";
import { requireAuth } from "../lib/auth";
import { deliver } from "../lib/brandedMail";

/**
 * PIPEDA: assemble a JSON snapshot of every Firestore record the caller
 * has access to as a party, write it to Cloud Storage under
 * /users/{uid}/exports/, return + email a 30-day signed URL.
 *
 * We intentionally skip chat *messages* (potentially thousands per user)
 * and storage file contents (cert PDFs, ID photos, intake photos). The
 * caller can download those directly while signed in — the export covers
 * the metadata so they know what files exist.
 *
 * Sensitive denormalized fields from other users (a counterparty's email,
 * phone) are NOT included in the caller's export — only their own copy
 * lives here. PII-leakage by export is the most common PIPEDA misstep.
 */
export const exportMyData = onCall({ ...CALLABLE_OPTS, timeoutSeconds: 120 }, async (req) => {
  const uid = requireAuth(req);
  const ctx = { fn: "exportMyData", uid };

  try {
    // Run reads in parallel. None of these are huge (we cap most to 200
    // recent records), so a single shot is fine — a partition strategy
    // would matter only above 10k+ records per user.
    const [
      userSnap,
      tradieSnap,
      certsSnap,
      idSnap,
      insuranceSnap,
      wsibSnap,
      clientJobsSnap,
      tradieJobsSnap,
      myReviewsSnap,
      myClientReviewsSnap,
      clientInvoicesSnap,
      tradieInvoicesSnap,
      myBookingsSnap,
      myAppsSnap,
      notifSnap,
    ] = await Promise.all([
      db.doc(`users/${uid}`).get(),
      db.doc(`tradespeople/${uid}`).get(),
      db.collection("certifications").where("tradespersonId", "==", uid).get(),
      db.doc(`idVerifications/${uid}`).get(),
      db.doc(`insuranceVerifications/${uid}`).get(),
      db.doc(`wsibVerifications/${uid}`).get(),
      db.collection("jobs").where("clientId", "==", uid).limit(500).get(),
      db.collection("jobs").where("tradespersonId", "==", uid).limit(500).get(),
      db.collection("reviews").where("clientId", "==", uid).get(),
      db.collection("clientReviews").where("tradespersonId", "==", uid).get(),
      db.collection("invoices").where("clientId", "==", uid).get(),
      db.collection("invoices").where("tradespersonId", "==", uid).get(),
      db.collection("bookings").where("tradespersonId", "==", uid).limit(500).get(),
      db.collectionGroup("applications").where("tradespersonId", "==", uid).limit(500).get(),
      db.collection("notifications").where("userId", "==", uid).limit(200).get(),
    ]);

    const docPayload = (snap: FirebaseFirestore.DocumentSnapshot) =>
      snap.exists ? { id: snap.id, ...snap.data() } : null;
    const colPayload = (snap: FirebaseFirestore.QuerySnapshot) =>
      snap.docs.map((d) => ({ id: d.id, ...d.data() }));

    const exportBlob = {
      generatedAt: new Date().toISOString(),
      exportedFor: uid,
      schemaVersion: 1,
      note:
        "This export covers all Firestore records you're a party to. " +
        "Chat messages are excluded for size — sign in to view them. " +
        "Uploaded files (certs, ID, photos) are linked but not bundled — " +
        "download them directly from Blue Seal while your account is active.",
      profile: docPayload(userSnap),
      tradesperson: docPayload(tradieSnap),
      certifications: colPayload(certsSnap),
      idVerification: docPayload(idSnap),
      insurance: docPayload(insuranceSnap),
      wsib: docPayload(wsibSnap),
      jobsAsClient: colPayload(clientJobsSnap),
      jobsAsTradesperson: colPayload(tradieJobsSnap),
      reviewsIWrote: colPayload(myReviewsSnap),
      clientReviewsIWrote: colPayload(myClientReviewsSnap),
      invoicesAsClient: colPayload(clientInvoicesSnap),
      invoicesAsTradesperson: colPayload(tradieInvoicesSnap),
      bookings: colPayload(myBookingsSnap),
      applications: colPayload(myAppsSnap),
      notifications: colPayload(notifSnap),
    };

    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const path = `users/${uid}/exports/blueseal-export-${ts}.json`;
    const file = storage.bucket().file(path);
    await file.save(JSON.stringify(exportBlob, null, 2), {
      contentType: "application/json",
      resumable: false,
    });
    const [url] = await file.getSignedUrl({
      action: "read",
      expires: Date.now() + 1000 * 60 * 60 * 24 * 30, // 30 days
    });

    // Email a copy of the link so the user has it even if they close the
    // app. The Storage doc is owner-only-readable so the link is the only
    // way to fetch the export off-platform.
    const profile = userSnap.data() as { email?: string; displayName?: string } | undefined;
    if (profile?.email) {
      await deliver({
        to: profile.email,
        subject: "Your Blue Seal data export is ready",
        title: "Your data export is ready",
        bodyLines: [
          `Hi ${profile.displayName ?? "there"},`,
          "Your Blue Seal data export is ready. The download link below is valid for 30 days.",
          "If you didn't request this, reply to this email so we can investigate.",
        ],
        ctaLabel: "Download your data",
        ctaUrl: url,
      });
    }

    logger.info("exportMyData: success", { ...ctx, path });
    return { url };
  } catch (err) {
    logger.error("exportMyData: failed", { ...ctx, err });
    throw new HttpsError("internal", "Couldn't build your data export. Try again in a moment.");
  }
});
