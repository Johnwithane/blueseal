// Client callable: request a seeded (unverified) prospect. Creates a held lead
// and — only on a real client request — sends a CASL-compliant outreach email
// whose CTA is a Firebase magic sign-in link, so clicking it proves the
// recipient controls that inbox and signs them in with a verified email
// (claimProspect then runs securely).

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";
import { z } from "zod";

import { CALLABLE_OPTS } from "../lib/callable";
import { adminAuth, db } from "../lib/admin";
import { requireRole } from "../lib/auth";
import { enforceRateLimit } from "../lib/rateLimit";
import {
  appBaseUrl,
  caslBasisSentence,
  sendOutreachEmail,
  unsubTokenFor,
} from "./helpers";

const Input = z.object({
  prospectId: z.string().trim().min(1).max(64),
  title: z.string().trim().min(3).max(140),
  description: z.string().trim().min(1).max(4000),
  urgency: z.enum(["flexible", "this_week", "urgent"]),
  address: z.object({
    line1: z.string().trim().min(1).max(200),
    city: z.string().trim().min(1).max(100),
    region: z.string().trim().min(1).max(100),
    postalCode: z.string().trim().max(12),
  }),
});

const MAX_OPEN_LEADS_PER_CLIENT = 25;
// Global per-client daily cap on distinct outreach SENDS (independent of the
// open-lead cap, which resets as leads claim/expire). Bounds the spam + magic-
// link-minting surface against harvested third parties.
const PROSPECT_OUTREACH_DAILY_CAP = 15;
const OUTREACH_COOLDOWN_MS = 14 * 24 * 60 * 60 * 1000; // 14 days
const LEAD_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

// Generate a Firebase email-link sign-in URL for the prospect's email. Requires
// email-link sign-in enabled + the continue domain authorized in the Firebase
// console (HUMANTASKS); returns null on failure so outreach degrades gracefully.
async function magicSigninLink(email: string): Promise<string | null> {
  try {
    return await adminAuth.generateSignInWithEmailLink(email, {
      url: `${appBaseUrl()}/claim?email=${encodeURIComponent(email)}`,
      handleCodeInApp: true,
    });
  } catch (err) {
    logger.warn("magicSigninLink: generate failed (email-link sign-in not enabled?)", { err });
    return null;
  }
}

