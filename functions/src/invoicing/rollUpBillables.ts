import { Timestamp } from "firebase-admin/firestore";

// Shared invoice roll-up used by BOTH pullBillablesFromJob and
// submitJobForApproval (functions/ is one package, so a real import keeps the
// two in lockstep instead of the old copy-paste rate grouping). Turns a job's
// time entries + approved change orders into invoice line items.
//
// Time entries group by (kind, extraId, rate) so labour, travel, and each
// hourly change order roll up into their own labelled lines:
//   labour → "Labour: 3.5h @ $85.00/hr"
//   travel → "Travel: 0.5h @ $40.00/hr"
//   extra  → "<change-order description>: 2h @ $90.00/hr"
//
// $0 base labour on a FIXED-price job is intentionally skipped — that time is a
// record, not a charge (the fixed price comes from the quote rows). $0 labour on
// an hourly job is kept as a $0 line so the tradie can hand-price it.

export interface RollupLine {
  id?: string;
  description: string;
  quantity: number;
  unitPrice: number;
  taxRate: number;
}

interface TimeEntryData {
  tradespersonId?: string;
  startedAt: Timestamp;
  endedAt: Timestamp | null;
  hourlyRateSnapshot: number;
  kind?: "labour" | "travel" | "extra";
  extraId?: string | null;
  invoicedAt: Timestamp | null;
}

interface ExtraData {
  description: string;
  billingType: "flat" | "hourly";
  flatAmountCents: number | null;
  status: string;
  invoicedAt: Timestamp | null;
}

