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

import { resumeJob } from "../../src/jobs/resumeJob";
import { db } from "../../src/lib/admin";
const fakeDb = db as unknown as FakeFirestore;

const JOB = "job1";

/** resumeJob uses requireAuth — any authenticated party can call it. */
const reqAs = (uid: string | null, jobId = JOB) =>
  makeRequest({ data: { jobId }, uid });

function seedJob(over: Record<string, unknown> = {}): void {
  fakeDb.seed(`jobs/${JOB}`, {
    clientId: "client1",
    tradespersonId: "tradie1",
    status: "on_hold",
    chatId: "chat1",
    title: "Bathroom renovation",
    statusBeforeHold: "in_progress",
    ...over,
  });
}

describe("resumeJob (take job off hold)", () => {
  beforeEach(() => {
    fakeDb.reset();
    notify.mockClear();
    postSystemMessage.mockClear();
  });

  it("rejects an unauthenticated caller", async () => {
    await expectHttpsError(callFn(resumeJob, reqAs(null)), "unauthenticated");
  });

  it("rejects invalid input — missing jobId", async () => {
    await expectHttpsError(
      callFn(resumeJob, makeRequest({ data: {}, uid: "client1" })),
      "invalid-argument",
    );
  });

  it("rejects a missing job", async () => {
    await expectHttpsError(callFn(resumeJob, reqAs("client1")), "not-found");
  });

  it("rejects a non-party caller", async () => {
    seedJob();
    await expectHttpsError(callFn(resumeJob, reqAs("random-uid")), "permission-denied");
  });

  it("rejects when the job is not on hold", async () => {
    seedJob({ status: "in_progress" });
    await expectHttpsError(callFn(resumeJob, reqAs("client1")), "failed-precondition");
  });

  it("restores job to statusBeforeHold when client resumes", async () => {
    seedJob();
    const res = await callFn(resumeJob, reqAs("client1"));

    expect(res).toEqual({ ok: true });
    const job = fakeDb.peek(`jobs/${JOB}`);
    expect(job?.status).toBe("in_progress");
    expect(job?.statusBeforeHold).toBeNull();
  });

  it("restores job to statusBeforeHold when tradesperson resumes", async () => {
    seedJob({ statusBeforeHold: "awaiting_upfront_payment" });
    const res = await callFn(resumeJob, reqAs("tradie1"));

    expect(res).toEqual({ ok: true });
    const job = fakeDb.peek(`jobs/${JOB}`);
    expect(job?.status).toBe("awaiting_upfront_payment");
    expect(job?.statusBeforeHold).toBeNull();
  });

  it("falls back to in_progress when statusBeforeHold is missing", async () => {
    seedJob({ statusBeforeHold: null });
    await callFn(resumeJob, reqAs("client1"));

    const job = fakeDb.peek(`jobs/${JOB}`);
    expect(job?.status).toBe("in_progress");
  });

  it("posts system message to chat", async () => {
    seedJob();
    await callFn(resumeJob, reqAs("client1"));

    expect(postSystemMessage).toHaveBeenCalledOnce();
    expect(postSystemMessage).toHaveBeenCalledWith("chat1", expect.any(String));
  });

  it("notifies the tradesperson when client resumes", async () => {
    seedJob();
    await callFn(resumeJob, reqAs("client1"));

    expect(notify).toHaveBeenCalledOnce();
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "tradie1",
        recipientRole: "tradesperson",
        jobId: JOB,
      }),
    );
  });

  it("notifies the client when tradesperson resumes", async () => {
    seedJob();
    await callFn(resumeJob, reqAs("tradie1"));

    expect(notify).toHaveBeenCalledOnce();
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "client1",
        recipientRole: "client",
        jobId: JOB,
      }),
    );
  });

  it("does not require a specific role claim — any authenticated user on the job passes", async () => {
    seedJob();
    // No role or roles set in the token — requireAuth only checks uid
    const res = await callFn(resumeJob, makeRequest({ data: { jobId: JOB }, uid: "client1" }));
    expect(res).toEqual({ ok: true });
  });
});
