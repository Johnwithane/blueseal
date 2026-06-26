<script setup lang="ts">
import { computed, ref } from "vue";
import { RouterLink } from "vue-router";
import InputText from "primevue/inputtext";
import Button from "primevue/button";
import { useAuthStore } from "@/stores/auth";
import { useSeo } from "@/composables/useSeo";
import { useToast } from "@/composables/useToast";
import { humanizeError } from "@/utils/errors";
import { claimPmCode } from "@/firebase/services/projectManagers";
import { isValidReferralCode, normalizeReferralCode } from "@/utils/referralCode";
import TrustedTradesPanel from "@/components/TrustedTradesPanel.vue";

// The Trades hub: the trades you recommend (saved), plus the recruit link that brings
// NEW tradespeople onto Blue Seal. Searching the directory to add existing trades +
// featuring them on your public profile arrive in the next increment.
useSeo({ title: "Trades", noindex: true });

const auth = useAuthStore();
const toast = useToast();

const justClaimed = ref<string | null>(null);
const code = computed(() => justClaimed.value ?? auth.user?.projectManager?.referralCode ?? "");
const editing = ref(false);
const draft = ref("");
const saving = ref(false);
const normalizedDraft = computed(() => normalizeReferralCode(draft.value));
const draftValid = computed(() => isValidReferralCode(normalizedDraft.value));
const recruitLink = computed(() =>
  code.value ? `${window.location.origin}/join?pm=${code.value}` : "",
);

function startEdit() {
  draft.value = code.value;
  editing.value = true;
}

async function saveCode() {
  if (!draftValid.value) {
    toast.warn("Check the code", "Use 3-20 letters or numbers.");
    return;
  }
  saving.value = true;
  try {
    const { code: saved } = await claimPmCode(normalizedDraft.value);
    justClaimed.value = saved;
    editing.value = false;
    toast.success("Saved", "Your recruiting code is set.");
    await auth.reloadUserDoc();
  } catch (e) {
    toast.error("Couldn't save", humanizeError(e));
  } finally {
    saving.value = false;
  }
}

async function copyRecruitLink() {
  try {
    await navigator.clipboard.writeText(recruitLink.value);
    toast.success("Copied", "Recruiting link copied.");
  } catch {
    toast.warn("Copy failed", "Copy the link manually.");
  }
}
</script>

<template>
  <section class="bs-container py-8 max-w-3xl">
    <h1 class="text-2xl font-bold mb-1">Trades</h1>
    <p class="text-sm text-[color:var(--bs-muted)] mb-5">
      The tradespeople you recommend. Your projects send each job to the matching saved trades for
      quotes.
    </p>

    <!-- Find + save trades from the directory (reuses the main search). -->
    <RouterLink
      to="/search"
      class="block bs-card p-4 mb-6 no-underline text-inherit border border-[color:var(--bs-blue)] hover:shadow-md transition-shadow"
    >
      <div class="flex items-center gap-3">
        <i class="pi pi-search text-xl text-[color:var(--bs-blue)]"></i>
        <div class="flex-1 min-w-0">
          <p class="font-medium">Find a tradesperson</p>
          <p class="text-sm text-[color:var(--bs-muted)]">
            Search the Blue Seal directory by trade and area, then save the ones you trust. Saved
            trades are who your projects go to for quotes.
          </p>
        </div>
        <i class="pi pi-chevron-right text-xs text-[color:var(--bs-muted)]"></i>
      </div>
    </RouterLink>

    <h2 class="font-semibold flex items-center gap-2 mb-1">
      <i class="pi pi-users text-[color:var(--bs-blue)]"></i> Your saved trades
    </h2>
    <p class="text-sm text-[color:var(--bs-muted)] mb-3">
      Save tradespeople you trust from their profile, then re-hire for a client in one tap.
    </p>
    <TrustedTradesPanel />

    <h2 class="font-semibold flex items-center gap-2 mb-1 mt-8">
      <i class="pi pi-link text-[color:var(--bs-blue)]"></i> Recruit link
    </h2>
    <p class="text-sm text-[color:var(--bs-muted)] mb-3">
      Share this with a tradesperson who isn't on Blue Seal yet. Anyone who joins through it lands
      on your saved trades and gets their first month of Blue Seal Pro free.
    </p>
    <div class="bs-card p-4">
      <div v-if="code && !editing" class="flex items-center gap-2 flex-wrap">
        <span
          class="flex-1 min-w-0 truncate text-sm rounded border border-[color:var(--bs-border)] px-2 py-1 bg-[color:var(--bs-surface-alt)]"
        >{{ recruitLink }}</span>
        <Button label="Copy" icon="pi pi-copy" size="small" @click="copyRecruitLink" />
        <Button label="Change" text size="small" @click="startEdit" />
      </div>
      <div v-else class="flex items-start gap-2">
        <div class="flex-1">
          <InputText v-model="draft" placeholder="e.g. ACME" class="w-full" />
          <small class="text-[color:var(--bs-muted)] block mt-1">3-20 letters or numbers.</small>
        </div>
        <Button label="Save" :loading="saving" :disabled="!draftValid" size="small" @click="saveCode" />
        <Button v-if="code" label="Cancel" text size="small" @click="editing = false" />
      </div>
    </div>
  </section>
</template>
