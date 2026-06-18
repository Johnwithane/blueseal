// ---------------------------------------------------------------------------
// Business-card renderer — draws print-ready Blue Seal cards onto a <canvas>
// at 300 DPI, generates the QR code, and exports PNG / print PDF.
//
// Design: minimal & premium — small logo top-left, the headline/name given
// room to breathe, a large QR on the right (transparent, so it sits on the
// card like printed ink), the brandmark in its centre. Two selectable themes
// (Cream / Navy). The tradesperson profile card incorporates their photo.
// The BACK is the site's white→light-blue (pitch-view) gradient with a centred
// vertical logo + tagline.
//
// One canvas renderer drives BOTH the on-screen preview and the exported files
// (no WYSIWYG drift). The brand palette is duplicated here as hex constants on
// purpose — the canvas API can't read CSS custom properties.
//
// Geometry: North American card = 3.5in × 2in trim, 0.125in bleed.
// At 300 DPI: 1050×600px trim, 1125×675px with bleed; 84px (0.28in) safe inset.
// ---------------------------------------------------------------------------

import QRCode from "qrcode";
import { SITE_URL, SITE_TAGLINE } from "@/seo/site";

export type CardType = "tradesperson_signup" | "client_search" | "tradesperson_profile";
export type CardTheme = "cream" | "navy";
export type CardFace = "front" | "back";

// --- Print geometry (px @ 300 DPI) -----------------------------------------
export const CARD_TRIM = { w: 1050, h: 600 } as const;
export const CARD_BLEED_PX = 37.5; // 0.125in
// Safe insets from the trim — wider on the sides than top/bottom so content
// fills the card vertically (avoids dead bands top & bottom) while staying
// comfortably clear of the cut.
export const CARD_SAFE_X = 80;
export const CARD_SAFE_Y = 56;
export const CARD_FULL = { w: 1125, h: 675 } as const;
export const CARD_DPI = 300;
export const CARD_BLEED_MM = { w: 95.25, h: 57.15 } as const; // PDF page, incl. bleed

export function cardPixelSize(bleed: boolean): { w: number; h: number } {
  return bleed ? { ...CARD_FULL } : { ...CARD_TRIM };
}

// --- Palette (mirror of src/assets/main.css tokens) ------------------------
const C = {
  navy: "#374C76",
  navyDark: "#2A3A5C",
  cream: "#FCECC9",
  red: "#B2373D",
  lightBlue: "#B3DCFF",
  ink: "#494C4F",
  muted: "#6B6862",
  offWhite: "#FAF9F6",
  white: "#FFFFFF",
} as const;

