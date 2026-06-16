import { onCall, HttpsError } from "firebase-functions/v2/https";
import { CALLABLE_OPTS } from "../lib/callable";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";
import { z } from "zod";
import { db } from "../lib/admin";
import { requireRole } from "../lib/auth";
import { postSystemMessage } from "../lib/chatSystemMessage";
import { isTradieInsured } from "../lib/insurance";

const Input = z.object({
  jobId: z.string().min(1).max(128),
  // What this session bills against. Defaults to ordinary labour for back-compat
  // with the old single-arg callable.
  kind: z.enum(["labour", "travel", "extra"]).default("labour"),
  // Required when kind === "extra": the approved extra to clock against.
  extraId: z.string().min(1).max(128).nullish(),
});

interface JobLike {
  tradespersonId?: string;
  clientId?: string;
  status?: string;
  chatId?: string;
  billingType?: "hourly" | "fixed" | null;
}

/**
 * Open a new time entry for the assigned tradesperson.
 *
 * Rate is resolved server-side from the session `kind` + the job's billing type
 * (stamped at quote acceptance):
 *   • labour → 0 on a fixed-price job (time-only record), else the tradie's
 *     profile hourlyRate. Legacy jobs with no billingType keep the old
 *     always-snapshot-profile-rate behaviour.
 *   • travel → the tradie's travelRate (falls back to hourlyRate). Rejected on
 *     a fixed-price job — travel there must go through a client-approved extra.
 *   • extra  → the approved extra's hourlyRateCents. Requires the extra to
 *     exist, belong to this tradie + job, be "approved", and be hourly.
 *
 * Transactional so the "at most one running entry per tradie per job" invariant
 * holds under concurrent calls, AND so clocking into a new job atomically
 * auto-closes any session still running on another job (one active clock across
 * all jobs — like a physical timesheet).
 *
 * `hourlyRateSnapshot` freezes the resolved rate so a later profile/extra rate
 * change doesn't re-price past sessions.
 */
