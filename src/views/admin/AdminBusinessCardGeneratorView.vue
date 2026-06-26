<script setup lang="ts">
// Business Card Generator (admin tool). One generator, three card types:
//   • Tradesperson signup  → QR to /sign-up?as=tradesperson  (recruitment)
//   • Client               → QR to /search                   (find a pro)
//   • Tradesperson profile → QR to /tradies/:uid             (a specific pro)
// Two selectable themes (Cream / Navy). The card render + export lives in
// BusinessCardPreview.vue so the same component can later be surfaced to
// tradespeople for their own profile card.
import { computed, reactive, ref, watch } from "vue";
import { RouterLink } from "vue-router";
import Button from "primevue/button";
import InputText from "primevue/inputtext";
import Textarea from "primevue/textarea";
import SelectButton from "primevue/selectbutton";
import ToggleSwitch from "primevue/toggleswitch";
import Message from "primevue/message";
import AutoComplete from "primevue/autocomplete";
import BusinessCardPreview from "@/components/BusinessCardPreview.vue";
import {
  cardTargetUrl,
  cardVanityUrl,
  type CardContent,
  type CardTheme,
  type CardType,
} from "@/utils/businessCard";
import { businessCardConfigSchema } from "@/validation/businessCard";
import {
  getTradesperson,
  getTradespersonContact,
  searchVisibleTradiesByName,
} from "@/firebase/services/tradespeople";
import { getUser } from "@/firebase/services/users";
import type { TradespersonDoc, WithId } from "@/firebase/interfaces";
import { tradeLabel } from "@/data/trades";
import { useToast } from "@/composables/useToast";
import { humanizeError } from "@/utils/errors";

const toast = useToast();

const TYPE_OPTIONS: { label: string; value: CardType }[] = [
  { label: "Tradesperson signup", value: "tradesperson_signup" },
  { label: "Client", value: "client_search" },
  { label: "Tradesperson profile", value: "tradesperson_profile" },
];

const THEME_OPTIONS: { label: string; value: CardTheme }[] = [
  { label: "Cream", value: "cream" },
  { label: "Navy", value: "navy" },
];

// Per-type starting copy. Switching type re-applies these so the fields always
// match the selected card's intent. Headlines: "\n" = line break, "*word*" =
// highlighted (red box, cream text).
const DEFAULTS: Record<
  CardType,
  { headline: string; subcopy: string; qrCaption: string; ctaLabel: string }
> = {
  tradesperson_signup: {
    headline: "Get *verified*.\nGet hired.",
    subcopy: "Join Canada's network of vetted trades.",
    qrCaption: "Scan to apply",
    ctaLabel: "Apply now",
  },
  client_search: {
    headline: "Find a pro\nyou can *trust*.",
    subcopy: "Every pro is ID-checked and certified.",
    qrCaption: "Scan to find a pro",
    ctaLabel: "Hire with confidence",
  },
  tradesperson_profile: {
    headline: "",
    subcopy: "",
    qrCaption: "Scan to hire me",
    ctaLabel: "",
  },
  // PMs generate their own card from the cockpit (/manage/card); this entry only
  // satisfies the Record<CardType> type — the admin tool doesn't offer it.
  pm_profile: {
    headline: "",
    subcopy: "",
    qrCaption: "Scan to see my profile",
    ctaLabel: "",
  },
};

const form = reactive({
  type: "tradesperson_signup" as CardType,
  theme: "cream" as CardTheme,
  ...DEFAULTS.tradesperson_signup,
  campaign: "",
  includeBrandmark: true,
  profileUid: "",
  profileName: "",
  profileCompany: "",
  profileTrade: "",
  profileEmail: "",
  profilePhone: "",
  showEmail: true,
  showPhone: true,
  showPhoto: true,
});

watch(
  () => form.type,
  (t) => Object.assign(form, DEFAULTS[t]),
);

