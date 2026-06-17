import { describe, it, expect, beforeEach, vi } from "vitest";
import type { FakeFirestore } from "../helpers/fakeFirestore";
import { makeRequest, callFn, expectHttpsError } from "../helpers/invoke";

const logAdminAction = vi.hoisted(() => vi.fn(async () => {}));

vi.mock("../../src/lib/admin", async () => {
  const { FakeFirestore } = await import("../helpers/fakeFirestore");
  return { db: new FakeFirestore() };
});
vi.mock("../../src/lib/audit", () => ({ logAdminAction }));

import { adminModerateContent } from "../../src/admin/moderation";
import { db } from "../../src/lib/admin";
const fakeDb = db as unknown as FakeFirestore;

const admin = (data: Record<string, unknown>) => makeRequest({ data, uid: "admin_1", role: "admin" });

beforeEach(() => fakeDb.reset());

describe("adminModerateContent", () => {
  it("rejects a non-admin", async () => {
    await expectHttpsError(
      callFn(adminModerateContent, makeRequest({ data: { kind: "review", id: "r1", hidden: true }, uid: "u", role: "client" })),
      "permission-denied",
    );
  });

  it("rejects invalid input", async () => {
    await expectHttpsError(callFn(adminModerateContent, admin({ kind: "review", id: "r1" })), "invalid-argument");
  });

  it("404s a missing review", async () => {
    await expectHttpsError(callFn(adminModerateContent, admin({ kind: "review", id: "nope", hidden: true })), "not-found");
  });

  it("hides a review (status -> hidden; rating recompute is best-effort)", async () => {
    fakeDb.seed("reviews/r1", { tradespersonId: "t1", status: "active", rating: 5 });
    await callFn(adminModerateContent, admin({ kind: "review", id: "r1", hidden: true }));
    expect(fakeDb.peek("reviews/r1")).toMatchObject({ status: "hidden" });
    expect(logAdminAction).toHaveBeenCalledWith(expect.objectContaining({ action: "adminHideContent", targetType: "review" }));
  });

  it("recovers a review (status -> active)", async () => {
    fakeDb.seed("reviews/r1", { tradespersonId: "t1", status: "hidden", rating: 2 });
    await callFn(adminModerateContent, admin({ kind: "review", id: "r1", hidden: false }));
    expect(fakeDb.peek("reviews/r1")).toMatchObject({ status: "active" });
  });

  it("hides a job post (status -> admin_hidden, capturing prior status)", async () => {
    fakeDb.seed("jobPosts/p1", { status: "open" });
    await callFn(adminModerateContent, admin({ kind: "jobPost", id: "p1", hidden: true }));
    expect(fakeDb.peek("jobPosts/p1")).toMatchObject({ status: "admin_hidden", statusBeforeHide: "open" });
  });

  it("recovers a job post to its captured prior status", async () => {
    fakeDb.seed("jobPosts/p1", { status: "admin_hidden", statusBeforeHide: "closed" });
    await callFn(adminModerateContent, admin({ kind: "jobPost", id: "p1", hidden: false }));
    expect(fakeDb.peek("jobPosts/p1")).toMatchObject({ status: "closed", statusBeforeHide: null });
  });

  it("404s a missing job post", async () => {
    await expectHttpsError(callFn(adminModerateContent, admin({ kind: "jobPost", id: "nope", hidden: true })), "not-found");
  });
});
