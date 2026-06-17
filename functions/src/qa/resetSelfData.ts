import { onCall } from "firebase-functions/v2/https";
import { logger } from "firebase-functions/v2";
import { CALLABLE_OPTS } from "../lib/callable";
import { db } from "../lib/admin";
import { requireRoleOrAdmin } from "../lib/auth";
import { logAdminAction } from "../lib/audit";

// Best-effort: recursiveDelete each matched doc so per-job subcollections
// (timeEntries, sessions, extras, expenses, private/*) are removed too. Returns
// how many top-level docs were swept; per-doc failures are swallowed so a
// partial sweep still clears most of the data.
async function recursiveDeleteWhere(
  col: string,
  field: string,
  value: string,
): Promise<number> {
  const snap = await db.collection(col).where(field, "==", value).limit(400).get();
  let n = 0;
  for (const d of snap.docs) {
    await db.recursiveDelete(d.ref).catch(() => undefined);
    n++;
  }
  return n;
}

/**
 * QA self-serve teardown: wipe the caller's OWN jobs, job posts, and
 * applications, and reset their tradesperson profile to draft, so a flow can be
 * re-run from a clean slate. Only deletes data attributable to the caller
 * (tradespersonId / clientId == uid). NOT env-gated (it only removes the
 * caller's own data, never fabricates anything), but still requires the qa role.
 */
export const qaResetSelfData = onCall(CALLABLE_OPTS, async (req) => {
  const uid = requireRoleOrAdmin(req, "qa");

  let jobs = 0;
  jobs += await recursiveDeleteWhere("jobs", "tradespersonId", uid).catch(() => 0);
  jobs += await recursiveDeleteWhere("jobs", "clientId", uid).catch(() => 0);
  const jobPosts = await recursiveDeleteWhere("jobPosts", "clientId", uid).catch(() => 0);

  // Applications the tester filed on OTHER testers' posts are subcollection docs
  // keyed by tradieId; sweep them via a collection-group query. Best-effort —
  // if the collection-group index isn't present this just logs and skips.
  let applications = 0;
  try {
    const appsSnap = await db
      .collectionGroup("applications")
      .where("tradespersonId", "==", uid)
      .limit(400)
      .get();
    for (const d of appsSnap.docs) {
      await db.recursiveDelete(d.ref).catch(() => undefined);
      applications++;
    }
  } catch (err) {
    logger.warn("qaResetSelfData: applications sweep skipped", { uid, err });
  }

  // Reset the profile to draft rather than deleting it — re-provisioning is one
  // click. Best-effort.
  await db
    .doc(`tradespeople/${uid}`)
    .set(
      {
        trades: [],
        verifiedTrades: [],
        isVisible: false,
        vettingStatus: "draft",
        idVerified: false,
      },
      { merge: true },
    )
    .catch(() => undefined);

  await logAdminAction({
    actorUid: uid,
    action: "qaResetSelfData",
    targetType: "user",
    targetId: uid,
    metadata: { jobs, jobPosts, applications },
  });
  logger.info("qaResetSelfData", { uid, jobs, jobPosts, applications });
  return { ok: true, deleted: { jobs, jobPosts, applications } };
});
