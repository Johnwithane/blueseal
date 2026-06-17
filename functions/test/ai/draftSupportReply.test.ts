import { describe, it, vi } from "vitest";
import { makeRequest, callFn, expectHttpsError } from "../helpers/invoke";

// The auth + validation gates fire before any Vertex / Firestore access, so we
// only need the admin seam stubbed. (The Vertex call + response parsing reuse
// the same proven path as aiSuggestReplies.)
vi.mock("firebase-admin/firestore", () => ({ FieldValue: { serverTimestamp: () => "__ts__" } }));
vi.mock("../../src/lib/admin", async () => {
  const { FakeFirestore } = await import("../helpers/fakeFirestore");
  return { db: new FakeFirestore() };
});

import { aiDraftSupportReply } from "../../src/ai/draftSupportReply";

describe("aiDraftSupportReply (gates)", () => {
  it("rejects a non-admin caller", async () => {
    await expectHttpsError(
      callFn(aiDraftSupportReply, makeRequest({ data: { ticketId: "t1" }, uid: "u", role: "tradesperson" })),
      "permission-denied",
    );
  });

  it("rejects invalid input", async () => {
    await expectHttpsError(
      callFn(aiDraftSupportReply, makeRequest({ data: {}, uid: "admin_1", role: "admin" })),
      "invalid-argument",
    );
  });
});
