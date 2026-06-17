import { describe, it, expect, beforeEach, vi } from "vitest";
import type { FakeFirestore } from "../helpers/fakeFirestore";
import { makeRequest, callFn, expectHttpsError } from "../helpers/invoke";

const enqueueMail = vi.hoisted(() => vi.fn(async () => {}));
const logAdminAction = vi.hoisted(() => vi.fn(async () => {}));

vi.mock("firebase-admin/firestore", () => ({
  FieldValue: { serverTimestamp: () => "__ts__" },
}));
vi.mock("../../src/lib/admin", async () => {
  const { FakeFirestore } = await import("../helpers/fakeFirestore");
  return { db: new FakeFirestore() };
});
vi.mock("../../src/lib/audit", () => ({ logAdminAction }));
vi.mock("../../src/lib/mail", () => ({ enqueueMail }));
vi.mock("../../src/lib/emailTemplate", () => ({ brandedEmailHtml: () => "<html>reply</html>" }));

import { sendSupportTicketReply } from "../../src/support/sendSupportTicketReply";
import { db } from "../../src/lib/admin";
const fakeDb = db as unknown as FakeFirestore;

const ADMIN = "admin_1";
const TICKET = "t1";
const req = (data: Record<string, unknown>) =>
  makeRequest({ data, uid: ADMIN, role: "admin" });

beforeEach(() => {
  fakeDb.reset();
  fakeDb.seed(`supportTickets/${TICKET}`, {
    email: "cust@example.com",
    topic: "Payments or invoices",
    status: "open",
  });
});

describe("sendSupportTicketReply", () => {
  it("rejects a non-admin", async () => {
    await expectHttpsError(
      callFn(sendSupportTicketReply, makeRequest({ data: { ticketId: TICKET, body: "hi", mode: "reply" }, uid: "u", role: "client" })),
      "permission-denied",
    );
  });

  it("rejects invalid input (empty body)", async () => {
    await expectHttpsError(callFn(sendSupportTicketReply, req({ ticketId: TICKET, body: "", mode: "reply" })), "invalid-argument");
  });

  it("404s a missing ticket", async () => {
    await expectHttpsError(callFn(sendSupportTicketReply, req({ ticketId: "nope", body: "hi", mode: "reply" })), "not-found");
  });

  it("fails when the ticket has no email", async () => {
    fakeDb.seed(`supportTickets/${TICKET}`, { topic: "x", status: "open" });
    await expectHttpsError(callFn(sendSupportTicketReply, req({ ticketId: TICKET, body: "hi", mode: "reply" })), "failed-precondition");
  });

  it("sends with Reply-To in 'reply' mode, records the reply, resolves the ticket", async () => {
    await callFn(sendSupportTicketReply, req({ ticketId: TICKET, body: "Thanks for reaching out.\n\nWe'll sort it.", mode: "reply" }));
    // Email sent with a monitored Reply-To.
    expect(enqueueMail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "cust@example.com", replyTo: "hello@blueseal.app" }),
    );
    // Reply recorded in the subcollection.
    const replies = fakeDb.peekUnder(`supportTickets/${TICKET}/replies`);
    expect(replies).toHaveLength(1);
    expect(replies[0]).toMatchObject({ senderUid: ADMIN, mode: "reply" });
    // Ticket moved to resolved + stamped.
    expect(fakeDb.peek(`supportTickets/${TICKET}`)).toMatchObject({ status: "resolved", handledBy: ADMIN, lastReplyBy: ADMIN });
    expect(logAdminAction).toHaveBeenCalledWith(expect.objectContaining({ action: "sendSupportTicketReply" }));
  });

  it("omits Reply-To in 'noreply' mode and honours an explicit status", async () => {
    await callFn(sendSupportTicketReply, req({ ticketId: TICKET, body: "FYI.", mode: "noreply", status: "in_progress" }));
    const call = enqueueMail.mock.calls[0][0] as { replyTo?: string };
    expect(call.replyTo).toBeUndefined();
    expect(fakeDb.peek(`supportTickets/${TICKET}`)).toMatchObject({ status: "in_progress" });
  });
});
