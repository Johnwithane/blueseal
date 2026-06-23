<script setup lang="ts">
// Presentational full-profile body for a seeded prospect. Rendered by
// TradieProfileView at /tradies/:id when the id resolves to a prospect (not a
// real tradesperson) — so prospects get the SAME profile URL + shell as real
// tradies, just flagged "Unclaimed" with no trust UI (no rating, reviews,
// portfolio, availability, or verified badges — a seeded listing has none of
// that, and showing anything verified-looking would misrepresent them).
import { computed, ref } from "vue";
import { RouterLink } from "vue-router";
import Button from "primevue/button";
import Tag from "primevue/tag";
import Avatar from "primevue/avatar";
import Dialog from "primevue/dialog";
import Textarea from "primevue/textarea";
import type { ProspectDoc, WithId } from "@/firebase/interfaces";
import { tradeLabel } from "@/data/trades";
import { useFormatters } from "@/composables/useFormatters";
import { useAuthStore } from "@/stores/auth";
import { selfServeRemoveProspect } from "@/firebase/services/prospects";

const props = defineProps<{ prospect: WithId<ProspectDoc> }>();
const { money } = useFormatters();
const auth = useAuthStore();

// Self-serve takedown ("Not you? Remove this listing"). This listing was created
// from public business info WITHOUT the owner's consent, so anyone who finds
// their own listing can take it down here — no account, no email link. Errs
// toward removal; the server hides it immediately and never re-imports it.
const showRemove = ref(false);
const removing = ref(false);
const removed = ref(false);
const removeReason = ref("");
const removeError = ref("");

async function confirmRemove() {
  removing.value = true;
  removeError.value = "";
  try {
    await selfServeRemoveProspect(props.prospect.id, removeReason.value.trim() || undefined);
    removed.value = true;
    showRemove.value = false;
  } catch {
    removeError.value = "Couldn't remove the listing just now. Please try again, or email support.";
  } finally {
    removing.value = false;
  }
}

const displayName = computed(() => props.prospect.displayName?.trim() || "");
const avatarInitial = computed(() => {
  const source = displayName.value || tradeLabel(props.prospect.trades[0] ?? "");
  return source.slice(0, 1).toUpperCase() || "?";
});
const tradesWithYears = computed(() =>
  props.prospect.trades.map((key) => ({
    key,
    label: tradeLabel(key),
    years: props.prospect.yearsExperience?.[key] ?? null,
  })),
);
// Free-text services offered. Neutral styling (no "verified" green check) — a
// seeded listing is unclaimed, so nothing here should read as trust-verified.
const services = computed(() => props.prospect.services?.filter((s) => s?.trim()) ?? []);
</script>

