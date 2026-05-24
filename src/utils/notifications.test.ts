import { describe, expect, it } from "vitest";
import {
  resolveNotificationLink,
  shouldSwitchRoleForNotification,
} from "./notifications";
import type { NotificationDoc, Role } from "@/firebase/interfaces";

type LinkInput = Pick<NotificationDoc, "link" | "type">;
type SwitchInput = Pick<NotificationDoc, "recipientRole">;

const linkFor = (type: NotificationDoc["type"], link: string | null): LinkInput => ({ type, link });

describe("resolveNotificationLink", () => {
  it("returns null when the notification has no link", () => {
    expect(resolveNotificationLink(linkFor("vetting_approved", null))).toBeNull();
  });

  it("returns non-job-detail links verbatim", () => {
    expect(resolveNotificationLink(linkFor("vetting_approved", "/dashboard/tradie"))).toBe(
      "/dashboard/tradie",
    );
    expect(resolveNotificationLink(linkFor("invoice_paid", "/payouts"))).toBe("/payouts");
    expect(resolveNotificationLink(linkFor("dispute_opened", "/admin/disputes/dp_1"))).toBe(
      "/admin/disputes/dp_1",
    );
  });

  it("leaves /jobs/posted/ links untouched (job-board ≠ accepted-job)", () => {
    expect(resolveNotificationLink(linkFor("new_application", "/jobs/posted/p123"))).toBe(
      "/jobs/posted/p123",
    );
    expect(
      resolveNotificationLink(linkFor("application_returned", "/jobs/posted/p123")),
    ).toBe("/jobs/posted/p123");
  });

  it("appends ?chat=open for message_received on a job-detail link", () => {
    expect(resolveNotificationLink(linkFor("message_received", "/jobs/abc"))).toBe(
      "/jobs/abc?chat=open",
    );
  });

  it("appends ?tab=invoice for invoice_* and dispute_opened on a job-detail link", () => {
    expect(resolveNotificationLink(linkFor("invoice_sent", "/jobs/abc"))).toBe(
      "/jobs/abc?tab=invoice",
    );
    expect(resolveNotificationLink(linkFor("invoice_paid", "/jobs/abc"))).toBe(
      "/jobs/abc?tab=invoice",
    );
    expect(resolveNotificationLink(linkFor("invoice_payment_failed", "/jobs/abc"))).toBe(
      "/jobs/abc?tab=invoice",
    );
    expect(resolveNotificationLink(linkFor("invoice_refunded", "/jobs/abc"))).toBe(
      "/jobs/abc?tab=invoice",
    );
    expect(resolveNotificationLink(linkFor("dispute_opened", "/jobs/abc"))).toBe(
      "/jobs/abc?tab=invoice",
    );
  });

  it("preserves existing query params when augmenting", () => {
    expect(
      resolveNotificationLink(linkFor("invoice_paid", "/jobs/abc?ref=email")),
    ).toBe("/jobs/abc?ref=email&tab=invoice");
  });

  it("leaves job-detail links for non-routed types alone", () => {
    expect(resolveNotificationLink(linkFor("job_cancelled", "/jobs/abc"))).toBe("/jobs/abc");
    expect(resolveNotificationLink(linkFor("job_requested", "/jobs/abc"))).toBe("/jobs/abc");
  });
});

describe("shouldSwitchRoleForNotification", () => {
  const both: Role[] = ["client", "tradesperson"];
  const clientOnly: Role[] = ["client"];

  const sw = (recipientRole: Role | null): SwitchInput => ({ recipientRole });

  it("returns false when recipientRole is null (legacy doc)", () => {
    expect(shouldSwitchRoleForNotification(sw(null), "client", both)).toBe(false);
  });

  it("returns false when already viewing as the recipient role", () => {
    expect(shouldSwitchRoleForNotification(sw("client"), "client", both)).toBe(false);
    expect(shouldSwitchRoleForNotification(sw("tradesperson"), "tradesperson", both)).toBe(
      false,
    );
  });

  it("returns false when the user doesn't hold the recipient role", () => {
    // Defensive: shouldn't have received it, but better to leave them in
    // their current view than throw them into a role they can't use.
    expect(shouldSwitchRoleForNotification(sw("tradesperson"), "client", clientOnly)).toBe(
      false,
    );
  });

  it("returns true when the user holds the role but isn't viewing it", () => {
    expect(shouldSwitchRoleForNotification(sw("tradesperson"), "client", both)).toBe(true);
    expect(shouldSwitchRoleForNotification(sw("client"), "tradesperson", both)).toBe(true);
  });

  it("handles a null activeRole (mid-init) by allowing the switch", () => {
    expect(shouldSwitchRoleForNotification(sw("client"), null, both)).toBe(true);
  });
});
