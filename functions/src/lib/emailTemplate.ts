// Branded HTML wrapper for transactional email. Email clients strip <style> and
// don't do flexbox, so this is table-based with inline styles, capped at 600px.
// Logos load from the deployed site (public/branding/* → Firebase Hosting) as
// ABSOLUTE URLs so they resolve in any inbox. Palette mirrors
// src/assets/main.css — keep the hexes in sync if the brand ramp changes.

const BASE = (process.env.APP_BASE_URL ?? "https://blueseal.app").replace(/\/$/, "");
// Parentheses in the signature filename are %-encoded so every mail client
// resolves the URL.
const AVATAR_URL = `${BASE}/branding/Brandmark/BlueSeal_Brandmark_Avatar.png`;
const SIGNATURE_URL = `${BASE}/branding/Horizontal/BlueSeal_Logo-Hor_Full%28noborder%29_EmailSignature.png`;

const NAVY = "#2A3A5C";
const BLUE = "#374C76";
const INK = "#494C4F";
const MUTED = "#6B6862";
const BORDER = "#EAE7DF";
const BG = "#FAF9F6";

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export interface BrandedEmailOpts {
  /** Heading shown at the top of the white card. */
  title: string;
  /** Body paragraphs — plain text; each is escaped and wrapped in a <p>. */
  bodyLines: string[];
  /** Optional call-to-action button. */
  ctaLabel?: string;
  ctaUrl?: string;
  /** Hidden inbox-preview text. Defaults to the first body line. */
  preheader?: string;
  /**
   * Optional avatar of the person who triggered the notification (the chat
   * sender, the client who accepted, etc). Absolute URL. When present it's
   * shown as a round avatar to the left of the heading, so it's instantly
   * clear WHO the email is about.
   */
  actorPhotoUrl?: string;
  /**
   * Optional name of that person. Given a distinct colour treatment: if the
   * title already contains it, the name is just recoloured; otherwise it's
   * surfaced on its own line above the title (so a generic "Client accepted
   * your quote" still shows WHO).
   */
  actorName?: string;
}

/**
 * Wrap a transactional message in the Blue Seal branded shell: avatar header,
 * white card with title + body + optional CTA button, and a trust footer
 * (signature logo, legal name + CASL mailing address, and a manage-notifications
 * link). Returns a full HTML document for the email's `html` part.
 */
export function brandedEmailHtml(opts: BrandedEmailOpts): string {
  const preheader = opts.preheader ?? opts.bodyLines[0] ?? "";

  const paras = opts.bodyLines
    .map(
      (l) =>
        `<p style="margin:0 0 14px;font-size:16px;line-height:1.5;color:${INK};">${esc(l)}</p>`,
    )
    .join("");

  const cta =
    opts.ctaUrl && opts.ctaLabel
      ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:6px 0 2px;"><tr>` +
        `<td style="border-radius:8px;background:${BLUE};">` +
        `<a href="${esc(opts.ctaUrl)}" style="display:inline-block;padding:12px 30px;font-size:16px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px;">${esc(opts.ctaLabel)}</a>` +
        `</td></tr></table>`
      : "";

  // Heading — surface the person's NAME on its own line (distinct colour) and
  // the action below, so it reads "Sarah Chen / Accepted your quote".
  //  • "Sarah Chen accepted your quote" (starts with the name) → name above,
  //    "Accepted your quote" below.
  //  • "Client accepted your quote" (generic noun) → name above, noun dropped.
  //  • name sits mid-title and can't be split out → recolour it in place.
  const name = opts.actorName?.trim();
  const cap = (s: string): string => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
  // The NAME is the hero: dark + bold. The action reads as a lighter subtitle.
  const nameDiv = (n: string): string =>
    `<div style="font-size:19px;font-weight:700;line-height:1.25;color:${NAVY};margin:0 0 2px;">${esc(n)}</div>`;

  let titleText = opts.title;
  let namePrefix = "";
  if (name && titleText.startsWith(name)) {
    namePrefix = nameDiv(name);
    const rest = titleText.slice(name.length).trim();
    if (rest) titleText = cap(rest);
  } else if (name && !titleText.includes(name)) {
    namePrefix = nameDiv(name);
    const stripped = titleText.replace(/^(client|the tradesperson|someone)\s+/i, "");
    if (stripped !== titleText && stripped.length > 0) titleText = cap(stripped);
  }
  let titleInner = esc(titleText);
  if (name && !namePrefix && titleInner.includes(esc(name))) {
    titleInner = titleInner.split(esc(name)).join(`<span style="color:${NAVY};font-weight:700;">${esc(name)}</span>`);
  }
  // Under a name → lighter subtitle; standalone (no actor) → bold dark heading.
  const titleStyle = namePrefix
    ? `margin:0;font-size:16px;line-height:1.45;color:${MUTED};font-weight:400;`
    : `margin:0;font-size:20px;line-height:1.3;color:${NAVY};font-weight:700;`;
  const titleH1 = namePrefix + `<h1 style="${titleStyle}">${titleInner}</h1>`;

  // Avatar to the left of the heading when we have one, so the reader sees who
  // messaged/acted at a glance.
  const heading = opts.actorPhotoUrl
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 14px;"><tr>` +
      `<td valign="middle" width="56" style="padding-right:12px;">` +
      `<img src="${esc(opts.actorPhotoUrl)}" width="48" height="48" alt="" style="display:block;border:0;width:48px;height:48px;border-radius:50%;object-fit:cover;"></td>` +
      `<td valign="middle">${titleH1}</td>` +
      `</tr></table>`
    : `<div style="margin:0 0 14px;">${titleH1}</div>`;

  return (
    `<!doctype html><html lang="en"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<meta name="color-scheme" content="light only"></head>` +
    `<body style="margin:0;padding:0;background:${BG};-webkit-text-size-adjust:100%;">` +
    `<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(preheader)}</div>` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BG};padding:24px 12px;">` +
    `<tr><td align="center">` +
    `<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">` +
    // header — brandmark at 84px (between the original 56 and a 2x 112)
    `<tr><td align="center" style="padding:6px 0 20px;">` +
    `<a href="${BASE}"><img src="${AVATAR_URL}" width="84" height="84" alt="Blue Seal" style="display:block;border:0;border-radius:20px;"></a>` +
    `</td></tr>` +
    // card
    `<tr><td style="background:#ffffff;border:1px solid ${BORDER};border-radius:14px;padding:28px 28px 24px;">` +
    heading +
    paras +
    cta +
    `</td></tr>` +
    // footer
    `<tr><td align="center" style="padding:22px 16px 8px;">` +
    `<a href="${BASE}"><img src="${SIGNATURE_URL}" width="180" alt="Blue Seal" style="display:block;border:0;width:180px;max-width:60%;height:auto;margin:0 auto 12px;"></a>` +
    `<p style="margin:0 0 6px;font-size:12px;line-height:1.5;color:${MUTED};">Verified Canadian tradespeople.</p>` +
    `<p style="margin:0;font-size:12px;line-height:1.5;color:${MUTED};">You're receiving this because you have a Blue Seal account. ` +
    `<a href="${BASE}/account" style="color:${BLUE};text-decoration:underline;">Manage notifications</a></p>` +
    `</td></tr>` +
    `</table></td></tr></table></body></html>`
  );
}
