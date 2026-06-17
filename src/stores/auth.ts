import { defineStore } from "pinia";
import {
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  isSignInWithEmailLink,
  onAuthStateChanged,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithEmailLink,
  signInWithPopup,
  signOut,
  updateProfile,
  type User,
} from "firebase/auth";
import { auth } from "@/firebase/config";
import {
  addRoleToSelf as callAddRoleToSelf,
  createUser,
  ensureSelfRoles as callEnsureSelfRoles,
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

// Uids we've already run the implied-role reconcile for this page-load, so
// repeated onAuthStateChanged fires (sign-in, token refresh) don't re-call the
// callable. A fresh page-load starts with an empty set, so a transient failure
// retries next session.
const impliedRolesAttempted = new Set<string>();

// Uids currently being provisioned by signUp / signInWithGoogle /
// completeEmailLinkSignIn. While a uid is in this set, applyAuthState's
// orphaned-account self-heal must NOT fire for it: onAuthStateChanged runs
// applyAuthState concurrently with the provisioning method, which would
// otherwise read the not-yet-written doc, declare an orphan, and write a
// racing `client` doc — clobbering the intended role and tripping the users
// update rule (duplicate createdAt) into permission-denied. Cleared in a
// finally so an exception can't strand the guard. A genuine orphan (returning
// user, empty set) still self-heals normally.
const provisioningUids = new Set<string>();

/**
 * Normalize a claim value into a Role[] regardless of which shape it arrives in.
 * Accepts the new `roles: string[]` claim and the legacy singular `role: string`.
 */
function rolesFromClaims(claims: Record<string, unknown>): Role[] {
  const raw = claims.roles;
  if (Array.isArray(raw)) {
    return raw.filter(
      (r): r is Role =>
        r === "client" || r === "tradesperson" || r === "admin" || r === "qa",
    );
  }
  const legacy = claims.role;
  if (
    legacy === "client" ||
    legacy === "tradesperson" ||
    legacy === "admin" ||
    legacy === "qa"
  ) {
    return [legacy];
  }
  return [];
}

/**
 * Provisions the user doc as the FIRST Firestore write of a freshly
 * authenticated session, retrying on `permission-denied`.
 *
 * That first write races the Auth→Firestore token handshake: the SDK can
 * dispatch the write before it has attached the new user's ID token (the same
 * race applyAuthState documents on its read). When it loses, the rules see
 * request.auth as null/stale, isOwner() fails, and Firestore rejects with
 * permission-denied — which the UI surfaced as "You don't have permission to
 * do that." on signup even though the Auth account had just been created (and
 * the verification email already sent). It's worse on iOS Safari / in-app
 * browsers (slow or storage-restricted) and when a stale prior session lingers
 * — exactly the contexts users hit it in.
 *
 * Minting a token first gives the Firestore SDK a credential to attach; the
 * retry (with a forced refresh + short backoff) then rides out the transient
 * window. A plain create-retry is safe: a rejected setDoc is rolled back
 * server-side so no doc is left behind, and applyAuthState's self-heal — the
 * only other writer of users/{uid} — is suppressed via provisioningUids for
 * the whole provisioning window, so there's no concurrent write to collide
 * with. Throws unchanged on any non-permission-denied error or once retries
 * are exhausted (a genuinely broken environment still surfaces).
 */
async function provisionUserDoc(
  user: User,
  args: Parameters<typeof createUser>[0],
): Promise<void> {
  await user.getIdToken();
  for (let attempt = 0; ; attempt++) {
    try {
      await createUser(args);
      return;
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code === "permission-denied" && attempt < 4) {
        await user.getIdToken(true);
        await new Promise<void>((resolve) => {
          setTimeout(resolve, 200 * (attempt + 1));
        });
        continue;
      }
      throw e;
    }
  }
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
    // "Holds the qa capability" — unlocks the /qa toolkit and the global
    // Report-a-bug button. There is no qa activeRole, so there's no `isQa`
    // view-mode getter to match isClient/isTradie/isAdmin.
    hasQaRole: (s) => s.roles.includes("qa"),
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
        let docReadOk = false;
        try {
          doc = await getUser(fbUser.uid);
          docReadOk = true;
        } catch {
          // Transient handshake failure — NOT a "doc is missing" signal. Leave
          // docReadOk false so the self-heal below can't fire against a doc
          // that may actually exist but was momentarily unreadable.
          doc = null;
        }
        // Self-heal an orphaned account: the read SUCCEEDED but no users/{uid}
        // doc exists. This strands a user when a signup's client-side doc write
        // is interrupted *after* the Auth account is already created (network
        // drop, closed tab) — the Auth record is durable but the profile never
        // landed, and the user can't recover on their own (re-signup fails with
        // email-already-in-use; signing in previously did nothing). Re-provision
        // with the default `client` role (they can add `tradesperson` later);
        // setRoleOnSignup then mirrors the role claim, and the divergence block
        // below refreshes the token to surface it. Also (re)send the verification
        // email the interrupted signup never got to. Guarded on docReadOk so a
        // transient read failure can never overwrite or race a live doc; bounded
        // to once per account since the next sign-in finds the doc.
        if (docReadOk && !doc && !provisioningUids.has(fbUser.uid)) {
          console.warn("[auth] orphaned account (no user doc) — self-healing", {
            uid: fbUser.uid,
          });
          try {
            await createUser({
              uid: fbUser.uid,
              email: fbUser.email ?? "",
              displayName: fbUser.displayName ?? fbUser.email?.split("@")[0] ?? "there",
              photoURL: fbUser.photoURL,
              role: "client",
              termsAcceptedVersion: LEGAL_VERSION,
            });
            await sendEmailVerification(fbUser).catch(() => {});
            doc = await getUser(fbUser.uid);
          } catch (e) {
            // Non-fatal: leave the session profile-less and let the next
            // sign-in retry rather than wedge init on a write failure.
            console.warn("[auth] self-heal of orphaned account failed", e);
          }
        }
        // Doc/claim divergence recovery. Rules read the token's `roles`
        // claim; the UI reads `doc.roles`. If the doc lists a role the
        // cached token's claim doesn't, the session is sitting on a stale
        // token (e.g. the user added a role via addRoleToSelf in a prior
        // session, then this device opened with an old cached token).
        // Force a refresh so subsequent Firestore writes go in against the
        // up-to-date claim. If the claim STILL doesn't match the doc after
        // the refresh, the server-side claim is genuinely missing (e.g.
        // setRoleOnSignup failed historically) — repair it via the
        // ensureSelfRoles reconciler, bounded to one attempt.
        const docRoles: Role[] = Array.isArray(doc?.roles)
          ? (doc.roles as unknown[]).filter(
              (r): r is Role =>
                r === "client" ||
                r === "tradesperson" ||
                r === "admin" ||
                r === "qa",
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
            // Server-side claim is genuinely missing (e.g. setRoleOnSignup
            // failed historically). ensureSelfRoles reconciles doc → claims;
            // refresh once more to surface the repaired claim. Bounded to one
            // attempt per applyAuthState — on failure, log and move on rather
            // than wedge session init.
            try {
              await callEnsureSelfRoles();
              tokenResult = await fbUser.getIdTokenResult(true);
              claimRoles = rolesFromClaims(
                tokenResult.claims as Record<string, unknown>,
              );
            } catch (e) {
              console.warn("[auth] server-side claim resync failed", {
                uid: fbUser.uid,
                docRoles,
                claimRoles,
                e,
              });
            }
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
        // Implied-role reconcile: a tradesperson is also a client (so they can
        // hire / post jobs without manually adding the role). Fire-and-forget
        // so it never blocks session bootstrap; it self-heals existing
        // tradesperson-only accounts and brand-new signups in the same session.
        void this.ensureImpliedRoles();
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
      // Guard applyAuthState's self-heal against racing our own createUser
      // below (see provisioningUids). Register the uid with no `await` between
      // the auth call and the add, so the concurrently-queued applyAuthState
      // sees it set.
      let provisioningUid: string | null = null;
      try {
        const cred = await createUserWithEmailAndPassword(auth, opts.email, opts.password);
        provisioningUid = cred.user.uid;
        provisioningUids.add(provisioningUid);
        await updateProfile(cred.user, { displayName: opts.displayName });
        await provisionUserDoc(cred.user, {
          uid: cred.user.uid,
          email: opts.email,
          displayName: opts.displayName,
          role: opts.role,
          termsAcceptedVersion: LEGAL_VERSION,
        });
        // setRoleOnSignup mirrors roles → claims via an async Firestore
        // trigger, which RACES the token refresh below — when the refresh
        // wins, the session caches a role-less token for ~1h and every
        // role-gated callable rejects ("Role client required") until reload.
        // ensureSelfRoles reconciles doc → claims synchronously, so the
        // refresh is guaranteed to pick the role up. On failure, fall back
        // to the optimistic local role; applyAuthState's divergence recovery
        // heals the token next page-load.
        let roles: Role[] = [opts.role];
        try {
          roles = (await callEnsureSelfRoles()).roles;
        } catch (e) {
          console.warn("[auth] claim reconcile at signup failed", e);
        }
        await cred.user.getIdToken(true);
        await sendEmailVerification(cred.user).catch(() => {});
        this.roles = roles;
        this.activeRole = opts.role;
      } catch (e) {
        this.error = (e as Error).message;
        throw e;
      } finally {
        if (provisioningUid) provisioningUids.delete(provisioningUid);
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

    /**
     * Returns `isNew: true` when the popup belonged to a brand-new account we
     * just provisioned with `intendedRole` — callers on the SIGN-IN page use
     * this to offer a role correction (a new tradesperson tapping "Continue
     * with Google" there would otherwise be silently created as a client).
     */
    async signInWithGoogle(intendedRole: Role = "client"): Promise<{ isNew: boolean }> {
      this.pending = true;
      this.error = null;
      // Guard applyAuthState's self-heal from racing our provisioning below
      // and overwriting the intended role with `client` (see provisioningUids).
      let provisioningUid: string | null = null;
      let isNew = false;
      try {
        const cred = await signInWithPopup(auth, new GoogleAuthProvider());
        provisioningUid = cred.user.uid;
        provisioningUids.add(provisioningUid);
        const existing = await getUser(cred.user.uid);
        if (!existing) {
          isNew = true;
          await provisionUserDoc(cred.user, {
            uid: cred.user.uid,
            email: cred.user.email ?? "",
            displayName: cred.user.displayName ?? "Anonymous",
            photoURL: cred.user.photoURL,
            role: intendedRole,
            termsAcceptedVersion: LEGAL_VERSION,
          });
          // Same trigger race as signUp: reconcile doc → claims synchronously
          // before refreshing so the new token carries the role.
          let roles: Role[] = [intendedRole];
          try {
            roles = (await callEnsureSelfRoles()).roles;
          } catch (e) {
            console.warn("[auth] claim reconcile at signup failed", e);
          }
          await cred.user.getIdToken(true);
          this.roles = roles;
          this.activeRole = intendedRole;
        }
      } catch (e) {
        this.error = (e as Error).message;
        throw e;
      } finally {
        if (provisioningUid) provisioningUids.delete(provisioningUid);
        this.pending = false;
      }
      return { isNew };
    },

    /**
     * Completes a Firebase email-link (magic-link) sign-in from the current
     * URL. Clicking the link proves the recipient controls that inbox and
     * signs them in with a VERIFIED email. Provisions a user doc on first
     * sign-in with the given role: the prospect-claim flow (/claim) provisions
     * tradespeople (the default, so that caller is unchanged); the job-invite
     * claim flow (/claim-job) provisions clients.
     */
    async completeEmailLinkSignIn(
      email: string,
      opts?: { role?: "tradesperson" | "client" },
    ): Promise<{ isNew: boolean }> {
      const role = opts?.role ?? "tradesperson";
      this.pending = true;
      this.error = null;
      // Guard applyAuthState's self-heal from racing our provisioning below
      // and overwriting the intended `tradesperson` role (see provisioningUids).
      let provisioningUid: string | null = null;
      try {
        const href = window.location.href;
        if (!isSignInWithEmailLink(auth, href)) {
          throw new Error("This sign-in link is invalid or has expired.");
        }
        const cred = await signInWithEmailLink(auth, email, href);
        provisioningUid = cred.user.uid;
        provisioningUids.add(provisioningUid);
        const existing = await getUser(cred.user.uid);
        let isNew = false;
        if (!existing) {
          isNew = true;
          await provisionUserDoc(cred.user, {
            uid: cred.user.uid,
            email: cred.user.email ?? email,
            displayName: cred.user.displayName ?? "",
            photoURL: cred.user.photoURL,
            role,
            termsAcceptedVersion: LEGAL_VERSION,
          });
          // Same trigger race as signUp: reconcile doc → claims synchronously
          // so the refresh below carries the roles claim, not just
          // email_verified.
          let roles: Role[] = [role];
          try {
            roles = (await callEnsureSelfRoles()).roles;
          } catch (e) {
            console.warn("[auth] claim reconcile at signup failed", e);
          }
          this.roles = roles;
          this.activeRole = role;
        }
        // Refresh the token so the verified-email claim is visible to the
        // claimProspect callable (which gates on email_verified) and the
        // roles claim is visible to role-gated rules + callables.
        await cred.user.getIdToken(true);
        return { isNew };
      } catch (e) {
        this.error = (e as Error).message;
        throw e;
      } finally {
        if (provisioningUid) provisioningUids.delete(provisioningUid);
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
     * Enforces the implied-role invariant (tradesperson ⇒ client) for the
     * current session. No-op unless the user holds `tradesperson` without
     * `client`, so it costs nothing for everyone else. The server callable
     * decides what to grant and preserves `activeRole`, so a tradesperson is
     * NOT flipped into client view — they just gain the ability to hire.
     *
     * Runs once per uid per page-load (see `impliedRolesAttempted`) and
     * fire-and-forget from applyAuthState, so a failure never wedges sign-in.
     */
    async ensureImpliedRoles() {
      const fbUser = this.fbUser;
      if (!fbUser) return;
      if (!this.roles.includes("tradesperson") || this.roles.includes("client")) return;
      if (impliedRolesAttempted.has(fbUser.uid)) return;
      impliedRolesAttempted.add(fbUser.uid);
      try {
        const result = await callEnsureSelfRoles();
        if (!result.changed) return;
        // Surface the new `client` claim to security rules immediately —
        // otherwise the next Firestore write / callable still sees the stale
        // token until the ~1h auto-refresh.
        await fbUser.getIdToken(true);
        this.roles = result.roles;
        if (this.user) this.user.roles = result.roles;
        // activeRole intentionally left as-is.
      } catch (e) {
        // Non-fatal: the user keeps their tradesperson role; next page-load
        // retries. Don't surface to the UI.
        console.warn("[auth] ensureImpliedRoles failed", e);
      }
    },

    /**
     * Adds the other public role (client ⇄ tradesperson) to the current user.
     * Calls the `addRoleToSelf` callable which provisions a draft tradie doc
     * when needed and updates the custom claims. Sets activeRole to the
     * newly-added role so the UI flips into the new view immediately.
     */
    async addRole(role: Exclude<Role, "admin" | "qa">) {
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