const SITE_HOST = SITE_URL.replace(/^https?:\/\//, ""); // e.g. "blueseal.app"

interface ResolvedTheme {
  bgKind: "solid" | "gradient";
  bgFrom: string;
  bgTo: string;
  headline: string;
  body: string;
  accent: string; // kicker / trade line
  caption: string; // QR caption
  qrDark: string; // QR module colour (light is always transparent)
  knock: string; // knockout disc behind the centre brandmark
  logo: "dark" | "white"; // horizontal logo variant for the front
  brandmark: "dark" | "white"; // QR-centre brandmark variant
  photoFill: string;
  photoText: string;
  photoRing: string;
  pillBg: string;
  pillText: string;
  pillMark: "dark" | "white";
}

function resolveTheme(theme: CardTheme): ResolvedTheme {
  if (theme === "navy") {
    return {
      bgKind: "gradient",
      bgFrom: C.navyDark,
      bgTo: C.navy,
      headline: C.white,
      body: "#E7ECF6",
      accent: C.lightBlue,
      caption: C.lightBlue,
      qrDark: C.white, // white modules on navy (inverted)
      knock: C.navyDark,
      logo: "white",
      brandmark: "white",
      photoFill: C.cream,
      photoText: C.navyDark,
      photoRing: C.cream,
      pillBg: "rgba(255,255,255,0.14)",
      pillText: C.cream,
      pillMark: "white",
    };
  }
  return {
    bgKind: "solid",
    bgFrom: C.offWhite,
    bgTo: C.offWhite,
    headline: C.navyDark,
    body: C.ink,
    accent: C.red,
    caption: C.muted,
    qrDark: C.navyDark,
    knock: C.white,
    logo: "dark",
    brandmark: "dark",
    photoFill: C.navy,
    photoText: C.white,
    photoRing: C.white,
    pillBg: C.cream,
    pillText: C.navyDark,
    pillMark: "dark",
  };
}

// --- Assets ----------------------------------------------------------------
export const CARD_ASSETS = {
  logoHorFull: "/branding/Horizontal/BlueSeal_Logo-Hor_Full(noborder).png",
  logoHorBeige: "/branding/Horizontal/BlueSeal_Logo_Hor_Beige.png",
  logoVertFull: "/branding/Vertical/BlueSeal_Logo_Vert_Full(noborder).png",
  brandmarkDark: "/branding/Brandmark/BlueSeal_Brandmark_DarkBlue.png",
  brandmarkWhite: "/branding/Brandmark/BlueSeal_Brandmark_White.png",
} as const;

export function logoUrlForTheme(theme: CardTheme): string {
  // Cream → full-colour logo (reads on the warm off-white). Navy → beige logo
  // (the full-colour version would disappear on the dark background).
  return theme === "navy" ? CARD_ASSETS.logoHorBeige : CARD_ASSETS.logoHorFull;
}
export function brandmarkUrlForTheme(theme: CardTheme): string {
  return theme === "navy" ? CARD_ASSETS.brandmarkWhite : CARD_ASSETS.brandmarkDark;
}
export function qrDarkForTheme(theme: CardTheme): string {
  return theme === "navy" ? C.white : C.navyDark;
}

export function loadImage(src: string, crossOrigin = true): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    // crossOrigin keeps the canvas untainted so export (toDataURL) works. For
    // remote photos this requires the host to send CORS headers; callers fall
    // back to an initials avatar if a remote photo fails to load.
    if (crossOrigin) img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load image: ${src}`));
    img.src = encodeURI(src);
  });
}

export async function ensureCardFonts(): Promise<void> {
  if (typeof document === "undefined" || !("fonts" in document)) return;
  try {
    await Promise.all([
      document.fonts.load('700 50px "Poltawski Nowy"'),
      document.fonts.load('400 20px "Roboto"'),
      document.fonts.load('600 18px "Roboto"'),
      document.fonts.load('700 15px "Roboto"'),
    ]);
    await document.fonts.ready;
  } catch {
    // Fall back to system serif/sans — the card still renders.
  }
}

// --- Target URLs + UTM tagging ---------------------------------------------
function defaultCampaign(type: CardType): string {
  if (type === "tradesperson_signup") return "tradesperson_signup";
  if (type === "client_search") return "client_search";
  return "tradesperson_profile";
}

export function cardTargetUrl(
  type: CardType,
  opts: { uid?: string; campaign?: string } = {},
): { url: string; label: string } {
  let path: string;
  if (type === "tradesperson_signup") path = "/sign-up?as=tradesperson";
  else if (type === "client_search") path = "/search";
  else path = `/tradies/${opts.uid ?? ""}`;

  const u = new URL(SITE_URL + path);
  u.searchParams.set("utm_source", "business_card");
  u.searchParams.set("utm_medium", "print");
  u.searchParams.set("utm_campaign", opts.campaign?.trim() || defaultCampaign(type));
  if (type === "tradesperson_profile" && opts.uid) u.searchParams.set("utm_content", opts.uid);

  const bare = SITE_URL.replace(/^https?:\/\//, "");
  const label = type === "tradesperson_profile" ? bare : bare + path.split("?")[0];
  return { url: u.toString(), label };
}

export async function generateQrCanvas(
  url: string,
  opts: { size?: number; dark?: string } = {},
): Promise<HTMLCanvasElement> {
  const canvas = document.createElement("canvas");
  await QRCode.toCanvas(canvas, url, {
    errorCorrectionLevel: "H", // 30% recovery → survives the centre brandmark
    margin: 1,
    width: opts.size ?? 640,
    color: { dark: opts.dark ?? C.navyDark, light: "#0000" }, // transparent quiet zone
  });
  return canvas;
}

// --- Canvas helpers --------------------------------------------------------
function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function drawImageContain(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  x: number,
  y: number,
  maxW: number,
  maxH: number,
  align: "left" | "center" = "left",
): void {
  const ratio = Math.min(maxW / img.width, maxH / img.height);
  const w = img.width * ratio;
  const h = img.height * ratio;
  const dx = align === "center" ? x + (maxW - w) / 2 : x;
  const dy = y + (maxH - h) / 2;
  ctx.drawImage(img, dx, dy, w, h);
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxW && line) {
      lines.push(line);
      line = word;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function truncate(ctx: CanvasRenderingContext2D, text: string, maxW: number): string {
  if (ctx.measureText(text).width <= maxW) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > maxW) t = t.slice(0, -1);
  return `${t}…`;
}

function drawTracked(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  spacing: number,
): void {
  let cursor = x;
  for (const ch of text) {
    ctx.fillText(ch, cursor, y);
    cursor += ctx.measureText(ch).width + spacing;
  }
}

function drawCenteredTracked(
  ctx: CanvasRenderingContext2D,
  text: string,
  centerX: number,
  y: number,
  spacing: number,
): void {
  const widths = [...text].map((ch) => ctx.measureText(ch).width);
  const total = widths.reduce((a, b) => a + b, 0) + spacing * (text.length - 1);
  let cursor = centerX - total / 2;
  [...text].forEach((ch, i) => {
    ctx.fillText(ch, cursor, y);
    cursor += widths[i] + spacing;
  });
}

// Headline supports two markers: "\n" forces a line break, and "*word*" marks a
// segment to highlight (red box, cream text — like a marker pen). Wrapping
// measures with the asterisks stripped so the marker chars don't skew layout.
function wrapHeadline(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  return text.split("\n").flatMap((para) => {
    const words = para.split(/\s+/).filter(Boolean);
    const lines: string[] = [];
    let line = "";
    for (const word of words) {
      const test = line ? `${line} ${word}` : word;
      if (ctx.measureText(test.replace(/\*/g, "")).width > maxW && line) {
        lines.push(line);
        line = word;
      } else {
        line = test;
      }
    }
    if (line) lines.push(line);
    return lines.length ? lines : [""];
  });
}

function drawHeadline(
  ctx: CanvasRenderingContext2D,
  lines: string[],
  x: number,
  baselineY0: number,
  lineH: number,
  fontSize: number,
  color: string,
  hlBg: string,
  hlText: string,
): void {
  const padX = Math.round(fontSize * 0.16);
  const radius = Math.round(fontSize * 0.16);
  lines.forEach((line, li) => {
    const baseline = baselineY0 + li * lineH;
    let cursor = x;
    line.split("*").forEach((seg, si) => {
      if (!seg) return;
      const w = ctx.measureText(seg).width;
      if (si % 2 === 1) {
        roundRectPath(ctx, cursor, baseline - fontSize * 0.8, w + padX * 2, fontSize * 1.04, radius);
        ctx.fillStyle = hlBg;
        ctx.fill();
        ctx.fillStyle = hlText;
        ctx.fillText(seg, cursor + padX, baseline);
        cursor += w + padX * 2;
      } else {
        ctx.fillStyle = color;
        ctx.fillText(seg, cursor, baseline);
        cursor += w;
      }
    });
  });
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "BS";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function drawAvatar(
  ctx: CanvasRenderingContext2D,
  assets: CardAssets,
  cx: number,
  cy: number,
  r: number,
  th: ResolvedTheme,
  name: string,
): void {
  if (assets.photo) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();
    const img = assets.photo;
    const scale = Math.max((2 * r) / img.width, (2 * r) / img.height); // cover
    const w = img.width * scale;
    const h = img.height * scale;
    ctx.drawImage(img, cx - w / 2, cy - h / 2, w, h);
    ctx.restore();
  } else {
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = th.photoFill;
    ctx.fill();
    ctx.fillStyle = th.photoText;
    ctx.font = `600 ${Math.round(r * 0.8)}px "Roboto", sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(initialsOf(name), cx, cy + 2);
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
  }
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.lineWidth = 4;
  ctx.strokeStyle = th.photoRing;
  ctx.stroke();
}

