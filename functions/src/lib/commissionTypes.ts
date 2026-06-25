// Shared commission ledger unions (server mirror of the same types in
// src/firebase/interfaces.ts). Kept tiny + dependency-free so both the owner
// resolver and the accrual hooks can import them without a cycle.

export type CommissionSource = "subscription" | "service_fee";
export type CommissionOwnerKind = "referral" | "region";
export type CommissionStatus = "accrued" | "reversed" | "paid";
