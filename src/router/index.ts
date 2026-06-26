import { createRouter, createWebHistory, type RouteRecordRaw } from "vue-router";
import { useAuthStore } from "@/stores/auth";
import type { Role } from "@/firebase/interfaces";

type RoleGuard = Role | "any";

// `meta.layout` selects which shell wraps the route:
//   - "public" (default if unset) → AppHeader/Footer marketing chrome
//   - "app"                       → AppShell (side panel + bottom nav)
//   - "chromeless"                → no chrome (onboarding wizard)
//   - "hybrid"                    → AppShell when signed in, public chrome when
//                                   signed out. For crossover routes (search,
//                                   post-a-job, public profiles) that BOTH a
//                                   logged-out visitor and a signed-in user
//                                   reach — signed-in users stay in their app
//                                   shell instead of being ejected into the
//                                   marketing chrome mid-task. App.vue resolves
//                                   the effective layout from auth state.
// `meta.title` is rendered as the page h1 by AppShell when layout is "app".
type LayoutKind = "public" | "app" | "chromeless" | "hybrid";

declare module "vue-router" {
  interface RouteMeta {
    requiresAuth?: boolean;
    role?: RoleGuard;
    mobileCompact?: boolean;
    layout?: LayoutKind;
    title?: string;
  }
}

