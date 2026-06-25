<script setup lang="ts">
import { computed, ref } from "vue";
import { RouterLink } from "vue-router";
import Button from "primevue/button";
import InputText from "primevue/inputtext";
import Message from "primevue/message";
import { useAuthStore } from "@/stores/auth";
import { claimReferralCode } from "@/firebase/services/salesReps";
import { isValidReferralCode, normalizeReferralCode } from "@/utils/referralCode";
import { useToast } from "@/composables/useToast";
import { humanizeError } from "@/utils/errors";

// Minimal sales-rep landing (M2): claim/share your vanity referral code. The
// liability gate (RepAgreementDialog, mounted in App.vue) blocks this view until
// the rep has signed. Earnings, referred tradespeople, and region tools land in
// later milestones.
const auth = useAuthStore();
const toast = useToast();

const code = computed(() => auth.user?.salesRep?.referralCode ?? "");
const editing = ref(false);
const draft = ref("");
const saving = ref(false);

const normalizedDraft = computed(() => normalizeReferralCode(draft.value));
const draftValid = computed(() => isValidReferralCode(normalizedDraft.value));
const referralLink = computed(() =>
  code.value ? `${window.location.origin}/join?ref=${code.value}` : "",
);

function startEdit() {
  draft.value = code.value;
  editing.value = true;
}

async function save() {
  if (!draftValid.value) {
    toast.warn("Check the code", "Use 3-20 letters or numbers.");
    return;
  }
  saving.value = true;
  try {
    await claimReferralCode(normalizedDraft.value);
    await auth.reloadUserDoc();
    editing.value = false;
    toast.success("Saved", "Your referral code is set.");
  } catch (e) {
    toast.error("Couldn't save", humanizeError(e));
  } finally {
    saving.value = false;
  }
}

async function copyLink() {
  try {
    await navigator.clipboard.writeText(referralLink.value);
    toast.success("Copied", "Referral link copied.");
  } catch {
    toast.warn("Copy failed", "Copy the link manually.");
  }
}
</script>

<template>
  <section class="bs-container py-8 max-w-2xl">
    <header class="mb-5">
      <h1 class="text-lg font-semibold">Your sales tools</h1>
      <p class="text-sm text-[color:var(--bs-muted)] mt-1">
        Share your referral link to sign tradespeople onto Blue Seal. Anyone who joins through it is
        yours: you review their application and earn commission on everything they do.
      </p>
    </header>

    <RouterLink
      to="/sales/applications"
      class="bs-card p-4 mb-4 flex items-center justify-between gap-3 no-underline text-inherit hover:shadow-md transition-shadow"
    >
      <div class="flex items-center gap-3">
        <span
          class="inline-flex h-9 w-9 items-center justify-center rounded-full shrink-0"
          style="background-color: var(--bs-surface-alt); color: var(--bs-blue)"
        >
          <i class="pi pi-shield"></i>
        </span>
        <div>
          <div class="text-sm font-medium">Applications to review</div>
          <div class="text-xs text-[color:var(--bs-muted)]">Vet the tradespeople in your territory</div>
        </div>
      </div>
      <i class="pi pi-chevron-right text-[color:var(--bs-muted)]"></i>
    </RouterLink>

    <div class="bs-card p-4 space-y-3">
      <h2 class="text-sm font-semibold">Your referral code</h2>

      <template v-if="!editing && code">
        <div class="flex items-center gap-2">
          <span class="text-lg font-mono font-semibold tracking-wide">{{ code }}</span>
          <Button label="Change" text size="small" @click="startEdit" />
        </div>
        <div class="flex items-center gap-2">
          <InputText :model-value="referralLink" readonly class="w-full text-xs" />
          <Button icon="pi pi-copy" aria-label="Copy link" @click="copyLink" />
        </div>
      </template>

      <template v-else-if="!editing && !code">
        <Message severity="info" :closable="false">
          Pick a referral code to start signing people up.
        </Message>
        <Button label="Choose your code" icon="pi pi-pencil" @click="startEdit" />
      </template>

      <template v-else>
        <label class="text-xs font-medium block mb-1">Referral code (3-20 letters or numbers)</label>
        <div class="flex flex-wrap items-center gap-2">
          <InputText v-model="draft" class="flex-1 min-w-0" placeholder="JOHNNYK" />
          <Button label="Save" :loading="saving" :disabled="!draftValid" @click="save" />
          <Button label="Cancel" text :disabled="saving" @click="editing = false" />
        </div>
        <p v-if="normalizedDraft" class="text-[11px] text-[color:var(--bs-muted)]">
          Will be saved as <strong>{{ normalizedDraft }}</strong>.
        </p>
      </template>
    </div>

    <p class="text-xs text-[color:var(--bs-muted)] mt-4">
      Your earnings, referred tradespeople, and region tools are coming soon.
    </p>
  </section>
</template>
