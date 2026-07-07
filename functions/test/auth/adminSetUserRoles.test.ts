import { describe, it, expect, beforeEach, vi } from "vitest";
import type { FakeFirestore } from "../helpers/fakeFirestore";
import { makeRequest, callFn, expectHttpsError } from "../helpers/invoke";

// Admin SDK doubles: adminSetUserRoles reads/writes the target's user doc via
// `db`, mints claims via `adminAuth`, and audits via `logAdminAction`.
const { setCustomUserClaims, getUser } = vi.hoisted(() => ({
  setCustomUserClaims: vi.fn(async () => {}),
  getUser: vi.fn(async () => ({ customClaims: {} as Record<string, unknown> })),
}));
const logAdminAction = vi.hoisted(() => vi.fn(async () => {}));

vi.mock("firebase-admin/firestore", () => ({
  FieldValue: { serverTimestamp: () => "__serverTimestamp__" },
}));
vi.mock("../../src/lib/admin", async () => {
  const { FakeFirestore } = await import("../helpers/fakeFirestore");
  return { db: new FakeFirestore(), adminAuth: { setCustomUserClaims, getUser } };
});
vi.mock("../../src/lib/audit", () => ({ logAdminAction }));

import { adminSetUserRoles } from "../../src/auth/adminSetUserRoles";
import { db } from "../../src/lib/admin";
const fakeDb = db as unknown as FakeFirestore;

const ADMIN_UID = "admin_1";
const TARGET_UID = "u_target";

const req = (
  data: Partial<{ targetUid: string; roles: string[] }> = {},
  opts: { uid?: string; role?: string } = {},
) =>
  makeRequest({
    data: { targetUid: TARGET_UID, roles: ["client"], ...data },
    uid: opts.uid ?? ADMIN_UID,
    role: opts.role ?? "admin",
  });

describe("adminSetUserRoles", () => {
  beforeEach(() => {
    fakeDb.reset();
    setCustomUserClaims.mockClear();
    getUser.mockClear();
    getUser.mockResolvedValue({ customClaims: {} });
    logAdminAction.mockClear();
  });

  it("rejects a non-admin caller", async () => {
    await expectHttpsError(
      callFn(adminSetUserRoles, req({}, { uid: "u_client", role: "client" })),
      "permission-denied",
    );
  });

  it("rejects invalid input (empty roles array)", async () => {
    await expectHttpsError(callFn(adminSetUserRoles, req({ roles: [] })), "invalid-argument");
  });

  it("rejects invalid input (unknown role)", async () => {
    await expectHttpsError(
      callFn(adminSetUserRoles, req({ roles: ["superuser"] as unknown as string[] })),
      "invalid-argument",
    );
  });

  it("refuses to let an admin remove their own admin role", async () => {
    await expectHttpsError(
      callFn(adminSetUserRoles, req({ targetUid: ADMIN_UID, roles: ["client"] }, { uid: ADMIN_UID })),
      "failed-precondition",
    );
  });

  it("404s a target that isn't a real Auth user", async () => {
    getUser.mockRejectedValueOnce(new Error("auth/user-not-found"));
    await expectHttpsError(callFn(adminSetUserRoles, req()), "not-found");
  });

  it("happy path: writes roles + mirrors claims for a normal grant", async () => {
    const res = await callFn<{ ok: boolean; roles: string[]; activeRole: string }>(
      adminSetUserRoles,
      req({ roles: ["client", "tradesperson"] }),
    );
    expect(res).toEqual({ ok: true, roles: ["client", "tradesperson"], activeRole: "client" });

    const doc = fakeDb.peek(`users/${TARGET_UID}`);
    expect(doc).toMatchObject({
      roles: ["client", "tradesperson"],
      activeRole: "client",
      role: "tradesperson", // legacy primaryRole: tradesperson outranks client
    });
    expect(doc?.projectManager).toBeUndefined();
    expect(setCustomUserClaims).toHaveBeenCalledWith(TARGET_UID, {
      roles: ["client", "tradesperson"],
      role: "tradesperson",
    });
    expect(logAdminAction).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUid: ADMIN_UID,
        action: "adminSetUserRoles",
        targetType: "user",
        targetId: TARGET_UID,
      }),
    );
  });

  it("regression: grants projectManager with active:true when the target has no projectManager sub-object yet", async () => {
    // No seeded doc at all — the "brand new grant" case that broke requirePmActive().
    const res = await callFn<{ ok: boolean; roles: string[] }>(
      adminSetUserRoles,
      req({ roles: ["client", "projectManager"] }),
    );
    expect(res.ok).toBe(true);

    const doc = fakeDb.peek(`users/${TARGET_UID}`);
    expect(doc?.projectManager).toEqual({
      referralCode: "",
      active: true,
      liability: null,
      createdAt: "__serverTimestamp__",
    });
  });

  it("does not clobber an existing projectManager sub-object when re-granting the role", async () => {
    const existingPm = {
      referralCode: "ABC123",
      active: true,
      liability: { version: "2026-06-25", signedAt: "__ts__", signatureStoragePath: "sigs/x.png" },
      createdAt: "__original__",
    };
    fakeDb.seed(`users/${TARGET_UID}`, {
      roles: ["client"],
      activeRole: "client",
      projectManager: existingPm,
    });

    await callFn(adminSetUserRoles, req({ roles: ["client", "projectManager"] }));

    const doc = fakeDb.peek(`users/${TARGET_UID}`);
    expect(doc?.projectManager).toEqual(existingPm); // referralCode/liability survive untouched
  });

  it("does not add a projectManager field when the grant excludes projectManager", async () => {
    await callFn(adminSetUserRoles, req({ roles: ["client", "tradesperson"] }));
    const doc = fakeDb.peek(`users/${TARGET_UID}`);
    expect(doc?.projectManager).toBeUndefined();
  });
});
