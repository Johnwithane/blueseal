import { describe, it, expect, beforeEach, vi } from "vitest";
import type { FakeFirestore } from "../helpers/fakeFirestore";
import { makeRequest, callFn, expectHttpsError } from "../helpers/invoke";

// Admin SDK doubles: provisionAccount writes the user doc via `db` and mirrors
// roles to claims via `adminAuth`. Recorded so we can assert both.
const { setCustomUserClaims, getUser } = vi.hoisted(() => ({
  setCustomUserClaims: vi.fn(async () => {}),
  getUser: vi.fn(async () => ({ customClaims: {} as Record<string, unknown> })),
}));

vi.mock("firebase-admin/firestore", () => ({
  FieldValue: { serverTimestamp: () => "__serverTimestamp__" },
}));
vi.mock("../../src/lib/admin", async () => {
  const { FakeFirestore } = await import("../helpers/fakeFirestore");
  return { db: new FakeFirestore(), adminAuth: { setCustomUserClaims, getUser } };
});

import { provisionAccount } from "../../src/auth/provisionAccount";
import { db } from "../../src/lib/admin";
const fakeDb = db as unknown as FakeFirestore;

const UID = "u_new";
const base = { displayName: "Jane Doe", termsAcceptedVersion: "2026-01-01" };
const req = (
  over: Partial<{ uid: string | null; data: Record<string, unknown> }> = {},
) =>
  makeRequest({
    data: { role: "client", ...base, ...(over.data ?? {}) },
    uid: "uid" in over ? over.uid : UID,
  });

describe("provisionAccount (server-side account provisioning)", () => {
  beforeEach(() => {
    fakeDb.reset();
    setCustomUserClaims.mockClear();
    getUser.mockClear();
    getUser.mockResolvedValue({ customClaims: {} });
  });

  it("rejects an unauthenticated caller", async () => {
    await expectHttpsError(callFn(provisionAccount, req({ uid: null })), "unauthenticated");
  });

  it("rejects an un-grantable role (admin) at the boundary", async () => {
    await expectHttpsError(
      callFn(provisionAccount, req({ data: { role: "admin" } })),
      "invalid-argument",
    );
  });

  it("rejects a blank display name", async () => {
    await expectHttpsError(
      callFn(provisionAccount, req({ data: { displayName: "" } })),
      "invalid-argument",
    );
  });

  it("creates a client user doc and mirrors the role to claims", async () => {
    const res = await callFn<{ roles: string[]; activeRole: string; isNew: boolean }>(
      provisionAccount,
      req({ data: { role: "client" } }),
    );
    expect(res).toEqual({ roles: ["client"], activeRole: "client", isNew: true });

    const doc = fakeDb.peek(`users/${UID}`);
    expect(doc).toMatchObject({
      roles: ["client"],
      activeRole: "client",
      displayName: "Jane Doe",
      emailVerified: false,
      clientRatingAvg: 0,
      clientRatingCount: 0,
      termsAcceptedVersion: "2026-01-01",
      deletedAt: null,
      createdAt: "__serverTimestamp__",
    });
    expect(setCustomUserClaims).toHaveBeenCalledWith(UID, { roles: ["client"], role: "client" });
  });

  it("gives a tradesperson the implied client role", async () => {
    const res = await callFn<{ roles: string[]; activeRole: string; isNew: boolean }>(
      provisionAccount,
      req({ data: { role: "tradesperson" } }),
    );
    expect(res).toEqual({
      roles: ["tradesperson", "client"],
      activeRole: "tradesperson",
      isNew: true,
    });
    expect(fakeDb.peek(`users/${UID}`)).toMatchObject({
      roles: ["tradesperson", "client"],
      activeRole: "tradesperson",
    });
    expect(setCustomUserClaims).toHaveBeenCalledWith(UID, {
      roles: ["tradesperson", "client"],
      role: "tradesperson",
    });
  });

  it("is idempotent: never clobbers an existing doc or grants a new role", async () => {
    // A returning user / retry: doc already exists as a plain client.
    fakeDb.seed(`users/${UID}`, {
      roles: ["client"],
      activeRole: "client",
      displayName: "Original Name",
      clientRatingAvg: 4.8,
      createdAt: "__original__",
    });
    // Even though the caller asks for tradesperson, the existing doc wins —
    // role changes go through addRoleToSelf, not here.
    const res = await callFn<{ roles: string[]; activeRole: string; isNew: boolean }>(
      provisionAccount,
      req({ data: { role: "tradesperson", displayName: "New Name" } }),
    );
    // isNew false: the doc already existed, so this was an idempotent reconcile.
    expect(res).toEqual({ roles: ["client"], activeRole: "client", isNew: false });

    const doc = fakeDb.peek(`users/${UID}`);
    expect(doc).toMatchObject({
      roles: ["client"],
      activeRole: "client",
      displayName: "Original Name", // untouched
      clientRatingAvg: 4.8, // untouched
      createdAt: "__original__", // untouched
    });
    // Claims reconciled to the doc's authoritative roles, preserving extras.
    expect(setCustomUserClaims).toHaveBeenCalledWith(UID, { roles: ["client"], role: "client" });
  });

  it("preserves additive claims (admin/qa) when reconciling an existing doc", async () => {
    fakeDb.seed(`users/${UID}`, { roles: ["client"], activeRole: "client", displayName: "X" });
    getUser.mockResolvedValue({ customClaims: { admin: true, region: "ON" } });
    await callFn(provisionAccount, req({ data: { role: "client" } }));
    expect(setCustomUserClaims).toHaveBeenCalledWith(UID, {
      admin: true,
      region: "ON",
      roles: ["client"],
      role: "client",
    });
  });

  it("does not fail the call if the claim write transiently errors (trigger backstops)", async () => {
    setCustomUserClaims.mockRejectedValueOnce(new Error("auth/user-not-found"));
    const res = await callFn<{ roles: string[]; activeRole: string; isNew: boolean }>(
      provisionAccount,
      req({ data: { role: "client" } }),
    );
    // Doc still created; call resolves — setRoleOnSignup mirrors claims after.
    expect(res).toEqual({ roles: ["client"], activeRole: "client", isNew: true });
    expect(fakeDb.peek(`users/${UID}`)).toMatchObject({ roles: ["client"] });
  });
});
