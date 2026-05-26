// Lazy-loaded PDF renderers for quotes + invoices.
//
// jsPDF + jspdf-autotable adds ~250 KB to the bundle, so the actual
// imports live behind dynamic `import()` calls and only fire when the
// user clicks Download PDF. The first click loads the library; later
// clicks reuse it.
//
// Why client-side instead of the existing pdfkit on Cloud Functions:
// the only place pdfkit is used today is `sendInvoice` (gated behind
// Stripe Connect onboarding, currently not deployed). The user-facing
// PDF download is purely for record-keeping — generating it in the
// browser avoids a server round-trip, dodges the Stripe gating, and
// keeps the loop short. When `sendInvoice` ships and writes a real
// `pdfUrl`, the buttons in QuoteCard / InvoiceEditor prefer that URL
// and skip this path.

import type { Timestamp } from "firebase/firestore";
import type {
  InvoiceDiscount,
  InvoiceDoc,
  LineItem,
  QuoteDoc,
  WithId,
} from "@/firebase/interfaces";

interface PartyName {
  name: string;
  // Optional address / contact lines rendered under the name.
  subline?: string;
}

interface RenderTotals {
  subtotal: number;
  discount: InvoiceDiscount | null;
  discountAmount: number;
  taxTotal: number;
  total: number;
  currency: string;
}

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