// --- Profile lookup --------------------------------------------------------
const profileLoading = ref(false);
const loadedPhotoUrl = ref<string | null>(null);
const loadedIsPro = ref(false);

// Name search (autocomplete) — the primary way to pick a tradesperson. Only
// verified/visible members are searchable (profile cards are a member feature).
const tradieQuery = ref<WithId<TradespersonDoc> | string>("");
const tradieMatches = ref<WithId<TradespersonDoc>[]>([]);

async function onTradieSearch(e: { query: string }): Promise<void> {
  try {
    tradieMatches.value = await searchVisibleTradiesByName(e.query, 8);
  } catch {
    tradieMatches.value = [];
  }
}

async function onTradieSelect(e: { value: WithId<TradespersonDoc> }): Promise<void> {
  await applyTradie(e.value);
  toast.success("Loaded", form.profileName);
}

/** Fill the form from a tradesperson doc, then pull phone + email on file. */
async function applyTradie(t: WithId<TradespersonDoc>): Promise<void> {
  form.profileUid = t.id;
  form.profileName = t.displayName?.trim() || "Blue Seal tradesperson";
  form.profileCompany = t.companyName ?? "";
  form.profileTrade = t.trades.map(tradeLabel).filter(Boolean).slice(0, 2).join(" · ");
  loadedPhotoUrl.value = t.photoURL ?? null;
  loadedIsPro.value = !!t.isPro;
  // Best-effort: phone from the private contact subdoc, email from the user doc.
  const [user, contact] = await Promise.all([
    getUser(t.id).catch(() => null),
    getTradespersonContact(t.id).catch(() => null),
  ]);
  form.profileEmail = user?.email ?? "";
  form.profilePhone = contact?.businessPhone ?? user?.phone ?? "";
}

