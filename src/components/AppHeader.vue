<script setup lang="ts">
import { computed, ref } from "vue";
import { useRouter, RouterLink } from "vue-router";
import Button from "primevue/button";
import Menu from "primevue/menu";
import Avatar from "primevue/avatar";
import Popover from "primevue/popover";
import { useAuthStore } from "@/stores/auth";
import { useToast } from "@/composables/useToast";
import { humanizeError } from "@/utils/errors";
import NotificationsPanel from "@/components/NotificationsPanel.vue";
import type { NotificationDoc, WithId } from "@/firebase/interfaces";
import { useNotificationsStore } from "@/stores/notifications";

const auth = useAuthStore();
const router = useRouter();
const toast = useToast();
const notifs = useNotificationsStore();
const menu = ref<InstanceType<typeof Menu> | null>(null);
const notifPopover = ref<InstanceType<typeof Popover> | null>(null);

const unreadCount = computed(() => notifs.unreadCount);

function toggleNotifs(e: Event) {
  notifPopover.value?.toggle(e);
}

async function onOpenNotification(item: WithId<NotificationDoc>) {
  notifPopover.value?.hide();
  await notifs.onOpen(item, router);
}

async function onMarkAllRead() {
  try {
    await notifs.markAllRead();
  } catch (e) {
    toast.error(humanizeError(e));
  }
}

const VIEW_LABEL: Record<string, string> = {
  client: "Client",
  tradesperson: "Tradesperson",
  admin: "Admin",
};

async function switchTo(role: "client" | "tradesperson" | "admin") {
  try {
    await auth.switchActiveRole(role);
    toast.success(`Switched to ${VIEW_LABEL[role]} view`);
    router.push({ name: "Dashboard" });
  } catch (e) {
    toast.error(humanizeError(e));
  }
}

interface PrimaryAction {
  label: string;
  icon: string;
  to: string;
}

// Primary actions reflect the home-hero logic so the header and hero stay
// consistent. Logged-out users get nothing in the middle — the hero handles
// onboarding-style CTAs and the right side has sign-in / sign-up.
const primaryActions = computed<PrimaryAction[]>(() => {
  if (!auth.isAuthenticated) return [];
  if (auth.activeRole === "tradesperson") {
    return [
      { label: "Browse open jobs", icon: "pi pi-megaphone", to: "/jobs/browse" },
      { label: "My applications", icon: "pi pi-send", to: "/my-applications" },
    ];
  }
  if (auth.activeRole === "admin") {
    return [{ label: "Vetting queue", icon: "pi pi-shield", to: "/admin/vetting" }];
  }
  // Default = client view.
  return [
    { label: "Find a tradesperson", icon: "pi pi-search", to: "/search" },
    { label: "Post a job", icon: "pi pi-megaphone", to: "/jobs/post" },
  ];
});

const avatarInitial = computed(() => {
  const name = auth.user?.displayName?.trim();
  return (name || "?").slice(0, 1).toUpperCase();
});

// Single dropdown model. On mobile it carries the primary actions too
// (since they're hidden from the header bar at <sm). On desktop the
// primary actions are inline, so the dropdown starts at Dashboard.
const items = computed(() => {
  const list: Record<string, unknown>[] = [];

  // Mobile-only primary actions block.
  for (const a of primaryActions.value) {
    list.push({
      label: a.label,
      icon: a.icon,
      class: "sm:hidden",
      command: () => router.push(a.to),
    });
  }
  if (primaryActions.value.length > 0) {
    list.push({ separator: true, class: "sm:hidden" });
  }

  list.push(
    {
      label: "Dashboard",
      icon: "pi pi-home",
      command: () => router.push({ name: "Dashboard" }),
    },
    {
      label: "Account",
      icon: "pi pi-user",
      command: () => router.push({ name: "Account" }),
    },
  );

  // Payouts is tradesperson-only; lives in the dropdown rather than the
  // inline header nav to keep the bar uncluttered. The status banner +
  // dashboard CTA give the other discovery paths.
  if (auth.hasTradieRole && auth.activeRole === "tradesperson") {
    list.push({
      label: "Payouts",
      icon: "pi pi-credit-card",
      command: () => router.push({ name: "Payouts" }),
    });
  }

  if (auth.canSwitchRole) {
    list.push({ separator: true });
    if (auth.hasClientRole && auth.activeRole !== "client") {
      list.push({
        label: "Switch to Client view",
        icon: "pi pi-user",
        command: () => switchTo("client"),
      });
    }
    if (auth.hasTradieRole && auth.activeRole !== "tradesperson") {
      list.push({
        label: "Switch to Tradesperson view",
        icon: "pi pi-wrench",
        command: () => switchTo("tradesperson"),
      });
    }
    if (auth.hasAdminRole && auth.activeRole !== "admin") {
      list.push({
        label: "Switch to Admin view",
        icon: "pi pi-shield",
        command: () => switchTo("admin"),
      });
    }
  }

  list.push(
    { separator: true },
    {
      label: "Sign out",
      icon: "pi pi-sign-out",
      command: async () => {
        await auth.signOut();
        router.push({ name: "Home" });
      },
    },
  );
  return list;
});