interface ExpenseData {
  description: string;
  billedAmount: number;
  invoicedAt: Timestamp | null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** id → description for every change order on the job (for time-line labels). */
export function extraDescriptionMap(
  docs: FirebaseFirestore.QueryDocumentSnapshot[],
): Map<string, string> {
  const m = new Map<string, string>();
  for (const d of docs) {
    const x = d.data() as { description?: string };
    m.set(d.id, (x.description ?? "Change order").trim() || "Change order");
  }
  return m;
}

export interface TimeRollupOptions {
  nowMs: number;
  /** submitJobForApproval auto-closes open timers (true); pull skips them (false). */
  includeOpen: boolean;
  /** When set, only this tradie's entries are rolled up. */
  tradespersonId?: string;
  /** Invoice line ids already present — skipped to avoid double-pull. */
  existingIds: Set<string>;
  /** "fixed" suppresses $0 base-labour lines; "hourly"/undefined keeps them. */
  billingType?: "hourly" | "fixed" | null;
  /** extraId → description, for labelling hourly change-order lines. */
  extraDescriptions: Map<string, string>;
}

export function rollUpTimeEntries(
  docs: FirebaseFirestore.QueryDocumentSnapshot[],
  opts: TimeRollupOptions,
): { lines: RollupLine[]; stampIds: string[]; billedExtraIds: string[] } {
  const groups = new Map<
    string,
    { kind: string; extraId: string | null; rate: number; hours: number; ids: string[] }
  >();
  for (const doc of docs) {
    if (opts.existingIds.has(doc.id)) continue;
    const e = doc.data() as TimeEntryData;
    if (opts.tradespersonId && e.tradespersonId !== opts.tradespersonId) continue;
    if (e.invoicedAt != null) continue;
    const isOpen = e.endedAt == null;
    if (isOpen && !opts.includeOpen) continue;
    const endMs = isOpen ? opts.nowMs : (e.endedAt as Timestamp).toMillis();
    const elapsedMs = endMs - e.startedAt.toMillis();
    if (elapsedMs <= 0) continue;
    const hours = elapsedMs / 3_600_000;
    const rate = Math.max(0, Math.floor(e.hourlyRateSnapshot));
    const kind = e.kind ?? "labour";
    const extraId = kind === "extra" ? (e.extraId ?? null) : null;
    const key = `${kind}|${extraId ?? ""}|${rate}`;
    const g = groups.get(key) ?? { kind, extraId, rate, hours: 0, ids: [] };
    g.hours += hours;
    g.ids.push(doc.id);
    groups.set(key, g);
  }

  const lines: RollupLine[] = [];
  const stampIds: string[] = [];
  const billedExtraIds: string[] = [];
  for (const g of groups.values()) {
    if (g.hours <= 0) continue;
    // Fixed-job base labour at $0 is a time-only record — no line, and don't
    // stamp it invoiced so it stays visible in the Work Order log.
    if (g.kind === "labour" && g.rate === 0 && opts.billingType === "fixed") continue;

    const qty = round2(g.hours);
    const rateTail = g.rate === 0 ? "" : ` @ $${(g.rate / 100).toFixed(2)}/hr`;
    let label: string;
    if (g.kind === "travel") label = "Travel";
    else if (g.kind === "extra") label = opts.extraDescriptions.get(g.extraId ?? "") ?? "Change order";
    else label = "Labour";

    lines.push({
      id: g.ids[0],
      description: `${label}: ${qty}h${rateTail}`,
      quantity: qty,
      unitPrice: g.rate,
      taxRate: 0,
    });
    for (const id of g.ids) stampIds.push(id);
    if (g.kind === "extra" && g.extraId) billedExtraIds.push(g.extraId);
  }
  return { lines, stampIds, billedExtraIds };
}

// Matches the auto-generated hourly time lines emitted above:
//   "Labour: 23.27h @ $50.00/hr"  ·  "Travel: 0.5h @ $40.00/hr"  ·  "Labour: 5h"
// Hand-typed labels ("Labour (kitchen): 5h") and change-order lines (which
// carry the extra's own description) don't match, so they stay separate.
const HOURLY_LINE_RE = /^(Labour|Travel): \d+(?:\.\d+)?h(?: @ \$\d+(?:\.\d+)?\/hr)?$/;

/**
 * Collapse same-rate hourly time lines into one "<label>: <total>h @ $rate/hr"
 * line. Time billed by the hour can spread across several lines — each wrap-up
 * / pull rolls up only the hours accrued since the last one, so labour at one
 * rate ends up split. This re-merges them by (label, rate, taxRate): all
 * $50/hr labour totals into a single line; a second distinct rate stays
 * separate. Subtotal/tax are unchanged (quantity × unitPrice is additive) —
 * it's purely how the bill reads. The first matching line keeps its id.
 *
 * Mirrored client-side in src/utils/invoiceLines.ts — keep the two in lockstep.
 */
export function consolidateHourlyLines(items: RollupLine[]): RollupLine[] {
  const out: RollupLine[] = [];
  const idxByKey = new Map<string, number>();
  const mergedKeys = new Set<string>();

  for (const li of items) {
    const m = HOURLY_LINE_RE.exec((li.description ?? "").trim());
    if (!m) {
      out.push(li);
      continue;
    }
    const key = `${m[1]}|${li.unitPrice}|${li.taxRate}`;
    const at = idxByKey.get(key);
    if (at === undefined) {
      idxByKey.set(key, out.length);
      out.push({ ...li });
    } else {
      out[at] = { ...out[at], quantity: round2(out[at].quantity + li.quantity) };
      mergedKeys.add(key);
    }
  }

  for (const key of mergedKeys) {
    const at = idxByKey.get(key) as number;
    const li = out[at];
    const label = (HOURLY_LINE_RE.exec(li.description) as RegExpExecArray)[1];
    const rateTail = li.unitPrice === 0 ? "" : ` @ $${(li.unitPrice / 100).toFixed(2)}/hr`;
    out[at] = { ...li, description: `${label}: ${round2(li.quantity)}h${rateTail}` };
  }

  return out;
}

/**
 * Approved FLAT change orders → one line each. Hourly change orders aren't here
 * — their charge flows through clocked time (rollUpTimeEntries). Skips ones
 * already invoiced or already on the invoice (existingIds).
 */
export function rollUpApprovedExtras(
  docs: FirebaseFirestore.QueryDocumentSnapshot[],
  existingIds: Set<string>,
): { lines: RollupLine[]; stampIds: string[] } {
  const lines: RollupLine[] = [];
  const stampIds: string[] = [];
  for (const doc of docs) {
    if (existingIds.has(doc.id)) continue;
    const x = doc.data() as ExtraData;
    if (x.status !== "approved") continue;
    if (x.invoicedAt != null) continue;
    if (x.billingType !== "flat") continue;
    const amount = Math.max(0, Math.floor(x.flatAmountCents ?? 0));
    if (amount <= 0) continue;
    lines.push({
      id: doc.id,
      description: x.description?.trim() || "Change order",
      quantity: 1,
      unitPrice: amount,
      taxRate: 0,
    });
    stampIds.push(doc.id);
  }
  return { lines, stampIds };
}

/**
 * Expenses (receipts) → one invoice line each at billedAmount (markup already
 * applied client-side; the client never sees totalCost or the receipt). Skips
 * ones already invoiced, already on the invoice, or with no billable amount.
 *
 * FIXED-price jobs return nothing: the agreed price already covers materials,
 * so receipts are the tradesperson's private cost record, not a client charge.
 * Out-of-scope materials on a fixed job must go through an approved change
 * order instead. `null`/legacy billingType is treated as NOT fixed, preserving
 * the prior always-bill behaviour for jobs that predate the stamped field.
 */
export function rollUpExpenses(
  docs: FirebaseFirestore.QueryDocumentSnapshot[],
  opts: { existingIds: Set<string>; billingType?: "hourly" | "fixed" | null },
): { lines: RollupLine[]; stampIds: string[] } {
  const lines: RollupLine[] = [];
  const stampIds: string[] = [];
  if (opts.billingType === "fixed") return { lines, stampIds };
  for (const doc of docs) {
    if (opts.existingIds.has(doc.id)) continue;
    const x = doc.data() as ExpenseData;
    if (x.invoicedAt != null) continue;
    if ((x.billedAmount ?? 0) <= 0) continue;
    lines.push({
      id: doc.id,
      description: x.description?.trim() || "Materials",
      quantity: 1,
      unitPrice: x.billedAmount,
      taxRate: 0,
    });
    stampIds.push(doc.id);
  }
  return { lines, stampIds };
}
