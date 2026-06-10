// jobPosts/{postId}/applications/{tradieId} — read access for the
// bid-marketplace flow. The application now embeds a full itemized `quote`, so
// the locking invariant is: the post-owning client can read each application
// (and therefore the embedded quote it compares + accepts), the applicant can
// read their own, and no other tradesperson/client can read it. Writes are
// callable-only (submitApplication / acceptApplicationQuote use the admin SDK).

import { afterAll, beforeAll, beforeEach, describe, it, expect } from "vitest";
import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  collection,
  collectionGroup,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";

import {
  ADMIN_CLAIMS,
  ADMIN_UID,
  CLIENT_CLAIMS,
  CLIENT_UID,
  OTHER_CLIENT_UID,
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

const POST_ID = "post_1";
const APP_PATH = ["jobPosts", POST_ID, "applications", TRADIE_UID] as const;
const MSG_ID = "m1";
const MSG_PATH = ["jobPosts", POST_ID, "applications", TRADIE_UID, "messages", MSG_ID] as const;

const baselineApplication = {
  tradespersonId: TRADIE_UID,
  postId: POST_ID,
  clientId: CLIENT_UID,
  status: "pending",
  message: "I can help with this — here's my plan and what's included.",
  // Server-derived one-line summary.
  proposedPrice: { type: "fixed", amount: 113_000 },
  // Full itemized quote the client compares + accepts.
  quote: {
    lineItems: [
      { kind: "labour", description: "Labour", quantity: 1, unitPrice: 100_000, taxRate: 0.13 },
    ],
    subtotal: 100_000,
    discount: null,
    discountAmount: 0,
    taxTotal: 13_000,
    total: 113_000,
    currency: "CAD",
    upfrontFee: null,
    estimatedHours: null,
    validUntil: null,
    terms: "",
    noteToClient: "",
  },
  proposedStartDate: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const baselineMessage = {
  senderId: TRADIE_UID,
  text: "Can you start sooner?",
  type: "text",
  createdAt: new Date(),
  senderName: "Tradie",
  senderPhotoURL: null,
};

async function seedApplication() {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const fs = ctx.firestore();
    // The parent post is required so the read rule can resolve post ownership
    // by parent lookup (the meta/applications rules key off the post's clientId).
    await setDoc(doc(fs, "jobPosts", POST_ID), { clientId: CLIENT_UID, status: "open" });
    await setDoc(doc(fs, ...APP_PATH), baselineApplication);
  });
}

async function seedThreadMessage() {
  await seedApplication();
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), ...MSG_PATH), baselineMessage);
  });
}

function fsAs(uid: string, claims: object) {
  return env.authenticatedContext(uid, claims).firestore();
}

describe("applications — read access (bid marketplace)", () => {
  it("the post-owning client can read an application incl. its embedded quote", async () => {
    await seedApplication();
    const snap = await assertSucceeds(
      getDoc(doc(fsAs(CLIENT_UID, CLIENT_CLAIMS), ...APP_PATH)),
    );
    // The quote the client accepts must be readable on the application doc.
    expect(snap.data()?.quote?.total).toBe(113_000);
  });

  it("the applicant can read their own application", async () => {
    await seedApplication();
    await assertSucceeds(getDoc(doc(fsAs(TRADIE_UID, TRADIE_CLAIMS), ...APP_PATH)));
  });

  it("an admin can read any application", async () => {
    await seedApplication();
    await assertSucceeds(getDoc(doc(fsAs(ADMIN_UID, ADMIN_CLAIMS), ...APP_PATH)));
  });

  it("a different tradesperson cannot read someone else's application (bid-blind)", async () => {
    await seedApplication();
    await assertFails(getDoc(doc(fsAs(OTHER_TRADIE_UID, TRADIE_CLAIMS), ...APP_PATH)));
  });

  it("a different client cannot read another client's applicant", async () => {
    await seedApplication();
    await assertFails(getDoc(doc(fsAs(OTHER_CLIENT_UID, CLIENT_CLAIMS), ...APP_PATH)));
  });
});

describe("applications — per-post list (the client's applicant list)", () => {
  // Mirrors subscribeApplicationsForPost: an UNFILTERED list of a post's
  // applications, ordered by createdAt. Only the post owner (+ admin) may run it.
  function appsQuery(fs: ReturnType<typeof fsAs>) {
    return query(
      collection(fs, "jobPosts", POST_ID, "applications"),
      orderBy("createdAt", "asc"),
    );
  }

  it("the post-owning client can list all applications for their post", async () => {
    await seedApplication();
    await assertSucceeds(getDocs(appsQuery(fsAs(CLIENT_UID, CLIENT_CLAIMS))));
  });

  it("an admin can list a post's applications", async () => {
    await seedApplication();
    await assertSucceeds(getDocs(appsQuery(fsAs(ADMIN_UID, ADMIN_CLAIMS))));
  });

  it("a different client cannot list another post's applications", async () => {
    await seedApplication();
    await assertFails(getDocs(appsQuery(fsAs(OTHER_CLIENT_UID, CLIENT_CLAIMS))));
  });

  it("a tradesperson cannot list all of a post's applications (bid-blind)", async () => {
    await seedApplication();
    await assertFails(getDocs(appsQuery(fsAs(TRADIE_UID, TRADIE_CLAIMS))));
  });
});

