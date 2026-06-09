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
  {
    path: "/search",
    name: "Search",
    component: () => import("@/views/SearchView.vue"),
    // Hybrid: a signed-in client reaches Search from their app nav, so it
    // renders in the shell for them and the marketing chrome for visitors.
    meta: { layout: "hybrid" },
  },
  {
    // Shared public profile for both real tradespeople AND seeded prospects.
    // TradieProfileView resolves the :uid: a real tradesperson renders the full
    // verified layout; a seeded prospect renders the unverified ProspectProfile
    // body. One URL namespace — there is no separate /prospects/ route.
    path: "/tradies/:uid",
    name: "TradieProfile",
    component: () => import("@/views/TradieProfileView.vue"),
    // Hybrid: signed-in clients browse profiles from inside the app; visitors
    // see the public marketing chrome.
    meta: { layout: "hybrid" },
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

  // Prospect magic-link claim handler (lands here from the outreach email).
  {
    path: "/claim",
    name: "ProspectClaim",
    component: () => import("@/views/ClaimView.vue"),
    meta: { layout: "public" },
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
    path: "/forgot-password",
    name: "ForgotPassword",
    component: () => import("@/views/auth/ForgotPasswordView.vue"),
    meta: { layout: "public" },
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
    path: "/admin/site-content",
    name: "AdminSiteContent",
    component: () => import("@/views/admin/AdminSiteContentView.vue"),
    meta: { requiresAuth: true, role: "admin", layout: "app", title: "Site content" },
  },
  {
    path: "/admin/rebate-programs",
    name: "AdminRebatePrograms",
    component: () => import("@/views/admin/AdminRebateProgramsView.vue"),
    meta: { requiresAuth: true, role: "admin", layout: "app", title: "Rebate programs" },
  },
  {
    path: "/admin/users",
    name: "AdminUserSearch",
    component: () => import("@/views/admin/AdminUserSearchView.vue"),
    meta: { requiresAuth: true, role: "admin", layout: "app", title: "Users" },
  },
  {
    path: "/admin/disputes",
    name: "AdminDisputes",
    component: () => import("@/views/admin/DisputesQueueView.vue"),
    meta: { requiresAuth: true, role: "admin", layout: "app", title: "Disputes" },
  },
  {
    path: "/admin/support",
    name: "AdminSupport",
    component: () => import("@/views/admin/AdminSupportView.vue"),
    meta: { requiresAuth: true, role: "admin", layout: "app", title: "Support" },
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
  // scroll to the top.
  scrollBehavior: (_to, _from, savedPosition) => savedPosition ?? { top: 0 },
});

router.beforeEach(async (to) => {
  const auth = useAuthStore();
  if (!auth.ready) await auth.init();

  const requiresAuth = !!to.meta.requiresAuth;
  const requiredRole = (to.meta.role as RoleGuard | undefined) ?? "any";

  if (requiresAuth && !auth.isAuthenticated) {
    return { name: "Home" };
  }
  if (requiresAuth && requiredRole !== "any") {
    // Multi-role: gate on "do you have this role at all?", not "is it active?".
    // If the user holds the role but is currently viewing as a different one,
    // flip the active role automatically so the page they navigated to renders
    // in the right context (Airbnb-style auto-switch).
    if (!auth.roles.includes(requiredRole as Role)) {
      return { name: "Home" };
    }
    if (auth.activeRole !== requiredRole) {
      await auth.switchActiveRole(requiredRole as Role).catch(() => {});
    }
  }
});

export default router;