export const clockIn = onCall(CALLABLE_OPTS, async (req) => {
  const uid = requireRole(req, "tradesperson");
  const parsed = Input.safeParse(req.data);
  if (!parsed.success) throw new HttpsError("invalid-argument", parsed.error.message);

  const { jobId, kind } = parsed.data;
  const extraId = parsed.data.extraId ?? null;
  if (kind === "extra" && !extraId) {
    throw new HttpsError("invalid-argument", "An extra must be specified to clock against it.");
  }

  const jobRef = db.doc(`jobs/${jobId}`);
  const tradieRef = db.doc(`tradespeople/${uid}`);
  const waiverRef = db.doc(`insuranceWaivers/${jobId}`);
  const extraRef = extraId ? jobRef.collection("extras").doc(extraId) : null;
  // Tradie's open sessions across ALL jobs — drives the "already here" guard and
  // the auto-stop-elsewhere behaviour. Needs the COLLECTION_GROUP index on
  // (tradespersonId, endedAt) in firestore.indexes.json.
  const openAcrossJobs = db
    .collectionGroup("timeEntries")
    .where("tradespersonId", "==", uid)
    .where("endedAt", "==", null);

  const out = await db.runTransaction(async (tx) => {
    // ----- all reads first (Firestore txn rule) -----
    const [jobSnap, tradieSnap, openSnap, extraSnap, waiverSnap] = await Promise.all([
      tx.get(jobRef),
      tx.get(tradieRef),
      tx.get(openAcrossJobs),
      extraRef ? tx.get(extraRef) : Promise.resolve(null),
      tx.get(waiverRef),
    ]);

    if (!jobSnap.exists) throw new HttpsError("not-found", "Job not found.");
    const job = jobSnap.data() as JobLike;
    if (job.tradespersonId !== uid) {
      throw new HttpsError("permission-denied", "Only the assigned tradesperson can clock in.");
    }
    if (job.status === "cancelled") {
      throw new HttpsError("failed-precondition", "Can't clock in on a cancelled job.");
    }
    // Once the invoice is out (or the job is done), new time entries would
    // never be billed — they'd just orphan silently. Block at the source.
    if (["awaiting_payment", "complete", "reviewed"].includes(job.status ?? "")) {
      throw new HttpsError(
        "failed-precondition",
        "Work is wrapped up on this job — time can no longer be logged.",
      );
    }
    if (!job.clientId) {
      throw new HttpsError("failed-precondition", "Job is missing a client.");
    }

    // Uninsured-work gate: a tradesperson with no current liability insurance
    // must sign the per-job waiver (signUninsuredWaiver) before any work is
    // logged. The UI surfaces the waiver dialog ahead of this; this is the
    // server backstop so the gate can't be skipped by calling clockIn directly.
    const tradieInsurance = tradieSnap.exists
      ? (tradieSnap.data() as {
          insuranceVerified?: boolean | null;
          insuranceExpiresAt?: Timestamp | null;
        })
      : null;
    if (!isTradieInsured(tradieInsurance)) {
      const waiver = waiverSnap.exists ? (waiverSnap.data() as { tradesperson?: unknown }) : null;
      if (!waiver?.tradesperson) {
        throw new HttpsError(
          "failed-precondition",
          "Sign the uninsured-work waiver before you start this job.",
        );
      }
    }

    // Partition open sessions: one on THIS job blocks; ones elsewhere get closed.
    const toClose: FirebaseFirestore.DocumentReference[] = [];
    for (const d of openSnap.docs) {
      if (d.ref.parent.parent?.id === jobId) {
        throw new HttpsError(
          "failed-precondition",
          "You're already clocked in on this job. Stop the running session first.",
        );
      }
      toClose.push(d.ref);
    }

    const tradie = tradieSnap.exists
      ? (tradieSnap.data() as { hourlyRate?: number | null; travelRate?: number | null })
      : null;
    const profileHourly = Math.max(0, Math.floor(tradie?.hourlyRate ?? 0));
    const isFixed = job.billingType === "fixed";

    // ----- resolve the rate + a chat label for this session -----
    let rate: number;
    let label: string;
    if (kind === "travel") {
      if (isFixed) {
        throw new HttpsError(
          "failed-precondition",
          "Travel can't be billed directly on a fixed-price job — add it as an extra for the client to approve.",
        );
      }
      const travel = Math.max(0, Math.floor(tradie?.travelRate ?? 0));
      rate = travel > 0 ? travel : profileHourly;
      label = "started travel time";
    } else if (kind === "extra") {
      if (!extraSnap || !extraSnap.exists) {
        throw new HttpsError("not-found", "Extra not found.");
      }
      const extra = extraSnap.data() as {
        tradespersonId?: string;
        status?: string;
        billingType?: string;
        hourlyRateCents?: number | null;
        description?: string;
      };
      if (extra.tradespersonId !== uid) {
        throw new HttpsError("permission-denied", "Not your extra.");
      }
      if (extra.status !== "approved") {
        throw new HttpsError(
          "failed-precondition",
          "This extra hasn't been approved by the client yet.",
        );
      }
      if (extra.billingType !== "hourly") {
        throw new HttpsError("failed-precondition", "This extra isn't billed hourly.");
      }
      rate = Math.max(0, Math.floor(extra.hourlyRateCents ?? 0));
      label = `started work on change order: ${extra.description ?? "change order"}`;
    } else {
      // labour: 0 on fixed jobs (time-only record), else profile rate.
      rate = isFixed ? 0 : profileHourly;
      label = "clocked in";
    }

    // On an hourly job a $0 rate means the session would bill nothing — almost
    // always a profile gap, not intent. Extras are exempt: their rate was
    // explicitly client-approved, even at $0. Fixed-price labour is exempt by
    // design (time-only record).
    if (!isFixed && kind !== "extra" && rate <= 0) {
      throw new HttpsError(
        "failed-precondition",
        "Your hourly rate isn't set, so this time would bill at $0. Set your rate in Account → Tradesperson profile first.",
      );
    }

    // ----- writes -----
    for (const ref of toClose) {
      tx.update(ref, { endedAt: FieldValue.serverTimestamp() });
    }
    const entryRef = jobRef.collection("timeEntries").doc();
    tx.set(entryRef, {
      tradespersonId: uid,
      clientId: job.clientId,
      startedAt: FieldValue.serverTimestamp(),
      endedAt: null,
      hourlyRateSnapshot: rate,
      notes: "",
      source: "clock",
      kind,
      extraId: kind === "extra" ? extraId : null,
      invoicedAt: null,
    });

    logger.info("clockIn", {
      jobId,
      tradespersonId: uid,
      entryId: entryRef.id,
      kind,
      extraId,
      rate,
      autoClosed: toClose.length,
    });
    return { entryId: entryRef.id, chatId: job.chatId ?? null, label };
  });

  // Post-commit side effect: a chat write failure shouldn't roll back the time
  // entry. postSystemMessage already swallows its own errors.
  if (out.chatId) await postSystemMessage(out.chatId, `Tradesperson ${out.label}`);
  return { entryId: out.entryId };
});

/**
 * Exported for testing-ish parity with the inverse (clockOut.ts) — keeps
 * the elapsed-minutes math co-located with the spec at the boundary.
 */
export function elapsedMinutesBetween(start: Timestamp, end: Timestamp): number {
  const ms = end.toMillis() - start.toMillis();
  return Math.max(0, Math.floor(ms / 60_000));
}
