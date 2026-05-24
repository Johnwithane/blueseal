import { describe, expect, it } from "vitest";
import {
  PHASES,
  PHASE_LABEL,
  STATUS_LABEL,
  STATUS_SEVERITY,
  phaseForStatus,
  type Phase,
} from "./jobStatus";
import type { JobStatus } from "@/firebase/interfaces";

const ALL_STATUSES: JobStatus[] = [
  "accepted",
  "requested",
  "quoted",
  "quote_accepted",
  "scheduled",
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
    // Exhaustiveness: the type is a closed union so the test array doubles
    // as the source of truth. If a new status is added, this test fails
    // (the new key is missing from STATUS_LABEL) before anything ships.
    expect(Object.keys(STATUS_LABEL).sort()).toEqual([...ALL_STATUSES].sort());
  });

  it("STATUS_SEVERITY covers every JobStatus", () => {
    for (const s of ALL_STATUSES) {
      expect(STATUS_SEVERITY[s]).toBeTruthy();
    }
    expect(Object.keys(STATUS_SEVERITY).sort()).toEqual([...ALL_STATUSES].sort());
  });

  it("PHASE_LABEL covers every Phase", () => {
    for (const p of PHASES) {
      expect(PHASE_LABEL[p]).toBeTruthy();
    }
  });

  describe("phaseForStatus", () => {
    const cases: Array<[JobStatus, Phase | "cancelled"]> = [
      ["accepted", "requested"],
      ["requested", "requested"],
      ["quoted", "quoted"],
      ["quote_accepted", "quoted"],
      ["scheduled", "scheduled"],
      ["in_progress", "in_progress"],
      ["awaiting_client_approval", "wrap_up"],
      ["awaiting_payment", "wrap_up"],
      ["complete", "complete"],
      ["reviewed", "complete"],
      ["cancelled", "cancelled"],
    ];

    it.each(cases)("maps %s → %s", (status, expected) => {
      expect(phaseForStatus(status)).toBe(expected);
    });

    it("returns either a known phase or 'cancelled' for every status", () => {
      const allowed = new Set<string>([...PHASES, "cancelled"]);
      for (const s of ALL_STATUSES) {
        expect(allowed.has(phaseForStatus(s))).toBe(true);
      }
    });
  });
});
