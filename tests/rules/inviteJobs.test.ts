// Bring-your-own-client (tradesperson-created) jobs: clientId is null until
// the invited client claims, and the invite/audit fields on the job doc are
// server-managed. These tests pin that contract:
//   - the jobs CREATE rule did NOT grow a tradesperson branch (creation is
//     callable-only, so the entitlement seam can't be bypassed),
//   - an unclaimed job is readable/updatable by its tradesperson but invisible
//     to every other non-admin,
//   - no party can write clientInvite / acceptedOffline / inviteOriginated
//     (forging status:"claimed" or clearing the reputation marker),
//   - subcollection writes still work when the denormalized clientId is null.
// Tests run as NON-admin tokens deliberately — the dev client account being an
// admin has masked client-permission bugs before.

import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";
import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { Timestamp, doc, getDoc, serverTimestamp, setDoc, updateDoc } from "firebase/firestore";

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

const JOB_ID = "invite_job_1";

const baseInvite = {
  emailLower: "client@example.com",
  clientName: "Pat Client",
  status: "invited",
  invitedAt: Timestamp.now(),
  expiresAt: Timestamp.fromMillis(Date.now() + 86_400_000),
  claimedAt: null,
  revokedAt: null,
  resendCount: 0,
  lastSentAt: null,
  emailedAt: null,
  tokenHash: "deadbeef",
};

async function seedInviteJob(extras: Record<string, unknown> = {}) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const fs = ctx.firestore();
    await setDoc(doc(fs, "jobs", JOB_ID), {
      clientId: null,
      tradespersonId: TRADIE_UID,
      chatId: "chat_invite_1",
      status: "requested",
      trade: "plumber",
      createdAt: Timestamp.now(),
      inviteOriginated: true,
      clientInvite: baseInvite,
      ...extras,
    });
  });
}

describe("invite jobs — create stays callable-only", () => {
  it("tradesperson cannot direct-create a job with clientId null", async () => {
    const tradie = env.authenticatedContext(TRADIE_UID, TRADIE_CLAIMS).firestore();
    await assertFails(
      setDoc(doc(tradie, "jobs", "direct_create_attempt"), {
        clientId: null,
        tradespersonId: TRADIE_UID,
        chatId: "chat_x",
        status: "requested",
        trade: "plumber",
        createdAt: serverTimestamp(),
      }),
    );
  });

  it("client cannot direct-create a job with clientId null either", async () => {
    const client = env.authenticatedContext(CLIENT_UID, CLIENT_CLAIMS).firestore();
    await assertFails(
      setDoc(doc(client, "jobs", "direct_create_attempt"), {
        clientId: null,
        tradespersonId: TRADIE_UID,
        chatId: "chat_x",
        status: "requested",
        trade: "plumber",
        createdAt: serverTimestamp(),
      }),
    );
  });
});

describe("invite jobs — unclaimed job visibility", () => {
  it("assigned tradesperson can read their unclaimed job", async () => {
    await seedInviteJob();
    const tradie = env.authenticatedContext(TRADIE_UID, TRADIE_CLAIMS).firestore();
    await assertSucceeds(getDoc(doc(tradie, "jobs", JOB_ID)));
  });

  it("a signed-in client cannot read an unclaimed job (null never matches a uid)", async () => {
    await seedInviteJob();
    const stranger = env.authenticatedContext(CLIENT_UID, CLIENT_CLAIMS).firestore();
    await assertFails(getDoc(doc(stranger, "jobs", JOB_ID)));
  });

  it("another tradesperson cannot read it", async () => {
    await seedInviteJob();
    const other = env.authenticatedContext(OTHER_TRADIE_UID, TRADIE_CLAIMS).firestore();
    await assertFails(getDoc(doc(other, "jobs", JOB_ID)));
  });
});

describe("invite jobs — tradesperson updates with a null clientId", () => {
  it("tradesperson can update their unclaimed job (clientId null == null passes the pin)", async () => {
    await seedInviteJob();
    const tradie = env.authenticatedContext(TRADIE_UID, TRADIE_CLAIMS).firestore();
    await assertSucceeds(
      updateDoc(doc(tradie, "jobs", JOB_ID), {
        tradespersonArchivedAt: serverTimestamp(),
      }),
    );
  });

  it("tradesperson cannot attach themselves (or anyone) as the client", async () => {
    await seedInviteJob();
    const tradie = env.authenticatedContext(TRADIE_UID, TRADIE_CLAIMS).firestore();
    await assertFails(updateDoc(doc(tradie, "jobs", JOB_ID), { clientId: TRADIE_UID }));
  });
});

