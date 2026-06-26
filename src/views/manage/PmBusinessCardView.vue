<script setup lang="ts">
// PM self-serve business card: a print-ready card a project manager hands to a
// client. The QR opens their public profile (/pm/<slug>, canonical
// /project-managers/<uid> fallback), which shows their brand + the trades they
// recommend. Reuses the BusinessCardPreview renderer/exporter unchanged — this
// view just resolves a `pm_profile` CardContent from the PM's own profile.
import { computed, onMounted, onUnmounted, reactive, ref } from "vue";
import { RouterLink } from "vue-router";
import SelectButton from "primevue/selectbutton";
import InputText from "primevue/inputtext";
import ToggleSwitch from "primevue/toggleswitch";
import Message from "primevue/message";
import { useAuthStore } from "@/stores/auth";
import { useSeo } from "@/composables/useSeo";
import { subscribePmProfile } from "@/firebase/services/pmProfile";
import BusinessCardPreview from "@/components/BusinessCardPreview.vue";
import { cardTargetUrl, type CardContent, type CardTheme } from "@/utils/businessCard";
import { tradeLabel } from "@/data/trades";
import type { ProjectManagerProfileDoc, WithId } from "@/firebase/interfaces";

useSeo({ title: "Business card", noindex: true });

const auth = useAuthStore();

const profile = ref<WithId<ProjectManagerProfileDoc> | null>(null);
const loaded = ref(false);
let unsub: (() => void) | null = null;
onMounted(() => {
  const uid = auth.fbUser?.uid;
  if (!uid) {
    loaded.value = true;
    return;
  }
  unsub = subscribePmProfile(uid, (p) => {
    profile.value = p;
    loaded.value = true;
  });
});
onUnmounted(() => unsub?.());

const THEME_OPTIONS: { label: string; value: CardTheme }[] = [
  { label: "Cream", value: "cream" },
  { label: "Navy", value: "navy" },
];

const form = reactive({
  theme: "cream" as CardTheme,
  qrCaption: "Scan to see my profile",
  phone: "",
  showPhoto: true,
  showEmail: true,
});

const pmName = computed(
  () => profile.value?.displayName?.trim() || auth.user?.displayName?.trim() || "Project manager",
);
const company = computed(() => profile.value?.companyName?.trim() || "");

// The accent line on the card = the distinct trades the PM recommends (from their
// featured contractors), so the card hints at "+ my trusted trades". Null when
// nothing is featured yet, so we suppress the line rather than print a fake trade.
const featuredTrades = computed(() => {
  const keys = new Set((profile.value?.featuredContractors ?? []).flatMap((c) => c.trades ?? []));
  const labels = [...keys].map((k) => tradeLabel(k)).filter(Boolean);
  return labels.length ? labels.slice(0, 3).join(" · ") : null;
});

const photoUrl = computed(() =>
  form.showPhoto
    ? (auth.user?.photoURL ?? profile.value?.photoURL ?? profile.value?.companyLogoUrl ?? null)
    : null,
);

const target = computed(() =>
  cardTargetUrl("pm_profile", {
    uid: auth.fbUser?.uid ?? "",
    slug: profile.value?.slug ?? undefined,
  }),
);

const content = computed<CardContent>(() => ({
  type: "pm_profile",
  theme: form.theme,
  headline: "",
  subcopy: "",
  qrCaption: form.qrCaption.trim() || "Scan to see my profile",
  profile: {
    name: pmName.value,
    company: company.value || undefined,
    trade: featuredTrades.value ?? undefined,
    email: form.showEmail && auth.user?.email ? auth.user.email : undefined,
    phone: form.phone.trim() || undefined,
    badgeLabel: "Project manager on Blue Seal",
  },
}));

const fileBaseName = computed(() => `blueseal-pm-card-${form.theme}`);

const hasProfile = computed(() => !!profile.value);
const published = computed(() => !!profile.value?.isVisible);
const hasSlug = computed(() => !!profile.value?.slug);
// Don't let a PM print a card whose QR dead-ends: downloads are gated until the
// public profile is published (a slug is optional — the canonical URL works).
const canExport = computed(() => hasProfile.value && published.value);
</script>

