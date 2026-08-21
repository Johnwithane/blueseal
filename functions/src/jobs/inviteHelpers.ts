// Helpers for the bring-your-own-client invite flow: the magic sign-in link,
// the CASL-compliant invite email, and the suppression check. Mirrors the
// prospect-outreach machinery (functions/src/prospects/helpers.ts) — same
// mailing-address gate, same HMAC unsubscribe pattern, same escapeHtml
// discipline — because both flows make Blue Seal email someone who never
// asked us directly.

import { logger } from "firebase-functions/v2";
import { adminAuth, db } from "../lib/admin";
import { enqueueMail } from "../lib/mail";
import { brandedEmailHtml } from "../lib/emailTemplate";
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
 *
 * variant "review": the job is already complete and the tradesperson is
 * asking the client to sign in and leave a review (issue #29 follow-up) —
 * same magic-link mechanics and CASL footer, review-framed copy.
 */
export async function sendInviteEmail(args: {
  toEmail: string;
  clientName: string;
  tradieName: string;
  tradeName: string;
  signinLink: string;
  jobId: string;
  variant?: "review";
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

  // CASL footer (legal name + mailing address + consent basis + unsubscribe).
  // This recipient has no Blue Seal account yet, so we override the wrapper's
  // default "you have an account" footer. brandedEmailHtml injects it verbatim,
  // so every interpolation is escaped here. Palette matches emailTemplate.ts
  // (MUTED #6B6862 text, BLUE #374C76 link).
  const footerHtml =
    `<p style="margin:0;font-size:12px;line-height:1.5;color:#6B6862;">` +
    `${escapeHtml(sender)}<br/>${escapeHtml(address)}<br/>` +
    `${escapeHtml(basis)} <a href="${escapeHtml(unsubUrl)}" style="color:#374C76;text-decoration:underline;">Unsubscribe</a>.</p>`;

  const review = args.variant === "review";
  const subject = review
    ? `How did ${args.tradieName} do? Leave a review on Blue Seal`
    : `${args.tradieName} set up your job on Blue Seal`;
  const bodyLine = review
    ? `Hi ${args.clientName}, ${args.tradieName} (${args.tradeName}) wrapped up your job on Blue Seal. Tap through to see the finished job and leave a review.`
    : `Hi ${args.clientName}, ${args.tradieName} (${args.tradeName}) is using Blue Seal to manage your job: quotes, schedule, and invoices in one place.`;

  await enqueueMail({
    to: args.toEmail,
    subject,
    text:
      `${bodyLine}\n\n` +
      `One click signs you in (no password needed):\n${args.signinLink}\n\n` +
      `${sender}\n${address}\n` +
      `${basis} Unsubscribe: ${unsubUrl}\n`,
    // Same branded shell (logo header, signature footer) as the tradesperson
    // and project-manager welcome emails — the client's first impression of
    // Blue Seal should match, not a plainer one-off template.
    html: brandedEmailHtml({
      title: review ? "How did it go?" : "Welcome to Blue Seal",
      bodyLines: [bodyLine, "One click signs you in. No password needed."],
      ctaLabel: review ? "Leave a review" : "View your job",
      ctaUrl: args.signinLink,
      preheader: review
        ? `${args.tradieName} finished the job. Leave a review on Blue Seal.`
        : `${args.tradieName} set up your job on Blue Seal.`,
      footerHtml,
    }),
  });
  return true;
}

/**
 * Post-invite EVENT email to an UNCLAIMED invite client (job.clientId still
 * null) — a quote was sent, an invoice is ready. `notify()` is uid-only and
 * skips a null clientId, so a solo/invite job's client would otherwise hear
 * nothing after the first invite. This reaches them at clientInvite.emailLower
 * with the same machinery as the initial invite: a magic sign-in link as the
 * CTA (one tap signs them in AND claimJobInvite attaches them, after which
 * normal uid notifications take over), the suppression check, and the CASL
 * footer. The event detail (itemized quote/invoice) rides in `contentHtml` so
 * the client can read it in their inbox before deciding to click through.
 *
 * Returns false (not sent) when the recipient is suppressed, the magic link
 * couldn't be minted (email-link sign-in disabled), or the CASL mailing address
 * isn't configured — same degrade-to-nothing contract as sendInviteEmail. The
 * tradesperson can still record acceptance / mark paid offline either way.
 */
export async function sendInviteClientJobEmail(args: {
  toEmail: string;
  clientName: string;
  tradieName: string;
  jobId: string;
  subject: string;
  // Complete opening sentence (already includes the "Hi <name>," greeting).
  bodyLine: string;
  // Pre-built, pre-escaped itemized breakdown (lib/emailBreakdown.ts).
  contentHtml: string;
  ctaLabel: string;
}): Promise<boolean> {
  if (await isInviteEmailSuppressed(args.toEmail)) return false;
  const signinLink = await inviteMagicLink(args.toEmail);
  if (!signinLink) return false;

  const address = caslMailingAddress();
  if (!address) return false;
  const unsubToken = unsubTokenFor(`invite_${args.jobId}`);
  if (!unsubToken) return false;

  const sender = SENDER_NAME();
  const unsubUrl = `${appBaseUrl()}/jobs-invite-unsub?j=${encodeURIComponent(args.jobId)}&t=${unsubToken}`;
  const basis =
    `You're receiving this because ${args.tradieName} set up a job for you on ` +
    `Blue Seal and asked us to keep you posted on it.`;
  const footerHtml =
    `<p style="margin:0;font-size:12px;line-height:1.5;color:#6B6862;">` +
    `${escapeHtml(sender)}<br/>${escapeHtml(address)}<br/>` +
    `${escapeHtml(basis)} <a href="${escapeHtml(unsubUrl)}" style="color:#374C76;text-decoration:underline;">Unsubscribe</a>.</p>`;

  await enqueueMail({
    to: args.toEmail,
    subject: args.subject,
    text:
      `${args.bodyLine}\n\n` +
      `One click signs you in (no password needed):\n${signinLink}\n\n` +
      `${sender}\n${address}\n` +
      `${basis} Unsubscribe: ${unsubUrl}\n`,
    html: brandedEmailHtml({
      title: args.subject,
      bodyLines: [args.bodyLine],
      contentHtml: args.contentHtml,
      ctaLabel: args.ctaLabel,
      ctaUrl: signinLink,
      preheader: args.bodyLine,
      footerHtml,
    }),
  });
  return true;
}
