import { describe, expect, it } from "vitest";

import {
  STATEMENT_SUFFIX_MAX,
  toStatementDescriptorSuffix,
} from "../../src/payments/statementDescriptor";

describe("toStatementDescriptorSuffix", () => {
  it("passes a short clean business name straight through", () => {
    expect(toStatementDescriptorSuffix("Smith Elec")).toBe("Smith Elec");
  });

  it("clips to the 12 chars Stripe leaves after the BLUESEAL prefix", () => {
    const out = toStatementDescriptorSuffix("Okanagan Mechanical Ltd.");
    expect(out).toBe("Okanagan Mec");
    expect(out!.length).toBeLessThanOrEqual(STATEMENT_SUFFIX_MAX);
  });

  it("never leaves a dangling separator after the clip", () => {
    // Naive slice(0, 12) ends on the space: "Kelowna Ace ".
    expect(toStatementDescriptorSuffix("Kelowna Ace Roofing")).toBe("Kelowna Ace");
  });

  it("clips mid-word rather than losing the word, when the cut isn't on a space", () => {
    expect(toStatementDescriptorSuffix("Northside Plumbing")).toBe("Northside Pl");
  });

  it("strips accents instead of dropping the letters", () => {
    expect(toStatementDescriptorSuffix("Café Électrique")).toBe("Cafe Electri");
  });

  it("removes characters Stripe rejects outright", () => {
    // < > \ ' " * would 400 the PaymentIntent.
    expect(toStatementDescriptorSuffix('A*B"C')).toBe("A B C");
  });

  it("returns null when nothing usable survives, so the caller omits the field", () => {
    expect(toStatementDescriptorSuffix("")).toBeNull();
    expect(toStatementDescriptorSuffix(null)).toBeNull();
    expect(toStatementDescriptorSuffix(undefined)).toBeNull();
    // Stripe requires at least one letter in the suffix.
    expect(toStatementDescriptorSuffix("123 456")).toBeNull();
    expect(toStatementDescriptorSuffix("***")).toBeNull();
  });

  it("keeps the ampersand and period traders actually use", () => {
    expect(toStatementDescriptorSuffix("B & B Roof")).toBe("B & B Roof");
  });
});
