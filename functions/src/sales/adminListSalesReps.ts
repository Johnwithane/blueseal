// Admin-only: list every sales rep with the at-a-glance figures the reps console
// shows — referral code, active/signed state, payout onboarding status, the
// regions they own, and their earnings (unpaid net + lifetime paid). Aggregated
// server-side (the client can't list users / other reps' commissions under the
// rules). N+1 queries per rep (regions + commissions + payouts), which is fine
// at rep-roster scale; revisit if the roster grows into the hundreds.

import { onCall } from "firebase-functions/v2/https";
import { CALLABLE_OPTS } from "../lib/callable";
import { db } from "../lib/admin";
import { requireAdmin } from "../lib/auth";

export interface RepSummary {
  uid: string;
  displayName: string;
  email: string;
  referralCode: string;
  active: boolean;
  liabilitySigned: boolean;
  payoutsStatus: string;
  regionNames: string[];
  unpaidCents: number;
  paidCents: number;
}

export const adminListSalesReps = onCall(CALLABLE_OPTS, async (req) => {
  requireAdmin(req);

  const usersSnap = await db
    .collection("users")
    .where("roles", "array-contains", "sales")
    .get();

  const reps: RepSummary[] = [];
  for (const u of usersSnap.docs) {
    const data = u.data();
    const sr = data.salesRep as
      | {
          referralCode?: string;
          active?: boolean;
          liability?: unknown;
          payouts?: { onboardingStatus?: string };
        }
      | undefined;
    if (!sr) continue; // has the sales role but no salesRep state yet
    const uid = u.id;

    const [regionsSnap, commSnap, payoutsSnap] = await Promise.all([
      db.collection("regions").where("repId", "==", uid).get(),
      db.collection("commissions").where("repId", "==", uid).get(),
      db.collection("commissionPayouts").where("repId", "==", uid).get(),
    ]);

    let accrued = 0;
    let reversedUnnetted = 0;
    for (const c of commSnap.docs) {
      const cd = c.data();
      const cents = Number(cd.commissionCents ?? 0);
      if (cd.status === "accrued") accrued += cents;
      else if (cd.status === "reversed" && cd.payoutBatchId == null) reversedUnnetted += cents;
    }
    const paidCents = payoutsSnap.docs
      .filter((p) => p.data().status === "paid")
      .reduce((s, p) => s + Number(p.data().amountCents ?? 0), 0);

    reps.push({
      uid,
      displayName: (data.displayName as string) ?? "",
      email: (data.email as string) ?? "",
      referralCode: sr.referralCode ?? "",
      active: sr.active !== false,
      liabilitySigned: sr.liability != null,
      payoutsStatus: sr.payouts?.onboardingStatus ?? "not_started",
      regionNames: regionsSnap.docs.map((r) => (r.data().name as string) ?? r.id),
      unpaidCents: Math.max(0, accrued - reversedUnnetted),
      paidCents,
    });
  }

  reps.sort((a, b) => a.displayName.localeCompare(b.displayName));
  return { reps };
});
