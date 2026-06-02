import type { DocStatus } from "@/firebase/interfaces";

// Single source of truth for the verification-document status vocabulary
// (cert / ID / insurance / WSIB). These maps were previously duplicated —
// an identical { pending: warn, approved: success, rejected: danger } object
// in all four upload cards plus a fifth copy in ApplicationReviewView
// (UI_UX_AUDIT.md R7). Render statuses through a PrimeVue <Tag :severity>
// using these maps; don't hand-roll the mapping per component.
//
// "none" ("not uploaded yet") only applies to fields that can be empty (e.g.
// ID before upload); the stored DocStatus union itself is pending/approved/
// rejected only.
export type VerificationStatus = DocStatus | "none";

type Severity = "secondary" | "warn" | "success" | "danger";

export const VERIFICATION_SEVERITY: Record<VerificationStatus, Severity> = {
  none: "secondary",
  pending: "warn",
  approved: "success",
  rejected: "danger",
};

// Human-readable labels — replaces the raw enum strings ("pending", "none")
// that some surfaces rendered directly into a Tag.
export const VERIFICATION_LABEL: Record<VerificationStatus, string> = {
  none: "Not uploaded",
  pending: "In review",
  approved: "Verified",
  rejected: "Rejected",
};
