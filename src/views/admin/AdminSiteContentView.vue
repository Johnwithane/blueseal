<script setup lang="ts">
import { onMounted, ref } from "vue";
import { RouterLink } from "vue-router";
import Button from "primevue/button";
import InputText from "primevue/inputtext";
import Textarea from "primevue/textarea";
import Message from "primevue/message";
import type { Testimonial } from "@/firebase/interfaces";
import { getHomeContent, saveHomeTestimonials } from "@/firebase/services/siteContent";
import { useToast } from "@/composables/useToast";
import { useFormatters } from "@/composables/useFormatters";
import { humanizeError } from "@/utils/errors";

const toast = useToast();
const { relativeTime } = useFormatters();

const testimonials = ref<Testimonial[]>([]);
const loading = ref(true);
const saving = ref(false);
const lastUpdatedAt = ref<{ toDate(): Date } | null>(null);

onMounted(async () => {
  await load();
});

async function load() {
  loading.value = true;
  const content = await getHomeContent();
  testimonials.value = content?.testimonials.map((t) => ({ ...t })) ?? [];
  lastUpdatedAt.value = content?.updatedAt ?? null;
  loading.value = false;
}

function addTestimonial() {
  testimonials.value.push({ quote: "", name: "", role: "" });
}

function removeTestimonial(idx: number) {
  testimonials.value.splice(idx, 1);
}

function moveUp(idx: number) {
  if (idx === 0) return;
  const arr = testimonials.value;
  [arr[idx - 1], arr[idx]] = [arr[idx], arr[idx - 1]];
}

function moveDown(idx: number) {
  if (idx === testimonials.value.length - 1) return;
  const arr = testimonials.value;
  [arr[idx], arr[idx + 1]] = [arr[idx + 1], arr[idx]];
}

async function save() {
  // Validation: every entry needs all three fields. Empty entries are
  // refused rather than silently dropped so the admin sees the problem.
  for (const [i, t] of testimonials.value.entries()) {
    if (!t.quote.trim() || !t.name.trim() || !t.role.trim()) {
      toast.warn("Missing field", `Testimonial #${i + 1} is missing a quote, name, or role.`);
      return;
    }
  }
  saving.value = true;
  try {
    await saveHomeTestimonials(testimonials.value);
    toast.success("Saved", "The home page will pick up the new testimonials on next load.");
    await load();
  } catch (e) {
    toast.error("Couldn't save", humanizeError(e));
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <section class="bs-container py-8 max-w-4xl">
    <RouterLink to="/dashboard/admin" class="text-xs text-[color:var(--bs-muted)]">
      ← Admin console
    </RouterLink>

    <header class="mt-2 mb-6">
      <h1 class="text-2xl font-bold">Site content</h1>
      <p class="mt-1 text-sm text-[color:var(--bs-muted)]">
        Edit the testimonials shown on the home page. The section auto-hides
        when this list is empty, so we never ship fake quotes.
      </p>
      <p v-if="lastUpdatedAt" class="mt-1 text-xs text-[color:var(--bs-muted)]">
        Last saved {{ relativeTime(lastUpdatedAt) }}.
      </p>
    </header>

    <Message v-if="!loading && testimonials.length === 0" severity="info" :closable="false">
      No testimonials yet. The home page is hiding the section. Add one below
      to start.
    </Message>

    <div v-if="loading" class="bs-empty">Loading…</div>

    <div v-else class="space-y-4">
      <article
        v-for="(t, i) in testimonials"
        :key="i"
        class="bs-card p-4"
      >
        <div class="flex items-center justify-between mb-3">
          <span class="text-xs font-semibold text-[color:var(--bs-muted)]">
            Testimonial #{{ i + 1 }}
          </span>
          <div class="flex gap-1">
            <Button
              icon="pi pi-arrow-up"
              text
              size="small"
              :disabled="i === 0"
              aria-label="Move up"
              @click="moveUp(i)"
            />
            <Button
              icon="pi pi-arrow-down"
              text
              size="small"
              :disabled="i === testimonials.length - 1"
              aria-label="Move down"
              @click="moveDown(i)"
            />
            <Button
              icon="pi pi-trash"
              text
              size="small"
              severity="danger"
              aria-label="Remove"
              @click="removeTestimonial(i)"
            />
          </div>
        </div>

        <label class="text-xs font-medium block mb-1">Quote</label>
        <Textarea
          v-model="t.quote"
          rows="3"
          class="w-full"
          :maxlength="500"
          placeholder="What the client/tradesperson said."
        />

        <div class="grid sm:grid-cols-2 gap-3 mt-3">
          <div>
            <label class="text-xs font-medium block mb-1">Name</label>
            <InputText v-model="t.name" class="w-full" placeholder="Sarah M." />
          </div>
          <div>
            <label class="text-xs font-medium block mb-1">Role / context</label>
            <InputText v-model="t.role" class="w-full" placeholder="Homeowner, Calgary" />
          </div>
        </div>
      </article>

      <Button
        label="Add a testimonial"
        icon="pi pi-plus"
        outlined
        class="w-full"
        @click="addTestimonial"
      />

      <div class="flex justify-end gap-2 pt-2">
        <Button label="Reload" icon="pi pi-refresh" text :disabled="saving" @click="load" />
        <Button
          label="Save changes"
          icon="pi pi-save"
          :loading="saving"
          @click="save"
        />
      </div>
    </div>
  </section>
</template>
