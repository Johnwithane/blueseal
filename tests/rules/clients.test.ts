// Clients book (CRM — Blue Seal Pro) rules. The contract these pin:
//   - read is ownership-only (a lapsed-Pro tradesperson keeps access to their
//     own data; the *tab* is Pro-gated in the UI, not the rules),
//   - create/update require an ACTIVE Pro subscription (isProTradesperson reads
//     the public isPro mirror on /tradespeople/{uid}),
//   - linkedUserId + activeRecurringPlans are server-managed (a party can't seed
//     or flip them — that would forge an account link or a billing counter),
//   - tradespersonId + createdAt are immutable; displayName is length-bounded,
//   - delete is admin-only (tradespeople soft-delete via archivedAt),
//   - and the job-doc linkage fields (originType / clientRef / recurringPlanId)
//     are frozen against party writes so a job can't be re-homed or a recurring
//     plan forged.
// Tests run as NON-admin tokens deliberately — the dev client account being an
// admin has masked client-permission bugs before.

import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";
import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  Timestamp,
  deleteDoc,
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "firebase/firestore";

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

const CLIENT_DOC_ID = "client_book_1";

// Seed the Pro mirror the rules read via get(). Most allow-tests need this for
// TRADIE_UID; deny-tests either skip it or seed isPro:false.
async function seedTradiePro(uid: string, isPro: boolean) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), "tradespeople", uid), { isPro }, { merge: true });
  });
}

// A well-formed client doc, seeded under disabled rules (for read/update/delete
// tests that need an existing doc).
function baseClientData(extras: Record<string, unknown> = {}) {
  return {
    tradespersonId: TRADIE_UID,
    displayName: "Jane's Pool Co.",
    emailLower: "jane@example.com",
    phone: null,
    company: null,
    address: null,
    notes: null,
    linkedUserId: null,
    activeRecurringPlans: 0,
    source: "manual",
    archivedAt: null,
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
    ...extras,
  };
}

async function seedClientDoc(extras: Record<string, unknown> = {}) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), "clients", CLIENT_DOC_ID), baseClientData(extras));
  });
}

// A create payload from a client SDK — createdAt/updatedAt must be
// serverTimestamp() to satisfy the `== request.time` pin.
function createPayload(extras: Record<string, unknown> = {}) {
  return {
    tradespersonId: TRADIE_UID,
    displayName: "Jane's Pool Co.",
    emailLower: "jane@example.com",
    phone: null,
    company: null,
    address: null,
    notes: null,
    linkedUserId: null,
    activeRecurringPlans: 0,
    source: "manual",
    archivedAt: null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    ...extras,
  };
}

describe("clients — create requires owner + Pro", () => {
  it("Pro tradesperson can create a well-formed client", async () => {
    await seedTradiePro(TRADIE_UID, true);
    const tradie = env.authenticatedContext(TRADIE_UID, TRADIE_CLAIMS).firestore();
    await assertSucceeds(setDoc(doc(tradie, "clients", "new_client"), createPayload()));
  });

  it("non-Pro tradesperson cannot create (isPro false)", async () => {
    await seedTradiePro(TRADIE_UID, false);
    const tradie = env.authenticatedContext(TRADIE_UID, TRADIE_CLAIMS).firestore();
    await assertFails(setDoc(doc(tradie, "clients", "new_client"), createPayload()));
  });

  it("tradesperson with no /tradespeople doc cannot create (exists() guard)", async () => {
    const tradie = env.authenticatedContext(TRADIE_UID, TRADIE_CLAIMS).firestore();
    await assertFails(setDoc(doc(tradie, "clients", "new_client"), createPayload()));
  });

  it("cannot create a client owned by someone else", async () => {
    await seedTradiePro(TRADIE_UID, true);
    const tradie = env.authenticatedContext(TRADIE_UID, TRADIE_CLAIMS).firestore();
    await assertFails(
      setDoc(doc(tradie, "clients", "new_client"), createPayload({ tradespersonId: OTHER_TRADIE_UID })),
    );
  });

  it("a client-role account cannot create a client book entry", async () => {
    // Even if a (bogus) Pro mirror existed for them, the role gate blocks it.
    await seedTradiePro(CLIENT_UID, true);
    const client = env.authenticatedContext(CLIENT_UID, CLIENT_CLAIMS).firestore();
    await assertFails(
      setDoc(doc(client, "clients", "new_client"), createPayload({ tradespersonId: CLIENT_UID })),
    );
  });

  it("cannot seed linkedUserId on create (server-managed)", async () => {
    await seedTradiePro(TRADIE_UID, true);
    const tradie = env.authenticatedContext(TRADIE_UID, TRADIE_CLAIMS).firestore();
    await assertFails(
      setDoc(doc(tradie, "clients", "new_client"), createPayload({ linkedUserId: OTHER_TRADIE_UID })),
    );
  });

  it("cannot seed activeRecurringPlans > 0 on create (server-managed)", async () => {
    await seedTradiePro(TRADIE_UID, true);
    const tradie = env.authenticatedContext(TRADIE_UID, TRADIE_CLAIMS).firestore();
    await assertFails(
      setDoc(doc(tradie, "clients", "new_client"), createPayload({ activeRecurringPlans: 3 })),
    );
  });

  it("admin can create in their own book without a Pro mirror", async () => {
    // ClientsPanel lets an admin past the Pro gate screen, so the create rule
    // has to admit admin too — otherwise the tab renders Add/Import and every
    // write 403s (bug sZSWiYecsP0H7iAWAoyw).
    const admin = env.authenticatedContext(ADMIN_UID, ADMIN_CLAIMS).firestore();
    await assertSucceeds(
      setDoc(
        doc(admin, "clients", "new_client"),
        createPayload({ tradespersonId: ADMIN_UID }),
      ),
    );
  });

  it("admin still cannot seed a contact into another tradie's book", async () => {
    const admin = env.authenticatedContext(ADMIN_UID, ADMIN_CLAIMS).firestore();
    await assertFails(
      setDoc(
        doc(admin, "clients", "new_client"),
        createPayload({ tradespersonId: OTHER_TRADIE_UID }),
      ),
    );
  });

  it("cannot create with an empty displayName", async () => {
    await seedTradiePro(TRADIE_UID, true);
    const tradie = env.authenticatedContext(TRADIE_UID, TRADIE_CLAIMS).firestore();
    await assertFails(
      setDoc(doc(tradie, "clients", "new_client"), createPayload({ displayName: "" })),
    );
  });
});

