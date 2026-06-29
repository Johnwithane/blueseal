import type { Role } from "@/firebase/interfaces";

// ---------------------------------------------------------------------------
// Single source of truth for how each role is labelled + iconned wherever the
// user switches their *view*: the header avatar menu (AppHeader), the side
// panel (RoleSwitcher), the Account page ("Your roles"), and the transition
// overlay (RoleSwitchOverlay).
//
// Before this, each of those four surfaces hardcoded its own label/icon map —
// and two of them only knew about client/tradesperson/admin, so the newer
// `sales` and `projectManager` views silently went missing from the header
// dropdown and the Account page. Add a new view-mode HERE once and it lights
// up across every switcher at the same time.
// ---------------------------------------------------------------------------

// Roles that map to an actual view-mode a user can switch into. `qa` is a
// capability claim (it unlocks the /qa toolkit), not a view — it never appears
// in a switcher, so it's excluded from this set.
export type ViewRole = Exclude<Role, "qa">;

export interface RoleViewMeta {
  label: string;
  /** Full PrimeIcons class, e.g. "pi pi-user". */
  icon: string;
}

// Exhaustive over Role so the lookup is total (the overlay animation is typed
// against the raw `Role`). `qa` carries a label/icon only to satisfy the type;
// it's filtered out of every switcher via VIEW_ROLE_ORDER below.
const META: Record<Role, RoleViewMeta> = {
  client: { label: "Client", icon: "pi pi-user" },
  tradesperson: { label: "Tradesperson", icon: "pi pi-wrench" },
  projectManager: { label: "Project manager", icon: "pi pi-briefcase" },
  sales: { label: "Sales", icon: "pi pi-map-marker" },
  admin: { label: "Admin", icon: "pi pi-shield" },
  qa: { label: "QA", icon: "pi pi-bug" },
};

// Canonical order for listing views in any switcher. Excludes qa, so it never
// surfaces as a view. Most-used views first; admin last (staff-only).
export const VIEW_ROLE_ORDER: ViewRole[] = [
  "client",
  "tradesperson",
  "projectManager",
  "sales",
  "admin",
];

/** Label + icon for a role. Total over Role (qa included) so callers needn't guard. */
export function roleViewMeta(role: Role): RoleViewMeta {
  return META[role];
}

/** The held roles that are switchable views, in canonical order. */
export function viewRolesFor(roles: readonly Role[]): ViewRole[] {
  return VIEW_ROLE_ORDER.filter((r) => roles.includes(r));
}
