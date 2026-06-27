import { setGlobalOptions } from "firebase-functions/v2";

setGlobalOptions({ region: "us-central1", maxInstances: 10 });

// Auth & roles
export { provisionAccount } from "./auth/provisionAccount";
export { setRoleOnSignup } from "./auth/setRoleOnSignup";
export { setAdminRole } from "./auth/setAdminRole";
export { adminSetUserRoles } from "./auth/adminSetUserRoles";
export { addRoleToSelf } from "./auth/addRoleToSelf";
export { ensureSelfRoles } from "./auth/ensureSelfRoles";
export { grantAllRolesForAdminTesting } from "./auth/grantAllRolesForAdminTesting";
export { grantAllTradesForAdminTesting } from "./auth/grantAllTradesForAdminTesting";

// Branded auth emails — verification, password reset, email change — routed
// through Resend (not Firebase's built-in mailer) so they're branded + inbox-safe.
export {
  sendVerificationEmail,
  requestPasswordReset,
  requestEmailChange,
  requestSignInLink,
} from "./auth/authEmails";

// QA toolkit — self-serve test provisioning, gated to the qa role (granted only
// by an admin). The two fabrication callables are additionally env-gated by
// QA_TOOLKIT_ENABLED (see qa/guard.ts + HUMANTASKS.md).
export { qaProvisionSelfTradesperson } from "./qa/provisionSelfTradesperson";
export { qaProvisionSelfProjectManager } from "./qa/provisionSelfProjectManager";
export { qaProvisionSelfSalesRep } from "./qa/provisionSelfSalesRep";
export { qaSetSelfPro } from "./qa/setSelfPro";
export { qaResetSelfData } from "./qa/resetSelfData";
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
// Scoped vetting: a sales rep reviews the applications they own (referral or
// region). The decision callables above now accept an owning rep; these two
// give reps a server-filtered read path (rules can't scope their list reads).
export { listRepApplications } from "./vetting/listRepApplications";
export { getApplicationDetails } from "./vetting/getApplicationDetails";
export { scheduledIdRetention } from "./vetting/scheduledIdRetention";

// Insurance
export { scheduledInsuranceExpiry } from "./insurance/scheduledInsuranceExpiry";
export { signInsuranceLiabilityRelease } from "./insurance/signInsuranceLiabilityRelease";

// Reviews
export { onReviewCreated } from "./reviews/onReviewCreated";
export { onClientReviewCreated } from "./reviews/onClientReviewCreated";
export { nudgeReviewPairs } from "./reviews/nudgeReviewPairs";

// Admin one-shot ops
export { adminSetUserTrades } from "./admin/setUserTrades";
export { backfillReviewReviewers } from "./admin/backfillReviewReviewers";
export { backfillJobPostClient } from "./admin/backfillJobPostClient";
export { backfillJobPrivateNotes } from "./admin/backfillJobPrivateNotes";
export { backfillTradieContact } from "./admin/backfillTradieContact";
export { adminGrantFoundingPro } from "./admin/grantFoundingPro";
export { adminModerateContent } from "./admin/moderation";
export { nudgeOnboarding } from "./admin/nudgeOnboarding";

// Admin support-desk account actions (verify email, password reset / temp pw,
// suspend/restore, resend verification, edit contact, soft-delete/restore,
// live Auth-state read).
export {
  adminVerifyUserEmail,
  adminSendPasswordReset,
  adminResendVerificationEmail,
  adminSetTempPassword,
  adminSetUserDisabled,
  adminUpdateUserContact,
  adminGetUserAuthState,
  adminSoftDeleteUser,
  adminRestoreUser,
} from "./admin/userSupport";

// Regions & sales reps — regional sales managers own a territory (a set of
// postal FSA prefixes), vet their region's tradespeople, and earn residual
// commission. Region writes are admin-only callables (validated + audited).
export { adminUpsertRegion } from "./sales/upsertRegion";
export { adminDeleteRegion } from "./sales/deleteRegion";
// Daily per-region active-tradie recount + marketing-budget unlock.
export { scheduledRegionHealth } from "./sales/scheduledRegionHealth";
// Admin sales-reps console: list reps + earnings, toggle active, reconcile a
// pending payout batch.
export { adminListSalesReps } from "./sales/adminListSalesReps";
export { adminSetRepActive } from "./sales/adminSetRepActive";
export { adminRetryPayoutBatch } from "./sales/adminRetryPayoutBatch";
// Tradesperson-facing: who is my Blue Seal rep (support contact).
export { getMyRepContact } from "./sales/getMyRepContact";
// Sales rep self-service: e-sign the liability agreement (inert until signed),
// then claim a unique vanity referral code.
export { signSalesAgreement } from "./sales/signAgreement";
export { claimReferralCode } from "./sales/claimReferralCode";

