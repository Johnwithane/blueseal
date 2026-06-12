import { computed, type ComputedRef } from "vue";
import { useRoute, type RouteLocationNormalizedLoaded } from "vue-router";
import { useAuthStore } from "@/stores/auth";

export interface NavItem {
  key: string;
  label: string;
  // Shorter label for the mobile bottom bar where 5 tabs share ~75px each.
  // Falls back to `label` if not set.
  mobileLabel?: string;
  // PrimeIcons class (e.g. "pi pi-home"). Convention: just the icon name part
  // without the "pi " prefix so callers can compose `pi {{ item.icon }}`.
  icon: string;
  to: string;
  // True when the item should appear in the mobile bottom bar. The side panel
  // shows everything regardless of this flag.
  mobile: boolean;
  // Active-state predicate. Defaults to exact path match. For grouped routes
  // (e.g. /admin/disputes/:id under "Disputes") pass a prefix.
  matches?: (route: RouteLocationNormalizedLoaded) => boolean;
}

function exact(path: string) {
  return (r: RouteLocationNormalizedLoaded) => r.path === path;
}

function prefix(path: string) {
  // Match the path itself or anything below it. Add a trailing "/" check so
  // "/account" doesn't match "/accountants" if that ever exists.
  return (r: RouteLocationNormalizedLoaded) =>
    r.path === path || r.path.startsWith(path + "/");
}

// "Jobs" should stay highlighted whenever the user is on the dashboard OR
// inside a job (the per-job kanban /jobs/:id and the client's posted-job
// review /jobs/posted/:postId) — those are reached *from* the Jobs list.
// Excludes /jobs/post and /jobs/browse, which have their own nav items.
function jobsMatcher(r: RouteLocationNormalizedLoaded): boolean {
  if (r.path === "/dashboard" || r.path.startsWith("/dashboard/")) {
    // The Clients tab lives at /dashboard?view=clients and has its own nav
    // item — don't also light up "Jobs" there.
    return r.query.view !== "clients";
  }
  if (r.path === "/jobs/post" || r.path === "/jobs/browse" || r.path === "/jobs/new")
    return false;
  return r.path.startsWith("/jobs/");
}

/**
 * Role-aware nav-item source. The side panel and bottom bar both consume this
 * — the bottom bar filters down to items with `mobile: true`. Items are
 * keyed off `auth.activeRole`, so switching role re-renders the nav.
 *
 * Ordering rule (consistent across roles): the user's "home" first, then
 * Notifications (high-frequency check-in like Instagram), then the daily-use
 * destinations, then settings-ish stuff (money/network), with Account always
 * last. The "Profile" entry is rendered as the trailing slot on both shells
 * — it opens the ProfileMenu rather than navigating, so it isn't an item
 * here.
 */