describe("clients — read is ownership-only", () => {
  it("owner can read their own client", async () => {
    await seedClientDoc();
    const tradie = env.authenticatedContext(TRADIE_UID, TRADIE_CLAIMS).firestore();
    await assertSucceeds(getDoc(doc(tradie, "clients", CLIENT_DOC_ID)));
  });

  it("a non-Pro owner can still READ their own client (lapsed access stays)", async () => {
    await seedTradiePro(TRADIE_UID, false);
    await seedClientDoc();
    const tradie = env.authenticatedContext(TRADIE_UID, TRADIE_CLAIMS).firestore();
    await assertSucceeds(getDoc(doc(tradie, "clients", CLIENT_DOC_ID)));
  });

  it("another tradesperson cannot read it", async () => {
    await seedClientDoc();
    const other = env.authenticatedContext(OTHER_TRADIE_UID, TRADIE_CLAIMS).firestore();
    await assertFails(getDoc(doc(other, "clients", CLIENT_DOC_ID)));
  });

  it("a client account cannot read it", async () => {
    await seedClientDoc();
    const client = env.authenticatedContext(CLIENT_UID, CLIENT_CLAIMS).firestore();
    await assertFails(getDoc(doc(client, "clients", CLIENT_DOC_ID)));
  });

  it("admin can read it", async () => {
    await seedClientDoc();
    const admin = env.authenticatedContext(ADMIN_UID, ADMIN_CLAIMS).firestore();
    await assertSucceeds(getDoc(doc(admin, "clients", CLIENT_DOC_ID)));
  });
});

describe("clients — update requires owner + Pro and pins server fields", () => {
  it("Pro owner can edit name / notes / archive", async () => {
    await seedTradiePro(TRADIE_UID, true);
    await seedClientDoc();
    const tradie = env.authenticatedContext(TRADIE_UID, TRADIE_CLAIMS).firestore();
    await assertSucceeds(
      updateDoc(doc(tradie, "clients", CLIENT_DOC_ID), {
        displayName: "Jane Doe",
        notes: "Monthly pool service, gate code 4821",
        archivedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }),
    );
  });

  it("a lapsed (non-Pro) owner cannot update", async () => {
    await seedTradiePro(TRADIE_UID, false);
    await seedClientDoc();
    const tradie = env.authenticatedContext(TRADIE_UID, TRADIE_CLAIMS).firestore();
    await assertFails(updateDoc(doc(tradie, "clients", CLIENT_DOC_ID), { notes: "x" }));
  });

  it("owner cannot flip linkedUserId", async () => {
    await seedTradiePro(TRADIE_UID, true);
    await seedClientDoc();
    const tradie = env.authenticatedContext(TRADIE_UID, TRADIE_CLAIMS).firestore();
    await assertFails(
      updateDoc(doc(tradie, "clients", CLIENT_DOC_ID), { linkedUserId: OTHER_TRADIE_UID }),
    );
  });

  it("owner cannot bump activeRecurringPlans", async () => {
    await seedTradiePro(TRADIE_UID, true);
    await seedClientDoc();
    const tradie = env.authenticatedContext(TRADIE_UID, TRADIE_CLAIMS).firestore();
    await assertFails(
      updateDoc(doc(tradie, "clients", CLIENT_DOC_ID), { activeRecurringPlans: 5 }),
    );
  });

  it("owner cannot change tradespersonId", async () => {
    await seedTradiePro(TRADIE_UID, true);
    await seedClientDoc();
    const tradie = env.authenticatedContext(TRADIE_UID, TRADIE_CLAIMS).firestore();
    await assertFails(
      updateDoc(doc(tradie, "clients", CLIENT_DOC_ID), { tradespersonId: OTHER_TRADIE_UID }),
    );
  });

  it("owner cannot rewrite createdAt", async () => {
    await seedTradiePro(TRADIE_UID, true);
    await seedClientDoc();
    const tradie = env.authenticatedContext(TRADIE_UID, TRADIE_CLAIMS).firestore();
    await assertFails(
      updateDoc(doc(tradie, "clients", CLIENT_DOC_ID), { createdAt: serverTimestamp() }),
    );
  });

  it("another tradesperson cannot update it", async () => {
    await seedTradiePro(OTHER_TRADIE_UID, true);
    await seedClientDoc();
    const other = env.authenticatedContext(OTHER_TRADIE_UID, TRADIE_CLAIMS).firestore();
    await assertFails(updateDoc(doc(other, "clients", CLIENT_DOC_ID), { notes: "x" }));
  });
});

