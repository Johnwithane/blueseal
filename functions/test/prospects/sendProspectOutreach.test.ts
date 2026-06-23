import { describe, it, expect, beforeEach, vi } from "vitest";
import type { FakeFirestore } from "../helpers/fakeFirestore";
import { makeRequest, callFn, expectHttpsError } from "../helpers/invoke";

const generateSignInWithEmailLink = vi.hoisted(() =>
  vi.fn(async () => "https://blueseal.app/claim?link=abc"),
);
const enqueueMail = vi.hoisted(() => vi.fn(async () => {}));
const logAdminAction = vi.hoisted(() => vi.fn(async () => {}));

vi.mock("firebase-admin/firestore", () => ({
  FieldValue: {
    serverTimestamp: () => "__serverTimestamp__",
    increment: (n: number) => `__increment_${n}__`,
  },
  Timestamp: { now: () => ({ toMillis: () => 1000 }) },
}));
vi.mock("../../src/lib/admin", async () => {
  const { FakeFirestore } = await import("../helpers/fakeFirestore");
  return { db: new FakeFirestore(), adminAuth: { generateSignInWithEmailLink } };
});
vi.mock("../../src/lib/mail", () => ({ enqueueMail }));
vi.mock("../../src/lib/audit", () => ({ logAdminAction }));

import { sendProspectOutreach } from "../../src/prospects/sendProspectOutreach";
import { db } from "../../src/lib/admin";
const fakeDb = db as unknown as FakeFirestore;

const admin = (data: Record<string, unknown>) =>
  makeRequest({ data, uid: "admin_1", role: "admin" });

function seedProspect(over: Record<string, unknown> = {}) {
  fakeDb.seed("prospects/p1", {
    displayName: "Dave Smith",
    companyName: "Smith Plumbing Ltd",
    trades: ["plumber"],
    locationLabel: "Vernon, BC",
    status: "listed",
    isListed: false,
    emailHash: "hash1",
    emailConspicuouslyPublished: true,
    dataConsentBasis: "manual_public_lookup",
    source: "Smith Plumbing website",
    outreachCount: 0,
    firstRequestedAt: null,
    ...over,
  });
  fakeDb.seed("prospects/p1/private/contact", {
    prospectEmail: "dave@smithplumbing.ca",
    prospectPhone: null,
    website: null,
  });
}

const validBody = {
  prospectId: "p1",
  subject: "Dave, a free listing for Smith Plumbing",
  bodyLines: ["A free profile for your business", "Hi Dave, I built you a profile."],
};

beforeEach(() => {
  fakeDb.reset();
  generateSignInWithEmailLink.mockClear();
  enqueueMail.mockClear();
  logAdminAction.mockClear();
  process.env.BLUE_SEAL_MAILING_ADDRESS = "123 Main St, Kelowna, BC V1Y 1A1";
  process.env.PROSPECT_UNSUB_SECRET = "test-secret";
});

describe("sendProspectOutreach gates", () => {
  it("rejects a non-admin", async () => {
    await expectHttpsError(
      callFn(sendProspectOutreach, makeRequest({ data: validBody, uid: "u", role: "client" })),
      "permission-denied",
    );
  });

  it("rejects invalid input", async () => {
    await expectHttpsError(
      callFn(sendProspectOutreach, admin({ prospectId: "p1", bodyLines: ["x"] })),
      "invalid-argument",
    );
  });

  it("rejects an already-claimed prospect", async () => {
    seedProspect({ status: "claimed" });
    await expectHttpsError(callFn(sendProspectOutreach, admin(validBody)), "failed-precondition");
    expect(enqueueMail).not.toHaveBeenCalled();
  });

  it("rejects a suppressed prospect", async () => {
    seedProspect({ status: "suppressed" });
    await expectHttpsError(callFn(sendProspectOutreach, admin(validBody)), "failed-precondition");
    expect(enqueueMail).not.toHaveBeenCalled();
  });

  it("refuses to email a non-conspicuous listing (no CASL basis)", async () => {
    seedProspect({ emailConspicuouslyPublished: false });
    await expectHttpsError(callFn(sendProspectOutreach, admin(validBody)), "failed-precondition");
    expect(enqueueMail).not.toHaveBeenCalled();
  });

  it("refuses to email a contact with a suppression tombstone", async () => {
    seedProspect();
    fakeDb.seed("prospectSuppression/hash1", { reason: "unsubscribe", identifier: "hash1" });
    await expectHttpsError(callFn(sendProspectOutreach, admin(validBody)), "failed-precondition");
    expect(enqueueMail).not.toHaveBeenCalled();
  });

  it("refuses to send when CASL config is missing", async () => {
    seedProspect();
    delete process.env.BLUE_SEAL_MAILING_ADDRESS;
    delete process.env.PROSPECT_UNSUB_SECRET;
    await expectHttpsError(callFn(sendProspectOutreach, admin(validBody)), "failed-precondition");
    expect(enqueueMail).not.toHaveBeenCalled();
  });

  it("refuses to send when there is no email on file", async () => {
    fakeDb.seed("prospects/p1", {
      displayName: "Dave",
      trades: ["plumber"],
      status: "listed",
      emailConspicuouslyPublished: true,
      emailHash: "",
      dataConsentBasis: "manual_public_lookup",
      source: "x",
      outreachCount: 0,
      firstRequestedAt: null,
    });
    // no private/contact doc seeded
    await expectHttpsError(callFn(sendProspectOutreach, admin(validBody)), "failed-precondition");
    expect(enqueueMail).not.toHaveBeenCalled();
  });
});

describe("sendProspectOutreach happy path", () => {
  it("sends a CASL-complete email and records the send", async () => {
    seedProspect();
    const res = await callFn(sendProspectOutreach, admin(validBody));
    expect(res).toMatchObject({ status: "sent" });

    expect(enqueueMail).toHaveBeenCalledTimes(1);
    const mail = enqueueMail.mock.calls[0][0] as {
      to: string;
      subject: string;
      text: string;
      html: string;
    };
    expect(mail.to).toBe("dave@smithplumbing.ca");
    expect(mail.subject).toBe(validBody.subject);
    // CASL furniture the server always appends, regardless of the edited body.
    expect(mail.text).toContain("123 Main St, Kelowna, BC");
    expect(mail.text.toLowerCase()).toContain("unsubscribe");
    expect(mail.html).toContain("See your free profile"); // the claim CTA
    expect(mail.html).toContain("123 Main St, Kelowna, BC");

    const saved = fakeDb.peek("prospects/p1");
    expect(saved?.status).toBe("outreach_sent");
    expect(saved?.outreachCount).toBe("__increment_1__");
    expect(saved?.lastOutreachAt).toBe("__serverTimestamp__");
    expect(logAdminAction).toHaveBeenCalledTimes(1);
  });

  it("passes CC addresses through to the mailer", async () => {
    seedProspect();
    await callFn(sendProspectOutreach, admin({ ...validBody, cc: ["owner@blueseal.app"] }));
    const mail = enqueueMail.mock.calls[0][0] as { cc?: string[] };
    expect(mail.cc).toEqual(["owner@blueseal.app"]);
  });
});
