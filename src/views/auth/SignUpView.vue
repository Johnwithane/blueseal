<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import Button from "primevue/button";
import InputText from "primevue/inputtext";
import Password from "primevue/password";
import Checkbox from "primevue/checkbox";
import Message from "primevue/message";
import Divider from "primevue/divider";
import { useAuthStore } from "@/stores/auth";
import { signUpSchema } from "@/validation/schemas";
import { useGoogleOneTap } from "@/composables/useGoogleOneTap";
import { humanizeError } from "@/utils/errors";
import { normalizeReferralCode } from "@/utils/referralCode";
import { useSeo } from "@/composables/useSeo";

useSeo({ title: "Create your account", noindex: true });

// Google One Tap ("Continue as <name>"). No-op unless VITE_GOOGLE_OAUTH_CLIENT_ID
// is set. One Tap doesn't see the role toggle, so a brand-new One Tap account
// defaults to client and is sent to the forced /welcome role choice.
const oneTap = useGoogleOneTap({ context: "signup" });
onMounted(() => void oneTap.start());

const auth = useAuthStore();
const router = useRouter();
const route = useRoute();

// Push opt-in is no longer offered here: usePushAutoPrompt (App.vue) fires
// the soft-ask for every role the moment the new session lands — including
// right after this signup completes.

// Preselect tradesperson when arriving via /sign-up?as=tradesperson (or the
// old /sign-up/tradie route, which now redirects here).
const isTradie = ref(route.query.as === "tradesperson");

// Referral capture: a rep's vanity code arrives via ?ref=CODE (the /join link)
// or is typed by hand. We thread it to provisionAccount, which resolves it to
// the owning rep and grants the referred tradesperson a free month at go-live.
// The signal records how it arrived ("link" when it came pre-filled, else "code").
const refFromLink = typeof route.query.ref === "string" ? normalizeReferralCode(route.query.ref) : "";
const referralCode = ref(refFromLink);
const referralSignal = computed<"link" | "code" | undefined>(() => {
  if (!referralCode.value) return undefined;
  return referralCode.value === refFromLink ? "link" : "code";
});

const displayName = ref("");
// Prefill the email field when arriving via a vouch invite link
// (/sign-up?invite=email@example.com). The signup linker trigger keys on
// the email match to claim any pending_signup vouches sent to this
// address, so we want the signup to actually go through with that email.
const email = ref(typeof route.query.invite === "string" ? route.query.invite : "");
const password = ref("");
const termsAccepted = ref(false);
const fieldErrors = ref<Record<string, string>>({});
const formError = ref<string | null>(null);

const role = computed<"client" | "tradesperson">(() =>
  isTradie.value ? "tradesperson" : "client",
);
const heading = computed(() =>
  isTradie.value ? "Build your verified profile" : "Create your account",
);
const subtitle = computed(() =>
  isTradie.value
    ? "We'll vet your cert + ID, then put you in front of nearby clients."
    : "Find verified tradespeople near you.",
);
const submitLabel = computed(() =>
  isTradie.value ? "Start onboarding" : "Create account",
);
const redirectTo = computed(() => (isTradie.value ? "/onboarding" : "/dashboard"));

async function submit() {
  fieldErrors.value = {};
  formError.value = null;
  const parsed = signUpSchema.safeParse({
    displayName: displayName.value,
    email: email.value,
    password: password.value,
    role: role.value,
    termsAccepted: termsAccepted.value,
  });
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      fieldErrors.value[issue.path[0] as string] = issue.message;
    }
    return;
  }
  try {
    await auth.signUp({
      ...parsed.data,
      referralCode: referralCode.value || undefined,
      referralSignal: referralSignal.value,
    });
    router.replace(redirectTo.value);
  } catch (e) {
    formError.value = humanizeError(e);
  }
}

async function google() {
  // Capture consent before opening the Google popup.
  if (!termsAccepted.value) {
    fieldErrors.value = {
      termsAccepted: "You must agree to the Terms of Service and Privacy Policy",
    };
    return;
  }
  fieldErrors.value = {};
  formError.value = null;
  try {
    await auth.signInWithGoogle(role.value, {
      referralCode: referralCode.value || undefined,
      referralSignal: referralSignal.value,
    });
    router.replace(redirectTo.value);
  } catch (e) {
    formError.value = humanizeError(e);
  }
}
</script>

