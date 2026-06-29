// Helpers for the project-invite flow: the magic sign-in link, the CASL-compliant
// project invite email, and the unsubscribe link. Mirrors the bring-your-own-client
// job invite (functions/src/jobs/inviteHelpers.ts) — same mailing-address gate, same
// HMAC unsubscribe pattern, same escapeHtml discipline. The suppression check is
// SHARED with job invites (isInviteEmailSuppressed): unsubscribing from one opts you
// out of both, since they're the same "Blue Seal emails someone who never asked us
// directly" surface.

import { logger } from "firebase-functions/v2";
import { adminAuth } from "../lib/admin";
import { enqueueMail } from "../lib/mail";
import { brandedEmailHtml } from "../lib/emailTemplate";
import {
  appBaseUrl,
  caslMailingAddress,
  escapeHtml,
  unsubTokenFor,
} from "../prospects/helpers";

const SENDER_NAME = (): string => process.env.BLUE_SEAL_LEGAL_NAME?.trim() || "Blue Seal";

/**
 * Firebase email-link sign-in URL for the invited client. Continue URL is the
 * project-invite claim landing (/claim-project). Returns null on failure
 * (email-link sign-in not enabled yet) so invites degrade to copy-link. The URL
 * carries only the email — no project data — so a link scanner that prefetches
 * it learns nothing.
 */
export async function projectMagicLink(email: string): Promise<string | null> {
  try {
    return await adminAuth.generateSignInWithEmailLink(email, {
      url: `${appBaseUrl()}/claim-project?email=${encodeURIComponent(email)}`,
      handleCodeInApp: true,
    });
  } catch (err) {
    logger.warn("projectMagicLink: generate failed (email-link sign-in not enabled?)", { err });
    return null;
  }
}

/**
 * The project invite email. Fixed template — nothing in it is PM-authored free
 * text (CASL truthfulness + injection surface), every interpolation is escaped,
 * and it only sends when the CASL mailing address is configured. Returns false
 * (not sent) when gated.
 */
export async function sendProjectInviteEmail(args: {
  toEmail: string;
  clientName: string;
  pmName: string;
  projectLabel: string;
  jobCount: number;
  signinLink: string;
  projectId: string;
}): Promise<boolean> {
  const address = caslMailingAddress();
  if (!address) return false; // no compliant footer → don't send
  const unsubToken = unsubTokenFor(`project_invite_${args.projectId}`);
  if (!unsubToken) return false; // can't produce the CASL-required unsubscribe link

  const sender = SENDER_NAME();
  const unsubUrl = `${appBaseUrl()}/projects-invite-unsub?p=${encodeURIComponent(args.projectId)}&t=${unsubToken}`;
  const jobLine =
    args.jobCount === 1 ? "a job" : `${args.jobCount} jobs`;
  const basis =
    `You're receiving this because ${args.pmName} set up a project for you on ` +
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

  await enqueueMail({
    to: args.toEmail,
    subject: `${args.pmName} set up a project for you on Blue Seal`,
    text:
      `Hi ${args.clientName},\n\n` +
      `${args.pmName} is using Blue Seal to organize "${args.projectLabel}": ` +
      `${jobLine} they'd like to line up trusted trades for. You choose who does the work.\n\n` +
      `One click signs you in (no password needed):\n${args.signinLink}\n\n` +
      `${sender}\n${address}\n` +
      `${basis} Unsubscribe: ${unsubUrl}\n`,
    // Same branded shell (logo header, signature footer) as the tradesperson
    // and project-manager welcome emails — the client's first impression of
    // Blue Seal should match, not a plainer one-off template.
    html: brandedEmailHtml({
      title: "Welcome to Blue Seal",
      bodyLines: [
        `Hi ${args.clientName}, ${args.pmName} is using Blue Seal to organize "${args.projectLabel}": ${jobLine} they'd like to line up trusted trades for. You choose who does the work.`,
        "One click signs you in. No password needed.",
      ],
      ctaLabel: "View your project",
      ctaUrl: args.signinLink,
      preheader: `${args.pmName} set up a project for you on Blue Seal.`,
      footerHtml,
    }),
  });
  return true;
}
