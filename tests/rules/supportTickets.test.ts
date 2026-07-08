// supportTickets/{ticketId} — Help Center contact-form messages.
// Signed-in users create (locked to the exact shape); admins read + triage and
// may only change status/updatedAt/handledBy. Signed-out create is refused
// (the form falls back to email).

import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";
import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "firebase/firestore";

import {
  ADMIN_CLAIMS,
  ADMIN_UID,
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

const TICKET_ID = "ticket_1";

function validTicket(uid: string) {
  return {
    userId: uid,
    name: "Sam Client",
    email: "sam@example.com",
    topic: "A problem with a job",
    message: "My tradesperson hasn't replied in a week.",
    status: "open",
    handledBy: null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
}

async function seedTicket() {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), "supportTickets", TICKET_ID), {
      ...validTicket(CLIENT_UID),
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  });
}

describe("supportTickets — create", () => {
  it("a signed-in user can file a valid ticket for themselves", async () => {
    const fs = env.authenticatedContext(CLIENT_UID, CLIENT_CLAIMS).firestore();
    await assertSucceeds(
      addDoc(collection(fs, "supportTickets"), validTicket(CLIENT_UID)),
    );
  });

  it("a signed-out visitor cannot create a ticket", async () => {
    const fs = env.unauthenticatedContext().firestore();
    await assertFails(
      addDoc(collection(fs, "supportTickets"), validTicket(CLIENT_UID)),
    );
  });

  it("cannot spoof another user's id", async () => {
    const fs = env.authenticatedContext(CLIENT_UID, CLIENT_CLAIMS).firestore();
    await assertFails(
      addDoc(collection(fs, "supportTickets"), validTicket(OTHER_CLIENT_UID)),
    );
  });

  it("cannot create with a non-open status", async () => {
    const fs = env.authenticatedContext(CLIENT_UID, CLIENT_CLAIMS).firestore();
    await assertFails(
      addDoc(collection(fs, "supportTickets"), {
        ...validTicket(CLIENT_UID),
        status: "resolved",
      }),
    );
  });

  it("cannot pre-set handledBy", async () => {
    const fs = env.authenticatedContext(CLIENT_UID, CLIENT_CLAIMS).firestore();
    await assertFails(
      addDoc(collection(fs, "supportTickets"), {
        ...validTicket(CLIENT_UID),
        handledBy: ADMIN_UID,
      }),
    );
  });

  it("cannot include an unexpected field", async () => {
    const fs = env.authenticatedContext(CLIENT_UID, CLIENT_CLAIMS).firestore();
    await assertFails(
      addDoc(collection(fs, "supportTickets"), {
        ...validTicket(CLIENT_UID),
        adminOnlyNote: "sneaky",
      }),
    );
  });

  it("rejects an over-long message", async () => {
    const fs = env.authenticatedContext(CLIENT_UID, CLIENT_CLAIMS).firestore();
    await assertFails(
      addDoc(collection(fs, "supportTickets"), {
        ...validTicket(CLIENT_UID),
        message: "x".repeat(2001),
      }),
    );
  });

  it("accepts an optional jobId (job-detail 'report a problem' path)", async () => {
    const fs = env.authenticatedContext(CLIENT_UID, CLIENT_CLAIMS).firestore();
    await assertSucceeds(
      addDoc(collection(fs, "supportTickets"), {
        ...validTicket(CLIENT_UID),
        jobId: "job_123",
      }),
    );
  });

  it("rejects a non-string jobId", async () => {
    const fs = env.authenticatedContext(CLIENT_UID, CLIENT_CLAIMS).firestore();
    await assertFails(
      addDoc(collection(fs, "supportTickets"), {
        ...validTicket(CLIENT_UID),
        jobId: 123,
      }),
    );
  });
});