// Project manager self-service: claim a unique vanity recruiting code (/join?pm=),
// e-sign the liability agreement (gates payout, not the cockpit), and Stripe
// Connect onboarding for the monthly commission payout (P4).
export { claimPmCode } from "./projectManager/claimPmCode";
export { claimPmProfileSlug } from "./projectManager/claimProfileSlug";
export { signPmAgreement } from "./projectManager/signAgreement";
// Feature preferred contractors on the public profile (P5b), with a contractor opt-out.
export { setFeaturedContractor, setPmFeatureOptOut } from "./projectManager/featuredContractors";
// Invite a tradesperson to the PM's roster by name + email; auto-join on signup.
export { sendRosterInvite } from "./projectManager/sendRosterInvite";
export { revokeRosterInvite } from "./projectManager/revokeRosterInvite";
export { linkRosterInvitesOnSignup } from "./projectManager/linkRosterInvitesOnSignup";
export { unsubscribeRosterInvite } from "./projectManager/unsubscribeRosterInvite";
export { createPmConnectAccount } from "./payments/createPmConnectAccount";
export { createPmConnectOnboardingLink } from "./payments/createPmConnectOnboardingLink";
export { createPmConnectLoginLink } from "./payments/createPmConnectLoginLink";

// Chat
export { onMessageCreated } from "./chat/onMessageCreated";

// Jobs (direct-request notifications; marketplace flows live in jobPosts/)
export { onJobCreated } from "./jobs/onJobCreated";
export { onJobCancelled } from "./jobs/onJobCancelled";
export { onJobUpdated } from "./jobs/onJobUpdated";
export { clockIn } from "./jobs/clockIn";
export { signUninsuredWaiver } from "./jobs/signUninsuredWaiver";
export { clockOut } from "./jobs/clockOut";
export { addManualTimeEntry } from "./jobs/addManualTimeEntry";
export { submitJobForApproval } from "./jobs/submitJobForApproval";
export { clientApproveJob } from "./jobs/clientApproveJob";
export { clientRequestChanges } from "./jobs/clientRequestChanges";
export { markJobPaid } from "./jobs/markJobPaid";
export { clientMarkPaid } from "./jobs/clientMarkPaid";
export { getInvoicePartyInfo } from "./jobs/getInvoicePartyInfo";
export { submitQuote } from "./jobs/submitQuote";
export { clientAcceptQuote } from "./jobs/clientAcceptQuote";
export { clientDeclineQuote } from "./jobs/clientDeclineQuote";
export { markUpfrontFeePaid } from "./jobs/markUpfrontFeePaid";
export { clientMarkUpfrontFeePaid } from "./jobs/clientMarkUpfrontFeePaid";
// Client cancel/postpone request loop (tradesperson must accept once committed).
export { requestJobChange } from "./jobs/requestJobChange";
export { respondJobChange } from "./jobs/respondJobChange";
export { withdrawJobChange } from "./jobs/withdrawJobChange";
export { resumeJob } from "./jobs/resumeJob";
// Mid-job change-order loop (tradesperson proposes, client approves up front).
export { proposeExtra } from "./jobs/proposeExtra";
export { respondExtra } from "./jobs/respondExtra";
export { cancelExtra } from "./jobs/cancelExtra";
// Pre-quote site-visit loop (tradesperson asks to see the job first, client agrees).
export { proposeSiteVisit } from "./jobs/proposeSiteVisit";
export { respondSiteVisit } from "./jobs/respondSiteVisit";
// Invite jobs (bring-your-own-client): tradesperson-created jobs for
// off-platform clients, run solo until the client claims their invite.
export { createInviteJob } from "./jobs/createInviteJob";
export { recordOfflineQuoteAcceptance } from "./jobs/recordOfflineQuoteAcceptance";
export { resendJobInvite } from "./jobs/resendJobInvite";
export { revokeJobInvite } from "./jobs/revokeJobInvite";
export { sendJobInviteSignInLink } from "./jobs/sendJobInviteSignInLink";
export { claimJobInvite } from "./jobs/claimJobInvite";
export { unsubscribeJobInvite } from "./jobs/unsubscribeJobInvite";
// Projects (Project Manager dispatch): a PM bundles trade jobs for a client and
// invites them by magic link; the client claims the bundle (account auto-created)
// and accepts/declines. Accept is the dispatch trigger (P3b-2). Mirrors the
// bring-your-own-client invite flow.
export { createProject } from "./projects/createProject";
export { sendProjectInviteSignInLink } from "./projects/sendProjectInviteSignInLink";
export { claimProjectInvite } from "./projects/claimProjectInvite";
export { respondToProject } from "./projects/respondToProject";
export { redispatchProject } from "./projects/redispatchProject";
export { cancelProject } from "./projects/cancelProject";
export { resendProjectInvite } from "./projects/resendProjectInvite";
export { unsubscribeProjectInvite } from "./projects/unsubscribeProjectInvite";
// Public-board fallback for a scoped PM posting that got no preferred-contractor bids.
export { openPostingToPublic } from "./jobPosts/openPostingToPublic";
// Clients book recurring billing (Blue Seal Pro): a recurring charge is a
// hidden backing solo-job + a recurring-flagged template invoice the existing
// scheduledRecurringInvoices engine clones into review-and-send drafts.
export { createRecurringPlan } from "./clients/createRecurringPlan";
export { setRecurringPlanState } from "./clients/setRecurringPlanState";

