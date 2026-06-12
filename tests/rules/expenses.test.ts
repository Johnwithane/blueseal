// jobs/{jobId}/expenses — the tradesperson's cost records (receipts +
// manually-added materials). Cost-sensitive: only the OWNING tradesperson and
// admin may read; the client never sees totalCost, markup, or the receipt —
// they only ever see the marked-up invoice line. Expenses come in two shapes:
// receipt-backed (receiptStoragePath set, born "parsing" for the OCR pass)
// and manual (receiptStoragePath null, born "ready") — the rules accept both,
// and these tests pin that contract since the client relies on it.

import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";
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
const RECEIPT_EXPENSE_ID = "exp_receipt";
const MANUAL_EXPENSE_ID = "exp_manual";

function receiptExpense(overrides: Record<string, unknown> = {}) {
  return {
    tradespersonId: TRADIE_UID,
    clientId: CLIENT_UID,
    description: "",
    vendor: null,
    spentAt: null,
    totalCost: 0,
    markupPercent: 15,
    billedAmount: 0,
    category: null,
    receiptStoragePath: `jobs/${JOB_ID}/receipts/123_abc.webp`,
    status: "parsing",
    aiParsed: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    invoicedAt: null,
    ...overrides,
  };
}

// Mirrors createManualExpense: no receipt, born "ready".
function manualExpense(overrides: Record<string, unknown> = {}) {
  return receiptExpense({
    category: "materials",
    receiptStoragePath: null,
    status: "ready",
    ...overrides,
  });
}

async function seed() {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const fs = ctx.firestore();
    await setDoc(doc(fs, "jobs", JOB_ID), {
      clientId: CLIENT_UID,
      tradespersonId: TRADIE_UID,
      status: "in_progress",
    });
    await setDoc(doc(fs, "jobs", JOB_ID, "expenses", RECEIPT_EXPENSE_ID), receiptExpense());
    await setDoc(doc(fs, "jobs", JOB_ID, "expenses", MANUAL_EXPENSE_ID), manualExpense());
  });
}

function fsAs(uid: string, claims: object) {
  return env.authenticatedContext(uid, claims).firestore();
}

// Mirrors subscribeJobExpenses: filter on tradespersonId + orderBy createdAt.
function expensesQuery(fs: ReturnType<typeof fsAs>) {
  return query(
    collection(fs, "jobs", JOB_ID, "expenses"),
    where("tradespersonId", "==", TRADIE_UID),
    orderBy("createdAt", "desc"),
  );
}

// Collection-group read for the Pro business reports (listMyExpensesInRange).
describe("expenses — collection-group read scoped to own docs", () => {
  it("a tradesperson can collectionGroup-read their own expenses", async () => {
    await seed();
    const fs = fsAs(TRADIE_UID, TRADIE_CLAIMS);
    await assertSucceeds(
      getDocs(query(collectionGroup(fs, "expenses"), where("tradespersonId", "==", TRADIE_UID))),
    );
  });

  it("a different tradesperson cannot collectionGroup-read someone else's expenses", async () => {
    await seed();
    const fs = fsAs(OTHER_TRADIE_UID, TRADIE_CLAIMS);
    await assertFails(
      getDocs(query(collectionGroup(fs, "expenses"), where("tradespersonId", "==", TRADIE_UID))),
    );
  });
});

describe("jobs/{jobId}/expenses — read is owner + admin only (cost-sensitive)", () => {
  it("the owning tradesperson can list their expenses", async () => {
    await seed();
    await assertSucceeds(getDocs(expensesQuery(fsAs(TRADIE_UID, TRADIE_CLAIMS))));
  });

  it("an admin can read an expense", async () => {
    await seed();
    await assertSucceeds(
      getDoc(doc(fsAs(ADMIN_UID, ADMIN_CLAIMS), "jobs", JOB_ID, "expenses", RECEIPT_EXPENSE_ID)),
    );
  });

  it("the client cannot read an expense on their own job", async () => {
    await seed();
    await assertFails(
      getDoc(doc(fsAs(CLIENT_UID, CLIENT_CLAIMS), "jobs", JOB_ID, "expenses", RECEIPT_EXPENSE_ID)),
    );
  });

  it("another tradesperson cannot list someone else's expenses", async () => {
    await seed();
    await assertFails(getDocs(expensesQuery(fsAs(OTHER_TRADIE_UID, TRADIE_CLAIMS))));
  });
});

