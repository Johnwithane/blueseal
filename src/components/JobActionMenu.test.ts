import { describe, it, expect } from "vitest";
import { defineComponent } from "vue";
import { mount } from "@vue/test-utils";
import JobActionMenu from "./JobActionMenu.vue";
import type { JobDoc, JobStatus, WithId } from "@/firebase/interfaces";

// Issue #21 turned the passive status chip into an action menu. The substance
// is which actions each status offers — "impossible actions don't show" is the
// whole point, and it's the part a visual check can't prove across 11 statuses.
// Menu is stubbed: we assert on the `model` it's handed, not PrimeVue's popup.

interface StubItem {
  label?: string;
  separator?: boolean;
  command?: () => void;
}

// Typed so findComponent(MenuStub).props("model") narrows to the item list —
// a selector-string lookup returns WrapperLike, which has no props().
const MenuStub = defineComponent({
  name: "MenuStub",
  props: { model: { type: Array as () => StubItem[], required: true } },
  template: '<div class="stub-menu" />',
});

const STUBS = {
  Menu: MenuStub,
  Tag: { props: ["value", "severity"], template: "<span class=\"stub-tag\">{{ value }}</span>" },
};

function job(status: JobStatus): WithId<JobDoc> {
  return {
    id: "job1",
    status,
    title: "Leaky tap",
    trade: "plumbing",
    clientId: "c1",
    tradespersonId: "tp1",
  } as unknown as WithId<JobDoc>;
}

function itemsFor(status: JobStatus): string[] {
  const w = mount(JobActionMenu, { props: { job: job(status) }, global: { stubs: STUBS } });
  const model = w.findComponent(MenuStub).props("model") ?? [];
  return model.filter((i) => !i.separator).map((i) => i.label as string);
}

describe("JobActionMenu — items derived from the status machine", () => {
  it("offers quoting only while a quote is still the live question", () => {
    expect(itemsFor("requested")).toContain("Quote");
    expect(itemsFor("quoted")).toContain("Revise quote");
    for (const s of ["accepted", "in_progress", "awaiting_payment"] as JobStatus[]) {
      expect(itemsFor(s).some((l) => l.includes("uote"))).toBe(false);
    }
  });

  it("offers Complete job only on a running job", () => {
    expect(itemsFor("in_progress")).toContain("Complete job");
    for (const s of [
      "requested",
      "accepted",
      "quoted",
      "awaiting_upfront_payment",
      "on_hold",
      "awaiting_client_approval",
      "awaiting_payment",
    ] as JobStatus[]) {
      expect(itemsFor(s)).not.toContain("Complete job");
    }
  });

  it("offers Cancel job only pre-commitment, mirroring the client's rule", () => {
    for (const s of ["requested", "accepted", "quoted"] as JobStatus[]) {
      expect(itemsFor(s)).toContain("Cancel job");
    }
    // Past commitment the other party has to agree, and there is no
    // tradesperson-side request loop — so the action must not be offered.
    for (const s of [
      "awaiting_upfront_payment",
      "in_progress",
      "on_hold",
      "awaiting_client_approval",
      "awaiting_payment",
    ] as JobStatus[]) {
      expect(itemsFor(s)).not.toContain("Cancel job");
    }
  });

  it("collapses to Open job on a terminal status", () => {
    for (const s of ["complete", "reviewed", "cancelled"] as JobStatus[]) {
      expect(itemsFor(s)).toEqual(["Open job"]);
    }
  });

  it("always offers Schedule and Invoice on a live job", () => {
    for (const s of [
      "requested",
      "accepted",
      "quoted",
      "awaiting_upfront_payment",
      "in_progress",
      "on_hold",
      "awaiting_client_approval",
      "awaiting_payment",
    ] as JobStatus[]) {
      expect(itemsFor(s)).toEqual(expect.arrayContaining(["Schedule", "Invoice"]));
    }
  });
});

describe("JobActionMenu — the trigger still reads as a status", () => {
  it("keeps the tradesperson status label visible (issue #21 asked to keep it)", () => {
    const w = mount(JobActionMenu, {
      props: { job: job("requested") },
      global: { stubs: STUBS },
    });
    expect(w.find(".stub-tag").text()).toBe("Quote needed");
    expect(w.find("button").attributes("aria-label")).toBe("Quote needed — job actions");
  });

  it("labels every status it can show", () => {
    expect(
      mount(JobActionMenu, { props: { job: job("in_progress") }, global: { stubs: STUBS } })
        .find(".stub-tag")
        .text(),
    ).toBe("In progress");
  });
});

describe("JobActionMenu — commands emit rather than act", () => {
  function run(status: JobStatus, label: string) {
    const w = mount(JobActionMenu, { props: { job: job(status) }, global: { stubs: STUBS } });
    const model = w.findComponent(MenuStub).props("model") ?? [];
    model.find((i) => i.label === label)?.command?.();
    return w;
  }

  it("deep-links each tab action", () => {
    expect(run("requested", "Quote").emitted("open")).toEqual([
      [{ jobId: "job1", tab: "quote" }],
    ]);
    expect(run("in_progress", "Schedule").emitted("open")).toEqual([
      [{ jobId: "job1", tab: "schedule" }],
    ]);
    expect(run("in_progress", "Invoice").emitted("open")).toEqual([
      [{ jobId: "job1", tab: "invoice" }],
    ]);
    expect(run("in_progress", "Open job").emitted("open")).toEqual([[{ jobId: "job1" }]]);
  });

  it("hands the confirm-gated actions to the parent", () => {
    expect(run("in_progress", "Complete job").emitted("finish")).toEqual([["job1"]]);
    expect(run("requested", "Cancel job").emitted("cancel")).toEqual([["job1"]]);
  });
});
