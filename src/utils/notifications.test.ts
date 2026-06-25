import { describe, expect, it } from "vitest";
import {
  resolveNotificationLink,
  roleBadge,
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

  it("redirects application_rejected to /my-applications (lost post access)", () => {
    // Old notifications linked to the now-inaccessible post; self-heal them.
    expect(
      resolveNotificationLink(linkFor("application_rejected", "/jobs/posted/p123")),
    ).toBe("/my-applications");
    // New notifications already link here — still passes through.
    expect(
      resolveNotificationLink(linkFor("application_rejected", "/my-applications")),
    ).toBe("/my-applications");
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
    // Cancel/hold request loop: land on the job detail (the banner lives there),
    // no special tab/modal query.
    expect(resolveNotificationLink(linkFor("job_change_requested", "/jobs/abc"))).toBe(
      "/jobs/abc",
    );
    expect(resolveNotificationLink(linkFor("job_resumed", "/jobs/abc"))).toBe("/jobs/abc");
  });

  it("appends ?tab=invoice&review=1 for mutual-review notifications", () => {
    expect(resolveNotificationLink(linkFor("review_requested", "/jobs/abc"))).toBe(
      "/jobs/abc?tab=invoice&review=1",
    );
    expect(resolveNotificationLink(linkFor("review_reminder", "/jobs/abc"))).toBe(
      "/jobs/abc?tab=invoice&review=1",
    );
    expect(resolveNotificationLink(linkFor("review_revealed", "/jobs/abc"))).toBe(
      "/jobs/abc?tab=invoice&review=1",
    );
    expect(resolveNotificationLink(linkFor("review_received", "/jobs/abc"))).toBe(
      "/jobs/abc?tab=invoice&review=1",
    );
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

describe("roleBadge", () => {
  it("returns null for a legacy notification with no recipientRole", () => {
    expect(roleBadge(null)).toBeNull();
  });

  it("maps every view-role to a distinct label, icon and colour", () => {
    const roles: Role[] = ["client", "tradesperson", "admin", "sales"];
    const badges = roles.map((r) => roleBadge(r));

    // Every view-role resolves.
    expect(badges.every((b) => b !== null)).toBe(true);

    // Labels mirror the RoleSwitcher pills.
    expect(roleBadge("client")?.label).toBe("Client");
    expect(roleBadge("tradesperson")?.label).toBe("Tradesperson");
    expect(roleBadge("admin")?.label).toBe("Admin");
    expect(roleBadge("sales")?.label).toBe("Sales");

    // Icons mirror the RoleSwitcher icons.
    expect(roleBadge("client")?.icon).toBe("pi pi-user");
    expect(roleBadge("tradesperson")?.icon).toBe("pi pi-wrench");
    expect(roleBadge("admin")?.icon).toBe("pi pi-shield");
    expect(roleBadge("sales")?.icon).toBe("pi pi-map-marker");

    // Accents are all distinct so roles are unmistakable at a glance.
    const accents = badges.map((b) => b?.accent);
    expect(new Set(accents).size).toBe(roles.length);
  });

  it("still resolves qa (exhaustive over Role) even though it never renders", () => {
    // qa is a capability, never a notification recipient view-mode — but the
    // map is exhaustive over Role, so the lookup must not return null.
    expect(roleBadge("qa")).not.toBeNull();
  });
});