// Invoicing
export { onJobCompleted } from "./invoicing/onJobCompleted";
export { setInvoiceNumbering } from "./billing/setInvoiceNumbering";
// sendInvoice no longer binds STRIPE_SECRET_KEY — the PaymentIntent moved to
// pay time (createInvoicePaymentIntent below), so sending is just PDF + email.
export { sendInvoice } from "./invoicing/sendInvoice";
export { markInvoiceOverdue } from "./invoicing/scheduledOverdue";
export { pullBillablesFromJob } from "./invoicing/pullBillablesFromJob";
// Blue Seal Pro: clones due recurring invoices as drafts (review-and-send).
export { scheduledRecurringInvoices } from "./invoicing/scheduledRecurringInvoices";

// AI
export { aiDiagnose, aiQuote, aiSummarize } from "./ai/tools";
export { aiChat } from "./ai/chat";
export { aiSuggestReplies } from "./ai/suggestReplies";
export { aiUpdateJobLog } from "./ai/updateJobLog";
export { parseReceipt } from "./ai/parseReceipt";
export { aiDraftQuote } from "./ai/draftQuote";
export { aiDraftInvoiceNote } from "./ai/draftInvoiceNote";
export { aiDraftSupportReply } from "./ai/draftSupportReply";

// Support desk — admin-sent ticket replies (branded email + in-app record).
export { sendSupportTicketReply } from "./support/sendSupportTicketReply";

// Payments — Stripe Connect Express. Tradespeople onboard a connected account
// (createConnect*); clients pay invoices by card via a destination charge
// (createInvoicePaymentIntent) and the Blue Seal service fee rides on
// application_fee_amount. stripeWebhook receives the lifecycle events.
export { createConnectAccount } from "./payments/createConnectAccount";
export { createConnectOnboardingLink } from "./payments/createConnectOnboardingLink";
export { createConnectLoginLink } from "./payments/createConnectLoginLink";
// Sales reps onboard their own Connect account the same way (metadata.repId →
// the account.updated mirror writes users/{uid}.salesRep.payouts).
export { createRepConnectAccount } from "./payments/createRepConnectAccount";
export { createRepConnectOnboardingLink } from "./payments/createRepConnectOnboardingLink";
export { createRepConnectLoginLink } from "./payments/createRepConnectLoginLink";
export { stripeWebhook } from "./payments/stripeWebhook";
export { createInvoicePaymentIntent } from "./payments/createInvoicePaymentIntent";
export { createUpfrontFeePaymentIntent } from "./payments/createUpfrontFeePaymentIntent";
// Blue Seal Pro subscription (Stripe Billing).
export { createSubscriptionCheckout } from "./payments/createSubscriptionCheckout";
export { createBillingPortalSession } from "./payments/createBillingPortalSession";
export { backfillPayoutsField } from "./payments/backfillPayoutsField";
// Blue Seal Pro — flips tradespeople/{uid}.isPro back when a founding-member
// comp (subscription.proCompUntil) lapses. No Stripe binding; safe to deploy
// before the Stripe secrets are set.
export { scheduledProCompExpiry } from "./payments/scheduledProCompExpiry";
// Sales reps — monthly commission payout (net accrued minus reversed, $50 min,
// Stripe transfer to the rep's Connect account, ledger flipped to paid).
export { scheduledRepCommissionPayouts } from "./payments/scheduledRepCommissionPayouts";

