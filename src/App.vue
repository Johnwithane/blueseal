<script setup lang="ts">
import { computed, onMounted, watch } from "vue";
import { RouterView, useRoute, useRouter } from "vue-router";
import Toast from "primevue/toast";
import { useToast as primeUseToast } from "primevue/usetoast";
import ConfirmDialog from "primevue/confirmdialog";
import AppHeader from "@/components/AppHeader.vue";
import AppFooter from "@/components/AppFooter.vue";
import TradieStatusBanner from "@/components/TradieStatusBanner.vue";
import AssistantBubble from "@/components/assistant/AssistantBubble.vue";
import ReportBugButton from "@/components/qa/ReportBugButton.vue";
import PaywallDialog from "@/components/PaywallDialog.vue";
import InsuranceReminderDialog from "@/components/InsuranceReminderDialog.vue";
import RoleSwitchOverlay from "@/components/RoleSwitchOverlay.vue";
import AppUpdatePrompt from "@/components/AppUpdatePrompt.vue";
import AppShell from "@/components/shell/AppShell.vue";
import ActiveClockBanner from "@/components/ActiveClockBanner.vue";
import VerifyEmailBanner from "@/components/VerifyEmailBanner.vue";
import { useNotificationsStore } from "@/stores/notifications";
import { useSubscriptionStore } from "@/stores/subscription";
import { useAuthStore } from "@/stores/auth";
import { useAppUpdate, usePushAutoPrompt } from "@/composables";

const route = useRoute();
const router = useRouter();
const notifs = useNotificationsStore();
const subscription = useSubscriptionStore();
const auth = useAuthStore();
const primeToast = primeUseToast();

// Keep installed/mobile PWAs on the latest deploy without a manual hard-refresh:
// polls /version.json (on resume + periodically) and surfaces a one-tap update
// banner the moment the served build differs from the running one. See
// useAppUpdate.
useAppUpdate();
// Push is essential (job requests / quotes / messages are time-critical), so
// every signed-in session — signup, sign-in, returning — gets the soft-ask
// until this device has push on. Re-offers are cooldown-limited and the
// native browser prompt still only fires from the dialog's "Enable" click.
usePushAutoPrompt();
// `meta.layout` decides which shell wraps the route. Unset → "public" (the
// marketing AppHeader/Footer chrome). "app" mounts the Instagram-style
// AppShell; "chromeless" renders the view alone (onboarding wizard).
// "hybrid" resolves to "app" for signed-in users and "public" for visitors —
// so crossover routes (search, post-a-job, public profiles) keep a signed-in
// user inside their shell instead of ejecting them to the marketing chrome.
const layout = computed<"public" | "app" | "chromeless">(() => {
  const declared =
    (route.meta.layout as "public" | "app" | "chromeless" | "hybrid" | undefined) ?? "public";
  if (declared === "hybrid") return auth.isAuthenticated ? "app" : "public";
  return declared;
});

// Start the notifications subscription as soon as the app mounts. The store
// itself watches auth.fbUser.uid so it survives sign-in/out without us having
// to re-init. Both AppHeader (public chrome) and the AppShell's
// NotificationsButton consume the same store.
onMounted(() => {
  notifs.init();
  subscription.init();
});

// Live toast surface for newly-arrived notifications. The bell already shows
// a badge + popover, but a transient top-of-screen toast is the only way the
// user notices a notification while they're focused elsewhere in the app.
//
// Strategy: on the FIRST snapshot of a given signed-in session, treat every
// item as already seen (the inbox is just being rehydrated — not new). After
// that, any id we haven't seen before fires a toast, provided the doc is
// unread and was created in the last 60s (freshness check guards against
// snapshot-listener replays from offline cache / re-subscription bringing in
// older docs the user already knows about).
//
// Resetting on uid change handles sign-out → sign-in-as-different-user: each
// account starts a fresh "seed then toast" cycle.
const seenIds = new Set<string>();
let seeded = false;

watch(
  () => auth.fbUser?.uid ?? null,
  () => {
    seenIds.clear();
    seeded = false;
  },
);

watch(
  () => notifs.items,
  (items) => {
    if (!seeded) {
      for (const item of items) seenIds.add(item.id);
      seeded = true;
      return;
    }
    const now = Date.now();
    for (const item of items) {
      if (seenIds.has(item.id)) continue;
      seenIds.add(item.id);
      if (item.read) continue;
      const createdMs = item.createdAt?.toMillis?.() ?? 0;
      if (now - createdMs > 60_000) continue;
      // Don't pop a toast for a chat the user is actively reading — the
      // message is already on screen in JobChatOverlay. Inbox doc still
      // gets written, so the bell catches up if they switch away.
      if (
        item.type === "message_received" &&
        item.chatId !== null &&
        item.chatId === notifs.activeChatId
      ) {
        continue;
      }
      // `detail` is typed `any` in PrimeVue, so we use it to carry both
      // the body text AND the notif id through to the custom template
      // slot. We don't pass `data` because PrimeVue 4.2's
      // ToastMessageOptions doesn't declare it. The template's click
      // handler reads `detail.notifId` and resolves back to the live
      // store item (which has the latest read state + actor data),
      // rather than closing over a potentially-stale snapshot here.
      primeToast.add({
        group: "notification",
        severity: "info",
        summary: item.title,
        detail: { notifId: item.id, body: item.body },
        life: 5000,
      });
    }
  },
);

