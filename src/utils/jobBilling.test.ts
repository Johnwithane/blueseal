import { describe, it, expect } from "vitest";
import { billingTypeFromLineItems, jobBillingType } from "./jobBilling";
import type { JobDoc, LineItem } from "@/firebase/interfaces";

const line = (kind?: LineItem["kind"]): LineItem => ({
  kind,
  description: "x",
  quantity: 1,
  unitPrice: 100,
  taxRate: 0,
});

describe("billingTypeFromLineItems", () => {
  it("is hourly when any line is kind 'hourly'", () => {
    expect(billingTypeFromLineItems([line("labour"), line("hourly")])).toBe("hourly");
  });

  it("is fixed when all lines are flat labour / materials", () => {
    expect(billingTypeFromLineItems([line("labour"), line("materials")])).toBe("fixed");
  });

  it("is fixed for legacy lines with no kind", () => {
    expect(billingTypeFromLineItems([line(undefined), line(undefined)])).toBe("fixed");
  });

  it("is fixed for empty / nullish input", () => {
    expect(billingTypeFromLineItems([])).toBe("fixed");
    expect(billingTypeFromLineItems(null)).toBe("fixed");
    expect(billingTypeFromLineItems(undefined)).toBe("fixed");
  });
});

describe("jobBillingType", () => {
  it("prefers the stamped field over the quote", () => {
    const job = { billingType: "hourly" } as Pick<JobDoc, "billingType">;
    // Even with fixed-looking quote lines, the stamped value wins.
    expect(jobBillingType(job, [line("labour")])).toBe("hourly");
  });

  it("falls back to the quote lines on a legacy job (no billingType)", () => {
    const job = {} as Pick<JobDoc, "billingType">;
    expect(jobBillingType(job, [line("hourly")])).toBe("hourly");
    expect(jobBillingType(job, [line("labour")])).toBe("fixed");
  });

  it("defaults to fixed when nothing is known", () => {
    expect(jobBillingType(null)).toBe("fixed");
    expect(jobBillingType(undefined)).toBe("fixed");
  });
});
