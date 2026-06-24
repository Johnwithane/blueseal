import { describe, it, expect } from "vitest";
import { isValidReferralCode, normalizeReferralCode } from "./referralCode";

describe("normalizeReferralCode", () => {
  it("uppercases and strips non-alphanumerics", () => {
    expect(normalizeReferralCode("johnny-k")).toBe("JOHNNYK");
    expect(normalizeReferralCode("  ab 12 ")).toBe("AB12");
  });
});

describe("isValidReferralCode", () => {
  it("accepts 3-20 alphanumeric codes", () => {
    expect(isValidReferralCode("JOHNNYK")).toBe(true);
    expect(isValidReferralCode("ABC")).toBe(true);
    expect(isValidReferralCode("CODE123")).toBe(true);
  });
  it("rejects too short / too long", () => {
    expect(isValidReferralCode("AB")).toBe(false);
    expect(isValidReferralCode("A".repeat(21))).toBe(false);
  });
  it("rejects non-alphanumeric (already-normalized input)", () => {
    expect(isValidReferralCode("JOHN-K")).toBe(false);
  });
  it("rejects reserved words", () => {
    expect(isValidReferralCode("ADMIN")).toBe(false);
    expect(isValidReferralCode("BLUESEAL")).toBe(false);
  });
});