function drawQr(
  ctx: CanvasRenderingContext2D,
  assets: CardAssets,
  th: ResolvedTheme,
  x: number,
  y: number,
  size: number,
): void {
  ctx.drawImage(assets.qr, x, y, size, size);
  if (assets.brandmark) {
    const bm = size * 0.2;
    const bx = x + (size - bm) / 2;
    const by = y + (size - bm) / 2;
    ctx.fillStyle = th.knock;
    ctx.beginPath();
    ctx.arc(bx + bm / 2, by + bm / 2, bm / 2 + 8, 0, Math.PI * 2);
    ctx.fill();
    drawImageContain(ctx, assets.brandmark, bx, by, bm, bm, "center");
  }
}

function drawVerifiedPill(
  ctx: CanvasRenderingContext2D,
  assets: CardAssets,
  th: ResolvedTheme,
  x: number,
  yCenter: number,
  label: string,
): void {
  ctx.font = `600 16px "Roboto", sans-serif`;
  const mark = 24;
  const padL = 12;
  const gap = 10;
  const padR = 20;
  const tw = ctx.measureText(label).width;
  const w = padL + mark + gap + tw + padR;
  const h = 40;
  roundRectPath(ctx, x, yCenter - h / 2, w, h, h / 2);
  ctx.fillStyle = th.pillBg;
  ctx.fill();
  if (assets.brandmark) {
    drawImageContain(ctx, assets.brandmark, x + padL, yCenter - mark / 2, mark, mark, "center");
  }
  ctx.fillStyle = th.pillText;
  ctx.textBaseline = "middle";
  ctx.fillText(label, x + padL + mark + gap, yCenter + 1);
  ctx.textBaseline = "alphabetic";
}

