import type { LineItem } from "@/firebase/interfaces";

// Matches the auto-generated hourly time lines emitted by the billables
// roll-up (functions/src/invoicing/rollUpBillables.ts):
//   "Labour: 23.27h @ $50.00/hr"  ·  "Travel: 0.5h @ $40.00/hr"  ·  "Labour: 5h"
// Only these system-shaped lines fold together — a hand-typed label like
// "Labour (kitchen): 5h" or a bare "Labour" stays its own line. Change-order
// lines carry the change order's own description, so they never match here and
// stay separate (each approved extra is a distinct charge).
const HOURLY_LINE_RE = /^(Labour|Travel): \d+(?:\.\d+)?h(?: @ \$\d+(?:\.\d+)?\/hr)?$/;

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Collapse same-rate hourly time lines into one "<label>: <total>h @ $rate/hr"
 * line. Time billed by the hour can land on an invoice as several lines — each
 * wrap-up / "pull from job" rolls up only the hours accrued since the last
 * pull, so labour at one rate ends up split across pulls. This re-merges them.
 *
 * Lines fold by (label, rate, taxRate): all $50/hr labour totals into a single
 * line; a second distinct rate stays separate. The merged subtotal/tax are
 * unchanged (quantity × unitPrice is additive) — this is purely how the bill
 * reads. The first matching line keeps its id; only its hours/description are
 * rewritten. Non-matching lines pass through untouched, in order.
 *
 * Mirrored server-side in rollUpBillables.ts (consolidateHourlyLines) so new
 * invoices write already-merged; keep the two in lockstep.
 */
export function consolidateHourlyLines(items: LineItem[]): LineItem[] {
  const out: LineItem[] = [];
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

  // Rewrite hours in the description only for lines that actually absorbed
  // another — untouched lines keep their original description verbatim.
  for (const key of mergedKeys) {
    const at = idxByKey.get(key) as number;
    const li = out[at];
    const label = (HOURLY_LINE_RE.exec(li.description) as RegExpExecArray)[1];
    const rateTail = li.unitPrice === 0 ? "" : ` @ $${(li.unitPrice / 100).toFixed(2)}/hr`;
    out[at] = { ...li, description: `${label}: ${round2(li.quantity)}h${rateTail}` };
  }

  return out;
}