<template>
  <section class="bs-container py-8 max-w-5xl">
    <RouterLink to="/manage" class="text-xs text-[color:var(--bs-muted)]">
      <i class="pi pi-arrow-left text-xs"></i> Cockpit
    </RouterLink>

    <header class="mt-2 mb-6">
      <h1 class="text-2xl font-bold">Your business card</h1>
      <p class="mt-1 text-sm text-[color:var(--bs-muted)]">
        A print-ready card to hand your clients. The QR opens your public profile, where they see
        your brand and the trades you recommend. Download a 2-sided PDF or PNGs.
      </p>
    </header>

    <!-- The QR only works for clients once the public profile is published. -->
    <Message v-if="loaded && !hasProfile" severity="warn" :closable="false" class="mb-5">
      Set up your public profile first so the card's QR has somewhere to go.
      <RouterLink to="/manage/profile" class="font-medium underline">Set up my profile →</RouterLink>
    </Message>
    <Message v-else-if="loaded && !published" severity="warn" :closable="false" class="mb-5">
      Your profile isn't published yet, so the card's QR wouldn't work for a client. Downloads stay
      locked until you publish it.
      <RouterLink to="/manage/profile" class="font-medium underline">Publish my profile →</RouterLink>
    </Message>
    <Message v-else-if="loaded && !hasSlug" severity="info" :closable="false" class="mb-5">
      Tip: claim a <strong>/pm/</strong> handle on your profile for a cleaner link on the QR.
      <RouterLink to="/manage/profile" class="font-medium underline">Claim a handle →</RouterLink>
    </Message>

    <div class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,460px)]">
      <!-- Controls -->
      <div class="space-y-5">
        <div class="bs-card p-4 space-y-4">
          <div>
            <label class="mb-1 block text-sm font-semibold">Theme</label>
            <SelectButton
              v-model="form.theme"
              :options="THEME_OPTIONS"
              option-label="label"
              option-value="value"
              :allow-empty="false"
            />
          </div>
          <div>
            <label class="mb-1 block text-sm font-semibold">Scan caption</label>
            <InputText v-model="form.qrCaption" maxlength="28" class="w-full" />
          </div>
          <div>
            <label class="mb-1 block text-sm font-semibold">
              Phone <span class="font-normal text-[color:var(--bs-muted)]">(optional)</span>
            </label>
            <InputText v-model="form.phone" maxlength="32" class="w-full" placeholder="e.g. (250) 555-0142" />
          </div>
          <div class="flex flex-wrap gap-x-5 gap-y-2 pt-1">
            <span class="flex items-center gap-2">
              <ToggleSwitch v-model="form.showPhoto" input-id="pm-card-photo" />
              <label for="pm-card-photo" class="text-sm">Photo</label>
            </span>
            <span class="flex items-center gap-2">
              <ToggleSwitch v-model="form.showEmail" input-id="pm-card-email" />
              <label for="pm-card-email" class="text-sm">Email</label>
            </span>
          </div>
          <p v-if="featuredTrades" class="text-xs text-[color:var(--bs-muted)]">
            The card shows your name{{ company ? ", brand" : "" }} and the trades you recommend
            (<strong>{{ featuredTrades }}</strong>). Manage these by featuring trades on your
            <RouterLink to="/manage/profile" class="underline">public profile</RouterLink>.
          </p>
          <p v-else class="text-xs text-[color:var(--bs-muted)]">
            Feature trades on your
            <RouterLink to="/manage/profile" class="underline">public profile</RouterLink> and
            they'll appear on the card. Until then it shows your name{{ company ? " and brand" : "" }}.
          </p>
        </div>
      </div>

      <!-- Preview + export -->
      <div class="lg:sticky lg:top-6 self-start">
        <BusinessCardPreview
          :content="content"
          :target-url="target.url"
          :include-brandmark="true"
          :file-base-name="fileBaseName"
          :photo-url="photoUrl"
          :can-export="canExport"
          export-hint="Publish your public profile to download (so the QR works when a client scans it)."
        />
      </div>
    </div>
  </section>
</template>