// --- Card content + draw entry point ---------------------------------------
export interface CardProfile {
  name: string;
  company?: string;
  trade?: string;
  email?: string;
  phone?: string;
  isPro?: boolean;
}

export interface CardContent {
  type: CardType;
  theme: CardTheme;
  headline: string;
  subcopy: string;
  qrCaption: string;
  /** Short vanity URL shown in heavier type under the sub-copy (signup/client). */
  ctaUrl?: string;
  profile?: CardProfile;
}

/**
 * Memorable URL printed on the card. Backed by router redirects:
 *   /apply → /sign-up?as=tradesperson   ·   /hire → /search
 * (The QR still encodes the full UTM-tagged deep link for scan attribution.)
 */
export function cardVanityUrl(type: CardType): string {
  if (type === "tradesperson_signup") return `${SITE_HOST}/apply`;
  if (type === "client_search") return `${SITE_HOST}/hire`;
  return SITE_HOST;
}

export interface CardAssets {
  logo: HTMLImageElement; // horizontal, theme-appropriate (front)
  logoVert: HTMLImageElement; // vertical full-colour (back)
  qr: HTMLCanvasElement | HTMLImageElement; // theme-appropriate modules, transparent
  brandmark?: HTMLImageElement | null; // QR centre + verified pill
  photo?: HTMLImageElement | null; // profile photo (optional)
}

