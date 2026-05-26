// Lazy-loaded PDF renderers for quotes + invoices.
//
// Returns a Blob so the caller can decide how to surface it (in-app
// preview modal, new tab, forced download). The actual jsPDF +
// jspdf-autotable imports live behind dynamic `import()` so the
// ~250 KB library only ships on first click.

import type {
  InvoiceDiscount,
  InvoiceDoc,
  LineItem,
  QuoteDoc,
  WithId,
} from "@/firebase/interfaces";
import type { Timestamp } from "firebase/firestore";

export interface PartyInfo {
  tradesperson: {
    name: string;
    companyName: string | null;
    address: string | null;
    phone: string | null;
    email: string | null;
  };
  client: {
    name: string;
    email: string | null;
    phone: string | null;
    address: string | null;
  };
}

interface RenderTotals {
  subtotal: number;
  discount: InvoiceDiscount | null;
  discountAmount: number;
  taxTotal: number;
  total: number;
  currency: string;
}

interface DocSummary {
  kind: "Quote" | "Invoice";
  number: string;
  issuedLabel: string;
  issuedDate: string;
  validUntil?: string | null;
  noteToClient?: string | null;
  paymentInstructions?: string | null;
  terms?: string | null;
}

// Brand palette. Pulled into the PDF (not via CSS) so the rendered file
// is self-contained.
const BRAND = {
  blueDark: [10, 47, 87] as const, // #0a2f57
  blue: [18, 86, 156] as const, // #12569c
  blueLight: [225, 235, 247] as const, // #e1ebf7
  ink: [22, 30, 46] as const, // body text
  muted: [110, 122, 138] as const,
  border: [220, 226, 234] as const,
  paperAlt: [248, 250, 252] as const, // table zebra stripe
  accent: [217, 119, 6] as const, // amber — total-row underline
};

function fmtMoney(cents: number, currency = "CAD"): string {
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency,
  }).format(cents / 100);
}

function fmtDate(t: Timestamp | null | undefined): string {
  if (!t) return "—";
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(t.toDate());
}