describe("applications — collection-group read (the 'Applied' tab)", () => {
  it("a tradesperson can collection-group query their own applications", async () => {
    await seedApplication();
    await assertSucceeds(
      getDocs(
        query(
          collectionGroup(fsAs(TRADIE_UID, TRADIE_CLAIMS), "applications"),
          where("tradespersonId", "==", TRADIE_UID),
        ),
      ),
    );
  });

  it("a tradesperson cannot collection-group query another tradie's applications", async () => {
    await seedApplication();
    await assertFails(
      getDocs(
        query(
          collectionGroup(fsAs(OTHER_TRADIE_UID, TRADIE_CLAIMS), "applications"),
          where("tradespersonId", "==", TRADIE_UID),
        ),
      ),
    );
  });
});

describe("applications — writes are callable-only", () => {
  it("a tradesperson cannot create an application by direct write", async () => {
    await assertFails(
      setDoc(doc(fsAs(TRADIE_UID, TRADIE_CLAIMS), ...APP_PATH), baselineApplication),
    );
  });

  it("the applicant cannot edit their own application (incl. the quote)", async () => {
    await seedApplication();
    await assertFails(
      updateDoc(doc(fsAs(TRADIE_UID, TRADIE_CLAIMS), ...APP_PATH), {
        "quote.total": 1,
      }),
    );
  });

  it("the client cannot flip an application to selected by direct write", async () => {
    await seedApplication();
    await assertFails(
      updateDoc(doc(fsAs(CLIENT_UID, CLIENT_CLAIMS), ...APP_PATH), { status: "selected" }),
    );
  });

  it("the client cannot decline an application by direct write (callable-only)", async () => {
    await seedApplication();
    await assertFails(
      updateDoc(doc(fsAs(CLIENT_UID, CLIENT_CLAIMS), ...APP_PATH), {
        status: "declined",
        declinedReason: "Too expensive",
      }),
    );
  });
});

describe("applications — Q&A thread read access (pre-acceptance)", () => {
  it("the post-owning client can read a thread message", async () => {
    await seedThreadMessage();
    await assertSucceeds(getDoc(doc(fsAs(CLIENT_UID, CLIENT_CLAIMS), ...MSG_PATH)));
  });

  it("the applicant can read their own thread message", async () => {
    await seedThreadMessage();
    await assertSucceeds(getDoc(doc(fsAs(TRADIE_UID, TRADIE_CLAIMS), ...MSG_PATH)));
  });

  it("an admin can read a thread message", async () => {
    await seedThreadMessage();
    await assertSucceeds(getDoc(doc(fsAs(ADMIN_UID, ADMIN_CLAIMS), ...MSG_PATH)));
  });

  it("a different tradesperson cannot read the thread (bid-blind)", async () => {
    await seedThreadMessage();
    await assertFails(getDoc(doc(fsAs(OTHER_TRADIE_UID, TRADIE_CLAIMS), ...MSG_PATH)));
  });

  it("a different client cannot read the thread", async () => {
    await seedThreadMessage();
    await assertFails(getDoc(doc(fsAs(OTHER_CLIENT_UID, CLIENT_CLAIMS), ...MSG_PATH)));
  });

  it("a different tradesperson cannot list another applicant's thread", async () => {
    await seedThreadMessage();
    await assertFails(
      getDocs(
        query(
          collection(fsAs(OTHER_TRADIE_UID, TRADIE_CLAIMS), "jobPosts", POST_ID, "applications", TRADIE_UID, "messages"),
          orderBy("createdAt", "asc"),
        ),
      ),
    );
  });
});

describe("applications — Q&A thread writes are callable-only", () => {
  it("the client cannot post a thread message by direct write", async () => {
    await seedApplication();
    await assertFails(
      setDoc(doc(fsAs(CLIENT_UID, CLIENT_CLAIMS), ...MSG_PATH), {
        ...baselineMessage,
        senderId: CLIENT_UID,
      }),
    );
  });

  it("the applicant cannot post a thread message by direct write", async () => {
    await seedApplication();
    await assertFails(
      setDoc(doc(fsAs(TRADIE_UID, TRADIE_CLAIMS), ...MSG_PATH), baselineMessage),
    );
  });

  it("a party cannot edit or delete an existing thread message", async () => {
    await seedThreadMessage();
    await assertFails(
      updateDoc(doc(fsAs(TRADIE_UID, TRADIE_CLAIMS), ...MSG_PATH), { text: "edited" }),
    );
    await assertFails(deleteDoc(doc(fsAs(CLIENT_UID, CLIENT_CLAIMS), ...MSG_PATH)));
  });
});
