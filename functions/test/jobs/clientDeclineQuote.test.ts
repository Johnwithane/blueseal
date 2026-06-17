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

import { clientDeclineQuote } from "../../src/jobs/clientDeclineQuote";
import { db } from "../../src/lib/admin";
const fakeDb = db as unknown as FakeFirestore;

const JOB = "job1";

const req = (
  over: Partial<{ uid: string | null; role: string; jobId: string; reason: string }> = {},
) =>
  makeRequest({
    data: {
      jobId: over.jobId ?? JOB,
      reason: over.reason ?? "Price seems too high, can we discuss?",
    },
    uid: "uid" in over ? over.uid : "client1",
    role: over.role,
  });

function seedJob(over: Record<string, unknown> = {}): void {
  fakeDb.seed(`jobs/${JOB}`, {
    tradespersonId: "tradie1",
    clientId: "client1",
    status: "quoted",
    chatId: "chat1",
    ...over,
  });
}

function seedQuote(over: Record<string, unknown> = {}): void {
  fakeDb.seed(`quotes/${JOB}`, {
    quoteNumber: "QTE-2026-0001",
    status: "sent",
    ...over,
  });
}

describe("clientDeclineQuote (discuss / decline quote)", () => {
  beforeEach(() => {
    fakeDb.reset();
    notify.mockClear();
    postSystemMessage.mockClear();
  });

  it("rejects an unauthenticated caller", async () => {
    await expectHttpsError(callFn(clientDeclineQuote, req({ uid: null })), "unauthenticated");
  });

  it("rejects a tradesperson role", async () => {
    await expectHttpsError(
      callFn(clientDeclineQuote, req({ uid: "t1", role: "tradesperson" })),
      "permission-denied",
    );
  });

  it("rejects invalid input — missing reason", async () => {
    await expectHttpsError(
      callFn(
        clientDeclineQuote,
        makeRequest({ data: { jobId: JOB }, uid: "client1", role: "client" }),
      ),
      "invalid-argument",
    );
  });

  it("rejects invalid input — empty reason (trimmed)", async () => {
    await expectHttpsError(
      callFn(
        clientDeclineQuote,
        makeRequest({ data: { jobId: JOB, reason: "   " }, uid: "client1", role: "client" }),
      ),
      "invalid-argument",
    );
  });

  it("rejects a missing job", async () => {
    await expectHttpsError(callFn(clientDeclineQuote, req({ role: "client" })), "not-found");
  });

  it("rejects a job the caller doesn't own", async () => {
    seedJob({ clientId: "someone-else" });
    seedQuote();
    await expectHttpsError(callFn(clientDeclineQuote, req({ role: "client" })), "permission-denied");
  });

  it("rejects when job is not in quoted status", async () => {
    seedJob({ status: "in_progress" });
    seedQuote();
    await expectHttpsError(callFn(clientDeclineQuote, req({ role: "client" })), "failed-precondition");
  });

  it("rejects when the quote doc is missing", async () => {
    seedJob();
    // no quote seeded
    await expectHttpsError(callFn(clientDeclineQuote, req({ role: "client" })), "not-found");
  });

  it("rejects a quote that is already declined", async () => {
    seedJob();
    seedQuote({ status: "declined" });
    await expectHttpsError(callFn(clientDeclineQuote, req({ role: "client" })), "failed-precondition");
  });

  it("rejects a quote that is already accepted", async () => {
    seedJob();
    seedQuote({ status: "accepted" });
    await expectHttpsError(callFn(clientDeclineQuote, req({ role: "client" })), "failed-precondition");
  });

  it("marks quote declined and stamps timestamps — sent status", async () => {
    seedJob();
    seedQuote({ status: "sent" });
    const res = await callFn(clientDeclineQuote, req({ role: "client" }));

    expect(res).toEqual({ ok: true });

    // Job status must NOT change (stays in "quoted" for re-quote flow)
    const job = fakeDb.peek(`jobs/${JOB}`);
    expect(job?.status).toBe("quoted");

    const quote = fakeDb.peek(`quotes/${JOB}`);
    expect(quote?.status).toBe("declined");
    expect(quote?.declinedAt).toBe("__serverTimestamp__");
    expect(quote?.declinedReason).toBe("Price seems too high, can we discuss?");
  });

  it("marks quote declined — viewed status is also eligible", async () => {
    seedJob();
    seedQuote({ status: "viewed" });
    const res = await callFn(clientDeclineQuote, req({ role: "client" }));

    expect(res).toEqual({ ok: true });
    const quote = fakeDb.peek(`quotes/${JOB}`);
    expect(quote?.status).toBe("declined");
  });

  it("posts a system message that includes the quote number and reason", async () => {
    seedJob();
    seedQuote();
    await callFn(clientDeclineQuote, req({ role: "client" }));

    expect(postSystemMessage).toHaveBeenCalledOnce();
    expect(postSystemMessage).toHaveBeenCalledWith(
      "chat1",
      expect.stringContaining("QTE-2026-0001"),
    );
    expect(postSystemMessage).toHaveBeenCalledWith(
      "chat1",
      expect.stringContaining("Price seems too high, can we discuss?"),
    );
  });

  it("notifies the tradesperson with high priority", async () => {
    seedJob();
    seedQuote();
    await callFn(clientDeclineQuote, req({ role: "client" }));

    expect(notify).toHaveBeenCalledOnce();
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "tradie1",
        recipientRole: "tradesperson",
        priority: "high",
        jobId: JOB,
      }),
    );
  });
});
