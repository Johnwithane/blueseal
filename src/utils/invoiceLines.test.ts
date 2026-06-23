import { describe, it, expect } from "vitest";
import type { LineItem } from "@/firebase/interfaces";
import { consolidateHourlyLines } from "./invoiceLines";

const sub = (items: LineItem[]) => items.reduce((s, li) => s + li.quantity * li.unitPrice, 0);

describe("consolidateHourlyLines", () => {
  it("merges two labour lines at the same rate into one total-hours line", () => {
    const input: LineItem[] = [
      { id: "a", description: "Labour: 0.31h @ $50.00/hr", quantity: 0.31, unitPrice: 5000, taxRate: 0 },
      { id: "b", description: "Labour: 22.96h @ $50.00/hr", quantity: 22.96, unitPrice: 5000, taxRate: 0 },
    ];
    const out = consolidateHourlyLines(input);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      id: "a", // first line keeps its id
      description: "Labour: 23.27h @ $50.00/hr",
      quantity: 23.27,
      unitPrice: 5000,
    });
    // Subtotal is preserved — purely cosmetic re-grouping.
    expect(sub(out)).toBe(sub(input));
  });

  it("keeps labour at two different rates separate", () => {
    const input: LineItem[] = [
      { id: "a", description: "Labour: 2h @ $50.00/hr", quantity: 2, unitPrice: 5000, taxRate: 0 },
      { id: "b", description: "Labour: 3h @ $75.00/hr", quantity: 3, unitPrice: 7500, taxRate: 0 },
    ];
    const out = consolidateHourlyLines(input);
    expect(out).toHaveLength(2);
    expect(out.map((l) => l.description)).toEqual([
      "Labour: 2h @ $50.00/hr",
      "Labour: 3h @ $75.00/hr",
    ]);
  });

  it("merges across three pulls and rounds the total to 2 decimals", () => {
    const input: LineItem[] = [
      { id: "a", description: "Labour: 1.005h @ $50.00/hr", quantity: 1.005, unitPrice: 5000, taxRate: 0 },
      { id: "b", description: "Labour: 1.005h @ $50.00/hr", quantity: 1.005, unitPrice: 5000, taxRate: 0 },
      { id: "c", description: "Labour: 1h @ $50.00/hr", quantity: 1, unitPrice: 5000, taxRate: 0 },
    ];
    const out = consolidateHourlyLines(input);
    expect(out).toHaveLength(1);
    expect(out[0].quantity).toBe(3.01);
    expect(out[0].description).toBe("Labour: 3.01h @ $50.00/hr");
  });

  it("does not mix labour and travel even at the same rate", () => {
    const input: LineItem[] = [
      { description: "Labour: 2h @ $40.00/hr", quantity: 2, unitPrice: 4000, taxRate: 0 },
      { description: "Travel: 1h @ $40.00/hr", quantity: 1, unitPrice: 4000, taxRate: 0 },
      { description: "Travel: 0.5h @ $40.00/hr", quantity: 0.5, unitPrice: 4000, taxRate: 0 },
    ];
    const out = consolidateHourlyLines(input);
    expect(out).toHaveLength(2);
    expect(out[0].description).toBe("Labour: 2h @ $40.00/hr");
    expect(out[1].description).toBe("Travel: 1.5h @ $40.00/hr");
  });

  it("leaves freeform, materials, and change-order lines untouched", () => {
    const input: LineItem[] = [
      { id: "t", description: "Labour: 2h @ $50.00/hr", quantity: 2, unitPrice: 5000, taxRate: 0 },
      { description: "New shitter and materials", quantity: 1, unitPrice: 45000, taxRate: 0 },
      { description: "Gold plate shitter, add chode sprayer", quantity: 1, unitPrice: 977500, taxRate: 0 },
      { description: "Labour (kitchen): 3h @ $50.00/hr", quantity: 3, unitPrice: 5000, taxRate: 0 },
      { id: "t2", description: "Labour: 1h @ $50.00/hr", quantity: 1, unitPrice: 5000, taxRate: 0 },
    ];
    const out = consolidateHourlyLines(input);
    // The two bare "Labour:" lines merge; the hand-labelled one + materials stay.
    expect(out).toHaveLength(4);
    expect(out[0]).toMatchObject({ description: "Labour: 3h @ $50.00/hr", quantity: 3 });
    expect(out.map((l) => l.description)).toContain("Labour (kitchen): 3h @ $50.00/hr");
    expect(out.map((l) => l.description)).toContain("New shitter and materials");
    expect(sub(out)).toBe(sub(input));
  });

  it("merges $0-rate labour lines (hourly job, rate not yet set)", () => {
    const input: LineItem[] = [
      { description: "Labour: 2h", quantity: 2, unitPrice: 0, taxRate: 0 },
      { description: "Labour: 1.5h", quantity: 1.5, unitPrice: 0, taxRate: 0 },
    ];
    const out = consolidateHourlyLines(input);
    expect(out).toHaveLength(1);
    expect(out[0].description).toBe("Labour: 3.5h");
    expect(out[0].unitPrice).toBe(0);
  });

  it("keeps same-rate lines with different tax rates separate", () => {
    const input: LineItem[] = [
      { description: "Labour: 2h @ $50.00/hr", quantity: 2, unitPrice: 5000, taxRate: 0 },
      { description: "Labour: 3h @ $50.00/hr", quantity: 3, unitPrice: 5000, taxRate: 0.13 },
    ];
    const out = consolidateHourlyLines(input);
    expect(out).toHaveLength(2);
  });

  it("is a no-op on an empty list", () => {
    expect(consolidateHourlyLines([])).toEqual([]);
  });
});
