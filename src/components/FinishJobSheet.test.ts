import { beforeEach, describe, it, expect, vi } from "vitest";
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

// The sheet re-reads the live invoice so it can re-supply its free-form lines
// (see hydrateFromQuote). recomputeTotals is real math the preview depends on —
// keep it, stub only the network read.
const getInvoiceByJobId = vi.fn();
vi.mock("@/firebase/services/invoices", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/firebase/services/invoices")>()),
  getInvoiceByJobId: (id: string) => getInvoiceByJobId(id),
}));

const submitJobForApproval = vi.fn();
vi.mock("@/firebase/services/jobs", () => ({
  submitJobForApproval: (input: unknown) => submitJobForApproval(input),
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
  // Real input, not a black-box stub — the skip-approval toggle's effect on
  // the submit payload is the thing under test.
  Checkbox: {
    props: ["modelValue", "binary", "inputId"],
    emits: ["update:modelValue"],
    template:
      '<input type="checkbox" :id="inputId" :checked="modelValue" @change="$emit(\'update:modelValue\', $event.target.checked)" />',
  },
  SelectButton: true,
  Message: true,
  Tag: true,
  NumberField: true,
  // The add-time / add-expense dialogs have their own service deps; isolate
  // FinishJobSheet from them.
  ManualTimeEntryDialog: true,
  AddExpenseDialog: true,
};

function mountSheet(
  visible = false,
  billingType: "fixed" | "hourly" = "fixed",
  clientId: string | null = "c1",
) {
  return mount(FinishJobSheet, {
    props: {
      visible,
      jobId: "job1",
      tradespersonId: "tp1",
      clientId,
      billingType,
      extras: [] as WithId<JobExtraDoc>[],
      upfrontFeePaidCents: 0,
    },
    global: { stubs: STUBS },
  });
}

describe("FinishJobSheet", () => {
  beforeEach(() => {
    getQuoteByJobId.mockReset();
    getInvoiceByJobId.mockReset();
    submitJobForApproval.mockReset();
    submitJobForApproval.mockResolvedValue({ ok: true, total: 0, lineItemsCount: 0 });
    getQuoteByJobId.mockResolvedValue(null);
    getInvoiceByJobId.mockResolvedValue(null);
  });

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

  // submitJobForApproval keeps only id-bearing lines (pulled time / expenses)
  // and rebuilds the rest from this sheet's extraLineItems. A manually written
  // invoice is ALL free-form lines, so without re-supplying them here, wrapping
  // the job up wiped the invoice the tradesperson had just written.
  it("re-supplies the invoice's hand-written lines so the wrap-up can't wipe them", async () => {
    getInvoiceByJobId.mockResolvedValueOnce({
      id: "job1",
      lineItems: [
        { description: "Emergency callout", quantity: 1, unitPrice: 12500, taxRate: 0 },
        // id-bearing: pulled from a time entry, preserved server-side — the
        // sheet must NOT re-supply it or it would be billed twice.
        { id: "t1", description: "On-site labour", quantity: 2, unitPrice: 8000, taxRate: 0 },
      ],
      discount: null,
    });
    const w = mountSheet(false);
    await w.setProps({ visible: true });
    await flushPromises();

    const skip = w.findAll("button").find((b) => b.text().includes("Skip"));
    await skip!.trigger("click");
    // Rows render into stubbed inputs, so assert on the preview total: the
    // $125 free-form line is re-supplied, and the $160 id-bearing row is NOT
    // (the server carries that one — re-supplying would bill it twice).
    expect(w.text()).toContain("Send for approval");
    expect(w.text()).toContain("$125.00");
    expect(w.text()).not.toContain("$285.00");
  });

  it("carries an existing invoice discount into the wrap-up", async () => {
    getInvoiceByJobId.mockResolvedValueOnce({
      id: "job1",
      lineItems: [{ description: "Emergency callout", quantity: 1, unitPrice: 12500, taxRate: 0 }],
      discount: { type: "fixed", value: 2500, label: "Goodwill" },
    });
    const w = mountSheet(false);
    await w.setProps({ visible: true });
    await flushPromises();

    const skip = w.findAll("button").find((b) => b.text().includes("Skip"));
    await skip!.trigger("click");
    // $125 − $25 = $100. Without the carry-over the callable would overwrite
    // the invoice's discount with null and re-bill the full $125.
    expect(w.text()).toContain("$100.00");
  });

  // Regression guard on the pre-add interaction: on a fixed job the quote rows
  // land on the invoice as free-form lines at the first submit. On a re-submit
  // they come back as extra rows, so pre-adding them again would double the bill.
  it("doesn't re-add quote rows that are already on the invoice", async () => {
    getQuoteByJobId.mockResolvedValueOnce({
      id: "q1",
      lineItems: [
        { kind: "materials", description: "Install mixer", quantity: 1, unitPrice: 18000, taxRate: 0 },
      ],
    });
    getInvoiceByJobId.mockResolvedValueOnce({
      id: "job1",
      lineItems: [{ description: "Install mixer", quantity: 1, unitPrice: 18000, taxRate: 0 }],
      discount: null,
    });
    const w = mountSheet(false);
    await w.setProps({ visible: true });
    await flushPromises();

    const skip = w.findAll("button").find((b) => b.text().includes("Skip"));
    await skip!.trigger("click");
    // $180 once, not $360.
    expect(w.text()).toContain("$180.00");
    expect(w.text()).not.toContain("$360.00");
  });
  // A tradesperson running a job end-to-end (their own client, cash or
  // e-transfer) has no use for the approve-then-pay round-trip, and would
  // otherwise sit in awaiting_client_approval forever waiting on a tap that
  // isn't coming. The opt-out sends skipClientApproval so the server finalizes
  // the invoice and drops the job straight into awaiting_payment.
  describe("finishing without client approval", () => {
    // One hand-written invoice line so there's something to bill (canSubmit).
    async function openAtReview(clientId: string | null = "c1") {
      getInvoiceByJobId.mockResolvedValue({
        id: "job1",
        lineItems: [{ description: "Callout", quantity: 1, unitPrice: 12500, taxRate: 0 }],
        discount: null,
      });
      const w = mountSheet(false, "fixed", clientId);
      await w.setProps({ visible: true });
      await flushPromises();
      const skip = w.findAll("button").find((b) => b.text().includes("Skip"));
      await skip!.trigger("click");
      return w;
    }

    function submitButton(w: ReturnType<typeof mountSheet>) {
      return w.findAll("button").find((b) => b.text().includes("$125.00"));
    }

    it("defaults to the approval round-trip", async () => {
      const w = await openAtReview();
      expect(submitButton(w)!.text()).toContain("Send for approval");

      await submitButton(w)!.trigger("click");
      await flushPromises();
      expect(submitJobForApproval).toHaveBeenCalledWith(
        expect.objectContaining({ jobId: "job1", skipClientApproval: false }),
      );
    });

    it("sends skipClientApproval once the tradesperson opts out", async () => {
      const w = await openAtReview();
      const box = w.find('input[type="checkbox"]');
      expect(box.exists()).toBe(true);

      await box.setValue(true);
      // The CTA has to stop promising an approval step it's no longer taking.
      expect(submitButton(w)!.text()).toContain("Finalize invoice");

      await submitButton(w)!.trigger("click");
      await flushPromises();
      expect(submitJobForApproval).toHaveBeenCalledWith(
        expect.objectContaining({ jobId: "job1", skipClientApproval: true }),
      );
    });

    it("hides the opt-out when there's no client to approve anyway", async () => {
      const w = await openAtReview(null);
      expect(w.find('input[type="checkbox"]').exists()).toBe(false);
      // Server treats a clientless job as self-completed regardless, so the
      // CTA already reads as final.
      expect(submitButton(w)!.text()).toContain("Finalize invoice");
    });
  });
});
