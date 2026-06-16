import { describe, it, expect } from "vitest";
import { evaluateVersion } from "./appVersion";

describe("evaluateVersion", () => {
  it("reports no update when the server matches the running build", () => {
    expect(evaluateVersion("abc123", { version: "abc123" })).toEqual({
      updateAvailable: false,
      critical: false,
    });
  });

  it("flags an update when the server is on a different build", () => {
    expect(evaluateVersion("abc123", { version: "def456" })).toEqual({
      updateAvailable: true,
      critical: false,
    });
  });

  it("forces the update when the newer build is critical", () => {
    expect(evaluateVersion("abc123", { version: "def456", critical: true })).toEqual({
      updateAvailable: true,
      critical: true,
    });
  });

  it("does not force when the build matches, even if critical is set", () => {
    // Already on the latest build → nothing to do, regardless of the flag.
    expect(evaluateVersion("def456", { version: "def456", critical: true })).toEqual({
      updateAvailable: false,
      critical: false,
    });
  });

  it("is a no-op when version.json is missing or malformed", () => {
    expect(evaluateVersion("abc123", null)).toEqual({ updateAvailable: false, critical: false });
    expect(evaluateVersion("abc123", { version: "" })).toEqual({
      updateAvailable: false,
      critical: false,
    });
  });
});
