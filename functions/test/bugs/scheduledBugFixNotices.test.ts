import { describe, it, expect, beforeEach, vi } from "vitest";
import type { FakeFirestore } from "../helpers/fakeFirestore";

// The daily batched "your bug reports are fixed" digest. The interesting
// behaviour is all in the grouping/idempotency: ONE notice per reporter
// listing every newly-fixed report, fixNotifiedAt stamped so the next sweep
// stays quiet, and wontfix never notifying at all.

const { notify } = vi.hoisted(() => ({ notify: vi.fn(async () => {}) }));

vi.mock("firebase-admin/firestore", () => ({
  FieldValue: { serverTimestamp: () => "__serverTimestamp__" },
}));
vi.mock("../../src/lib/admin", async () => {
  const { FakeFirestore } = await import("../helpers/fakeFirestore");
  return { db: new FakeFirestore() };
});
vi.mock("../../src/lib/notify", () => ({ notify }));

import { scheduledBugFixNotices, fixNoticeBody } from "../../src/bugs/scheduledBugFixNotices";
import { db } from "../../src/lib/admin";
const fakeDb = db as unknown as FakeFirestore;

// onSchedule handlers take a ScheduledEvent; ours ignores it entirely.
const run = () =>
  (scheduledBugFixNotices as unknown as { run: (e: unknown) => Promise<void> }).run({});

function seedReport(
  id: string,
  over: Partial<{ reporterUid: string; title: string; status: string; fixNotifiedAt: string }> = {},
): void {
  fakeDb.seed(`bugReports/${id}`, {
    reporterUid: "qa1",
    reporterName: "Quinn QA",
    title: `Bug ${id}`,
    status: "fixed",
    notes: "",
    triagedBy: "admin1",
    ...over,
  });
}

beforeEach(() => {
  fakeDb.reset();
  notify.mockClear();
});

describe("scheduledBugFixNotices", () => {
  it("sends one batched notice per reporter and stamps every report", async () => {
    seedReport("b1", { reporterUid: "qa1", title: "Calendar shows 24h times" });
    seedReport("b2", { reporterUid: "qa1", title: "Avatar menu clips" });
    seedReport("b3", { reporterUid: "qa2", title: "Quote tab missing" });

    await run();

    expect(notify).toHaveBeenCalledTimes(2);
    const byUser = Object.fromEntries(
      notify.mock.calls.map(([arg]) => [(arg as { userId: string }).userId, arg]),
    ) as Record<string, Record<string, unknown>>;

    expect(byUser.qa1.title).toBe("2 of your bug reports are fixed");
    expect(byUser.qa1.body).toContain("Calendar shows 24h times");
    expect(byUser.qa1.body).toContain("Avatar menu clips");
    expect(byUser.qa1.type).toBe("bug_report_fixed");
    expect(byUser.qa1.link).toBe("/admin/bug-reports");
    expect(byUser.qa1.recipientRole).toBe("admin");
    expect(byUser.qa1.priority).toBe("normal");

    expect(byUser.qa2.title).toBe("Your bug report is fixed");
    expect(byUser.qa2.body).toContain("Quote tab missing");

    for (const id of ["b1", "b2", "b3"]) {
      expect(fakeDb.peek(`bugReports/${id}`)?.fixNotifiedAt).toBe("__serverTimestamp__");
    }
  });

  it("never re-announces an already-stamped report", async () => {
    seedReport("b1", { fixNotifiedAt: "__serverTimestamp__" });
    seedReport("b2", { fixNotifiedAt: "__serverTimestamp__" });

    await run();

    expect(notify).not.toHaveBeenCalled();
  });

  it("only digests the newly-fixed reports on a second sweep", async () => {
    seedReport("b1", { title: "First" });
    await run();
    expect(notify).toHaveBeenCalledTimes(1);

    notify.mockClear();
    seedReport("b2", { title: "Second" });
    await run();

    expect(notify).toHaveBeenCalledTimes(1);
    const body = (notify.mock.calls[0][0] as { body: string }).body;
    expect(body).toContain("Second");
    expect(body).not.toContain("First");
  });

  it("stays quiet for wontfix and every non-fixed status", async () => {
    seedReport("b1", { status: "wontfix" });
    seedReport("b2", { status: "open" });
    seedReport("b3", { status: "in_progress" });
    seedReport("b4", { status: "triaged" });

    await run();

    expect(notify).not.toHaveBeenCalled();
    expect(fakeDb.peek("bugReports/b1")?.fixNotifiedAt).toBeUndefined();
  });

  it("leaves a report unstamped when its notice fails, so tomorrow retries", async () => {
    seedReport("b1", { reporterUid: "qa1" });
    seedReport("b2", { reporterUid: "qa2" });
    notify.mockImplementationOnce(async () => {
      throw new Error("mail down");
    });

    await run();

    // First reporter's notice threw → not stamped; the sweep still serves the second.
    expect(fakeDb.peek("bugReports/b1")?.fixNotifiedAt).toBeUndefined();
    expect(fakeDb.peek("bugReports/b2")?.fixNotifiedAt).toBe("__serverTimestamp__");
  });

  it("skips a report with no reporterUid rather than throwing", async () => {
    seedReport("b1", { reporterUid: "" });

    await run();

    expect(notify).not.toHaveBeenCalled();
  });
});

describe("fixNoticeBody", () => {
  it("reads naturally for one, two and three reports", () => {
    expect(fixNoticeBody(["A"])).toContain("The bug you reported — “A” — is marked fixed");
    expect(fixNoticeBody(["A", "B"])).toContain("“A” and “B”");
    expect(fixNoticeBody(["A", "B", "C"])).toContain("“A”, “B” and “C”");
  });

  it("summarises the tail past three titles so the body stays under notify()'s cap", () => {
    const body = fixNoticeBody(["A", "B", "C", "D", "E"]);
    expect(body).toContain("“A”, “B”, “C” and 2 more");
    expect(body).not.toContain("“D”");
    expect(body.length).toBeLessThanOrEqual(500);
  });
});
