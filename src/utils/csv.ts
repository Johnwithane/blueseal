// Minimal CSV builder + browser download. Quotes cells containing commas,
// quotes, or newlines (doubling embedded quotes), and prepends a UTF-8 BOM so
// Excel opens accented characters correctly. The output is plain comma-
// separated text — importable by QuickBooks, Excel, Google Sheets, etc.

type Cell = string | number | null | undefined;

function escapeCell(v: Cell): string {
  const s = v == null ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(headers: string[], rows: Cell[][]): string {
  const lines = [headers.map(escapeCell).join(",")];
  for (const row of rows) lines.push(row.map(escapeCell).join(","));
  return lines.join("\r\n");
}

export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** cents → a plain dollar string for CSV cells (no currency symbol). */
export function centsToDollars(cents: number): string {
  return (cents / 100).toFixed(2);
}