async function renderPdf(
  summary: DocSummary,
  party: PartyInfo,
  lineItems: LineItem[],
  totals: RenderTotals,
): Promise<Blob> {
  // Lazy-import keeps the main bundle slim. jspdf-autotable mutates the
  // jsPDF instance, so import it after jsPDF.
  const { jsPDF } = await import("jspdf");
  const autoTableMod = await import("jspdf-autotable");
  const autoTable = autoTableMod.default;

  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 48;

  // ---------- brand band: gradient simulated with two stacked rects ----
  // jsPDF doesn't ship gradient primitives — we fake a soft gradient with
  // a deep band on top and a lighter band underneath so the brand
  // colour leads the eye in without a screaming flat block.
  doc.setFillColor(...BRAND.blueDark);
  doc.rect(0, 0, pageWidth, 76, "F");
  doc.setFillColor(...BRAND.blue);
  doc.rect(0, 60, pageWidth, 16, "F");

  // Brand wordmark
  doc.setFont("helvetica", "bold");
  doc.setFontSize(22);
  doc.setTextColor(255, 255, 255);
  doc.text("Blue Seal", margin, 42);
  // Brand subline
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(225, 235, 247);
  doc.text("Verified Trades", margin, 58);

  // Doc-type label (top right, inside band)
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(225, 235, 247);
  doc.text(summary.kind.toUpperCase(), pageWidth - margin, 30, {
    align: "right",
  });

  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.setTextColor(255, 255, 255);
  doc.text(summary.number, pageWidth - margin, 50, { align: "right" });

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(225, 235, 247);
  doc.text(`${summary.issuedLabel}: ${summary.issuedDate}`, pageWidth - margin, 66, {
    align: "right",
  });

  // ---------- From / To / Bill-to panel ----------
  let cursorY = 110;
  const colWidth = (pageWidth - margin * 2 - 16) / 2;
  const leftX = margin;
  const rightX = margin + colWidth + 16;

  // Soft tinted background per column for a polished invoice look.
  doc.setFillColor(...BRAND.paperAlt);
  doc.roundedRect(leftX - 8, cursorY - 14, colWidth + 16, 100, 4, 4, "F");
  doc.roundedRect(rightX - 8, cursorY - 14, colWidth + 16, 100, 4, 4, "F");

  const writePartyBlock = (
    x: number,
    heading: string,
    name: string,
    companyName: string | null,
    lines: Array<string | null>,
  ) => {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(...BRAND.muted);
    doc.text(heading, x, cursorY);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(11.5);
    doc.setTextColor(...BRAND.ink);
    doc.text(name, x, cursorY + 16);

    let y = cursorY + 16;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(...BRAND.muted);
    if (companyName) {
      y += 13;
      doc.text(companyName, x, y);
    }
    for (const line of lines) {
      if (!line) continue;
      y += 13;
      // Wrap long lines (addresses) to the column width.
      const wrapped = doc.splitTextToSize(line, colWidth);
      doc.text(wrapped, x, y);
      if (Array.isArray(wrapped) && wrapped.length > 1) {
        y += (wrapped.length - 1) * 11;
      }
    }
  };

  writePartyBlock(
    leftX,
    "FROM",
    party.tradesperson.name,
    party.tradesperson.companyName,
    [
      party.tradesperson.address,
      party.tradesperson.phone,
      party.tradesperson.email,
    ],
  );

  writePartyBlock(
    rightX,
    summary.kind === "Invoice" ? "BILL TO" : "PREPARED FOR",
    party.client.name,
    null,
    [
      party.client.address,
      party.client.phone,
      party.client.email,
    ],
  );

  cursorY += 110;

  // Optional client note
  if (summary.noteToClient) {
    doc.setDrawColor(...BRAND.border);
    doc.setFillColor(255, 255, 255);
    doc.setFont("helvetica", "italic");
    doc.setFontSize(10);
    doc.setTextColor(...BRAND.ink);
    const noteLines = doc.splitTextToSize(
      `"${summary.noteToClient}"`,
      pageWidth - margin * 2,
    );
    doc.text(noteLines, margin, cursorY);
    cursorY += noteLines.length * 13 + 12;
  }

  // ---------- Line-items table ----------
  const tableBody = lineItems.map((li) => [
    li.description,
    li.quantity.toString(),
    fmtMoney(li.unitPrice, totals.currency),
    `${(li.taxRate * 100).toFixed(1)}%`,
    fmtMoney(li.quantity * li.unitPrice, totals.currency),
  ]);

  autoTable(doc, {
    startY: cursorY,
    margin: { left: margin, right: margin },
    head: [["Description", "Qty", "Unit price", "Tax %", "Line total"]],
    body: tableBody,
    headStyles: {
      fillColor: [...BRAND.blueDark],
      textColor: 255,
      fontSize: 10,
      fontStyle: "bold",
      cellPadding: 8,
    },
    bodyStyles: {
      fontSize: 10,
      textColor: [...BRAND.ink],
      cellPadding: 8,
    },
    alternateRowStyles: { fillColor: [...BRAND.paperAlt] },
    columnStyles: {
      1: { halign: "right", cellWidth: 50 },
      2: { halign: "right", cellWidth: 90 },
      3: { halign: "right", cellWidth: 60 },
      4: { halign: "right", cellWidth: 90 },
    },
    theme: "plain",
    styles: { lineColor: [...BRAND.border], lineWidth: 0.5 },
  });

  // @ts-expect-error autoTable attaches lastAutoTable to the doc at runtime
  const tableEndY: number = (doc.lastAutoTable?.finalY ?? cursorY) + 18;

  // ---------- Totals card (right-aligned) ----------
  const totalsBoxWidth = 220;
  const totalsX = pageWidth - margin - totalsBoxWidth;
  const labelX = totalsX + 14;
  const valueX = totalsX + totalsBoxWidth - 14;

  // Card backing — subtle blue tint for the section.
  const rowHeight = 18;
  let totalsRowCount = 2; // subtotal + tax always present
  if (totals.discountAmount > 0) totalsRowCount += 1;
  const totalsBoxHeight = rowHeight * totalsRowCount + 36; // + total row + padding
  doc.setFillColor(...BRAND.paperAlt);
  doc.roundedRect(totalsX, tableEndY, totalsBoxWidth, totalsBoxHeight, 6, 6, "F");

  let totalsY = tableEndY + 18;
  const totalsRow = (
    label: string,
    value: string,
    opts: { bold?: boolean; accent?: boolean } = {},
  ) => {
    doc.setFont("helvetica", opts.bold ? "bold" : "normal");
    doc.setFontSize(opts.bold ? 12 : 10);
    if (opts.accent) doc.setTextColor(...BRAND.blueDark);
    else if (opts.bold) doc.setTextColor(...BRAND.ink);
    else doc.setTextColor(...BRAND.muted);
    doc.text(label, labelX, totalsY);
    doc.text(value, valueX, totalsY, { align: "right" });
    totalsY += opts.bold ? 20 : rowHeight;
  };

  totalsRow("Subtotal", fmtMoney(totals.subtotal, totals.currency));
  if (totals.discountAmount > 0) {
    const discountLabel = totals.discount?.label
      ? `Discount (${totals.discount.label})`
      : "Discount";
    // ASCII hyphen — jsPDF's default Helvetica doesn't ship the Unicode
    // minus glyph and renders it as garbled spaced-out text.
    totalsRow(discountLabel, `-${fmtMoney(totals.discountAmount, totals.currency)}`);
  }
  totalsRow("Tax", fmtMoney(totals.taxTotal, totals.currency));

  // Divider between tax and total
  doc.setDrawColor(...BRAND.border);
  doc.line(labelX, totalsY - 8, valueX, totalsY - 8);
  totalsRow("Total", fmtMoney(totals.total, totals.currency), { bold: true, accent: true });

  // ---------- Footer blocks (payment instructions / terms / validity) ----
  let footerY = tableEndY + totalsBoxHeight + 28;
  const writeBlock = (heading: string, body: string) => {
    if (!body.trim()) return;
    if (footerY > 700) {
      doc.addPage();
      footerY = margin;
    }
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(...BRAND.blueDark);
    doc.text(heading, margin, footerY);
    footerY += 14;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(...BRAND.ink);
    const lines = doc.splitTextToSize(body, pageWidth - margin * 2);
    doc.text(lines, margin, footerY);
    footerY += lines.length * 13 + 14;
  };

  if (summary.validUntil) {
    writeBlock("Validity", `Valid until ${summary.validUntil}.`);
  }
  if (summary.paymentInstructions)
    writeBlock("Payment instructions", summary.paymentInstructions);
  if (summary.terms) writeBlock("Terms / exclusions", summary.terms);

  // ---------- Footer: brand mark on every page ----------
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setDrawColor(...BRAND.border);
    doc.line(margin, 760, pageWidth - margin, 760);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...BRAND.muted);
    doc.text(
      "Generated by Blue Seal — blueseal.app",
      margin,
      774,
    );
    doc.text(`Page ${i} of ${pageCount}`, pageWidth - margin, 774, {
      align: "right",
    });
  }

  // Output as a Blob so the caller controls the surface (preview modal,
  // new tab, forced download).
  return doc.output("blob");
}

