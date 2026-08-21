import { describe, it, expect, beforeEach, vi } from "vitest";
import type { FakeFirestore } from "../helpers/fakeFirestore";
import { makeRequest, callFn, expectHttpsError } from "../helpers/invoke";

// Manual solo status control (issue #29): a tradesperson can hand-move a job
// with no client attached (start work / put on hold). Clientful jobs are
// rejected — their pipeline needs the other party's say.

const { postSystemMessage } = vi.hoisted(() => ({
  postSystemMessage: vi.fn(async () => {}),
}));

vi.mock("firebase-admin/firestore", () => ({
  FieldValue: { serverTimestamp: () => "__serverTimestamp__" },
}));
vi.mock("../../src/lib/admin", async () => {
  const { FakeFirestore } = await import("../helpers/fakeFirestore");
  return { db: new FakeFirestore() };
});
vi.mock("../../src/lib/chatSystemMessage", () => ({ postSystemMessage }));

import { setSoloJobStatus } from "../../src/jobs/setSoloJobStatus";
import { db } from "../../src/lib/admin";
const fakeDb = db as unknown as FakeFirestore;

const JOB = "job1";
const TRADIE = "tradie1";

const req = (target: "in_progress" | "on_hold", uid = TRADIE) =>
  makeRequest({ data: { jobId: JOB, target }, uid, role: "tradesperson" });

function seed(over: Record<string, unknown> = {}): void {
  fakeDb.seed(`jobs/${JOB}`, {
    tradespersonId: TRADIE,
    clientId: null,
    status: "requested",
    chatId: "chat1",
    ...over,
  });
}

describe("setSoloJobStatus", () => {
  beforeEach(() => {
    fakeDb.reset();
    vi.clearAllMocks();
  });

  it("starts a solo job from requested", async () => {
    seed();
    await callFn(setSoloJobStatus, req("in_progress"));

    expect(fakeDb.peek(`jobs/${JOB}`)?.status).toBe("in_progress");
    // The callable owns the chat line — onJobUpdated suppresses its generic one.
    expect(postSystemMessage).toHaveBeenCalledWith("chat1", expect.stringContaining("started"));
  });

  it("puts a running solo job on hold, remembering where it was", async () => {
    seed({ status: "in_progress" });
    await callFn(setSoloJobStatus, req("on_hold"));

    const job = fakeDb.peek(`jobs/${JOB}`);
    expect(job?.status).toBe("on_hold");
    // resumeJob restores this — a hold that forgets its origin can't resume.
    expect(job?.statusBeforeHold).toBe("in_progress");
  });

  it("holds from a pre-work status too, and resume-style restore stays exact", async () => {
    seed({ status: "quoted" });
    await callFn(setSoloJobStatus, req("on_hold"));
    expect(fakeDb.peek(`jobs/${JOB}`)?.statusBeforeHold).toBe("quoted");
  });

  it("rejects a job with a client attached", async () => {
    seed({ clientId: "client1", status: "requested" });
    await expectHttpsError(callFn(setSoloJobStatus, req("in_progress")), "failed-precondition");
    expect(fakeDb.peek(`jobs/${JOB}`)?.status).toBe("requested");
  });

  it("rejects transitions the machine doesn't allow", async () => {
    // Money/terminal statuses can't be hand-moved — completing goes through
    // submitJobForApproval, and a finished job stays finished.
    seed({ status: "awaiting_payment" });
    await expectHttpsError(callFn(setSoloJobStatus, req("in_progress")), "failed-precondition");

    seed({ status: "complete" });
    await expectHttpsError(callFn(setSoloJobStatus, req("on_hold")), "failed-precondition");
  });

  it("rejects a tradesperson who doesn't own the job", async () => {
    seed();
    await expectHttpsError(
      callFn(setSoloJobStatus, req("in_progress", "someone_else")),
      "permission-denied",
    );
  });
});