function openMenu(e: Event) {
  menu.value?.toggle(e);
}
</script>

<template>
  <header class="sticky top-0 z-30 border-b border-[color:var(--bs-border)] bg-white">
    <div class="bs-container flex items-center justify-between gap-3 py-3">
      <router-link to="/" class="flex items-center gap-2 text-inherit no-underline">
        <img src="/icons/blueseal_logo_Character.png" alt="" class="h-12 w-auto" />
        <span
          class="text-2xl tracking-wide text-[color:var(--bs-blue-dark)]"
          style="font-family: var(--bs-font-logo)"
        >BlueSeal</span>
      </router-link>

      <!-- Role-aware primary nav (desktop only). Hidden on mobile; the same
           items live at the top of the avatar dropdown there. -->
      <nav v-if="primaryActions.length" class="hidden items-center gap-1 sm:flex">
        <RouterLink
          v-for="a in primaryActions"
          :key="a.to"
          :to="a.to"
          class="inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-medium text-[color:var(--bs-text)] no-underline hover:bg-[color:var(--bs-surface-alt)]"
        >
          <i :class="[a.icon, 'text-xs text-[color:var(--bs-blue)]']"></i>
          <span>{{ a.label }}</span>
        </RouterLink>
      </nav>

      <div class="flex items-center gap-2">
        <template v-if="auth.isAuthenticated">
          <button
            type="button"
            class="relative inline-flex h-9 w-9 items-center justify-center rounded-full border border-[color:var(--bs-border)] bg-white text-[color:var(--bs-text)] transition-colors hover:bg-[color:var(--bs-surface-alt)]"
            :aria-label="
              unreadCount > 0 ? `Notifications (${unreadCount} unread)` : 'Notifications'
            "
            @click="toggleNotifs"
          >
            <i class="pi pi-bell"></i>
            <span
              v-if="unreadCount > 0"
              class="absolute -right-0.5 -top-0.5 inline-flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-[color:var(--bs-blue)] px-1 text-[10px] font-semibold leading-none text-white"
            >
              {{ unreadCount > 9 ? "9+" : unreadCount }}
            </span>
          </button>
          <Popover ref="notifPopover">
            <NotificationsPanel
              :items="notifs.items"
              :loading="notifs.loading"
              @open="onOpenNotification"
              @mark-all-read="onMarkAllRead"
            />
          </Popover>

          <button
            type="button"
            class="flex items-center gap-2 rounded-full border border-[color:var(--bs-border)] bg-white px-1.5 py-1 transition-colors hover:bg-[color:var(--bs-surface-alt)]"
            :aria-label="auth.user?.displayName ?? 'Account menu'"
            @click="openMenu"
          >
            <Avatar
              v-if="auth.user?.photoURL"
              :image="auth.user.photoURL"
              size="normal"
              shape="circle"
            />
            <Avatar
              v-else
              :label="avatarInitial"
              size="normal"
              shape="circle"
              style="background-color: var(--bs-blue); color: white; font-weight: 600;"
            />
            <span class="hidden pr-1 text-sm font-medium sm:inline">
              {{ auth.user?.displayName ?? "Account" }}
            </span>
          </button>
          <Menu ref="menu" :model="items" popup />
        </template>
        <template v-else>
          <router-link to="/sign-in">
            <Button label="Sign in" text />
          </router-link>
          <router-link to="/sign-up">
            <Button label="Sign up" />
          </router-link>
        </template>
      </div>
    </div>
  </header>
</template>
