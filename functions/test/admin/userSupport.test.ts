import { describe, it, expect, beforeEach, vi } from "vitest";
import type { FakeFirestore } from "../helpers/fakeFirestore";
import { makeRequest, callFn, expectHttpsError } from "../helpers/invoke";

// Admin SDK + side-effect doubles. The callables write the user doc via `db`
// and act on Auth via `adminAuth`; audit/email/rate-limit are seams we assert
// on (and the FakeFirestore can't do collection().add(), which logAdminAction /
// enqueueMail use, so those MUST be mocked).
const adminAuth = vi.hoisted(() => ({
  getUser: vi.fn(),
  updateUser: vi.fn(async () => {}),
  revokeRefreshTokens: vi.fn(async () => {}),
  generatePasswordResetLink: vi.fn(async () => "https://link/reset"),
  generateEmailVerificationLink: vi.fn(async () => "https://link/verify"),
}));
const logAdminAction = vi.hoisted(() => vi.fn(async () => {}));
const deliver = vi.hoisted(() => vi.fn(async () => {}));
const enforceRateLimit = vi.hoisted(() => vi.fn(async () => {}));

vi.mock("firebase-admin/firestore", () => ({
  FieldValue: { serverTimestamp: () => "__serverTimestamp__" },
}));
vi.mock("../../src/lib/admin", async () => {
  const { FakeFirestore } = await import("../helpers/fakeFirestore");
  return { db: new FakeFirestore(), adminAuth };
});
vi.mock("../../src/lib/audit", () => ({ logAdminAction }));
vi.mock("../../src/lib/brandedMail", () => ({ deliver }));
vi.mock("../../src/lib/rateLimit", () => ({ enforceRateLimit }));
vi.mock("../../src/prospects/helpers", () => ({ appBaseUrl: () => "https://app.test" }));

import {
  adminVerifyUserEmail,
  adminSendPasswordReset,
  adminResendVerificationEmail,
  adminSetTempPassword,
  adminSetUserDisabled,
  adminUpdateUserContact,
  adminGetUserAuthState,
  adminSoftDeleteUser,
  adminRestoreUser,
} from "../../src/admin/userSupport";
import { db } from "../../src/lib/admin";
const fakeDb = db as unknown as FakeFirestore;

const ADMIN = "admin_1";
const UID = "u_target";

// A CallableRequest from an admin (role claim) targeting UID by default.
const adminReq = (data: Record<string, unknown> = { targetUid: UID }) =>
  makeRequest({ data, uid: ADMIN, role: "admin" });

function authUser(over: Record<string, unknown> = {}) {
  return {
    uid: UID,
    email: "old@example.com",
    emailVerified: false,
    disabled: false,
    metadata: { lastSignInTime: "Mon, 01 Jan 2026", creationTime: "Sun, 01 Dec 2025" },
    providerData: [{ providerId: "password" }],
    ...over,
  };
}

beforeEach(() => {
  fakeDb.reset();
  adminAuth.getUser.mockResolvedValue(authUser());
  adminAuth.updateUser.mockResolvedValue(undefined);
  adminAuth.revokeRefreshTokens.mockResolvedValue(undefined);
  fakeDb.seed(`users/${UID}`, { email: "old@example.com", emailVerified: false });
});

describe("admin support callables — auth gate + validation", () => {
  it("rejects an unauthenticated caller", async () => {
    await expectHttpsError(
      callFn(adminVerifyUserEmail, makeRequest({ data: { targetUid: UID }, uid: null })),
      "unauthenticated",
    );
  });

  it("rejects a non-admin caller", async () => {
    await expectHttpsError(
      callFn(adminVerifyUserEmail, makeRequest({ data: { targetUid: UID }, uid: "u_x", role: "client" })),
      "permission-denied",
    );
  });

  it("rejects a missing targetUid", async () => {
    await expectHttpsError(callFn(adminVerifyUserEmail, adminReq({})), "invalid-argument");
  });

  it("maps a non-existent Auth user to not-found", async () => {
    adminAuth.getUser.mockRejectedValueOnce(new Error("no such user"));
    await expectHttpsError(callFn(adminVerifyUserEmail, adminReq()), "not-found");
  });
});

