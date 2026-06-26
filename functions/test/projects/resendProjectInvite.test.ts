import { describe, it, expect, beforeEach, vi } from "vitest";
import type { FakeFirestore } from "../helpers/fakeFirestore";
import { makeRequest, callFn, expectHttpsError } from "../helpers/invoke";

const { getUser, projectMagicLink, sendProjectInviteEmail, isInviteEmailSuppressed, enforceRateLimit } =
  vi.hoisted(() => ({
    getUser: vi.fn(async () => ({ email: "pm@example.com" })),
    projectMagicLink: vi.fn(async () => "https://app/claim-project?email=x"),
    sendProjectInviteEmail: vi.fn(async () => true),
    isInviteEmailSuppressed: vi.fn(async () => false),
    enforceRateLimit: vi.fn(async () => {}),
  }));

vi.mock("firebase-admin/firestore", () => ({
  FieldValue: { serverTimestamp: () => "__ts__", increment: (n: number) => ({ __inc: n }) },
  Timestamp: { fromMillis: (m: number) => ({ __ms: m }) },
}));
vi.mock("../../src/lib/admin", async () => {
  const { FakeFirestore } = await import("../helpers/fakeFirestore");
  return { db: new FakeFirestore(), adminAuth: { getUser } };
});
vi.mock("../../src/lib/projectManager", () => ({ requirePmActive: vi.fn(async () => ({ active: true })) }));
vi.mock("../../src/lib/rateLimit", () => ({ enforceRateLimit }));
vi.mock("../../src/jobs/inviteHelpers", () => ({ isInviteEmailSuppressed }));
vi.mock("../../src/projects/inviteHelpers", () => ({ projectMagicLink, sendProjectInviteEmail }));
vi.mock("../../src/prospects/helpers", () => ({
  appBaseUrl: () => "https://app",
  emailHashOf: (e: string) => `hash:${e}`,
  sha256: (s: string) => `sha:${s}`,
}));

import { resendProjectInvite } from "../../src/projects/resendProjectInvite";
import { db } from "../../src/lib/admin";
const fakeDb = db as unknown as FakeFirestore;

const PROJECT = "proj1";
const PM = "pm1";

const reqAs = (uid: string | null, data: Record<string, unknown> = {}) =>
  makeRequest({ data: { projectId: PROJECT, ...data }, uid, roles: ["client", "projectManager"] });

function seed(over: Record<string, unknown> = {}): void {
  fakeDb.seed(`projects/${PROJECT}`, {
    projectManagerId: PM,
    status: "invited",
    label: "Spring turnover",
    clientName: "Pat",
    jobSpecs: [{ trade: "painter", title: "x", description: "y" }],
    projectInvite: { emailLower: "client@example.com", status: "invited" },
    ...over,
  });
  fakeDb.seed(`users/${PM}`, { displayName: "Sam PM", projectManager: { active: true } });
}

describe("resendProjectInvite", () => {
  beforeEach(() => {
    fakeDb.reset();
    sendProjectInviteEmail.mockClear();
  });

  it("rejects a PM who doesn't own the project", async () => {
    seed();
    await expectHttpsError(callFn(resendProjectInvite, reqAs("other-pm")), "permission-denied");
  });

  it("rejects resending a non-invited project", async () => {
    seed({ status: "accepted" });
    await expectHttpsError(callFn(resendProjectInvite, reqAs(PM)), "failed-precondition");
  });

  it("blocks redirecting the invite to the PM's own email", async () => {
    seed();
    await expectHttpsError(
      callFn(resendProjectInvite, reqAs(PM, { newEmail: "pm@example.com" })),
      "failed-precondition",
    );
  });

  it("resends to the stored email, bumps resendCount, no new link", async () => {
    seed();
    const res = await callFn(resendProjectInvite, reqAs(PM));
    expect(res.emailed).toBe(true);
    expect(res.inviteLink).toBeNull();
    expect(sendProjectInviteEmail).toHaveBeenCalledOnce();
    const p = fakeDb.peek(`projects/${PROJECT}`);
    expect((p?.projectInvite as { resendCount?: unknown })?.resendCount).toEqual({ __inc: 1 });
  });

  it("re-mints the token + returns a new link when the email is corrected", async () => {
    seed();
    const res = await callFn(resendProjectInvite, reqAs(PM, { newEmail: "right@example.com" }));
    expect(res.inviteLink).toContain("https://app/project-invite/");
    const p = fakeDb.peek(`projects/${PROJECT}`);
    expect((p?.projectInvite as { emailLower?: string })?.emailLower).toBe("right@example.com");
  });
});
