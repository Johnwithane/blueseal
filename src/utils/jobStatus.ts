import type { JobStatus } from "@/firebase/interfaces";

export const STATUS_LABEL: Record<JobStatus, string> = {
  accepted: "Accepted",
  requested: "Requested",
  quoted: "Quoted",
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
  in_progress: "success",
  awaiting_client_approval: "warn",
  awaiting_payment: "warn",
  complete: "success",
  reviewed: "secondary",
  cancelled: "danger",
};
