import { db } from "../lib/admin";
import { enqueueMail } from "../lib/mail";

// Denormalised display fields stored on every vouch so the public profile
// can render the chip row without cross-account /users reads. Snapshotted
// at create/accept/link time — small acceptable staleness vs a fanout
// trigger on every profile edit.
export interface VoucherDisplay {
  fromDisplayName: string;
  fromPhotoURL: string | null;
  fromPrimaryTrade: string | null;
}

export interface VoucheeDisplay {
  displayName: string;
  photoURL: string | null;
  primaryTrade: string | null;
}

interface UserDoc {
  displayName?: string;
  photoURL?: string | null;
  email?: string;
}
interface TradieDoc {
  trades?: string[];
}

export async function loadVoucherDisplay(uid: string): Promise<VoucherDisplay> {
  const [userSnap, tradieSnap] = await Promise.all([
    db.doc(`users/${uid}`).get(),
    db.doc(`tradespeople/${uid}`).get(),
  ]);
  const user = userSnap.data() as UserDoc | undefined;
  const tradie = tradieSnap.data() as TradieDoc | undefined;
  return {
    fromDisplayName: (user?.displayName ?? "").trim() || "Tradesperson",
    fromPhotoURL: user?.photoURL ?? null,
    fromPrimaryTrade: tradie?.trades?.[0] ?? null,
  };
}

export async function loadVoucheeDisplay(uid: string): Promise<VoucheeDisplay> {
  const [userSnap, tradieSnap] = await Promise.all([
    db.doc(`users/${uid}`).get(),
    db.doc(`tradespeople/${uid}`).get(),
  ]);
  const user = userSnap.data() as UserDoc | undefined;
  const tradie = tradieSnap.data() as TradieDoc | undefined;
  return {
    displayName: (user?.displayName ?? "").trim() || "Tradesperson",
    photoURL: user?.photoURL ?? null,
    primaryTrade: tradie?.trades?.[0] ?? null,
  };
}

function appBaseUrl(): string {
  return (process.env.APP_BASE_URL ?? "https://blueseal.app").replace(/\/$/, "");
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Send the invite-by-email message. The link points to /sign-up?invite=<email>
 * so the signup form can prefill the email field; actual claim of the vouch
 * happens in the linkPendingVouchesOnSignup trigger keyed on the new user's
 * email matching toEmail (the URL token is UX-only, not authentication).
 */
export async function sendInviteEmail(args: {
  toEmail: string;
  voucherName: string;
  voucherTrade: string | null;
  inviteeName: string;
  message: string;
}): Promise<void> {
  const base = appBaseUrl();
  const signupUrl = `${base}/sign-up?invite=${encodeURIComponent(args.toEmail)}&as=tradesperson`;
  const tradeLabel = args.voucherTrade ? ` (${args.voucherTrade})` : "";
  const subject = `${args.voucherName} recommended you on Blue Seal`;
  const noteHtml = args.message
    ? `<blockquote style="margin:16px 0;padding:8px 12px;border-left:3px solid #1d4ed8;color:#374151;">${escapeHtml(args.message)}</blockquote>`
    : "";
  const noteText = args.message ? `\n\n"${args.message}"\n` : "";

  await enqueueMail({
    to: args.toEmail,
    subject,
    text:
      `Hi ${args.inviteeName},\n\n` +
      `${args.voucherName}${tradeLabel} recommended you on Blue Seal — a verified-trades platform in Canada.${noteText}\n` +
      `Sign up to claim your profile and the recommendation appears on both your profile and theirs:\n${signupUrl}\n\n` +
      `If you weren't expecting this, you can ignore the email.\n`,
    html:
      `<p>Hi ${escapeHtml(args.inviteeName)},</p>` +
      `<p><strong>${escapeHtml(args.voucherName)}</strong>${escapeHtml(tradeLabel)} recommended you on Blue Seal — a verified-trades platform in Canada.</p>` +
      noteHtml +
      `<p>Sign up to claim your profile and the recommendation appears on both your profile and theirs:</p>` +
      `<p><a href="${signupUrl}" style="display:inline-block;background:#1d4ed8;color:white;padding:10px 18px;border-radius:6px;text-decoration:none;font-weight:600;">Sign up on Blue Seal</a></p>` +
      `<p style="color:#6b7280;font-size:12px;">If you weren't expecting this, you can ignore the email.</p>`,
  });
}
