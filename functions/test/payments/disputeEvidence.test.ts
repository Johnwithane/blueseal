// The evidence narrative is what actually wins a chargeback, and it is written
// against a deadline nobody wants to debug under. Pin its shape here.

import { describe, it, expect } from "vitest";
import {
  buildDisputeEvidence,
  type DisputeEvidenceFacts,
} from "../../src/payments/disputeEvidence";

const d = (iso: string) => new Date(iso);

function facts(overrides: Partial<DisputeEvidenceFacts> = {}): DisputeEvidenceFacts {
  return {
    jobTitle: "Replace kitchen GFCI outlets",
    jobDescription: "Three outlets tripping intermittently.",
    trade: "Electrician",
    locality: "Kelowna, BC",
    jobCreatedAt: d("2026-07-01T15:00:00Z"),
    scheduledStart: d("2026-07-04T16:00:00Z"),
    completedAt: d("2026-07-04T21:30:00Z"),
    clientApprovedAt: d("2026-07-05T01:00:00Z"),
    quoteAcceptedAt: d("2026-07-02T18:00:00Z"),
    quoteSigned: true,
    invoiceNumber: "INV-0042",
    invoiceTotalCents: 48_000,
    currency: "CAD",
    paidAt: d("2026-07-05T02:00:00Z"),
    lineItems: [
      { description: "Labour (3h)", amountCents: 33_000 },
      { description: "GFCI outlets x3", amountCents: 15_000 },
    ],
    clientName: "Dana Client",
    clientEmail: "dana@example.com",
    tradespersonName: "Smith Electric Ltd.",
    messages: [
      { at: d("2026-07-02T18:05:00Z"), who: "Client", text: "Quote looks good, go ahead." },
      { at: d("2026-07-04T21:35:00Z"), who: "Tradesperson", text: "All three replaced and tested." },
    ],
    photoCount: 4,
    ...overrides,
  };
}

describe("buildDisputeEvidence", () => {
  it("maps the customer + service fields Stripe matches on", () => {
    const e = buildDisputeEvidence(facts());
    expect(e.customer_name).toBe("Dana Client");
    expect(e.customer_email_address).toBe("dana@example.com");
    // Completion is the truest "service date".
    expect(e.service_date).toBe("2026-07-04");
    expect(e.product_description).toContain("Replace kitchen GFCI outlets");
    expect(e.product_description).toContain("Kelowna, BC");
  });

  it("falls back down the date chain when the job never completed", () => {
    expect(
      buildDisputeEvidence(facts({ completedAt: null })).service_date,
    ).toBe("2026-07-04"); // scheduled start
    expect(
      buildDisputeEvidence(facts({ completedAt: null, scheduledStart: null })).service_date,
    ).toBe("2026-07-01"); // job created
  });

  it("puts the signed acceptance, timeline, invoice and chat in the narrative", () => {
    const text = buildDisputeEvidence(facts()).uncategorized_text ?? "";
    expect(text).toContain("drawing a signature");
    expect(text).toContain("Quote accepted by the client: 2026-07-02 18:00 UTC");
    expect(text).toContain("Client approved the completed work: 2026-07-05 01:00 UTC");
    expect(text).toContain("INV-0042");
    expect(text).toContain("CAD 480.00");
    expect(text).toContain("GFCI outlets x3 — CAD 150.00");
    expect(text).toContain("cannot be edited or deleted");
    expect(text).toContain("Quote looks good, go ahead.");
    expect(text).toContain("4 photo(s)");
  });

  it("says so plainly when there was no in-app acceptance", () => {
    const text =
      buildDisputeEvidence(facts({ quoteSigned: false, quoteAcceptedAt: null }))
        .uncategorized_text ?? "";
    expect(text).toContain("No in-app quote acceptance recorded");
  });

  it("omits empty sections instead of emitting blank labels", () => {
    const e = buildDisputeEvidence(
      facts({
        clientName: null,
        clientEmail: null,
        lineItems: [],
        messages: [],
        photoCount: 0,
        invoiceNumber: null,
        invoiceTotalCents: null,
      }),
    );
    expect(e.customer_name).toBeUndefined();
    expect(e.customer_email_address).toBeUndefined();
    const text = e.uncategorized_text ?? "";
    expect(text).not.toContain("Line items:");
    expect(text).not.toContain("photo(s)");
    expect(text).not.toContain("MESSAGES BETWEEN THE PARTIES");
  });

  it("keeps every field inside Stripe's 20k-character limit", () => {
    const many = Array.from({ length: 500 }, (_, i) => ({
      at: d("2026-07-03T12:00:00Z"),
      who: i % 2 === 0 ? "Client" : "Tradesperson",
      text: "x".repeat(400),
    }));
    const e = buildDisputeEvidence(facts({ messages: many }));
    for (const value of Object.values(e)) {
      expect(value.length).toBeLessThanOrEqual(20_000);
    }
    expect(e.uncategorized_text).toContain("[truncated]");
  });

  it("collapses newlines in quoted messages so the transcript stays readable", () => {
    const text =
      buildDisputeEvidence(
        facts({
          messages: [{ at: d("2026-07-03T12:00:00Z"), who: "Client", text: "line one\n\nline two" }],
        }),
      ).uncategorized_text ?? "";
    expect(text).toContain("Client: line one line two");
  });
});
