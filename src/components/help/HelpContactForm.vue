<script setup lang="ts">
// Help Center contact form.
//
// Signed-in users file a real support ticket (supportTickets/{id}) that admins
// triage at /admin/support. Signed-out visitors — or any case where the ticket
// write is refused (e.g. the rules aren't deployed yet) — fall back to a
// prefilled email (mailto) so the form always works. SUPPORT_EMAIL is a
// placeholder; confirm the real inbox (see HUMANTASKS.md).
import { computed, ref } from "vue";
import Button from "primevue/button";
import InputText from "primevue/inputtext";
import Textarea from "primevue/textarea";
import Select from "primevue/select";
import { useAuthStore } from "@/stores/auth";
import { useToast } from "@/composables/useToast";
import { createSupportTicket } from "@/firebase/services/support";
import { supportTicketSchema } from "@/validation/schemas";
import { SUPPORT_EMAIL, SUPPORT_TOPICS } from "@/data/support";

const auth = useAuthStore();
const toast = useToast();

const name = ref(auth.user?.displayName ?? "");
const email = ref(auth.user?.email ?? "");
const topic = ref<string>(SUPPORT_TOPICS[0]);
const message = ref("");
const sending = ref(false);
const sent = ref(false);

const canSubmit = computed(
  () => name.value.trim().length > 1 && email.value.trim().length > 3 && message.value.trim().length > 4,
);

// Open the user's mail client with everything prefilled. Used for signed-out
// visitors and as the fallback when a ticket write is refused.
function openMailto() {
  const subject = `[Support] ${topic.value}`;
  const body = [
    `Name: ${name.value.trim()}`,
    `Email: ${email.value.trim()}`,
    `Topic: ${topic.value}`,
    "",
    message.value.trim(),
  ].join("\n");
  window.location.href = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(
    subject,
  )}&body=${encodeURIComponent(body)}`;
}

async function submit() {
  if (!canSubmit.value) {
    toast.warn("Almost there", "Add your name, email, and a short message.");
    return;
  }

  const parsed = supportTicketSchema.safeParse({
    name: name.value,
    email: email.value,
    topic: topic.value,
    message: message.value,
  });
  if (!parsed.success) {
    toast.warn("Check your details", parsed.error.issues[0]?.message ?? "Please review the form.");
    return;
  }

  // Signed-out visitors don't have a ticket path — go straight to email.
  if (!auth.isAuthenticated) {
    openMailto();
    toast.success("Opening your email", "We've prefilled a message to our support team.");
    return;
  }

  sending.value = true;
  try {
    await createSupportTicket(parsed.data);
    sent.value = true;
    toast.success("Message sent", "Our team will get back to you by email. Thanks!");
    message.value = "";
  } catch {
    // Ticket write failed (e.g. rules not deployed yet) — degrade to email so
    // the user is never stuck.
    openMailto();
    toast.info("Opening your email instead", "We've prefilled a message to our support team.");
  } finally {
    sending.value = false;
  }
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
      <Button
        type="submit"
        :label="sent ? 'Sent — send another?' : 'Send message'"
        :icon="sent ? 'pi pi-check' : 'pi pi-send'"
        :loading="sending"
        :disabled="!canSubmit"
      />
    </div>
  </form>
</template>
