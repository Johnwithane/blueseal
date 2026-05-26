<script setup lang="ts">
import { ref } from "vue";
import { RouterLink } from "vue-router";
import Button from "primevue/button";
import InputText from "primevue/inputtext";
import Tag from "primevue/tag";
import Message from "primevue/message";
import type { UserDoc, WithId } from "@/firebase/interfaces";
import { searchUsers } from "@/firebase/services/users";
import { useFormatters } from "@/composables/useFormatters";
import { humanizeError } from "@/utils/errors";

const { dateTime, relativeTime } = useFormatters();

const query = ref("");
const results = ref<WithId<UserDoc>[]>([]);
const loading = ref(false);
const searched = ref(false);
const error = ref<string | null>(null);

async function runSearch() {
  if (!query.value.trim()) return;
  loading.value = true;
  error.value = null;
  searched.value = true;
  try {
    results.value = await searchUsers(query.value);
  } catch (e) {
    error.value = humanizeError(e);
    results.value = [];
  } finally {
    loading.value = false;
  }
}

function roleSeverity(role: string): "info" | "success" | "warn" {
  if (role === "admin") return "warn";
  if (role === "tradesperson") return "success";
  return "info";
}
</script>

<template>
  <section class="bs-container max-w-3xl py-8">
    <RouterLink to="/dashboard/admin" class="text-xs text-[color:var(--bs-muted)]">
      ← Admin console
    </RouterLink>

    <header class="mt-2 mb-6">
      <p class="text-sm text-[color:var(--bs-muted)]">
        Look up an account by name, email, phone, or UID. Used by support
        when a customer writes in.
      </p>
    </header>

    <div class="bs-card bs-form p-4">
      <label class="text-xs font-medium block mb-1">Search</label>
      <div class="flex gap-2">
        <InputText
          v-model="query"
          class="flex-1"
          placeholder="Name  ·  email@example.com  ·  +15875551234  ·  Firebase UID"
          autofocus
          @keydown.enter="runSearch"
        />
        <Button
          label="Search"
          icon="pi pi-search"
          :loading="loading"
          :disabled="!query.trim()"
          @click="runSearch"
        />
      </div>
      <p class="mt-2 text-xs text-[color:var(--bs-muted)]">
        Name and email accept partial matches (case-insensitive). Phone and
        UID need to match exactly. Scans the most recent 500 accounts, so
        a very old account that doesn't match by phone/UID/exact email may
        be missed.
      </p>
    </div>

    <Message v-if="error" severity="error" :closable="false" class="mt-3">
      {{ error }}
    </Message>

    <div v-if="loading" class="bs-empty mt-3">Searching…</div>

    <div
      v-else-if="searched && results.length === 0"
      class="bs-empty mt-3"
    >
      <i class="pi pi-user-edit mb-2 block text-3xl text-[color:var(--bs-border)]"></i>
      <p>No users found for "{{ query }}".</p>
    </div>

    <ul v-else-if="results.length" class="mt-4 space-y-3">
      <li v-for="u in results" :key="u.id" class="bs-card p-4">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-center gap-2">
              <span class="font-semibold">{{ u.displayName || "(no name)" }}</span>
              <Tag
                v-if="u.deletedAt"
                value="DELETED — pending wipe"
                severity="danger"
              />
              <Tag
                v-for="r in u.roles ?? []"
                :key="r"
                :value="r"
                :severity="roleSeverity(r)"
              />
            </div>
            <dl class="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-sm">
              <div class="break-all">
                <dt class="inline font-medium">Email:</dt>
                {{ u.email || "—" }}
                <span v-if="u.emailVerified" class="text-xs text-green-700 ml-1">
                  ✓ verified
                </span>
              </div>
              <div><dt class="inline font-medium">Phone:</dt> {{ u.phone || "—" }}</div>
              <div class="sm:col-span-2 break-all">
                <dt class="inline font-medium">UID:</dt>
                <code class="text-xs">{{ u.id }}</code>
              </div>
              <div>
                <dt class="inline font-medium">Joined:</dt>
                {{ dateTime(u.createdAt) }}
              </div>
              <div v-if="u.lastActiveAt">
                <dt class="inline font-medium">Last active:</dt>
                {{ relativeTime(u.lastActiveAt) }}
              </div>
              <div v-if="u.deletedAt">
                <dt class="inline font-medium text-red-700">Deletion requested:</dt>
                {{ relativeTime(u.deletedAt) }}
              </div>
            </dl>
          </div>
          <div class="flex flex-col gap-2 flex-none">
            <RouterLink
              v-if="(u.roles ?? []).includes('tradesperson')"
              :to="{ name: 'TradieProfile', params: { uid: u.id } }"
            >
              <Button label="Public profile" icon="pi pi-external-link" size="small" outlined />
            </RouterLink>
            <RouterLink
              v-if="(u.roles ?? []).includes('tradesperson')"
              :to="{ name: 'AdminApplication', params: { uid: u.id } }"
            >
              <Button label="Vetting docs" icon="pi pi-shield" size="small" outlined />
            </RouterLink>
          </div>
        </div>
      </li>
    </ul>
  </section>
</template>
