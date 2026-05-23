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
export { clockIn } from "./jobs/clockIn";
export { clockOut } from "./jobs/clockOut";

// Invoicing
export { onJobCompleted } from "./invoicing/onJobCompleted";
export { sendInvoice } from "./invoicing/sendInvoice";
export { markInvoiceOverdue } from "./invoicing/scheduledOverdue";
export { pullBillablesFromJob } from "./invoicing/pullBillablesFromJob";

// AI
export { aiDiagnose, aiQuote, aiSummarize } from "./ai/tools";
export { aiChat } from "./ai/chat";
export { parseReceipt } from "./ai/parseReceipt";

// Payments (stubbed)
export {
  createCheckoutSession,
  stripeWebhook,
  adminToggleSubscription,
} from "./payments/stripeStub";

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