<template>
  <section class="bs-container py-6">
    <!-- Removed state — shown after a successful self-serve takedown. -->
    <div
      v-if="removed"
      class="mb-4 flex items-start gap-3 rounded-lg border border-[color:var(--bs-success)] bg-[color:var(--bs-success-tint)] p-3"
    >
      <i class="pi pi-check-circle text-lg mt-0.5 text-[color:var(--bs-success)]" aria-hidden="true"></i>
      <div class="text-sm">
        <div class="font-semibold text-[color:var(--bs-success-text)]">Listing removed</div>
        <p class="text-[color:var(--bs-success-text)]">
          This listing has been taken down and won't be re-added. If this was a mistake, email support.
        </p>
      </div>
    </div>

    <!-- Status banner. Shown until removed — this profile isn't verified yet. -->
    <div
      v-else
      class="mb-4 flex items-start gap-3 rounded-lg border border-[color:var(--bs-warning)] bg-[color:var(--bs-warning-tint)] p-3"
    >
      <i class="pi pi-info-circle text-lg mt-0.5 text-[color:var(--bs-warning)]" aria-hidden="true"></i>
      <div class="flex-1 text-sm">
        <div class="font-semibold text-[color:var(--bs-warning-text)]">Unclaimed listing</div>
        <p class="text-[color:var(--bs-warning-text)]">
          Blue Seal created this listing from public business information. This business
          hasn't joined or been verified yet.
        </p>
        <button
          type="button"
          class="mt-1 text-xs text-[color:var(--bs-warning-text)] underline hover:text-[color:var(--bs-warning-text)]"
          @click="showRemove = true"
        >
          Not you? Remove this listing
        </button>
      </div>
    </div>

    <header class="bs-card p-5">
      <div class="flex flex-col gap-4 sm:flex-row sm:items-start">
        <!-- Logo fit-to-circle: `contain` so non-square logos aren't stretched. -->
        <div
          v-if="prospect.photoURL"
          class="prospect-logo prospect-logo--xl"
          role="img"
          :aria-label="prospect.displayName"
          :style="{ backgroundImage: `url('${prospect.photoURL}')` }"
        ></div>
        <Avatar
          v-else
          :label="avatarInitial"
          size="xlarge"
          shape="circle"
          style="background-color: var(--bs-muted); color: white; font-weight: 700;"
        />
        <div class="flex-1 min-w-0">
          <div class="flex flex-wrap items-center gap-2">
            <h1 class="text-2xl font-bold">
              {{ displayName || tradeLabel(prospect.trades[0]) }}
            </h1>
            <Tag value="Unclaimed" severity="warn" />
          </div>
          <div v-if="prospect.companyName" class="text-sm text-[color:var(--bs-muted)]">
            {{ prospect.companyName }}
          </div>
          <div class="mt-1 text-sm text-[color:var(--bs-muted)]">
            {{ tradesWithYears.map((t) => t.label).join(" · ") }}
          </div>
          <div class="mt-1 text-sm text-[color:var(--bs-muted)]">
            <span v-if="prospect.locationLabel">
              <i class="pi pi-map-marker text-xs"></i> {{ prospect.locationLabel }}
            </span>
            <span v-if="prospect.serviceRadiusKm">
              • {{ prospect.serviceRadiusKm }} km radius</span>
          </div>
          <div v-if="tradesWithYears.length" class="mt-2 flex flex-wrap items-center gap-1">
            <span v-for="t in tradesWithYears" :key="t.key" class="bs-pill">
              {{ t.label }}
              <span v-if="t.years" class="opacity-75">· {{ t.years }}y</span>
            </span>
          </div>
          <div
            v-if="prospect.languages && prospect.languages.length"
            class="mt-2 text-xs text-[color:var(--bs-muted)]"
          >
            <i class="pi pi-comments mr-1"></i>
            Speaks {{ prospect.languages.join(", ") }}
          </div>
        </div>
        <div v-if="!removed" class="flex flex-col items-stretch gap-1">
          <RouterLink
            v-if="auth.isAuthenticated && auth.hasClientRole"
            :to="{ name: 'RequestProspect', params: { id: prospect.id } }"
          >
            <Button label="Request this pro" icon="pi pi-send" class="w-full" />
          </RouterLink>
          <RouterLink v-else-if="!auth.isAuthenticated" :to="{ name: 'SignUp' }">
            <Button label="Sign up to contact" icon="pi pi-user-plus" class="w-full" />
          </RouterLink>
        </div>
      </div>
    </header>

    <section
      v-if="prospect.bio || prospect.hourlyRate != null || prospect.website"
      class="bs-card p-5 mt-4 space-y-3"
    >
      <h2 class="font-semibold">About</h2>
      <p v-if="prospect.bio" class="text-sm whitespace-pre-wrap">{{ prospect.bio }}</p>
      <div class="text-sm text-[color:var(--bs-muted)]">
        Pricing:
        <strong class="text-[color:var(--bs-text)]">
          {{ prospect.hourlyRate ? money(prospect.hourlyRate) + "/hr" : "Quote on request" }}
        </strong>
      </div>
      <div v-if="prospect.website" class="text-sm">
        <a
          :href="prospect.website"
          target="_blank"
          rel="noopener noreferrer nofollow"
          class="text-[color:var(--bs-blue)] hover:underline"
        >
          <i class="pi pi-external-link mr-1"></i>Visit website
        </a>
      </div>
    </section>

    <section v-if="services.length" class="bs-card p-5 mt-4">
      <h2 class="font-semibold mb-3">Services offered</h2>
      <ul class="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <li
          v-for="(s, i) in services"
          :key="i"
          class="flex items-start gap-2 rounded-md border border-[color:var(--bs-border)] bg-[color:var(--bs-surface-alt)] px-3 py-2 text-sm font-medium"
        >
          <i class="pi pi-wrench text-[color:var(--bs-muted)] mt-0.5" aria-hidden="true"></i>
          <span>{{ s }}</span>
        </li>
      </ul>
    </section>

    <section
      v-if="prospect.portfolioPhotos && prospect.portfolioPhotos.length"
      class="bs-card p-5 mt-4"
    >
      <h2 class="font-semibold mb-3">Recent work</h2>
      <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
        <img
          v-for="(url, i) in prospect.portfolioPhotos"
          :key="i"
          :src="url"
          :alt="`Work photo ${i + 1}`"
          class="aspect-square w-full rounded-md object-cover"
          loading="lazy"
        />
      </div>
    </section>

    <!-- Self-serve takedown confirmation dialog. -->
    <Dialog
      v-model:visible="showRemove"
      modal
      header="Remove this listing?"
      :style="{ width: '92vw', maxWidth: '440px' }"
      :dismissable-mask="true"
    >
      <div class="space-y-3 text-sm">
        <p>
          Blue Seal created this listing for
          <strong>{{ displayName || prospect.companyName || "this business" }}</strong>
          from public business information — it isn't a claimed account. If this is your business
          and you'd like it taken down, we'll remove it right away and won't re-add it.
        </p>
        <p class="text-[color:var(--bs-muted)]">
          You can always join Blue Seal later to set up a verified profile.
        </p>
        <div>
          <label for="removeReason" class="mb-1 block text-xs text-[color:var(--bs-muted)]">
            Anything you'd like us to know? (optional)
          </label>
          <Textarea
            id="removeReason"
            v-model="removeReason"
            rows="2"
            class="w-full"
            :maxlength="500"
            auto-resize
          />
        </div>
        <p v-if="removeError" class="text-xs text-[color:var(--bs-danger)]">{{ removeError }}</p>
      </div>
      <template #footer>
        <Button
          label="Cancel"
          text
          severity="secondary"
          :disabled="removing"
          @click="showRemove = false"
        />
        <Button
          label="Remove my listing"
          severity="danger"
          :loading="removing"
          @click="confirmRemove"
        />
      </template>
    </Dialog>
  </section>
</template>

<style scoped>
.prospect-logo {
  flex: none;
  border-radius: 9999px;
  background-color: #fff;
  background-size: contain;
  background-repeat: no-repeat;
  background-position: center;
  border: 1px solid var(--bs-border);
}
.prospect-logo--xl {
  width: 5rem;
  height: 5rem;
}
</style>
