<script setup lang="ts">
// Help Center contact form.
//
// INTERIM IMPLEMENTATION: submitting composes a prefilled email to
// SUPPORT_EMAIL (mailto) — fully functional with no backend. The planned
// Firestore-backed version (write a supportTickets doc that admins triage)
// is deferred until its security rules can be deployed; swapping `submit()`
// to a service call is the only change needed then. See HUMANTASKS.md.
import { computed, ref } from "vue";
import Button from "primevue/button";
import InputText from "primevue/inputtext";
import Textarea from "primevue/textarea";
import Select from "primevue/select";
import { useAuthStore } from "@/stores/auth";
import { useToast } from "@/composables/useToast";
import { SUPPORT_EMAIL, SUPPORT_TOPICS } from "@/data/support";

const auth = useAuthStore();
const toast = useToast();

const name = ref(auth.user?.displayName ?? "");
const email = ref(auth.user?.email ?? "");
const topic = ref<string>(SUPPORT_TOPICS[0]);
const message = ref("");

const canSubmit = computed(
  () => name.value.trim().length > 1 && email.value.trim().length > 3 && message.value.trim().length > 4,
);

function submit() {
  if (!canSubmit.value) {
    toast.warn("Almost there", "Add your name, email, and a short message.");
    return;
  }
  const subject = `[Support] ${topic.value}`;
  const body = [
    `Name: ${name.value.trim()}`,
    `Email: ${email.value.trim()}`,
    `Topic: ${topic.value}`,
    "",
    message.value.trim(),
  ].join("\n");
  // Open the user's mail client with everything prefilled.
  window.location.href = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(
    subject,
  )}&body=${encodeURIComponent(body)}`;
  toast.success("Opening your email", "We've prefilled a message to our support team.");
}
</script>

<template>
  <form class="bs-form space-y-4" @submit.prevent="submit">
    <div class="grid gap-4 sm:grid-cols-2">
      <div>
        <label for="sc-name" class="mb-1 block text-sm font-medium">Your name</label>
        <InputText id="sc-name" v-model="name" class="w-full" autocomplete="name" />
      </div>
      <div>
        <label for="sc-email" class="mb-1 block text-sm font-medium">Email</label>
        <InputText id="sc-email" v-model="email" type="email" class="w-full" autocomplete="email" />
      </div>
    </div>

    <div>
      <label for="sc-topic" class="mb-1 block text-sm font-medium">What's it about?</label>
      <Select
        id="sc-topic"
        v-model="topic"
        :options="[...SUPPORT_TOPICS]"
        class="w-full"
      />
    </div>

    <div>
      <label for="sc-message" class="mb-1 block text-sm font-medium">How can we help?</label>
      <Textarea
        id="sc-message"
        v-model="message"
        rows="5"
        class="w-full"
        :maxlength="2000"
        placeholder="Tell us what's going on. If it's about a job, include the job link from your dashboard."
      />
    </div>

    <div class="flex flex-wrap items-center justify-between gap-3">
      <p class="text-xs text-[color:var(--bs-muted)]">
        We'll reply by email to the address above.
      </p>
      <Button type="submit" label="Send message" icon="pi pi-send" :disabled="!canSubmit" />
    </div>
  </form>
</template>
