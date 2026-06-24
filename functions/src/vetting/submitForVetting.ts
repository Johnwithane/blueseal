import { onCall, HttpsError } from "firebase-functions/v2/https";
import { logger } from "firebase-functions/v2";
import { CALLABLE_OPTS } from "../lib/callable";
import { FieldValue } from "firebase-admin/firestore";
import { db } from "../lib/admin";
import { requireRole } from "../lib/auth";
import { notifyAdmins, appUrl } from "../lib/notifyAdmins";
import { logAdminAction } from "../lib/audit";
import { matchRegionId, type RegionLike } from "../lib/regionMatch";

/**
 * Resolve a tradesperson's sales attribution at submit time: the region matched
 * from their postal-code FSA, plus a mirror of the referral fields off the
 * (server-locked) user doc. Stamped onto the tradesperson doc so rep-scoped
 * vetting + commission can read them. Best-effort: a lookup failure leaves the
 * fields null rather than blocking the submission.
 */
async function resolveSalesAttribution(
  uid: string,
): Promise<{ regionId: string | null; referredByRepId: string | null; referralSignal: string | null }> {
  try {
    const [contactSnap, userSnap, regionsSnap] = await Promise.all([
      db.doc(`tradespeople/${uid}/private/contact`).get(),
      db.doc(`users/${uid}`).get(),
      db.collection("regions").where("status", "==", "active").get(),
    ]);
    const postalCode = (contactSnap.get("postalCode") as string | undefined) ?? "";
    const regions: RegionLike[] = regionsSnap.docs.map((d) => ({
      id: d.id,
      fsaPrefixes: (d.get("fsaPrefixes") as string[] | undefined) ?? [],
    }));
    return {
      regionId: postalCode ? matchRegionId(postalCode, regions) : null,
      referredByRepId: (userSnap.get("referredByRepId") as string | undefined) ?? null,
      referralSignal: (userSnap.get("referralSignal") as string | undefined) ?? null,
    };
  } catch (err) {
    logger.error("resolveSalesAttribution failed", { uid, err });
    return { regionId: null, referredByRepId: null, referralSignal: null };
  }
}

export const submitForVetting = onCall(CALLABLE_OPTS, async (req) => {
  const uid = requireRole(req, "tradesperson");
  // A tradesperson can't enter the vetting queue (and therefore can't be
  // approved / go public) until their email is verified. This is the single
  // chokepoint to going live, so gating here is sufficient — no rules change.
  // Clients are unaffected; they never call this.
  if (req.auth?.token?.email_verified !== true) {
    throw new HttpsError(
      "failed-precondition",
      "Verify your email before submitting your profile for review.",
    );
  }
  const tradieRef = db.doc(`tradespeople/${uid}`);
  const idRef = db.doc(`idVerifications/${uid}`);
  const certsSnap = await db
    .collection("certifications")
    .where("tradespersonId", "==", uid)
    .get();
  const [tradieSnap, idSnap] = await Promise.all([tradieRef.get(), idRef.get()]);
  if (!tradieSnap.exists) throw new HttpsError("failed-precondition", "Profile not started.");
  if (!idSnap.exists) throw new HttpsError("failed-precondition", "ID not uploaded.");

  const tradie = tradieSnap.data() as {
    trades?: string[];
    vettingStatus?: string;
    displayName?: string;
  };
  // Only draft / info_requested may submit. Already-pending and already-approved
  // tradies must not be able to reset queue position by re-submitting.
  if (tradie.vettingStatus && !["draft", "info_requested"].includes(tradie.vettingStatus)) {
    throw new HttpsError(
      "failed-precondition",
      `Cannot submit from status "${tradie.vettingStatus}".`,
    );
  }
  const requiredTrades = new Set(tradie.trades ?? []);
  // Pending/rejected certs don't count — must have a cert uploaded per trade.
  const certTrades = new Set(
    certsSnap.docs
      .map((d) => d.data() as { trade: string; status?: string })
      .filter((c) => c.status !== "rejected")
      .map((c) => c.trade),
  );
  for (const t of requiredTrades) {
    if (!certTrades.has(t)) {
      throw new HttpsError("failed-precondition", `Missing certification for ${t}.`);
    }
  }

  // Stamp the sales attribution (region by FSA + referral mirror) at submit, so
  // the right rep can vet this application and own its commission.
  const attribution = await resolveSalesAttribution(uid);

  await tradieRef.update({
    vettingStatus: "pending",
    submittedAt: FieldValue.serverTimestamp(),
    regionId: attribution.regionId,
    referredByRepId: attribution.referredByRepId,
    referralSignal: attribution.referralSignal,
  });

  await logAdminAction({
    actorUid: uid,
    action: "submitForVetting",
    targetType: "tradesperson",
    targetId: uid,
    metadata: {
      regionId: attribution.regionId,
      referredByRepId: attribution.referredByRepId,
    },
  });

  // Alert the admin team there's a fresh application to vet. Best-effort:
  // notifyAdmins never throws, but guard anyway so nothing about the email
  // path can fail the submission the tradesperson just completed.
  try {
    const name =
      tradie.displayName?.trim() ||
      (typeof req.auth?.token?.name === "string" ? req.auth.token.name : "") ||
      req.auth?.token?.email ||
      "A tradesperson";
    const trades = (tradie.trades ?? []).join(", ") || "—";
    await notifyAdmins({
      subject: `New tradesperson application: ${name}`,
      title: "New tradesperson application",
      bodyLines: [
        `${name} just submitted their profile for vetting.`,
        `Trades: ${trades}`,
        "Review their certifications, ID, and insurance to approve or request more info.",
      ],
      ctaLabel: "Review application",
      ctaUrl: appUrl(`/admin/applications/${uid}`),
    });
  } catch (err) {
    logger.error("submitForVetting: admin alert failed", { uid, err });
  }

  return { ok: true };
});
