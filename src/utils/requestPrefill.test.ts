// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from "vitest";
import {
  saveRequestPrefill,
  readRequestPrefill,
  clearRequestPrefill,
  deriveTitle,
  deriveUrgency,
} from "@/utils/requestPrefill";

describe("requestPrefill carrier", () => {
  beforeEach(() => localStorage.clear());

  it("round-trips a saved description", () => {
    saveRequestPrefill("my sink is leaking");
    expect(readRequestPrefill()).toBe("my sink is leaking");
  });

  it("trims and ignores trivially short text", () => {
    saveRequestPrefill("  ab  ");
    expect(readRequestPrefill()).toBeNull();
  });

  it("clears", () => {
    saveRequestPrefill("need a new fence");
    clearRequestPrefill();
    expect(readRequestPrefill()).toBeNull();
  });

  it("ignores stale entries past the max age", () => {
    // Hand-write an old timestamp so the freshness guard drops it.
    localStorage.setItem(
      "requestPrefill",
      JSON.stringify({ text: "old request", ts: Date.now() - 3 * 60 * 60 * 1000 }),
    );
    expect(readRequestPrefill()).toBeNull(); // default max age is 2h
    expect(readRequestPrefill(4 * 60 * 60 * 1000)).toBe("old request"); // wider window
  });

  it("survives corrupt JSON", () => {
    localStorage.setItem("requestPrefill", "{not json");
    expect(readRequestPrefill()).toBeNull();
  });
});

describe("deriveTitle", () => {
  it("uses the first sentence and capitalises it", () => {
    expect(deriveTitle("my kitchen sink is leaking. it started today")).toBe(
      "My kitchen sink is leaking",
    );
  });

  it("returns empty for nothing usable", () => {
    expect(deriveTitle("")).toBe("");
    expect(deriveTitle("hi")).toBe("");
  });

  it("truncates long first clauses on a word boundary with an ellipsis", () => {
    const long =
      "the water heater in the basement has been leaking steadily for two days and now there is standing water everywhere around it";
    const title = deriveTitle(long);
    expect(title.length).toBeLessThanOrEqual(140);
    expect(title.endsWith("…")).toBe(true);
    expect(title).toMatch(/^The water heater/);
  });
});

describe("deriveUrgency", () => {
  it("flags emergencies as urgent", () => {
    expect(deriveUrgency("there's a gas leak in the kitchen")).toBe("urgent");
    expect(deriveUrgency("basement is flooding right now")).toBe("urgent");
    expect(deriveUrgency("we have no heat and it's freezing")).toBe("urgent");
  });

  it("flags soon-ish jobs as this_week", () => {
    expect(deriveUrgency("hoping to get this done this week")).toBe("this_week");
    expect(deriveUrgency("need it sorted in a few days")).toBe("this_week");
  });

  it("defaults to flexible", () => {
    expect(deriveUrgency("whenever you have time to repaint the fence")).toBe("flexible");
  });
});
