// Per-party archive on /jobs/{jobId}. Each party can set/clear only their
// own clientArchivedAt / tradespersonArchivedAt. The rest of the /jobs
// update surface is well-exercised by app behaviour; these tests pin the
// archive contract specifically so a future rule edit can't silently let
// one party hide a job from the other.

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
  OTHER_CLIENT_UID,
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

const JOB_ID = "job_archive_1";

async function seedJob(extras: Record<string, unknown> = {}) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const fs = ctx.firestore();
    await setDoc(doc(fs, "jobs", JOB_ID), {
      clientId: CLIENT_UID,
      tradespersonId: TRADIE_UID,
      chatId: "chat_1",
      status: "complete",
      trade: "plumbing",
      createdAt: Timestamp.now(),
      ...extras,
    });
  });
}

describe("jobs — PM read-only visibility (drivenByProjectManagerId)", () => {
  const PM_UID = "pm-job-vis";
  const PM_CLAIMS = { roles: ["client", "projectManager"], role: "client" };

  it("the driving PM can read a job they drove (status/schedule window)", async () => {
    await seedJob({ drivenByProjectManagerId: PM_UID, projectId: "proj-x" });
    const pm = env.authenticatedContext(PM_UID, PM_CLAIMS).firestore();
    await assertSucceeds(getDoc(doc(pm, "jobs", JOB_ID)));
  });

  it("a non-party who didn't drive the job cannot read it", async () => {
    await seedJob({ drivenByProjectManagerId: PM_UID });
    const other = env.authenticatedContext(OTHER_CLIENT_UID, CLIENT_CLAIMS).firestore();
    await assertFails(getDoc(doc(other, "jobs", JOB_ID)));
  });

  it("the OWNING PM can read a board-filled job on their project (no commission)", async () => {
    // projectManagerId set but drivenByProjectManagerId null — the off-roster
    // board fill the /manage/jobs + dashboard rollup must include (P1-00).
    await seedJob({ projectManagerId: PM_UID, projectId: "proj-x", drivenByProjectManagerId: null });
    const pm = env.authenticatedContext(PM_UID, PM_CLAIMS).firestore();
    await assertSucceeds(getDoc(doc(pm, "jobs", JOB_ID)));
  });

  it("a PM cannot read a job on a project that isn't theirs", async () => {
    await seedJob({ projectManagerId: "some-other-pm", projectId: "proj-y" });
    const pm = env.authenticatedContext(PM_UID, PM_CLAIMS).firestore();
    await assertFails(getDoc(doc(pm, "jobs", JOB_ID)));
  });

  it("a client CANNOT forge PM linkage at create (commission-fraud + read leak)", async () => {
    const client = env.authenticatedContext(CLIENT_UID, CLIENT_CLAIMS).firestore();
    const base = {
      clientId: CLIENT_UID,
      tradespersonId: TRADIE_UID,
      status: "requested",
      trade: "plumbing",
      createdAt: serverTimestamp(),
    };
    // A plain direct-request job is fine...
    await assertSucceeds(setDoc(doc(client, "jobs", "job_clean"), base));
    // ...but forging the server-minted PM linkage is denied on each field.
    await assertFails(
      setDoc(doc(client, "jobs", "job_forge_pm"), { ...base, drivenByProjectManagerId: PM_UID }),
    );
    await assertFails(
      setDoc(doc(client, "jobs", "job_forge_pm_owner"), { ...base, projectManagerId: PM_UID }),
    );
    await assertFails(
      setDoc(doc(client, "jobs", "job_forge_proj"), { ...base, projectId: "proj-x" }),
    );
    await assertFails(
      setDoc(doc(client, "jobs", "job_forge_prop"), { ...base, propertyId: "prop-x" }),
    );
  });
});

