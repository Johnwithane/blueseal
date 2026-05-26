import { describe, expect, it } from "vitest";
import { recomputeTotals } from "./invoices";
import type { LineItem } from "@/firebase/interfaces";

const cents = (dollars: number) => Math.round(dollars * 100);

describe("recomputeTotals", () => {
  const labour: LineItem = {
    description: "Labour",
    quantity: 1,
    unitPrice: cents(100),
    taxRate: 0.13,
  };

  it("returns zeros for an empty invoice", () => {
    expect(recomputeTotals([])).toEqual({
      subtotal: 0,
      discountAmount: 0,
      taxTotal: 0,
      totalBeforeCredit: 0,
      upfrontFeeCreditAmount: 0,
      total: 0,
    });
  });

  it("computes subtotal + tax with no discount", () => {
    const t = recomputeTotals([labour]);
    expect(t.subtotal).toBe(cents(100));
    expect(t.discountAmount).toBe(0);
    expect(t.taxTotal).toBe(cents(13));
    expect(t.total).toBe(cents(113));
  });

  it("applies a percent discount before tax", () => {
    // $100 line, 10% off → $90 → HST 13% on $90 = $11.70 → total $101.70
    const t = recomputeTotals([labour], { type: "percent", value: 10, label: null });
    expect(t.subtotal).toBe(cents(100));
    expect(t.discountAmount).toBe(cents(10));
    expect(t.taxTotal).toBe(cents(11.7));
    expect(t.total).toBe(cents(101.7));
  });

  it("applies a fixed discount before tax", () => {
    // $100 line, $25 off → $75 → HST 13% on $75 = $9.75 → total $84.75
    const t = recomputeTotals([labour], { type: "fixed", value: cents(25), label: null });
    expect(t.subtotal).toBe(cents(100));
    expect(t.discountAmount).toBe(cents(25));
    expect(t.taxTotal).toBe(cents(9.75));
    expect(t.total).toBe(cents(84.75));
  });

  it("clamps percent discount to 0-100", () => {
    const over = recomputeTotals([labour], { type: "percent", value: 250, label: null });
    expect(over.discountAmount).toBe(cents(100));
    expect(over.total).toBe(0);

    const negative = recomputeTotals([labour], { type: "percent", value: -10, label: null });
    expect(negative.discountAmount).toBe(0);
    expect(negative.total).toBe(cents(113));
  });

  it("clamps fixed discount to never exceed subtotal", () => {
    const t = recomputeTotals([labour], { type: "fixed", value: cents(999), label: null });
    expect(t.discountAmount).toBe(cents(100));
    expect(t.total).toBe(0);
  });

  it("scales tax proportionally with mixed tax rates", () => {
    // $100 labour (13% HST) + $50 materials (0% tax — exempt). 10% off.
    // Discounted base: labour $90, materials $45. Tax: $11.70 only on labour.
    // Total: $90 + $45 + $11.70 = $146.70
    const items: LineItem[] = [
      labour,
      { description: "Exempt materials", quantity: 1, unitPrice: cents(50), taxRate: 0 },
    ];
    const t = recomputeTotals(items, { type: "percent", value: 10, label: null });
    expect(t.subtotal).toBe(cents(150));
    expect(t.discountAmount).toBe(cents(15));
    expect(t.taxTotal).toBe(cents(11.7));
    expect(t.total).toBe(cents(146.7));
  });

  it("handles a $0 invoice gracefully (no NaN from divide-by-zero in factor)", () => {
    const zero: LineItem = { description: "Freebie", quantity: 1, unitPrice: 0, taxRate: 0.13 };
    const t = recomputeTotals([zero], { type: "percent", value: 10, label: null });
    expect(t.subtotal).toBe(0);
    expect(t.discountAmount).toBe(0);
    expect(t.taxTotal).toBe(0);
    expect(t.total).toBe(0);
  });

  describe("upfront fee credit", () => {
    it("subtracts the credit from the post-tax total", () => {
      // $100 labour + 13% HST = $113 → less $25 upfront fee paid = $88
      const t = recomputeTotals([labour], null, cents(25));
      expect(t.totalBeforeCredit).toBe(cents(113));
      expect(t.upfrontFeeCreditAmount).toBe(cents(25));
      expect(t.total).toBe(cents(88));
    });

    it("clamps the final total to zero when the credit exceeds the bill", () => {
      // $100 labour + 13% HST = $113 → less $500 already paid = $0 (not negative)
      const t = recomputeTotals([labour], null, cents(500));
      expect(t.totalBeforeCredit).toBe(cents(113));
      expect(t.upfrontFeeCreditAmount).toBe(cents(500));
      expect(t.total).toBe(0);
    });

    it("does not double-discount — tax still computed on the post-discount base, not on the credit", () => {
      // Without the credit: $100 line, 10% discount, 13% HST → $101.70 total.
      // With $20 credit applied AFTER tax: $101.70 − $20 = $81.70 total.
      // The credit must not change subtotal/discountAmount/taxTotal.
      const t = recomputeTotals(
        [labour],
        { type: "percent", value: 10, label: null },
        cents(20),
      );
      expect(t.subtotal).toBe(cents(100));
      expect(t.discountAmount).toBe(cents(10));
      expect(t.taxTotal).toBe(cents(11.7));
      expect(t.totalBeforeCredit).toBe(cents(101.7));
      expect(t.upfrontFeeCreditAmount).toBe(cents(20));
      expect(t.total).toBe(cents(81.7));
    });

    it("defaults to zero credit when omitted (backwards compatible)", () => {
      const t = recomputeTotals([labour]);
      expect(t.upfrontFeeCreditAmount).toBe(0);
      expect(t.total).toBe(cents(113));
    });
  });
});