// Seed + ops
// NOTE: `ping` is intentionally NOT exported — it was an unauthenticated,
// App-Check-off health endpoint callable by anyone, which is a free always-warm
// invocation surface for cost/DoS probing. Deploy success is verified via the
// Firebase console / CLI output instead. Keep it out of prod.
export { seedIntakeSchemas } from "./seed/seedIntakeSchemas";
export { bulkImportProspects } from "./seed/bulkImportProspects";

// Prospects — seeded-listing outreach (on a real client request) + claim flow.
// Claim is an authenticated callable gated on a VERIFIED email (magic-link
// sign-in), not a trigger trusting an attacker-writable email field.
export { requestProspectOutreach } from "./prospects/requestProspectOutreach";
// Admin-initiated, manually-reviewed "claim your free listing" outreach. The
// admin edits subject + message; the server appends the claim CTA + CASL footer
// and refuses to send unless the listing is sendable and outreach is configured.
export { sendProspectOutreach } from "./prospects/sendProspectOutreach";
// Branded email preview (admin) + the public profile-preview page data (/p/:id),
// shown to the prospect from the email and to admins via "Preview profile".
export { previewProspectOutreach } from "./prospects/previewProspectOutreach";
export { getProspectPreview } from "./prospects/getProspectPreview";
export { suppressProspect } from "./prospects/suppressProspect";
export { selfServeRemoveProspect } from "./prospects/selfServeRemoveProspect";
export { claimProspect } from "./prospects/claimProspect";
// Claim-during-signup: find your own seeded listing by name+town, then claim it
// by id (the scraped set has no email, so the email-hash path can't match).
export { findMyProspect } from "./prospects/findMyProspect";
export { claimProspectById } from "./prospects/claimProspectById";
export { scheduledProspectExpiry } from "./prospects/scheduledProspectExpiry";

// Vanity profile handle (Pro): claim/change blueseal.app/u/<slug>, uniqueness
// enforced via the profileSlugs registry.
export { claimProfileSlug } from "./profile/claimProfileSlug";

// Messaging (WhatsApp Cloud API queue processor)
export { processWhatsAppMessage } from "./messaging/processWhatsAppMessage";

// Diagnostics — client-side error telemetry for in-app admin visibility.
export { reportClientError } from "./diagnostics/reportClientError";

// Platform stats — public marketing counts (counts only) for the /pitch deck.
export { recomputePlatformStats } from "./stats/recomputePlatformStats";

// Google Business Profile — opt-in OAuth connect for verified tradespeople to
// surface their Google reviews on their public profile. Degrades gracefully:
// the callables throw "not configured" and the scheduled sync no-ops until the
// OAuth client + secrets are set (HUMANTASKS.md → "Google Business reviews").
export { startGoogleBusinessConnect } from "./google/startGoogleBusinessConnect";
export { googleOAuthCallback } from "./google/googleOAuthCallback";
export { syncGoogleReviews } from "./google/syncGoogleReviews";
export { disconnectGoogleBusiness } from "./google/disconnectGoogleBusiness";
export { scheduledGoogleReviewsSync } from "./google/scheduledGoogleReviewsSync";

// Vouches — peer endorsements between tradespeople
export { sendVouchRequest } from "./vouches/sendVouchRequest";
export { acceptVouchRequest } from "./vouches/acceptVouchRequest";
export { declineVouchRequest } from "./vouches/declineVouchRequest";
export { revokeVouch } from "./vouches/revokeVouch";
export { linkPendingVouchesOnSignup } from "./vouches/linkPendingVouchesOnSignup";

// Job-board marketplace
export { createJobPost } from "./jobPosts/createJobPost";
export { submitApplication } from "./jobPosts/submitApplication";
export { withdrawApplication } from "./jobPosts/withdrawApplication";
export { acceptApplication } from "./jobPosts/acceptApplication";
export { acceptApplicationQuote } from "./jobPosts/acceptApplicationQuote";
export { reviseApplication } from "./jobPosts/reviseApplication";
export { declineApplication } from "./jobPosts/declineApplication";
export { sendApplicationMessage } from "./jobPosts/sendApplicationMessage";
export { markApplicationThreadRead } from "./jobPosts/markApplicationThreadRead";
export { returnToApplicants } from "./jobPosts/returnToApplicants";
export { cancelJobPost } from "./jobPosts/cancelJobPost";
export { sendJobReferral } from "./jobPosts/sendJobReferral";
export { onJobPostCreated } from "./jobPosts/onJobPostCreated";
export { onJobPostClosed } from "./jobPosts/onJobPostClosed";
export { scheduledJobPostExpiry } from "./jobPosts/scheduledJobPostExpiry";