describe("invite jobs — server-managed fields are pinned", () => {
  it("tradesperson cannot forge the invite to claimed", async () => {
    await seedInviteJob();
    const tradie = env.authenticatedContext(TRADIE_UID, TRADIE_CLAIMS).firestore();
    await assertFails(
      updateDoc(doc(tradie, "jobs", JOB_ID), {
        clientInvite: { ...baseInvite, status: "claimed", claimedAt: Timestamp.now() },
      }),
    );
  });

  it("tradesperson cannot swap the invite email", async () => {
    await seedInviteJob();
    const tradie = env.authenticatedContext(TRADIE_UID, TRADIE_CLAIMS).firestore();
    await assertFails(
      updateDoc(doc(tradie, "jobs", JOB_ID), {
        "clientInvite.emailLower": "attacker@example.com",
      }),
    );
  });

  it("tradesperson cannot set or clear acceptedOffline", async () => {
    await seedInviteJob();
    const tradie = env.authenticatedContext(TRADIE_UID, TRADIE_CLAIMS).firestore();
    await assertFails(updateDoc(doc(tradie, "jobs", JOB_ID), { acceptedOffline: true }));
  });

  it("a party cannot clear inviteOriginated", async () => {
    await seedInviteJob();
    const tradie = env.authenticatedContext(TRADIE_UID, TRADIE_CLAIMS).firestore();
    await assertFails(updateDoc(doc(tradie, "jobs", JOB_ID), { inviteOriginated: false }));
  });

  it("a normal job's party cannot ADD an invite to it", async () => {
    // Regular client job — the client tries to graft a clientInvite on.
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "jobs", "normal_job"), {
        clientId: CLIENT_UID,
        tradespersonId: TRADIE_UID,
        chatId: "chat_n",
        status: "requested",
        trade: "plumber",
        createdAt: Timestamp.now(),
      });
    });
    const client = env.authenticatedContext(CLIENT_UID, CLIENT_CLAIMS).firestore();
    await assertFails(
      updateDoc(doc(client, "jobs", "normal_job"), { clientInvite: baseInvite }),
    );
  });

  it("admin can still touch the pinned fields", async () => {
    await seedInviteJob();
    const admin = env.authenticatedContext(ADMIN_UID, ADMIN_CLAIMS).firestore();
    await assertSucceeds(
      updateDoc(doc(admin, "jobs", JOB_ID), {
        clientInvite: { ...baseInvite, status: "revoked", revokedAt: Timestamp.now(), tokenHash: null },
      }),
    );
  });

  it("archive updates on legacy jobs (no invite fields at all) still work", async () => {
    // Guard against the legacy-doc lockout failure mode: .get(field, null)
    // must default cleanly when the fields are absent.
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "jobs", "legacy_job"), {
        clientId: CLIENT_UID,
        tradespersonId: TRADIE_UID,
        chatId: "chat_l",
        status: "complete",
        trade: "plumber",
        createdAt: Timestamp.now(),
      });
    });
    const client = env.authenticatedContext(CLIENT_UID, CLIENT_CLAIMS).firestore();
    await assertSucceeds(
      updateDoc(doc(client, "jobs", "legacy_job"), { clientArchivedAt: serverTimestamp() }),
    );
  });
});