export async function renderInvoicePdfBlob(
  invoice: WithId<InvoiceDoc>,
  party: PartyInfo,
): Promise<{ blob: Blob; filename: string }> {
  const blob = await renderPdf(
    {
      kind: "Invoice",
      number: invoice.invoiceNumber,
      issuedLabel: "Issued",
      issuedDate: fmtDate(invoice.issuedAt),
      paymentInstructions: invoice.paymentInstructions,
    },
    party,
    invoice.lineItems,
    {
      subtotal: invoice.subtotal,
      discount: invoice.discount,
      discountAmount: invoice.discountAmount,
      taxTotal: invoice.taxTotal,
      total: invoice.total,
      currency: invoice.currency || "CAD",
    },
  );
  return { blob, filename: `${invoice.invoiceNumber}.pdf` };
}

export async function renderQuotePdfBlob(
  quote: WithId<QuoteDoc>,
  party: PartyInfo,
): Promise<{ blob: Blob; filename: string }> {
  const blob = await renderPdf(
    {
      kind: "Quote",
      number: quote.quoteNumber,
      issuedLabel: "Sent",
      issuedDate: fmtDate(quote.sentAt ?? quote.issuedAt),
      validUntil: quote.validUntil ? fmtDate(quote.validUntil) : null,
      noteToClient: quote.noteToClient,
      terms: quote.terms,
    },
    party,
    quote.lineItems,
    {
      subtotal: quote.subtotal,
      discount: quote.discount ?? null,
      discountAmount: quote.discountAmount ?? 0,
      taxTotal: quote.taxTotal,
      total: quote.total,
      currency: quote.currency || "CAD",
    },
  );
  return { blob, filename: `${quote.quoteNumber}.pdf` };
}