describe("jobs — title/description are party-editable (JobEditDialog)", () => {
  // The Edit job dialog writes these two straight from the client SDK, on the
  // strength of them NOT being in the update rule's pinned set. Pin that here:
  // if a future rule freezes either, the dialog would 403 in prod the way the
  // Clients tab did, and only a rules test catches it.
  it("tradesperson can rename their own job and rewrite its description", async () => {
    await seedJob();
    const tradie = env.authenticatedContext(TRADIE_UID, TRADIE_CLAIMS).firestore();
    await assertSucceeds(
      updateDoc(doc(tradie, "jobs", JOB_ID), {
        title: "Relocate hot water tank",
        description: "Move the tank and re-run the gas line.",
      }),
    );
  });

  it("client can rename their own job", async () => {
    await seedJob();
    const client = env.authenticatedContext(CLIENT_UID, CLIENT_CLAIMS).firestore();
    await assertSucceeds(updateDoc(doc(client, "jobs", JOB_ID), { title: "New name" }));
  });

  it("an outsider cannot rename the job", async () => {
    await seedJob();
    const stranger = env.authenticatedContext(OTHER_CLIENT_UID, CLIENT_CLAIMS).firestore();
    await assertFails(updateDoc(doc(stranger, "jobs", JOB_ID), { title: "Hijacked" }));
  });

  it("renaming still cannot smuggle in a trade change", async () => {
    await seedJob();
    const tradie = env.authenticatedContext(TRADIE_UID, TRADIE_CLAIMS).firestore();
    await assertFails(
      updateDoc(doc(tradie, "jobs", JOB_ID), { title: "Relabelled", trade: "electrician" }),
    );
  });
});

describe("jobs archive — per-party gate", () => {
  it("client can set their own archivedAt", async () => {
    await seedJob();
    const client = env.authenticatedContext(CLIENT_UID, CLIENT_CLAIMS).firestore();
    await assertSucceeds(
      updateDoc(doc(client, "jobs", JOB_ID), {
        clientArchivedAt: serverTimestamp(),
      }),
    );
  });

  it("client can clear their own archivedAt", async () => {
    await seedJob({ clientArchivedAt: Timestamp.now() });
    const client = env.authenticatedContext(CLIENT_UID, CLIENT_CLAIMS).firestore();
    await assertSucceeds(
      updateDoc(doc(client, "jobs", JOB_ID), { clientArchivedAt: null }),
    );
  });

  it("client cannot set tradespersonArchivedAt", async () => {
    await seedJob();
    const client = env.authenticatedContext(CLIENT_UID, CLIENT_CLAIMS).firestore();
    await assertFails(
      updateDoc(doc(client, "jobs", JOB_ID), {
        tradespersonArchivedAt: serverTimestamp(),
      }),
    );
  });

  it("tradesperson can set their own archivedAt", async () => {
    await seedJob();
    const tradie = env.authenticatedContext(TRADIE_UID, TRADIE_CLAIMS).firestore();
    await assertSucceeds(
      updateDoc(doc(tradie, "jobs", JOB_ID), {
        tradespersonArchivedAt: serverTimestamp(),
      }),
    );
  });

  it("tradesperson cannot set clientArchivedAt", async () => {
    await seedJob();
    const tradie = env.authenticatedContext(TRADIE_UID, TRADIE_CLAIMS).firestore();
    await assertFails(
      updateDoc(doc(tradie, "jobs", JOB_ID), {
        clientArchivedAt: serverTimestamp(),
      }),
    );
  });

  it("outsider cannot archive at all", async () => {
    await seedJob();
    const stranger = env
      .authenticatedContext(OTHER_CLIENT_UID, CLIENT_CLAIMS)
      .firestore();
    await assertFails(
      updateDoc(doc(stranger, "jobs", JOB_ID), {
        clientArchivedAt: serverTimestamp(),
      }),
    );
  });

  it("admin can set either side's archivedAt", async () => {
    await seedJob();
    const admin = env.authenticatedContext(ADMIN_UID, ADMIN_CLAIMS).firestore();
    await assertSucceeds(
      updateDoc(doc(admin, "jobs", JOB_ID), {
        clientArchivedAt: serverTimestamp(),
        tradespersonArchivedAt: serverTimestamp(),
      }),
    );
  });
});

