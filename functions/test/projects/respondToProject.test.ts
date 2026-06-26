import { describe, it, expect, beforeEach, vi } from "vitest";
import type { FakeFirestore } from "../helpers/fakeFirestore";
import { makeRequest, callFn, expectHttpsError } from "../helpers/invoke";

const { notify, dispatchScopedPostings } = vi.hoisted(() => ({
  notify: vi.fn(async () => {}),
  dispatchScopedPostings: vi.fn(async () => ({
    postIds: ["post1", "post2"],
    invitedUids: ["t1"],
    unmatchedTrades: [] as string[],
  })),
}));

vi.mock("firebase-admin/firestore", () => ({
  FieldValue: { serverTimestamp: () => "__serverTimestamp__" },
}));
vi.mock("../../src/lib/admin", async () => {
  const { FakeFirestore } = await import("../helpers/fakeFirestore");
  return { db: new FakeFirestore() };
});
vi.mock("../../src/lib/notify", () => ({ notify }));
// Dispatch reads savedTradies/tradespeople + writes scoped postings — covered by
// rules tests + real-Firestore verify; mocked here so the accept path is unit-testable.
vi.mock("../../src/projects/dispatch", () => ({ dispatchScopedPostings }));

import { respondToProject } from "../../src/projects/respondToProject";
import { db } from "../../src/lib/admin";
const fakeDb = db as unknown as FakeFirestore;

const PROJECT = "proj1";
const CLIENT = "client1";
const PM = "pm1";
const ADDRESS = { line1: "14 Elm St", city: "Kelowna", region: "BC", postalCode: "V1Y 1A1" };

const reqAs = (uid: string | null, data: Record<string, unknown> = {}) =>
  makeRequest({
    data: { projectId: PROJECT, response: "accept", address: ADDRESS, ...data },
    uid,
  });

function seedProject(over: Record<string, unknown> = {}): void {
  fakeDb.seed(`projects/${PROJECT}`, {
    projectManagerId: PM,
    clientId: CLIENT,
    label: "Spring turnover",
    status: "claimed",
    jobSpecs: [{ trade: "painter", title: "Repaint", description: "Two coats" }],
    ...over,
  });
  fakeDb.seed(`users/${CLIENT}`, { displayName: "Pat Client" });
}

describe("respondToProject (client accepts / declines)", () => {
  beforeEach(() => {
    fakeDb.reset();
    notify.mockClear();
    dispatchScopedPostings.mockClear();
  });

  it("rejects an unauthenticated caller", async () => {
    await expectHttpsError(callFn(respondToProject, reqAs(null)), "unauthenticated");
  });

  it("rejects invalid input — bad response", async () => {
    await expectHttpsError(
      callFn(respondToProject, reqAs(CLIENT, { response: "maybe" })),
      "invalid-argument",
    );
  });

  it("rejects accept without an address", async () => {
    seedProject();
    await expectHttpsError(
      callFn(respondToProject, reqAs(CLIENT, { address: null })),
      "invalid-argument",
    );
  });

  it("rejects a missing project", async () => {
    await expectHttpsError(callFn(respondToProject, reqAs(CLIENT)), "not-found");
  });

  it("rejects a caller who is not the project's client", async () => {
    seedProject();
    await expectHttpsError(callFn(respondToProject, reqAs("random-uid")), "permission-denied");
  });

  it("rejects when the project is not in 'claimed' status", async () => {
    seedProject({ status: "accepted" });
    await expectHttpsError(callFn(respondToProject, reqAs(CLIENT)), "failed-precondition");
  });

  it("accepts: flips status, stores the address, dispatches, notifies the PM", async () => {
    seedProject();
    const res = await callFn(respondToProject, reqAs(CLIENT, { response: "accept" }));

    expect(res).toEqual({
      status: "accepted",
      jobPostIds: ["post1", "post2"],
      dispatched: true,
      unmatchedTrades: [],
    });
    const project = fakeDb.peek(`projects/${PROJECT}`);
    expect(project?.status).toBe("accepted");
    expect(project?.acceptedAt).toBe("__serverTimestamp__");
    // The client-confirmed address is persisted at accept so a failed dispatch
    // can be re-run without re-prompting. (jobPostIds is written by dispatch,
    // which is mocked here.)
    expect(project?.address).toEqual(ADDRESS);
    expect(dispatchScopedPostings).toHaveBeenCalledOnce();
    expect(dispatchScopedPostings).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: PROJECT, projectManagerId: PM, clientId: CLIENT }),
    );
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({ userId: PM, recipientRole: "projectManager" }),
    );
  });

  it("accepts but reports dispatched:false when dispatch throws (recoverable)", async () => {
    seedProject();
    dispatchScopedPostings.mockRejectedValueOnce(new Error("transient"));
    const res = await callFn(respondToProject, reqAs(CLIENT, { response: "accept" }));

    expect(res).toEqual({
      status: "accepted",
      jobPostIds: [],
      dispatched: false,
      unmatchedTrades: [],
    });
    const project = fakeDb.peek(`projects/${PROJECT}`);
    // Project is accepted with the address stored but no postings — redispatchProject
    // can recover it.
    expect(project?.status).toBe("accepted");
    expect(project?.address).toEqual(ADDRESS);
  });

  it("declines: flips status to declined and notifies the PM", async () => {
    seedProject();
    const res = await callFn(respondToProject, reqAs(CLIENT, { response: "decline" }));

    expect(res).toEqual({ status: "declined" });
    const project = fakeDb.peek(`projects/${PROJECT}`);
    expect(project?.status).toBe("declined");
    expect(project?.declinedAt).toBe("__serverTimestamp__");
    expect(notify).toHaveBeenCalledOnce();
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({ userId: PM, recipientRole: "projectManager" }),
    );
  });

  it("is idempotent — a second accept on an accepted project is rejected", async () => {
    seedProject();
    await callFn(respondToProject, reqAs(CLIENT, { response: "accept" }));
    await expectHttpsError(
      callFn(respondToProject, reqAs(CLIENT, { response: "accept" })),
      "failed-precondition",
    );
  });
});