const routes: RouteRecordRaw[] = [
  {
    path: "/",
    name: "Home",
    component: () => import("@/views/HomeView.vue"),
    meta: { layout: "public" },
  },
  // Short vanity URLs printed on business cards (see src/utils/businessCard.ts).
  // /apply → tradesperson signup, /hire → client search. utm tags attribute the
  // typed-URL traffic (the QR codes carry their own per-card utm campaign).
  {
    path: "/apply",
    redirect: {
      path: "/sign-up",
      query: { as: "tradesperson", utm_source: "business_card", utm_medium: "print" },
    },
  },
  {
    path: "/hire",
    redirect: { path: "/search", query: { utm_source: "business_card", utm_medium: "print" } },
  },
  {
    // Referral landing: a rep's shareable link (blueseal.app/join?ref=CODE).
    // Drops into tradesperson signup with the code pre-filled + the free-month
    // banner. Preserves the ref code; tags the traffic as a referral.
    path: "/join",
    redirect: (to) => ({
      path: "/sign-up",
      query: {
        as: "tradesperson",
        utm_source: "referral",
        ...(typeof to.query.ref === "string" ? { ref: to.query.ref } : {}),
        // A project manager's recruiting link: blueseal.app/join?pm=CODE.
        ...(typeof to.query.pm === "string" ? { pm: to.query.pm } : {}),
      },
    }),
  },
  {
    path: "/search",
    name: "Search",
    component: () => import("@/views/SearchView.vue"),
    // Hybrid: a signed-in client reaches Search from their app nav, so it
    // renders in the shell for them and the marketing chrome for visitors.
    meta: { layout: "hybrid" },
  },
  {
    path: "/pricing",
    name: "Pricing",
    component: () => import("@/views/PricingView.vue"),
    // Hybrid: signed-in tradespeople reach it from their account; visitors see
    // the marketing chrome.
    meta: { layout: "hybrid", title: "Pricing" },
  },
  {
    // Shared public profile for both real tradespeople AND seeded prospects.
    // TradieProfileView resolves the :uid: a real tradesperson renders the full
    // verified layout; a seeded prospect renders the unverified ProspectProfile
    // body. One URL namespace — there is no separate /prospects/ route.
    path: "/tradies/:uid",
    name: "TradieProfile",
    component: () => import("@/views/TradieProfileView.vue"),
    // Chromeless: the profile is a full-page, standalone "company homepage" — no
    // app sidebar / bottom nav and no marketing chrome wrapping it. It carries
    // its own Back button + footer.
    meta: { layout: "chromeless" },
  },
  {
    // Vanity profile URL (Blue Seal Pro). Same view as /tradies/:uid, resolved
    // by handle: the component reads profileSlugs/<slug> for the uid. A profile
    // with a claimed slug redirects /tradies/:uid here.
    path: "/u/:slug",
    name: "TradieHome",
    component: () => import("@/views/TradieProfileView.vue"),
    meta: { layout: "chromeless" },
  },
  {
    // Public profile-preview for a seeded prospect, shown from the outreach
    // email (claim link rides in ?c=) and from the admin composer's preview.
    path: "/p/:id",
    name: "ProspectPreview",
    component: () => import("@/views/ProspectPreviewView.vue"),
    meta: { layout: "hybrid", title: "Profile preview" },
  },
  // Public trade landing pages (SEO discovery surface). Hybrid so a signed-in
  // user browsing trades stays in their app shell; visitors get marketing chrome.
  {
    path: "/trades",
    name: "TradesIndex",
    component: () => import("@/views/TradesIndexView.vue"),
    meta: { layout: "hybrid" },
  },
  {
    path: "/trades/:trade",
    name: "TradePage",
    component: () => import("@/views/TradePageView.vue"),
    meta: { layout: "hybrid" },
  },
  // City landing pages (local-SEO discovery surface for Okanagan towns).
  {
    path: "/cities",
    name: "CitiesIndex",
    component: () => import("@/views/CitiesIndexView.vue"),
    meta: { layout: "hybrid" },
  },
  {
    path: "/cities/:city",
    name: "CityPage",
    component: () => import("@/views/CityView.vue"),
    meta: { layout: "hybrid" },
  },
  {
    path: "/request/:uid",
    name: "RequestQuote",
    component: () => import("@/views/RequestQuoteView.vue"),
    meta: { requiresAuth: true, role: "client", layout: "app", title: "Request quote" },
  },
  {
    // Request a seeded (unverified) prospect → outreach + claim flow.
    path: "/request-prospect/:id",
    name: "RequestProspect",
    component: () => import("@/views/RequestProspectView.vue"),
    meta: { requiresAuth: true, role: "client", layout: "app", title: "Request" },
  },

  // Help Center / FAQ. Hybrid so a signed-in user reaching help from inside
  // the app stays in their shell, while visitors get the marketing chrome.
  {
    path: "/help",
    name: "HelpCenter",
    component: () => import("@/views/help/HelpCenterView.vue"),
    meta: { layout: "hybrid", title: "Help Center" },
  },
  {
    path: "/help/:slug",
    name: "HelpArticle",
    component: () => import("@/views/help/HelpArticleView.vue"),
    meta: { layout: "hybrid", title: "Help" },
  },
  {
    path: "/faq",
    name: "Faq",
    component: () => import("@/views/help/FaqView.vue"),
    meta: { layout: "hybrid", title: "FAQ" },
  },

  // Legal
  {
    path: "/privacy",
    name: "Privacy",
    component: () => import("@/views/PrivacyView.vue"),
    meta: { layout: "public" },
  },
  {
    path: "/terms",
    name: "Terms",
    component: () => import("@/views/TermsView.vue"),
    meta: { layout: "public" },
  },

  // Private investor / partner pitch. Chromeless (no app or marketing chrome),
  // password-gated in-view + noindex, and deliberately not linked anywhere.
  {
    path: "/pitch",
    name: "Pitch",
    component: () => import("@/views/PitchView.vue"),
    meta: { layout: "chromeless" },
  },

  // Prospect magic-link claim handler (lands here from the outreach email).
  {
    path: "/claim",
    name: "ProspectClaim",
    component: () => import("@/views/ClaimView.vue"),
    meta: { layout: "public" },
  },

  // Bring-your-own-client invite flow. /invite/:token is the copied/texted
  // link (confirm email → magic link sent); /claim-job is the magic-link
  // landing (signs the CLIENT in and attaches them to their job — distinct
  // from /claim, which provisions tradespeople).
  {
    path: "/invite/:token",
    name: "InviteLanding",
    component: () => import("@/views/InviteLandingView.vue"),
    meta: { layout: "public", title: "Your job on Blue Seal" },
  },
  {
    path: "/claim-job",
    name: "InviteClaim",
    component: () => import("@/views/InviteClaimView.vue"),
    meta: { layout: "public", title: "Join your job" },
  },

  // Auth
  {
    path: "/sign-in",
    name: "SignIn",
    component: () => import("@/views/auth/SignInView.vue"),
    meta: { layout: "public" },
  },
  {
    path: "/sign-up",
    name: "SignUp",
    component: () => import("@/views/auth/SignUpView.vue"),
    meta: { layout: "public" },
  },
  // Legacy path — tradie signup is now a toggle inside /sign-up.
  { path: "/sign-up/tradie", redirect: { name: "SignUp", query: { as: "tradesperson" } } },
  {
    // Forced role choice for a brand-new account created without an up-front
    // role pick (Google "Continue with Google" on /sign-in, and One Tap). The
    // /sign-up button already knows the role from its toggle and skips this.
    // Chromeless + requiresAuth: you only ever land here right after signing in.
    path: "/welcome",
    name: "Welcome",
    component: () => import("@/views/auth/WelcomeRoleView.vue"),
    meta: { requiresAuth: true, layout: "chromeless", title: "Welcome" },
  },
  {
    path: "/forgot-password",
    name: "ForgotPassword",
    component: () => import("@/views/auth/ForgotPasswordView.vue"),
    meta: { layout: "public" },
  },
  {
    // Completes a passwordless sign-in link (no password / no claim).
    path: "/finish-signin",
    name: "FinishSignIn",
    component: () => import("@/views/auth/FinishSignInView.vue"),
    meta: { layout: "public", title: "Signing in" },
  },

  // Account
  {
    path: "/account",
    name: "Account",
    component: () => import("@/views/AccountView.vue"),
    meta: { requiresAuth: true, role: "any", layout: "app", title: "Account" },
  },
  {
    // URL stays /account/recommendations (vouch invite emails, shared links rely on
    // the old path). Route NAME is renamed to match the user-facing label
    // — TradieProfileView already references `AccountRecommendations`.
    path: "/account/recommendations",
    name: "AccountRecommendations",
    component: () => import("@/views/AccountVouchesView.vue"),
    meta: {
      requiresAuth: true,
      role: "tradesperson",
      layout: "app",
      title: "Recommendations",
    },
  },

  // Dashboards (role-gated)
  {
    path: "/dashboard",
    name: "Dashboard",
    component: () => import("@/views/DashboardEntry.vue"),
    meta: { requiresAuth: true, role: "any", layout: "app", title: "Jobs" },
  },
  {
    path: "/dashboard/client",
    name: "ClientDashboard",
    component: () => import("@/views/dashboards/ClientDashboard.vue"),
    meta: { requiresAuth: true, role: "client", layout: "app", title: "Jobs" },
  },
  {
    path: "/dashboard/tradie",
    name: "TradieDashboard",
    component: () => import("@/views/dashboards/TradieDashboard.vue"),
    meta: { requiresAuth: true, role: "tradesperson", layout: "app", title: "Jobs" },
  },
  {
    path: "/dashboard/admin",
    name: "AdminDashboard",
    component: () => import("@/views/dashboards/AdminDashboard.vue"),
    meta: { requiresAuth: true, role: "admin", layout: "app", title: "Admin dashboard" },
  },
  {
    path: "/sales",
    name: "SalesDashboard",
    component: () => import("@/views/sales/SalesRepDashboardView.vue"),
    meta: { requiresAuth: true, role: "sales", layout: "app", title: "Sales" },
  },
  {
    path: "/sales/applications",
    name: "SalesApplications",
    component: () => import("@/views/sales/SalesApplicationsView.vue"),
    meta: { requiresAuth: true, role: "sales", layout: "app", title: "Applications" },
  },
  {
    path: "/sales/applications/:uid",
    name: "SalesApplicationReview",
    component: () => import("@/views/sales/SalesApplicationReviewView.vue"),
    meta: { requiresAuth: true, role: "sales", layout: "app", title: "Review application" },
  },
  // Rep earnings + Stripe Connect onboarding. /return + /refresh mirror Stripe's
  // hosted-form redirect targets (same view, toast, URL rewrite) — like the
  // tradesperson /payouts trio.
  {
    path: "/sales/payouts",
    name: "SalesPayouts",
    component: () => import("@/views/sales/SalesRepPayoutsView.vue"),
    meta: { requiresAuth: true, role: "sales", layout: "app", title: "Earnings & payouts" },
  },
  {
    path: "/sales/payouts/return",
    name: "SalesPayoutsReturn",
    component: () => import("@/views/sales/SalesRepPayoutsView.vue"),
    meta: { requiresAuth: true, role: "sales", layout: "app", title: "Earnings & payouts" },
  },
  {
    path: "/sales/payouts/refresh",
    name: "SalesPayoutsRefresh",
    component: () => import("@/views/sales/SalesRepPayoutsView.vue"),
    meta: { requiresAuth: true, role: "sales", layout: "app", title: "Earnings & payouts" },
  },
  {
    path: "/sales/resources",
    name: "SalesResources",
    component: () => import("@/views/sales/SalesResourcesView.vue"),
    meta: { requiresAuth: true, role: "sales", layout: "app", title: "Rep resources" },
  },

  // Project manager cockpit (real estate agents, property managers, landlords).
  // Self-serve role; the public profile + earning gate live in later phases.
  {
    path: "/manage",
    name: "ProjectManagerDashboard",
    component: () => import("@/views/manage/ProjectManagerDashboardView.vue"),
    meta: { requiresAuth: true, role: "projectManager", layout: "app", title: "Manage" },
  },

  // Tradesperson onboarding wizard
  {
    path: "/onboarding",
    name: "TradieOnboarding",
    component: () => import("@/views/tradie/OnboardingWizard.vue"),
    meta: { requiresAuth: true, role: "tradesperson", layout: "chromeless" },
  },

  // Payouts (Stripe Connect onboarding + dashboard link). /return + /refresh
  // mirror the redirect targets Stripe sends users to after the hosted form;
  // all three resolve to the same view (it shows a toast + replaces the URL).
  {
    path: "/payouts",
    name: "Payouts",
    component: () => import("@/views/payouts/PayoutsOnboardingView.vue"),
    meta: { requiresAuth: true, role: "tradesperson", layout: "app", title: "Payouts" },
  },
  {
    path: "/payouts/return",
    name: "PayoutsReturn",
    component: () => import("@/views/payouts/PayoutsOnboardingView.vue"),
    meta: { requiresAuth: true, role: "tradesperson", layout: "app", title: "Payouts" },
  },
  {
    path: "/payouts/refresh",
    name: "PayoutsRefresh",
    component: () => import("@/views/payouts/PayoutsOnboardingView.vue"),
    meta: { requiresAuth: true, role: "tradesperson", layout: "app", title: "Payouts" },
  },

  // Tradesperson-created job for an off-platform client ("bring your own
  // client"). Static path wins over /jobs/:id in route ranking.
  {
    path: "/jobs/new",
    name: "TradieNewJob",
    component: () => import("@/views/tradie/CreateJobView.vue"),
    meta: { requiresAuth: true, role: "tradesperson", layout: "app", title: "New job" },
  },

  // Job detail (tradies + clients)
  {
    path: "/jobs/:id",
    name: "JobDetail",
    component: () => import("@/views/JobDetailView.vue"),
    meta: {
      requiresAuth: true,
      role: "any",
      layout: "app",
      title: "Job",
      // Hide global chrome on mobile so the tab bar can stick to the top
      // edge and the chat composer / sticky CTA have room. The in-view
      // "← Dashboard" link handles back nav; the side panel + bottom nav
      // stay visible on tablet/desktop.
      mobileCompact: true,
    },
  },

  // Invoice payment (client) + receipt (both parties). Both gated as
  // `any` role rather than `client` because: (a) the receipt view is
  // useful to the tradesperson too, and (b) Stripe's `return_url`
  // redirect can land before the auto-role-switch settles — the view's
  // own `isParty` check is the real authorization.
  {
    path: "/invoices/:id/pay",
    name: "InvoicePay",
    component: () => import("@/views/invoices/InvoicePayView.vue"),
    meta: { requiresAuth: true, role: "any", layout: "app", title: "Pay invoice" },
  },
  {
    path: "/invoices/:id/receipt",
    name: "InvoiceReceipt",
    component: () => import("@/views/invoices/InvoiceReceiptView.vue"),
    meta: { requiresAuth: true, role: "any", layout: "app", title: "Receipt" },
  },
  {
    path: "/jobs/:id/upfront/pay",
    name: "UpfrontFeePay",
    component: () => import("@/views/jobs/UpfrontFeePayView.vue"),
    meta: { requiresAuth: true, role: "any", layout: "app", title: "Pay upfront fee" },
  },
  {
    path: "/reports",
    name: "Reports",
    component: () => import("@/views/ReportsView.vue"),
    meta: { requiresAuth: true, role: "tradesperson", layout: "app", title: "Reports" },
  },

  // Client book detail (CRM — Blue Seal Pro). The Clients LIST is a tab in the
  // tradesperson dashboard (/dashboard?view=clients); this is the per-contact
  // page reached from that list. Pro-gated in-view.
  {
    path: "/clients/:id",
    name: "ClientDetail",
    component: () => import("@/views/ClientDetailView.vue"),
    meta: { requiresAuth: true, role: "tradesperson", layout: "app", title: "Client" },
  },

  // Job-board marketplace
  {
    path: "/jobs/post",
    name: "PostJob",
    component: () => import("@/views/PostJobView.vue"),
    // Auth-at-submit: the form persists draft to localStorage and bounces to
    // sign-in only when the user hits "Post". Hybrid layout keeps the sign-in
    // CTA + marketing chrome for visitors, but a signed-in user posting a job
    // stays inside their app shell instead of being kicked to public chrome.
    meta: { layout: "hybrid" },
  },
  {
    path: "/jobs/browse",
    name: "BrowseJobs",
    component: () => import("@/views/BrowseJobsView.vue"),
    // isVisible:true gate handled inside the view so the unverified tradie
    // gets a "vetting in progress" message instead of a silent bounce.
    meta: {
      requiresAuth: true,
      role: "tradesperson",
      layout: "app",
      title: "Browse jobs",
    },
  },
  {
    path: "/jobs/posted/:postId",
    name: "JobPostDetail",
    component: () => import("@/views/JobPostDetailView.vue"),
    meta: { requiresAuth: true, role: "any", layout: "app", title: "Job post" },
  },
  {
    path: "/my-applications",
    name: "MyApplications",
    component: () => import("@/views/MyApplicationsView.vue"),
    meta: {
      requiresAuth: true,
      role: "tradesperson",
      layout: "app",
      title: "My applications",
    },
  },

  // Admin sub-routes
  {
    path: "/admin/vetting",
    name: "AdminVetting",
    component: () => import("@/views/admin/VettingQueueView.vue"),
    meta: { requiresAuth: true, role: "admin", layout: "app", title: "Vetting queue" },
  },
  {
    path: "/admin/applications/:uid",
    name: "AdminApplication",
    component: () => import("@/views/admin/ApplicationReviewView.vue"),
    meta: {
      requiresAuth: true,
      role: "admin",
      layout: "app",
      title: "Application review",
    },
  },
  {
    path: "/admin/onboarding",
    name: "AdminOnboarding",
    component: () => import("@/views/admin/IncompleteOnboardingView.vue"),
    meta: { requiresAuth: true, role: "admin", layout: "app", title: "Incomplete signups" },
  },
  {
    path: "/admin/site-content",
    name: "AdminSiteContent",
    component: () => import("@/views/admin/AdminSiteContentView.vue"),
    meta: { requiresAuth: true, role: "admin", layout: "app", title: "Site content" },
  },
  {
    path: "/admin/business-cards",
    name: "AdminBusinessCards",
    component: () => import("@/views/admin/AdminBusinessCardGeneratorView.vue"),
    meta: { requiresAuth: true, role: "admin", layout: "app", title: "Business cards" },
  },
  {
    path: "/admin/rebate-programs",
    name: "AdminRebatePrograms",
    component: () => import("@/views/admin/AdminRebateProgramsView.vue"),
    meta: { requiresAuth: true, role: "admin", layout: "app", title: "Rebate programs" },
  },
  {
    path: "/admin/regions",
    name: "AdminRegions",
    component: () => import("@/views/admin/AdminRegionsView.vue"),
    meta: { requiresAuth: true, role: "admin", layout: "app", title: "Sales regions" },
  },
  {
    path: "/admin/sales-reps",
    name: "AdminSalesReps",
    component: () => import("@/views/admin/AdminSalesRepsView.vue"),
    meta: { requiresAuth: true, role: "admin", layout: "app", title: "Sales reps" },
  },
  {
    path: "/admin/jobs",
    name: "AdminJobs",
    component: () => import("@/views/admin/AdminJobsView.vue"),
    meta: { requiresAuth: true, role: "admin", layout: "app", title: "Jobs & postings" },
  },
  {
    path: "/admin/users",
    name: "AdminUserSearch",
    component: () => import("@/views/admin/AdminUserSearchView.vue"),
    meta: { requiresAuth: true, role: "admin", layout: "app", title: "Users" },
  },
  {
    path: "/admin/users/:uid",
    name: "AdminUserDetail",
    component: () => import("@/views/admin/AdminUserDetailView.vue"),
    meta: { requiresAuth: true, role: "admin", layout: "app", title: "User 360" },
  },
  {
    path: "/admin/disputes",
    name: "AdminDisputes",
    component: () => import("@/views/admin/DisputesQueueView.vue"),
    meta: { requiresAuth: true, role: "admin", layout: "app", title: "Disputes" },
  },
  {
    path: "/admin/prospects",
    name: "AdminProspects",
    component: () => import("@/views/admin/AdminProspectsView.vue"),
    meta: { requiresAuth: true, role: "admin", layout: "app", title: "Prospect outreach" },
  },
  {
    path: "/admin/support",
    name: "AdminSupport",
    component: () => import("@/views/admin/AdminSupportView.vue"),
    meta: { requiresAuth: true, role: "admin", layout: "app", title: "Support" },
  },
  {
    path: "/admin/errors",
    name: "AdminErrors",
    component: () => import("@/views/admin/AdminErrorsView.vue"),
    meta: { requiresAuth: true, role: "admin", layout: "app", title: "Error log" },
  },
  {
    path: "/admin/bug-reports",
    name: "AdminBugReports",
    component: () => import("@/views/admin/AdminBugReportsView.vue"),
    meta: { requiresAuth: true, role: "admin", layout: "app", title: "Bug reports" },
  },
  {
    // Self-serve QA toolkit. Gated on holding the qa capability (granted only by
    // an admin). qa is NOT a view-mode, so the guard below deliberately does not
    // auto-switch activeRole into it.
    path: "/qa",
    name: "QaToolkit",
    component: () => import("@/views/qa/QaToolkitView.vue"),
    meta: { requiresAuth: true, role: "qa", layout: "app", title: "QA toolkit" },
  },
  {
    path: "/admin/disputes/:id",
    name: "AdminDisputeDetail",
    component: () => import("@/views/admin/DisputeDetailView.vue"),
    meta: { requiresAuth: true, role: "admin", layout: "app", title: "Dispute" },
  },

  // 404
  {
    path: "/:pathMatch(.*)*",
    name: "NotFound",
    component: () => import("@/views/NotFoundView.vue"),
    meta: { layout: "public" },
  },
];

