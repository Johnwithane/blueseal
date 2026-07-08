// P1-11: job-accrued invoice lines (labour/travel time, expenses, approved
// change orders) must inherit the accepted quote's tax rate instead of
// defaulting to 0%, or a GST/HST-registered tradesperson silently
// under-collects on every job-billables invoice. resolveDefaultTaxRate derives
// the rate from the quote; the roll-ups stamp it onto the generated lines.

import { describe, it, expect } from "vitest";
import { resolveDefaultTaxRate } from "../../src/lib/billing";
import {
  rollUpApprovedExtras,
  rollUpExpenses,
  rollUpTimeEntries,
} from "../../src/invoicing/rollUpBillables";

type Doc = FirebaseFirestore.QueryDocumentSnapshot;
const doc = (id: string, data: Record<string, unknown>) =>
  ({ id, data: () => data }) as unknown as Doc;
const ts = (ms: number) => ({ toMillis: () => ms });

describe("resolveDefaultTaxRate", () => {
  it("returns 0 for a quote with no lines / no tax", () => {
    expect(resolveDefaultTaxRate(null)).toBe(0);
    expect(resolveDefaultTaxRate(undefined)).toBe(0);
    expect(resolveDefaultTaxRate([])).toBe(0);
    expect(resolveDefaultTaxRate([{ taxRate: 0 }])).toBe(0);
  });

  it("inherits the quote's single rate", () => {
    expect(resolveDefaultTaxRate([{ taxRate: 0.13 }, { taxRate: 0.13 }])).toBe(0.13);
  });

  it("takes the highest line rate so a $0/0% placeholder can't drag it to 0", () => {
    expect(resolveDefaultTaxRate([{ taxRate: 0 }, { taxRate: 0.13 }])).toBe(0.13);
  });

  it("ignores non-numeric / non-finite rates", () => {
    expect(
      resolveDefaultTaxRate([
        { taxRate: undefined },
        { taxRate: Number.NaN },
        { taxRate: 0.05 },
      ]),
    ).toBe(0.05);
  });
});

describe("roll-ups inherit the job tax rate", () => {
  it("stamps the rate on approved flat change-order lines", () => {
    const extras = [
      doc("x1", {
        description: "Extra panel",
        billingType: "flat",
        flatAmountCents: 8000,
        status: "approved",
        invoicedAt: null,
      }),
    ];
    const { lines } = rollUpApprovedExtras(extras, new Set(), 0.13);
    expect(lines).toHaveLength(1);
    expect(lines[0].taxRate).toBe(0.13);
    expect(lines[0].unitPrice).toBe(8000);
  });

  it("stamps the rate on expense lines", () => {
    const expenses = [
      doc("e1", { description: "Materials", billedAmount: 4600, invoicedAt: null }),
    ];
    const { lines } = rollUpExpenses(expenses, { existingIds: new Set(), taxRate: 0.13 });
    expect(lines[0].taxRate).toBe(0.13);
  });

  it("stamps the rate on labour time lines", () => {
    const entries = [
      doc("t1", {
        tradespersonId: "tradie",
        startedAt: ts(0),
        endedAt: ts(3_600_000), // 1h
        hourlyRateSnapshot: 8500,
        kind: "labour",
        invoicedAt: null,
      }),
    ];
    const { lines } = rollUpTimeEntries(entries, {
      nowMs: 3_600_000,
      includeOpen: false,
      existingIds: new Set(),
      taxRate: 0.13,
      extraDescriptions: new Map(),
    });
    expect(lines).toHaveLength(1);
    expect(lines[0].taxRate).toBe(0.13);
    expect(lines[0].unitPrice).toBe(8500);
  });

  it("defaults to 0% when no rate is provided (legacy jobs)", () => {
    const expenses = [
      doc("e1", { description: "Materials", billedAmount: 4600, invoicedAt: null }),
    ];
    const { lines } = rollUpExpenses(expenses, { existingIds: new Set() });
    expect(lines[0].taxRate).toBe(0);
  });
});