function openFromToast(notifId: string) {
  const item = notifs.items.find((n) => n.id === notifId);
  if (!item) return;
  primeToast.removeGroup("notification");
  void notifs.onOpen(item, router);
}
</script>

<template>
  <div class="min-h-full flex flex-col">
    <!-- Always-on "you're on the clock" bar. Lives above the layout switch so
         it spans every chrome (public + app) and stays pinned at the top of the
         viewport — a tradesperson can stop their running clock from anywhere,
         not just the job's own page. Renders nothing unless a clock is running. -->
    <ActiveClockBanner />
    <!-- Global "confirm your email" nudge for signed-in, unverified accounts.
         Above the layout switch so it spans every chrome; self-hides when
         verified or signed out. -->
    <VerifyEmailBanner />
    <!-- Fade between chrome systems so crossing the public↔app boundary
         (sign-in, or a visitor→member transition on a hybrid route) is a
         smooth crossfade rather than an abrupt swap. Keyed on `layout` so
         it only fires when the chrome KIND changes — navigating within the
         same layout doesn't animate. Transition classes are global
         (main.css) so they reach the AppShell child root past scoped CSS. -->
    <Transition name="bs-layout" mode="out-in">
      <div v-if="layout === 'public'" key="public" class="flex flex-1 flex-col">
        <AppHeader />
        <TradieStatusBanner />
        <main class="flex-1">
          <RouterView />
        </main>
        <AppFooter />
      </div>

      <AppShell v-else-if="layout === 'app'" key="app" class="flex-1">
        <RouterView />
      </AppShell>

      <main v-else key="chromeless" class="flex-1">
        <!-- Chromeless: onboarding wizard renders with no shell. -->
        <RouterView />
      </main>
    </Transition>

    <Toast position="top-right" />
    <!-- Live notification toasts. Separate group + position so they don't
         collide with the generic top-right action toasts (saved, error, etc).
         The custom message slot makes the whole toast clickable so the user
         can jump straight to the deep link without opening the bell. -->
    <Toast group="notification" position="top-center">
      <template #message="{ message }">
        <button
          type="button"
          class="notif-toast"
          @click="openFromToast(message.detail.notifId)"
        >
          <i class="pi pi-bell notif-toast__icon" aria-hidden="true"></i>
          <span class="notif-toast__body">
            <span class="notif-toast__title">{{ message.summary }}</span>
            <span class="notif-toast__detail">{{ message.detail.body }}</span>
          </span>
        </button>
      </template>
    </Toast>
    <ConfirmDialog />
    <!-- Renders outside the chromeless gate so admins and tradies both see
         it on their respective pages. The bubble has its own route + role
         visibility rules. -->
    <AssistantBubble />
    <!-- Global "Report a bug" button — its own visibility rule (qa/admin only).
         Lets testers file a reproducible bug from anywhere in the app. -->
    <ReportBugButton />
    <!-- Global Blue Seal Pro upgrade popup. Any gated AI/Pro action funnels its
         paywall error into the paywall store, which this dialog renders. -->
    <PaywallDialog />
    <!-- Global insurance reminder popup. A soft nudge when a tradesperson with
         no proof of insurance on file bids or quotes; driven by the
         insurancePrompt store (see useInsuranceGate). -->
    <InsuranceReminderDialog />
    <!-- Global overlay for Airbnb-style role switches. Stays mounted; the
         component shows/hides itself based on the role-switch animation
         store, which `auth.switchActiveRole` drives. -->
    <RoleSwitchOverlay />
    <!-- "Update available" banner + critical "Update required" overlay. Driven
         by useAppUpdate() (also initialised above); shows a tappable update path
         the moment a new build is detected, so nobody is stuck on a stale build
         waiting for a hard-refresh. -->
    <AppUpdatePrompt />
  </div>
</template>

<style scoped>
/* Clickable notification-toast body. Styled to read as one tappable card
   that fills the toast's content area — PrimeVue's outer toast shell still
   provides the close button + life-bar. */
.notif-toast {
  display: flex;
  align-items: flex-start;
  gap: 0.625rem;
  width: 100%;
  padding: 0.25rem 0;
  border: 0;
  background: transparent;
  text-align: left;
  cursor: pointer;
  color: inherit;
  font: inherit;
}
.notif-toast__icon {
  flex: none;
  margin-top: 0.125rem;
  font-size: 1.125rem;
  color: var(--bs-blue);
}
.notif-toast__body {
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
  min-width: 0;
  flex: 1 1 auto;
}
.notif-toast__title {
  font-weight: 600;
  font-size: 0.875rem;
  line-height: 1.25;
  color: var(--bs-text);
}
.notif-toast__detail {
  font-size: 0.8125rem;
  line-height: 1.35;
  color: var(--bs-text-muted);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
</style>
