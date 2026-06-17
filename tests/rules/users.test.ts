// users/{userId} — owner self-edit rule. Regression coverage for the
// "legacy doc missing a field locks the owner out" bug: the /users update
// rule does positive equality checks on a bunch of server-managed fields,
// and accounts created before any of those fields existed used to throw
// "Property foo is undefined" inside the rule evaluator. Firestore surfaces
// that to the client as `permission-denied`, so an older account couldn't
// edit their display name, photo, phone, or bio. The fix wraps each check
// in `.get(field, null)` so missing-on-both-sides compares equal; this spec
// pins that behavior plus the field-lock invariants that still apply.
//
// Mirrors tests/rules/tradespeople.test.ts shape — same uid + claim helpers
// from setup.ts, same beforeEach clearFirestore pattern.

import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";
import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { doc, serverTimestamp, setDoc, updateDoc } from "firebase/firestore";

import {
  CLIENT_CLAIMS,
  CLIENT_UID,
  OTHER_CLIENT_UID,
  setupTestEnv,
} from "./setup";

let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await setupTestEnv();
});

afterAll(async () => {
  await env.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();
});

// Canonical post-cutover user doc — every field the rules reference.
const canonicalUser = {
  roles: ["client"],
  activeRole: "client",
  displayName: "Sam Client",
  email: "sam@example.com",
  photoURL: null,
  phone: null,
  bio: null,
  createdAt: serverTimestamp(),
  lastActiveAt: serverTimestamp(),
  emailVerified: false,
  clientRatingAvg: 0,
  clientRatingCount: 0,
  termsAcceptedAt: serverTimestamp(),
  termsAcceptedVersion: "1.0.0",
  deletedAt: null,
  notificationPrefs: { emailEnabled: true, whatsappEnabled: true },
};

// Pre-PIPEDA / pre-monetization-cutover doc shape. Missing `deletedAt`,
// `termsAcceptedAt`, `termsAcceptedVersion`, and the `clientRating*`
// aggregates. Pre-fix this couldn't be edited at all.
const legacyUserMissingLaterFields = {
  roles: ["client"],
  activeRole: "client",
  displayName: "Old Account",
  email: "old@example.com",
  photoURL: null,
  phone: null,
  createdAt: serverTimestamp(),
  lastActiveAt: serverTimestamp(),
  emailVerified: false,
};

// Pre-multi-role-cutover doc shape — single `role` string, no `roles`
// array, no `activeRole`. The rule's legacy branch should still cover this.
const legacySingleRoleUser = {
  role: "client",
  displayName: "Ancient Account",
  email: "ancient@example.com",
  photoURL: null,
  createdAt: serverTimestamp(),
  lastActiveAt: serverTimestamp(),
  emailVerified: false,
};

async function seed(uid: string, data: Record<string, unknown>): Promise<void> {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), "users", uid), data);
  });
}

describe("users — owner self-edit happy path", () => {
  it("owner can update displayName on a canonical doc", async () => {
    await seed(CLIENT_UID, canonicalUser);
    const fs = env.authenticatedContext(CLIENT_UID, CLIENT_CLAIMS).firestore();
    await assertSucceeds(
      updateDoc(doc(fs, "users", CLIENT_UID), { displayName: "Sam Updated" }),
    );
  });

  it("owner can update phone + bio together", async () => {
    await seed(CLIENT_UID, canonicalUser);
    const fs = env.authenticatedContext(CLIENT_UID, CLIENT_CLAIMS).firestore();
    await assertSucceeds(
      updateDoc(doc(fs, "users", CLIENT_UID), {
        phone: "+15875551234",
        bio: "I am a long-form bio about myself.",
      }),
    );
  });

  it("owner can update notificationPrefs", async () => {
    await seed(CLIENT_UID, canonicalUser);
    const fs = env.authenticatedContext(CLIENT_UID, CLIENT_CLAIMS).firestore();
    await assertSucceeds(
      updateDoc(doc(fs, "users", CLIENT_UID), {
        notificationPrefs: { emailEnabled: false, whatsappEnabled: true },
      }),
    );
  });
});

