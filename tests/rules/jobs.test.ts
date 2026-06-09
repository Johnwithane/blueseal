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
import { Timestamp, doc, serverTimestamp, setDoc, updateDoc } from "firebase/firestore";

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
