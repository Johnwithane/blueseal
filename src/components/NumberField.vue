<script setup lang="ts">
// Drop-in replacement for PrimeVue InputNumber that commits its value on every
// keystroke, not just on blur/Enter.
//
// Why: PrimeVue's InputNumber only emits `update:modelValue` (the v-model) on
// blur/Enter, so computed totals — quote/invoice subtotals, change-order
// amounts — don't move while you're still typing in a field. Its `input` event
// DOES fire live with the parsed numeric value, and its modelValue watcher
// never reformats a *focused* field (verified in primevue 4.5.5), so mirroring
// `input` into the model is safe: decimals keep typing fine and the cursor
// doesn't jump.
//
// All other InputNumber props/attrs/listeners (mode, currency, min, max,
// :invalid, class, @blur, …) pass straight through via $attrs.
import InputNumber, { type InputNumberInputEvent } from "primevue/inputnumber";

defineOptions({ inheritAttrs: false });

const model = defineModel<number | null | undefined>();

function onInput(e: InputNumberInputEvent) {
  // handleOnInput passes the parsed numeric value (or null); coerce defensively
  // so a stray string/NaN can never land in the model.
  const v = e.value;
  model.value = typeof v === "number" && !Number.isNaN(v) ? v : null;
}
</script>

<template>
  <InputNumber
    :model-value="model"
    v-bind="$attrs"
    @input="onInput"
    @update:model-value="model = $event"
  />
</template>
