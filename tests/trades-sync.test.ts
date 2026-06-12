// Drift guard: the Cloud Functions package can't import from src/, so the seed
// import schema (functions/src/seed/seededProspectSchema.ts) keeps a hand
// mirror of the canonical trade keys in src/data/trades.ts. If someone adds a
// trade to one list and forgets the other, this test goes red — which is how we
// guarantee the trade list stays "full" in both places.

import { describe, expect, it } from "vitest";
import { TRADES } from "@/data/trades";
import { TRADE_KEYS } from "../functions/src/seed/seededProspectSchema";
import { TRADE_LABELS } from "../functions/src/ai/tradeExpertise";

describe("trade key sync (client ↔ functions)", () => {
  it("functions TRADE_KEYS exactly mirrors src/data/trades.ts keys, in order", () => {
    expect([...TRADE_KEYS]).toEqual(TRADES.map((t) => t.key));
  });

  it("has no duplicate trade keys", () => {
    const keys = TRADES.map((t) => t.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  // The AI assistant's expert persona reads human labels from a functions-side
  // mirror (functions can't import src/). Guard it the same way as the keys: a
  // new trade or a relabel in src/data/trades.ts must update TRADE_LABELS too,
  // or a trade silently shows up as its raw key ("auto_body") in the prompt.
  it("functions TRADE_LABELS exactly mirrors src/data/trades.ts key→label", () => {
    const expected = Object.fromEntries(TRADES.map((t) => [t.key, t.label]));
    expect(TRADE_LABELS).toEqual(expected);
  });
});
