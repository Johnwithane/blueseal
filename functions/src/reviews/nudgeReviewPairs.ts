// Daily sweep of open review pairs. Two jobs:
//   1. Reminders at day 3 / day 7 / day 13 of the 14-day window — pings
//      whichever party hasn't submitted yet. The day-13 nudge doubles as
//      a 24-hour warning that the window is about to close.
//   2. Force-reveal at day 14 — whatever's been submitted goes live, the
//      pair is locked so the late side can no longer add a review and
//      cheat the blind. AirBnB-equivalent behaviour (see CLAUDE.md
//      decision log: aggregate-on-reveal + lockout-at-deadline both
//      confirmed for parity with AirBnB's mutual review window).
//
// Runs at 09:00 America/Vancouver — same TZ + similar slot as the other
// daily sweeps (scheduledJobPostExpiry runs at 03:00; this one is later
// so the morning nudge actually lands in someone's inbox at a sensible
// hour). Pacific time covers most of the Canadian launch market.
//
// Batched at 500 docs/run — far above the expected daily volume for
// pre-launch but a real cap so a runaway can't lock the queue.

import { onSchedule } from "firebase-functions/v2/scheduler";
import {
  FieldValue,
  Timestamp,
  type DocumentSnapshot,
} from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";
import { db } from "../lib/admin";
import { notify } from "../lib/notify";
import { revealPair, type ReviewPairData } from "../lib/reviewPair";

// Day-offsets (from invoicePaidAt) where a reminder is allowed to fire.
// At each threshold we send AT MOST one nudge per party — `lastNudgedAt`
// holds the last fire so a same-day re-run doesn't double-fire. (The
// per-pair `nudgeCount` is a soft ceiling, not a per-threshold gate.)
const NUDGE_DAY_OFFSETS = [3, 7, 13] as const;

const DAY_MS = 24 * 60 * 60 * 1000;

export const nudgeReviewPairs = onSchedule(
  { schedule: "every day 09:00", timeZone: "America/Vancouver" },
  async () => {
    const now = Timestamp.now();
    const snap = await db
      .collection("reviewPairs")
      .where("locked", "==", false)
      .limit(500)
      .get();

    if (snap.empty) {
      logger.info("nudgeReviewPairs: no open pairs");
      return;
    }

    let nudged = 0;
    let revealed = 0;

    for (const docSnap of snap.docs) {
      try {
        const action = await processPair(docSnap, now);
        if (action === "revealed") revealed += 1;
        else if (action === "nudged") nudged += 1;
      } catch (err) {
        logger.error("nudgeReviewPairs: pair failed", {
          jobId: docSnap.id,
          err,
        });
      }
    }

    logger.info("nudgeReviewPairs: done", {
      scanned: snap.size,
      nudged,
      revealed,
    });
  },
);

/**
 * Drive a single pair forward by one tick. Returns the action taken so
 * the orchestrator can keep a tally for the log line.
 */
async function processPair(
  docSnap: DocumentSnapshot,
  now: Timestamp,
): Promise<"revealed" | "nudged" | "noop"> {
  const pair = docSnap.data() as ReviewPairData;
  if (!pair) return "noop";

  // Past the deadline → force-reveal whatever exists. revealPair handles
  // the partial-reveal case (only one side submitted) and skips the
  // celebratory notification for the side that never reviewed.
  if (now.toMillis() >= pair.deadlineAt.toMillis()) {
    await revealPair(pair.jobId, "deadline");
    return "revealed";
  }

  // Both sides already submitted but the reveal somehow didn't happen
  // (e.g. recordSubmission's reveal step crashed mid-run). Heal it here
  // so we don't sit on a stuck pair until the deadline.
  if (pair.clientSubmittedAt && pair.tradieSubmittedAt && !pair.revealedAt) {
    await revealPair(pair.jobId, "mutual");
    return "revealed";
  }

  // Reminder cadence. Only nudge once per UTC day per pair — if a same-
  // day re-run lands (failure + retry, manual re-trigger from the
  // console), skip rather than double-ping. Note: `lastNudgedAt < midnight
  // local` would be more precise but day-boundary math across TZs adds
  // surface area for no win; the 24-h cooldown is plenty.
  if (
    pair.lastNudgedAt &&
    now.toMillis() - pair.lastNudgedAt.toMillis() < DAY_MS
  ) {
    return "noop";
  }

  const elapsedDays = Math.floor(
    (now.toMillis() - pair.invoicePaidAt.toMillis()) / DAY_MS,
  );
  // Fire at the first eligible threshold the pair has reached — picking
  // the largest reached offset lets a pair that missed earlier nudges
  // (e.g. created mid-week, weekend skipped) still pick up on day 13.
  const reachedOffset = [...NUDGE_DAY_OFFSETS]
    .reverse()
    .find((d) => elapsedDays >= d);
  if (reachedOffset === undefined) return "noop";

  const daysLeft = Math.max(
    0,
    Math.ceil((pair.deadlineAt.toMillis() - now.toMillis()) / DAY_MS),
  );

  // Pick recipients — only the side(s) that haven't submitted yet.
  // Unsubmitted-counts-pinged: at minimum one, at maximum two (both still
  // pending). The day-13 message reads as the urgency push regardless.
  const pending: Array<{ uid: string; role: "client" | "tradesperson" }> = [];
  if (!pair.clientSubmittedAt) pending.push({ uid: pair.clientId, role: "client" });
  if (!pair.tradieSubmittedAt)
    pending.push({ uid: pair.tradespersonId, role: "tradesperson" });
  if (pending.length === 0) return "noop";

  const link = `/jobs/${pair.jobId}`;
  const isFinalCall = reachedOffset === 13 || daysLeft <= 1;
  const title = isFinalCall
    ? "Last day to leave a review"
    : "Reminder: leave a review";
  const body = isFinalCall
    ? "Your review window closes in 24 hours. Submit yours to unlock theirs before then."
    : `Reviews stay hidden until both sides submit. ${daysLeft} day${daysLeft === 1 ? "" : "s"} left.`;

  await Promise.all(
    pending.map((p) =>
      notify({
        userId: p.uid,
        type: "review_reminder",
        title,
        body,
        link,
        jobId: pair.jobId,
        recipientRole: p.role,
        // Day-13 / final-call gets bumped to high so it can fan out via
        // WhatsApp (the user's E.164 channel) instead of email-only.
        // Earlier nudges stay normal.
        priority: isFinalCall ? "high" : "normal",
      }),
    ),
  );

  await docSnap.ref.update({
    lastNudgedAt: FieldValue.serverTimestamp(),
    nudgeCount: FieldValue.increment(1),
  });
  return "nudged";
}
