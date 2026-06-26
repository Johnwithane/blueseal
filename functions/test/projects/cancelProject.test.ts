import { describe, it, expect, beforeEach, vi } from "vitest";
import type { FakeFirestore } from "../helpers/fakeFirestore";
import { makeRequest, callFn, expectHttpsError } from "../helpers/invoke";

vi.mock("firebase-admin/firestore", () => ({
  FieldValue: { serverTimestamp: () => "__serverTimestamp__" },
}));
vi.mock("../../src/lib/admin", async () => {
  const { FakeFirestore } = await import("../helpers/fakeFirestore");
  return { db: new FakeFirestore() };
});

import { cancelProject } from "../../src/projects/cancelProject";
import { db } from "../../src/lib/admin";
const fakeDb = db as unknown as FakeFirestore;

const PROJECT = "proj1";
const PM = "pm1";
const PM_ROLES = ["client", "projectManager"];

const reqAs = (uid: string | null, roles: string[] = PM_ROLES) =>
  makeRequest({ data: { projectId: PROJECT }, uid, roles });

function seed(status = "invited"): void {
  fakeDb.seed(`projects/${PROJECT}`, {
    projectManagerId: PM,
    status,
    projectInvite: { status: "invited" },
  });
}

describe("cancelProject", () => {
  beforeEach(() => fakeDb.reset());

  it("rejects an unauthenticated caller", async () => {
    await expectHttpsError(callFn(cancelProject, reqAs(null)), "unauthenticated");
  });

  it("rejects a non-PM caller", async () => {
    seed();
    await expectHttpsError(callFn(cancelProject, reqAs(PM, ["client"])), "permission-denied");
  });

  it("rejects a PM who doesn't own the project", async () => {
    seed();
    await expectHttpsError(callFn(cancelProject, reqAs("other-pm")), "permission-denied");
  });

  it("rejects cancelling an accepted project (job board owns it)", async () => {
    seed("accepted");
    await expectHttpsError(callFn(cancelProject, reqAs(PM)), "failed-precondition");
  });

  it("cancels a pending (invited) project + revokes the invite", async () => {
    seed("invited");
    const res = await callFn(cancelProject, reqAs(PM));
    expect(res).toEqual({ ok: true });
    const p = fakeDb.peek(`projects/${PROJECT}`);
    expect(p?.status).toBe("cancelled");
    expect(p?.cancelledAt).toBe("__serverTimestamp__");
    expect((p?.projectInvite as { status?: string })?.status).toBe("revoked");
  });

  it("cancels a claimed project too", async () => {
    seed("claimed");
    const res = await callFn(cancelProject, reqAs(PM));
    expect(res).toEqual({ ok: true });
    expect(fakeDb.peek(`projects/${PROJECT}`)?.status).toBe("cancelled");
  });
});
