import { FieldValue, GeoPoint } from "firebase-admin/firestore";
import { createHash, createHmac } from "node:crypto";
import { enqueueMail } from "../lib/mail";
import { brandedEmailHtml } from "../lib/emailTemplate";

export const sha256 = (s: string): string => createHash("sha256").update(s).digest("hex");
export const emailHashOf = (email: string): string => sha256(email.trim().toLowerCase());

export function appBaseUrl(): string {
  return (process.env.APP_BASE_URL ?? "https://blueseal.app").replace(/\/$/, "");
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// CASL compliance gate. A commercial electronic message MUST carry the sender's
// valid physical mailing address. Until BLUE_SEAL_MAILING_ADDRESS is set in the
// functions env, outreach emails are NOT sent (the lead is still created). See
// HUMANTASKS.md.
export function caslMailingAddress(): string | null {
  const a = process.env.BLUE_SEAL_MAILING_ADDRESS;
  return a && a.trim() ? a.trim() : null;
}
const SENDER_NAME = (): string => process.env.BLUE_SEAL_LEGAL_NAME?.trim() || "Blue Seal";

// Unsubscribe token = HMAC(secret, prospectId). NOT stored on any doc, so it
// can't leak via the world-readable prospect doc (an attacker can't forge it
// without the secret). suppressProspect recomputes + compares. Requires
// PROSPECT_UNSUB_SECRET in the functions env; without it we can't produce a
// valid (CASL-required) unsubscribe link, so outreach is gated off too.
export function unsubTokenFor(prospectId: string): string | null {
  const secret = process.env.PROSPECT_UNSUB_SECRET;
  if (!secret || !secret.trim()) return null;
  return createHmac("sha256", secret.trim()).update(prospectId).digest("hex");
}

// Truthful, row-accurate CASL consent basis. Varies by where the contact came
// from so the footer never misdescribes the source (a CASL truthfulness req).
export function caslBasisSentence(dataConsentBasis: string, source: string, tradeName: string): string {
  const src = source && source.trim() ? source.trim() : "a public source";
  switch (dataConsentBasis) {
    case "open_data":
    case "public_registry":
      return `You're receiving this because your ${tradeName} business is listed in public business records (${src}) and a real customer asked to contact you.`;
    case "industry_association":
      return `You're receiving this because your ${tradeName} business is publicly listed by ${src} and a real customer asked to contact you.`;
    default:
      return `You're receiving this because your ${tradeName} business is publicly listed (${src}) and a real customer asked to contact you.`;
  }
}

// CASL consent-basis sentence for ADMIN-INITIATED outreach ("we built you a free
// listing, come claim it") — distinct from caslBasisSentence above, which says a
// real customer asked to contact you (true only for the client-request flow).
// This one must not overstate: it's a publicly-listed business + an invitation.
export function caslOutreachBasisSentence(
  dataConsentBasis: string,
  source: string,
  tradeName: string,
): string {
  const src = source && source.trim() ? source.trim() : "a public source";
  switch (dataConsentBasis) {
    case "open_data":
    case "public_registry":
      return `You're receiving this because your ${tradeName} business is listed in public business records (${src}).`;
    case "industry_association":
      return `You're receiving this because your ${tradeName} business is publicly listed by ${src}.`;
    default:
      return `You're receiving this because your ${tradeName} business email is publicly published online (${src}).`;
  }
}

// The CASL-compliant footer for a cold outreach email: sender's legal name, a
// valid physical mailing address, the truthful consent basis, and a working
// unsubscribe link. Replaces the branded shell's default "you have an account"
// footer (which would be false for a prospect). Pre-escaped + inline-styled.
function caslOutreachFooterHtml(args: {
  senderName: string;
  mailingAddress: string;
  basisSentence: string;
  unsubUrl: string;
}): string {
  return (
    `<p style="margin:0;font-size:12px;line-height:1.5;color:#6B6862;">` +
    `${escapeHtml(args.senderName)} · ${escapeHtml(args.mailingAddress)}<br/>` +
    `${escapeHtml(args.basisSentence)} ` +
    `<a href="${escapeHtml(args.unsubUrl)}" style="color:#374C76;text-decoration:underline;">Unsubscribe</a> ` +
    `or <a href="${escapeHtml(args.unsubUrl)}" style="color:#374C76;text-decoration:underline;">remove this listing</a>.` +
    `</p>`
  );
}

/**
 * Build the admin outreach email (text + branded HTML) from the admin-edited
 * subject + body paragraphs. The personal message is whatever the admin typed;
 * the CTA (claim link), the sign-off, and the CASL footer (legal name + mailing
 * address + basis + unsubscribe) are ALWAYS appended by the server, so a manual
 * send is still a compliant send no matter what the admin edited.
 */
export function buildProspectOutreachEmail(args: {
  bodyLines: string[];
  ctaLabel: string;
  ctaUrl: string;
  senderName: string;
  mailingAddress: string;
  basisSentence: string;
  unsubUrl: string;
}): { html: string; text: string } {
  const footerHtml = caslOutreachFooterHtml({
    senderName: args.senderName,
    mailingAddress: args.mailingAddress,
    basisSentence: args.basisSentence,
    unsubUrl: args.unsubUrl,
  });
  const html = brandedEmailHtml({
    title: args.bodyLines[0] ?? "A free Blue Seal listing for your business",
    // First line becomes the heading; remaining lines are the body paragraphs.
    bodyLines: args.bodyLines.slice(1),
    ctaLabel: args.ctaLabel,
    ctaUrl: args.ctaUrl,
    footerHtml,
  });
  const text =
    `${args.bodyLines.join("\n\n")}\n\n` +
    `${args.ctaLabel}: ${args.ctaUrl}\n\n` +
    `—\n${args.senderName}\n${args.mailingAddress}\n` +
    `${args.basisSentence} Unsubscribe / remove this listing: ${args.unsubUrl}\n`;
  return { html, text };
}

/**
 * Truthful outreach email to a seeded prospect: a REAL client requested them.
 * The CTA is a Firebase magic sign-in link (the caller generates it), so
 * clicking it proves the recipient controls the inbox and signs them in with a
 * verified email — claim then runs securely. CASL-gated: returns false (no
 * send) when no mailing address is configured. The lead is created regardless.
 */
export async function sendOutreachEmail(args: {
  toEmail: string;
  prospectName: string;
  clientCity: string;
  tradeName: string;
  signinLink: string;
  unsubUrl: string;
  basisSentence: string;
}): Promise<boolean> {
  const address = caslMailingAddress();
  if (!address) return false; // gated: no compliant footer → don't send

  const cityBit = args.clientCity ? ` in ${args.clientCity}` : "";
  const subject = `A customer${cityBit} wants to hire you on Blue Seal`;
  const sender = SENDER_NAME();

  await enqueueMail({
    to: args.toEmail,
    subject,
    text:
      `Hi ${args.prospectName},\n\n` +
      `A customer${cityBit} found your ${args.tradeName} business and wants to hire ` +
      `you through Blue Seal — a verified-trades platform in Canada.\n\n` +
      `See the request and respond (one click signs you in — no password):\n${args.signinLink}\n\n` +
      `—\n${sender}\n${address}\n` +
      `${args.basisSentence} Unsubscribe: ${args.unsubUrl}\n`,
    html:
      `<p>Hi ${escapeHtml(args.prospectName)},</p>` +
      `<p>A customer${escapeHtml(cityBit)} found your ${escapeHtml(args.tradeName)} ` +
      `business and wants to hire you through <strong>Blue Seal</strong> — a verified-trades ` +
      `platform in Canada.</p>` +
      `<p>See the request and respond — one click signs you in, no password:</p>` +
      `<p><a href="${escapeHtml(args.signinLink)}" style="display:inline-block;background:#1d4ed8;color:white;padding:10px 18px;border-radius:6px;text-decoration:none;font-weight:600;">See the request</a></p>` +
      `<hr style="margin-top:20px;border:none;border-top:1px solid #e5e7eb;"/>` +
      `<p style="color:#6b7280;font-size:12px;">${escapeHtml(sender)}<br/>${escapeHtml(address)}<br/>` +
      `${escapeHtml(args.basisSentence)} <a href="${escapeHtml(args.unsubUrl)}">Unsubscribe</a>.</p>`,
  });
  return true;
}

// Profile fields carried from a seeded prospect into the claimed tradesperson
// draft. Pre-fills the onboarding wizard.
function prospectProfileFields(p: Record<string, unknown>): Record<string, unknown> {
  return {
    companyName: (p.companyName as string | null) ?? null,
    languages: Array.isArray(p.languages) ? p.languages : [],
    bio: typeof p.bio === "string" ? p.bio : "",
    trades: Array.isArray(p.trades) ? p.trades : [],
    yearsExperience:
      p.yearsExperience && typeof p.yearsExperience === "object" ? p.yearsExperience : {},
    pricingModel: typeof p.pricingModel === "string" ? p.pricingModel : "quote",
    hourlyRate: typeof p.hourlyRate === "number" ? p.hourlyRate : null,
    serviceRadiusKm: typeof p.serviceRadiusKm === "number" ? p.serviceRadiusKm : 25,
    locationApprox: (p.locationApprox as GeoPoint | null) ?? null,
    geohashPublic: typeof p.geohashPublic === "string" ? p.geohashPublic : "",
    // Real media an admin uploaded (a generated dicebear avatar is NOT a logo,
    // so only carry a real companyLogoUrl). Gallery + banner carry over too.
    companyLogoUrl: typeof p.companyLogoUrl === "string" ? p.companyLogoUrl : null,
    bannerUrl: typeof p.bannerUrl === "string" ? p.bannerUrl : null,
    portfolioPhotos: Array.isArray(p.portfolioPhotos) ? p.portfolioPhotos : [],
  };
}

/**
 * Full tradespeople/{uid} draft for a newly-claimed prospect. Uses the EXACT
 * draft shape addRoleToSelf writes and hard-sets every trust/state field to
 * draft defaults — a claimed seeded profile enters as an ordinary unvetted
 * draft and passes the same vetting gate as everyone else.
 */
export function buildProspectDraft(
  p: Record<string, unknown>,
  user: { displayName?: unknown; photoURL?: unknown },
): Record<string, unknown> {
  return {
    displayName:
      (typeof user.displayName === "string" && user.displayName) ||
      (typeof p.displayName === "string" ? p.displayName : "") ||
      "",
    // Prefer a real profile photo an admin uploaded (skip the generated dicebear
    // placeholder); otherwise fall back to the claiming user's auth photo.
    photoURL:
      (typeof p.photoURL === "string" && p.photoURL && !p.photoURL.includes("dicebear")
        ? p.photoURL
        : null) ??
      (typeof user.photoURL === "string" ? user.photoURL : null) ??
      null,
    providesFreeQuotes: true,
    ratingAvg: 0,
    ratingCount: 0,
    ratingDimensions: {
      quality: { avg: 0, count: 0 },
      punctuality: { avg: 0, count: 0 },
      communication: { avg: 0, count: 0 },
      value: { avg: 0, count: 0 },
    },
    verifiedTrades: [],
    idVerified: false,
    vettingStatus: "draft",
    vettingNotes: "",
    isVisible: false,
    weeklyAvailability: { mon: [], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] },
    nextInvoiceNumber: 1,
    nextQuoteNumber: 1,
    invoicePrefix: "INV",
    quotePrefix: "Q",
    paymentInstructions: "",
    submittedAt: null,
    approvedAt: null,
    createdAt: FieldValue.serverTimestamp(),
    ...prospectProfileFields(p),
  };
}

// Profile-only overlay when a draft tradespeople doc already exists.
export function prospectDraftOverlay(p: Record<string, unknown>): Record<string, unknown> {
  return prospectProfileFields(p);
}