describe("expenses — create (receipt-backed and manual shapes)", () => {
  function createAs(uid: string, claims: object, id: string, data: Record<string, unknown>) {
    return setDoc(doc(fsAs(uid, claims), "jobs", JOB_ID, "expenses", id), data);
  }

  it("the assigned tradesperson can create a receipt-backed expense (parsing)", async () => {
    await seed();
    await assertSucceeds(createAs(TRADIE_UID, TRADIE_CLAIMS, "new_receipt", receiptExpense()));
  });

  it("the assigned tradesperson can create a manual expense (null path, ready)", async () => {
    await seed();
    await assertSucceeds(createAs(TRADIE_UID, TRADIE_CLAIMS, "new_manual", manualExpense()));
  });

  it("the client cannot create an expense", async () => {
    await seed();
    await assertFails(createAs(CLIENT_UID, CLIENT_CLAIMS, "new_x", manualExpense()));
  });

  it("a tradesperson not assigned to the job cannot create an expense as themselves", async () => {
    await seed();
    await assertFails(
      createAs(
        OTHER_TRADIE_UID,
        TRADIE_CLAIMS,
        "new_x",
        manualExpense({ tradespersonId: OTHER_TRADIE_UID }),
      ),
    );
  });

  it("cannot create an expense already stamped invoiced", async () => {
    await seed();
    await assertFails(
      createAs(TRADIE_UID, TRADIE_CLAIMS, "new_x", manualExpense({ invoicedAt: new Date() })),
    );
    await assertFails(
      createAs(TRADIE_UID, TRADIE_CLAIMS, "new_y", manualExpense({ status: "invoiced" })),
    );
  });

  it("cannot create with a negative cost or out-of-range markup", async () => {
    await seed();
    await assertFails(
      createAs(TRADIE_UID, TRADIE_CLAIMS, "new_x", manualExpense({ totalCost: -100 })),
    );
    await assertFails(
      createAs(TRADIE_UID, TRADIE_CLAIMS, "new_y", manualExpense({ markupPercent: 1001 })),
    );
  });

  it("can create with a normal vendor string", async () => {
    await seed();
    await assertSucceeds(
      createAs(TRADIE_UID, TRADIE_CLAIMS, "new_v", manualExpense({ vendor: "Home Depot" })),
    );
  });

  it("cannot create with oversized strings or money above the cap", async () => {
    await seed();
    await assertFails(
      createAs(TRADIE_UID, TRADIE_CLAIMS, "new_x", manualExpense({ vendor: "v".repeat(121) })),
    );
    await assertFails(
      createAs(
        TRADIE_UID,
        TRADIE_CLAIMS,
        "new_y",
        manualExpense({ description: "d".repeat(301) }),
      ),
    );
    await assertFails(
      createAs(TRADIE_UID, TRADIE_CLAIMS, "new_z", manualExpense({ totalCost: 10_000_001 })),
    );
  });
});

describe("expenses — update keeps identity + receipt path immutable", () => {
  it("the owner can edit billed fields", async () => {
    await seed();
    await assertSucceeds(
      updateDoc(
        doc(fsAs(TRADIE_UID, TRADIE_CLAIMS), "jobs", JOB_ID, "expenses", MANUAL_EXPENSE_ID),
        {
          description: "3/4\" PEX fittings",
          totalCost: 1250,
          billedAmount: 1438,
          updatedAt: new Date(),
        },
      ),
    );
  });

  it("the owner cannot detach a receipt (path → null)", async () => {
    await seed();
    await assertFails(
      updateDoc(
        doc(fsAs(TRADIE_UID, TRADIE_CLAIMS), "jobs", JOB_ID, "expenses", RECEIPT_EXPENSE_ID),
        { receiptStoragePath: null },
      ),
    );
  });

  it("the owner cannot attach a path to a manual expense (null → path)", async () => {
    await seed();
    await assertFails(
      updateDoc(
        doc(fsAs(TRADIE_UID, TRADIE_CLAIMS), "jobs", JOB_ID, "expenses", MANUAL_EXPENSE_ID),
        { receiptStoragePath: `jobs/${JOB_ID}/receipts/forged.webp` },
      ),
    );
  });

  it("the client cannot update an expense", async () => {
    await seed();
    await assertFails(
      updateDoc(
        doc(fsAs(CLIENT_UID, CLIENT_CLAIMS), "jobs", JOB_ID, "expenses", MANUAL_EXPENSE_ID),
        { billedAmount: 1 },
      ),
    );
  });

  // Bounds are re-checked on update, not just create — otherwise an edit
  // could corrupt values that were valid at create time.
  it("the owner cannot update past the field bounds", async () => {
    await seed();
    const ref = doc(fsAs(TRADIE_UID, TRADIE_CLAIMS), "jobs", JOB_ID, "expenses", MANUAL_EXPENSE_ID);
    await assertFails(updateDoc(ref, { vendor: "v".repeat(121) }));
    await assertFails(updateDoc(ref, { billedAmount: 10_000_001 }));
    await assertFails(updateDoc(ref, { markupPercent: 1001 }));
    await assertFails(updateDoc(ref, { status: "paid" }));
  });
});

describe("expenses — delete only before invoicing", () => {
  it("the owner can delete an un-invoiced expense", async () => {
    await seed();
    await assertSucceeds(
      deleteDoc(doc(fsAs(TRADIE_UID, TRADIE_CLAIMS), "jobs", JOB_ID, "expenses", MANUAL_EXPENSE_ID)),
    );
  });

  it("the owner cannot delete an invoiced expense", async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      const fs = ctx.firestore();
      await setDoc(doc(fs, "jobs", JOB_ID), {
        clientId: CLIENT_UID,
        tradespersonId: TRADIE_UID,
        status: "awaiting_client_approval",
      });
      await setDoc(
        doc(fs, "jobs", JOB_ID, "expenses", "exp_billed"),
        manualExpense({ status: "invoiced", invoicedAt: new Date() }),
      );
    });
    await assertFails(
      deleteDoc(doc(fsAs(TRADIE_UID, TRADIE_CLAIMS), "jobs", JOB_ID, "expenses", "exp_billed")),
    );
  });

  it("the client cannot delete an expense", async () => {
    await seed();
    await assertFails(
      deleteDoc(doc(fsAs(CLIENT_UID, CLIENT_CLAIMS), "jobs", JOB_ID, "expenses", MANUAL_EXPENSE_ID)),
    );
  });
});