<template>
  <section class="bs-container py-12 max-w-md mx-auto">
    <div v-if="isTradie" class="bs-pill verified mb-3">
      <i class="pi pi-verified"></i>
      <span>For tradespeople</span>
    </div>
    <h1 class="text-2xl font-bold">{{ heading }}</h1>
    <p class="text-[color:var(--bs-muted)] mb-6">{{ subtitle }}</p>

    <Message v-if="isTradie && referralCode" severity="success" :closable="false" class="mb-6">
      Your first month of Blue Seal Pro is free, no credit card needed.
    </Message>

    <form class="bs-form bs-card p-6 space-y-4" @submit.prevent="submit">
      <fieldset class="space-y-2">
        <legend class="text-sm font-medium mb-2">I'm signing up as a…</legend>
        <div role="radiogroup" class="grid grid-cols-2 gap-2">
          <button
            type="button"
            role="radio"
            :aria-checked="!isTradie"
            class="role-option"
            :class="{ 'role-option-active': !isTradie }"
            @click="isTradie = false"
          >
            <i class="pi pi-search text-lg"></i>
            <span class="role-option-title">A client</span>
            <span class="role-option-sub">Hiring a tradesperson</span>
          </button>
          <button
            type="button"
            role="radio"
            :aria-checked="isTradie"
            class="role-option"
            :class="{ 'role-option-active': isTradie }"
            @click="isTradie = true"
          >
            <i class="pi pi-wrench text-lg"></i>
            <span class="role-option-title">A tradesperson</span>
            <span class="role-option-sub">Offering services</span>
          </button>
        </div>
      </fieldset>

      <div>
        <label class="text-sm font-medium">Your name</label>
        <InputText v-model="displayName" class="mt-1" autocomplete="name" />
        <small v-if="fieldErrors.displayName" class="text-[color:var(--bs-danger)]">{{ fieldErrors.displayName }}</small>
      </div>
      <div>
        <label class="text-sm font-medium">Email</label>
        <InputText v-model="email" type="email" class="mt-1" autocomplete="email" />
        <small v-if="fieldErrors.email" class="text-[color:var(--bs-danger)]">{{ fieldErrors.email }}</small>
      </div>
      <div>
        <label class="text-sm font-medium">Password</label>
        <Password
          v-model="password"
          toggle-mask
          input-class="w-full"
          class="mt-1 w-full"
          autocomplete="new-password"
        />
        <small v-if="fieldErrors.password" class="text-[color:var(--bs-danger)]">{{ fieldErrors.password }}</small>
      </div>

      <div v-if="isTradie">
        <label class="text-sm font-medium">
          Referral code <span class="text-[color:var(--bs-muted)] font-normal">(optional)</span>
        </label>
        <InputText v-model="referralCode" class="mt-1" placeholder="e.g. JOHNNYK" />
        <small class="text-[color:var(--bs-muted)] block mt-1">
          Got a code from a Blue Seal rep? Enter it for a free first month.
        </small>
      </div>

      <div>
        <label class="flex items-start gap-2 text-sm cursor-pointer">
          <Checkbox v-model="termsAccepted" :binary="true" input-id="terms-accepted" />
          <span>
            I agree to the
            <router-link to="/terms" target="_blank" class="font-medium underline">Terms of Service</router-link>
            and
            <router-link to="/privacy" target="_blank" class="font-medium underline">Privacy Policy</router-link>.
            <template v-if="isTradie">
              I understand Blue Seal is a platform — not my employer or contractor — and that
              I'll need to upload a trade certification and government-issued ID to be approved.
            </template>
          </span>
        </label>
        <small v-if="fieldErrors.termsAccepted" class="text-[color:var(--bs-danger)] block mt-1">
          {{ fieldErrors.termsAccepted }}
        </small>
      </div>

      <Message v-if="formError" severity="error" :closable="false">{{ formError }}</Message>

      <Button type="submit" :label="submitLabel" :loading="auth.pending" class="w-full" />

      <Divider align="center"><span class="text-xs text-[color:var(--bs-muted)]">or</span></Divider>
      <Button label="Continue with Google" icon="pi pi-google" outlined class="w-full" @click="google" />
      <p class="text-xs text-center text-[color:var(--bs-muted)] -mt-2">
        By continuing with Google you agree to our
        <router-link to="/terms" target="_blank" class="underline">Terms</router-link>
        and
        <router-link to="/privacy" target="_blank" class="underline">Privacy Policy</router-link>.
      </p>

      <p class="text-sm text-center">
        Already have an account?
        <router-link to="/sign-in" class="font-medium">Sign in</router-link>
      </p>
    </form>
  </section>
</template>

<style scoped>
.role-option {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.15rem;
  padding: 0.75rem 0.9rem;
  border-radius: 0.6rem;
  border: 2px solid var(--bs-border);
  background: #fff;
  color: var(--bs-muted);
  text-align: left;
  transition: border-color 120ms, background-color 120ms, color 120ms;
  cursor: pointer;
}
.role-option:hover {
  border-color: var(--bs-blue-light);
  color: var(--bs-text);
}
.role-option:focus-visible {
  outline: 2px solid var(--bs-blue);
  outline-offset: 2px;
}
.role-option-active {
  border-color: var(--bs-blue);
  background: #eaf5fc;
  color: var(--bs-blue-dark);
}
.role-option-title {
  font-size: 0.9rem;
  font-weight: 600;
  margin-top: 0.25rem;
}
.role-option-sub {
  font-size: 0.75rem;
  opacity: 0.85;
}
</style>
