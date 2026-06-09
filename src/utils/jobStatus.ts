import type { JobStatus } from "@/firebase/interfaces";

export const STATUS_LABEL: Record<JobStatus, string> = {
  accepted: "Accepted",
  requested: "Requested",
  quoted: "Quoted",
  awaiting_upfront_payment: "Awaiting upfront",
  in_progress: "In progress",
  on_hold: "On hold",
  awaiting_client_approval: "Awaiting approval",
  awaiting_payment: "Awaiting payment",
  complete: "Complete",
  reviewed: "Reviewed",
  cancelled: "Cancelled",
};

// Role-aware overrides. The neutral STATUS_LABEL above reads fine on admin /
// internal surfaces, but on a party's own dashboard a bare "Requested" is
// ambiguous — to a client who has just picked a tradesperson it looks like
// nothing has happened, when the real state is "waiting on their quote". These
// maps let the badge speak from the viewer's seat; anything not overridden
// falls back to STATUS_LABEL.
const CLIENT_STATUS_LABEL: Partial<Record<JobStatus, string>> = {
  accepted: "Add details",
  requested: "Awaiting quote",
  quoted: "Quote ready",
  awaiting_upfront_payment: "Upfront due",
  awaiting_client_approval: "Review work",
  awaiting_payment: "Payment due",
};

const TRADIE_STATUS_LABEL: Partial<Record<JobStatus, string>> = {
  accepted: "Awaiting brief",
  requested: "Quote needed",
  quoted: "Quote sent",
  awaiting_upfront_payment: "Upfront due",
  awaiting_client_approval: "Awaiting approval",
  awaiting_payment: "Awaiting payment",
};

/**
 * Status badge text from a viewer's perspective. Pass the role to get the
 * party-aware label; omit it (or pass null/"admin") for the neutral label.
 */
export function statusLabel(
  status: JobStatus,
  viewer?: "client" | "tradesperson" | "admin" | null,
): string {
  if (viewer === "client") return CLIENT_STATUS_LABEL[status] ?? STATUS_LABEL[status];
  if (viewer === "tradesperson") return TRADIE_STATUS_LABEL[status] ?? STATUS_LABEL[status];
  return STATUS_LABEL[status];
}

export type StatusSeverity = "info" | "warn" | "success" | "danger" | "secondary";

export const STATUS_SEVERITY: Record<JobStatus, StatusSeverity> = {
  accepted: "info",
  requested: "info",
  quoted: "warn",
  awaiting_upfront_payment: "warn",
  in_progress: "success",
  on_hold: "warn",
  awaiting_client_approval: "warn",
  awaiting_payment: "warn",
  complete: "success",
  reviewed: "secondary",
  cancelled: "danger",
};
