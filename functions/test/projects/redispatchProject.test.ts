import { describe, it, expect, beforeEach, vi } from "vitest";
import type { FakeFirestore } from "../helpers/fakeFirestore";
import { makeRequest, callFn, expectHttpsError } from "../helpers/invoke";

const { dispatchScopedPostings } = vi.hoisted(() => ({
  dispatchScopedPostings: vi.fn(async () => ({
    postIds: ["post1"],
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
vi.mock("../../src/projects/dispatch", () => ({ dispatchScopedPostings }));

import { redispatchProject } from "../../src/projects/redispatchProject";
import { db } from "../../src/lib/admin";
const fakeDb = db as unknown as FakeFirestore;

const PROJECT = "proj1";
const CLIENT = "client1";
const PM = "pm1";
const ADDRESS = { line1: "14 Elm St", city: "Kelowna", region: "BC", postalCode: "V1Y 1A1" };

const reqAs = (uid: string | null) => makeRequest({ data: { projectId: PROJECT }, uid });

function seedProject(over: Record<string, unknown> = {}): void {
  fakeDb.seed(`projects/${PROJECT}`, {
    projectManagerId: PM,
    clientId: CLIENT,
    status: "accepted",
    jobSpecs: [{ trade: "painter", title: "Repaint", description: "Two coats" }],
    address: ADDRESS,
    jobPostIds: [],
    ...over,
  });
}

describe("redispatchProject (recover a failed dispatch)", () => {
  beforeEach(() => {
    fakeDb.reset();
    dispatchScopedPostings.mockClear();
  });

  it("rejects an unauthenticated caller", async () => {
    await expectHttpsError(callFn(redispatchProject, reqAs(null)), "unauthenticated");
  });

  it("rejects a stranger (not the client or PM)", async () => {
    seedProject();
    await expectHttpsError(callFn(redispatchProject, reqAs("random")), "permission-denied");
  });

  it("rejects a project that isn't accepted", async () => {
    seedProject({ status: "claimed" });
    await expectHttpsError(callFn(redispatchProject, reqAs(CLIENT)), "failed-precondition");
  });

  it("rejects when the project already has postings (no double-dispatch)", async () => {
    seedProject({ jobPostIds: ["existing"] });
    await expectHttpsError(callFn(redispatchProject, reqAs(PM)), "failed-precondition");
  });

  it("the client can recover an accepted project with no postings", async () => {
    seedProject();
    const res = await callFn(redispatchProject, reqAs(CLIENT));
    expect(res).toEqual({ ok: true, jobPostIds: ["post1"], unmatchedTrades: [] });
    expect(dispatchScopedPostings).toHaveBeenCalledOnce();
  });

  it("the PM can also recover it", async () => {
    seedProject();
    await callFn(redispatchProject, reqAs(PM));
    expect(dispatchScopedPostings).toHaveBeenCalledOnce();
  });
});
