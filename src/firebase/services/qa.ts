import { httpsCallable } from "firebase/functions";
import { functions } from "@/firebase/config";
import type { Role } from "@/firebase/interfaces";

// Client wiring for the self-serve QA toolkit callables. Every one of these acts
// ONLY on the signed-in caller's own account — none accept a target uid. They
// require the `qa` role (granted by an admin); the two provisioning calls are
// also env-gated server-side (QA_TOOLKIT_ENABLED).

/**
 * Provision the caller's own approved, visible tradesperson profile on the given
 * trades (and grant them the client + tradesperson + qa roles). After this
 * resolves, refresh the ID token so the new claims are live.
 */
export const qaProvisionSelfTradesperson = httpsCallable<
  { trades: string[] },
  { ok: boolean; roles: Role[]; trades: string[] }
>(functions, "qaProvisionSelfTradesperson");

/** Toggle the caller's own Blue Seal Pro entitlement (comp window) on/off. */
export const qaSetSelfPro = httpsCallable<
  { pro: boolean },
  { ok: boolean; isPro: boolean }
>(functions, "qaSetSelfPro");

/**
 * Tear down the caller's own jobs, job posts, and applications, and reset their
 * tradesperson profile to draft — so a flow can be re-run from a clean slate.
 */
export const qaResetSelfData = httpsCallable<
  Record<string, never>,
  { ok: boolean; deleted: { jobs: number; jobPosts: number; applications: number } }
>(functions, "qaResetSelfData");
