// quotes/{quoteId} — access + field-lock coverage for the quote-accept flow.
//
// Why this exists: the homeowner's "accept quote" loop depends on this
// collection's rules being exactly right. The client has to be able to READ
// the quote (the accept banner subscribes to it) and flip sent → viewed
// (the read-receipt), but must NOT be able to self-accept or rewrite the
// money fields by direct write — acceptance flows only through the
// clientAcceptQuote callable (admin SDK, bypasses rules). These tests pin
// every one of those invariants. Quotes are keyed deterministically by jobId
// (quotes/{jobId}), same pattern as invoices.

import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";
import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, updateDoc } from "firebase/firestore";

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

// Quote id == jobId (submitQuote convention).
const QUOTE_ID = "job_1";

// Full QuoteDoc shape as written by functions/src/jobs/submitQuote.ts. The
// client sent → viewed rule pins tradespersonId/clientId/jobId/quoteNumber/
// lineItems/subtotal/discount/discountAmount/total, so all of those must be
// present on the baseline for the equality checks to evaluate.
const baselineQuote = {
  tradespersonId: TRADIE_UID,
  clientId: CLIENT_UID,
  jobId: QUOTE_ID,
  quoteNumber: "Q-2026-0001",
  status: "sent",
  lineItems: [{ kind: "labour", description: "Labour", quantity: 1, unitPrice: 10_000, taxRate: 0 }],
  subtotal: 10_000,
  discount: null,
  discountAmount: 0,
  taxTotal: 0,
  total: 10_000,
  currency: "CAD",
  estimatedHours: null,
  validUntil: null,
  terms: "",
  noteToClient: "",
  declinedReason: null,
  issuedAt: null,
  sentAt: null,
  viewedAt: null,
  acceptedAt: null,
  declinedAt: null,
  pdfUrl: null,
  upfrontFee: null,
};

async function seedQuote(overrides: Record<string, unknown> = {}) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), "quotes", QUOTE_ID), {
      ...baselineQuote,
      ...overrides,
    });
  });
}

function asClient() {
  return env.authenticatedContext(CLIENT_UID, CLIENT_CLAIMS).firestore();
}
function asTradie() {
  return env.authenticatedContext(TRADIE_UID, TRADIE_CLAIMS).firestore();
}

// ---------------------------------------------------------------------------
// READ — the accept banner + QuoteCard subscribe to the quote. If the client
// can't read it, the upfront-fee copy and "Viewed" receipt silently break.
// ---------------------------------------------------------------------------
describe("quotes — read access", () => {
  it("the owning client can read their quote", async () => {
    await seedQuote();
    await assertSucceeds(getDoc(doc(asClient(), "quotes", QUOTE_ID)));
  });

  it("the owning tradesperson can read their quote", async () => {
    await seedQuote();
    await assertSucceeds(getDoc(doc(asTradie(), "quotes", QUOTE_ID)));
  });

  it("an admin can read any quote", async () => {
    await seedQuote();
    const fs = env.authenticatedContext(ADMIN_UID, ADMIN_CLAIMS).firestore();
    await assertSucceeds(getDoc(doc(fs, "quotes", QUOTE_ID)));
  });

  it("a different client cannot read someone else's quote", async () => {
    await seedQuote();
    const fs = env.authenticatedContext(OTHER_CLIENT_UID, CLIENT_CLAIMS).firestore();
    await assertFails(getDoc(doc(fs, "quotes", QUOTE_ID)));
  });

  it("a different tradesperson cannot read someone else's quote", async () => {
    await seedQuote();
    const fs = env.authenticatedContext(OTHER_TRADIE_UID, TRADIE_CLAIMS).firestore();
    await assertFails(getDoc(doc(fs, "quotes", QUOTE_ID)));
  });

  it("a signed-in user reading a MISSING quote is allowed (the 'no quote yet' probe)", async () => {
    // resource == null short-circuit: getQuoteByJobId probes quotes/{jobId}
    // and must get a clean empty result, not permission-denied.
    await assertSucceeds(getDoc(doc(asClient(), "quotes", "does-not-exist")));
  });
});