const router = createRouter({
  history: createWebHistory(),
  routes,
  // Restore the previous scroll position on back/forward (so returning to the
  // search results from a profile lands where you left off); fresh navigations
  // scroll to the top. In-page anchors (e.g. the help "Contact support" button
  // → /help#contact) scroll to the target element, cleared of the fixed header
  // — without this the hash was ignored and the page just jumped to the top,
  // which read as a pointless reload of the help center.
  scrollBehavior: (to, _from, savedPosition) => {
    if (to.hash) {
      return new Promise((resolve) =>
        // Wait a tick so the destination view (often a freshly-mounted
        // component) has rendered the anchor before we scroll to it.
        setTimeout(() => resolve({ el: to.hash, top: 80, behavior: "smooth" }), 120),
      );
    }
    return savedPosition ?? { top: 0 };
  },
});

router.beforeEach(async (to) => {
  const auth = useAuthStore();
  if (!auth.ready) await auth.init();

  const requiresAuth = !!to.meta.requiresAuth;
  const requiredRole = (to.meta.role as RoleGuard | undefined) ?? "any";

  if (requiresAuth && !auth.isAuthenticated) {
    // Preserve where they were headed (e.g. a notification deep link) so sign-in
    // drops them right back there instead of on Home.
    return { name: "SignIn", query: { redirect: to.fullPath } };
  }
  if (requiresAuth && requiredRole !== "any") {
    // Multi-role: gate on "do you have this role at all?", not "is it active?".
    // If the user holds the role but is currently viewing as a different one,
    // flip the active role automatically so the page they navigated to renders
    // in the right context (Airbnb-style auto-switch).
    if (!auth.roles.includes(requiredRole as Role)) {
      return { name: "Home" };
    }
    // qa is a capability claim, not a view-mode — gate on holding it (above) but
    // never flip the active view into qa (there is no qa dashboard to render).
    if (requiredRole !== "qa" && auth.activeRole !== requiredRole) {
      await auth.switchActiveRole(requiredRole as Role).catch(() => {});
    }
  }
});

export default router;
