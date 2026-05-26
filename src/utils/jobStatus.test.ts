import { describe, expect, it } from "vitest";
import { STATUS_LABEL, STATUS_SEVERITY } from "./jobStatus";
import type { JobStatus } from "@/firebase/interfaces";

const ALL_STATUSES: JobStatus[] = [
  "accepted",
  "requested",
  "quoted",
  "awaiting_upfront_payment",
  "in_progress",
  "awaiting_client_approval",
  "awaiting_payment",
  "complete",
  "reviewed",
  "cancelled",
];

describe("jobStatus helpers", () => {
  it("STATUS_LABEL covers every JobStatus", () => {
    for (const s of ALL_STATUSES) {
      expect(STATUS_LABEL[s]).toBeTruthy();
    }
    // Exhaustiveness: if a new status is added, this test fails (the new
    // key is missing from STATUS_LABEL) before anything ships.
    expect(Object.keys(STATUS_LABEL).sort()).toEqual([...ALL_STATUSES].sort());
  });

  it("STATUS_SEVERITY covers every JobStatus", () => {
    for (const s of ALL_STATUSES) {
      expect(STATUS_SEVERITY[s]).toBeTruthy();
    }
    expect(Object.keys(STATUS_SEVERITY).sort()).toEqual([...ALL_STATUSES].sort());
  });
});
