import { describe, it, expect, beforeEach, vi } from "vitest";

// The roster-invite email is CASL-gated: it must carry a mailing address AND a
// valid unsubscribe token, or it doesn't send. We mock those two gate helpers so
// we can drive each branch, plus enqueueMail to capture the send.
const { caslMailingAddress, unsubTokenFor } = vi.hoisted(() => ({
  caslMailingAddress: vi.fn<[], string | null>(() => "123 Main St, Kelowna BC V1Y 1A1"),
  unsubTokenFor: vi.fn<[string], string | null>(() => "tok123"),
}));

vi.mock("../../src/lib/mail", () => ({ enqueueMail: vi.fn(async () => {}) }));
vi.mock("../../src/prospects/helpers", () => ({
  appBaseUrl: () => "https://blueseal.app",
  caslMailingAddress,
  unsubTokenFor,
  escapeHtml: (s: string) => s,
}));

import { sendRosterInviteEmail, rosterSignupUrl } from "../../src/projectManager/rosterInviteHelpers";
import { enqueueMail } from "../../src/lib/mail";

const enqueue = enqueueMail as unknown as ReturnType<typeof vi.fn>;

const ARGS = {
  toEmail: "sam@example.com",
  inviteeName: "Sam Trade",
  pmName: "Pat PM",
  inviteId: "invite-1",
};

describe("rosterSignupUrl", () => {
  it("deep-links signup preselected as a tradesperson with the email prefilled", () => {
    expect(rosterSignupUrl("a+b@example.com")).toBe(
      "https://blueseal.app/sign-up?as=tradesperson&invite=a%2Bb%40example.com&utm_source=pm_roster_invite",
    );
  });
});

describe("sendRosterInviteEmail — CASL gate", () => {
  beforeEach(() => {
    enqueue.mockClear();
    caslMailingAddress.mockReturnValue("123 Main St, Kelowna BC V1Y 1A1");
    unsubTokenFor.mockReturnValue("tok123");
  });

  it("does not send when no mailing address is configured", async () => {
    caslMailingAddress.mockReturnValue(null);
    expect(await sendRosterInviteEmail(ARGS)).toBe(false);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("does not send when no unsubscribe token can be produced", async () => {
    unsubTokenFor.mockReturnValue(null);
    expect(await sendRosterInviteEmail(ARGS)).toBe(false);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("sends a compliant invite to the right address with the signup + unsubscribe links", async () => {
    expect(await sendRosterInviteEmail(ARGS)).toBe(true);
    expect(enqueue).toHaveBeenCalledTimes(1);
    const mail = enqueue.mock.calls[0][0] as { to: string; subject: string; html: string; text: string };
    expect(mail.to).toBe("sam@example.com");
    expect(mail.subject).toContain("Pat PM");
    expect(mail.html).toContain("/sign-up?as=tradesperson");
    expect(mail.html).toContain("Unsubscribe");
    expect(mail.html).toContain("123 Main St, Kelowna BC V1Y 1A1");
    // Scoped per-invite unsubscribe token.
    expect(unsubTokenFor).toHaveBeenCalledWith("roster_invite_invite-1");
  });
});
