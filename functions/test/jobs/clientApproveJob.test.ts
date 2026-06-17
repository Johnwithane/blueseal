import { describe, it, expect, beforeEach, vi } from "vitest";
import type { FakeFirestore } from "../helpers/fakeFirestore";
import { makeRequest, callFn, expectHttpsError } from "../helpers/invoke";

const { notify, postSystemMessage } = vi.hoisted(() => ({
  notify: vi.fn(async () => {}),
  postSystemMessage: vi.fn(async () => {}),
}));

vi.mock("firebase-admin/firestore", () => ({
  FieldValue: { serverTimestamp: () => "__serverTimestamp__" },
}));
vi.mock("../../src/lib/admin", async () => {
  const { FakeFirestore } = await import("../helpers/fakeFirestore");
  return { db: new FakeFirestore() };
});
vi.mock("../../src/lib/notify", () => ({ notify }));
vi.mock("../../src/lib/chatSystemMessage", () => ({ postSystemMessage }));

import { clientApproveJob } from "../../src/jobs/clientApproveJob";
import { db } from "../../src/lib/admin";
const fakeDb = db as unknown as FakeFirestore;

const JOB = "job1";
const req = (over: Partial<{ uid: string | null; role: string }> = {}) =>
  makeRequest({
    data: { jobId: JOB },
    uid: "uid" in over ? over.uid : "client1",
    role: over.role,
  });

function seed(opts: { job?: Record<string, unknown>; invoice?: Record<string, unknown> | null } = {}): void {
  fakeDb.seed(`jobs/${JOB}`, {
    tradespersonId: "tradie1",
    clientId: "client1",
    status: "awaiting_client_approval",
    chatId: "chat1",
    ...opts.job,
  });
  if (opts.invoice !== null) {
    fakeDb.seed(`invoices/${JOB}`, {
      invoiceNumber: "INV-2026-0001",
      total: 120000,
      status: "draft",
      ...opts.invoice,
    });
  }
}

describe("clientApproveJob (approve work → awaiting_payment)", () => {
  beforeEach(() => fakeDb.reset());

  it("rejects an unauthenticated caller", async () => {
    await expectHttpsError(callFn(clientApproveJob, req({ uid: null })), "unauthenticated");
  });

  it("rejects a non-client role", async () => {
    await expectHttpsError(
      callFn(clientApproveJob, req({ uid: "t1", role: "tradesperson" })),
      "permission-denied",
    );
  });

  it("rejects a missing job", async () => {
    await expectHttpsError(callFn(clientApproveJob, req({ role: "client" })), "not-found");
  });

  it("rejects a job the caller doesn't own", async () => {
    seed({ job: { clientId: "someone-else" } });
    await expectHttpsError(callFn(clientApproveJob, req({ role: "client" })), "permission-denied");
  });

  it("rejects when the job isn't awaiting approval", async () => {
    seed({ job: { status: "in_progress" } });
    await expectHttpsError(callFn(clientApproveJob, req({ role: "client" })), "failed-precondition");
  });

  it("rejects when the invoice is missing", async () => {
    seed({ invoice: null });
    await expectHttpsError(callFn(clientApproveJob, req({ role: "client" })), "not-found");
  });

  it("rejects a zero-total invoice", async () => {
    seed({ invoice: { total: 0 } });
    await expectHttpsError(callFn(clientApproveJob, req({ role: "client" })), "failed-precondition");
  });

  it("transitions job→awaiting_payment + invoice→sent and resets the paid nudge", async () => {
    seed();
    const res = await callFn(clientApproveJob, req({ role: "client" }));

    expect(res).toEqual({ ok: true });
    const job = fakeDb.peek(`jobs/${JOB}`);
    expect(job?.status).toBe("awaiting_payment");
    expect(job?.clientApprovedAt).toBe("__serverTimestamp__");
    // PAY-2: each payment cycle starts clean so a re-invoice doesn't show a
    // stale "client reported paid" from a previous round.
    expect(job?.clientReportedPaidAt).toBeNull();

    const inv = fakeDb.peek(`invoices/${JOB}`);
    expect(inv?.status).toBe("sent");
    expect(inv?.sentAt).toBe("__serverTimestamp__");

    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "tradie1", recipientRole: "tradesperson" }),
    );
  });

  it("does not re-send an invoice that already left draft", async () => {
    seed({ invoice: { status: "sent" } });
    await callFn(clientApproveJob, req({ role: "client" }));
    const inv = fakeDb.peek(`invoices/${JOB}`);
    expect(inv?.status).toBe("sent");
    // sentAt not stamped again (guard only stamps when moving out of draft)
    expect(inv?.sentAt).toBeUndefined();
  });
});
