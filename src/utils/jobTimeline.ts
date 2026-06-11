import type { JobStatus } from "@/firebase/interfaces";

// The five client-meaningful milestones of every job, in order. Individual
// statuses collapse onto these so the stepper stays readable at 375px —
// "where am I?" beats per-status precision here (the status Tag still shows
// the exact state).
export const JOB_TIMELINE_STEPS = [
  { key: "details", label: "Details" },
  { key: "quote", label: "Quote" },
  { key: "work", label: "Work" },
  { key: "payment", label: "Payment" },
  { key: "done", label: "Done" },
] as const;

const STEP_BY_STATUS: Record<Exclude<JobStatus, "on_hold" | "cancelled">, number> = {
  accepted: 0,
  requested: 1,
  quoted: 1,
  awaiting_upfront_payment: 2,
  in_progress: 2,
  awaiting_client_approval: 2,
  awaiting_payment: 3,
  complete: 4,
  reviewed: 4,
};

/**
 * Which milestone the job is at. on_hold resolves through statusBeforeHold
 * (falling back to "work" — holds only happen on committed jobs). Returns
 * null for cancelled: there's no "progress" to show on a dead job.
 */
export function timelineStepIndex(
  status: JobStatus,
  statusBeforeHold?: JobStatus | null,
): number | null {
  if (status === "cancelled") return null;
  if (status === "on_hold") {
    const before = statusBeforeHold && statusBeforeHold !== "on_hold" ? statusBeforeHold : null;
    return before ? timelineStepIndex(before) : STEP_BY_STATUS.in_progress;
  }
  return STEP_BY_STATUS[status];
}
