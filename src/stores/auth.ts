import { defineStore } from "pinia";
import {
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updateProfile,
  type User,
} from "firebase/auth";
import { auth } from "@/firebase/config";
import {
  addRoleToSelf as callAddRoleToSelf,
  createUser,
  getUser,
  setActiveRole as writeActiveRole,
} from "@/firebase/services/users";
import type { Role, UserDoc, WithId } from "@/firebase/interfaces";
import { LEGAL_VERSION } from "@/legal/version";
import { useRoleSwitchAnimationStore } from "@/stores/roleSwitchAnimation";

interface State {
  fbUser: User | null;
  user: WithId<UserDoc> | null;
  // Every role the user holds. Authoritative source for "can this user
  // access X?" checks; comes from the `roles` custom claim, falling back to
  // the user doc, falling back to the legacy singular `role` claim.
  roles: Role[];
  // Current view-mode. The UI renders this perspective; it can be any role
  // in `roles`. Persisted on the user doc so it stays consistent across devices.
  activeRole: Role | null;
  ready: boolean;
  pending: boolean;
  error: string | null;
}

// Single in-flight init promise: every caller (main.ts, router guard,
// DashboardEntry) awaits the same one. Without this, a second caller can hit
// an early-return AFTER the listener is attached but BEFORE the first callback
// has fired — leaving the guard to read `fbUser = null` and bounce a signed-in
// user to /sign-in.
let initPromise: Promise<void> | null = null;

/**
 * Normalize a claim value into a Role[] regardless of which shape it arrives in.
 * Accepts the new `roles: string[]` claim and the legacy singular `role: string`.
 */
function rolesFromClaims(claims: Record<string, unknown>): Role[] {
  const raw = claims.roles;
  if (Array.isArray(raw)) {
    return raw.filter(
      (r): r is Role => r === "client" || r === "tradesperson" || r === "admin",
    );
  }
  const legacy = claims.role;
  if (legacy === "client" || legacy === "tradesperson" || legacy === "admin") {
    return [legacy];
  }
  return [];
}

