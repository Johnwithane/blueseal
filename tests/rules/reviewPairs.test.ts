// reviewPairs/{jobId} + the mutual-blind reveal contract on /reviews and
// /clientReviews. The pair doc is server-managed (writes go through
// ensureReviewPair / revealPair via the admin SDK); the reads gate UI
// state, so parties must see them, outsiders must not.
//
// On the review docs themselves: `revealedAt` is the load-bearing field.
// The subject (counterparty) can read only after it's set; the author
// can always read their own; the world reads only when the review is
// both `status="active"` AND `revealedAt != null`. Tests below cover
// each leg of that.

import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";
import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { Timestamp, doc, getDoc, setDoc } from "firebase/firestore";

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

const JOB_ID = "job_1";
const REVIEW_ID = "review_1";
const CLIENT_REVIEW_ID = "clientReview_1";

interface SeedOpts {
  // Whether the underlying reviews/clientReviews are revealed yet.
  reviewRevealed?: boolean;
  clientReviewRevealed?: boolean;
  pairLocked?: boolean;
}

async function seed(opts: SeedOpts = {}) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const fs = ctx.firestore();
    const now = Timestamp.now();

    // Underlying job — used by the create rules on /reviews and
    // /clientReviews via jobDoc() get(). status must be "complete" for
    // creates to pass the create rule.
    await setDoc(doc(fs, "jobs", JOB_ID), {
      clientId: CLIENT_UID,
      tradespersonId: TRADIE_UID,
      chatId: "chat_1",
      status: "complete",
      trade: "plumbing",
      privateNotes: "",
      createdAt: now,
    });

    await setDoc(doc(fs, "reviewPairs", JOB_ID), {
      jobId: JOB_ID,
      clientId: CLIENT_UID,
      tradespersonId: TRADIE_UID,
      invoicePaidAt: now,
      deadlineAt: Timestamp.fromMillis(now.toMillis() + 14 * 24 * 60 * 60 * 1000),
      clientSubmittedAt: opts.reviewRevealed ? now : null,
      tradieSubmittedAt: opts.clientReviewRevealed ? now : null,
      clientReviewId: opts.reviewRevealed ? REVIEW_ID : null,
      tradieReviewId: opts.clientReviewRevealed ? CLIENT_REVIEW_ID : null,
      revealedAt:
        opts.reviewRevealed || opts.clientReviewRevealed ? now : null,
      lastNudgedAt: null,
      nudgeCount: 0,
      locked: opts.pairLocked ?? false,
    });

    await setDoc(doc(fs, "reviews", REVIEW_ID), {
      jobId: JOB_ID,
      clientId: CLIENT_UID,
      tradespersonId: TRADIE_UID,
      rating: 5,
      dimensions: { quality: 5, punctuality: 5, communication: 5, value: 5 },
      text: "Great work",
      createdAt: now,
      status: "active",
      revealedAt: opts.reviewRevealed ? now : null,
    });

    await setDoc(doc(fs, "clientReviews", CLIENT_REVIEW_ID), {
      jobId: JOB_ID,
      clientId: CLIENT_UID,
      tradespersonId: TRADIE_UID,
      rating: 4,
      categoryScores: {
        punctuality: 5,
        communication: 4,
        clarity: 4,
        payment: 5,
      },
      text: "Easy client",
      createdAt: now,
      revealedAt: opts.clientReviewRevealed ? now : null,
    });
  });
}

describe("reviewPairs — read access", () => {
  it("client party can read their own pair", async () => {
    await seed();
    const fs = env.authenticatedContext(CLIENT_UID, CLIENT_CLAIMS).firestore();
    await assertSucceeds(getDoc(doc(fs, "reviewPairs", JOB_ID)));
  });

  it("tradesperson party can read their own pair", async () => {
    await seed();
    const fs = env.authenticatedContext(TRADIE_UID, TRADIE_CLAIMS).firestore();
    await assertSucceeds(getDoc(doc(fs, "reviewPairs", JOB_ID)));
  });

  it("admin can read any pair", async () => {
    await seed();
    const fs = env.authenticatedContext(ADMIN_UID, ADMIN_CLAIMS).firestore();
    await assertSucceeds(getDoc(doc(fs, "reviewPairs", JOB_ID)));
  });

  it("unrelated client cannot read the pair", async () => {
    await seed();
    const fs = env
      .authenticatedContext(OTHER_CLIENT_UID, CLIENT_CLAIMS)
      .firestore();
    await assertFails(getDoc(doc(fs, "reviewPairs", JOB_ID)));
  });

  it("unrelated tradesperson cannot read the pair", async () => {
    await seed();
    const fs = env
      .authenticatedContext(OTHER_TRADIE_UID, TRADIE_CLAIMS)
      .firestore();
    await assertFails(getDoc(doc(fs, "reviewPairs", JOB_ID)));
  });

  it("unauthenticated user cannot read the pair", async () => {
    await seed();
    const fs = env.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(fs, "reviewPairs", JOB_ID)));
  });
});