describe("invite jobs — reputation firewall on reviews", () => {
  async function seedCompletedJob(id: string, extras: Record<string, unknown> = {}) {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "jobs", id), {
        clientId: CLIENT_UID,
        tradespersonId: TRADIE_UID,
        chatId: `chat_${id}`,
        status: "complete",
        trade: "plumber",
        createdAt: Timestamp.now(),
        ...extras,
      });
    });
  }

  it("client cannot review an offline-accepted job (even after claiming)", async () => {
    await seedCompletedJob("offline_job", { acceptedOffline: true });
    const client = env.authenticatedContext(CLIENT_UID, CLIENT_CLAIMS).firestore();
    await assertFails(
      setDoc(doc(client, "reviews", "rev_offline"), {
        jobId: "offline_job",
        clientId: CLIENT_UID,
        tradespersonId: TRADIE_UID,
        status: "active",
        rating: 5,
        text: "great",
        createdAt: serverTimestamp(),
      }),
    );
  });

  it("client review on a normal completed job still works (legacy default)", async () => {
    // No acceptedOffline field at all — the .get(…, false) default must not
    // lock legacy jobs out (documented failure mode at rules:84-91).
    await seedCompletedJob("normal_complete_job");
    const client = env.authenticatedContext(CLIENT_UID, CLIENT_CLAIMS).firestore();
    await assertSucceeds(
      setDoc(doc(client, "reviews", "rev_normal"), {
        jobId: "normal_complete_job",
        clientId: CLIENT_UID,
        tradespersonId: TRADIE_UID,
        status: "active",
        rating: 5,
        text: "great",
        createdAt: serverTimestamp(),
      }),
    );
  });

  it("tradesperson cannot file a phantom client review on a solo job (null == null)", async () => {
    await seedCompletedJob("solo_complete_job", { clientId: null, acceptedOffline: true });
    const tradie = env.authenticatedContext(TRADIE_UID, TRADIE_CLAIMS).firestore();
    await assertFails(
      setDoc(doc(tradie, "clientReviews", "crev_solo"), {
        jobId: "solo_complete_job",
        clientId: null,
        tradespersonId: TRADIE_UID,
        rating: 5,
        text: "fake great client",
        createdAt: serverTimestamp(),
      }),
    );
  });

  it("tradesperson client-review on a normal completed job still works", async () => {
    await seedCompletedJob("normal_complete_job2");
    const tradie = env.authenticatedContext(TRADIE_UID, TRADIE_CLAIMS).firestore();
    await assertSucceeds(
      setDoc(doc(tradie, "clientReviews", "crev_normal"), {
        jobId: "normal_complete_job2",
        clientId: CLIENT_UID,
        tradespersonId: TRADIE_UID,
        rating: 5,
        text: "good client",
        createdAt: serverTimestamp(),
      }),
    );
  });
});

describe("inviteSuppression — server-only tombstones", () => {
  it("non-admins can neither read nor write a suppression tombstone", async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "inviteSuppression", "somehash"), {
        reason: "unsubscribe",
        identifier: "somehash",
        createdAt: Timestamp.now(),
      });
    });
    const tradie = env.authenticatedContext(TRADIE_UID, TRADIE_CLAIMS).firestore();
    await assertFails(getDoc(doc(tradie, "inviteSuppression", "somehash")));
    await assertFails(
      setDoc(doc(tradie, "inviteSuppression", "otherhash"), { reason: "fake" }),
    );
    const admin = env.authenticatedContext(ADMIN_UID, ADMIN_CLAIMS).firestore();
    await assertSucceeds(getDoc(doc(admin, "inviteSuppression", "somehash")));
  });
});

describe("invite jobs — subcollections with null clientId", () => {
  it("tradesperson can book a session on an unclaimed job (row clientId null matches parent)", async () => {
    await seedInviteJob();
    const tradie = env.authenticatedContext(TRADIE_UID, TRADIE_CLAIMS).firestore();
    const start = Timestamp.fromMillis(Date.now() + 3_600_000);
    const end = Timestamp.fromMillis(Date.now() + 7_200_000);
    await assertSucceeds(
      setDoc(doc(tradie, "jobs", JOB_ID, "sessions", "s1"), {
        tradespersonId: TRADIE_UID,
        clientId: null,
        start,
        end,
        note: "",
        createdAt: Timestamp.now(),
      }),
    );
  });

  it("a stranger cannot read sessions on an unclaimed job", async () => {
    await seedInviteJob();
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "jobs", JOB_ID, "sessions", "s1"), {
        tradespersonId: TRADIE_UID,
        clientId: null,
        start: Timestamp.now(),
        end: Timestamp.fromMillis(Date.now() + 3_600_000),
        note: "",
        createdAt: Timestamp.now(),
      });
    });
    const stranger = env.authenticatedContext(CLIENT_UID, CLIENT_CLAIMS).firestore();
    await assertFails(getDoc(doc(stranger, "jobs", JOB_ID, "sessions", "s1")));
  });
});
