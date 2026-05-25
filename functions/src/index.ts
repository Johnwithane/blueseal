import { setGlobalOptions } from "firebase-functions/v2";

setGlobalOptions({ region: "us-central1", maxInstances: 10 });

// Auth & roles
export { setRoleOnSignup } from "./auth/setRoleOnSignup";
export { setAdminRole } from "./auth/setAdminRole";
export { addRoleToSelf } from "./auth/addRoleToSelf";
export { grantAllRolesForAdminTesting } from "./auth/grantAllRolesForAdminTesting";
export { requestAccountDeletion } from "./auth/requestAccountDeletion";
export { exportMyData } from "./auth/exportMyData";
export { scheduledHardDelete } from "./auth/scheduledHardDelete";

// Vetting
export { submitForVetting } from "./vetting/submitForVetting";
export { onCertApproved } from "./vetting/onCertApproved";
export { onIdApproved } from "./vetting/onIdApproved";
export { onInsuranceApproved } from "./vetting/onInsuranceApproved";
export { onWsibApproved } from "./vetting/onWsibApproved";
export {
  approveApplication,
  requestApplicationInfo,
  rejectApplication,
} from "./vetting/decisions";
export { scheduledIdRetention } from "./vetting/scheduledIdRetention";

// Reviews
export { onReviewCreated } from "./reviews/onReviewCreated";
export { onClientReviewCreated } from "./reviews/onClientReviewCreated";

// Chat
export { onMessageCreated } from "./chat/onMessageCreated";

// Jobs (direct-request notifications; marketplace flows live in jobPosts/)
export { onJobCreated } from "./jobs/onJobCreated";
export { onJobCancelled } from "./jobs/onJobCancelled";
export { onJobUpdated } from "./jobs/onJobUpdated";
export { clockIn } from "./jobs/clockIn";
export { clockOut } from "./jobs/clockOut";
export { submitJobForApproval } from "./jobs/submitJobForApproval";
export { clientApproveJob } from "./jobs/clientApproveJob";
export { clientRequestChanges } from "./jobs/clientRequestChanges";
export { markJobPaid } from "./jobs/markJobPaid";
export { submitQuote } from "./jobs/submitQuote";
export { clientAcceptQuote } from "./jobs/clientAcceptQuote";
export { clientDeclineQuote } from "./jobs/clientDeclineQuote";

// Invoicing
export { onJobCompleted } from "./invoicing/onJobCompleted";
// TODO(stripe-setup): re-enable once STRIPE_SECRET_KEY is set via
// `firebase functions:secrets:set` (HUMANTASKS.md → "Set Stripe secrets
// on Cloud Functions"). sendInvoice binds STRIPE_SECRET_KEY and blocks
// the whole deploy when the secret doesn't exist yet.
// export { sendInvoice } from "./invoicing/sendInvoice";
export { markInvoiceOverdue } from "./invoicing/scheduledOverdue";
export { pullBillablesFromJob } from "./invoicing/pullBillablesFromJob";

// AI
export { aiDiagnose, aiQuote, aiSummarize } from "./ai/tools";
export { aiChat } from "./ai/chat";
export { aiSuggestReplies } from "./ai/suggestReplies";
export { aiUpdateJobLog } from "./ai/updateJobLog";
export { parseReceipt } from "./ai/parseReceipt";

// Payments — Stripe Connect Express (commission model). The subscription
// stub was deleted in the Phase C cutover; the platform earns from a 12%
// commission on each payment via Connect's application_fee_amount.
// TODO(stripe-setup): re-enable the 4 Stripe-binding exports below once
// STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET are set via
// `firebase functions:secrets:set` (HUMANTASKS.md → "Set Stripe secrets
// on Cloud Functions"). They block the deploy when the secrets don't
// exist. backfillPayoutsField stays — it only imports a helper, no
// secret binding.
// export { createConnectAccount } from "./payments/createConnectAccount";
// export { createConnectOnboardingLink } from "./payments/createConnectOnboardingLink";
// export { createConnectLoginLink } from "./payments/createConnectLoginLink";
// export { stripeWebhook } from "./payments/stripeWebhook";
export { backfillPayoutsField } from "./payments/backfillPayoutsField";

// Seed + ops
export { seedIntakeSchemas, ping } from "./seed/seedIntakeSchemas";

// Messaging (WhatsApp Cloud API queue processor)
export { processWhatsAppMessage } from "./messaging/processWhatsAppMessage";

// Job-board marketplace
export { createJobPost } from "./jobPosts/createJobPost";
export { submitApplication } from "./jobPosts/submitApplication";
export { withdrawApplication } from "./jobPosts/withdrawApplication";
export { acceptApplication } from "./jobPosts/acceptApplication";
export { returnToApplicants } from "./jobPosts/returnToApplicants";
export { cancelJobPost } from "./jobPosts/cancelJobPost";
export { onJobPostClosed } from "./jobPosts/onJobPostClosed";
export { onApplicationCreated } from "./jobPosts/onApplicationCreated";
export { scheduledJobPostExpiry } from "./jobPosts/scheduledJobPostExpiry";
