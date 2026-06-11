<script setup lang="ts">
import { ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import Button from "primevue/button";
import InputText from "primevue/inputtext";
import Password from "primevue/password";
import Message from "primevue/message";
import Divider from "primevue/divider";
import Dialog from "primevue/dialog";
import { useAuthStore } from "@/stores/auth";
import { signInSchema } from "@/validation/schemas";
import { useToast } from "@/composables/useToast";
import { humanizeError } from "@/utils/errors";
import { useSeo } from "@/composables/useSeo";

useSeo({ title: "Sign in", noindex: true });

const auth = useAuthStore();
const router = useRouter();
const route = useRoute();
const toast = useToast();

const email = ref("");
const password = ref("");
const fieldErrors = ref<{ email?: string; password?: string }>({});
const formError = ref<string | null>(null);

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
    const redirect = (route.query.redirect as string) || "/dashboard";
    router.replace(redirect);
  } catch (e) {
    formError.value = humanizeError(e);
  }
}

// Google on the SIGN-IN page can belong to someone with no account yet. They
// get provisioned as a client (the safe default), then asked which side of
// the marketplace they're on — a new tradesperson would otherwise be stranded
// in the client view with no hint that onboarding exists.
const showRoleChoice = ref(false);
const addingTradieRole = ref(false);
// Set once either button resolves the choice, so the dialog's @hide (X / Esc)
// can fall back to the client default without clobbering an explicit pick.
const roleResolved = ref(false);

async function googleSignIn() {
  try {
    const { isNew } = await auth.signInWithGoogle("client");
    if (isNew) {
      roleResolved.value = false;
      showRoleChoice.value = true;
      return;
    }
    const redirect = (route.query.redirect as string) || "/dashboard";
    router.replace(redirect);
  } catch (e) {
    formError.value = humanizeError(e);
  }
}

function continueAsClient() {
  roleResolved.value = true;
  showRoleChoice.value = false;
  const redirect = (route.query.redirect as string) || "/dashboard";
  router.replace(redirect);
}

async function continueAsTradesperson() {
  addingTradieRole.value = true;
  try {
    await auth.addRole("tradesperson");
    roleResolved.value = true;
    showRoleChoice.value = false;
    router.replace("/onboarding");
  } catch (e) {
    toast.error("Couldn't set up your tradesperson profile", humanizeError(e));
  } finally {
    addingTradieRole.value = false;
  }
}

function onRoleDialogHide() {
  if (!roleResolved.value) continueAsClient();
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

      <p class="text-sm text-center">
        No account?
        <router-link to="/sign-up" class="font-medium">Sign up</router-link>
      </p>
    </form>

    <!-- New-account role choice: closing the dialog (X / mask) keeps the safe
         client default, same as "I'm hiring". -->
    <Dialog
      v-model:visible="showRoleChoice"
      modal
      header="Welcome to Blue Seal!"
      class="w-[95vw] max-w-sm"
      :dismissable-mask="false"
      :closable="true"
      @hide="onRoleDialogHide"
    >
      <p class="text-sm text-[color:var(--bs-muted)]">
        Your account is ready. How will you use Blue Seal?
      </p>
      <div class="mt-4 space-y-2">
        <Button
          label="I'm hiring a tradesperson"
          icon="pi pi-search"
          class="w-full"
          :disabled="addingTradieRole"
          @click="continueAsClient"
        />
        <Button
          label="I'm a tradesperson"
          icon="pi pi-wrench"
          outlined
          class="w-full"
          :loading="addingTradieRole"
          @click="continueAsTradesperson"
        />
      </div>
    </Dialog>
  </section>
</template>
