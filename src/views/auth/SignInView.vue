<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import Button from "primevue/button";
import InputText from "primevue/inputtext";
import Password from "primevue/password";
import Message from "primevue/message";
import Divider from "primevue/divider";
import { useAuthStore } from "@/stores/auth";
import { signInSchema } from "@/validation/schemas";
import { useToast } from "@/composables/useToast";
import { useGoogleOneTap } from "@/composables/useGoogleOneTap";
import { humanizeError } from "@/utils/errors";
import { safeRedirect } from "@/utils/redirect";
import { useSeo } from "@/composables/useSeo";

useSeo({ title: "Sign in", noindex: true });

// Google One Tap ("Continue as <name>"). No-op unless VITE_GOOGLE_OAUTH_CLIENT_ID
// is set; routes new accounts to /welcome and returning users to their redirect.
const oneTap = useGoogleOneTap({ context: "signin" });
onMounted(() => void oneTap.start());

const auth = useAuthStore();
const router = useRouter();
const route = useRoute();
const toast = useToast();

const email = ref("");
const password = ref("");
const fieldErrors = ref<{ email?: string; password?: string }>({});
const formError = ref<string | null>(null);

// Passwordless sign-in link — for return logins without a password (e.g.
// tradespeople invited via a magic link who never set one).
const sendingLink = ref(false);
const linkSent = ref(false);
async function emailSignInLink() {
  formError.value = null;
  fieldErrors.value = {};
  const e = email.value.trim().toLowerCase();
  if (!e || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) {
    fieldErrors.value.email = "Enter your email to get a sign-in link.";
    return;
  }
  sendingLink.value = true;
  try {
    await auth.sendSignInLink(e, typeof route.query.redirect === "string" ? route.query.redirect : undefined);
    linkSent.value = true;
  } catch (err) {
    formError.value = humanizeError(err);
  } finally {
    sendingLink.value = false;
  }
}

async function submit() {
  fieldErrors.value = {};
  formError.value = null;
  const parsed = signInSchema.safeParse({ email: email.value, password: password.value });
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const k = issue.path[0] as "email" | "password";
      fieldErrors.value[k] = issue.message;
    }
    return;
  }
  try {
    await auth.signIn(parsed.data.email, parsed.data.password);
    toast.success("Signed in");
    const redirect = safeRedirect(route.query.redirect);
    router.replace(redirect);
  } catch (e) {
    formError.value = humanizeError(e);
  }
}

// Google on the SIGN-IN page can belong to someone with no account yet. A
// brand-new account is provisioned as a client (the safe default), then sent
// to the forced /welcome role choice — a new tradesperson would otherwise be
// stranded in the client view with no hint that onboarding exists. The choice
// lives on its own route (not a dismissible dialog) so it can't be skipped and
// is shared with the One Tap flow.
async function googleSignIn() {
  try {
    const { isNew } = await auth.signInWithGoogle("client");
    if (isNew) {
      router.replace({
        name: "Welcome",
        query: typeof route.query.redirect === "string" ? { redirect: route.query.redirect } : {},
      });
      return;
    }
    router.replace(safeRedirect(route.query.redirect));
  } catch (e) {
    formError.value = humanizeError(e);
  }
}
</script>

<template>
  <section class="bs-container py-12 max-w-md mx-auto">
    <h1 class="text-2xl font-bold">Sign in</h1>
    <p class="text-[color:var(--bs-muted)] mb-6">Welcome back.</p>

    <form class="bs-form bs-card p-6 space-y-4" @submit.prevent="submit">
      <div>
        <label class="text-sm font-medium">Email</label>
        <InputText v-model="email" type="email" class="mt-1" autocomplete="email" />
        <small v-if="fieldErrors.email" class="text-[color:var(--bs-danger)]">{{ fieldErrors.email }}</small>
      </div>
      <div>
        <div class="flex items-baseline justify-between">
          <label class="text-sm font-medium">Password</label>
          <router-link
            to="/forgot-password"
            class="text-xs font-medium text-[color:var(--bs-blue)] hover:underline"
          >
            Forgot password?
          </router-link>
        </div>
        <Password
          v-model="password"
          :feedback="false"
          toggle-mask
          input-class="w-full"
          class="mt-1 w-full"
          autocomplete="current-password"
        />
        <small v-if="fieldErrors.password" class="text-[color:var(--bs-danger)]">{{ fieldErrors.password }}</small>
      </div>

      <Message v-if="formError" severity="error" :closable="false">{{ formError }}</Message>

      <Button type="submit" label="Sign in" :loading="auth.pending" class="w-full" />

      <Divider align="center"><span class="text-xs text-[color:var(--bs-muted)]">or</span></Divider>

      <Button
        label="Continue with Google"
        icon="pi pi-google"
        outlined
        class="w-full"
        @click="googleSignIn"
      />
      <p class="text-xs text-center text-[color:var(--bs-muted)] -mt-2">
        By continuing with Google you agree to our
        <router-link to="/terms" target="_blank" class="underline">Terms</router-link>
        and
        <router-link to="/privacy" target="_blank" class="underline">Privacy Policy</router-link>.
      </p>

      <Message v-if="linkSent" severity="success" :closable="false">
        Check your email for a sign-in link. No password needed.
      </Message>
      <Button
        v-else
        label="Email me a sign-in link"
        icon="pi pi-envelope"
        text
        class="w-full"
        :loading="sendingLink"
        @click="emailSignInLink"
      />
      <p v-if="!linkSent" class="text-xs text-center text-[color:var(--bs-muted)] -mt-2">
        No password? Get a one-click link emailed to you.
      </p>

      <p class="text-sm text-center">
        No account?
        <router-link to="/sign-up" class="font-medium">Sign up</router-link>
      </p>
    </form>
  </section>
</template>