describe("supportTickets — read", () => {
  it("admin can read tickets", async () => {
    await seedTicket();
    const fs = env.authenticatedContext(ADMIN_UID, ADMIN_CLAIMS).firestore();
    await assertSucceeds(getDocs(collection(fs, "supportTickets")));
  });

  it("a non-admin cannot read tickets (not even their own)", async () => {
    await seedTicket();
    const fs = env.authenticatedContext(CLIENT_UID, CLIENT_CLAIMS).firestore();
    await assertFails(getDoc(doc(fs, "supportTickets", TICKET_ID)));
  });
});

describe("supportTickets — update / delete", () => {
  it("admin can change the status", async () => {
    await seedTicket();
    const fs = env.authenticatedContext(ADMIN_UID, ADMIN_CLAIMS).firestore();
    await assertSucceeds(
      updateDoc(doc(fs, "supportTickets", TICKET_ID), {
        status: "in_progress",
        handledBy: ADMIN_UID,
        updatedAt: serverTimestamp(),
      }),
    );
  });

  it("admin cannot edit the message via update", async () => {
    await seedTicket();
    const fs = env.authenticatedContext(ADMIN_UID, ADMIN_CLAIMS).firestore();
    await assertFails(
      updateDoc(doc(fs, "supportTickets", TICKET_ID), { message: "tampered" }),
    );
  });

  it("a non-admin cannot update a ticket", async () => {
    await seedTicket();
    const fs = env.authenticatedContext(CLIENT_UID, CLIENT_CLAIMS).firestore();
    await assertFails(
      updateDoc(doc(fs, "supportTickets", TICKET_ID), { status: "closed" }),
    );
  });

  it("a non-admin cannot delete a ticket", async () => {
    await seedTicket();
    const fs = env.authenticatedContext(CLIENT_UID, CLIENT_CLAIMS).firestore();
    await assertFails(deleteDoc(doc(fs, "supportTickets", TICKET_ID)));
  });

  it("admin can delete a ticket", async () => {
    await seedTicket();
    const fs = env.authenticatedContext(ADMIN_UID, ADMIN_CLAIMS).firestore();
    await assertSucceeds(deleteDoc(doc(fs, "supportTickets", TICKET_ID)));
  });

  it("admin can write internal triage notes", async () => {
    await seedTicket();
    const fs = env.authenticatedContext(ADMIN_UID, ADMIN_CLAIMS).firestore();
    await assertSucceeds(
      updateDoc(doc(fs, "supportTickets", TICKET_ID), {
        internalNotes: "Called the customer; awaiting docs.",
        updatedAt: serverTimestamp(),
      }),
    );
  });
});

describe("supportTickets/{id}/replies — admin read, callable-only write", () => {
  async function seedReply() {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "supportTickets", TICKET_ID, "replies", "r1"), {
        senderUid: ADMIN_UID,
        senderName: "Support",
        body: "Thanks for reaching out.",
        mode: "reply",
        sentAt: new Date(),
      });
    });
  }

  it("admin can read replies", async () => {
    await seedReply();
    const fs = env.authenticatedContext(ADMIN_UID, ADMIN_CLAIMS).firestore();
    await assertSucceeds(getDocs(collection(fs, "supportTickets", TICKET_ID, "replies")));
  });

  it("a non-admin cannot read replies", async () => {
    await seedReply();
    const fs = env.authenticatedContext(CLIENT_UID, CLIENT_CLAIMS).firestore();
    await assertFails(getDoc(doc(fs, "supportTickets", TICKET_ID, "replies", "r1")));
  });

  it("even an admin cannot create a reply from the client (callable-only)", async () => {
    const fs = env.authenticatedContext(ADMIN_UID, ADMIN_CLAIMS).firestore();
    await assertFails(
      setDoc(doc(fs, "supportTickets", TICKET_ID, "replies", "r2"), {
        senderUid: ADMIN_UID,
        senderName: "Support",
        body: "Hi",
        mode: "reply",
        sentAt: serverTimestamp(),
      }),
    );
  });
});
