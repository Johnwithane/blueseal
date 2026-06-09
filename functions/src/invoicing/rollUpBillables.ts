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
