import { describe, it, expect, vi } from "vitest";
import { mount } from "@vue/test-utils";
import ProspectProfile from "./ProspectProfile.vue";
import type { ProspectDoc, WithId } from "@/firebase/interfaces";

vi.mock("vue-router", () => ({ RouterLink: { template: "<a><slot/></a>" } }));
vi.mock("@/composables/useFormatters", () => ({
  useFormatters: () => ({ money: (cents: number) => `$${(cents / 100).toFixed(0)}` }),
}));
vi.mock("@/stores/auth", () => ({
  useAuthStore: () => ({ isAuthenticated: true, hasClientRole: true }),
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
    locationLabel: "Vernon, BC",
    ...partial,
  } as unknown as WithId<ProspectDoc>;
}

function mountProfile(p = prospect()) {
  return mount(ProspectProfile, {
    props: { prospect: p },
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
}

describe("ProspectProfile", () => {
  it("renders the unclaimed banner + badge, bio, and location", () => {
    const wrapper = mountProfile();
    expect(wrapper.text()).toContain("Unclaimed");
    expect(wrapper.text()).toContain("hasn't joined or been verified yet");
    expect(wrapper.text()).toContain("Family-run since 1990.");
    expect(wrapper.text()).toContain("Vernon, BC");
  });

  it("shows NO verified/rating/reviews/recommendations UI", () => {
    const text = mountProfile().text();
    expect(text).not.toContain("ID verified");
    expect(text).not.toContain("Reviews");
    expect(text).not.toContain("Recommendations");
    expect(text).not.toContain("/ 5");
  });

  it("renders the 'Request this pro' CTA for a signed-in client", () => {
    const cta = mountProfile()
      .findAll("button")
      .find((b) => b.text().includes("Request this pro"));
    expect(cta).toBeDefined();
    expect(cta!.attributes("disabled")).toBeUndefined();
  });
});
