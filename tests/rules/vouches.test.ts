// vouches/{vouchId} — peer endorsements. All writes flow through the
// vouch callables (server-side, admin SDK bypasses rules); client writes
// are denied. Reads: accepted vouches are public so the profile chips
// render for any viewer; pending/declined vouches are party-only so
// nobody can mine "X invited Y" or "X tried to vouch and got declined"
// signals.

import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";
import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { deleteDoc, doc, getDoc, setDoc, updateDoc } from "firebase/firestore";

import {
  ADMIN_CLAIMS,
  ADMIN_UID,
  CLIENT_CLAIMS,
  CLIENT_UID,
  OTHER_TRADIE_UID,
  TRADIE_CLAIMS,
  TRADIE_UID,
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

const ACCEPTED_VOUCH_ID = "vouch_accepted_1";
const PENDING_VOUCH_ID = "vouch_pending_1";
const INVITE_VOUCH_ID = "vouch_invite_1";
const DECLINED_VOUCH_ID = "vouch_declined_1";

function vouchPayload(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    fromUserId: TRADIE_UID,
    fromDisplayName: "Tradie A",
    fromPhotoURL: null,
    fromPrimaryTrade: "plumbing",
    toUserId: OTHER_TRADIE_UID,
    toDisplayName: "Tradie B",
    toPhotoURL: null,
    toPrimaryTrade: "electrical",
    toEmail: null,
    status: "accepted",
    message: "",
    createdAt: new Date(),
    respondedAt: new Date(),
    ...overrides,
  };
}

async function seedVouches() {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const fs = ctx.firestore();
    await setDoc(doc(fs, "vouches", ACCEPTED_VOUCH_ID), vouchPayload({}));
    await setDoc(
      doc(fs, "vouches", PENDING_VOUCH_ID),
      vouchPayload({ status: "pending_acceptance", respondedAt: null }),
    );
    await setDoc(
      doc(fs, "vouches", INVITE_VOUCH_ID),
      vouchPayload({
        status: "pending_signup",
        toUserId: null,
        toEmail: "invitee@example.com",
        respondedAt: null,
      }),
    );
    await setDoc(
      doc(fs, "vouches", DECLINED_VOUCH_ID),
      vouchPayload({ status: "declined" }),
    );
  });
}

describe("vouches — read access", () => {
  it("any signed-in user can read an accepted vouch", async () => {
    await seedVouches();
    const fs = env.authenticatedContext(CLIENT_UID, CLIENT_CLAIMS).firestore();
    await assertSucceeds(getDoc(doc(fs, "vouches", ACCEPTED_VOUCH_ID)));
  });

  it("an unauthenticated user can read an accepted vouch", async () => {
    await seedVouches();
    const fs = env.unauthenticatedContext().firestore();
    await assertSucceeds(getDoc(doc(fs, "vouches", ACCEPTED_VOUCH_ID)));
  });

  it("the voucher can read their own pending vouch", async () => {
    await seedVouches();
    const fs = env.authenticatedContext(TRADIE_UID, TRADIE_CLAIMS).firestore();
    await assertSucceeds(getDoc(doc(fs, "vouches", PENDING_VOUCH_ID)));
  });

  it("the vouchee can read a pending vouch addressed to them", async () => {
    await seedVouches();
    const fs = env
      .authenticatedContext(OTHER_TRADIE_UID, TRADIE_CLAIMS)
      .firestore();
    await assertSucceeds(getDoc(doc(fs, "vouches", PENDING_VOUCH_ID)));
  });

  it("an unrelated user cannot read a pending vouch", async () => {
    await seedVouches();
    const fs = env.authenticatedContext(CLIENT_UID, CLIENT_CLAIMS).firestore();
    await assertFails(getDoc(doc(fs, "vouches", PENDING_VOUCH_ID)));
  });

  it("an unrelated user cannot read a pending-signup (email) invite", async () => {
    await seedVouches();
    const fs = env.authenticatedContext(CLIENT_UID, CLIENT_CLAIMS).firestore();
    await assertFails(getDoc(doc(fs, "vouches", INVITE_VOUCH_ID)));
  });

  it("an unrelated user cannot read a declined vouch", async () => {
    await seedVouches();
    const fs = env.authenticatedContext(CLIENT_UID, CLIENT_CLAIMS).firestore();
    await assertFails(getDoc(doc(fs, "vouches", DECLINED_VOUCH_ID)));
  });

  it("admin can read any vouch", async () => {
    await seedVouches();
    const fs = env.authenticatedContext(ADMIN_UID, ADMIN_CLAIMS).firestore();
    await assertSucceeds(getDoc(doc(fs, "vouches", PENDING_VOUCH_ID)));
    await assertSucceeds(getDoc(doc(fs, "vouches", INVITE_VOUCH_ID)));
    await assertSucceeds(getDoc(doc(fs, "vouches", DECLINED_VOUCH_ID)));
  });
});

describe("vouches — write protection", () => {
  it("a tradesperson cannot create a vouch directly", async () => {
    const fs = env.authenticatedContext(TRADIE_UID, TRADIE_CLAIMS).firestore();
    await assertFails(
      setDoc(doc(fs, "vouches", "newone"), vouchPayload({})),
    );
  });

  it("the voucher cannot self-flip a pending vouch to accepted", async () => {
    await seedVouches();
    const fs = env.authenticatedContext(TRADIE_UID, TRADIE_CLAIMS).firestore();
    await assertFails(
      updateDoc(doc(fs, "vouches", PENDING_VOUCH_ID), { status: "accepted" }),
    );
  });

  it("the vouchee cannot directly flip status without the callable", async () => {
    await seedVouches();
    const fs = env
      .authenticatedContext(OTHER_TRADIE_UID, TRADIE_CLAIMS)
      .firestore();
    await assertFails(
      updateDoc(doc(fs, "vouches", PENDING_VOUCH_ID), { status: "accepted" }),
    );
  });

  it("admin cannot delete a vouch from the client side", async () => {
    await seedVouches();
    const fs = env.authenticatedContext(ADMIN_UID, ADMIN_CLAIMS).firestore();
    await assertFails(deleteDoc(doc(fs, "vouches", ACCEPTED_VOUCH_ID)));
  });
});
