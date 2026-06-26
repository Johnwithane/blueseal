<script setup lang="ts">
import { computed, ref } from "vue";
import InputText from "primevue/inputtext";
import Button from "primevue/button";
import { useAuthStore } from "@/stores/auth";
import { useSeo } from "@/composables/useSeo";
import { useToast } from "@/composables/useToast";
import { humanizeError } from "@/utils/errors";
import { claimPmCode } from "@/firebase/services/projectManagers";
import { isValidReferralCode, normalizeReferralCode } from "@/utils/referralCode";
import TrustedTradesPanel from "@/components/TrustedTradesPanel.vue";
import PropertiesPanel from "@/components/PropertiesPanel.vue";
import ProjectsPanel from "@/components/ProjectsPanel.vue";
import PmEarningsPanel from "@/components/manage/PmEarningsPanel.vue";

useSeo({ title: "Manage", noindex: true });

const auth = useAuthStore();
const toast = useToast();

const firstName = computed(() => (auth.user?.displayName ?? "").trim().split(/\s+/)[0] || "");

// Recruiting link: a PM's vanity code -> /join?pm=CODE. A tradesperson who signs up
// through it joins this PM's saved trades and gets a free first month of Pro.
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

function startEditCode() {
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
    <div class="bs-pill verified mb-3">
      <i class="pi pi-briefcase"></i>
      <span>Project manager</span>
    </div>
    <h1 class="text-2xl font-bold">
      Welcome<template v-if="firstName">, {{ firstName }}</template>.
    </h1>
    <p class="text-[color:var(--bs-muted)] mb-6 max-w-prose">
      This is your cockpit. Recommend trades you trust, set up projects for your clients,
      and track the work. You earn a referral commission when one of your preferred
      contractors does work you set up.
    </p>

    <!-- Section stubs are filled in as the feature lands: Trusted Trades (recommend +
         recruit), Projects (set up + dispatch), Earnings (commission + payouts), and your
         public profile. They render here once each phase ships. -->
    <div class="grid grid-cols-1 gap-3">
      <!-- Recruit trades: share your link to bring tradespeople onto Blue Seal -->
      <div class="bs-card p-5">
        <h2 class="font-semibold flex items-center gap-2 mb-1">
          <i class="pi pi-link text-[color:var(--bs-blue)]"></i> Recruit trades
        </h2>
        <p class="text-sm text-[color:var(--bs-muted)] mb-3">
          Share your link to bring tradespeople onto Blue Seal. Anyone who joins through it
          lands on your saved trades and gets their first month of Blue Seal Pro free.
        </p>
        <div v-if="code && !editing" class="flex items-center gap-2 flex-wrap">
          <span
            class="flex-1 min-w-0 truncate text-sm rounded border border-[color:var(--bs-border)] px-2 py-1 bg-[color:var(--bs-surface-alt)]"
          >{{ recruitLink }}</span>
          <Button label="Copy" icon="pi pi-copy" size="small" @click="copyRecruitLink" />
          <Button label="Change" text size="small" @click="startEditCode" />
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

      <div>
        <h2 class="font-semibold flex items-center gap-2 mb-1">
          <i class="pi pi-users text-[color:var(--bs-blue)]"></i> Your saved trades
        </h2>
        <p class="text-sm text-[color:var(--bs-muted)] mb-3">
          The tradespeople you recommend. Save them from their profile, then re-hire for a
          client in one tap. Inviting new ones to join is coming next.
        </p>
        <TrustedTradesPanel />
      </div>
      <div>
        <h2 class="font-semibold flex items-center gap-2 mb-1">
          <i class="pi pi-home text-[color:var(--bs-blue)]"></i> Properties
        </h2>
        <p class="text-sm text-[color:var(--bs-muted)] mb-3">
          The addresses you manage. Projects and jobs are organized by property.
        </p>
        <PropertiesPanel />
      </div>

      <div>
        <h2 class="font-semibold flex items-center gap-2 mb-1">
          <i class="pi pi-folder-open text-[color:var(--bs-blue)]"></i> Projects
        </h2>
        <p class="text-sm text-[color:var(--bs-muted)] mb-3">
          Set up jobs for a client and send them to your preferred contractors for quotes.
        </p>
        <ProjectsPanel />
      </div>
      <div>
        <h2 class="font-semibold flex items-center gap-2 mb-1">
          <i class="pi pi-dollar text-[color:var(--bs-blue)]"></i> Earnings
        </h2>
        <p class="text-sm text-[color:var(--bs-muted)] mb-3">
          Your referral commission accrues as your trades get paid. Set up payouts to get paid.
        </p>
        <PmEarningsPanel />
      </div>
    </div>
  </section>
</template>
