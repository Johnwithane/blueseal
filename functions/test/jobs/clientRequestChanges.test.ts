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

import { clientRequestChanges } from "../../src/jobs/clientRequestChanges";
import { db } from "../../src/lib/admin";
const fakeDb = db as unknown as FakeFirestore;

const JOB = "job1";

const req = (
  over: Partial<{ uid: string | null; role: string; roles: string[]; jobId: string; reason: string }> = {},
) =>
  makeRequest({
    data: {
      jobId: over.jobId ?? JOB,
      reason: over.reason ?? "Please fix the tiling in the bathroom.",
    },
    uid: "uid" in over ? over.uid : "client1",
    role: over.role,
    roles: over.roles,
  });

function seedJob(over: Record<string, unknown> = {}): void {
  fakeDb.seed(`jobs/${JOB}`, {
    tradespersonId: "tradie1",
    clientId: "client1",
    status: "awaiting_client_approval",
    chatId: "chat1",
    ...over,
  });
}

describe("clientRequestChanges (kick back to tradesperson)", () => {
  beforeEach(() => {
    fakeDb.reset();
    notify.mockClear();
    postSystemMessage.mockClear();
  });

  it("rejects an unauthenticated caller", async () => {
    await expectHttpsError(callFn(clientRequestChanges, req({ uid: null })), "unauthenticated");
  });

  it("rejects a tradesperson role", async () => {
    await expectHttpsError(
      callFn(clientRequestChanges, req({ uid: "t1", role: "tradesperson" })),
      "permission-denied",
    );
  });

  it("rejects invalid input — missing reason", async () => {
    await expectHttpsError(
      callFn(
        clientRequestChanges,
        makeRequest({ data: { jobId: JOB }, uid: "client1", role: "client" }),
      ),
      "invalid-argument",
    );
  });

  it("rejects invalid input — empty reason", async () => {
    await expectHttpsError(
      callFn(
        clientRequestChanges,
        makeRequest({ data: { jobId: JOB, reason: "   " }, uid: "client1", role: "client" }),
      ),
      "invalid-argument",
    );
  });

  it("rejects a missing job", async () => {
    await expectHttpsError(callFn(clientRequestChanges, req({ role: "client" })), "not-found");
  });

  it("rejects a job the caller doesn't own", async () => {
    seedJob({ clientId: "someone-else" });
    await expectHttpsError(callFn(clientRequestChanges, req({ role: "client" })), "permission-denied");
  });

  it("rejects when job is not awaiting client approval", async () => {
    seedJob({ status: "in_progress" });
    await expectHttpsError(
      callFn(clientRequestChanges, req({ role: "client" })),
      "failed-precondition",
    );
  });

  it("reverts job to in_progress and stamps change fields", async () => {
    seedJob();
    const res = await callFn(clientRequestChanges, req({ role: "client" }));

    expect(res).toEqual({ ok: true });
    const job = fakeDb.peek(`jobs/${JOB}`);
    expect(job?.status).toBe("in_progress");
    expect(job?.clientApprovalRequestedAt).toBeNull();
    expect(job?.clientChangesRequestedAt).toBe("__serverTimestamp__");
    expect(job?.clientChangesRequestedReason).toBe("Please fix the tiling in the bathroom.");
  });

  it("posts a system message with the reason", async () => {
    seedJob();
    await callFn(clientRequestChanges, req({ role: "client" }));

    expect(postSystemMessage).toHaveBeenCalledOnce();
    expect(postSystemMessage).toHaveBeenCalledWith(
      "chat1",
      expect.stringContaining("Please fix the tiling in the bathroom."),
    );
  });

  it("notifies the tradesperson with high priority", async () => {
    seedJob();
    await callFn(clientRequestChanges, req({ role: "client" }));

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

  it("accepts multi-role `roles` claim", async () => {
    seedJob();
    const res = await callFn(clientRequestChanges, req({ roles: ["client", "tradesperson"] }));
    expect(res).toEqual({ ok: true });
  });

  it("truncates a very long reason in the notification body", async () => {
    seedJob();
    const longReason = "x".repeat(250);
    await callFn(
      clientRequestChanges,
      makeRequest({ data: { jobId: JOB, reason: longReason }, uid: "client1", role: "client" }),
    );
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({ body: expect.stringMatching(/\.{3}$/) }),
    );
  });
});
