import { describe, expect, it } from "vitest";
import { JOB_TIMELINE_STEPS, timelineStepIndex } from "./jobTimeline";
import type { JobStatus } from "@/firebase/interfaces";

describe("timelineStepIndex", () => {
  it("maps every non-special status onto a valid step", () => {
    const statuses: JobStatus[] = [
      "accepted",
      "requested",
      "quoted",
      "awaiting_upfront_payment",
      "in_progress",
      "awaiting_client_approval",
      "awaiting_payment",
      "complete",
      "reviewed",
    ];
    for (const s of statuses) {
      const idx = timelineStepIndex(s);
      expect(idx).not.toBeNull();
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(idx).toBeLessThan(JOB_TIMELINE_STEPS.length);
    }
  });

  it("never moves backwards along the happy path", () => {
    const happyPath: JobStatus[] = [
      "accepted",
      "requested",
      "quoted",
      "awaiting_upfront_payment",
      "in_progress",
      "awaiting_client_approval",
      "awaiting_payment",
      "complete",
      "reviewed",
    ];
    let last = -1;
    for (const s of happyPath) {
      const idx = timelineStepIndex(s)!;
      expect(idx).toBeGreaterThanOrEqual(last);
      last = idx;
    }
  });

  it("resolves on_hold through statusBeforeHold", () => {
    expect(timelineStepIndex("on_hold", "awaiting_upfront_payment")).toBe(
      timelineStepIndex("awaiting_upfront_payment"),
    );
    // No recorded prior status → assume the committed default (work).
    expect(timelineStepIndex("on_hold", null)).toBe(timelineStepIndex("in_progress"));
    // Defensive: a corrupt on_hold→on_hold chain still terminates.
    expect(timelineStepIndex("on_hold", "on_hold")).toBe(timelineStepIndex("in_progress"));
  });

  it("returns null for cancelled", () => {
    expect(timelineStepIndex("cancelled")).toBeNull();
  });

  it("ends on the final step when reviewed", () => {
    expect(timelineStepIndex("reviewed")).toBe(JOB_TIMELINE_STEPS.length - 1);
  });
});
