import { defineStore } from "pinia";
import {
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendEmailVerification,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updateProfile,
  type User,
} from "firebase/auth";
import { auth } from "@/firebase/config";
import { createUser, getUser } from "@/firebase/services/users";
import type { Role, UserDoc, WithId } from "@/firebase/interfaces";
import { LEGAL_VERSION } from "@/legal/version";

interface State {
  fbUser: User | null;
  user: WithId<UserDoc> | null;
  role: Role | null;
  ready: boolean;
  pending: boolean;
  error: string | null;
}

let unsubscribe: (() => void) | null = null;

export const useAuthStore = defineStore("auth", {
  state: (): State => ({
    fbUser: null,
    user: null,
    role: null,
    ready: false,
    pending: false,
    error: null,
  }),

  getters: {
    isAuthenticated: (s) => !!s.fbUser,
    isClient: (s) => s.role === "client",
    isTradie: (s) => s.role === "tradesperson",
    isAdmin: (s) => s.role === "admin",
  },

  actions: {
    init(): Promise<void> {
      if (unsubscribe) return Promise.resolve();
      return new Promise((resolve) => {
        unsubscribe = onAuthStateChanged(auth, async (fbUser) => {
          this.fbUser = fbUser;
          if (fbUser) {
            const tokenResult = await fbUser.getIdTokenResult();
            const claimRole = tokenResult.claims.role as Role | undefined;
            const doc = await getUser(fbUser.uid);
            this.user = doc;
            this.role = claimRole ?? doc?.role ?? null;
          } else {
            this.user = null;
            this.role = null;
          }
          this.ready = true;
          resolve();
        });
      });
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
        // Cloud Function `setRoleOnSignup` mirrors role to a custom claim;
        // force a token refresh so the claim is visible right away.
        await cred.user.getIdToken(true);
        await sendEmailVerification(cred.user).catch(() => {});
        this.role = opts.role;
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

    async refreshClaims() {
      if (!this.fbUser) return;
      const tokenResult = await this.fbUser.getIdTokenResult(true);
      this.role = (tokenResult.claims.role as Role | undefined) ?? this.role;
    },
  },
});
