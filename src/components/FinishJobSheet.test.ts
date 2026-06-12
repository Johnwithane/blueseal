import { describe, it, expect, vi } from "vitest";
import { mount } from "@vue/test-utils";
import FinishJobSheet from "./FinishJobSheet.vue";
import type { JobExtraDoc, WithId } from "@/firebase/interfaces";

// Composables/stores need app context (PrimeVue toast provide, Pinia) we don't
// stand up here — mock them so setup runs in isolation. The bug under test is
// downstream of these, so mocking them doesn't mask it.
vi.mock("@/composables/useFormatters", () => ({
  useFormatters: () => ({ money: (c: number) => `$${(c / 100).toFixed(2)}` }),
}));
vi.mock("@/composables/useToast", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));
vi.mock("@/stores/paywall", () => ({
  usePaywallStore: () => ({ fromError: () => false }),
}));

const STUBS = {
  // Dialog renders its slots only when visible — mirrors PrimeVue's lazy body.
  Dialog: {
    props: ["visible"],
    template: '<div v-if="visible"><slot /><slot name="footer" /></div>',
  },
  Button: true,
  InputText: true,
  Textarea: true,
  SelectButton: true,
  Message: true,
  Tag: true,
  NumberField: true,
};

function mountSheet(visible = false) {
  return mount(FinishJobSheet, {
    props: {
      visible,
      jobId: "job1",
      tradespersonId: "tp1",
      clientId: "c1",
      billingType: "fixed" as const,
      extras: [] as WithId<JobExtraDoc>[],
      upfrontFeePaidCents: 0,
    },
    global: { stubs: STUBS },
  });
}

describe("FinishJobSheet", () => {
  // Regression: FINISH_STEPS reads costTrackingOnly, and watch(FINISH_STEPS)
  // evaluates its source eagerly during setup. When costTrackingOnly was
  // declared ~200 lines later, that eager eval hit the temporal dead zone
  // ("Cannot access 'costTrackingOnly' before initialization") and the whole
  // setup threw — so the wrap-up sheet silently never opened. Mounting at all
  // exercises that path, so this guards the declaration order.
  it("mounts without a setup error (costTrackingOnly declared before use)", () => {
    expect(() => mountSheet(false)).not.toThrow();
    expect(mountSheet(false).exists()).toBe(true);
  });

  it("renders the wizard once visible", () => {
    // Fixed job, no quote rows → time / expenses / extras / wrap-up = 4 steps.
    expect(mountSheet(true).text()).toContain("Step 1 of 4");
  });
});