// Fallback: load by UID or a pasted profile URL (for non-searchable members).
const manualUid = ref("");
function extractUid(input: string): string {
  const s = input.trim();
  const m = s.match(/tradies\/([^/?#]+)/);
  return (m ? m[1] : s).trim();
}
async function loadProfile(): Promise<void> {
  const uid = extractUid(manualUid.value);
  if (!uid) {
    toast.warn("Enter an ID", "Paste a tradesperson UID or their profile URL.");
    return;
  }
  profileLoading.value = true;
  try {
    const t = await getTradesperson(uid);
    if (!t) {
      toast.error("Not found", "No verified tradesperson matches that ID — try the search above.");
      return;
    }
    await applyTradie(t);
    toast.success("Loaded", form.profileName);
  } catch (e) {
    toast.error("Couldn't load", humanizeError(e));
  } finally {
    profileLoading.value = false;
  }
}

// --- Derived render inputs -------------------------------------------------
const isProfile = computed(() => form.type === "tradesperson_profile");
const previewReady = computed(() => !isProfile.value || !!form.profileUid);

const campaignError = computed(() => {
  const r = businessCardConfigSchema.shape.campaign.safeParse(form.campaign);
  return r.success ? null : (r.error.issues[0]?.message ?? "Invalid campaign tag");
});

const target = computed(() =>
  cardTargetUrl(form.type, { uid: form.profileUid, campaign: form.campaign }),
);

const content = computed<CardContent>(() => ({
  type: form.type,
  theme: form.theme,
  headline: form.headline,
  subcopy: form.subcopy,
  qrCaption: form.qrCaption,
  ctaLabel: isProfile.value ? undefined : form.ctaLabel,
  ctaUrl: isProfile.value ? undefined : cardVanityUrl(form.type),
  profile: isProfile.value
    ? {
        name: form.profileName || "Blue Seal tradesperson",
        company: form.profileCompany || undefined,
        trade: form.profileTrade || undefined,
        email: form.showEmail && form.profileEmail ? form.profileEmail : undefined,
        phone: form.showPhone && form.profilePhone ? form.profilePhone : undefined,
        isPro: loadedIsPro.value,
      }
    : undefined,
}));

const vanityUrl = computed(() => cardVanityUrl(form.type));

const photoUrl = computed(() =>
  isProfile.value && form.showPhoto ? loadedPhotoUrl.value : null,
);

const fileBaseName = computed(() => {
  const suffix = isProfile.value && form.profileUid ? `-${form.profileUid.slice(0, 8)}` : "";
  return `blueseal-card-${form.type}-${form.theme}${suffix}`;
});
</script>

<template>
  <section class="bs-container py-8 max-w-5xl">
    <RouterLink to="/dashboard/admin" class="text-xs text-[color:var(--bs-muted)]">
      ← Admin console
    </RouterLink>

    <header class="mt-2 mb-6">
      <h1 class="font-[family-name:var(--bs-font-display)] text-2xl font-bold">
        Business card generator
      </h1>
      <p class="mt-1 text-sm text-[color:var(--bs-muted)]">
        Generate a clean two-sided card with a scannable QR code. Pick a type and
        theme, tweak the copy, then download a print-ready 2-sided PDF (3.5 × 2 in
        with bleed) or PNGs for digital use.
      </p>
    </header>

    <div class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,460px)]">
      <!-- ============ Controls ============ -->
      <div class="space-y-5">
        <div class="bs-card p-4 space-y-4">
          <div>
            <label class="mb-1 block text-sm font-semibold">Card type</label>
            <SelectButton
              v-model="form.type"
              :options="TYPE_OPTIONS"
              option-label="label"
              option-value="value"
              :allow-empty="false"
            />
          </div>
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
        </div>

        <!-- Profile picker (profile cards only) -->
        <div v-if="isProfile" class="bs-card p-4 space-y-3">
          <label class="block text-sm font-semibold">Tradesperson</label>
          <p class="text-xs text-[color:var(--bs-muted)]">
            Search by name to auto-fill their details, photo, email and phone.
            Only verified members are searchable.
          </p>
          <AutoComplete
            v-model="tradieQuery"
            :suggestions="tradieMatches"
            option-label="displayName"
            placeholder="Search tradespeople by name…"
            :delay="250"
            complete-on-focus
            class="w-full"
            input-class="w-full"
            @complete="onTradieSearch"
            @item-select="onTradieSelect"
          >
            <template #option="{ option }">
              <div class="flex flex-col">
                <span class="font-medium">{{ option.displayName || "Unnamed" }}</span>
                <span class="text-xs text-[color:var(--bs-muted)]">
                  {{
                    option.companyName ||
                    option.trades.map(tradeLabel).filter(Boolean).slice(0, 2).join(" · ") ||
                    "Tradesperson"
                  }}
                </span>
              </div>
            </template>
          </AutoComplete>
          <details class="text-xs text-[color:var(--bs-muted)]">
            <summary class="cursor-pointer select-none">Or load by UID / profile URL</summary>
            <div class="mt-2 flex gap-2">
              <InputText
                v-model="manualUid"
                placeholder="UID or blueseal.app/tradies/…"
                class="flex-1"
                @keyup.enter="loadProfile"
              />
              <Button label="Load" icon="pi pi-search" :loading="profileLoading" @click="loadProfile" />
            </div>
          </details>

          <div v-if="form.profileUid" class="grid gap-2 sm:grid-cols-2">
            <InputText v-model="form.profileName" placeholder="Name" maxlength="60" />
            <InputText v-model="form.profileCompany" placeholder="Business (optional)" maxlength="60" />
            <InputText
              v-model="form.profileTrade"
              placeholder="Trade (e.g. Electrician)"
              maxlength="48"
              class="sm:col-span-2"
            />
            <InputText v-model="form.profileEmail" placeholder="Email" maxlength="80" />
            <InputText v-model="form.profilePhone" placeholder="Phone" maxlength="32" />
          </div>
          <div v-if="form.profileUid" class="flex flex-wrap gap-x-5 gap-y-2 pt-1">
            <span class="flex items-center gap-2">
              <ToggleSwitch v-model="form.showPhoto" input-id="show-photo" />
              <label for="show-photo" class="text-sm">Photo</label>
            </span>
            <span class="flex items-center gap-2">
              <ToggleSwitch v-model="form.showEmail" input-id="show-email" />
              <label for="show-email" class="text-sm">Email</label>
            </span>
            <span class="flex items-center gap-2">
              <ToggleSwitch v-model="form.showPhone" input-id="show-phone" />
              <label for="show-phone" class="text-sm">Phone</label>
            </span>
          </div>
        </div>

        <!-- Message copy (signup + client cards) -->
        <div v-else class="bs-card p-4 space-y-3">
          <label class="block text-sm font-semibold">Card copy</label>
          <Textarea
            v-model="form.headline"
            placeholder="Headline"
            maxlength="60"
            rows="2"
            auto-resize
            class="w-full"
          />
          <p class="text-xs text-[color:var(--bs-muted)]">
            New line = line break. Wrap a word in *asterisks* to highlight it
            (red box, cream text).
          </p>
          <Textarea
            v-model="form.subcopy"
            placeholder="Sub-copy"
            maxlength="160"
            rows="2"
            auto-resize
            class="w-full"
          />
          <InputText
            v-model="form.ctaLabel"
            placeholder="CTA label (e.g. Free to apply)"
            maxlength="40"
            class="w-full"
          />
          <p class="text-xs text-[color:var(--bs-muted)]">
            Shows on the card with <strong>{{ vanityUrl }}</strong> to its right
            (which redirects to the {{ form.type === "client_search" ? "search" : "signup" }} page).
          </p>
        </div>

        <!-- Shared options -->
        <div class="bs-card p-4 space-y-3">
          <div>
            <label class="mb-1 block text-sm font-semibold">QR caption</label>
            <InputText v-model="form.qrCaption" maxlength="28" class="w-full" />
          </div>
          <div>
            <label class="mb-1 block text-sm font-semibold">Campaign tag (UTM)</label>
            <InputText v-model="form.campaign" placeholder="e.g. spring_drive" maxlength="60" class="w-full" />
            <p v-if="campaignError" class="mt-1 text-xs text-[color:var(--bs-danger)]">
              {{ campaignError }}
            </p>
            <p v-else class="mt-1 text-xs text-[color:var(--bs-muted)]">
              Tags the QR link so scans show up in analytics. Defaults per type
              if left blank.
            </p>
          </div>
          <div class="flex items-center gap-3">
            <ToggleSwitch v-model="form.includeBrandmark" input-id="brandmark-toggle" />
            <label for="brandmark-toggle" class="text-sm">Brandmark in QR centre</label>
          </div>
        </div>
      </div>

      <!-- ============ Preview + export ============ -->
      <div class="lg:sticky lg:top-6 self-start space-y-4">
        <BusinessCardPreview
          v-if="previewReady"
          :content="content"
          :target-url="target.url"
          :include-brandmark="form.includeBrandmark"
          :file-base-name="fileBaseName"
          :photo-url="photoUrl"
        />
        <div v-else class="bs-empty">
          <i class="pi pi-id-card text-3xl mb-2 block text-[color:var(--bs-muted)]"></i>
          <p>Load a tradesperson to preview their profile card.</p>
        </div>
      </div>
    </div>

    <!-- ============ Print & fulfillment ============ -->
    <Message severity="info" :closable="false" class="mt-8">
      <div class="text-sm">
        <strong>Getting these printed &amp; mailed.</strong>
        The PDF is a 2-sided, full-bleed proof. For the annual-member gift run,
        see <code>docs/BUSINESS_CARD_PRINT.md</code> in the repo — it covers the
        cheapest/fastest print options and an automated mail path (PostGrid,
        Canadian) for sending cards to the first 500 annual members' addresses.
      </div>
    </Message>
  </section>
</template>
