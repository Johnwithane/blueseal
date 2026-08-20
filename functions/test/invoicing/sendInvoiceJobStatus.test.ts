import { describe, it, expect, beforeEach, vi } from "vitest";
import type { FakeFirestore } from "../helpers/fakeFirestore";
import { makeRequest, callFn } from "../helpers/invoke";

// Sending the bill has to move the job to awaiting_payment, because that's the
// only status markJobPaid accepts. Without it, an invoice written by hand on
// the Invoice tab (createManualInvoice deliberately leaves the job
// in_progress) could be sent and paid but the job could never be closed out —
// the tradesperson had to drag the client through the approval flow instead.

const { enqueueMail, notify, postSystemMessage, sendInviteClientJobEmail, save, getSignedUrl } =
  vi.hoisted(() => ({
    enqueueMail: vi.fn(async () => {}),
    notify: vi.fn(async () => {}),
    postSystemMessage: vi.fn(async () => {}),
    sendInviteClientJobEmail: vi.fn(async () => {}),
    save: vi.fn(async () => {}),
    getSignedUrl: vi.fn(async () => ["https://storage.example/invoice.pdf"]),
  }));

vi.mock("firebase-admin/firestore", () => ({
  FieldValue: { serverTimestamp: () => "__serverTimestamp__" },
}));
vi.mock("../../src/lib/admin", async () => {
  const { FakeFirestore } = await import("../helpers/fakeFirestore");
  return {
    db: new FakeFirestore(),
    storage: { bucket: () => ({ file: () => ({ save, getSignedUrl }) }) },
  };
});
vi.mock("../../src/lib/mail", () => ({ enqueueMail }));
vi.mock("../../src/lib/notify", () => ({ notify }));
vi.mock("../../src/lib/chatSystemMessage", () => ({ postSystemMessage }));
vi.mock("../../src/jobs/inviteHelpers", () => ({ sendInviteClientJobEmail }));

import { sendInvoice } from "../../src/invoicing/sendInvoice";
import { db } from "../../src/lib/admin";
const fakeDb = db as unknown as FakeFirestore;

const JOB = "job1";
const TRADIE = "tradie1";

function seed(jobStatus: string, over: { invoice?: Record<string, unknown> } = {}): void {
  fakeDb.seed(`invoices/${JOB}`, {
    invoiceNumber: "INV-2026-0001",
    tradespersonId: TRADIE,
    clientId: "client1",
    jobId: JOB,
    lineItems: [{ description: "Callout", quantity: 1, unitPrice: 12500, taxRate: 0 }],
    subtotal: 12500,
    taxTotal: 0,
    total: 12500,
    currency: "CAD",
    paymentInstructions: "",
    status: "draft",
    ...over.invoice,
  });
  fakeDb.seed(`jobs/${JOB}`, {
    tradespersonId: TRADIE,
    clientId: "client1",
    status: jobStatus,
    chatId: "chat1",
  });
  fakeDb.seed(`tradespeople/${TRADIE}`, {
    payouts: { stripeAccountId: "acct_1", payoutsEnabled: true, onboardingStatus: "enabled" },
  });
  fakeDb.seed(`users/${TRADIE}`, { displayName: "Dana Tradie" });
  fakeDb.seed("users/client1", { displayName: "Sam Client", email: "sam@example.com" });
}

const req = makeRequest({ data: { invoiceId: JOB }, uid: TRADIE, role: "tradesperson" });

describe("sendInvoice → job status", () => {
  beforeEach(() => {
    fakeDb.reset();
    vi.clearAllMocks();
    getSignedUrl.mockResolvedValue(["https://storage.example/invoice.pdf"]);
  });

  it("moves an in-progress job to awaiting_payment so it can be closed out", async () => {
    seed("in_progress");
    await callFn(sendInvoice, req);

    expect(fakeDb.peek(`jobs/${JOB}`)?.status).toBe("awaiting_payment");
    expect(fakeDb.peek(`invoices/${JOB}`)?.status).toBe("sent");
  });

  it("posts the invoice chat line itself (onJobUpdated suppresses its generic one)", async () => {
    seed("in_progress");
    await callFn(sendInvoice, req);

    expect(postSystemMessage).toHaveBeenCalledTimes(1);
    const [chatId, body] = postSystemMessage.mock.calls[0] as [string, string];
    expect(chatId).toBe("chat1");
    expect(body).toContain("INV-2026-0001");
    expect(body).toContain("$125.00");
  });

  it("doesn't rewind a job that's already past in_progress", async () => {
    // A re-send from overdue: the job may already be complete-adjacent, and
    // dropping it back to awaiting_payment would reopen closed work.
    seed("awaiting_payment", { invoice: { status: "overdue" } });
    await callFn(sendInvoice, req);

    expect(fakeDb.peek(`jobs/${JOB}`)?.status).toBe("awaiting_payment");
    expect(postSystemMessage).not.toHaveBeenCalled();
  });

  it("still sends the invoice when there's no job doc to advance", async () => {
    // Seed everything except the job — batch.update on a missing doc would
    // throw, so the guard has to be on the job actually existing.
    seed("in_progress");
    (fakeDb as unknown as { _delete(p: string): void })._delete(`jobs/${JOB}`);

    await callFn(sendInvoice, req);
    expect(fakeDb.peek(`invoices/${JOB}`)?.status).toBe("sent");
    expect(enqueueMail).toHaveBeenCalled();
  });
});
