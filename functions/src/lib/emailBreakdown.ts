// Itemized quote/invoice breakdown rendered as an email-safe HTML fragment.
// Dropped into the branded shell's white card via BrandedEmailOpts.contentHtml
// (see lib/emailTemplate.ts). Email clients strip <style> and don't do
// flexbox, so this is table-based with inline styles. ALL user-supplied text
// (line-item descriptions, terms, notes) is escaped here — the shell injects
// this string verbatim.
//
// Palette mirrors lib/emailTemplate.ts — keep the hexes in sync if the brand
// ramp changes.

const NAVY = "#2A3A5C";
const BLUE = "#374C76";
const INK = "#494C4F";
const MUTED = "#6B6862";
const BORDER = "#EAE7DF";
const SOFT = "#FAF9F6";

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function fmtMoney(cents: number, currency: string): string {
  return new Intl.NumberFormat("en-CA", { style: "currency", currency }).format(
    cents / 100,
  );
}

export interface BreakdownLineItem {
  description: string;
  /** Whole or fractional units. */
  quantity: number;
  /** Per-unit price in cents. */
  unitPrice: number;
}

export interface BreakdownInput {
  /** "quote" | "invoice" — only used to label the totals/meta copy. */
  kind: "quote" | "invoice";
  /** Document number, e.g. "Q-2026-0007" or "INV-2026-0012". */
  number?: string | null;
  currency: string;
  lineItems: BreakdownLineItem[];
  subtotal: number;
  /** Positive cents amount that was subtracted; 0/undefined = no discount. */
  discountAmount?: number | null;
  taxTotal: number;
  total: number;

  // ---- quote-only meta (all optional) ----
  /** Pre-formatted date string, e.g. "June 30, 2026". */
  validUntilLabel?: string | null;
  estimatedHours?: number | null;
  estimatedDuration?: string | null;
  /** Pre-formatted proposed start date. */
  proposedStartLabel?: string | null;
  /** Pre-formatted upfront-fee summary, e.g. "$50.00 (10%)". */
  upfrontFeeLabel?: string | null;
  terms?: string | null;

  // ---- invoice-only meta ----
  paymentInstructions?: string | null;

  // ---- shared ----
  /** When present, renders a "Download a PDF copy" link under the totals. */
  pdfUrl?: string | null;
}

function lineItemRow(li: BreakdownLineItem, currency: string): string {
  const lineTotal = Math.round(li.quantity * li.unitPrice);
  // qty × unit detail only when it adds information (not a bare "1 ×").
  const detail =
    li.quantity === 1
      ? ""
      : `<div style="font-size:13px;color:${MUTED};margin-top:2px;">${esc(
          String(li.quantity),
        )} × ${fmtMoney(li.unitPrice, currency)}</div>`;
  return (
    `<tr>` +
    `<td style="padding:10px 0;border-bottom:1px solid ${BORDER};vertical-align:top;">` +
    `<div style="font-size:15px;color:${INK};line-height:1.4;">${esc(li.description)}</div>${detail}` +
    `</td>` +
    `<td align="right" style="padding:10px 0 10px 12px;border-bottom:1px solid ${BORDER};vertical-align:top;font-size:15px;color:${INK};white-space:nowrap;">` +
    `${fmtMoney(lineTotal, currency)}</td>` +
    `</tr>`
  );
}

function totalRow(
  label: string,
  value: string,
  opts?: { strong?: boolean; muted?: boolean },
): string {
  const labelColor = opts?.strong ? NAVY : MUTED;
  const valueColor = opts?.muted ? MUTED : opts?.strong ? NAVY : INK;
  const size = opts?.strong ? "18px" : "14px";
  const weight = opts?.strong ? "700" : "400";
  const pad = opts?.strong ? "12px 0 0" : "4px 0";
  return (
    `<tr>` +
    `<td style="padding:${pad};font-size:${size};font-weight:${weight};color:${labelColor};">${esc(label)}</td>` +
    `<td align="right" style="padding:${pad};font-size:${size};font-weight:${weight};color:${valueColor};white-space:nowrap;">${esc(value)}</td>` +
    `</tr>`
  );
}

function metaLine(label: string, value: string): string {
  return (
    `<p style="margin:0 0 6px;font-size:13px;line-height:1.5;color:${MUTED};">` +
    `<span style="color:${INK};font-weight:600;">${esc(label)}:</span> ${esc(value)}</p>`
  );
}

/**
 * Build the itemized breakdown HTML fragment for a quote or invoice email.
 * Returns a self-contained block (number heading, line-item table, totals,
 * meta, and optional PDF link) suitable for BrandedEmailOpts.contentHtml.
 */
export function breakdownHtml(input: BreakdownInput): string {
  const { currency } = input;

  const numberHeading = input.number
    ? `<p style="margin:18px 0 8px;font-size:13px;letter-spacing:0.04em;text-transform:uppercase;color:${MUTED};font-weight:600;">` +
      `${input.kind === "quote" ? "Quote" : "Invoice"} ${esc(input.number)}</p>`
    : `<div style="height:8px;"></div>`;

  const rows = input.lineItems.map((li) => lineItemRow(li, currency)).join("");

  const discount = input.discountAmount && input.discountAmount > 0
    ? totalRow("Discount", `– ${fmtMoney(input.discountAmount, currency)}`, { muted: true })
    : "";

  const totals =
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:14px;">` +
    totalRow("Subtotal", fmtMoney(input.subtotal, currency)) +
    discount +
    totalRow("Tax", fmtMoney(input.taxTotal, currency)) +
    totalRow("Total", fmtMoney(input.total, currency), { strong: true }) +
    `</table>`;

  // Meta block — only the lines that apply.
  const meta: string[] = [];
  if (input.kind === "quote") {
    if (input.upfrontFeeLabel) meta.push(metaLine("Upfront to start", input.upfrontFeeLabel));
    if (input.proposedStartLabel) meta.push(metaLine("Proposed start", input.proposedStartLabel));
    if (input.estimatedDuration) meta.push(metaLine("Estimated duration", input.estimatedDuration));
    else if (input.estimatedHours != null)
      meta.push(metaLine("Estimated hours", String(input.estimatedHours)));
    if (input.validUntilLabel) meta.push(metaLine("Valid until", input.validUntilLabel));
    if (input.terms && input.terms.trim()) meta.push(metaLine("Terms", input.terms.trim()));
  } else {
    if (input.paymentInstructions && input.paymentInstructions.trim())
      meta.push(metaLine("Notes", input.paymentInstructions.trim()));
  }
  const metaBlock = meta.length
    ? `<div style="margin-top:16px;padding-top:14px;border-top:1px solid ${BORDER};">${meta.join("")}</div>`
    : "";

  const pdfLink = input.pdfUrl
    ? `<p style="margin:14px 0 2px;font-size:13px;line-height:1.5;">` +
      `<a href="${esc(input.pdfUrl)}" style="color:${BLUE};text-decoration:underline;">Download a PDF copy</a></p>`
    : "";

  return (
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" ` +
    `style="margin:6px 0 4px;border:1px solid ${BORDER};border-radius:12px;background:${SOFT};">` +
    `<tr><td style="padding:6px 18px 16px;">` +
    numberHeading +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table>` +
    totals +
    metaBlock +
    pdfLink +
    `</td></tr></table>`
  );
}
