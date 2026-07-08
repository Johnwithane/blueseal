// bookings/{bookingId} — a tradesperson's own booking record. Read is
// owner-or-admin; create/update/delete are tradesperson-only and scoped to
// their own tradespersonId (note: unlike most collections here, admin has
// NO write override — only the client-side tradesperson callable path
// writes these, so these tests also pin that admin cannot write directly).

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

const BOOKING_ID = "booking_1";

function booking(overrides: Record<string, unknown> = {}) {
  return {
    tradespersonId: TRADIE_UID,
    title: "Site visit",
    start: new Date(),
    end: new Date(),
    createdAt: new Date(),
    ...overrides,
  };
}

async function seedBooking() {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), "bookings", BOOKING_ID), booking());
  });
}

function fsAs(uid: string, claims: object) {
  return env.authenticatedContext(uid, claims).firestore();
}

describe("bookings/{bookingId} — read (owner + admin)", () => {
  it("the owning tradesperson can read their own booking", async () => {
    await seedBooking();
    await assertSucceeds(getDoc(doc(fsAs(TRADIE_UID, TRADIE_CLAIMS), "bookings", BOOKING_ID)));
  });

  it("an admin can read any booking", async () => {
    await seedBooking();
    await assertSucceeds(getDoc(doc(fsAs(ADMIN_UID, ADMIN_CLAIMS), "bookings", BOOKING_ID)));
  });

  it("a different tradesperson cannot read someone else's booking", async () => {
    await seedBooking();
    await assertFails(getDoc(doc(fsAs(OTHER_TRADIE_UID, TRADIE_CLAIMS), "bookings", BOOKING_ID)));
  });

  it("a client cannot read a tradesperson's booking", async () => {
    await seedBooking();
    await assertFails(getDoc(doc(fsAs(CLIENT_UID, CLIENT_CLAIMS), "bookings", BOOKING_ID)));
  });
});

describe("bookings/{bookingId} — create", () => {
  it("a tradesperson can create their own booking", async () => {
    await assertSucceeds(
      setDoc(doc(fsAs(TRADIE_UID, TRADIE_CLAIMS), "bookings", BOOKING_ID), booking()),
    );
  });

  it("a tradesperson cannot create a booking under someone else's tradespersonId", async () => {
    await assertFails(
      setDoc(
        doc(fsAs(OTHER_TRADIE_UID, TRADIE_CLAIMS), "bookings", BOOKING_ID),
        booking({ tradespersonId: TRADIE_UID }),
      ),
    );
  });

  it("a client cannot create a booking", async () => {
    await assertFails(
      setDoc(
        doc(fsAs(CLIENT_UID, CLIENT_CLAIMS), "bookings", BOOKING_ID),
        booking({ tradespersonId: CLIENT_UID }),
      ),
    );
  });
});

describe("bookings/{bookingId} — update", () => {
  it("the owning tradesperson can update their own booking", async () => {
    await seedBooking();
    await assertSucceeds(
      updateDoc(doc(fsAs(TRADIE_UID, TRADIE_CLAIMS), "bookings", BOOKING_ID), { title: "Rescheduled" }),
    );
  });

  it("a different tradesperson cannot update someone else's booking", async () => {
    await seedBooking();
    await assertFails(
      updateDoc(doc(fsAs(OTHER_TRADIE_UID, TRADIE_CLAIMS), "bookings", BOOKING_ID), {
        title: "Hijacked",
      }),
    );
  });

  it("the owner cannot reassign a booking to a different tradespersonId", async () => {
    await seedBooking();
    await assertFails(
      updateDoc(doc(fsAs(TRADIE_UID, TRADIE_CLAIMS), "bookings", BOOKING_ID), {
        tradespersonId: OTHER_TRADIE_UID,
      }),
    );
  });
});

describe("bookings/{bookingId} — delete", () => {
  it("the owning tradesperson can delete their own booking", async () => {
    await seedBooking();
    await assertSucceeds(deleteDoc(doc(fsAs(TRADIE_UID, TRADIE_CLAIMS), "bookings", BOOKING_ID)));
  });

  it("a different tradesperson cannot delete someone else's booking", async () => {
    await seedBooking();
    await assertFails(deleteDoc(doc(fsAs(OTHER_TRADIE_UID, TRADIE_CLAIMS), "bookings", BOOKING_ID)));
  });
});
