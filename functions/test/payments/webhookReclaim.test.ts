// P1-01: a webhook event whose sentinel already exists is only a true
// duplicate when it fully `processed`. A prior delivery that `failed` or
// crashed mid-`processing` must be reprocessed, or a transient failure
// permanently drops the event (payment never reconciles). decideReclaim is the
// pure decision the dispatcher applies on ALREADY_EXISTS.

import { describe, it, expect } from "vitest";
import { decideReclaim } from "../../src/payments/stripeWebhook";

const NOW = 1_000_000_000_000;
const ts = (ms: number) => ({ toMillis: () => ms });

describe("decideReclaim", () => {
  it("skips a fully processed event (the real duplicate case)", () => {
    expect(decideReclaim({ status: "processed" }, NOW)).toBe("skip");
  });

  it("reprocesses a prior failed event", () => {
    expect(decideReclaim({ status: "failed" }, NOW)).toBe("process");
  });

  it("skips a fresh in-flight processing event (concurrent delivery)", () => {
    expect(
      decideReclaim({ status: "processing", receivedAt: ts(NOW - 1000) }, NOW),
    ).toBe("skip");
  });

  it("reprocesses a stale processing event (delivery crashed mid-flight)", () => {
    expect(
      decideReclaim(
        { status: "processing", receivedAt: ts(NOW - 6 * 60 * 1000) },
        NOW,
      ),
    ).toBe("process");
  });

  it("skips processing with no usable receivedAt rather than double-firing", () => {
    expect(decideReclaim({ status: "processing" }, NOW)).toBe("skip");
    expect(decideReclaim({ status: "processing", receivedAt: null }, NOW)).toBe(
      "skip",
    );
  });

  it("skips on a missing or unknown sentinel", () => {
    expect(decideReclaim(undefined, NOW)).toBe("skip");
    expect(decideReclaim({ status: "weird" }, NOW)).toBe("skip");
  });
});