export const useAuthStore = defineStore("auth", {
  state: (): State => ({
    fbUser: null,
    user: null,
    roles: [],
    activeRole: null,
    ready: false,
    pending: false,
    error: null,
  }),

  getters: {
    isAuthenticated: (s) => !!s.fbUser,
    // "Currently viewing as X" — strictly follows activeRole so DashboardEntry
    // and other view-mode-driven UI behave correctly when an admin switches
    // into client or tradesperson view.
    isClient: (s) => s.activeRole === "client",
    isTradie: (s) => s.activeRole === "tradesperson",
    isAdmin: (s) => s.activeRole === "admin",
    // "Has the X role at all" — for offering switchers, CTAs, or admin-only
    // affordances that should stay visible regardless of the active view.
    hasClientRole: (s) => s.roles.includes("client"),
    hasTradieRole: (s) => s.roles.includes("tradesperson"),
    hasAdminRole: (s) => s.roles.includes("admin"),
    // True when the user holds more than one role — drives whether the
    // header avatar menu shows a switcher.
    canSwitchRole: (s) => s.roles.length > 1,
  },

  actions: {
    init(): Promise<void> {
      if (initPromise) return initPromise;
      initPromise = (async () => {
        // Wait for Firebase to load persisted auth state BEFORE attaching the
        // listener. Without this, onAuthStateChanged can fire once with `null`
        // (before persistence loads) and a second time with the user — which
        // resolves init() in the null state and lets the router redirect a
        // signed-in user to /sign-in.
        await auth.authStateReady();
        await this.applyAuthState(auth.currentUser);
        // From here on, keep state in sync with auth changes (sign-in,
        // sign-out, role refresh). The listener lives for the app lifetime,
        // so we don't hold the unsubscribe handle.
        onAuthStateChanged(auth, (fbUser) => {
          void this.applyAuthState(fbUser);
        });
      })();
      return initPromise;
    },

    async applyAuthState(fbUser: User | null) {
      this.fbUser = fbUser;
      if (fbUser) {
        let tokenResult = await fbUser.getIdTokenResult();
        let claimRoles = rolesFromClaims(
          tokenResult.claims as Record<string, unknown>,
        );
        // getUser() can throw permission-denied during the Firestore auth
        // handshake (the SDK's auth listener hasn't yet attached the token
        // when we fire the first request). Don't let that break init —
        // leave the user doc null and proceed; subsequent reads from views
        // will succeed once auth has fully propagated.
        let doc: WithId<UserDoc> | null = null;
        try {
          doc = await getUser(fbUser.uid);
        } catch {
          doc = null;
        }
        // Doc/claim divergence recovery. Rules read the token's `roles`
        // claim; the UI reads `doc.roles`. If the doc lists a role the
        // cached token's claim doesn't, the session is sitting on a stale
        // token (e.g. the user added a role via addRoleToSelf in a prior
        // session, then this device opened with an old cached token).
        // Force a refresh so subsequent Firestore writes go in against the
        // up-to-date claim. If the claim STILL doesn't match the doc after
        // the refresh, the server-side claim is genuinely missing (e.g.
        // setRoleOnSignup failed historically) — log so we can spot it and
        // resync server-side instead of looping forever.
        const docRoles: Role[] = Array.isArray(doc?.roles)
          ? (doc.roles as unknown[]).filter(
              (r): r is Role => r === "client" || r === "tradesperson" || r === "admin",
            )
          : [];
        const claimMissing = docRoles.some((r) => !claimRoles.includes(r));
        if (claimMissing) {
          tokenResult = await fbUser.getIdTokenResult(true);
          claimRoles = rolesFromClaims(
            tokenResult.claims as Record<string, unknown>,
          );
          const stillMissing = docRoles.some((r) => !claimRoles.includes(r));
          if (stillMissing) {
            console.warn(
              "[auth] doc/claim role mismatch persists after token refresh — server-side claim resync needed",
              { uid: fbUser.uid, docRoles, claimRoles },
            );
          }
        }
        // PIPEDA: refuse to seat the session for an account that's been
        // marked for deletion. Sign-out happens server-side via Firebase
        // Auth; the scheduledHardDelete sweep wipes the account fully
        // after the grace period. Recovery within the window is via
        // support (no self-serve un-delete by design).
        if (doc?.deletedAt) {
          this.error =
            "This account is scheduled for deletion. Reply to your confirmation email to recover it.";
          await signOut(auth);
          this.fbUser = null;
          this.user = null;
          this.roles = [];
          this.activeRole = null;
          this.ready = true;
          return;
        }
        this.user = doc;
        // Doc is authoritative for `roles` (claims can lag), but claims
        // are checked first so a fresh signup before the doc shim runs
        // still reports something useful.
        this.roles = doc?.roles?.length ? doc.roles : claimRoles;
        this.activeRole = doc?.activeRole ?? this.roles[0] ?? null;
      } else {
        this.user = null;
        this.roles = [];
        this.activeRole = null;
      }
      this.ready = true;
    },

    async signUp(opts: {
      email: string;
      password: string;
      displayName: string;
      role: Role;
    }) {
      this.pending = true;
      this.error = null;
      try {
        const cred = await createUserWithEmailAndPassword(auth, opts.email, opts.password);
        await updateProfile(cred.user, { displayName: opts.displayName });
        await createUser({
          uid: cred.user.uid,
          email: opts.email,
          displayName: opts.displayName,
          role: opts.role,
          termsAcceptedVersion: LEGAL_VERSION,
        });
        // Cloud Function `setRoleOnSignup` mirrors roles to a custom claim;
        // force a token refresh so the claim is visible right away.
        await cred.user.getIdToken(true);
        await sendEmailVerification(cred.user).catch(() => {});
        this.roles = [opts.role];
        this.activeRole = opts.role;
      } catch (e) {
        this.error = (e as Error).message;
        throw e;
      } finally {
        this.pending = false;
      }
    },

    async signIn(email: string, password: string) {
      this.pending = true;
      this.error = null;
      try {
        await signInWithEmailAndPassword(auth, email, password);
      } catch (e) {
        this.error = (e as Error).message;
        throw e;
      } finally {
        this.pending = false;
      }
    },

    async signInWithGoogle(intendedRole: Role = "client") {
      this.pending = true;
      this.error = null;
      try {
        const cred = await signInWithPopup(auth, new GoogleAuthProvider());
        const existing = await getUser(cred.user.uid);
        if (!existing) {
          await createUser({
            uid: cred.user.uid,
            email: cred.user.email ?? "",
            displayName: cred.user.displayName ?? "Anonymous",
            photoURL: cred.user.photoURL,
            role: intendedRole,
            termsAcceptedVersion: LEGAL_VERSION,
          });
          await cred.user.getIdToken(true);
          this.roles = [intendedRole];
          this.activeRole = intendedRole;
        }
      } catch (e) {
        this.error = (e as Error).message;
        throw e;
      } finally {
        this.pending = false;
      }
    },

    async signOut() {
      await signOut(auth);
    },

    async sendPasswordReset(email: string) {
      // Swallow user-not-found so we don't leak account existence — matches
      // the wrong-password / user-not-found handling in utils/errors.ts.
      try {
        await sendPasswordResetEmail(auth, email);
      } catch (e) {
        const code = (e as { code?: string }).code;
        if (code === "auth/user-not-found") return;
        throw e;
      }
    },

    async refreshClaims() {
      if (!this.fbUser) return;
      const tokenResult = await this.fbUser.getIdTokenResult(true);
      const next = rolesFromClaims(tokenResult.claims as Record<string, unknown>);
      if (next.length > 0) this.roles = next;
    },

    /**
     * Adds the other public role (client ⇄ tradesperson) to the current user.
     * Calls the `addRoleToSelf` callable which provisions a draft tradie doc
     * when needed and updates the custom claims. Sets activeRole to the
     * newly-added role so the UI flips into the new view immediately.
     */
    async addRole(role: Exclude<Role, "admin">) {
      if (!this.fbUser) throw new Error("Sign-in required");
      if (this.roles.includes(role)) {
        this.activeRole = role;
        return;
      }
      const result = await callAddRoleToSelf(role);
      // Refresh the token so the new `roles` claim is visible to rules
      // immediately (otherwise the next Firestore write would still see the
      // old claim until the next normal refresh, ~1h).
      await this.fbUser.getIdToken(true);
      this.roles = result.roles;
      this.activeRole = result.activeRole;
      // Re-read the user doc so any server-side fields stay in sync.
      this.user = await getUser(this.fbUser.uid);
    },

    /**
     * Flips the active view-mode. Only succeeds if the user already holds the
     * target role — call addRole() first if they don't.
     */
    async switchActiveRole(role: Role) {
      if (!this.fbUser) return;
      if (!this.roles.includes(role)) {
        throw new Error(`Cannot switch to ${role}: role not held.`);
      }
      if (this.activeRole === role) return;
      // Kick the animation BEFORE the persisted write + state flip so the
      // overlay covers any role-driven re-render underneath. All three
      // switch paths (manual menu, notification deep-link, router
      // auto-switch on a role-gated route) flow through here.
      useRoleSwitchAnimationStore().play(role);
      await writeActiveRole(this.fbUser.uid, role);
      this.activeRole = role;
      if (this.user) this.user.activeRole = role;
    },
  },
});
