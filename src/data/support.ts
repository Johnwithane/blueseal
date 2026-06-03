// Support contact configuration.
//
// SUPPORT_EMAIL is a PLACEHOLDER — confirm the real inbox before launch (see
// HUMANTASKS.md). The Help Center contact form currently composes a prefilled
// email to this address (zero backend). The planned Firestore-backed ticket
// form (supportTickets collection) is deferred until its security rules can be
// deployed — see HUMANTASKS.md.
export const SUPPORT_EMAIL = "support@blueseal.ca";

// Topics offered in the contact form's dropdown.
export const SUPPORT_TOPICS = [
  "A problem with a job",
  "Payments or invoices",
  "Verification / my profile",
  "Account & sign-in",
  "Report a safety concern",
  "Something else",
] as const;

export type SupportTopic = (typeof SUPPORT_TOPICS)[number];
