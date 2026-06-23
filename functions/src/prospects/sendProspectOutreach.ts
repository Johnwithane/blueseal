// Admin-only callable: send a personal, manually-reviewed outreach email to one
// seeded prospect inviting them to claim their free Blue Seal listing.
//
// Unlike requestProspectOutreach (client-triggered, "a customer wants you"),
// this is admin-triggered ("we built you a free listing, come claim it") and the
// admin edits the subject + message before sending — so it reads personal, not
// templated. The server still OWNS compliance: it appends the claim CTA + the
// CASL footer (legal name + physical mailing address + truthful consent basis +
// unsubscribe), and refuses to send unless every gate holds:
//   - the listing isn't suppressed (opted out) or already claimed
//   - emailConspicuouslyPublished === true (the CASL implied-consent basis)
//   - a usable harvested email exists
//   - BLUE_SEAL_MAILING_ADDRESS + PROSPECT_UNSUB_SECRET are configured
//   - a Firebase magic sign-in link could be generated (so the CTA signs them
//     in and claimProspect can run securely)
// So a manual send is still a compliant send, whatever the admin typed.

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";
import { z } from "zod";

import { CALLABLE_OPTS } from "../lib/callable";
import { adminAuth, db } from "../lib/admin";
import { requireAdmin } from "../lib/auth";
import { logAdminAction } from "../lib/audit";
import { enqueueMail } from "../lib/mail";
import {
  appBaseUrl,
  buildProspectOutreachEmail,
  caslMailingAddress,
  caslOutreachBasisSentence,
  unsubTokenFor,
} from "./helpers";

const Input = z.object({
  prospectId: z.string().trim().min(1).max(64),
  subject: z.string().trim().min(3).max(160),
  // The editable message. First line renders as the in-email headline; the
  // rest are body paragraphs. The CTA + CASL footer are appended server-side.
  bodyLines: z.array(z.string().trim().min(1).max(2000)).min(1).max(12),
  // Optional CC addresses (e.g. the admin keeping a copy). Validated + deduped
  // in enqueueMail; bounded here to keep the send small.
  cc: z.array(z.string().trim().email().max(200)).max(5).optional(),
});

const SENDER_NAME = (): string => process.env.BLUE_SEAL_LEGAL_NAME?.trim() || "Blue Seal";

// Generate a Firebase email-link sign-in URL for the prospect's email. Clicking
// it proves the recipient controls the inbox and signs them in with a verified
// email, so claimProspect can migrate their seeded profile securely. Requires
// email-link sign-in enabled + the continue domain authorized (HUMANTASKS).
async function magicSigninLink(email: string): Promise<string | null> {
  try {
    return await adminAuth.generateSignInWithEmailLink(email, {
      url: `${appBaseUrl()}/claim?email=${encodeURIComponent(email)}`,
      handleCodeInApp: true,
    });
  } catch (err) {
    logger.warn("sendProspectOutreach: magic link generation failed", { err });
    return null;
  }
}

export const sendProspectOutreach = onCall(CALLABLE_OPTS, async (req) => {
  const actor = requireAdmin(req);
  const parsed = Input.safeParse(req.data);
  if (!parsed.success) {
    throw new HttpsError("invalid-argument", parsed.error.issues[0]?.message ?? "Invalid input.");
  }
  const { prospectId, subject, bodyLines, cc } = parsed.data;

  const prospectRef = db.doc(`prospects/${prospectId}`);
  const prospectSnap = await prospectRef.get();
  if (!prospectSnap.exists) {
    throw new HttpsError("not-found", "That prospect no longer exists.");
  }
  const prospect = prospectSnap.data() as Record<string, unknown>;

  if (prospect.status === "claimed") {
    throw new HttpsError("failed-precondition", "This prospect has already claimed their profile.");
  }
  if (prospect.status === "suppressed") {
    throw new HttpsError("failed-precondition", "This prospect opted out and must not be contacted.");
  }
  if (prospect.emailConspicuouslyPublished !== true) {
    throw new HttpsError(
      "failed-precondition",
      "Can't email: this listing's email isn't marked as conspicuously published (the CASL basis to contact). Mark it published only if you've confirmed it's publicly posted with no 'no unsolicited mail' notice.",
    );
  }

  const emailHash = typeof prospect.emailHash === "string" ? prospect.emailHash : "";
  // Belt-and-suspenders: never email anyone with a suppression tombstone, even
  // if the prospect doc's status somehow lags.
  if (emailHash) {
    const supp = await db.doc(`prospectSuppression/${emailHash}`).get();
    if (supp.exists) {
      throw new HttpsError("failed-precondition", "This contact opted out and must not be emailed.");
    }
  }

  // CASL config gates — without these we can't build a compliant footer, so we
  // refuse to send (rather than silently dropping the mailing address / unsub).
  const mailingAddress = caslMailingAddress();
  const unsubToken = unsubTokenFor(prospectId);
  if (!mailingAddress || !unsubToken) {
    throw new HttpsError(
      "failed-precondition",
      "Outreach isn't configured yet. Set BLUE_SEAL_MAILING_ADDRESS and PROSPECT_UNSUB_SECRET in the functions environment first (see HUMANTASKS.md).",
    );
  }

  const contactSnap = await db.doc(`prospects/${prospectId}/private/contact`).get();
  const toEmail = contactSnap.data()?.prospectEmail;
  if (typeof toEmail !== "string" || !toEmail) {
    throw new HttpsError("failed-precondition", "This listing has no email on file to contact.");
  }

  const signinLink = await magicSigninLink(toEmail);
  if (!signinLink) {
    throw new HttpsError(
      "failed-precondition",
      "Couldn't generate a sign-in link. Enable email-link sign-in + authorize the continue domain in the Firebase console (see HUMANTASKS.md).",
    );
  }

  const trade =
    Array.isArray(prospect.trades) && prospect.trades.length
      ? String(prospect.trades[0])
      : "tradesperson";
  const basisSentence = caslOutreachBasisSentence(
    String(prospect.dataConsentBasis ?? ""),
    String(prospect.source ?? ""),
    trade,
  );
  const unsubUrl = `${appBaseUrl()}/p/unsubscribe?p=${encodeURIComponent(prospectId)}&t=${unsubToken}`;

  const { html, text } = buildProspectOutreachEmail({
    bodyLines,
    ctaLabel: "See your free profile",
    ctaUrl: signinLink,
    senderName: SENDER_NAME(),
    mailingAddress,
    basisSentence,
    unsubUrl,
  });

  await enqueueMail({ to: toEmail, subject, text, html, cc, replyTo: process.env.BLUE_SEAL_REPLY_TO });

  await prospectRef.update({
    status: "outreach_sent",
    outreachCount: FieldValue.increment(1),
    lastOutreachAt: FieldValue.serverTimestamp(),
    firstRequestedAt: prospect.firstRequestedAt ?? FieldValue.serverTimestamp(),
  });

  await logAdminAction({
    actorUid: actor,
    action: "sendProspectOutreach",
    targetType: "prospects",
    targetId: prospectId,
    metadata: {
      previousOutreachCount: typeof prospect.outreachCount === "number" ? prospect.outreachCount : 0,
      subjectLength: subject.length,
    },
  });
  logger.info("sendProspectOutreach: sent", { actor, prospectId });

  return {
    status: "sent" as const,
    lastOutreachAt: Timestamp.now().toMillis(),
  };
});
