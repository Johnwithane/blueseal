import { describe, it, expect, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import ProspectProfileView from "./ProspectProfileView.vue";
import type { ProspectDoc, WithId } from "@/firebase/interfaces";

const getProspect = vi.fn();

vi.mock("vue-router", () => ({ useRoute: () => ({ params: { id: "p1" } }) }));
vi.mock("@/firebase/services/prospects", () => ({ getProspect: (...a: unknown[]) => getProspect(...a) }));
vi.mock("@/composables/useFormatters", () => ({
  useFormatters: () => ({ money: (cents: number) => `$${(cents / 100).toFixed(0)}` }),
}));

function prospect(partial: Partial<WithId<ProspectDoc>> = {}): WithId<ProspectDoc> {
  return {
    id: "p1",
    displayName: "Acme Plumbing",
    companyName: "Acme Plumbing Ltd.",
    bio: "Family-run since 1990.",
    trades: ["plumber"],
    yearsExperience: { plumber: 12 },
    pricingModel: "quote",
    hourlyRate: null,
    languages: ["English"],
    serviceRadiusKm: 25,
    ...partial,
  } as unknown as WithId<ProspectDoc>;
}

async function mountView() {
  const wrapper = mount(ProspectProfileView, {
    global: {
      stubs: {
        Tag: { props: ["value", "severity"], template: '<span class="p-tag">{{ value }}</span>' },
        Avatar: true,
        Button: {
          props: ["label", "icon", "disabled"],
          template: '<button :disabled="disabled">{{ label }}</button>',
        },
      },
    },
  });
  await flushPromises();
  return wrapper;
}

describe("ProspectProfileView", () => {
  it("renders the pending-verification banner + badge and the bio", async () => {
    getProspect.mockResolvedValue(prospect());
    const wrapper = await mountView();
    expect(wrapper.text()).toContain("Pending verification");
    expect(wrapper.text()).toContain("added from public business records");
    expect(wrapper.text()).toContain("Family-run since 1990.");
  });

  it("shows NO verified/rating/reviews/recommendations UI", async () => {
    getProspect.mockResolvedValue(prospect());
    const wrapper = await mountView();
    const text = wrapper.text();
    expect(text).not.toContain("ID verified");
    expect(text).not.toContain("Reviews");
    expect(text).not.toContain("Recommendations");
    expect(text).not.toContain("/ 5"); // the rating block in TradieProfileView
    expect(wrapper.find(".pi-verified").exists()).toBe(false);
  });

  it("renders the CTA disabled (outreach is wired in Phase 3)", async () => {
    getProspect.mockResolvedValue(prospect());
    const wrapper = await mountView();
    const cta = wrapper.findAll("button").find((b) => b.text().includes("Request this pro"));
    expect(cta).toBeDefined();
    expect(cta!.attributes("disabled")).toBeDefined();
  });

  it("shows a not-found state when the prospect is missing", async () => {
    getProspect.mockResolvedValue(null);
    const wrapper = await mountView();
    expect(wrapper.text()).toContain("Profile not found.");
  });
});
