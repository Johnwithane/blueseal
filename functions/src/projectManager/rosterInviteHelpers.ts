// Helpers for the PM "invite a tradesperson to my roster" email. Mirrors the
// job/project invite machinery (functions/src/jobs/inviteHelpers.ts) — same
// mailing-address gate, same HMAC unsubscribe pattern, same escapeHtml
// discipline — because this is Blue Seal emailing a tradesperson who never
// asked us directly. The suppression list is SHARED with job/project invites
// (isInviteEmailSuppressed): one unsubscribe opts out of all three.
//
// The CTA is a signup DEEP LINK (not a passwordless magic link): a tradesperson
// must go through real onboarding + vetting, so the link drops them on the
// signup form preselected as a tradesperson with their email prefilled. The
// roster join is wired server-side by linkRosterInvitesOnSignup, keyed on the
// new user's email matching the invite — the URL is UX-only, not authentication.

import { enqueueMail } from "../lib/mail";
import { appBaseUrl, caslMailingAddress, escapeHtml, unsubTokenFor } from "../prospects/helpers";

const SENDER_NAME = (): string => process.env.BLUE_SEAL_LEGAL_NAME?.trim() || "Blue Seal";

/** Signup deep link that preselects the tradesperson role and prefills the email. */
export function rosterSignupUrl(email: string): string {
  return (
    `${appBaseUrl()}/sign-up?as=tradesperson` +
    `&invite=${encodeURIComponent(email)}&utm_source=pm_roster_invite`
  );
}

/**
 * The roster invite email. Fixed template — nothing in it is PM-authored free
 * text beyond the (escaped) recipient name (CASL truthfulness + injection
 * surface), and it only sends when the CASL mailing address + unsubscribe secret
 * are configured. Returns false (not sent) when gated.
 */
export async function sendRosterInviteEmail(args: {
  toEmail: string;
  inviteeName: string;
  pmName: string;
  inviteId: string;
}): Promise<boolean> {
  const address = caslMailingAddress();
  if (!address) return false; // no compliant footer → don't send
  const unsubToken = unsubTokenFor(`roster_invite_${args.inviteId}`);
  if (!unsubToken) return false; // can't produce the CASL-required unsubscribe link

  const sender = SENDER_NAME();
  const signupUrl = rosterSignupUrl(args.toEmail);
  const unsubUrl = `${appBaseUrl()}/roster-invite-unsub?i=${encodeURIComponent(args.inviteId)}&t=${unsubToken}`;
  const basis =
    `You're receiving this because ${args.pmName} uses Blue Seal to line up trusted trades ` +
    `and asked us to invite you to their roster.`;

  await enqueueMail({
    to: args.toEmail,
    subject: `${args.pmName} invited you to join their roster on Blue Seal`,
    text:
      `Hi ${args.inviteeName},\n\n` +
      `${args.pmName} uses Blue Seal — a verified-trades platform in Canada — to line up ` +
      `trusted trades for their clients, and wants you on their roster.\n\n` +
      `Sign up to claim your profile. Your first month of Blue Seal Pro is on us:\n${signupUrl}\n\n` +
      `—\n${sender}\n${address}\n` +
      `${basis} Unsubscribe: ${unsubUrl}\n`,
    html:
      `<p>Hi ${escapeHtml(args.inviteeName)},</p>` +
      `<p><strong>${escapeHtml(args.pmName)}</strong> uses <strong>Blue Seal</strong> — a ` +
      `verified-trades platform in Canada — to line up trusted trades for their clients, and ` +
      `wants you on their roster.</p>` +
      `<p>Sign up to claim your profile. Your first month of Blue Seal Pro is on us:</p>` +
      `<p><a href="${escapeHtml(signupUrl)}" style="display:inline-block;background:#1d4ed8;color:white;padding:10px 18px;border-radius:6px;text-decoration:none;font-weight:600;">Join Blue Seal</a></p>` +
      `<hr style="margin-top:20px;border:none;border-top:1px solid #e5e7eb;"/>` +
      `<p style="color:#6b7280;font-size:12px;">${escapeHtml(sender)}<br/>${escapeHtml(address)}<br/>` +
      `${escapeHtml(basis)} <a href="${escapeHtml(unsubUrl)}">Unsubscribe</a>.</p>`,
  });
  return true;
}
