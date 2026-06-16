// Daily renewal nudge for tradesperson insurance. Reminds a verified pro 30
// days and 7 days before their general-liability policy expires, so their
// "Insured" badge doesn't quietly lapse and they have time to renew.
//
// Drives off OUR OWN verified-insurance expiry (tradespeople.insuranceExpiresAt,
// mirrored from the approved insuranceVerifications doc on onInsuranceApproved)
// — there is no insurer feed. Reminders fire at EXACT day thresholds (30, 7):
// the sweep runs once daily, so each policy crosses each threshold on exactly
// one run, which gives idempotency with no per-doc dedup state. A missed run
// (rare) just skips that one email — the always-on dashboard banner is the
// safety net. When a pro renews (Replace), insuranceExpiresAt moves forward and
// the thresholds re-arm naturally.
//
// Runs at 09:00 America/Vancouver — same slot as the other daily nudges so the
// reminder lands in the inbox at a sensible hour for the launch market.
// Batched at 500 docs/run: far above pre-launch volume but a real cap.

import { onSchedule } from "firebase-functions/v2/scheduler";
import { Timestamp } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";
import { db } from "../lib/admin";
import { notify } from "../lib/notify";

const DAY_MS = 24 * 60 * 60 * 1000;
// Days-before-expiry at which a reminder fires. Exact-match thresholds — see
// the file header for why equality (not >=) keeps this idempotent.
const REMINDER_DAYS: readonly number[] = [30, 7];

export const scheduledInsuranceExpiry = onSchedule(
  { schedule: "every day 09:00", timeZone: "America/Vancouver" },
  async () => {
    const now = Timestamp.now();
    const cutoff = Timestamp.fromMillis(now.toMillis() + 30 * DAY_MS);

    // Only pros whose insurance expires within the next 30 days. A range on a
    // single field is served by the default single-field index — no composite.
    const snap = await db
      .collection("tradespeople")
      .where("insuranceExpiresAt", ">", now)
      .where("insuranceExpiresAt", "<=", cutoff)
      .limit(500)
      .get();

    if (snap.empty) {
      logger.info("scheduledInsuranceExpiry: nobody expiring within 30 days");
      return;
    }

    let reminded = 0;
    for (const docSnap of snap.docs) {
      try {
        const data = docSnap.data();
        // insuranceExpiresAt is only mirrored on approval, but guard anyway so
        // a stale/unverified record can never trigger a renewal nudge.
        if (data.insuranceVerified !== true) continue;
        const expiresAt = data.insuranceExpiresAt as Timestamp | undefined;
        if (!expiresAt) continue;

        const daysLeft = Math.ceil((expiresAt.toMillis() - now.toMillis()) / DAY_MS);
        if (!REMINDER_DAYS.includes(daysLeft)) continue;

        const urgent = daysLeft <= 7;
        await notify({
          userId: docSnap.id,
          type: "insurance_expiry_reminder",
          title: urgent
            ? "Your insurance expires this week"
            : "Time to renew your insurance",
          body: `Your liability insurance expires in ${daysLeft} days. Renew so your verified Insured badge doesn't lapse — get covered in minutes from your dashboard.`,
          link: "/dashboard",
          recipientRole: "tradesperson",
          priority: "normal",
        });
        reminded += 1;
      } catch (err) {
        logger.error("scheduledInsuranceExpiry: tradie failed", {
          tradieId: docSnap.id,
          err,
        });
      }
    }

    logger.info("scheduledInsuranceExpiry: done", {
      scanned: snap.size,
      reminded,
    });
  },
);