describe("reviewPairs — writes are server-only", () => {
  it("client cannot create a pair", async () => {
    const fs = env.authenticatedContext(CLIENT_UID, CLIENT_CLAIMS).firestore();
    await assertFails(
      setDoc(doc(fs, "reviewPairs", JOB_ID), {
        jobId: JOB_ID,
        clientId: CLIENT_UID,
        tradespersonId: TRADIE_UID,
        invoicePaidAt: Timestamp.now(),
        deadlineAt: Timestamp.now(),
        clientSubmittedAt: null,
        tradieSubmittedAt: null,
        clientReviewId: null,
        tradieReviewId: null,
        revealedAt: null,
        lastNudgedAt: null,
        nudgeCount: 0,
        locked: false,
      }),
    );
  });

  it("admin user cannot write directly (admin SDK does, not admin user)", async () => {
    // admin role on a user is for moderation; pair docs are server-only.
    const fs = env.authenticatedContext(ADMIN_UID, ADMIN_CLAIMS).firestore();
    await assertFails(
      setDoc(doc(fs, "reviewPairs", JOB_ID), {
        jobId: JOB_ID,
        clientId: CLIENT_UID,
        tradespersonId: TRADIE_UID,
        invoicePaidAt: Timestamp.now(),
        deadlineAt: Timestamp.now(),
        clientSubmittedAt: null,
        tradieSubmittedAt: null,
        clientReviewId: null,
        tradieReviewId: null,
        revealedAt: null,
        lastNudgedAt: null,
        nudgeCount: 0,
        locked: false,
      }),
    );
  });
});

describe("reviews — reveal gating", () => {
  it("author (client) can read their own review pre-reveal", async () => {
    await seed({ reviewRevealed: false });
    const fs = env.authenticatedContext(CLIENT_UID, CLIENT_CLAIMS).firestore();
    await assertSucceeds(getDoc(doc(fs, "reviews", REVIEW_ID)));
  });

  it("counterparty (tradesperson) CANNOT read the public review pre-reveal", async () => {
    await seed({ reviewRevealed: false });
    const fs = env.authenticatedContext(TRADIE_UID, TRADIE_CLAIMS).firestore();
    await assertFails(getDoc(doc(fs, "reviews", REVIEW_ID)));
  });

  it("counterparty can read the public review once revealed", async () => {
    await seed({ reviewRevealed: true });
    const fs = env.authenticatedContext(TRADIE_UID, TRADIE_CLAIMS).firestore();
    await assertSucceeds(getDoc(doc(fs, "reviews", REVIEW_ID)));
  });

  it("world cannot read the public review pre-reveal", async () => {
    await seed({ reviewRevealed: false });
    const fs = env.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(fs, "reviews", REVIEW_ID)));
  });

  it("world CAN read the public review once revealed", async () => {
    await seed({ reviewRevealed: true });
    const fs = env.unauthenticatedContext().firestore();
    await assertSucceeds(getDoc(doc(fs, "reviews", REVIEW_ID)));
  });

  it("admin can read pre-reveal", async () => {
    await seed({ reviewRevealed: false });
    const fs = env.authenticatedContext(ADMIN_UID, ADMIN_CLAIMS).firestore();
    await assertSucceeds(getDoc(doc(fs, "reviews", REVIEW_ID)));
  });
});

