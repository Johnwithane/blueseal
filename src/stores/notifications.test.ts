import { describe, it, expect, vi, beforeEach } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import type { NotificationDoc, WithId } from "@/firebase/interfaces";

// Spy on the only service the action under test calls. The other store
// imports (jobBoard / jobs / auth) aren't exercised by markJobRead.
const markAllRead = vi.fn((_ids: string[]) => Promise.resolve());
vi.mock("@/firebase/services/notifications", () => ({
  markAllRead: (ids: string[]) => markAllRead(ids),
  markNotificationRead: vi.fn(() => Promise.resolve()),
  subscribeMyNotifications: () => () => {},
}));

import { useNotificationsStore } from "@/stores/notifications";

// Minimal notification fixture — markJobRead only reads id / read / jobId.
function notif(id: string, jobId: string | null, read: boolean): WithId<NotificationDoc> {
  return { id, jobId, read } as WithId<NotificationDoc>;
}

describe("notifications store — markJobRead", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    markAllRead.mockClear();
  });

  it("marks only the target job's unread notifications", async () => {
    const store = useNotificationsStore();
    store.items = [
      notif("a", "job-1", false), // target, unread → marked
      notif("b", "job-1", true), // target, already read → skipped
      notif("c", "job-2", false), // other job → skipped
      notif("d", null, false), // not job-scoped → skipped
      notif("e", "job-1", false), // target, unread → marked
    ];

    await store.markJobRead("job-1");

    expect(markAllRead).toHaveBeenCalledTimes(1);
    expect(markAllRead).toHaveBeenCalledWith(["a", "e"]);
  });

  it("is a no-op when the job has no unread notifications", async () => {
    const store = useNotificationsStore();
    store.items = [
      notif("a", "job-1", true), // read
      notif("b", "job-2", false), // different job
    ];

    await store.markJobRead("job-1");

    expect(markAllRead).not.toHaveBeenCalled();
  });
});
