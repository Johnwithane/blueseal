<script setup lang="ts">
import { computed, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import Message from "primevue/message";
import { useAuthStore } from "@/stores/auth";
import { humanizeError } from "@/utils/errors";
import { safeRedirect } from "@/utils/redirect";
import { useSeo } from "@/composables/useSeo";

useSeo({ title: "Welcome to Blue Seal", noindex: true });

const auth = useAuthStore();
const router = useRouter();
const route = useRoute();

// Forced role choice for a brand-new account created WITHOUT an up-front role
// pick (the Google "Continue with Google" button on /sign-in, and Google One
// Tap). The /sign-up button captures the role from its toggle and skips this.
// Brand-new accounts are always provisioned with the `client` role, so picking
// "client" needs no write; picking "tradesperson" adds the role + draft profile
// and drops into onboarding. There is deliberately no skip/dismiss — closing the
// silent dialog used to strand intended tradespeople as clients.
const busy = ref<null | "client" | "tradesperson">(null);
const error = ref<string | null>(null);

const firstName = computed(() => {
  const name = auth.user?.displayName ?? auth.fbUser?.displayName ?? "";
  return name.trim().split(/\s+/)[0] || "";
});

function chooseClient() {
  if (busy.value) return;
  busy.value = "client";
  // Already a client — nothing to provision; head to where they were going.
  router.replace(safeRedirect(route.query.redirect));
}

async function chooseTradesperson() {
  if (busy.value) return;
  busy.value = "tradesperson";
  error.value = null;
  try {
    // Idempotent: addRole grants tradesperson, provisions a draft profile, and
    // flips the active view. The onboarding wizard resumes from there.
    await auth.addRole("tradesperson");
    router.replace("/onboarding");
  } catch (e) {
    error.value = humanizeError(e);
    busy.value = null;
  }
}
</script>

<template>
  <section class="min-h-[100dvh] grid place-items-center bs-container py-12">
    <div class="w-full max-w-md">
      <div class="bs-pill verified mb-3">
        <i class="pi pi-verified"></i>
        <span>Account created</span>
      </div>
      <h1 class="text-2xl font-bold">
        You're in<template v-if="firstName">, {{ firstName }}</template>!
      </h1>
      <p class="text-[color:var(--bs-muted)] mb-6">
        One quick thing. How will you use Blue Seal?
      </p>

      <div role="radiogroup" class="grid grid-cols-1 gap-3">
        <button
          type="button"
          class="role-option"
          :disabled="!!busy"
          :aria-busy="busy === 'client'"
          @click="chooseClient"
        >
          <i class="pi pi-search text-xl"></i>
          <span class="role-option-title">I'm hiring a tradesperson</span>
          <span class="role-option-sub">Find verified pros and post jobs</span>
        </button>
        <button
          type="button"
          class="role-option"
          :disabled="!!busy"
          :aria-busy="busy === 'tradesperson'"
          @click="chooseTradesperson"
        >
          <i class="pi pi-wrench text-xl"></i>
          <span class="role-option-title">I'm a tradesperson</span>
          <span class="role-option-sub">
            Build a verified profile and get hired
            <template v-if="busy === 'tradesperson'"> &middot; setting up&hellip;</template>
          </span>
        </button>
      </div>

      <Message v-if="error" severity="error" :closable="false" class="mt-4">{{ error }}</Message>

      <p class="text-xs text-center text-[color:var(--bs-muted)] mt-6">
        You can switch or add the other role anytime from your account.
      </p>
    </div>
  </section>
</template>

<style scoped>
.role-option {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.15rem;
  padding: 1rem 1.1rem;
  border-radius: 0.7rem;
  border: 2px solid var(--bs-border);
  background: #fff;
  color: var(--bs-muted);
  text-align: left;
  transition: border-color 120ms, background-color 120ms, color 120ms;
  cursor: pointer;
}
.role-option:hover:not(:disabled) {
  border-color: var(--bs-blue);
  background: #eaf5fc;
  color: var(--bs-blue-dark);
}
.role-option:focus-visible {
  outline: 2px solid var(--bs-blue);
  outline-offset: 2px;
}
.role-option:disabled {
  opacity: 0.7;
  cursor: progress;
}
.role-option-title {
  font-size: 1rem;
  font-weight: 600;
  margin-top: 0.25rem;
  color: var(--bs-text);
}
.role-option-sub {
  font-size: 0.8rem;
  opacity: 0.9;
}
</style>