describe("adminVerifyUserEmail", () => {
  it("flips Auth + Firestore emailVerified and audits", async () => {
    const res = await callFn(adminVerifyUserEmail, adminReq());
    expect(res).toEqual({ ok: true });
    expect(adminAuth.updateUser).toHaveBeenCalledWith(UID, { emailVerified: true });
    expect(fakeDb.peek(`users/${UID}`)).toMatchObject({ emailVerified: true });
    expect(logAdminAction).toHaveBeenCalledWith(
      expect.objectContaining({ action: "adminVerifyUserEmail", actorUid: ADMIN, targetId: UID }),
    );
  });
});

describe("adminSendPasswordReset / adminResendVerificationEmail", () => {
  it("sends a branded reset email", async () => {
    await callFn(adminSendPasswordReset, adminReq());
    expect(adminAuth.generatePasswordResetLink).toHaveBeenCalled();
    expect(deliver).toHaveBeenCalledWith(expect.objectContaining({ to: "old@example.com" }));
  });

  it("refuses to resend verification when already verified", async () => {
    adminAuth.getUser.mockResolvedValue(authUser({ emailVerified: true }));
    await expectHttpsError(callFn(adminResendVerificationEmail, adminReq()), "failed-precondition");
    expect(deliver).not.toHaveBeenCalled();
  });

  it("refuses when the account has no email", async () => {
    adminAuth.getUser.mockResolvedValue(authUser({ email: undefined }));
    await expectHttpsError(callFn(adminSendPasswordReset, adminReq()), "failed-precondition");
  });
});

describe("adminSetTempPassword", () => {
  it("sets a password, revokes tokens, returns it once, and never logs it", async () => {
    const res = (await callFn(adminSetTempPassword, adminReq())) as { ok: true; tempPassword: string };
    expect(res.ok).toBe(true);
    expect(res.tempPassword).toMatch(/^[A-Za-z2-9]{16}$/);
    expect(adminAuth.updateUser).toHaveBeenCalledWith(UID, { password: res.tempPassword });
    expect(adminAuth.revokeRefreshTokens).toHaveBeenCalledWith(UID);
    // The password must never reach the audit log.
    const auditArg = logAdminAction.mock.calls[0]?.[0];
    expect(JSON.stringify(auditArg)).not.toContain(res.tempPassword);
    expect(auditArg).toMatchObject({ action: "adminSetTempPassword" });
  });
});

describe("adminSetUserDisabled", () => {
  it("blocks an admin from suspending their own account", async () => {
    await expectHttpsError(
      callFn(adminSetUserDisabled, makeRequest({ data: { targetUid: ADMIN, disabled: true }, uid: ADMIN, role: "admin" })),
      "failed-precondition",
    );
    expect(adminAuth.updateUser).not.toHaveBeenCalled();
  });

  it("disables Auth, revokes tokens, and mirrors disabledAt/reason", async () => {
    await callFn(adminSetUserDisabled, adminReq({ targetUid: UID, disabled: true, reason: "chargeback fraud" }));
    expect(adminAuth.updateUser).toHaveBeenCalledWith(UID, { disabled: true });
    expect(adminAuth.revokeRefreshTokens).toHaveBeenCalledWith(UID);
    expect(fakeDb.peek(`users/${UID}`)).toMatchObject({
      disabledAt: "__serverTimestamp__",
      disabledReason: "chargeback fraud",
    });
  });

  it("clears the mirror on restore (enable) without revoking", async () => {
    fakeDb.seed(`users/${UID}`, { disabledAt: "__serverTimestamp__", disabledReason: "x" });
    await callFn(adminSetUserDisabled, adminReq({ targetUid: UID, disabled: false }));
    expect(adminAuth.updateUser).toHaveBeenCalledWith(UID, { disabled: false });
    expect(adminAuth.revokeRefreshTokens).not.toHaveBeenCalled();
    expect(fakeDb.peek(`users/${UID}`)).toMatchObject({ disabledAt: null, disabledReason: null });
  });
});

