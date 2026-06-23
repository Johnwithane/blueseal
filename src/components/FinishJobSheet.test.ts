import { describe, it, expect, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import FinishJobSheet from "./FinishJobSheet.vue";
import type { JobExtraDoc, WithId } from "@/firebase/interfaces";

// Composables/stores need app context (PrimeVue toast provide, Pinia) we don't
// stand up here — mock them so setup runs in isolation. The bug under test is
// downstream of these, so mocking them doesn't mask it.
vi.mock("@/composables/useFormatters", () => ({
  useFormatters: () => ({ money: (c: number) => `$${(c / 100).toFixed(2)}` }),
}));
vi.mock("@/composables/useToast", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));
vi.mock("@/stores/paywall", () => ({
  usePaywallStore: () => ({ fromError: () => false }),
}));

// Inert live subscriptions — no real Firestore in unit tests. The quote-step
// tests drive state via the mocked getQuoteByJobId below.
vi.mock("@/firebase/services/timeEntries", () => ({
  subscribeJobTimeEntries: (_j: string, _t: string, cb: (l: unknown[]) => void) => {
    cb([]);
    return () => {};
  },
  entryBillable: () => ({ elapsedMs: 0, billedAmount: 0 }),
}));
vi.mock("@/firebase/services/expenses", () => ({
  subscribeJobExpenses: (_j: string, _t: string, cb: (l: unknown[]) => void) => {
    cb([]);
    return () => {};
  },
}));

// One fixed + one materials row (kept) plus an hourly row (excluded — billed
// from clocked time, not the quote estimate).
const getQuoteByJobId = vi.fn();
vi.mock("@/firebase/services/quotes", () => ({
  getQuoteByJobId: (id: string) => getQuoteByJobId(id),
}));

const STUBS = {
  // Dialog renders its slots only when visible — mirrors PrimeVue's lazy body.
  Dialog: {
    props: ["visible"],
    template: '<div v-if="visible"><slot /><slot name="footer" /></div>',
  },
  // Render the label so the send button's state ("Add something to bill first"
  // vs "Send for approval — $X") is assertable.
  Button: { props: ["label"], template: "<button>{{ label }}</button>" },
  InputText: true,
  Textarea: true,
  SelectButton: true,
  Message: true,
  Tag: true,
  NumberField: true,
  // The add-time / add-expense dialogs have their own service deps; isolate
  // FinishJobSheet from them.
  ManualTimeEntryDialog: true,
  AddExpenseDialog: true,
};

function mountSheet(visible = false, billingType: "fixed" | "hourly" = "fixed") {
  return mount(FinishJobSheet, {
    props: {
      visible,
      jobId: "job1",
      tradespersonId: "tp1",
      clientId: "c1",
      billingType,
      extras: [] as WithId<JobExtraDoc>[],
      upfrontFeePaidCents: 0,
    },
    global: { stubs: STUBS },
  });
}

describe("FinishJobSheet", () => {
  // Regression: FINISH_STEPS reads costTrackingOnly, and watch(FINISH_STEPS)
  // evaluates its source eagerly during setup. When costTrackingOnly was
  // declared ~200 lines later, that eager eval hit the temporal dead zone
  // ("Cannot access 'costTrackingOnly' before initialization") and the whole
  // setup threw — so the wrap-up sheet silently never opened. Mounting at all
  // exercises that path, so this guards the declaration order.
  it("mounts without a setup error (costTrackingOnly declared before use)", () => {
    expect(() => mountSheet(false)).not.toThrow();
    expect(mountSheet(false).exists()).toBe(true);
  });

  it("renders the wizard once visible", () => {
    // Fixed job, no quote rows → time / expenses / extras / wrap-up = 4 steps.
    expect(mountSheet(true).text()).toContain("Step 1 of 4");
  });

  it("surfaces the quote as an ever-present reference, not a wizard step", async () => {
    getQuoteByJobId.mockResolvedValueOnce({
      id: "q1",
      lineItems: [
        { kind: "labour", description: "Install mixer", quantity: 1, unitPrice: 18000, taxRate: 0.13 },
        { kind: "materials", description: "Membrane", quantity: 1, unitPrice: 9500, taxRate: 0.13 },
        { kind: "hourly", description: "On-site labour", quantity: 5, unitPrice: 8500, taxRate: 0 },
      ],
    });
    // visible watch isn't immediate — open it false→true so hydration runs.
    const w = mountSheet(false);
    await w.setProps({ visible: true });
    await flushPromises();

    // Still 4 steps — the quote is no longer one of them.
    expect(w.text()).toContain("Step 1 of 4");
    // On a fixed job the panel is relabelled the agreed price (it IS the bill).
    expect(w.text()).toContain("Agreed fixed price");
    // The panel shows the FIXED rows (hourly is billed from time).
    expect(w.text()).toContain("Install mixer");
    expect(w.text()).toContain("Membrane");
    expect(w.text()).not.toContain("On-site labour");
  });

  it("auto-adds the agreed quote price on a fixed-price job", async () => {
    getQuoteByJobId.mockResolvedValueOnce({
      id: "q1",
      lineItems: [
        { kind: "materials", description: "Install mixer", quantity: 1, unitPrice: 18000, taxRate: 0 },
      ],
    });
    const w = mountSheet(false);
    await w.setProps({ visible: true });
    await flushPromises();

    // Jump to the full form so the send button (with its total state) shows.
    const skip = w.findAll("button").find((b) => b.text().includes("Skip"));
    await skip!.trigger("click");
    // Pre-added: the agreed price is already on the invoice, no tap needed.
    expect(w.text()).toContain("Send for approval");
    expect(w.text()).toContain("$180.00");

    // The tradesperson can still tap a line off if it no longer applies.
    const addChip = w.find(".finish-sheet-quote-add");
    await addChip.trigger("click");
    expect(w.text()).toContain("Add something to bill first");
  });

  it("carries the quote's own discount so the auto-filled total matches the agreed price", async () => {
    getQuoteByJobId.mockResolvedValueOnce({
      id: "q1",
      lineItems: [
        { kind: "materials", description: "Install mixer", quantity: 1, unitPrice: 18000, taxRate: 0 },
      ],
      // $20 off was baked into the agreed quote — the line is stored pre-discount.
      discount: { type: "fixed", value: 2000, label: "Repeat customer" },
    });
    const w = mountSheet(false);
    await w.setProps({ visible: true });
    await flushPromises();

    const skip = w.findAll("button").find((b) => b.text().includes("Skip"));
    await skip!.trigger("click");
    // $180 agreed − $20 quote discount = $160, not the pre-discount $180.
    expect(w.text()).toContain("Send for approval");
    expect(w.text()).toContain("$160.00");
  });

  it("keeps quote rows opt-in on an hourly job (labour bills from clocked time)", async () => {
    getQuoteByJobId.mockResolvedValueOnce({
      id: "q1",
      lineItems: [
        { kind: "materials", description: "Membrane", quantity: 1, unitPrice: 9500, taxRate: 0 },
      ],
    });
    const w = mountSheet(false, "hourly");
    await w.setProps({ visible: true });
    await flushPromises();

    // Hourly keeps the original "From your quote" framing.
    expect(w.text()).toContain("From your quote");
    const skip = w.findAll("button").find((b) => b.text().includes("Skip"));
    await skip!.trigger("click");
    // Not pre-added — the tradie opts in by tapping.
    expect(w.text()).toContain("Add something to bill first");
    await w.find(".finish-sheet-quote-add").trigger("click");
    expect(w.text()).toContain("Send for approval");
  });
});
