import { describe, it, expect, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import PrimeVue from "primevue/config";
import Select from "primevue/select";
import CertUploadCard from "./CertUploadCard.vue";
import type { CertPreset } from "@/data/certifications";
import { NO_CERT_SENTINEL } from "@/firebase/services/certifications";

// These composables need PrimeVue's toast/confirm provides we don't stand up
// here — mock them. The bug under test is downstream of them, so this doesn't
// mask it.
vi.mock("@/composables/useToast", () => ({
  useToast: () => ({ success: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));
vi.mock("@/composables/useConfirmAction", () => ({
  useConfirmAction: () => ({ confirmDestructive: vi.fn() }),
}));
vi.mock("@/composables/useFormatters", () => ({
  useFormatters: () => ({ date: (v: unknown) => String(v) }),
}));

// DatePicker + the doc preview are irrelevant to preset selection and heavy to
// render — stub them. The Selects and InputTexts stay real so the v-model /
// v-if wiring under test actually runs.
const STUBS = { DatePicker: true, VerificationDocPreview: true };

function mountCard(trade: string) {
  return mount(CertUploadCard, {
    props: { trade, existing: null },
    global: { plugins: [PrimeVue], stubs: STUBS },
  });
}

// Regression for bugReports/iSGyljawIUyLH3kAgmXd. `selectedPreset` was a deep
// `ref`, which wraps its object value in a reactive proxy — so the identity
// checks `selectedPreset.value === OTHER_CERT` / `=== NO_CERT_PRESET` were
// always false (proxy !== raw import). That hid the custom credential-name
// input and mis-worded the upload gate, dead-ending the "Other" path and every
// preset-less trade (e.g. pool_spa, which only offers Other + no-cert).
// shallowRef restores raw identity; these lock both branches.
describe("CertUploadCard — preset identity (shallowRef regression)", () => {
  it("reveals the custom credential-name field when Other is selected", async () => {
    // pool_spa has no presets, so the card defaults straight to OTHER_CERT.
    const wrapper = mountCard("pool_spa");
    await nextTick();

    // The name input the user must fill is actually rendered...
    expect(wrapper.find('input[placeholder^="Name of your credential"]').exists()).toBe(true);
    // ...and the gate asks for it by name, not the misleading "a certification".
    expect(wrapper.text()).toContain("the credential name");
    expect(wrapper.text()).not.toContain("Add a certification");
  });

  it("switches to the no-certification declaration flow when that option is picked", async () => {
    const wrapper = mountCard("plumber"); // has presets → starts on the standard flow

    // The cert dropdown is the first Select (issuing-body is the second).
    const certSelect = wrapper.findAllComponents(Select)[0];
    const options = certSelect.props("options") as CertPreset[];
    // Emit the *actual* option reference so identity holds, as the real Select does.
    const noCert = options.find((o) => o.name === NO_CERT_SENTINEL);
    expect(noCert).toBeTruthy();

    certSelect.vm.$emit("update:modelValue", noCert);
    await nextTick();

    expect(wrapper.text()).toContain("By declaring no formal certification");
    expect(wrapper.text()).toContain("Mark as no certification");
  });
});