export function drawCardFace(
  ctx: CanvasRenderingContext2D,
  content: CardContent,
  assets: CardAssets,
  face: CardFace,
  bleed: boolean,
): void {
  const th = resolveTheme(content.theme);
  const full = cardPixelSize(bleed);
  const ox = bleed ? CARD_BLEED_PX : 0;
  const oy = bleed ? CARD_BLEED_PX : 0;

  ctx.clearRect(0, 0, full.w, full.h);
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";

  const cx = ox + CARD_SAFE_X;
  const cy = oy + CARD_SAFE_Y;
  const cw = CARD_TRIM.w - CARD_SAFE_X * 2;
  const chH = CARD_TRIM.h - CARD_SAFE_Y * 2;

  if (face === "back") {
    // Site (pitch-view) white→light-blue gradient, bleeds to all edges.
    const g = ctx.createLinearGradient(0, 0, full.w * 0.4, full.h);
    g.addColorStop(0, "#EAF6FF");
    g.addColorStop(0.56, "#B3DCFF");
    g.addColorStop(1, "#8FC0EE");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, full.w, full.h);
    // Large centred vertical logo, tagline beneath.
    drawImageContain(ctx, assets.logoVert, cx + cw * 0.17, cy, cw * 0.66, chH - 46, "center");
    ctx.fillStyle = C.navyDark;
    ctx.font = `600 18px "Roboto", sans-serif`;
    drawCenteredTracked(ctx, SITE_TAGLINE.toUpperCase(), cx + cw / 2, cy + chH - 2, 2.5);
    return;
  }

  // ---- FRONT ----
  if (th.bgKind === "gradient") {
    const g = ctx.createLinearGradient(0, 0, full.w, full.h);
    g.addColorStop(0, th.bgFrom);
    g.addColorStop(1, th.bgTo);
    ctx.fillStyle = g;
  } else {
    ctx.fillStyle = th.bgFrom;
  }
  ctx.fillRect(0, 0, full.w, full.h);

  // Footer band (bottom): brand logo bottom-left, blueseal.app bottom-right.
  // The headline/profile block and the QR are both vertically centred in the
  // region ABOVE it.
  const footerH = 60;
  const footerLift = 14; // raise the logo off the bottom edge
  const footerGap = 18;
  const region = chH - footerH - footerLift - footerGap;
  const lx = cx;

  // Large QR, right, vertically centred in the region, caption beneath.
  const qrSize = 320;
  const qrX = cx + cw - qrSize;
  const qrY = cy + (region - qrSize) / 2 - 4;
  drawQr(ctx, assets, th, qrX, qrY, qrSize);
  ctx.textAlign = "center";
  ctx.fillStyle = th.caption;
  ctx.font = `600 18px "Roboto", sans-serif`;
  ctx.fillText(content.qrCaption, qrX + qrSize / 2, qrY + qrSize + 32);
  ctx.textAlign = "left";

  const lw = qrX - cx - 52;

  if (content.type === "tradesperson_profile" && content.profile) {
    const p = content.profile;
    const pr = 56; // photo radius
    const nameMaxW = lw - (pr * 2 + 30);
    ctx.font = `700 38px "Poltawski Nowy", Georgia, serif`;
    const nameLines = wrapText(ctx, p.name, nameMaxW).slice(0, 2);

    const nameBlockH = nameLines.length * 42 + (p.company ? 28 : 0) + (p.trade ? 24 : 0);
    const rowH = Math.max(pr * 2, nameBlockH);
    const contactLines = (p.email ? 1 : 0) + (p.phone ? 1 : 0);
    const stackH = rowH + 28 + contactLines * 32 + (contactLines ? 16 : 0) + 40;
    let y = cy + Math.max(0, (region - stackH) / 2);

    // Photo + name/company/trade row.
    drawAvatar(ctx, assets, lx + pr, y + pr, pr, th, p.name);
    const tx = lx + pr * 2 + 30;
    let ty = y + (rowH - nameBlockH) / 2;
    ctx.fillStyle = th.headline;
    ctx.font = `700 38px "Poltawski Nowy", Georgia, serif`;
    for (const ln of nameLines) {
      ctx.fillText(ln, tx, ty + 32);
      ty += 42;
    }
    if (p.company) {
      ctx.fillStyle = th.body;
      ctx.font = `400 21px "Roboto", sans-serif`;
      ctx.fillText(truncate(ctx, p.company, nameMaxW), tx, ty + 19);
      ty += 28;
    }
    if (p.trade) {
      ctx.fillStyle = th.accent;
      ctx.font = `700 15px "Roboto", sans-serif`;
      drawTracked(ctx, truncate(ctx, p.trade.toUpperCase(), nameMaxW), tx, ty + 14, 1.5);
    }
    y += rowH + 28;

    if (contactLines) {
      ctx.fillStyle = th.body;
      ctx.font = `400 21px "Roboto", sans-serif`;
      if (p.email) {
        ctx.fillText(`✉  ${truncate(ctx, p.email, lw - 36)}`, lx, y + 16);
        y += 32;
      }
      if (p.phone) {
        ctx.fillText(`✆  ${p.phone}`, lx, y + 16);
        y += 32;
      }
      y += 16;
    }

    drawVerifiedPill(
      ctx,
      assets,
      th,
      lx,
      y + 20,
      p.isPro ? "Blue Seal Pro · Verified" : "Verified on Blue Seal",
    );
  } else {
    const headFont = `700 54px "Poltawski Nowy", Georgia, serif`;
    ctx.font = headFont;
    const headlineLines = wrapHeadline(ctx, content.headline, lw).slice(0, 3);
    ctx.font = `400 21px "Roboto", sans-serif`;
    const subLines = content.subcopy
      .split("\n")
      .flatMap((line) => wrapText(ctx, line, lw))
      .slice(0, 4);

    const stackH =
      headlineLines.length * 62 + 26 + subLines.length * 32 + (content.ctaUrl ? 38 : 0);
    let y = cy + Math.max(0, (region - stackH) / 2);

    ctx.font = headFont;
    drawHeadline(ctx, headlineLines, lx, y + 44, 62, 54, th.headline, C.red, C.cream);
    y += headlineLines.length * 62 + 26;

    ctx.fillStyle = th.body;
    ctx.font = `400 21px "Roboto", sans-serif`;
    for (const ln of subLines) {
      ctx.fillText(ln, lx, y + 16);
      y += 32;
    }
    if (content.ctaUrl) {
      y += 6;
      ctx.fillStyle = th.accent;
      ctx.font = `700 23px "Roboto", sans-serif`;
      ctx.fillText(content.ctaUrl, lx, y + 18);
    }
  }

  // Footer: brand logo bottom-left (full-colour on cream / beige on navy).
  const footerTop = cy + chH - footerLift - footerH;
  drawImageContain(ctx, assets.logo, lx, footerTop, Math.min(cw * 0.5, 300), footerH, "left");
  // Profile cards have no in-block CTA URL, so anchor the site bottom-right.
  if (content.type === "tradesperson_profile") {
    ctx.textAlign = "right";
    ctx.fillStyle = th.caption;
    ctx.font = `600 19px "Roboto", sans-serif`;
    ctx.fillText(SITE_HOST, cx + cw, footerTop + footerH / 2 + 7);
    ctx.textAlign = "left";
  }
}

