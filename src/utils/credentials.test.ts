import { describe, expect, it } from "vitest";
import { hasRedSeal, isRedSealIssuer, redSealTrades } from "./credentials";
import type { TradespersonDoc, VerifiedCredential } from "@/firebase/interfaces";

const cred = (over: Partial<VerifiedCredential> = {}): VerifiedCredential => ({
  trade: "plumbing",
  issuingBody: "Red Seal Program",
  redSeal: true,
  expiresAt: null,
  ...over,
});

// Only the credential fields the helpers read — keeps the fixture honest about
// what they actually depend on.
const tradie = (creds?: VerifiedCredential[]) =>
  ({ verifiedCredentials: creds }) as Pick<TradespersonDoc, "verifiedCredentials">;

describe("isRedSealIssuer", () => {
  it("matches the seed issuer", () => {
    expect(isRedSealIssuer("Red Seal Program")).toBe(true);
  });

  it("matches free-typed casing/spacing variants", () => {
    expect(isRedSealIssuer("red seal")).toBe(true);
    expect(isRedSealIssuer("RedSeal Program")).toBe(true);
    expect(isRedSealIssuer("  RED SEAL  ")).toBe(true);
  });

  it("does not match other issuers or empty", () => {
    expect(isRedSealIssuer("TSSA (Ontario)")).toBe(false);
    expect(isRedSealIssuer("ESA (Ontario)")).toBe(false);
    expect(isRedSealIssuer("")).toBe(false);
    expect(isRedSealIssuer(null)).toBe(false);
    expect(isRedSealIssuer(undefined)).toBe(false);
  });
});

describe("hasRedSeal", () => {
  it("is true when a credential is flagged redSeal", () => {
    expect(hasRedSeal(tradie([cred()]))).toBe(true);
  });

  it("falls back to the issuer string when the flag is missing (hand-seeded data)", () => {
    expect(hasRedSeal(tradie([cred({ redSeal: false })]))).toBe(true);
  });

  it("is false with only non-Red-Seal credentials", () => {
    expect(
      hasRedSeal(tradie([cred({ issuingBody: "TSSA (Ontario)", redSeal: false })])),
    ).toBe(false);
  });

  it("is false / safe for empty, missing, or null input", () => {
    expect(hasRedSeal(tradie([]))).toBe(false);
    expect(hasRedSeal(tradie(undefined))).toBe(false);
    expect(hasRedSeal(null)).toBe(false);
    expect(hasRedSeal(undefined)).toBe(false);
  });
});

describe("redSealTrades", () => {
  it("returns the distinct Red Seal trades only", () => {
    const creds = [
      cred({ trade: "plumbing" }),
      cred({ trade: "plumbing" }), // duplicate trade
      cred({ trade: "gas", issuingBody: "TSSA (Ontario)", redSeal: false }),
      cred({ trade: "electrician" }),
    ];
    expect(redSealTrades(tradie(creds))).toEqual(["plumbing", "electrician"]);
  });

  it("returns [] when there are none", () => {
    expect(redSealTrades(tradie(undefined))).toEqual([]);
  });
});