export function useNavItems(): {
  sideItems: ComputedRef<NavItem[]>;
  mobileItems: ComputedRef<NavItem[]>;
  isActive: (item: NavItem) => boolean;
} {
  const auth = useAuthStore();
  const route = useRoute();

  const sideItems = computed<NavItem[]>(() => {
    if (!auth.isAuthenticated) return [];

    if (auth.activeRole === "tradesperson") {
      // Side panel is daily-action focused: Jobs/Browse/Profile/
      // Notifications/Recommendations. Profile is duplicated here (it also
      // appears as the avatar at the bottom of the panel) because tradies
      // wanted a labelled row in the main list — the avatar alone was easy
      // to miss. On mobile the bottom bar already has a Profile tab, so
      // this row is desktop-only (`mobile: false`). Browse sits before
      // Notifications so the bottom-bar order reads Jobs → Browse →
      // Alerts → Profile, putting work-acquisition actions ahead of
      // passive notifications.
      return [
        {
          key: "dashboard",
          label: "Jobs",
          icon: "pi-home",
          to: "/dashboard",
          mobile: true,
          matches: jobsMatcher,
        },
        // Bring-your-own-client job creation. Mirrors the title-row "New job"
        // button on the dashboard; desktop side-panel only (`mobile: false`)
        // so the mobile bottom bar stays Jobs → Browse → Alerts → Profile.
        {
          key: "new-job",
          label: "New job",
          icon: "pi-plus",
          to: "/jobs/new",
          mobile: false,
          matches: exact("/jobs/new"),
        },
        {
          key: "browse",
          label: "Browse jobs",
          mobileLabel: "Browse",
          icon: "pi-megaphone",
          to: "/jobs/browse",
          mobile: true,
          matches: prefix("/jobs/browse"),
        },
        // Clients book (CRM + recurring billing — Blue Seal Pro). Desktop
        // side-panel shortcut to the dashboard's Clients tab; on mobile the
        // tab itself (in TradieDashboard) is the entry point, so this row is
        // desktop-only (`mobile: false`). Highlights on the tab or any
        // /clients/:id detail page.
        {
          key: "clients",
          label: "Clients",
          icon: "pi-users",
          to: "/dashboard?view=clients",
          mobile: false,
          matches: (r) =>
            (r.path.startsWith("/dashboard") && r.query.view === "clients") ||
            r.path.startsWith("/clients"),
        },
        // Profile is reachable via the ProfileMenu avatar at the bottom of the
        // side panel (desktop) and the Profile tab on mobile — it used to be
        // duplicated as an explicit row here, which no other role had. Removed
        // so the nav schema is consistent across roles.
        {
          key: "notifications",
          label: "Notifications",
          mobileLabel: "Alerts",
          icon: "pi-bell",
          to: "",
          mobile: true,
          matches: () => false,
        },
        // Applied is no longer its own nav destination — it's a view inside
        // Jobs (the SelectButton in TradieDashboard). The standalone
        // /my-applications route is kept alive for notification deep-links
        // and shared URLs but doesn't surface in the nav.
        {
          key: "vouches",
          label: "Recommendations",
          icon: "pi-verified",
          to: "/account/recommendations",
          mobile: false,
          matches: exact("/account/recommendations"),
        },
        // Earnings / job reports. Desktop side-panel only, like the dashboard
        // header button it mirrors.
        {
          key: "reports",
          label: "Reports",
          icon: "pi-chart-bar",
          to: "/reports",
          mobile: false,
          matches: exact("/reports"),
        },
        // Account + Payouts moved into ProfileMenu (avatar at bottom of side
        // panel / Profile tab on mobile). The standalone /account and
        // /payouts routes still work — they're just not surfaced in the
        // side panel to avoid duplicating the menu.
      ];
    }

    if (auth.activeRole === "admin") {
      // Admin keeps "Dashboard" (the admin console is broader than just jobs).
      return [
        {
          key: "dashboard",
          label: "Dashboard",
          icon: "pi-home",
          to: "/dashboard",
          // Admin's home now appears in the mobile bottom bar too — previously
          // it was desktop-only, leaving mobile admins with no tab back to
          // their dashboard (only the brand logo, which used to eject them).
          mobile: true,
          matches: (r) => r.path === "/dashboard" || r.path.startsWith("/dashboard/"),
        },
        {
          key: "notifications",
          label: "Notifications",
          mobileLabel: "Alerts",
          icon: "pi-bell",
          to: "",
          mobile: true,
          matches: () => false,
        },
        {
          key: "vetting",
          label: "Vetting queue",
          mobileLabel: "Vetting",
          icon: "pi-shield",
          to: "/admin/vetting",
          mobile: true,
          // Application review pages live under /admin/applications/:uid but
          // are reached from the vetting queue — highlight Vetting there too.
          matches: (r) =>
            r.path.startsWith("/admin/vetting") || r.path.startsWith("/admin/applications"),
        },
        {
          key: "disputes",
          label: "Disputes",
          icon: "pi-flag",
          to: "/admin/disputes",
          // Desktop-only in the side panel; on mobile it's reached from the
          // dashboard, keeping the bottom bar to Dashboard + Vetting + Alerts.
          mobile: false,
          matches: prefix("/admin/disputes"),
        },
        {
          key: "users",
          label: "Users",
          icon: "pi-users",
          to: "/admin/users",
          // Desktop-only: Dashboard took its mobile slot (above) to keep the
          // bottom bar at 4 tabs + brand + profile rather than overflowing.
          // User search is a desktop-leaning task anyway.
          mobile: false,
          matches: prefix("/admin/users"),
        },
        {
          key: "support",
          label: "Support",
          icon: "pi-question-circle",
          to: "/admin/support",
          mobile: false,
          matches: prefix("/admin/support"),
        },
        {
          key: "site-content",
          label: "Site content",
          icon: "pi-file-edit",
          to: "/admin/site-content",
          mobile: false,
          matches: prefix("/admin/site-content"),
        },
        // Account moved into ProfileMenu (bottom of side panel / mobile
        // Profile tab) so it doesn't duplicate the avatar dropdown.
      ];
    }

    // Default = client view (also covers null activeRole during auth init).
    return [
      {
        key: "dashboard",
        label: "Jobs",
        icon: "pi-home",
        to: "/dashboard",
        mobile: true,
        matches: jobsMatcher,
      },
      {
        key: "notifications",
        label: "Notifications",
        mobileLabel: "Alerts",
        icon: "pi-bell",
        to: "",
        mobile: true,
        matches: () => false,
      },
      {
        key: "search",
        label: "Find tradesperson",
        mobileLabel: "Search",
        icon: "pi-search",
        to: "/search",
        mobile: true,
        matches: prefix("/search"),
      },
      {
        key: "post-job",
        label: "Post a job",
        mobileLabel: "Post",
        icon: "pi-megaphone",
        to: "/jobs/post",
        // Desktop-only in the side panel; on mobile it's reached from inside
        // Jobs, keeping the bottom bar to Jobs + Search + Alerts.
        mobile: false,
        matches: exact("/jobs/post"),
      },
      // Account moved into ProfileMenu — see the tradesperson and admin
      // notes above. Same logic across all three roles.
    ];
  });

  const mobileItems = computed<NavItem[]>(() =>
    sideItems.value.filter((i) => i.mobile),
  );

  function isActive(item: NavItem): boolean {
    if (item.matches) return item.matches(route);
    return route.path === item.to;
  }

  return { sideItems, mobileItems, isActive };
}
