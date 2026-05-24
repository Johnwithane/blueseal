// Shared helpers for Firestore rules tests. Each spec calls `setupTestEnv()`
// in `beforeAll`, gets back a `RulesTestEnvironment`, and uses
// `withSecurityRulesDisabled` to seed baseline docs + `authenticatedContext`
// to act as a user under the live rules.
//
// Project id is hardcoded to a `demo-` prefix so the emulator never reaches
// the real Firebase project, even if the caller forgets to pass `--project`.

import {
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rulesPath = resolve(__dirname, "..", "..", "firestore.rules");

export const PROJECT_ID = "demo-blueseal-rules";

export async function setupTestEnv(): Promise<RulesTestEnvironment> {
  return initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: readFileSync(rulesPath, "utf8"),
      host: "127.0.0.1",
      port: 8080,
    },
  });
}

// Common uids — keeps each spec readable. Anything starting with `other-`
// is the same role as the un-prefixed version but a different identity.
export const ADMIN_UID = "admin-uid";
export const TRADIE_UID = "tradie-uid";
export const OTHER_TRADIE_UID = "other-tradie-uid";
export const CLIENT_UID = "client-uid";
export const OTHER_CLIENT_UID = "other-client-uid";

// Custom-claim shapes mirroring the production setAdminRole / signup paths:
// both the new `roles: string[]` and the legacy single `role` are set so
// rules' hasRole() helper (which accepts either) matches reality.
export const ADMIN_CLAIMS = { roles: ["admin"], role: "admin" };
export const TRADIE_CLAIMS = { roles: ["tradesperson"], role: "tradesperson" };
export const CLIENT_CLAIMS = { roles: ["client"], role: "client" };
