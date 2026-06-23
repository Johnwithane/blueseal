import { describe, it, expect, vi } from "vitest";
import { mount } from "@vue/test-utils";
import KanbanBoard from "./KanbanBoard.vue";
import type { JobDoc, WithId } from "@/firebase/interfaces";

// The component only navigates via useRouter().push and formats a timestamp —
// stub both so we can mount it in isolation.
const push = vi.fn();
vi.mock("vue-router", () => ({ useRouter: () => ({ push }) }));
vi.mock("@/composables/useFormatters", () => ({
  useFormatters: () => ({ relativeTime: () => "just now" }),
}));

function job(partial: Partial<WithId<JobDoc>> & { id: string; status: string }): WithId<JobDoc> {
  return {
    title: "Test job",
    trade: "plumbing",
    clientName: "Sam",
    clientPhotoURL: null,
    scheduledStart: null,
    createdAt: { toMillis: () => 0 },
    ...partial,
  } as unknown as WithId<JobDoc>;
}

function mountBoard(jobs: WithId<JobDoc>[]) {
  return mount(KanbanBoard, {
    props: { jobs },
    global: { stubs: { JobCounterparty: true, JobNotificationsBell: true } },
  });
}

describe("KanbanBoard", () => {
  it("renders all 9 pipeline columns", () => {
    const wrapper = mountBoard([]);
    expect(wrapper.findAll("section")).toHaveLength(9);
  });

  it("places each job under its status column and shows empty hints elsewhere", () => {
    const wrapper = mountBoard([
      job({ id: "a", status: "in_progress", title: "Leaky tap" }),
      job({ id: "b", status: "in_progress", title: "Boiler" }),
      job({ id: "c", status: "quoted", title: "Reno" }),
    ]);
    // 3 cards total across the board.
    expect(wrapper.findAll('[role="button"]')).toHaveLength(3);
    // Columns with no jobs show the empty hint; 7 of 9 columns are empty here.
    expect(wrapper.findAll("p").filter((p) => p.text() === "Nothing here yet.")).toHaveLength(7);
  });

  it("drops reviewed/cancelled jobs from the board", () => {
    const wrapper = mountBoard([
      job({ id: "a", status: "reviewed" }),
      job({ id: "b", status: "cancelled" }),
      job({ id: "c", status: "complete" }),
    ]);
    expect(wrapper.findAll('[role="button"]')).toHaveLength(1);
  });

  it("cards are keyboard-operable (role=button, tabindex, Enter navigates)", async () => {
    const wrapper = mountBoard([job({ id: "job-1", status: "requested" })]);
    const card = wrapper.get('[role="button"]');
    expect(card.attributes("tabindex")).toBe("0");
    expect(card.attributes("aria-label")).toContain("Test job");

    push.mockClear();
    await card.trigger("keydown.enter");
    expect(push).toHaveBeenCalledWith({ name: "JobDetail", params: { id: "job-1" } });

    push.mockClear();
    await card.trigger("click");
    expect(push).toHaveBeenCalledWith({ name: "JobDetail", params: { id: "job-1" } });
  });

  it("uses a mobile-first scroll-snap strip (not a rigid 1920px grid)", () => {
    const wrapper = mountBoard([]);
    const strip = wrapper.get("div");
    expect(strip.classes()).toContain("snap-x");
    expect(strip.classes()).toContain("overflow-x-auto");
    // The old rigid layout is gone.
    expect(strip.classes().join(" ")).not.toContain("min-w-[1920px]");
  });
});
