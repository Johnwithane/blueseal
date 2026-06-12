// Helpers for the bring-your-own-client invite flow: the magic sign-in link,
// the CASL-compliant invite email, and the suppression check. Mirrors the
// prospect-outreach machinery (functions/src/prospects/helpers.ts) — same
// mailing-address gate, same HMAC unsubscribe pattern, same escapeHtml
// discipline — because both flows make Blue Seal email someone who never
// asked us directly.

import { logger } from "firebase-functions/v2";
import { adminAuth, db } from "../lib/admin";
import { enqueueMail } from "../lib/mail";
import {
  appBaseUrl,
  caslMailingAddress,
  emailHashOf,
  escapeHtml,
  unsubTokenFor,
} from "../prospects/helpers";

const SENDER_NAME = (): string => process.env.BLUE_SEAL_LEGAL_NAME?.trim() || "Blue Seal";

/**
 * Firebase email-link sign-in URL for the invited client. Continue URL is the
 * job-invite claim landing (/claim-job) — NOT the prospect /claim route, which
 * provisions tradespeople. Returns null on failure (email-link sign-in not
 * enabled in the console yet — HUMANTASKS) so invites degrade to copy-link.
 * The URL carries only the email — no job data — so a link scanner that
 * prefetches it learns nothing.
 */
export async function inviteMagicLink(email: string): Promise<string | null> {
  try {
    return await adminAuth.generateSignInWithEmailLink(email, {
      url: `${appBaseUrl()}/claim-job?email=${encodeURIComponent(email)}`,
      handleCodeInApp: true,
    });
  } catch (err) {
    logger.warn("inviteMagicLink: generate failed (email-link sign-in not enabled?)", { err });
    return null;
  }
}

/**
 * Permanent opt-out check. A recipient who unsubscribed from invite emails is
 * never emailed again (tombstone keyed by emailHash, written by the
 * unsubscribeJobInvite endpoint). Copy-link delivery still works — the
 * tradesperson can always text the link themselves.
 */
export async function isInviteEmailSuppressed(email: string): Promise<boolean> {
  const snap = await db.doc(`inviteSuppression/${emailHashOf(email)}`).get();
  return snap.exists;
}

/**
 * The invite email. Fixed template — nothing in it is tradesperson-authored
 * free text (CASL truthfulness + injection surface), every interpolation is
 * escaped, and it only sends when the CASL mailing address is configured.
 * Returns false (not sent) when gated.
 */
export async function sendInviteEmail(args: {
  toEmail: string;
  clientName: string;
  tradieName: string;
  tradeName: string;
  signinLink: string;
  jobId: string;
}): Promise<boolean> {
  const address = caslMailingAddress();
  if (!address) return false; // no compliant footer → don't send
  const unsubToken = unsubTokenFor(`invite_${args.jobId}`);
  if (!unsubToken) return false; // can't produce the CASL-required unsubscribe link

  const sender = SENDER_NAME();
  const unsubUrl = `${appBaseUrl()}/jobs-invite-unsub?j=${encodeURIComponent(args.jobId)}&t=${unsubToken}`;
  const basis =
    `You're receiving this because ${args.tradieName} created a job for you on ` +
    `Blue Seal and asked us to invite you.`;

  await enqueueMail({
    to: args.toEmail,
    subject: `${args.tradieName} set up your job on Blue Seal`,
    text:
      `Hi ${args.clientName},\n\n` +
      `${args.tradieName} (${args.tradeName}) is using Blue Seal to manage your job — ` +
      `quotes, schedule, and invoices in one place.\n\n` +
      `One click signs you in (no password needed):\n${args.signinLink}\n\n` +
      `—\n${sender}\n${address}\n` +
      `${basis} Unsubscribe: ${unsubUrl}\n`,
    html:
      `<p>Hi ${escapeHtml(args.clientName)},</p>` +
      `<p><strong>${escapeHtml(args.tradieName)}</strong> (${escapeHtml(args.tradeName)}) is using ` +
      `<strong>Blue Seal</strong> to manage your job — quotes, schedule, and invoices in one place.</p>` +
      `<p>One click signs you in — no password needed:</p>` +
      `<p><a href="${escapeHtml(args.signinLink)}" style="display:inline-block;background:#1d4ed8;color:white;padding:10px 18px;border-radius:6px;text-decoration:none;font-weight:600;">View your job</a></p>` +
      `<hr style="margin-top:20px;border:none;border-top:1px solid #e5e7eb;"/>` +
      `<p style="color:#6b7280;font-size:12px;">${escapeHtml(sender)}<br/>${escapeHtml(address)}<br/>` +
      `${escapeHtml(basis)} <a href="${escapeHtml(unsubUrl)}">Unsubscribe</a>.</p>`,
  });
  return true;
}