describe("clientReviews — reveal gating", () => {
  it("author (tradesperson) can read their own private review pre-reveal", async () => {
    await seed({ clientReviewRevealed: false });
    const fs = env.authenticatedContext(TRADIE_UID, TRADIE_CLAIMS).firestore();
    await assertSucceeds(getDoc(doc(fs, "clientReviews", CLIENT_REVIEW_ID)));
  });

  it("subject (client) CANNOT read the private review pre-reveal", async () => {
    await seed({ clientReviewRevealed: false });
    const fs = env.authenticatedContext(CLIENT_UID, CLIENT_CLAIMS).firestore();
    await assertFails(getDoc(doc(fs, "clientReviews", CLIENT_REVIEW_ID)));
  });

  it("subject (client) can read the private review once revealed", async () => {
    await seed({ clientReviewRevealed: true });
    const fs = env.authenticatedContext(CLIENT_UID, CLIENT_CLAIMS).firestore();
    await assertSucceeds(getDoc(doc(fs, "clientReviews", CLIENT_REVIEW_ID)));
  });

  it("unrelated tradesperson cannot read it pre- or post-reveal (party-only contract)", async () => {
    await seed({ clientReviewRevealed: true });
    const fs = env
      .authenticatedContext(OTHER_TRADIE_UID, TRADIE_CLAIMS)
      .firestore();
    await assertFails(getDoc(doc(fs, "clientReviews", CLIENT_REVIEW_ID)));
  });
});

describe("review creation — pair lock contract", () => {
  it("client can create a review when the pair is unlocked", async () => {
    await seed();
    const fs = env.authenticatedContext(CLIENT_UID, CLIENT_CLAIMS).firestore();
    await assertSucceeds(
      setDoc(doc(fs, "reviews", "review_new"), {
        jobId: JOB_ID,
        clientId: CLIENT_UID,
        tradespersonId: TRADIE_UID,
        rating: 5,
        dimensions: { quality: 5, punctuality: 5, communication: 5, value: 5 },
        text: "Good",
        createdAt: Timestamp.now(),
        status: "active",
        revealedAt: null,
      }),
    );
  });

  it("client CANNOT create a review once the pair is locked (deadline passed)", async () => {
    await seed({ pairLocked: true });
    const fs = env.authenticatedContext(CLIENT_UID, CLIENT_CLAIMS).firestore();
    await assertFails(
      setDoc(doc(fs, "reviews", "review_late"), {
        jobId: JOB_ID,
        clientId: CLIENT_UID,
        tradespersonId: TRADIE_UID,
        rating: 5,
        dimensions: { quality: 5, punctuality: 5, communication: 5, value: 5 },
        text: "Too late",
        createdAt: Timestamp.now(),
        status: "active",
        revealedAt: null,
      }),
    );
  });

  it("client CANNOT pre-set revealedAt on create", async () => {
    await seed();
    const fs = env.authenticatedContext(CLIENT_UID, CLIENT_CLAIMS).firestore();
    await assertFails(
      setDoc(doc(fs, "reviews", "review_sneaky"), {
        jobId: JOB_ID,
        clientId: CLIENT_UID,
        tradespersonId: TRADIE_UID,
        rating: 5,
        dimensions: { quality: 5, punctuality: 5, communication: 5, value: 5 },
        text: "Try to bypass blind",
        createdAt: Timestamp.now(),
        status: "active",
        revealedAt: Timestamp.now(),
      }),
    );
  });

  it("tradesperson can create a private review when the pair is unlocked", async () => {
    await seed();
    const fs = env.authenticatedContext(TRADIE_UID, TRADIE_CLAIMS).firestore();
    await assertSucceeds(
      setDoc(doc(fs, "clientReviews", "cr_new"), {
        jobId: JOB_ID,
        clientId: CLIENT_UID,
        tradespersonId: TRADIE_UID,
        rating: 5,
        categoryScores: {
          punctuality: 5,
          communication: 5,
          clarity: 5,
          payment: 5,
        },
        text: "Great",
        createdAt: Timestamp.now(),
        revealedAt: null,
      }),
    );
  });

  it("tradesperson CANNOT create a private review once the pair is locked", async () => {
    await seed({ pairLocked: true });
    const fs = env.authenticatedContext(TRADIE_UID, TRADIE_CLAIMS).firestore();
    await assertFails(
      setDoc(doc(fs, "clientReviews", "cr_late"), {
        jobId: JOB_ID,
        clientId: CLIENT_UID,
        tradespersonId: TRADIE_UID,
        rating: 5,
        categoryScores: {
          punctuality: 5,
          communication: 5,
          clarity: 5,
          payment: 5,
        },
        text: "Too late",
        createdAt: Timestamp.now(),
        revealedAt: null,
      }),
    );
  });
});
