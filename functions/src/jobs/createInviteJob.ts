// Tradesperson-created job for an off-platform client ("bring your own
// client"). The job starts unclaimed (clientId: null) with a server-managed
// clientInvite on the doc; the tradesperson runs it solo until the client
// claims the invite (claimJobInvite attaches their uid). Callable-only by
// design — the jobs create rule stays client-only — because:
//  1. the copyable invite token must be minted server-side (only its SHA-256
//     hash is stored, so job-doc readability never leaks the credential),
//  2. the future subscription gate (requireInviteJobEntitlement) is only
//     enforceable here, not in rules,
//  3. the invite email rides the server-only mail queue.

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";
import { randomBytes } from "node:crypto";
import { z } from "zod";

import { CALLABLE_OPTS } from "../lib/callable";
import { adminAuth, db } from "../lib/admin";
import { requireRole } from "../lib/auth";
import { enforceRateLimit } from "../lib/rateLimit";
import { requireInviteJobEntitlement } from "../lib/entitlements";
import { requireVisibleTradie } from "../jobPosts/helpers";
import { appBaseUrl, emailHashOf, sha256 } from "../prospects/helpers";
import { inviteMagicLink, isInviteEmailSuppressed, sendInviteEmail } from "./inviteHelpers";

const Input = z.object({
  title: z.string().trim().min(3).max(140),
  description: z.string().trim().min(1).max(4000),
  trade: z.string().trim().min(1).max(50),
  clientName: z.string().trim().min(1).max(80),
  // Optional: a phone-booked job may have no email to invite. Absent means no
  // invite is minted at all — the job runs solo until the tradesperson adds an
  // address via resendJobInvite({ newEmail }). .nullable() because the callable
  // SDK delivers unset keys as null, which bare .optional() rejects.
  clientEmail: z.string().trim().toLowerCase().email().max(200).nullable().optional(),
  // Tradesperson's own note of the client's number, for calling from the job
  // page. Stored verbatim; never used for delivery, so it isn't parsed.
  clientPhone: z.string().trim().max(30).nullable().optional(),
  address: z.object({
    line1: z.string().trim().min(1).max(200),
    city: z.string().trim().min(1).max(100),
    region: z.string().trim().min(1).max(100),
    postalCode: z.string().trim().max(12),
  }),
  urgency: z.enum(["flexible", "this_week", "urgent"]).default("flexible"),
  // Optional schedule hint (YYYY-MM-DD, stored at UTC midnight on
  // preferredDateWindow.start) — informational, not a status gate.
  preferredStart: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .default(null),
  // "Quote already agreed" — the tradesperson scoped and priced this job offline
  // and just wants to run it, so skip the quote/accept dance and open the job
  // straight in "in_progress". No quote doc is created; the final invoice is
  // built from job-accrued line items (time/expenses/change orders), same as any
  // solo job the tradie runs without a client-accepted quote.
  skipQuote: z.boolean().default(false),
});

const INVITE_JOB_DAILY_CAP = 20;
const INVITE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days; gates copy-link verify only

