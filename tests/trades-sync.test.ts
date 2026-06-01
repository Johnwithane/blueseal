// Drift guard: the Cloud Functions package can't import from src/, so the seed
// import schema (functions/src/seed/seededProspectSchema.ts) keeps a hand
// mirror of the canonical trade keys in src/data/trades.ts. If someone adds a
// trade to one list and forgets the other, this test goes red — which is how we
// guarantee the trade list stays "full" in both places.

import { describe, expect, it } from "vitest";
import { TRADES } from "@/data/trades";
import { TRADE_KEYS } from "../functions/src/seed/seededProspectSchema";

describe("trade key sync (client ↔ functions)", () => {
  it("functions TRADE_KEYS exactly mirrors src/data/trades.ts keys, in order", () => {
    expect([...TRADE_KEYS]).toEqual(TRADES.map((t) => t.key));
  });

  it("has no duplicate trade keys", () => {
    const keys = TRADES.map((t) => t.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
