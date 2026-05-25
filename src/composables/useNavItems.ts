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
      // Side panel is daily-action focused: Jobs/Browse/Notifications/
      // Recommendations. Account + Payouts live behind the avatar profile
      // link at the bottom of the panel (and the mobile Profile tab),
      // which routes straight to /account. Browse sits before
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
          matches: (r) => r.path === "/dashboard" || r.path.startsWith("/dashboard/"),
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
          to: "/account/vouches",
          mobile: false,
          matches: exact("/account/vouches"),
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
          mobile: false,
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
          mobile: true,
          matches: prefix("/admin/disputes"),
        },
        {
          key: "users",
          label: "Users",
          icon: "pi-users",
          to: "/admin/users",
          mobile: true,
          matches: prefix("/admin/users"),
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
        mobile: true,
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
