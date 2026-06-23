// bugReportSchema leniency — a tester should never hit "something went wrong"
// because a field was too long. The schema TRUNCATES every field to its rules
// cap instead of rejecting; the only hard requirement is a 3+ char title.
import { describe, expect, it } from "vitest";
import { bugReportSchema } from "./schemas";

describe("bugReportSchema", () => {
  it("accepts a minimal report (just a title)", () => {
    const out = bugReportSchema.parse({ title: "Quote button broken" });
    expect(out.title).toBe("Quote button broken");
    expect(out.severity).toBe("medium"); // sensible default
    expect(out.stepsToReproduce).toBe("");
    expect(out.screenshotPaths).toEqual([]);
  });

  it("truncates an over-long title to 140 chars instead of throwing", () => {
    const out = bugReportSchema.parse({ title: "x".repeat(300) });
    expect(out.title).toHaveLength(140);
  });

  it("truncates long free-text fields to their caps", () => {
    const out = bugReportSchema.parse({
      title: "Long detail",
      stepsToReproduce: "s".repeat(5000),
      expected: "e".repeat(3000),
      actual: "a".repeat(3000),
      area: "z".repeat(200),
    });
    expect(out.stepsToReproduce).toHaveLength(4000);
    expect(out.expected).toHaveLength(2000);
    expect(out.actual).toHaveLength(2000);
    expect(out.area).toHaveLength(60);
  });

  it("caps screenshotPaths at 5 and each path at 400 chars", () => {
    const out = bugReportSchema.parse({
      title: "Has shots",
      screenshotPaths: Array.from({ length: 8 }, () => "p".repeat(500)),
    });
    expect(out.screenshotPaths).toHaveLength(5);
    expect(out.screenshotPaths.every((p) => p.length === 400)).toBe(true);
  });

  it("trims whitespace before the min-length check", () => {
    expect(() => bugReportSchema.parse({ title: "  a  " })).toThrow();
  });

  it("still requires a 3+ char title", () => {
    expect(() => bugReportSchema.parse({ title: "x" })).toThrow();
  });
});
