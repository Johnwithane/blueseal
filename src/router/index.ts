import { createRouter, createWebHistory, type RouteRecordRaw } from "vue-router";
import { useAuthStore } from "@/stores/auth";
import type { Role } from "@/firebase/interfaces";

type RoleGuard = Role | "any";

// `meta.layout` selects which shell wraps the route:
//   - "public" (default if unset) → AppHeader/Footer marketing chrome
//   - "app"                       → AppShell (side panel + bottom nav)
//   - "chromeless"                → no chrome (onboarding wizard)
// `meta.title` is rendered as the page h1 by AppShell when layout is "app".
type LayoutKind = "public" | "app" | "chromeless";

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
    meta: { layout: "public" },
  },
  {
    path: "/tradies/:uid",
    name: "TradieProfile",
    component: () => import("@/views/TradieProfileView.vue"),
    meta: { layout: "public" },
  },
  {
    path: "/request/:uid",
    name: "RequestQuote",
    component: () => import("@/views/RequestQuoteView.vue"),
    meta: { requiresAuth: true, role: "client", layout: "app", title: "Request quote" },
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
    // sign-in only when the user hits "Post". Letting unauthed users into the
    // route is intentional — keep public chrome so the sign-in CTA stays.
    meta: { layout: "public" },
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
  scrollBehavior: () => ({ top: 0 }),
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
