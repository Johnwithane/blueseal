<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import Button from "primevue/button";
import Message from "primevue/message";
import Rating from "primevue/rating";
import { useAuthStore } from "@/stores/auth";
import { useToast } from "@/composables/useToast";
import { useFormatters } from "@/composables/useFormatters";
import { humanizeError } from "@/utils/errors";
import {
  disconnectGoogleBusiness,
  startGoogleBusinessConnect,
  subscribeGoogleReviews,
  syncGoogleReviews,
} from "@/firebase/services/googleBusiness";
import type { GoogleReviewsSnapshot } from "@/firebase/interfaces";

// Opt-in "Connect Google Business" panel, rendered inside the AccountView
// Tradesperson accordion. Lets a verified tradesperson connect their Google
// Business Profile so their Google reviews show on their public Blue Seal
// profile (in a separate, attributed section — they never merge into the native
// Blue Seal rating). Mirrors PayoutsPanel: self-contained, subscribes to its
// slice of the tradesperson doc, full-page nav out for the OAuth handoff.
const auth = useAuthStore();
const toast = useToast();
const { relativeTime } = useFormatters();

const snapshot = ref<GoogleReviewsSnapshot | null>(null);
const loading = ref(true);
const busy = ref<null | "connect" | "sync" | "disconnect">(null);
let unsub: (() => void) | null = null;

const connected = computed(() => snapshot.value?.connected === true);

// The OAuth round-trip toast + ?google= param cleanup are handled by the host
// view (AccountView), which always mounts — this panel may be collapsed inside
// an accordion when Google redirects back. Mirrors PayoutsOnboardingView, where
// the view (not the panel) owns the redirect-return UX.
onMounted(() => {
  if (auth.fbUser) {
    unsub = subscribeGoogleReviews(auth.fbUser.uid, (s) => {
      snapshot.value = s;
      loading.value = false;
    });
  } else {
    loading.value = false;
  }
});

onBeforeUnmount(() => unsub?.());

async function connect() {
  busy.value = "connect";
  try {
    const { url } = await startGoogleBusinessConnect();
    // Full-page nav — Google's consent screen is off-app, like Stripe onboarding.
    window.location.assign(url);
  } catch (err) {
    toast.error(humanizeError(err));
    busy.value = null;
  }
}

async function sync() {
  busy.value = "sync";
  try {
    await syncGoogleReviews();
    toast.success("Reviews refreshed from Google");
  } catch (err) {
    toast.error(humanizeError(err));
  } finally {
    busy.value = null;
  }
}

async function disconnect() {
  busy.value = "disconnect";
  try {
    await disconnectGoogleBusiness();
    toast.success("Google Business disconnected");
  } catch (err) {
    toast.error(humanizeError(err));
  } finally {
    busy.value = null;
  }
}
</script>

<template>
  <div v-if="loading" class="flex items-center gap-2 pt-3 text-sm text-[color:var(--bs-muted)]">
    <i class="pi pi-spin pi-spinner"></i>
    Loading…
  </div>

  <div v-else class="space-y-4 pt-3">
    <p class="text-sm text-[color:var(--bs-muted)]">
      Connect your Google Business Profile to show your Google reviews on your
      Blue Seal profile. They appear in their own section — your Blue Seal rating
      and your Google rating stay separate.
    </p>

    <!-- NOT CONNECTED -->
    <div
      v-if="!connected"
      class="rounded-lg border border-[color:var(--bs-border)] bg-[color:var(--bs-surface-alt,#f9fafb)] p-4"
    >
      <div class="flex items-start gap-3">
        <i class="pi pi-google text-xl text-[color:var(--bs-blue)] mt-0.5" aria-hidden="true"></i>
        <div class="flex-1 min-w-0">
          <h4 class="m-0 text-sm font-semibold">Connect Google Business</h4>
          <p class="mt-1 text-xs text-[color:var(--bs-muted)]">
            You'll sign in with the Google account that manages your business
            listing and grant read access to your reviews. You can disconnect
            anytime.
          </p>
          <div class="mt-3">
            <Button
              label="Connect Google Business"
              icon="pi pi-external-link"
              :loading="busy === 'connect'"
              @click="connect"
            />
          </div>
        </div>
      </div>
    </div>

    <!-- CONNECTED -->
    <div v-else class="space-y-3">
      <div class="rounded-lg border border-[color:var(--bs-border)] p-4">
        <div class="flex items-start gap-3">
          <i class="pi pi-check-circle text-xl text-[color:var(--bs-blue)] mt-0.5" aria-hidden="true"></i>
          <div class="flex-1 min-w-0">
            <h4 class="m-0 text-sm font-semibold">
              Connected{{ snapshot?.locationName ? ` — ${snapshot.locationName}` : "" }}
            </h4>
            <div
              v-if="snapshot?.rating != null"
              class="mt-1 flex items-center gap-2 text-sm"
            >
              <Rating :model-value="Math.round(snapshot.rating)" readonly :cancel="false" />
              <span class="font-medium tabular-nums">{{ snapshot.rating.toFixed(1) }}</span>
              <span class="text-[color:var(--bs-muted)]">
                · {{ snapshot.reviewCount }} review{{ snapshot.reviewCount === 1 ? "" : "s" }}
              </span>
            </div>
            <p v-else class="mt-1 text-xs text-[color:var(--bs-muted)]">
              No Google reviews found yet — they'll show here once you have some.
            </p>
            <p
              v-if="snapshot?.lastSyncedAt"
              class="mt-1 text-xs text-[color:var(--bs-muted)]"
            >
              Last refreshed {{ relativeTime(snapshot.lastSyncedAt) }}
            </p>
          </div>
        </div>

        <Message
          v-if="snapshot?.syncError"
          severity="warn"
          :closable="false"
          class="mt-3"
        >
          We couldn't refresh from Google last time. Try "Sync now" — if it keeps
          failing, disconnect and reconnect.
        </Message>

        <div class="mt-4 flex flex-wrap gap-2">
          <Button
            label="Sync now"
            icon="pi pi-refresh"
            outlined
            size="small"
            :loading="busy === 'sync'"
            @click="sync"
          />
          <Button
            label="Disconnect"
            icon="pi pi-times"
            severity="danger"
            text
            size="small"
            :loading="busy === 'disconnect'"
            @click="disconnect"
          />
        </div>
      </div>
    </div>
  </div>
</template>
