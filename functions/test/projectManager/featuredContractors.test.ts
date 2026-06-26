import { describe, it, expect, beforeEach, vi } from "vitest";
import type { FakeFirestore } from "../helpers/fakeFirestore";
import { makeRequest, callFn, expectHttpsError } from "../helpers/invoke";

const { notify } = vi.hoisted(() => ({ notify: vi.fn(async () => {}) }));

vi.mock("firebase-admin/firestore", () => ({
  FieldValue: { serverTimestamp: () => "__serverTimestamp__" },
}));
vi.mock("../../src/lib/admin", async () => {
  const { FakeFirestore } = await import("../helpers/fakeFirestore");
  return { db: new FakeFirestore() };
});
vi.mock("../../src/lib/notify", () => ({ notify }));

import { setFeaturedContractor, setPmFeatureOptOut } from "../../src/projectManager/featuredContractors";
import { db } from "../../src/lib/admin";
const fakeDb = db as unknown as FakeFirestore;

const PM = "pm1";
const TRADIE = "tradie1";
const PM_ROLES = ["client", "projectManager"];

function seedBase() {
  fakeDb.seed(`users/${PM}`, { projectManager: { active: true } });
  fakeDb.seed(`projectManagers/${PM}`, { companyName: "Elm Group", featuredContractors: [] });
  fakeDb.seed(`users/${PM}/savedTradies/${TRADIE}`, { createdAt: "x" });
  fakeDb.seed(`tradespeople/${TRADIE}`, {
    isVisible: true,
    displayName: "Dana Tradie",
    photoURL: null,
    trades: ["plumber"],
  });
}

const pmReq = (data: Record<string, unknown>) => makeRequest({ data, uid: PM, roles: PM_ROLES });
const tradieReq = (data: Record<string, unknown>) =>
  makeRequest({ data, uid: TRADIE, roles: ["tradesperson"] });

describe("setFeaturedContractor", () => {
  beforeEach(() => {
    fakeDb.reset();
    notify.mockClear();
  });

  it("rejects a non-PM caller", async () => {
    await expectHttpsError(
      callFn(setFeaturedContractor, makeRequest({ data: { tradieId: TRADIE, featured: true }, uid: "x", roles: ["client"] })),
      "permission-denied",
    );
  });

  it("features a saved, visible contractor: denormalizes, indexes, notifies", async () => {
    seedBase();
    const res = await callFn(setFeaturedContractor, pmReq({ tradieId: TRADIE, featured: true }));
    expect(res).toEqual({ ok: true });

    const featured = fakeDb.peek(`projectManagers/${PM}`)?.featuredContractors as Array<{ tradieId: string }>;
    expect(featured).toHaveLength(1);
    expect(featured[0]).toMatchObject({ tradieId: TRADIE, displayName: "Dana Tradie", trades: ["plumber"] });
    expect(fakeDb.peek(`users/${TRADIE}/featuredByPms/${PM}`)).toMatchObject({ pmName: "Elm Group" });
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({ userId: TRADIE, type: "pm_featured", recipientRole: "tradesperson" }),
    );
  });

  it("refuses to feature a contractor who opted out", async () => {
    seedBase();
    fakeDb.seed(`users/${TRADIE}/pmFeatureOptOuts/${PM}`, { optedOutAt: "x" });
    await expectHttpsError(callFn(setFeaturedContractor, pmReq({ tradieId: TRADIE, featured: true })), "failed-precondition");
  });

  it("refuses to feature a contractor the PM hasn't saved", async () => {
    seedBase();
    fakeDb.reset();
    fakeDb.seed(`users/${PM}`, { projectManager: { active: true } });
    fakeDb.seed(`projectManagers/${PM}`, { featuredContractors: [] });
    fakeDb.seed(`tradespeople/${TRADIE}`, { isVisible: true });
    await expectHttpsError(callFn(setFeaturedContractor, pmReq({ tradieId: TRADIE, featured: true })), "failed-precondition");
  });

  it("refuses to feature a non-visible tradesperson", async () => {
    seedBase();
    fakeDb.seed(`tradespeople/${TRADIE}`, { isVisible: false });
    await expectHttpsError(callFn(setFeaturedContractor, pmReq({ tradieId: TRADIE, featured: true })), "failed-precondition");
  });

  it("unfeatures: removes from the list + clears the reverse index", async () => {
    seedBase();
    fakeDb.seed(`projectManagers/${PM}`, {
      companyName: "Elm Group",
      featuredContractors: [{ tradieId: TRADIE, displayName: "Dana", photoURL: null, trades: ["plumber"] }],
    });
    fakeDb.seed(`users/${TRADIE}/featuredByPms/${PM}`, { pmName: "Elm Group" });

    await callFn(setFeaturedContractor, pmReq({ tradieId: TRADIE, featured: false }));
    expect(fakeDb.peek(`projectManagers/${PM}`)?.featuredContractors).toEqual([]);
    expect(fakeDb.peek(`users/${TRADIE}/featuredByPms/${PM}`)).toBeUndefined();
  });
});

describe("setPmFeatureOptOut", () => {
  beforeEach(() => fakeDb.reset());

  it("opting out writes the tombstone + pulls them off the PM's profile", async () => {
    fakeDb.seed(`projectManagers/${PM}`, {
      featuredContractors: [{ tradieId: TRADIE, displayName: "Dana", photoURL: null, trades: [] }],
    });
    fakeDb.seed(`users/${TRADIE}/featuredByPms/${PM}`, { pmName: "Elm Group" });

    const res = await callFn(setPmFeatureOptOut, tradieReq({ pmId: PM, optedOut: true }));
    expect(res).toEqual({ ok: true });
    expect(fakeDb.peek(`users/${TRADIE}/pmFeatureOptOuts/${PM}`)).toMatchObject({ optedOutAt: "__serverTimestamp__" });
    expect(fakeDb.peek(`projectManagers/${PM}`)?.featuredContractors).toEqual([]);
    expect(fakeDb.peek(`users/${TRADIE}/featuredByPms/${PM}`)).toBeUndefined();
  });

  it("opting back in clears the tombstone (does not re-feature)", async () => {
    fakeDb.seed(`users/${TRADIE}/pmFeatureOptOuts/${PM}`, { optedOutAt: "x" });
    await callFn(setPmFeatureOptOut, tradieReq({ pmId: PM, optedOut: false }));
    expect(fakeDb.peek(`users/${TRADIE}/pmFeatureOptOuts/${PM}`)).toBeUndefined();
  });
});
