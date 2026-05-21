<script setup lang="ts">
import { computed } from "vue";
import { useRouter } from "vue-router";
import Button from "primevue/button";
import Menu from "primevue/menu";
import { ref } from "vue";
import { useAuthStore } from "@/stores/auth";

const auth = useAuthStore();
const router = useRouter();
const menu = ref<InstanceType<typeof Menu> | null>(null);

const items = computed(() => [
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
  { separator: true },
  {
    label: "Sign out",
    icon: "pi pi-sign-out",
    command: async () => {
      await auth.signOut();
      router.push({ name: "Home" });
    },
  },
]);

function openMenu(e: Event) {
  menu.value?.toggle(e);
}
</script>

<template>
  <header class="bg-white border-b border-[color:var(--bs-border)] sticky top-0 z-30">
    <div class="bs-container flex items-center justify-between py-3 gap-3">
      <router-link to="/" class="flex items-center gap-2 no-underline text-inherit">
        <img src="/icons/blueseal_logo.png" alt="" class="h-8 w-auto" />
        <span class="font-bold text-lg">Blue Seal</span>
      </router-link>

      <nav class="hidden sm:flex items-center gap-1">
        <router-link to="/search">
          <Button label="Find a tradie" icon="pi pi-search" text />
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
