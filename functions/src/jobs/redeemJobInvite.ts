// One-tap redemption of a copied/texted job-invite link (/invite/{token}).
//
// Unlike sendJobInviteSignInLink — which only ever EMAILS a magic link, keeping
// inbox control as the credential — this endpoint trades the token DIRECTLY for
// a signed-in client session and opens the job. That's a deliberate product
// decision: the shared link should get the client straight into the job, which
// means whoever holds the link can open it (the same bearer property the
// emailed Firebase magic link already has).
//
// The one hard limit we KEEP is account-takeover protection: a link can never
// sign anyone into an email that ALREADY has a Blue Seal account. If
// getUserByEmail finds an existing user we refuse to mint a session for it (a
// tradesperson could otherwise invite any known address and hijack it) and fall
// back to emailing the magic sign-in link to that inbox — exactly like
// sendJobInviteSignInLink. Only a brand-new email, which by definition owns
// nothing but this fresh invite, gets a custom token.
//
// Scanner safety: this runs only on an explicit button tap in
// InviteLandingView (never on mount), so a link-preview bot that merely
// prefetches the URL can't consume it.
//
// Hardening mirrors sendJobInviteSignInLink: per-token + per-IP daily caps and
// one uniform error for invalid/expired/used/mismatched so the endpoint can't
// be used as a token oracle.

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { FieldValue } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";
import { z } from "zod";

import { CALLABLE_OPTS } from "../lib/callable";
import { adminAuth, db } from "../lib/admin";
import { enforceRateLimit } from "../lib/rateLimit";
import { sha256 } from "../prospects/helpers";
import { inviteMagicLink, isInviteEmailSuppressed, sendInviteEmail } from "./inviteHelpers";

const Input = z.object({
  token: z.string().min(20).max(100),
});

const PER_TOKEN_DAILY_CAP = 5;
const PER_IP_DAILY_CAP = 30;

const GENERIC_FAIL = new HttpsError(
  "failed-precondition",
  "That link is invalid, expired, or already used. Ask your tradesperson to re-send it.",
);
const RATE_LIMIT_MSG = "Too many attempts. Try again tomorrow.";

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

export const redeemJobInvite = onCall(CALLABLE_OPTS, async (req) => {
  const parsed = Input.safeParse(req.data);
  if (!parsed.success) throw new HttpsError("invalid-argument", "Invalid request.");
  const { token } = parsed.data;
  const tokenHash = sha256(token);

  // Rate limits BEFORE any lookup so the endpoint can't be brute-forced into an
  // oracle. Pseudo-uids keep the shared rateLimits/{action}_{uid}_{day} shape.
  const ip = req.rawRequest.ip ?? "unknown";
  try {
    await enforceRateLimit(`tok_${tokenHash.slice(0, 16)}`, "invite_redeem", PER_TOKEN_DAILY_CAP, RATE_LIMIT_MSG);
    await enforceRateLimit(`ip_${sha256(ip).slice(0, 16)}`, "invite_redeem_ip", PER_IP_DAILY_CAP, RATE_LIMIT_MSG);
  } catch (err) {
    if (err instanceof HttpsError && err.code === "resource-exhausted") {
      throw new HttpsError("resource-exhausted", RATE_LIMIT_MSG);
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
    (invite.expiresAt && invite.expiresAt.toMillis() < Date.now())
  ) {
    throw GENERIC_FAIL;
  }
  const email = invite.emailLower;

  // Account-takeover guard + double-tap race: an email that already has an
  // account never gets a bearer session — we email its inbox the magic link
  // instead (inbox control stays the credential for existing accounts).
  async function emailFallback(): Promise<{ mode: "emailed" }> {
    if (await isInviteEmailSuppressed(email)) {
      throw new HttpsError(
        "failed-precondition",
        "This email has unsubscribed from Blue Seal invite emails. Ask your tradesperson to re-send it another way.",
      );
    }
    const signinLink = await inviteMagicLink(email);
    if (!signinLink) {
      throw new HttpsError("unavailable", "Sign-in is temporarily unavailable. Try again later.");
    }
    const emailed = await sendInviteEmail({
      toEmail: email,
      clientName: invite!.clientName,
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
    logger.info("redeemJobInvite: existing account, emailed magic link", { jobId: jobDoc.id });
    return { mode: "emailed" };
  }

  let existing = false;
  try {
    await adminAuth.getUserByEmail(email);
    existing = true;
  } catch {
    existing = false;
  }
  if (existing) return emailFallback();

  // Brand-new email → mint a fresh client account and hand back a custom token.
  // emailVerified:true so the downstream claimJobInvite (which gates on
  // email_verified) and the client-doc self-heal run unchanged — the token is
  // the credential we're honoring here. The displayName seeds from the name the
  // tradesperson entered on the invite; claimJobInvite reconciles it later.
  let uid: string;
  try {
    const userRecord = await adminAuth.createUser({
      email,
      emailVerified: true,
      displayName: invite.clientName || undefined,
    });
    uid = userRecord.uid;
  } catch (err) {
    // Lost a race with another tap that created the account first — fall back
    // to the secure email path rather than error.
    if (
      typeof err === "object" &&
      err !== null &&
      (err as { code?: string }).code === "auth/email-already-exists"
    ) {
      return emailFallback();
    }
    logger.error("redeemJobInvite: createUser failed", { jobId: jobDoc.id, err });
    throw new HttpsError("internal", "Couldn't open your job. Try again.");
  }

  await adminAuth.setCustomUserClaims(uid, { roles: ["client"], role: "client" });
  const customToken = await adminAuth.createCustomToken(uid);
  logger.info("redeemJobInvite: minted session", { jobId: jobDoc.id, uid });
  return { mode: "signin" as const, customToken };
});