// Status-transition + change-request gate. The client may only flip status
// directly via the two pre-commitment paths (intake advance, instant cancel);
// everything acceptance-gated (committed cancel, on_hold, resume) must go
// through the callables, which run as admin and bypass rules. pendingChange /
// statusBeforeHold are server-managed and parties cannot touch them.
// NB ([[project_firestore_list_rule_pattern]]): these run as a NON-admin
// client/tradesperson — the dev account is admin and would mask the gate.
describe("jobs status-transition + change-request gate", () => {
  const client = () => env.authenticatedContext(CLIENT_UID, CLIENT_CLAIMS).firestore();
  const tradie = () => env.authenticatedContext(TRADIE_UID, TRADIE_CLAIMS).firestore();
  const admin = () => env.authenticatedContext(ADMIN_UID, ADMIN_CLAIMS).firestore();

  it("client CAN instant-cancel a pre-commitment job (requested → cancelled)", async () => {
    await seedJob({ status: "requested" });
    await assertSucceeds(
      updateDoc(doc(client(), "jobs", JOB_ID), {
        status: "cancelled",
        cancelledAt: serverTimestamp(),
        cancelledReason: "changed my mind",
        cancelledBy: CLIENT_UID,
      }),
    );
  });

  it("client CAN advance marketplace intake (accepted → requested)", async () => {
    await seedJob({ status: "accepted" });
    await assertSucceeds(
      updateDoc(doc(client(), "jobs", JOB_ID), { status: "requested", intakeFormData: {} }),
    );
  });

  it("client CANNOT directly cancel a committed job (in_progress → cancelled)", async () => {
    await seedJob({ status: "in_progress" });
    await assertFails(
      updateDoc(doc(client(), "jobs", JOB_ID), {
        status: "cancelled",
        cancelledAt: serverTimestamp(),
        cancelledReason: "nope",
        cancelledBy: CLIENT_UID,
      }),
    );
  });

  it("client CANNOT put a job on hold directly", async () => {
    await seedJob({ status: "in_progress" });
    await assertFails(
      updateDoc(doc(client(), "jobs", JOB_ID), {
        status: "on_hold",
        statusBeforeHold: "in_progress",
      }),
    );
  });

  it("client CANNOT write pendingChange directly", async () => {
    await seedJob({ status: "in_progress" });
    await assertFails(
      updateDoc(doc(client(), "jobs", JOB_ID), {
        pendingChange: { type: "cancel", requestedBy: CLIENT_UID, reason: "x" },
      }),
    );
  });

  it("tradesperson CANNOT set on_hold + statusBeforeHold directly", async () => {
    await seedJob({ status: "in_progress" });
    await assertFails(
      updateDoc(doc(tradie(), "jobs", JOB_ID), {
        status: "on_hold",
        statusBeforeHold: "in_progress",
      }),
    );
  });

  it("admin CAN apply a hold (status + statusBeforeHold + clear pendingChange)", async () => {
    await seedJob({
      status: "in_progress",
      pendingChange: { type: "postpone", requestedBy: CLIENT_UID, reason: "vacation" },
    });
    await assertSucceeds(
      updateDoc(doc(admin(), "jobs", JOB_ID), {
        status: "on_hold",
        statusBeforeHold: "in_progress",
        pendingChange: null,
      }),
    );
  });
});

// upfrontFee + serviceFeeCapUsedCents are server-managed (upfront-fee callables
// + the Stripe webhook). A party must not be able to tamper with the upfront
// credit that onJobCompleted snapshots, nor zero out the cumulative $99 fee cap
// counter to dodge the platform fee on later payments.
describe("jobs — server-managed payment fields", () => {
  const client = () => env.authenticatedContext(CLIENT_UID, CLIENT_CLAIMS).firestore();
  const tradie = () => env.authenticatedContext(TRADIE_UID, TRADIE_CLAIMS).firestore();
  const admin = () => env.authenticatedContext(ADMIN_UID, ADMIN_CLAIMS).firestore();

  const upfront = {
    amountCents: 20_000,
    source: "fixed",
    paymentMethod: "manual",
    paidAt: null,
    paidBy: null,
    appliedInvoiceId: null,
  };

  it("client cannot tamper with upfrontFee.amountCents", async () => {
    await seedJob({ status: "awaiting_upfront_payment", upfrontFee: upfront });
    await assertFails(
      updateDoc(doc(client(), "jobs", JOB_ID), {
        upfrontFee: { ...upfront, amountCents: 1 },
      }),
    );
  });

  it("tradesperson cannot set serviceFeeCapUsedCents", async () => {
    await seedJob({ status: "in_progress" });
    await assertFails(
      updateDoc(doc(tradie(), "jobs", JOB_ID), { serviceFeeCapUsedCents: 0 }),
    );
  });

  it("admin can write upfrontFee + serviceFeeCapUsedCents", async () => {
    await seedJob({ status: "in_progress", upfrontFee: upfront });
    await assertSucceeds(
      updateDoc(doc(admin(), "jobs", JOB_ID), {
        upfrontFee: { ...upfront, paidBy: "stripe" },
        serviceFeeCapUsedCents: 9900,
      }),
    );
  });

  it("a party can still edit an unrelated field with the payment fields unchanged", async () => {
    await seedJob({ status: "in_progress" });
    await assertSucceeds(
      updateDoc(doc(tradie(), "jobs", JOB_ID), {
        tradespersonArchivedAt: serverTimestamp(),
      }),
    );
  });
});
