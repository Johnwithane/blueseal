<script setup lang="ts">
import { computed, ref } from "vue";
import { useRouter } from "vue-router";
import Button from "primevue/button";
import Menu from "primevue/menu";
import { useAuthStore } from "@/stores/auth";
import { useToast } from "@/composables/useToast";
import { humanizeError } from "@/utils/errors";

const auth = useAuthStore();
const router = useRouter();
const toast = useToast();
const menu = ref<InstanceType<typeof Menu> | null>(null);

async function switchTo(role: "client" | "tradesperson") {
  try {
    await auth.switchActiveRole(role);
    toast.success(role === "tradesperson" ? "Switched to Tradesperson view" : "Switched to Client view");
    router.push({ name: "Dashboard" });
  } catch (e) {
    toast.error(humanizeError(e));
  }
}

const items = computed(() => {
  const list: Record<string, unknown>[] = [
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
  ];

  // Airbnb-style role switcher — only appears once the user actually holds
  // both public roles. A separator above + below visually anchors it.
  if (auth.canSwitchRole) {
    list.push({ separator: true });
    if (auth.activeRole !== "client") {
      list.push({
        label: "Switch to Client view",
        icon: "pi pi-user",
        command: () => switchTo("client"),
      });
    }
    if (auth.activeRole !== "tradesperson") {
      list.push({
        label: "Switch to Tradesperson view",
        icon: "pi pi-wrench",
        command: () => switchTo("tradesperson"),
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
  <header class="bg-white border-b border-[color:var(--bs-border)] sticky top-0 z-30">
    <div class="bs-container flex items-center justify-between py-3 gap-3">
      <router-link to="/" class="flex items-center gap-2 no-underline text-inherit">
        <img src="/icons/blueseal_logo.png" alt="" class="h-9 w-auto" />
        <span
          class="text-2xl tracking-wide text-[color:var(--bs-blue-dark)]"
          style="font-family: var(--bs-font-logo)"
        >Blue Seal</span>
      </router-link>

      <nav class="hidden sm:flex items-center gap-1">
        <router-link
          to="/search"
          class="group inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold no-underline bg-[color:var(--bs-blue-light)]/35 text-[color:var(--bs-blue-dark)] ring-1 ring-[color:var(--bs-blue-light)] hover:bg-[color:var(--bs-blue)] hover:text-white hover:ring-[color:var(--bs-blue)] transition-colors"
        >
          <i class="pi pi-search text-xs"></i>
          <span>Find a tradesperson</span>
          <i class="pi pi-arrow-right text-[10px] opacity-0 -ml-1 group-hover:opacity-100 group-hover:ml-0 transition-all"></i>
        </router-link>
      </nav>

      <div class="flex items-center gap-2">
        <template v-if="auth.isAuthenticated">
          <Button
            :label="auth.user?.displayName ?? 'Account'"
            icon="pi pi-user"
            severity="secondary"
            outlined
            @click="openMenu"
          />
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