// --- Export ----------------------------------------------------------------
export function downloadCanvasPng(canvas: HTMLCanvasElement, filename: string): void {
  const a = document.createElement("a");
  a.href = canvas.toDataURL("image/png");
  a.download = filename;
  a.click();
}

/**
 * Export the supplied full-bleed canvases as a single multi-page print PDF at
 * exact physical size (3.75in × 2.25in incl. bleed) — page 1 front, page 2
 * back. RGB — fine for digital/online printers; an offset shop may ask for
 * CMYK (see docs/BUSINESS_CARD_PRINT.md).
 */
export async function downloadCardPdf(
  canvases: HTMLCanvasElement[],
  filename: string,
): Promise<void> {
  const { jsPDF } = await import("jspdf");
  const pdf = new jsPDF({
    unit: "mm",
    format: [CARD_BLEED_MM.w, CARD_BLEED_MM.h],
    orientation: "landscape",
  });
  canvases.forEach((canvas, i) => {
    if (i > 0) pdf.addPage([CARD_BLEED_MM.w, CARD_BLEED_MM.h], "landscape");
    pdf.addImage(
      canvas.toDataURL("image/png"),
      "PNG",
      0,
      0,
      CARD_BLEED_MM.w,
      CARD_BLEED_MM.h,
      undefined,
      "FAST",
    );
  });
  pdf.save(filename);
}
