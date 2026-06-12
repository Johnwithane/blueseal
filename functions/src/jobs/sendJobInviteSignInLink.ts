// DELIBERATELY UNAUTHENTICATED callable — the only way a no-account client
// holding a copied/texted invite link can act. Its entire power is: given a
// valid (token, email) pair where the email matches the one the tradesperson
// stored on the invite, send a fresh Firebase magic sign-in link TO THAT
// STORED ADDRESS. It never signs anyone in, never returns the link to the
// browser (that would let the link-holder mint a verified-email account for
// someone else's inbox), and never emails a caller-chosen address (that
// would be an open mail cannon). Inbox control stays the credential.
//
// Hardening (App Check enforcement is OFF by default — lib/callable.ts — so
// this endpoint is publicly reachable):
//  - per-token attempt cap + per-IP daily cap via the rateLimits collection
//  - one uniform error for invalid/expired/revoked/mismatched, so responses
//    can't be used as an email-or-token oracle
//  - suppression-list check before any send.

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { FieldValue } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";
import { z } from "zod";

import { CALLABLE_OPTS } from "../lib/callable";
import { db } from "../lib/admin";
import { enforceRateLimit } from "../lib/rateLimit";
import { sha256 } from "../prospects/helpers";
import { inviteMagicLink, isInviteEmailSuppressed, sendInviteEmail } from "./inviteHelpers";

const Input = z.object({
  token: z.string().min(20).max(100),
  email: z.string().trim().toLowerCase().email().max(200),
});

const PER_TOKEN_DAILY_CAP = 5;
const PER_IP_DAILY_CAP = 30;

const GENERIC_FAIL = new HttpsError(
  "failed-precondition",
  "That link is invalid, expired, or the email doesn't match the invite. Ask your tradesperson to re-send it.",
);

interface JobData {
  tradespersonId: string;
  clientId: string | null;
  trade: string;
  tradespersonName?: string | null;
  clientInvite?: {
    emailLower: string;
    clientName: string;
    status: string;
    expiresAt: { toMillis(): number } | null;
  } | null;
}

export const sendJobInviteSignInLink = onCall(CALLABLE_OPTS, async (req) => {
  const parsed = Input.safeParse(req.data);
  if (!parsed.success) throw new HttpsError("invalid-argument", "Invalid request.");
  const { token, email } = parsed.data;
  const tokenHash = sha256(token);

  // Rate limits BEFORE any lookup so the endpoint can't be brute-forced into
  // an oracle. Pseudo-uids keep the shared rateLimits/{action}_{uid}_{day}
  // doc shape.
  const ip = req.rawRequest.ip ?? "unknown";
  try {
    await enforceRateLimit(`tok_${tokenHash.slice(0, 16)}`, "invite_verify", PER_TOKEN_DAILY_CAP);
    await enforceRateLimit(`ip_${sha256(ip).slice(0, 16)}`, "invite_verify_ip", PER_IP_DAILY_CAP);
  } catch (err) {
    if (err instanceof HttpsError && err.code === "resource-exhausted") {
      throw new HttpsError("resource-exhausted", "Too many attempts. Try again tomorrow.");
    }
    throw err;
  }

  const match = await db
    .collection("jobs")
    .where("clientInvite.tokenHash", "==", tokenHash)
    .limit(1)
    .get();
  if (match.empty) throw GENERIC_FAIL;

  const jobDoc = match.docs[0];
  const job = jobDoc.data() as JobData;
  const invite = job.clientInvite;
  if (
    !invite ||
    invite.status !== "invited" ||
    job.clientId !== null ||
    invite.emailLower !== email ||
    (invite.expiresAt && invite.expiresAt.toMillis() < Date.now())
  ) {
    throw GENERIC_FAIL;
  }

  if (await isInviteEmailSuppressed(invite.emailLower)) {
    // They opted out of invite email — honour it even on the self-serve path.
    // Distinct copy is safe here: the caller already proved token+email match.
    throw new HttpsError(
      "failed-precondition",
      "This email address has unsubscribed from Blue Seal invite emails.",
    );
  }

  const signinLink = await inviteMagicLink(invite.emailLower);
  if (!signinLink) {
    throw new HttpsError("unavailable", "Sign-in links are temporarily unavailable. Try again later.");
  }
  const emailed = await sendInviteEmail({
    toEmail: invite.emailLower,
    clientName: invite.clientName,
    tradieName: job.tradespersonName?.trim() || "Your tradesperson",
    tradeName: job.trade,
    signinLink,
    jobId: jobDoc.id,
  });
  if (!emailed) {
    throw new HttpsError("unavailable", "Email sending isn't configured yet. Try again later.");
  }

  await jobDoc.ref.update({
    "clientInvite.emailedAt": FieldValue.serverTimestamp(),
    "clientInvite.lastSentAt": FieldValue.serverTimestamp(),
  });

  logger.info("sendJobInviteSignInLink: sent", { jobId: jobDoc.id });
  return { ok: true };
});
