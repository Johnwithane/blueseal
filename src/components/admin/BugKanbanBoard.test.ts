import { describe, it, expect, vi } from "vitest";
import { mount } from "@vue/test-utils";
import BugKanbanBoard from "./BugKanbanBoard.vue";
import type { BugReportDoc, WithId } from "@/firebase/interfaces";

// The component only formats a timestamp — stub it so we can mount in isolation.
vi.mock("@/composables/useFormatters", () => ({
  useFormatters: () => ({ relativeTime: () => "just now" }),
}));

function report(
  partial: Partial<WithId<BugReportDoc>> & { id: string; status: BugReportDoc["status"] },
): WithId<BugReportDoc> {
  return {
    title: "Test bug",
    severity: "medium",
    area: "",
    reporterName: "Sam",
    createdAt: { toMillis: () => 0 },
    ...partial,
  } as unknown as WithId<BugReportDoc>;
}

function mountBoard(reports: WithId<BugReportDoc>[]) {
  return mount(BugKanbanBoard, {
    props: { reports },
    global: { stubs: { Tag: true, Select: true } },
  });
}

describe("BugKanbanBoard", () => {
  it("renders all 5 status columns", () => {
    expect(mountBoard([]).findAll("section")).toHaveLength(5);
  });

  it("groups each report under its status column", () => {
    const wrapper = mountBoard([
      report({ id: "a", status: "open" }),
      report({ id: "b", status: "in_progress" }),
      report({ id: "c", status: "in_progress" }),
    ]);
    const sections = wrapper.findAll("section");
    // Columns are ordered: open, triaged, in_progress, fixed, wontfix.
    expect(sections[0].findAll("article")).toHaveLength(1); // open
    expect(sections[2].findAll("article")).toHaveLength(2); // in_progress
    // Empty columns show the hint (triaged, fixed, wontfix).
    expect(wrapper.findAll("p").filter((p) => p.text() === "Nothing here.")).toHaveLength(3);
  });

  it("emits move(id, status) when a card is dropped on another column", async () => {
    const wrapper = mountBoard([report({ id: "a", status: "open" })]);
    const card = wrapper.get('article[draggable="true"]');
    await card.trigger("dragstart");
    // Drop on the in_progress column (3rd section).
    await wrapper.findAll("section")[2].trigger("drop");
    expect(wrapper.emitted("move")).toEqual([["a", "in_progress"]]);
  });

  it("does not emit when a card is dropped back on its own column", async () => {
    const wrapper = mountBoard([report({ id: "a", status: "open" })]);
    const card = wrapper.get('article[draggable="true"]');
    await card.trigger("dragstart");
    await wrapper.findAll("section")[0].trigger("drop"); // open → open
    expect(wrapper.emitted("move")).toBeUndefined();
  });
});
