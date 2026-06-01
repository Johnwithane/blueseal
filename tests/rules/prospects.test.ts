// prospects/{prospectId} — seeded, unclaimed tradesperson listings. Public
// read ONLY when isListed (so search can surface them with a "Pending
// verification" badge); a suppressed (isListed=false) listing is admin-only.
// The harvested email/phone live in prospects/{id}/private/contact, which is
// admin-only — never world-readable. Writes flow through admin callables on the
// Admin SDK; from the client only admins may write.

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

const LISTED_ID = "p_listed_1";
const SUPPRESSED_ID = "p_suppressed_1";

function prospectPayload(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    displayName: "Acme Plumbing",
    companyName: "Acme Plumbing Ltd.",
    bio: "",
    trades: ["plumber"],
    yearsExperience: {},
    pricingModel: "quote",
    hourlyRate: null,
    languages: [],
    locationApprox: { latitude: 49.88, longitude: -119.5 },
    geohashPublic: "c2b3xy",
    serviceRadiusKm: 25,
    status: "listed",
    isListed: true,
    emailHash: "deadbeef",
    source: "City of Kelowna Business Licences",
    sourceUrl: null,
    dataConsentBasis: "open_data",
    emailConspicuouslyPublished: true,
    licenceNumber: null,
    importedBy: ADMIN_UID,
    importedAt: new Date(),
    unsubToken: "tok",
    lastOutreachAt: null,
    outreachCount: 0,
    firstRequestedAt: null,
    claimedByUid: null,
    claimedAt: null,
    ...overrides,
  };
}

async function seedProspects() {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const fs = ctx.firestore();
    await setDoc(doc(fs, "prospects", LISTED_ID), prospectPayload({}));
    await setDoc(
      doc(fs, "prospects", SUPPRESSED_ID),
      prospectPayload({ status: "suppressed", isListed: false }),
    );
    await setDoc(doc(fs, "prospects", LISTED_ID, "private", "contact"), {
      prospectEmail: "acme@example.com",
      prospectPhone: null,
      website: null,
    });
  });
}

describe("prospects — read access", () => {
  it("an unauthenticated user can read a listed prospect", async () => {
    await seedProspects();
    const fs = env.unauthenticatedContext().firestore();
    await assertSucceeds(getDoc(doc(fs, "prospects", LISTED_ID)));
  });

  it("a signed-in client can read a listed prospect", async () => {
    await seedProspects();
    const fs = env.authenticatedContext(CLIENT_UID, CLIENT_CLAIMS).firestore();
    await assertSucceeds(getDoc(doc(fs, "prospects", LISTED_ID)));
  });

  it("a suppressed (unlisted) prospect is NOT readable by the public", async () => {
    await seedProspects();
    const fs = env.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(fs, "prospects", SUPPRESSED_ID)));
  });

  it("a suppressed prospect is NOT readable by a signed-in client", async () => {
    await seedProspects();
    const fs = env.authenticatedContext(CLIENT_UID, CLIENT_CLAIMS).firestore();
    await assertFails(getDoc(doc(fs, "prospects", SUPPRESSED_ID)));
  });

  it("admin can read a suppressed prospect", async () => {
    await seedProspects();
    const fs = env.authenticatedContext(ADMIN_UID, ADMIN_CLAIMS).firestore();
    await assertSucceeds(getDoc(doc(fs, "prospects", SUPPRESSED_ID)));
  });

  it("the private contact subdoc is NOT readable by the public", async () => {
    await seedProspects();
    const fs = env.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(fs, "prospects", LISTED_ID, "private", "contact")));
  });

  it("the private contact subdoc is NOT readable by a signed-in client", async () => {
    await seedProspects();
    const fs = env.authenticatedContext(CLIENT_UID, CLIENT_CLAIMS).firestore();
    await assertFails(getDoc(doc(fs, "prospects", LISTED_ID, "private", "contact")));
  });

  it("admin can read the private contact subdoc", async () => {
    await seedProspects();
    const fs = env.authenticatedContext(ADMIN_UID, ADMIN_CLAIMS).firestore();
    await assertSucceeds(getDoc(doc(fs, "prospects", LISTED_ID, "private", "contact")));
  });
});

describe("prospects — write protection", () => {
  it("a client cannot create a prospect", async () => {
    const fs = env.authenticatedContext(CLIENT_UID, CLIENT_CLAIMS).firestore();
    await assertFails(setDoc(doc(fs, "prospects", "new1"), prospectPayload({})));
  });

  it("a tradesperson cannot create a prospect", async () => {
    const fs = env.authenticatedContext(TRADIE_UID, TRADIE_CLAIMS).firestore();
    await assertFails(setDoc(doc(fs, "prospects", "new1"), prospectPayload({})));
  });

  it("a client cannot flip a suppressed prospect back to listed", async () => {
    await seedProspects();
    const fs = env.authenticatedContext(CLIENT_UID, CLIENT_CLAIMS).firestore();
    await assertFails(
      updateDoc(doc(fs, "prospects", SUPPRESSED_ID), { isListed: true }),
    );
  });

  it("admin can create / update / delete a prospect", async () => {
    await seedProspects();
    const fs = env.authenticatedContext(ADMIN_UID, ADMIN_CLAIMS).firestore();
    await assertSucceeds(setDoc(doc(fs, "prospects", "new1"), prospectPayload({})));
    await assertSucceeds(
      updateDoc(doc(fs, "prospects", LISTED_ID), { isListed: false }),
    );
    await assertSucceeds(deleteDoc(doc(fs, "prospects", LISTED_ID)));
  });

  it("a client cannot write the private contact subdoc", async () => {
    await seedProspects();
    const fs = env.authenticatedContext(CLIENT_UID, CLIENT_CLAIMS).firestore();
    await assertFails(
      setDoc(doc(fs, "prospects", LISTED_ID, "private", "contact"), {
        prospectEmail: "leak@example.com",
        prospectPhone: null,
        website: null,
      }),
    );
  });
});