describe("clients — delete is admin-only", () => {
  it("even a Pro owner cannot delete (soft-delete via archivedAt instead)", async () => {
    await seedTradiePro(TRADIE_UID, true);
    await seedClientDoc();
    const tradie = env.authenticatedContext(TRADIE_UID, TRADIE_CLAIMS).firestore();
    await assertFails(deleteDoc(doc(tradie, "clients", CLIENT_DOC_ID)));
  });

  it("admin can delete", async () => {
    await seedClientDoc();
    const admin = env.authenticatedContext(ADMIN_UID, ADMIN_CLAIMS).firestore();
    await assertSucceeds(deleteDoc(doc(admin, "clients", CLIENT_DOC_ID)));
  });
});

describe("jobs — clients/recurring linkage fields are pinned against party writes", () => {
  const JOB_ID = "recurring_backing_job";

  async function seedLinkedJob(extras: Record<string, unknown> = {}) {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "jobs", JOB_ID), {
        clientId: null,
        tradespersonId: TRADIE_UID,
        chatId: "chat_rec_1",
        status: "in_progress",
        trade: "pool",
        createdAt: Timestamp.now(),
        acceptedOffline: true,
        originType: "recurring_plan",
        clientRef: CLIENT_DOC_ID,
        recurringPlanId: JOB_ID,
        ...extras,
      });
    });
  }

  it("tradesperson cannot change a job's originType", async () => {
    await seedLinkedJob();
    const tradie = env.authenticatedContext(TRADIE_UID, TRADIE_CLAIMS).firestore();
    await assertFails(updateDoc(doc(tradie, "jobs", JOB_ID), { originType: "direct" }));
  });

  it("tradesperson cannot re-home a job to another contact (clientRef)", async () => {
    await seedLinkedJob();
    const tradie = env.authenticatedContext(TRADIE_UID, TRADIE_CLAIMS).firestore();
    await assertFails(updateDoc(doc(tradie, "jobs", JOB_ID), { clientRef: "other_contact" }));
  });

  it("tradesperson cannot change recurringPlanId", async () => {
    await seedLinkedJob();
    const tradie = env.authenticatedContext(TRADIE_UID, TRADIE_CLAIMS).firestore();
    await assertFails(updateDoc(doc(tradie, "jobs", JOB_ID), { recurringPlanId: "forged" }));
  });

  it("a non-admin party cannot ADD linkage fields to a plain job", async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "jobs", "plain_job"), {
        clientId: CLIENT_UID,
        tradespersonId: TRADIE_UID,
        chatId: "chat_plain",
        status: "in_progress",
        trade: "pool",
        createdAt: Timestamp.now(),
      });
    });
    const tradie = env.authenticatedContext(TRADIE_UID, TRADIE_CLAIMS).firestore();
    await assertFails(
      updateDoc(doc(tradie, "jobs", "plain_job"), { clientRef: CLIENT_DOC_ID }),
    );
  });

  it("a legacy job with no linkage fields still accepts a normal archive update", async () => {
    // Guards the .get(field, null) default — absent fields must not lock updates.
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "jobs", "legacy_job"), {
        clientId: CLIENT_UID,
        tradespersonId: TRADIE_UID,
        chatId: "chat_legacy",
        status: "complete",
        trade: "pool",
        createdAt: Timestamp.now(),
      });
    });
    const tradie = env.authenticatedContext(TRADIE_UID, TRADIE_CLAIMS).firestore();
    await assertSucceeds(
      updateDoc(doc(tradie, "jobs", "legacy_job"), { tradespersonArchivedAt: serverTimestamp() }),
    );
  });

  it("admin can adjust linkage fields", async () => {
    await seedLinkedJob();
    const admin = env.authenticatedContext(ADMIN_UID, ADMIN_CLAIMS).firestore();
    await assertSucceeds(updateDoc(doc(admin, "jobs", JOB_ID), { clientRef: "moved_contact" }));
  });
});
