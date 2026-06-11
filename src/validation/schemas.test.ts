import { describe, it, expect } from "vitest";
import {
  siteVisitFeeSchema,
  proposeSiteVisitSchema,
  submitApplicationSchema,
  sendJobReferralSchema,
} from "./schemas";

const validLine = { description: "Replace tap", quantity: 1, unitPrice: 12000, taxRate: 0 };
const validMessage = "I can take this on and start next week — details to follow.";

describe("siteVisitFeeSchema", () => {
  it("accepts a free visit ($0)", () => {
    const r = siteVisitFeeSchema.safeParse({ description: "Site visit", feeCents: 0, taxRate: 0 });
    expect(r.success).toBe(true);
  });

  it("accepts a paid visit and defaults taxRate to 0", () => {
    const r = siteVisitFeeSchema.safeParse({ description: "Assessment", feeCents: 5000 });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.taxRate).toBe(0);
  });

  it("rejects a negative fee", () => {
    expect(siteVisitFeeSchema.safeParse({ description: "x", feeCents: -1, taxRate: 0 }).success).toBe(false);
  });

  it("rejects an empty description", () => {
    expect(siteVisitFeeSchema.safeParse({ description: "  ", feeCents: 0, taxRate: 0 }).success).toBe(false);
  });
});

describe("proposeSiteVisitSchema", () => {
  it("accepts a null proposed date and defaults the note", () => {
    const r = proposeSiteVisitSchema.safeParse({
      jobId: "job1",
      fee: { description: "Site visit", feeCents: 0, taxRate: 0 },
      proposedDate: null,
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.note).toBe("");
  });

  it("accepts a YYYY-MM-DD date and rejects a malformed one", () => {
    expect(
      proposeSiteVisitSchema.safeParse({
        jobId: "job1",
        fee: { description: "Site visit", feeCents: 100, taxRate: 0 },
        proposedDate: "2026-06-15",
      }).success,
    ).toBe(true);
    expect(
      proposeSiteVisitSchema.safeParse({
        jobId: "job1",
        fee: { description: "Site visit", feeCents: 100, taxRate: 0 },
        proposedDate: "15/06/2026",
      }).success,
    ).toBe(false);
  });
});

describe("submitApplicationSchema (discriminated union)", () => {
  it("parses a full application with explicit kind", () => {
    const r = submitApplicationSchema.safeParse({
      kind: "full",
      postId: "post1",
      message: validMessage,
      quote: { lineItems: [validLine] },
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.kind).toBe("full");
  });

  it("defaults a kind-less application to full (back-compat)", () => {
    const r = submitApplicationSchema.safeParse({
      postId: "post1",
      message: validMessage,
      quote: { lineItems: [validLine] },
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.kind).toBe("full");
  });

  it("parses a site-visit application", () => {
    const r = submitApplicationSchema.safeParse({
      kind: "site_visit",
      postId: "post1",
      message: validMessage,
      siteVisitFee: { description: "Site visit", feeCents: 0, taxRate: 0 },
    });
    expect(r.success).toBe(true);
    if (r.success && r.data.kind === "site_visit") {
      expect(r.data.siteVisitFee.feeCents).toBe(0);
    }
  });

  it("rejects a site-visit application missing the fee", () => {
    const r = submitApplicationSchema.safeParse({
      kind: "site_visit",
      postId: "post1",
      message: validMessage,
    });
    expect(r.success).toBe(false);
  });

  it("rejects a full application with no line items", () => {
    const r = submitApplicationSchema.safeParse({
      kind: "full",
      postId: "post1",
      message: validMessage,
      quote: { lineItems: [] },
    });
    expect(r.success).toBe(false);
  });

  it("parses a chat-first application and requires an opening message", () => {
    const ok = submitApplicationSchema.safeParse({
      kind: "chat",
      postId: "post1",
      message: "Hi — does the panel have space for a new breaker?",
    });
    expect(ok.success).toBe(true);
    if (ok.success) expect(ok.data.kind).toBe("chat");
    expect(
      submitApplicationSchema.safeParse({ kind: "chat", postId: "post1", message: "" }).success,
    ).toBe(false);
  });

  // The cover message is a suggestion, never a gate — an empty or missing
  // message must not block a quote (2026-06-11).
  it("accepts an empty or missing cover message", () => {
    expect(
      submitApplicationSchema.safeParse({
        kind: "full",
        postId: "post1",
        message: "",
        quote: { lineItems: [validLine] },
      }).success,
    ).toBe(true);
    const r = submitApplicationSchema.safeParse({
      kind: "full",
      postId: "post1",
      quote: { lineItems: [validLine] },
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.message).toBe("");
  });
});

describe("sendJobReferralSchema", () => {
  it("parses with an optional trimmed message", () => {
    const r = sendJobReferralSchema.safeParse({
      postId: "post1",
      toUserId: "tradie2",
      message: "  Right up your alley.  ",
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.message).toBe("Right up your alley.");
  });

  it("rejects a missing toUserId and an over-long message", () => {
    expect(sendJobReferralSchema.safeParse({ postId: "post1" }).success).toBe(false);
    expect(
      sendJobReferralSchema.safeParse({
        postId: "post1",
        toUserId: "tradie2",
        message: "x".repeat(301),
      }).success,
    ).toBe(false);
  });
});