// ---------------------------------------------------------------------------
// CLIENT WRITE — only the sent → viewed read-receipt is allowed, and only
// with every money/identity field pinned. The client must NOT be able to
// self-accept or edit the quote by direct write.
// ---------------------------------------------------------------------------
describe("quotes — client read-receipt (sent → viewed)", () => {
  it("client can flip sent → viewed (status + viewedAt only)", async () => {
    await seedQuote({ status: "sent" });
    await assertSucceeds(
      updateDoc(doc(asClient(), "quotes", QUOTE_ID), {
        status: "viewed",
        viewedAt: new Date(),
      }),
    );
  });

  it("client CANNOT mark viewed while tampering with the total", async () => {
    await seedQuote({ status: "sent" });
    await assertFails(
      updateDoc(doc(asClient(), "quotes", QUOTE_ID), {
        status: "viewed",
        total: 1, // underpay attempt
      }),
    );
  });

  it("client CANNOT mark viewed while rewriting line items", async () => {
    await seedQuote({ status: "sent" });
    await assertFails(
      updateDoc(doc(asClient(), "quotes", QUOTE_ID), {
        status: "viewed",
        lineItems: [{ kind: "labour", description: "cheaper", quantity: 1, unitPrice: 1, taxRate: 0 }],
        subtotal: 1,
        total: 1,
      }),
    );
  });

  it("client CANNOT self-accept by direct write (must use the callable)", async () => {
    await seedQuote({ status: "sent" });
    await assertFails(
      updateDoc(doc(asClient(), "quotes", QUOTE_ID), { status: "accepted" }),
    );
  });

  it("client CANNOT decline by direct write (must use the callable)", async () => {
    await seedQuote({ status: "sent" });
    await assertFails(
      updateDoc(doc(asClient(), "quotes", QUOTE_ID), {
        status: "declined",
        declinedReason: "too pricey",
      }),
    );
  });

  it("client CANNOT re-view an already-viewed quote (rule requires prior status == sent)", async () => {
    await seedQuote({ status: "viewed" });
    await assertFails(
      updateDoc(doc(asClient(), "quotes", QUOTE_ID), { status: "viewed", viewedAt: new Date() }),
    );
  });
});

// ---------------------------------------------------------------------------
// TRADIE WRITE — can revise their own quote until it's accepted, with the
// identity fields locked. Frozen once accepted.
// ---------------------------------------------------------------------------
describe("quotes — tradesperson edits", () => {
  it("tradesperson can edit line items on their own sent quote", async () => {
    await seedQuote({ status: "sent" });
    await assertSucceeds(
      updateDoc(doc(asTradie(), "quotes", QUOTE_ID), {
        lineItems: [{ kind: "labour", description: "Revised", quantity: 2, unitPrice: 10_000, taxRate: 0 }],
        subtotal: 20_000,
        total: 20_000,
      }),
    );
  });

  it("tradesperson CANNOT edit a quote once it is accepted (frozen)", async () => {
    await seedQuote({ status: "accepted" });
    await assertFails(
      updateDoc(doc(asTradie(), "quotes", QUOTE_ID), {
        lineItems: [{ kind: "labour", description: "Sneaky post-accept edit", quantity: 1, unitPrice: 1, taxRate: 0 }],
      }),
    );
  });

  it("tradesperson CANNOT change the quote number", async () => {
    await seedQuote({ status: "sent" });
    await assertFails(
      updateDoc(doc(asTradie(), "quotes", QUOTE_ID), { quoteNumber: "Q-2026-9999" }),
    );
  });

  it("tradesperson CANNOT reassign the quote to a different client", async () => {
    await seedQuote({ status: "sent" });
    await assertFails(
      updateDoc(doc(asTradie(), "quotes", QUOTE_ID), { clientId: OTHER_CLIENT_UID }),
    );
  });

  it("tradesperson CANNOT self-accept their own quote by direct write (P3-11)", async () => {
    await seedQuote({ status: "sent" });
    await assertFails(
      updateDoc(doc(asTradie(), "quotes", QUOTE_ID), { status: "accepted" }),
    );
  });
});

// ---------------------------------------------------------------------------
// CREATE — always denied; quotes are only ever created by submitQuote
// (admin SDK). allow create: if false.
// ---------------------------------------------------------------------------
describe("quotes — create is closed to clients (callable-only)", () => {
  it("client cannot create a quote directly", async () => {
    await assertFails(
      setDoc(doc(asClient(), "quotes", "new-quote"), { ...baselineQuote, jobId: "new-quote" }),
    );
  });

  it("tradesperson cannot create a quote directly", async () => {
    await assertFails(
      setDoc(doc(asTradie(), "quotes", "new-quote"), { ...baselineQuote, jobId: "new-quote" }),
    );
  });
});
