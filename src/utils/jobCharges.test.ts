import { describe, expect, it } from "vitest";
import type { Timestamp } from "firebase/firestore";
import type { ExpenseDoc, JobExtraDoc, TimeEntryDoc, WithId } from "@/firebase/interfaces";
import { rollUpJobCharges } from "./jobCharges";

const NOW = 1_700_000_000_000;
const HOUR = 3_600_000;

// Minimal Timestamp stub — entryBillable only ever calls toMillis().
const ts = (ms: number) => ({ toMillis: () => ms }) as unknown as Timestamp;

function time(over: Partial<TimeEntryDoc> = {}): WithId<TimeEntryDoc> {
  return {
    id: Math.random().toString(36).slice(2),
    tradespersonId: "tp1",
    clientId: "c1",
    startedAt: ts(NOW - HOUR), // 1h elapsed by default
    endedAt: ts(NOW),
    hourlyRateSnapshot: 10000, // $100/hr
    notes: "",
    source: "clock",
    kind: "labour",
    extraId: null,
    invoicedAt: null,
    ...over,
  };
}

function expense(over: Partial<ExpenseDoc> = {}): WithId<ExpenseDoc> {
  return {
    id: Math.random().toString(36).slice(2),
    tradespersonId: "tp1",
    clientId: "c1",
    description: "Parts",
    vendor: null,
    spentAt: null,
    totalCost: 5000,
    markupPercent: 0,
    billedAmount: 5000,
    category: null,
    receiptStoragePath: null,
    status: "ready",
    aiParsed: false,
    createdAt: ts(NOW),
    updatedAt: ts(NOW),
    invoicedAt: null,
    ...over,
  };
}

function extra(over: Partial<JobExtraDoc> = {}): WithId<JobExtraDoc> {
  return {
    id: Math.random().toString(36).slice(2),
    tradespersonId: "tp1",
    clientId: "c1",
    description: "Extra slab",
    billingType: "flat",
    flatAmountCents: 20000,
    hourlyRateCents: null,
    status: "approved",
    proposedAt: ts(NOW),
    decidedAt: ts(NOW),
    declinedReason: null,
    invoicedAt: null,
    createdAt: ts(NOW),
    ...over,
  };
}

const base = {
  tradespersonId: "tp1",
  nowMs: NOW,
} as const;

describe("rollUpJobCharges", () => {
  it("sums hourly time + expenses + flat change orders", () => {
    const r = rollUpJobCharges({
      ...base,
      billingType: "hourly",
      timeEntries: [time()], // 1h @ $100 = $100
      expenses: [expense({ billedAmount: 5000 })],
      extras: [extra({ flatAmountCents: 20000 })],
    });
    expect(r.timeCents).toBe(10000);
    expect(r.expenseCents).toBe(5000);
    expect(r.changeOrderCents).toBe(20000);
    expect(r.totalCents).toBe(35000);
  });

  it("never bills receipts on a fixed-price job", () => {
    const r = rollUpJobCharges({
      ...base,
      billingType: "fixed",
      timeEntries: [],
      expenses: [expense({ billedAmount: 9999 })],
      extras: [],
    });
    expect(r.expenseCents).toBe(0);
    expect(r.totalCents).toBe(0);
  });

  it("drops $0 base labour on a fixed job but keeps hourly change-order time", () => {
    const r = rollUpJobCharges({
      ...base,
      billingType: "fixed",
      timeEntries: [
        time({ kind: "labour", hourlyRateSnapshot: 0 }), // dropped
        time({ kind: "extra", extraId: "x1", hourlyRateSnapshot: 8000 }), // 1h @ $80 = $80
      ],
      expenses: [],
      extras: [],
    });
    expect(r.timeCents).toBe(8000);
  });

  it("counts a running (un-ended) entry up to now", () => {
    const r = rollUpJobCharges({
      ...base,
      billingType: "hourly",
      timeEntries: [time({ startedAt: ts(NOW - 2 * HOUR), endedAt: null })], // 2h @ $100
      expenses: [],
      extras: [],
    });
    expect(r.timeCents).toBe(20000);
  });

  it("excludes already-invoiced time, expenses, and change orders", () => {
    const r = rollUpJobCharges({
      ...base,
      billingType: "hourly",
      timeEntries: [time({ invoicedAt: ts(NOW) })],
      expenses: [expense({ invoicedAt: ts(NOW) })],
      extras: [extra({ invoicedAt: ts(NOW) })],
    });
    expect(r.totalCents).toBe(0);
  });

  it("ignores time logged by a different tradesperson", () => {
    const r = rollUpJobCharges({
      ...base,
      billingType: "hourly",
      timeEntries: [time({ tradespersonId: "someone-else" })],
      expenses: [],
      extras: [],
    });
    expect(r.timeCents).toBe(0);
  });

  it("only counts approved flat change orders (not pending or hourly)", () => {
    const r = rollUpJobCharges({
      ...base,
      billingType: "hourly",
      timeEntries: [],
      expenses: [],
      extras: [
        extra({ status: "proposed", flatAmountCents: 11111 }), // not approved
        extra({ billingType: "hourly", flatAmountCents: null, hourlyRateCents: 9000 }), // bills via time
        extra({ status: "approved", billingType: "flat", flatAmountCents: 30000 }),
      ],
    });
    expect(r.changeOrderCents).toBe(30000);
  });
});
