import { describe, it, expect } from "vitest";
import { humanizeError, isPaywallError, paywallMessage } from "./errors";

// The server leads a Blue Seal Pro paywall with this token (callable HttpsError
// can't carry a custom code). These helpers + the upgrade popup rely on it.
const aiPaywall = {
  code: "functions/failed-precondition",
  message:
    "BLUESEAL_PRO_REQUIRED: The AI assistant is part of Blue Seal Pro. Start a free trial to use it.",
};
const genericPaywall = {
  code: "functions/failed-precondition",
  message: "BLUESEAL_PRO_REQUIRED: This is a Blue Seal Pro feature. Start a free trial to use it.",
};

describe("isPaywallError", () => {
  it("detects the server's paywall token regardless of code", () => {
    expect(isPaywallError(aiPaywall)).toBe(true);
    expect(isPaywallError(genericPaywall)).toBe(true);
  });

  it("is false for non-paywall errors and non-error values", () => {
    expect(isPaywallError({ code: "functions/permission-denied", message: "nope" })).toBe(false);
    expect(isPaywallError(new Error("boom"))).toBe(false);
    expect(isPaywallError(null)).toBe(false);
    expect(isPaywallError("BLUESEAL_PRO_REQUIRED")).toBe(false); // not on a .message
  });
});

describe("paywallMessage", () => {
  it("returns the human half (token + leading colon stripped)", () => {
    expect(paywallMessage(aiPaywall)).toBe(
      "The AI assistant is part of Blue Seal Pro. Start a free trial to use it.",
    );
  });

  it("returns null for non-paywall errors", () => {
    expect(paywallMessage({ message: "something else" })).toBeNull();
    expect(paywallMessage(null)).toBeNull();
  });
});

describe("humanizeError", () => {
  it("strips the raw token if a paywall error reaches a toast", () => {
    const msg = humanizeError(aiPaywall);
    expect(msg).not.toContain("BLUESEAL_PRO_REQUIRED");
    expect(msg).toBe("The AI assistant is part of Blue Seal Pro. Start a free trial to use it.");
  });

  it("still maps auth errors to canned copy", () => {
    expect(humanizeError({ code: "auth/wrong-password" })).toBe("Email or password is incorrect.");
  });

  it("prefers a callable's own message for non-paywall function errors", () => {
    expect(
      humanizeError({ code: "functions/failed-precondition", message: "Quote already sent." }),
    ).toBe("Quote already sent.");
  });
});
