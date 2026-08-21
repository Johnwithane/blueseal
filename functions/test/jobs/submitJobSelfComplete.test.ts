import { describe, it, expect, beforeEach, vi } from "vitest";
import type { FakeFirestore } from "../helpers/fakeFirestore";
import { makeRequest, callFn } from "../helpers/invoke";

// The wrap-up sheet's "finish without client approval" opt-out. A tradesperson
// running a job end-to-end (their own client, cash or e-transfer) would
// otherwise park the job in awaiting_client_approval forever, waiting on a tap
// that is never coming — and markJobPaid only accepts awaiting_payment, so the
// job could never be completed at all.

const { notify, postSystemMessage } = vi.hoisted(() => ({
  notify: vi.fn(async () => {}),
  postSystemMessage: vi.fn(async () => {}),
}));

vi.mock("firebase-admin/firestore", () => ({
  FieldValue: { serverTimestamp: () => "__serverTimestamp__" },
  Timestamp: { now: () => ({ toMillis: () => 1_700_000_000_000 }) },
}));
vi.mock("../../src/lib/admin", async () => {
  const { FakeFirestore } = await import("../helpers/fakeFirestore");
  return { db: new FakeFirestore() };
});
vi.mock("../../src/lib/notify", () => ({ notify }));
vi.mock("../../src/lib/chatSystemMessage", () => ({ postSystemMessage }));

import { submitJobForApproval } from "../../src/jobs/submitJobForApproval";
import { db } from "../../src/lib/admin";
const fakeDb = db as unknown as FakeFirestore;

const JOB = "job1";
const TRADIE = "tradie1";

function seed(clientId: string | null, status = "in_progress"): void {
  fakeDb.seed(`jobs/${JOB}`, {
    tradespersonId: TRADIE,
    clientId,
    title: "Kitchen tap",
    status,
    chatId: "chat1",
    billingType: "fixed",
    defaultTaxRate: 0,
  });
  fakeDb.seed(`tradespeople/${TRADIE}`, {
    displayName: "Dana Tradie",
    nextInvoiceNumber: 7,
    invoicePrefix: "INV",
    paymentInstructions: "",
  });
}

// One free-form line so there's something to bill.
const LINES = [{ description: "Callout", quantity: 1, unitPrice: 12500, taxRate: 0 }];

const req = (skipClientApproval: boolean) =>
  makeRequest({
    data: { jobId: JOB, extraLineItems: LINES, discount: null, noteToClient: "", skipClientApproval },
    uid: TRADIE,
    role: "tradesperson",
  });

describe("submitJobForApproval → skipClientApproval", () => {
  beforeEach(() => {
    fakeDb.reset();
    vi.clearAllMocks();
  });

  it("routes through the client by default", async () => {
    seed("client1");
    await callFn(submitJobForApproval, req(false));

    expect(fakeDb.peek(`jobs/${JOB}`)?.status).toBe("awaiting_client_approval");
    expect(fakeDb.peek(`invoices/${JOB}`)?.status).toBe("draft");
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({ body: expect.stringContaining("approve") }),
    );
  });

  it("finalizes the invoice and awaits payment when the tradesperson opts out", async () => {
    seed("client1");
    await callFn(submitJobForApproval, req(true));

    const job = fakeDb.peek(`jobs/${JOB}`);
    const invoice = fakeDb.peek(`invoices/${JOB}`);
    expect(job?.status).toBe("awaiting_payment");
    // No approval was requested, so nothing should be waiting on one.
    expect(job?.clientApprovalRequestedAt).toBeNull();
    // "sent", not "draft" — there's no clientApproveJob coming to flip it.
    expect(invoice?.status).toBe("sent");
    expect(invoice?.sentAt).toBe("__serverTimestamp__");
  });

  it("still tells the client their invoice is ready", async () => {
    // Skipping the approval step is not the same as skipping the client: they
    // have a bill to pay and need to hear about it.
    seed("client1");
    await callFn(submitJobForApproval, req(true));

    expect(notify).toHaveBeenCalledTimes(1);
    const arg = notify.mock.calls[0][0] as { userId: string; body: string };
    expect(arg.userId).toBe("client1");
    expect(arg.body).toContain("$125.00");
    expect(arg.body).not.toContain("approve");
  });

  it("treats a job with no client as self-completing regardless of the flag", async () => {
    seed(null);
    await callFn(submitJobForApproval, req(false));

    expect(fakeDb.peek(`jobs/${JOB}`)?.status).toBe("awaiting_payment");
    expect(fakeDb.peek(`invoices/${JOB}`)?.status).toBe("sent");
    // Nobody to notify.
    expect(notify).not.toHaveBeenCalled();
  });

  it("lets a solo job finish from a pre-work status (#28)", async () => {
    // The job never went through quote/accept/start — the work happened
    // off-app and only the paperwork lands here at the end.
    seed(null, "requested");
    await callFn(submitJobForApproval, req(false));

    expect(fakeDb.peek(`jobs/${JOB}`)?.status).toBe("awaiting_payment");
    expect(fakeDb.peek(`invoices/${JOB}`)?.status).toBe("sent");
  });

  it("still requires in_progress when a client is attached", async () => {
    // The approval/payment pipeline is a contract with the other party — a
    // clientful job can't be wrapped up before the work has started, even
    // with the opt-out flag set.
    seed("client1", "requested");
    await expect(callFn(submitJobForApproval, req(true))).rejects.toThrow(/must be in progress/);
    expect(fakeDb.peek(`jobs/${JOB}`)?.status).toBe("requested");
  });
});
