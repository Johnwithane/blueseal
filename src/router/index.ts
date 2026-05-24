import { createRouter, createWebHistory, type RouteRecordRaw } from "vue-router";
import { useAuthStore } from "@/stores/auth";
import type { Role } from "@/firebase/interfaces";

type RoleGuard = Role | "any";

const routes: RouteRecordRaw[] = [
  {
    path: "/",
    name: "Home",
    component: () => import("@/views/HomeView.vue"),
  },
  {
    path: "/search",
    name: "Search",
    component: () => import("@/views/SearchView.vue"),
  },
  {
    path: "/tradies/:uid",
    name: "TradieProfile",
    component: () => import("@/views/TradieProfileView.vue"),
  },
  {
    path: "/request/:uid",
    name: "RequestQuote",
    component: () => import("@/views/RequestQuoteView.vue"),
    meta: { requiresAuth: true, role: "client" as RoleGuard },
  },

  // Legal
  { path: "/privacy", name: "Privacy", component: () => import("@/views/PrivacyView.vue") },
  { path: "/terms", name: "Terms", component: () => import("@/views/TermsView.vue") },

  // Auth
  { path: "/sign-in", name: "SignIn", component: () => import("@/views/auth/SignInView.vue") },
  { path: "/sign-up", name: "SignUp", component: () => import("@/views/auth/SignUpView.vue") },
  // Legacy path — tradie signup is now a toggle inside /sign-up.
  { path: "/sign-up/tradie", redirect: { name: "SignUp", query: { as: "tradesperson" } } },
  {
    path: "/forgot-password",
    name: "ForgotPassword",
    component: () => import("@/views/auth/ForgotPasswordView.vue"),
  },

  // Account
  {
    path: "/account",
    name: "Account",
    component: () => import("@/views/AccountView.vue"),
    meta: { requiresAuth: true, role: "any" as RoleGuard },
  },

  // Dashboards (role-gated)
  {
    path: "/dashboard",
    name: "Dashboard",
    component: () => import("@/views/DashboardEntry.vue"),
    meta: { requiresAuth: true, role: "any" as RoleGuard },
  },
  {
    path: "/dashboard/client",
    name: "ClientDashboard",
    component: () => import("@/views/dashboards/ClientDashboard.vue"),
    meta: { requiresAuth: true, role: "client" as RoleGuard },
  },
  {
    path: "/dashboard/tradie",
    name: "TradieDashboard",
    component: () => import("@/views/dashboards/TradieDashboard.vue"),
    meta: { requiresAuth: true, role: "tradesperson" as RoleGuard },
  },
  {
    path: "/dashboard/admin",
    name: "AdminDashboard",
    component: () => import("@/views/dashboards/AdminDashboard.vue"),
    meta: { requiresAuth: true, role: "admin" as RoleGuard },
  },

  // Tradesperson onboarding wizard
  {
    path: "/onboarding",
    name: "TradieOnboarding",
    component: () => import("@/views/tradie/OnboardingWizard.vue"),
    meta: { requiresAuth: true, role: "tradesperson" as RoleGuard },
  },

  // Payouts (Stripe Connect onboarding + dashboard link). /return + /refresh
  // mirror the redirect targets Stripe sends users to after the hosted form;
  // all three resolve to the same view (it shows a toast + replaces the URL).
  {
    path: "/payouts",
    name: "Payouts",
    component: () => import("@/views/payouts/PayoutsOnboardingView.vue"),
    meta: { requiresAuth: true, role: "tradesperson" as RoleGuard },
  },
  {
    path: "/payouts/return",
    name: "PayoutsReturn",
    component: () => import("@/views/payouts/PayoutsOnboardingView.vue"),
    meta: { requiresAuth: true, role: "tradesperson" as RoleGuard },
  },
  {
    path: "/payouts/refresh",
    name: "PayoutsRefresh",
    component: () => import("@/views/payouts/PayoutsOnboardingView.vue"),
    meta: { requiresAuth: true, role: "tradesperson" as RoleGuard },
  },

  // Job detail (tradies + clients)
  {
    path: "/jobs/:id",
    name: "JobDetail",
    component: () => import("@/views/JobDetailView.vue"),
    meta: { requiresAuth: true, role: "any" as RoleGuard },
  },

  // Job-board marketplace
  {
    path: "/jobs/post",
    name: "PostJob",
    component: () => import("@/views/PostJobView.vue"),
    // Auth-at-submit: the form persists draft to localStorage and bounces to
    // sign-in only when the user hits "Post". Letting unauthed users into the
    // route is intentional.
  },
  {
    path: "/jobs/browse",
    name: "BrowseJobs",
    component: () => import("@/views/BrowseJobsView.vue"),
    // isVisible:true gate handled inside the view so the unverified tradie
    // gets a "vetting in progress" message instead of a silent bounce.
    meta: { requiresAuth: true, role: "tradesperson" as RoleGuard },
  },
  {
    path: "/jobs/posted/:postId",
    name: "JobPostDetail",
    component: () => import("@/views/JobPostDetailView.vue"),
    meta: { requiresAuth: true, role: "any" as RoleGuard },
  },
  {
    path: "/my-applications",
    name: "MyApplications",
    component: () => import("@/views/MyApplicationsView.vue"),
    meta: { requiresAuth: true, role: "tradesperson" as RoleGuard },
  },

  // Admin sub-routes
  {
    path: "/admin/vetting",
    name: "AdminVetting",
    component: () => import("@/views/admin/VettingQueueView.vue"),
    meta: { requiresAuth: true, role: "admin" as RoleGuard },
  },
  {
    path: "/admin/applications/:uid",
    name: "AdminApplication",
    component: () => import("@/views/admin/ApplicationReviewView.vue"),
    meta: { requiresAuth: true, role: "admin" as RoleGuard },
  },
  {
    path: "/admin/site-content",
    name: "AdminSiteContent",
    component: () => import("@/views/admin/AdminSiteContentView.vue"),
    meta: { requiresAuth: true, role: "admin" as RoleGuard },
  },
  {
    path: "/admin/users",
    name: "AdminUserSearch",
    component: () => import("@/views/admin/AdminUserSearchView.vue"),
    meta: { requiresAuth: true, role: "admin" as RoleGuard },
  },

  // 404
  {
    path: "/:pathMatch(.*)*",
    name: "NotFound",
    component: () => import("@/views/NotFoundView.vue"),
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
    return { name: "SignIn", query: { redirect: to.fullPath } };
  }
  if (requiresAuth && requiredRole !== "any") {
    // Multi-role: gate on "do you have this role at all?", not "is it active?".
    // If the user holds the role but is currently viewing as a different one,
    // flip the active role automatically so the page they navigated to renders
    // in the right context (Airbnb-style auto-switch).
    if (!auth.roles.includes(requiredRole as Role)) {
      return { name: "Dashboard" };
    }
    if (auth.activeRole !== requiredRole) {
      await auth.switchActiveRole(requiredRole as Role).catch(() => {});
    }
  }
});

export default router;