describe("adminUpdateUserContact", () => {
  it("rejects an empty update", async () => {
    await expectHttpsError(callFn(adminUpdateUserContact, adminReq({ targetUid: UID })), "invalid-argument");
  });

  it("maps email-already-exists and does NOT touch Firestore (auth-first)", async () => {
    adminAuth.updateUser.mockRejectedValueOnce({ code: "auth/email-already-exists" });
    await expectHttpsError(
      callFn(adminUpdateUserContact, adminReq({ targetUid: UID, email: "taken@example.com" })),
      "already-exists",
    );
    expect(fakeDb.peek(`users/${UID}`)).toMatchObject({ email: "old@example.com" });
  });

  it("changes email in Auth then Firestore and marks it unverified", async () => {
    const res = (await callFn(adminUpdateUserContact, adminReq({ targetUid: UID, email: "new@example.com" }))) as {
      emailChanged: boolean;
    };
    expect(res.emailChanged).toBe(true);
    expect(adminAuth.updateUser).toHaveBeenCalledWith(UID, { email: "new@example.com", emailVerified: false });
    expect(fakeDb.peek(`users/${UID}`)).toMatchObject({ email: "new@example.com", emailVerified: false });
  });

  it("updates displayName/phone and mirrors name to the tradesperson profile", async () => {
    fakeDb.seed(`tradespeople/${UID}`, { displayName: "Old Name", isVisible: true });
    await callFn(adminUpdateUserContact, adminReq({ targetUid: UID, displayName: "New Name", phone: "+15875551234" }));
    expect(adminAuth.updateUser).not.toHaveBeenCalled(); // no email change → no Auth write
    expect(fakeDb.peek(`users/${UID}`)).toMatchObject({ displayName: "New Name", phone: "+15875551234" });
    expect(fakeDb.peek(`tradespeople/${UID}`)).toMatchObject({ displayName: "New Name" });
  });
});

describe("adminGetUserAuthState", () => {
  it("returns the authoritative Auth fields", async () => {
    adminAuth.getUser.mockResolvedValue(
      authUser({ emailVerified: true, disabled: true, providerData: [{ providerId: "google.com" }] }),
    );
    const res = (await callFn(adminGetUserAuthState, adminReq())) as Record<string, unknown>;
    expect(res).toMatchObject({
      ok: true,
      email: "old@example.com",
      emailVerified: true,
      disabled: true,
      providerIds: ["google.com"],
    });
  });
});

describe("adminSoftDeleteUser / adminRestoreUser", () => {
  it("blocks an admin from deleting their own account", async () => {
    fakeDb.seed(`users/${ADMIN}`, {});
    await expectHttpsError(
      callFn(adminSoftDeleteUser, makeRequest({ data: { targetUid: ADMIN }, uid: ADMIN, role: "admin" })),
      "failed-precondition",
    );
  });

  it("sets deletedAt, hides the tradesperson profile, and revokes tokens", async () => {
    fakeDb.seed(`users/${UID}`, { email: "old@example.com" });
    fakeDb.seed(`tradespeople/${UID}`, { isVisible: true });
    const res = (await callFn(adminSoftDeleteUser, adminReq())) as { alreadyPending: boolean };
    expect(res.alreadyPending).toBe(false);
    expect(fakeDb.peek(`users/${UID}`)).toMatchObject({ deletedAt: "__serverTimestamp__" });
    expect(fakeDb.peek(`tradespeople/${UID}`)).toMatchObject({ isVisible: false });
    expect(adminAuth.revokeRefreshTokens).toHaveBeenCalledWith(UID);
  });

  it("is idempotent when already pending deletion", async () => {
    fakeDb.seed(`users/${UID}`, { deletedAt: "__serverTimestamp__" });
    const res = (await callFn(adminSoftDeleteUser, adminReq())) as { alreadyPending: boolean };
    expect(res.alreadyPending).toBe(true);
  });

  it("restore clears deletedAt", async () => {
    fakeDb.seed(`users/${UID}`, { deletedAt: "__serverTimestamp__" });
    await callFn(adminRestoreUser, adminReq());
    expect(fakeDb.peek(`users/${UID}`)).toMatchObject({ deletedAt: null });
  });

  it("restore on a missing user is not-found", async () => {
    fakeDb.reset();
    await expectHttpsError(callFn(adminRestoreUser, adminReq()), "not-found");
  });
});