describe("users — legacy doc regressions (the bug we're fixing)", () => {
  it("owner of a doc missing termsAcceptedAt/Version + deletedAt + clientRating* can still edit displayName", async () => {
    await seed(CLIENT_UID, legacyUserMissingLaterFields);
    const fs = env.authenticatedContext(CLIENT_UID, CLIENT_CLAIMS).firestore();
    await assertSucceeds(
      updateDoc(doc(fs, "users", CLIENT_UID), {
        displayName: "New Name",
      }),
    );
  });

  it("owner of a legacy single-role doc (no roles[], no activeRole) can still edit displayName", async () => {
    await seed(CLIENT_UID, legacySingleRoleUser);
    const fs = env.authenticatedContext(CLIENT_UID, CLIENT_CLAIMS).firestore();
    await assertSucceeds(
      updateDoc(doc(fs, "users", CLIENT_UID), {
        displayName: "New Name",
      }),
    );
  });

  it("owner of a doc missing only deletedAt can update photoURL", async () => {
    // Construct without `deletedAt` rather than spreading `undefined` so the
    // key is truly absent in the stored doc (Firestore SDK semantics vary).
    const { deletedAt: _deletedAt, ...withoutDeletedAt } = canonicalUser;
    void _deletedAt;
    await seed(CLIENT_UID, withoutDeletedAt);
    const fs = env.authenticatedContext(CLIENT_UID, CLIENT_CLAIMS).firestore();
    await assertSucceeds(
      updateDoc(doc(fs, "users", CLIENT_UID), {
        photoURL: "https://example.com/me.webp",
      }),
    );
  });
});

