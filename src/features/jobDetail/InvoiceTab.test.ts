import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import InvoiceTab from "./InvoiceTab.vue";
import type { InvoiceStatus, JobDoc, JobStatus, WithId } from "@/firebase/interfaces";

// The tab is pure presentation over four heavy children (the editor, the
// client card, the refund card, the quote card) — stub them and assert on which
// surfaces the gating computeds expose. Button renders its label so the CTAs
// are findable. The refund card self-subscribes to Firestore and needs a
// PrimeVue Toast provider, so it must be stubbed like the rest.
const STUBS = {
  Button: { props: ["label"], template: "<button>{{ label }}</button>" },
  InvoiceEditor: { props: ["canEdit"], template: '<div class="stub-editor" />' },
  ClientInvoiceCard: { template: '<div class="stub-client-card" />' },
  RefundInvoiceCard: { template: '<div class="stub-refund-card" />' },
  QuoteCard: true,
};

function job(status: JobStatus): WithId<JobDoc> {
  return {
    id: "job1",
    status,
    title: "Leaky tap",
    trade: "plumbing",
    clientId: "c1",
    tradespersonId: "tp1",
  } as unknown as WithId<JobDoc>;
}

function mountTab(opts: {
  status: JobStatus;
  isTradie?: boolean;
  invoiceId?: string | null;
  invoiceStatus?: InvoiceStatus | null;
}) {
  const isTradie = opts.isTradie ?? true;
  return mount(InvoiceTab, {
    props: {
      job: job(opts.status),
      isClient: !isTradie,
      isTradie,
      invoiceId: opts.invoiceId ?? null,
      invoiceStatus: opts.invoiceStatus ?? null,
      creatingInvoice: false,
      invoicePayable: false,
      markingPaid: false,
      resolvedTradespersonName: "Pat",
      resolvedClientName: "Sam",
    },
    global: { stubs: STUBS },
  });
}

const hasNewInvoice = (w: ReturnType<typeof mountTab>) =>
  w.findAll("button").some((b) => b.text() === "New invoice");

describe("InvoiceTab — manual invoice creation", () => {
  // The point of the feature: an invoice you can start before there's a quote
  // or a single logged hour.
  it.each<JobStatus>(["requested", "quoted", "accepted", "awaiting_upfront_payment", "in_progress", "on_hold"])(
    "offers a blank invoice on a live job (%s)",
    (status) => {
      expect(hasNewInvoice(mountTab({ status }))).toBe(true);
    },
  );

  // Past these the editor is read-only (lockedStatuses), so minting a draft
  // would hand the tradesperson something they could never fill in. The
  // createManualInvoice callable enforces the same set server-side.
  it.each<JobStatus>(["awaiting_client_approval", "awaiting_payment", "complete", "reviewed", "cancelled"])(
    "withholds it once the job is locked (%s)",
    (status) => {
      expect(hasNewInvoice(mountTab({ status }))).toBe(false);
    },
  );

  it("withdraws the offer once an invoice exists — the editor takes over", () => {
    const w = mountTab({ status: "in_progress", invoiceId: "job1", invoiceStatus: "draft" });
    expect(hasNewInvoice(w)).toBe(false);
    expect(w.find(".stub-editor").exists()).toBe(true);
  });

  it("never offers it to the client", () => {
    expect(hasNewInvoice(mountTab({ status: "in_progress", isTradie: false }))).toBe(false);
  });

  it("emits create-manual-invoice when tapped", async () => {
    const w = mountTab({ status: "requested" });
    await w.findAll("button").find((b) => b.text() === "New invoice")!.trigger("click");
    expect(w.emitted("create-manual-invoice")).toHaveLength(1);
  });

  it("hands the tradesperson an editable editor on a pre-quote job", () => {
    const w = mountTab({ status: "requested", invoiceId: "job1", invoiceStatus: "draft" });
    expect(w.findComponent(STUBS.InvoiceEditor).props("canEdit")).toBe(true);
  });
});

describe("InvoiceTab — client visibility of a draft", () => {
  // A draft is the tradesperson's private working copy. Before manual invoices
  // a draft always meant "submitted for approval", so the card rendered on the
  // mere existence of an invoice; now a tradie can be drafting mid-job and the
  // client must not see a half-written $0 bill.
  it("hides a mid-job draft from the client", () => {
    const w = mountTab({
      status: "in_progress",
      isTradie: false,
      invoiceId: "job1",
      invoiceStatus: "draft",
    });
    expect(w.find(".stub-client-card").exists()).toBe(false);
    expect(w.text()).toContain("No invoice yet");
  });

  it("shows the draft once it's submitted for approval", () => {
    const w = mountTab({
      status: "awaiting_client_approval",
      isTradie: false,
      invoiceId: "job1",
      invoiceStatus: "draft",
    });
    expect(w.find(".stub-client-card").exists()).toBe(true);
  });

  it("shows an invoice sent straight from the editor, whatever the job status", () => {
    const w = mountTab({
      status: "in_progress",
      isTradie: false,
      invoiceId: "job1",
      invoiceStatus: "sent",
    });
    expect(w.find(".stub-client-card").exists()).toBe(true);
  });
});
