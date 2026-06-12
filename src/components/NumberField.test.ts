import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import PrimeVue from "primevue/config";
import InputNumber from "primevue/inputnumber";
import NumberField from "./NumberField.vue";

// NumberField exists to fix PrimeVue InputNumber only committing its v-model on
// blur. These assert the wrapper mirrors the live `input` event into v-model so
// computed totals move on every keystroke, while keeping blur passthrough.
describe("NumberField", () => {
  function mountField(modelValue: number | null = null) {
    return mount(NumberField, {
      props: { modelValue },
      global: { plugins: [PrimeVue] },
    });
  }

  it("mirrors the live `input` event into v-model (per keystroke)", async () => {
    const wrapper = mountField(null);
    const inner = wrapper.findComponent(InputNumber);
    inner.vm.$emit("input", { originalEvent: new Event("input"), value: 42, formattedValue: "42" });
    await wrapper.vm.$nextTick();
    expect(wrapper.emitted("update:modelValue")?.at(-1)).toEqual([42]);
  });

  it("still passes through blur commits (update:modelValue)", async () => {
    const wrapper = mountField(null);
    wrapper.findComponent(InputNumber).vm.$emit("update:modelValue", 99);
    await wrapper.vm.$nextTick();
    expect(wrapper.emitted("update:modelValue")?.at(-1)).toEqual([99]);
  });

  it("coerces null / non-numeric input values to null", async () => {
    const wrapper = mountField(5);
    const inner = wrapper.findComponent(InputNumber);
    inner.vm.$emit("input", { originalEvent: new Event("input"), value: null, formattedValue: "" });
    await wrapper.vm.$nextTick();
    expect(wrapper.emitted("update:modelValue")?.at(-1)).toEqual([null]);
  });
});
