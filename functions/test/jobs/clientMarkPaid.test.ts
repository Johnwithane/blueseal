import { describe, it, expect, beforeEach, vi } from "vitest";
import type { FakeFirestore } from "../helpers/fakeFirestore";
import { makeRequest, callFn, expectHttpsError } from "../helpers/invoke";

// Shared mock fns must be created via vi.hoisted so the (hoisted) vi.mock
// factories below can close over them.
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

import { clientMarkPaid } from "../../src/jobs/clientMarkPaid";
import { db } from "../../src/lib/admin";
const fakeDb = db as unknown as FakeFirestore;

const JOB = "job1";
const req = (over: Partial<{ uid: string | null; role: string; roles: string[]; jobId: string }> = {}) =>
  makeRequest({
    data: { jobId: over.jobId ?? JOB },
    uid: "uid" in over ? over.uid : "client1",
    role: over.role,
    roles: over.roles,
  });

function seedJob(over: Record<string, unknown> = {}): void {
  fakeDb.seed(`jobs/${JOB}`, {
    tradespersonId: "tradie1",
    clientId: "client1",
    status: "awaiting_payment",
    chatId: "chat1",
    ...over,
  });
}

describe("clientMarkPaid (offline-payment nudge)", () => {
  beforeEach(() => fakeDb.reset());

  it("rejects an unauthenticated caller", async () => {
    await expectHttpsError(callFn(clientMarkPaid, req({ uid: null })), "unauthenticated");
  });

  it("rejects a non-client role", async () => {
    await expectHttpsError(
      callFn(clientMarkPaid, req({ uid: "t1", role: "tradesperson" })),
      "permission-denied",
    );
  });

  it("rejects invalid input (missing jobId)", async () => {
    await expectHttpsError(
      callFn(clientMarkPaid, makeRequest({ data: {}, uid: "client1", role: "client" })),
      "invalid-argument",
    );
  });

  it("rejects a missing job", async () => {
    await expectHttpsError(callFn(clientMarkPaid, req({ role: "client" })), "not-found");
  });

  it("rejects a job the caller doesn't own", async () => {
    seedJob({ clientId: "someone-else" });
    await expectHttpsError(callFn(clientMarkPaid, req({ role: "client" })), "permission-denied");
  });

  it("rejects when the job isn't awaiting payment", async () => {
    seedJob({ status: "in_progress" });
    await expectHttpsError(callFn(clientMarkPaid, req({ role: "client" })), "failed-precondition");
  });

  it("records the non-authoritative nudge and notifies the tradesperson", async () => {
    seedJob();
    const res = await callFn(clientMarkPaid, req({ role: "client" }));

    expect(res).toEqual({ ok: true });
    const job = fakeDb.peek(`jobs/${JOB}`);
    // PAY-2: the nudge is recorded so both invoice cards can reflect it…
    expect(job?.clientReportedPaidAt).toBe("__serverTimestamp__");
    // …but it must NOT complete the job — markJobPaid stays authoritative.
    expect(job?.status).toBe("awaiting_payment");
    expect(postSystemMessage).toHaveBeenCalledOnce();
    expect(notify).toHaveBeenCalledOnce();
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "tradie1", recipientRole: "tradesperson", priority: "high" }),
    );
  });

  it("accepts the multi-role `roles` claim", async () => {
    seedJob();
    const res = await callFn(clientMarkPaid, req({ roles: ["client", "tradesperson"] }));
    expect(res).toEqual({ ok: true });
  });
});