async function renderPdf(
  filename: string,
  summary: DocSummary,
  from: PartyName,
  to: PartyName,
  lineItems: LineItem[],
  totals: RenderTotals,
): Promise<void> {
  // Lazy-import keeps the main bundle slim. jspdf-autotable mutates the
  // jsPDF instance so we have to import it as a side-effect after jsPDF.
  const { jsPDF } = await import("jspdf");
  const autoTableMod = await import("jspdf-autotable");
  const autoTable = autoTableMod.default;

  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 48;

  // Header — brand + doc title
  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.text("Blue Seal", margin, margin + 4);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.setTextColor(110);
  doc.text(summary.kind.toUpperCase(), pageWidth - margin, margin + 4, {
    align: "right",
  });

  doc.setFontSize(13);
  doc.setTextColor(20);
  doc.setFont("helvetica", "bold");
  doc.text(summary.number, pageWidth - margin, margin + 22, { align: "right" });

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(110);
  doc.text(
    `${summary.issuedLabel}: ${summary.issuedDate}`,
    pageWidth - margin,
    margin + 38,
    { align: "right" },
  );
  if (summary.validUntil) {
    doc.text(
      `Valid until: ${summary.validUntil}`,
      pageWidth - margin,
      margin + 52,
      { align: "right" },
    );
  }

  // From / To panel
  let cursorY = margin + 80;
  doc.setFontSize(9);
  doc.setTextColor(110);
  doc.text("FROM", margin, cursorY);
  doc.text("TO", pageWidth / 2, cursorY);

  doc.setFontSize(11);
  doc.setTextColor(20);
  doc.setFont("helvetica", "bold");
  doc.text(from.name, margin, cursorY + 16);
  doc.text(to.name, pageWidth / 2, cursorY + 16);

  if (from.subline) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(110);
    doc.text(from.subline, margin, cursorY + 30);
  }
  if (to.subline) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(110);
    doc.text(to.subline, pageWidth / 2, cursorY + 30);
  }

  cursorY += 60;

  // Optional client note
  if (summary.noteToClient) {
    doc.setFont("helvetica", "italic");
    doc.setFontSize(10);
    doc.setTextColor(60);
    const noteLines = doc.splitTextToSize(
      `"${summary.noteToClient}"`,
      pageWidth - margin * 2,
    );
    doc.text(noteLines, margin, cursorY);
    cursorY += noteLines.length * 13 + 8;
  }

  // Line-items table
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
    headStyles: { fillColor: [10, 77, 140], textColor: 255, fontSize: 10 },
    bodyStyles: { fontSize: 10, textColor: 30 },
    columnStyles: {
      1: { halign: "right", cellWidth: 50 },
      2: { halign: "right", cellWidth: 90 },
      3: { halign: "right", cellWidth: 60 },
      4: { halign: "right", cellWidth: 90 },
    },
    theme: "striped",
  });

  // @ts-expect-error autoTable attaches lastAutoTable to the doc at runtime
  const tableEndY: number = (doc.lastAutoTable?.finalY ?? cursorY) + 14;

  // Totals — right-aligned column under the table
  const labelX = pageWidth - margin - 130;
  const valueX = pageWidth - margin;
  let totalsY = tableEndY;

  function totalsRow(label: string, value: string, opts: { bold?: boolean } = {}) {
    doc.setFont("helvetica", opts.bold ? "bold" : "normal");
    doc.setFontSize(opts.bold ? 12 : 10);
    doc.setTextColor(opts.bold ? 20 : 70);
    doc.text(label, labelX, totalsY);
    doc.text(value, valueX, totalsY, { align: "right" });
    totalsY += opts.bold ? 18 : 14;
  }

  totalsRow("Subtotal", fmtMoney(totals.subtotal, totals.currency));
  if (totals.discountAmount > 0) {
    const discountLabel = totals.discount?.label
      ? `Discount (${totals.discount.label})`
      : "Discount";
    totalsRow(discountLabel, `−${fmtMoney(totals.discountAmount, totals.currency)}`);
  }
  totalsRow("Tax", fmtMoney(totals.taxTotal, totals.currency));
  totalsY += 4;
  doc.setDrawColor(200);
  doc.line(labelX, totalsY - 12, valueX, totalsY - 12);
  totalsRow("Total", fmtMoney(totals.total, totals.currency), { bold: true });

  // Payment instructions / terms footer
  let footerY = totalsY + 24;
  const writeBlock = (heading: string, body: string) => {
    if (!body.trim()) return;
    if (footerY > 720) {
      doc.addPage();
      footerY = margin;
    }
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(20);
    doc.text(heading, margin, footerY);
    footerY += 14;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(70);
    const lines = doc.splitTextToSize(body, pageWidth - margin * 2);
    doc.text(lines, margin, footerY);
    footerY += lines.length * 13 + 10;
  };

  if (summary.paymentInstructions)
    writeBlock("Payment instructions", summary.paymentInstructions);
  if (summary.terms) writeBlock("Terms / exclusions", summary.terms);

  // Open in a new tab as a blob URL — gives the browser's native PDF
  // viewer (Chrome / Edge / Firefox / Safari iOS+macOS) which exposes
  // print + download UI without us shipping a viewer.
  const blob = doc.output("blob");
  const url = URL.createObjectURL(blob);
  const popup = window.open(url, "_blank", "noopener,noreferrer");
  if (!popup) {
    // Pop-up blocked — fall back to a forced download so the file is
    // still accessible. Set the filename to the doc number for clarity.
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
  }
  // Free the blob URL after a generous grace window so the new tab has
  // time to attach to it. (Revoking immediately breaks Safari.)
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export async function downloadInvoicePdf(
  invoice: WithId<InvoiceDoc>,
  from: PartyName,
  to: PartyName,
): Promise<void> {
  await renderPdf(
    `${invoice.invoiceNumber}.pdf`,
    {
      kind: "Invoice",
      number: invoice.invoiceNumber,
      issuedLabel: "Issued",
      issuedDate: fmtDate(invoice.issuedAt),
      paymentInstructions: invoice.paymentInstructions,
    },
    from,
    to,
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
}

export async function downloadQuotePdf(
  quote: WithId<QuoteDoc>,
  from: PartyName,
  to: PartyName,
): Promise<void> {
  // Quote uses the same LineItem shape as invoice, just with an optional
  // `kind` field we ignore for layout purposes.
  await renderPdf(
    `${quote.quoteNumber}.pdf`,
    {
      kind: "Quote",
      number: quote.quoteNumber,
      issuedLabel: "Sent",
      issuedDate: fmtDate(quote.sentAt ?? quote.issuedAt),
      validUntil: quote.validUntil ? fmtDate(quote.validUntil) : null,
      noteToClient: quote.noteToClient,
      terms: quote.terms,
    },
    from,
    to,
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
}
