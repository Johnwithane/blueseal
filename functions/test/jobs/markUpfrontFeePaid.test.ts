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

import { markUpfrontFeePaid } from "../../src/jobs/markUpfrontFeePaid";
import { db } from "../../src/lib/admin";
const fakeDb = db as unknown as FakeFirestore;

const JOB = "job1";

const req = (
  over: Partial<{ uid: string | null; role: string; roles: string[]; jobId: string }> = {},
) =>
  makeRequest({
    data: { jobId: over.jobId ?? JOB },
    uid: "uid" in over ? over.uid : "tradie1",
    role: over.role,
    roles: over.roles,
  });

function seedJob(over: Record<string, unknown> = {}): void {
  fakeDb.seed(`jobs/${JOB}`, {
    tradespersonId: "tradie1",
    clientId: "client1",
    status: "awaiting_upfront_payment",
    chatId: "chat1",
    upfrontFee: {
      amountCents: 50000, // $500.00
      source: "fixed",
      paymentMethod: "manual",
      paidAt: null,
      paidBy: null,
      appliedInvoiceId: null,
    },
    ...over,
  });
}

describe("markUpfrontFeePaid (tradesperson confirms upfront payment received)", () => {
  beforeEach(() => {
    fakeDb.reset();
    notify.mockClear();
    postSystemMessage.mockClear();
  });

  it("rejects an unauthenticated caller", async () => {
    await expectHttpsError(callFn(markUpfrontFeePaid, req({ uid: null })), "unauthenticated");
  });

  it("rejects a client role", async () => {
    await expectHttpsError(
      callFn(markUpfrontFeePaid, req({ uid: "c1", role: "client" })),
      "permission-denied",
    );
  });

  it("rejects invalid input — missing jobId", async () => {
    await expectHttpsError(
      callFn(
        markUpfrontFeePaid,
        makeRequest({ data: {}, uid: "tradie1", role: "tradesperson" }),
      ),
      "invalid-argument",
    );
  });

  it("rejects a missing job", async () => {
    await expectHttpsError(callFn(markUpfrontFeePaid, req({ role: "tradesperson" })), "not-found");
  });

  it("rejects a job the tradesperson doesn't own", async () => {
    seedJob({ tradespersonId: "someone-else" });
    await expectHttpsError(
      callFn(markUpfrontFeePaid, req({ role: "tradesperson" })),
      "permission-denied",
    );
  });

  it("rejects when job is not awaiting upfront payment", async () => {
    seedJob({ status: "in_progress" });
    await expectHttpsError(
      callFn(markUpfrontFeePaid, req({ role: "tradesperson" })),
      "failed-precondition",
    );
  });

  it("rejects when the job has no upfront fee configured", async () => {
    seedJob({ upfrontFee: null });
    await expectHttpsError(
      callFn(markUpfrontFeePaid, req({ role: "tradesperson" })),
      "failed-precondition",
    );
  });

  it("rejects when the upfront fee amount is zero", async () => {
    seedJob({
      upfrontFee: {
        amountCents: 0,
        source: "percent",
        paymentMethod: "manual",
        paidAt: null,
        paidBy: null,
        appliedInvoiceId: null,
      },
    });
    await expectHttpsError(
      callFn(markUpfrontFeePaid, req({ role: "tradesperson" })),
      "failed-precondition",
    );
  });

  it("advances job to in_progress and stamps fee fields", async () => {
    seedJob();
    const res = await callFn(markUpfrontFeePaid, req({ role: "tradesperson" }));

    expect(res).toEqual({ ok: true });
    const job = fakeDb.peek(`jobs/${JOB}`);
    expect(job?.status).toBe("in_progress");
    // Dot-notation updates are stored verbatim by FakeFirestore's merge
    expect(job?.["upfrontFee.paidAt"]).toBe("__serverTimestamp__");
    expect(job?.["upfrontFee.paidBy"]).toBe("tradesperson_marked");
  });

  it("posts a system message mentioning the fee amount", async () => {
    seedJob();
    await callFn(markUpfrontFeePaid, req({ role: "tradesperson" }));

    expect(postSystemMessage).toHaveBeenCalledOnce();
    expect(postSystemMessage).toHaveBeenCalledWith(
      "chat1",
      expect.stringContaining("$500.00"),
    );
  });

  it("notifies the client with normal priority", async () => {
    seedJob();
    await callFn(markUpfrontFeePaid, req({ role: "tradesperson" }));

    expect(notify).toHaveBeenCalledOnce();
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "client1",
        recipientRole: "client",
        priority: "normal",
        jobId: JOB,
      }),
    );
  });

  it("notification body includes the formatted dollar amount", async () => {
    seedJob();
    await callFn(markUpfrontFeePaid, req({ role: "tradesperson" }));

    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({ body: expect.stringContaining("$500.00") }),
    );
  });

  it("accepts multi-role `roles` claim", async () => {
    seedJob();
    const res = await callFn(
      markUpfrontFeePaid,
      req({ roles: ["client", "tradesperson"] }),
    );
    expect(res).toEqual({ ok: true });
  });
});
