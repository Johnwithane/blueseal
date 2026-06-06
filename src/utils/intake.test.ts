import { describe, it, expect } from "vitest";
import { firstMissingRequired, pickIntakeAnswers } from "./intake";
import type { IntakeField } from "@/firebase/interfaces";

const FIELDS: IntakeField[] = [
  { key: "area", label: "Area", type: "select", required: true, options: [{ value: "floor", label: "Floor" }] },
  { key: "sqft", label: "Square footage", type: "number", required: true },
  { key: "ready", label: "Ready?", type: "boolean", required: true },
  { key: "tags", label: "Tags", type: "multiselect", required: true, options: [{ value: "a", label: "A" }] },
  { key: "notes", label: "Notes", type: "textarea" },
];

describe("firstMissingRequired", () => {
  it("returns null when every required field is answered", () => {
    const data = { area: "floor", sqft: 120, ready: false, tags: ["a"] };
    expect(firstMissingRequired(FIELDS, data)).toBeNull();
  });

  it("flags the first missing required field by label", () => {
    const data = { area: "floor" };
    expect(firstMissingRequired(FIELDS, data)).toBe("Square footage");
  });

  it("treats an empty required multiselect as unanswered", () => {
    const data = { area: "floor", sqft: 120, ready: true, tags: [] };
    expect(firstMissingRequired(FIELDS, data)).toBe("Tags");
  });

  it("accepts false and 0 as real answers", () => {
    const data = { area: "floor", sqft: 0, ready: false, tags: ["a"] };
    expect(firstMissingRequired(FIELDS, data)).toBeNull();
  });

  it("ignores optional fields", () => {
    const data = { area: "floor", sqft: 1, ready: true, tags: ["a"] };
    expect(firstMissingRequired(FIELDS, data)).toBeNull(); // notes omitted is fine
  });
});

describe("pickIntakeAnswers", () => {
  it("keeps only answered schema keys", () => {
    const data = { area: "floor", sqft: 120, notes: "", ready: true, tags: [] };
    expect(pickIntakeAnswers(FIELDS, data)).toEqual({
      area: "floor",
      sqft: 120,
      ready: true,
    });
  });

  it("drops keys that aren't in the schema (e.g. left over from another trade)", () => {
    const data = { area: "floor", stale_key: "x" };
    expect(pickIntakeAnswers(FIELDS, data)).toEqual({ area: "floor" });
  });
});
