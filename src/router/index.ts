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

  // Job detail (tradies + clients)
  {
    path: "/jobs/:id",
    name: "JobDetail",
    component: () => import("@/views/JobDetailView.vue"),
    meta: { requiresAuth: true, role: "any" as RoleGuard },
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
  if (requiresAuth && requiredRole !== "any" && auth.role !== requiredRole) {
    // Wrong role — bounce to their own dashboard entry.
    return { name: "Dashboard" };
  }
});

export default router;
