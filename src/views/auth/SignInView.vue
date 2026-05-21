<script setup lang="ts">
import { ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import Button from "primevue/button";
import InputText from "primevue/inputtext";
import Password from "primevue/password";
import Message from "primevue/message";
import Divider from "primevue/divider";
import { useAuthStore } from "@/stores/auth";
import { signInSchema } from "@/validation/schemas";
import { useToast } from "@/composables/useToast";

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
    formError.value = (e as Error).message;
  }
}

async function googleSignIn() {
  try {
    await auth.signInWithGoogle("client");
    router.replace("/dashboard");
  } catch (e) {
    formError.value = (e as Error).message;
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
        <small v-if="fieldErrors.email" class="text-red-600">{{ fieldErrors.email }}</small>
      </div>
      <div>
        <label class="text-sm font-medium">Password</label>
        <Password
          v-model="password"
          :feedback="false"
          toggle-mask
          input-class="w-full"
          class="mt-1 w-full"
          autocomplete="current-password"
        />
        <small v-if="fieldErrors.password" class="text-red-600">{{ fieldErrors.password }}</small>
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
  </section>
</template>
