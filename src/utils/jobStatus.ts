import type { JobStatus } from "@/firebase/interfaces";

export const STATUS_LABEL: Record<JobStatus, string> = {
  accepted: "Accepted",
  requested: "Requested",
  quoted: "Quoted",
  quote_accepted: "Quote accepted",
  scheduled: "Scheduled",
  in_progress: "In progress",
  awaiting_client_approval: "Awaiting approval",
  awaiting_payment: "Awaiting payment",
  complete: "Complete",
  reviewed: "Reviewed",
  cancelled: "Cancelled",
};

export type StatusSeverity = "info" | "warn" | "success" | "danger" | "secondary";

export const STATUS_SEVERITY: Record<JobStatus, StatusSeverity> = {
  accepted: "info",
  requested: "info",
  quoted: "warn",
  quote_accepted: "success",
  scheduled: "success",
  in_progress: "success",
  awaiting_client_approval: "warn",
  awaiting_payment: "warn",
  complete: "success",
  reviewed: "secondary",
  cancelled: "danger",
};

export const PHASES = [
  "requested",
  "quoted",
  "scheduled",
  "in_progress",
  "wrap_up",
  "complete",
] as const;

export type Phase = (typeof PHASES)[number];

export const PHASE_LABEL: Record<Phase, string> = {
  requested: "Requested",
  quoted: "Quoted",
  scheduled: "Scheduled",
  in_progress: "In progress",
  wrap_up: "Wrap-up",
  complete: "Complete",
};

// Maps each of the 11 job statuses onto one of 6 visible phases (or
// "cancelled", which is rendered as a full-width banner instead of dots).
// "accepted" and "requested" collapse into Requested because the client
// completing the brief is an internal step, not a customer-facing phase.
// "awaiting_client_approval" and "awaiting_payment" share the Wrap-up
// phase — the action shifts party-to-party but the lifecycle is "closing
// the job out." Contextual banners surface the specific next action.
export function phaseForStatus(status: JobStatus): Phase | "cancelled" {
  switch (status) {
    case "accepted":
    case "requested":
      return "requested";
    case "quoted":
    case "quote_accepted":
      return "quoted";
    case "scheduled":
      return "scheduled";
    case "in_progress":
      return "in_progress";
    case "awaiting_client_approval":
    case "awaiting_payment":
      return "wrap_up";
    case "complete":
    case "reviewed":
      return "complete";
    case "cancelled":
      return "cancelled";
  }
}