export const createInviteJob = onCall(CALLABLE_OPTS, async (req) => {
  const uid = requireRole(req, "tradesperson");
  // Vetted, live tradespeople only — this is a tool for working pros, and the
  // invite email goes out under Blue Seal's name.
  await requireVisibleTradie(uid);
  await requireInviteJobEntitlement(uid);

  const parsed = Input.safeParse(req.data);
  if (!parsed.success) {
    throw new HttpsError("invalid-argument", parsed.error.issues[0]?.message ?? "Invalid input");
  }
  const input = parsed.data;
  const clientEmail = input.clientEmail || null;
  const clientPhone = input.clientPhone || null;

  // Self-dealing block: a tradesperson inviting their own inbox could claim
  // the job themselves and act as both parties. Reviews are gated separately
  // (acceptedOffline / null clientId), but there's no legitimate reason to
  // allow this at all. Checked again at claim time for second-account games.
  if (clientEmail) {
    const callerEmail = (await adminAuth.getUser(uid)).email ?? "";
    if (callerEmail && emailHashOf(callerEmail) === emailHashOf(clientEmail)) {
      throw new HttpsError("failed-precondition", "You can't invite your own email address.");
    }
  }

  try {
    await enforceRateLimit(uid, "invite_job_create", INVITE_JOB_DAILY_CAP);
  } catch (err) {
    if (err instanceof HttpsError && err.code === "resource-exhausted") {
      throw new HttpsError(
        "resource-exhausted",
        `Daily limit of ${INVITE_JOB_DAILY_CAP} new jobs reached. Please try again tomorrow.`,
      );
    }
    throw err;
  }

  const userSnap = await db.doc(`users/${uid}`).get();
  const user = (userSnap.data() ?? {}) as { displayName?: unknown; photoURL?: unknown };
  const tradieName =
    (typeof user.displayName === "string" && user.displayName.trim()) || "Tradesperson";
  const tradiePhoto = typeof user.photoURL === "string" ? user.photoURL : null;

  // Copyable invite-link token. The raw token is returned ONCE to the
  // tradesperson (the UI builds /invite/{token}); only the hash is stored.
  // The link can't sign anyone in — it can only trigger sending a magic link
  // to the stored invite email, so inbox control stays the credential. No
  // email means no invite and therefore no token to mint.
  const token = clientEmail ? randomBytes(32).toString("base64url") : null;

  const preferredStart = input.preferredStart
    ? Timestamp.fromDate(new Date(`${input.preferredStart}T00:00:00.000Z`))
    : null;

  const ctx = { fn: "createInviteJob", uid };
  logger.info("starting", ctx);
  try {
    const jobRef = db.collection("jobs").doc();
    const chatRef = db.collection("chats").doc();
    const batch = db.batch();
    batch.set(jobRef, {
      clientId: null,
      tradespersonId: uid,
      clientName: input.clientName,
      clientPhone,
      clientPhotoURL: null,
      tradespersonName: tradieName,
      tradespersonPhotoURL: tradiePhoto,
      // "Quote already agreed" jumps straight to the work; otherwise the job
      // enters at "requested" and the tradesperson sends a quote as usual.
      status: input.skipQuote ? "in_progress" : "requested",
      // No quote will stamp these when skipping, so set the same defaults
      // quote-acceptance would have: fixed billing, 0% job-line tax. Readers
      // already treat null as "fixed"/0, but stamping them keeps the job's
      // billing basis explicit and immutable from creation.
      ...(input.skipQuote ? { billingType: "fixed", defaultTaxRate: 0 } : {}),
      trade: input.trade,
      title: input.title,
      description: input.description,
      intakeFormData: {},
      intakePhotos: [],
      address: { ...input.address, geo: null },
      preferredDateWindow: { start: preferredStart, end: null },
      urgency: input.urgency,
      scheduledStart: null,
      scheduledEnd: null,
      createdAt: FieldValue.serverTimestamp(),
      completedAt: null,
      clientApprovalRequestedAt: null,
      clientApprovedAt: null,
      cancelledAt: null,
      cancelledReason: null,
      cancelledBy: null,
      chatId: chatRef.id,
      sourcePostId: null,
      // Skips onJobCreated's "new job request" page — the tradie created it.
      inviteOriginated: true,
      // No email → no invite. The job is solo from the start; the tradesperson
      // can invite the client later (resendJobInvite with a newEmail).
      clientInvite: clientEmail
        ? {
            emailLower: clientEmail,
            clientName: input.clientName,
            status: "invited",
            invitedAt: FieldValue.serverTimestamp(),
            expiresAt: Timestamp.fromMillis(Date.now() + INVITE_TTL_MS),
            claimedAt: null,
            revokedAt: null,
            resendCount: 0,
            lastSentAt: null,
            emailedAt: null,
            tokenHash: sha256(token as string),
          }
        : null,
    });
    batch.set(chatRef, {
      jobId: jobRef.id,
      clientId: null,
      tradespersonId: uid,
      lastMessageAt: null,
      lastMessagePreview: "",
      unreadCounts: { [uid]: 0 },
    });
    await batch.commit();

    // Best-effort invite email. Gates (all must hold, mirroring prospect
    // outreach): recipient not on the suppression list, magic link could be
    // generated (email-link sign-in enabled), CASL mailing address configured
    // (checked inside sendInviteEmail). Any gate failing degrades to
    // copy-link-only — the job is already created either way.
    let emailed = false;
    try {
      if (clientEmail && !(await isInviteEmailSuppressed(clientEmail))) {
        const signinLink = await inviteMagicLink(clientEmail);
        if (signinLink) {
          emailed = await sendInviteEmail({
            toEmail: clientEmail,
            clientName: input.clientName,
            tradieName,
            tradeName: input.trade,
            signinLink,
            jobId: jobRef.id,
          });
        }
      }
      if (emailed) {
        await jobRef.update({
          "clientInvite.emailedAt": FieldValue.serverTimestamp(),
          "clientInvite.lastSentAt": FieldValue.serverTimestamp(),
        });
      }
    } catch (err) {
      logger.warn("createInviteJob: invite email skipped", { ...ctx, jobId: jobRef.id, err });
    }

    logger.info("success", { ...ctx, jobId: jobRef.id, emailed });
    return {
      jobId: jobRef.id,
      // null when the job was created without a client email — there's no
      // invite to share yet.
      inviteLink: token ? `${appBaseUrl()}/invite/${token}` : null,
      emailed,
    };
  } catch (err) {
    logger.error("failed", { ...ctx, err });
    if (err instanceof HttpsError) throw err;
    throw new HttpsError("internal", "Something went wrong creating the job.");
  }
});