export const requestProspectOutreach = onCall(CALLABLE_OPTS, async (req) => {
  const uid = requireRole(req, "client");
  const parsed = Input.safeParse(req.data);
  if (!parsed.success) {
    throw new HttpsError("invalid-argument", parsed.error.message);
  }
  const { prospectId, title, description, urgency, address } = parsed.data;

  const prospectRef = db.doc(`prospects/${prospectId}`);
  const prospectSnap = await prospectRef.get();
  if (!prospectSnap.exists) {
    throw new HttpsError("not-found", "That listing no longer exists.");
  }
  const prospect = prospectSnap.data() as Record<string, unknown>;

  if (prospect.status === "suppressed" || prospect.isListed === false) {
    throw new HttpsError("failed-precondition", "That tradesperson is no longer available.");
  }
  if (prospect.status === "claimed" && typeof prospect.claimedByUid === "string") {
    return { status: "claimed" as const, tradespersonId: prospect.claimedByUid };
  }

  // Per-client open-lead cap (cheap anti-spam).
  const openCount = await db
    .collection("prospectLeads")
    .where("clientId", "==", uid)
    .where("status", "==", "pending_signup")
    .count()
    .get();
  if (openCount.data().count >= MAX_OPEN_LEADS_PER_CLIENT) {
    throw new HttpsError(
      "resource-exhausted",
      "You have too many open requests to unverified pros. Wait for some to be accepted first.",
    );
  }

  // Dedup: one open lead per (client, prospect). Re-requesting does NOT re-email.
  const existing = await db
    .collection("prospectLeads")
    .where("clientId", "==", uid)
    .where("prospectId", "==", prospectId)
    .where("status", "==", "pending_signup")
    .limit(1)
    .get();
  if (!existing.empty) {
    return { status: "pending_signup" as const, leadId: existing.docs[0].id, alreadyRequested: true };
  }

  const userSnap = await db.doc(`users/${uid}`).get();
  const user = (userSnap.data() ?? {}) as { displayName?: unknown; photoURL?: unknown };
  const clientName = (typeof user.displayName === "string" && user.displayName.trim()) || "A customer";
  const clientPhotoURL = typeof user.photoURL === "string" ? user.photoURL : null;
  const trade = Array.isArray(prospect.trades) && prospect.trades.length
    ? String(prospect.trades[0])
    : "tradesperson";

  // Create the held lead (always — independent of the email gate).
  const leadRef = db.collection("prospectLeads").doc();
  await leadRef.set({
    clientId: uid,
    clientName,
    clientPhotoURL,
    prospectId,
    emailHash: typeof prospect.emailHash === "string" ? prospect.emailHash : "",
    trade,
    title,
    description,
    urgency,
    address,
    intakeFormData: {},
    intakePhotos: [],
    status: "pending_signup",
    createdAt: FieldValue.serverTimestamp(),
    expiresAt: Timestamp.fromMillis(Date.now() + LEAD_TTL_MS),
    claimedJobId: null,
    respondedAt: null,
  });

  // Outreach email gates (ALL must hold):
  //  - emailConspicuouslyPublished === true (CASL implied-consent basis)
  //  - 14-day per-prospect cooldown (don't spam a popular listing)
  //  - the prospect has a usable email + a valid HMAC unsubscribe token
  //  - a magic sign-in link could be generated
  //  - a mailing address is configured (checked inside sendOutreachEmail)
  const lastOutreachAt = prospect.lastOutreachAt as Timestamp | null | undefined;
  const cooled = !lastOutreachAt || Date.now() - lastOutreachAt.toMillis() > OUTREACH_COOLDOWN_MS;
  const conspicuous = prospect.emailConspicuouslyPublished === true;
  // Require the REQUESTING client to have verified their own email — raises the
  // bar for throwaway-account spam against harvested third parties.
  const clientVerified = req.auth?.token?.email_verified === true;
  const unsubToken = unsubTokenFor(prospectId);

  let emailed = false;
  if (
    conspicuous &&
    cooled &&
    clientVerified &&
    unsubToken &&
    typeof prospect.emailHash === "string" &&
    prospect.emailHash
  ) {
    const contactSnap = await prospectRef.collection("private").doc("contact").get();
    const toEmail = contactSnap.get("prospectEmail");
    if (typeof toEmail === "string" && toEmail) {
      const signinLink = await magicSigninLink(toEmail);
      if (signinLink) {
        try {
          // Daily per-client send cap — throws resource-exhausted when hit; we
          // swallow it (skip the email, keep the lead) rather than fail the call.
          await enforceRateLimit(uid, "prospect_outreach", PROSPECT_OUTREACH_DAILY_CAP);
          emailed = await sendOutreachEmail({
            toEmail,
            prospectName: String(prospect.displayName ?? "there"),
            clientCity: address.city,
            tradeName: trade,
            signinLink,
            unsubUrl: `${appBaseUrl()}/p/unsubscribe?p=${encodeURIComponent(prospectId)}&t=${unsubToken}`,
            basisSentence: caslBasisSentence(
              String(prospect.dataConsentBasis ?? ""),
              String(prospect.source ?? ""),
              trade,
            ),
          });
        } catch (err) {
          logger.warn("requestProspectOutreach: outreach email skipped", {
            prospectId,
            reason: (err as Error)?.message,
          });
        }
      }
    }
  }

  // firstRequestedAt tracks request timing always; status/outreachCount reflect
  // ACTUAL sends only (so "how many have we contacted" stays truthful).
  await prospectRef.update({
    firstRequestedAt: prospect.firstRequestedAt ?? FieldValue.serverTimestamp(),
    ...(emailed
      ? { status: "outreach_sent", outreachCount: FieldValue.increment(1), lastOutreachAt: FieldValue.serverTimestamp() }
      : {}),
  });

  logger.info("requestProspectOutreach", { uid, prospectId, leadId: leadRef.id, emailed });
  return { status: "pending_signup" as const, leadId: leadRef.id, emailed };
});