describe("users — server-managed field locks still enforced", () => {
  it("owner cannot change their email", async () => {
    await seed(CLIENT_UID, canonicalUser);
    const fs = env.authenticatedContext(CLIENT_UID, CLIENT_CLAIMS).firestore();
    await assertFails(
      updateDoc(doc(fs, "users", CLIENT_UID), { email: "evil@example.com" }),
    );
  });

  it("owner cannot self-grant emailVerified", async () => {
    await seed(CLIENT_UID, canonicalUser);
    const fs = env.authenticatedContext(CLIENT_UID, CLIENT_CLAIMS).firestore();
    await assertFails(
      updateDoc(doc(fs, "users", CLIENT_UID), { emailVerified: true }),
    );
  });

  it("owner cannot inflate clientRatingAvg", async () => {
    await seed(CLIENT_UID, canonicalUser);
    const fs = env.authenticatedContext(CLIENT_UID, CLIENT_CLAIMS).firestore();
    await assertFails(
      updateDoc(doc(fs, "users", CLIENT_UID), { clientRatingAvg: 5 }),
    );
  });

  it("owner cannot inflate clientRatingCount", async () => {
    await seed(CLIENT_UID, canonicalUser);
    const fs = env.authenticatedContext(CLIENT_UID, CLIENT_CLAIMS).firestore();
    await assertFails(
      updateDoc(doc(fs, "users", CLIENT_UID), { clientRatingCount: 99 }),
    );
  });

  it("owner cannot self-grant deletedAt", async () => {
    await seed(CLIENT_UID, canonicalUser);
    const fs = env.authenticatedContext(CLIENT_UID, CLIENT_CLAIMS).firestore();
    await assertFails(
      updateDoc(doc(fs, "users", CLIENT_UID), {
        deletedAt: serverTimestamp(),
      }),
    );
  });

  it("owner cannot add deletedAt onto a legacy doc that didn't have it", async () => {
    // Equivalent to the attacker grafting a server-managed field onto a
    // legacy doc. `.get(field, null)` makes missing-vs-missing equal, but
    // missing-vs-set still mismatches.
    await seed(CLIENT_UID, legacyUserMissingLaterFields);
    const fs = env.authenticatedContext(CLIENT_UID, CLIENT_CLAIMS).firestore();
    await assertFails(
      updateDoc(doc(fs, "users", CLIENT_UID), {
        deletedAt: serverTimestamp(),
      }),
    );
  });

  it("owner cannot add termsAcceptedVersion onto a legacy doc", async () => {
    await seed(CLIENT_UID, legacyUserMissingLaterFields);
    const fs = env.authenticatedContext(CLIENT_UID, CLIENT_CLAIMS).firestore();
    await assertFails(
      updateDoc(doc(fs, "users", CLIENT_UID), {
        termsAcceptedVersion: "9.9.9",
      }),
    );
  });

  it("owner cannot mutate roles", async () => {
    await seed(CLIENT_UID, canonicalUser);
    const fs = env.authenticatedContext(CLIENT_UID, CLIENT_CLAIMS).firestore();
    await assertFails(
      updateDoc(doc(fs, "users", CLIENT_UID), {
        roles: ["client", "admin"],
      }),
    );
  });

  it("owner cannot switch activeRole to a role they don't hold", async () => {
    await seed(CLIENT_UID, canonicalUser);
    const fs = env.authenticatedContext(CLIENT_UID, CLIENT_CLAIMS).firestore();
    await assertFails(
      updateDoc(doc(fs, "users", CLIENT_UID), { activeRole: "admin" }),
    );
  });

  it("owner cannot self-grant a Blue Seal Pro subscription (fee-waiver + AI dodge)", async () => {
    await seed(CLIENT_UID, canonicalUser);
    const fs = env.authenticatedContext(CLIENT_UID, CLIENT_CLAIMS).firestore();
    await assertFails(
      updateDoc(doc(fs, "users", CLIENT_UID), {
        subscription: {
          status: "active",
          plan: "annual",
          trialEndsAt: null,
          currentPeriodEnd: null,
          cancelAtPeriodEnd: false,
          stripeCustomerId: null,
          stripeSubscriptionId: null,
          everTrialedAt: null,
          proCompUntil: null,
          updatedAt: serverTimestamp(),
        },
      }),
    );
  });

  it("owner can still edit displayName on a doc already carrying a subscription (legacy-doc trap)", async () => {
    await seed(CLIENT_UID, {
      ...canonicalUser,
      subscription: {
        status: "active",
        plan: "monthly",
        trialEndsAt: null,
        currentPeriodEnd: null,
        cancelAtPeriodEnd: false,
        stripeCustomerId: "cus_x",
        stripeSubscriptionId: "sub_x",
        everTrialedAt: null,
        proCompUntil: null,
        updatedAt: serverTimestamp(),
      },
    });
    const fs = env.authenticatedContext(CLIENT_UID, CLIENT_CLAIMS).firestore();
    await assertSucceeds(
      updateDoc(doc(fs, "users", CLIENT_UID), { displayName: "Renamed" }),
    );
  });
});

describe("users — create is server-side only (provisionAccount)", () => {
  // The durable fix for the signup race: user docs are now provisioned by the
  // `provisionAccount` callable via the Admin SDK (which bypasses these rules),
  // never by the client. The client-side write was the first Firestore op of a
  // new session and raced the Auth→Firestore token handshake, surfacing as
  // "You don't have permission to do that." on signup. The create rule is
  // locked to `false` so that racy client write can't be reintroduced.
  it("owner cannot create their own user doc from the client", async () => {
    const fs = env.authenticatedContext(CLIENT_UID, CLIENT_CLAIMS).firestore();
    await assertFails(setDoc(doc(fs, "users", CLIENT_UID), canonicalUser));
  });

  it("a caller cannot create someone else's user doc either", async () => {
    const fs = env.authenticatedContext(OTHER_CLIENT_UID, CLIENT_CLAIMS).firestore();
    await assertFails(setDoc(doc(fs, "users", CLIENT_UID), canonicalUser));
  });
});

describe("users — cross-account isolation", () => {
  it("a different user cannot edit someone else's doc", async () => {
    await seed(CLIENT_UID, canonicalUser);
    const fs = env
      .authenticatedContext(OTHER_CLIENT_UID, CLIENT_CLAIMS)
      .firestore();
    await assertFails(
      updateDoc(doc(fs, "users", CLIENT_UID), { displayName: "Hacked" }),
    );
  });
});
