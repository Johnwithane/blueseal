import { describe, it, expect, vi } from "vitest";
import { mount } from "@vue/test-utils";
import ProspectCard from "./ProspectCard.vue";
import type { ProspectDoc, WithId } from "@/firebase/interfaces";

// The card only links via RouterLink and formats a rate — stub both so we can
// mount it in isolation (no router, no firebase).
vi.mock("vue-router", () => ({ RouterLink: { template: "<a><slot/></a>" } }));
vi.mock("@/composables/useFormatters", () => ({
  useFormatters: () => ({ money: (cents: number) => `$${(cents / 100).toFixed(0)}` }),
}));

function prospect(
  partial: Partial<WithId<ProspectDoc>> = {},
): WithId<ProspectDoc> & { distanceKm?: number } {
  return {
    id: "p1",
    displayName: "Acme Plumbing",
    companyName: "Acme Plumbing Ltd.",
    bio: "",
    trades: ["plumber"],
    yearsExperience: {},
    pricingModel: "quote",
    hourlyRate: null,
    languages: [],
    serviceRadiusKm: 25,
    distanceKm: 3.2,
    ...partial,
  } as unknown as WithId<ProspectDoc> & { distanceKm?: number };
}

function mountCard(p = prospect()) {
  return mount(ProspectCard, {
    props: { prospect: p },
    global: {
      stubs: {
        Tag: { props: ["value", "severity"], template: '<span class="p-tag">{{ value }}</span>' },
        Avatar: true,
      },
    },
  });
}

describe("ProspectCard", () => {
  it("shows the Pending verification badge", () => {
    expect(mountCard().text()).toContain("Pending verification");
  });

  it("shows NO trust UI — no ID-verified tag, no rating, no verified pills", () => {
    const wrapper = mountCard();
    const text = wrapper.text();
    expect(text).not.toContain("ID verified");
    expect(text).not.toContain("Rating");
    // verified-trade pills (.bs-pill.verified) and the verified icon never render
    expect(wrapper.find(".bs-pill").exists()).toBe(false);
    expect(wrapper.find(".pi-verified").exists()).toBe(false);
  });

  it("renders the trade label and 'Quote' when there's no hourly rate", () => {
    const wrapper = mountCard();
    expect(wrapper.text()).toContain("Plumber");
    expect(wrapper.text()).toContain("Quote");
  });

  it("renders an hourly rate when present", () => {
    const wrapper = mountCard(prospect({ hourlyRate: 9500 }));
    expect(wrapper.text()).toContain("$95/hr");
  });
});
