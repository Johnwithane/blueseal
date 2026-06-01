<script setup lang="ts">
import { onMounted, ref } from "vue";
import { RouterLink } from "vue-router";
import Button from "primevue/button";
import Avatar from "primevue/avatar";
import {
  listPendingApplications,
  backfillTradieContact,
  type BackfillTradieContactResult,
} from "@/firebase/services/tradespeople";
import {
  backfillPayoutsField,
  type BackfillPayoutsResult,
} from "@/firebase/services/payoutsService";
import {
  backfillReviewReviewers,
  type BackfillReviewReviewersResult,
} from "@/firebase/services/reviews";
import {
  backfillJobPostClient,
  type BackfillJobPostClientResult,
} from "@/firebase/services/jobPosts";
import {
  backfillJobPrivateNotes,
  type BackfillJobPrivateNotesResult,
} from "@/firebase/services/jobs";
import { useToast } from "@/composables/useToast";
import { humanizeError } from "@/utils/errors";
import type { TradespersonDoc, WithId } from "@/firebase/interfaces";
import { useFormatters } from "@/composables";
import { tradeLabel } from "@/data/trades";

const pending = ref<WithId<TradespersonDoc>[]>([]);
const loading = ref(true);
const { relativeTime } = useFormatters();
const toast = useToast();

// Migration tools — one-shot admin ops that don't justify their own page.
// `backfillPayoutsField` seeds the new payouts field on existing approved
// tradies; idempotent so a re-click is harmless. Once we're confident
// every prod tradie has the field this card can be removed.
const backfilling = ref(false);
const backfillResult = ref<BackfillPayoutsResult | null>(null);

async function runPayoutsBackfill() {
  backfilling.value = true;
  try {
    backfillResult.value = await backfillPayoutsField();
    const r = backfillResult.value;
    toast.success(
      "Backfill complete",
      `Scanned ${r.scanned}, updated ${r.updated}, already had the field ${r.alreadyPresent}.`,
    );
  } catch (err) {
    toast.error("Backfill failed", humanizeError(err));
  } finally {
    backfilling.value = false;
  }
}

// Mutual-review reviewer backfill — fills clientName + clientPhotoURL on
// /reviews docs that pre-date the denormalization in ReviewPrompt. New
// reviews already carry those fields; this is a one-shot to retroactively
// fix the public tradesperson profile so legacy rows stop rendering the
// "Client" + "C" initial fallback.
const backfillingReviewers = ref(false);
const reviewerBackfillResult = ref<BackfillReviewReviewersResult | null>(null);

async function runReviewerBackfill() {
  backfillingReviewers.value = true;
  try {
    reviewerBackfillResult.value = await backfillReviewReviewers();
    const r = reviewerBackfillResult.value;
    toast.success(
      "Reviewer backfill complete",
      `Scanned ${r.scanned}, updated ${r.updated}, already present ${r.alreadyPresent}` +
        (r.fallbackUsed > 0
          ? ` · ${r.fallbackUsed} reviewer doc${r.fallbackUsed === 1 ? "" : "s"} missing, fell back to "Client".`
          : "."),
    );
  } catch (err) {
    toast.error("Reviewer backfill failed", humanizeError(err));
  } finally {
    backfillingReviewers.value = false;
  }
}

// Job-post client backfill — fills clientName (first-name only) +
// clientPhotoURL on /jobPosts docs that pre-date the denormalization in
// createJobPost. New posts already carry these fields; this is the
// one-shot to fix the browse-jobs feed so legacy posts stop rendering
// the "Client" + initial-circle fallback. Idempotent.
const backfillingJobPostClient = ref(false);
const jobPostClientBackfillResult = ref<BackfillJobPostClientResult | null>(null);

async function runJobPostClientBackfill() {
  backfillingJobPostClient.value = true;
  try {
    jobPostClientBackfillResult.value = await backfillJobPostClient();
    const r = jobPostClientBackfillResult.value;
    toast.success(
      "Job-post client backfill complete",
      `Scanned ${r.scanned}, updated ${r.updated}, already present ${r.alreadyPresent}` +
        (r.fallbackUsed > 0
          ? ` · ${r.fallbackUsed} post${r.fallbackUsed === 1 ? "" : "s"} missing client, fell back to "Client".`
          : "."),
    );
  } catch (err) {
    toast.error("Job-post client backfill failed", humanizeError(err));
  } finally {
    backfillingJobPostClient.value = false;
  }
}

// Private-notes migration — moves legacy job `privateNotes` into the
// tradie-only jobs/{id}/private/notes subdoc and strips the old field off the
// client-readable job doc (closes the F2 leak for pre-existing jobs). Run once
// after the F2 deploy; idempotent. Scanned counts every job, so on a large DB
// this can take a few clicks (it pages and the cursor resumes).
const backfillingPrivateNotes = ref(false);
const privateNotesBackfillResult = ref<BackfillJobPrivateNotesResult | null>(null);

async function runPrivateNotesBackfill() {
  backfillingPrivateNotes.value = true;
  try {
    privateNotesBackfillResult.value = await backfillJobPrivateNotes();
    const r = privateNotesBackfillResult.value;
    toast.success(
      "Private-notes backfill complete",
      `Scanned ${r.scanned}, moved ${r.copied}, stripped-only ${r.strippedOnly}, skipped ${r.skipped}.`,
    );
  } catch (err) {
    toast.error("Private-notes backfill failed", humanizeError(err));
  } finally {
    backfillingPrivateNotes.value = false;
  }
}

// Tradesperson contact migration (F1) — moves exact location + (home) address
// off the world-readable tradesperson doc into the private/contact subdoc and
// derives the coarse public search fields. MUST be run once after the F1
// deploy: until then, discovery returns nothing for un-migrated tradies (they
// have `geohash`, the query now uses `geohashPublic`). Idempotent; re-click on
// a large DB until skipped == scanned.
const backfillingTradieContact = ref(false);
const tradieContactBackfillResult = ref<BackfillTradieContactResult | null>(null);

async function runTradieContactBackfill() {
  backfillingTradieContact.value = true;
  try {
    tradieContactBackfillResult.value = await backfillTradieContact();
    const r = tradieContactBackfillResult.value;
    toast.success(
      "Tradesperson contact migration complete",
      `Scanned ${r.scanned}, migrated ${r.migrated}, skipped ${r.skipped}.`,
    );
  } catch (err) {
    toast.error("Tradesperson contact migration failed", humanizeError(err));
  } finally {
    backfillingTradieContact.value = false;
  }
}

function nameOf(t: WithId<TradespersonDoc>): string {
  return t.displayName?.trim() || tradeLabel(t.trades[0] ?? "") || "Unnamed applicant";
}

function initialOf(t: WithId<TradespersonDoc>): string {
  return nameOf(t).slice(0, 1).toUpperCase() || "?";
}

onMounted(async () => {
  loading.value = true;
  pending.value = await listPendingApplications();
  loading.value = false;
});
</script>

<template>
  <section class="bs-container py-8">
    <div class="flex items-center justify-between mb-6">
      <div>
        <p class="text-[color:var(--bs-muted)]">
          {{ pending.length }} application{{ pending.length === 1 ? "" : "s" }} awaiting review.
        </p>
      </div>
      <div class="flex flex-wrap gap-2">
        <RouterLink to="/admin/users">
          <Button label="User search" icon="pi pi-user-edit" outlined />
        </RouterLink>
        <RouterLink to="/admin/site-content">
          <Button label="Site content" icon="pi pi-pencil" outlined />
        </RouterLink>
        <RouterLink to="/admin/disputes">
          <Button
            label="Disputes"
            icon="pi pi-exclamation-triangle"
            outlined
            severity="warn"
          />
        </RouterLink>
        <RouterLink to="/admin/vetting">
          <Button label="Open vetting queue" icon="pi pi-arrow-right" />
        </RouterLink>
      </div>
    </div>

    <div class="grid sm:grid-cols-3 gap-4 mb-6">
      <div class="bs-card p-5">
        <div class="text-sm text-[color:var(--bs-muted)]">Pending vetting</div>
        <div class="text-3xl font-bold mt-1">{{ pending.length }}</div>
      </div>
      <div class="bs-card p-5">
        <div class="text-sm text-[color:var(--bs-muted)]">Oldest pending</div>
        <div class="text-3xl font-bold mt-1">
          {{ pending.length ? relativeTime(pending[0].submittedAt) : "—" }}
        </div>
      </div>
      <div class="bs-card p-5">
        <div class="text-sm text-[color:var(--bs-muted)]">Region</div>
        <div class="text-3xl font-bold mt-1">CA</div>
      </div>
    </div>

    <div class="bs-card mb-6 p-5">
      <h2 class="text-base font-semibold">Migration tools</h2>
      <p class="mt-1 text-sm text-[color:var(--bs-muted)]">
        One-shot ops for the Stripe Connect cutover. Idempotent — safe to
        re-run. Remove this card once every prod tradie has been backfilled.
      </p>
      <div class="mt-3 flex flex-wrap items-center gap-3">
        <Button
          label="Backfill payouts field"
          icon="pi pi-database"
          :loading="backfilling"
          @click="runPayoutsBackfill"
        />
        <p
          v-if="backfillResult"
          class="text-sm text-[color:var(--bs-muted)] flex-1 min-w-[10rem]"
        >
          Last run: scanned <strong>{{ backfillResult.scanned }}</strong>,
          updated <strong>{{ backfillResult.updated }}</strong>,
          already present <strong>{{ backfillResult.alreadyPresent }}</strong>
          ({{ backfillResult.pages }} page{{ backfillResult.pages === 1 ? "" : "s" }}).
        </p>
      </div>

      <!-- Mutual-review reviewer backfill: fills clientName +
           clientPhotoURL on legacy /reviews docs so the public
           tradesperson profile renders real names + photos instead of
           the "Client" + "C" fallback. New reviews already carry these
           fields; this is the one-shot to fix history. Idempotent. -->
      <div class="mt-3 flex flex-wrap items-center gap-3">
        <Button
          label="Backfill review reviewers"
          icon="pi pi-star"
          :loading="backfillingReviewers"
          @click="runReviewerBackfill"
        />
        <p
          v-if="reviewerBackfillResult"
          class="text-sm text-[color:var(--bs-muted)] flex-1 min-w-[10rem]"
        >
          Last run: scanned <strong>{{ reviewerBackfillResult.scanned }}</strong>,
          updated <strong>{{ reviewerBackfillResult.updated }}</strong>,
          already present <strong>{{ reviewerBackfillResult.alreadyPresent }}</strong>
          <template v-if="reviewerBackfillResult.fallbackUsed > 0">
            · <strong>{{ reviewerBackfillResult.fallbackUsed }}</strong>
            fell back to "Client"
          </template>
          ({{ reviewerBackfillResult.pages }} page{{ reviewerBackfillResult.pages === 1 ? "" : "s" }}).
        </p>
      </div>

      <!-- Job-post client backfill: fills clientName (first-name only) +
           clientPhotoURL on legacy /jobPosts docs so the browse-jobs
           feed renders real names + photos. New posts already carry
           these fields; this is the one-shot to fix history. Idempotent. -->
      <div class="mt-3 flex flex-wrap items-center gap-3">
        <Button
          label="Backfill job-post clients"
          icon="pi pi-user"
          :loading="backfillingJobPostClient"
          @click="runJobPostClientBackfill"
        />
        <p
          v-if="jobPostClientBackfillResult"
          class="text-sm text-[color:var(--bs-muted)] flex-1 min-w-[10rem]"
        >
          Last run: scanned <strong>{{ jobPostClientBackfillResult.scanned }}</strong>,
          updated <strong>{{ jobPostClientBackfillResult.updated }}</strong>,
          already present <strong>{{ jobPostClientBackfillResult.alreadyPresent }}</strong>
          <template v-if="jobPostClientBackfillResult.fallbackUsed > 0">
            · <strong>{{ jobPostClientBackfillResult.fallbackUsed }}</strong>
            fell back to "Client"
          </template>
          ({{ jobPostClientBackfillResult.pages }} page{{ jobPostClientBackfillResult.pages === 1 ? "" : "s" }}).
        </p>
      </div>

      <!-- Private-notes migration: moves legacy job `privateNotes` into the
           tradie-only private/notes subdoc and strips the old field off the
           client-readable job doc. Run once after the F2 deploy. Idempotent;
           on a large DB re-click until skipped == scanned. -->
      <div class="mt-3 flex flex-wrap items-center gap-3">
        <Button
          label="Migrate private job notes"
          icon="pi pi-lock"
          :loading="backfillingPrivateNotes"
          @click="runPrivateNotesBackfill"
        />
        <p
          v-if="privateNotesBackfillResult"
          class="text-sm text-[color:var(--bs-muted)] flex-1 min-w-[10rem]"
        >
          Last run: scanned <strong>{{ privateNotesBackfillResult.scanned }}</strong>,
          moved <strong>{{ privateNotesBackfillResult.copied }}</strong>,
          stripped-only <strong>{{ privateNotesBackfillResult.strippedOnly }}</strong>,
          skipped <strong>{{ privateNotesBackfillResult.skipped }}</strong>
          ({{ privateNotesBackfillResult.pages }} page{{ privateNotesBackfillResult.pages === 1 ? "" : "s" }}).
        </p>
      </div>

      <!-- Tradesperson contact migration (F1): exact location + address out of
           the world-readable doc into private/contact + derive coarse search
           fields. Run once after the F1 deploy. Idempotent; re-click until
           skipped == scanned. -->
      <div class="mt-3 flex flex-wrap items-center gap-3">
        <Button
          label="Migrate tradesperson location"
          icon="pi pi-map-marker"
          :loading="backfillingTradieContact"
          @click="runTradieContactBackfill"
        />
        <p
          v-if="tradieContactBackfillResult"
          class="text-sm text-[color:var(--bs-muted)] flex-1 min-w-[10rem]"
        >
          Last run: scanned <strong>{{ tradieContactBackfillResult.scanned }}</strong>,
          migrated <strong>{{ tradieContactBackfillResult.migrated }}</strong>,
          skipped <strong>{{ tradieContactBackfillResult.skipped }}</strong>
          ({{ tradieContactBackfillResult.pages }} page{{ tradieContactBackfillResult.pages === 1 ? "" : "s" }}).
        </p>
      </div>
    </div>

    <div v-if="loading" class="bs-empty">Loading…</div>
    <div v-else-if="pending.length === 0" class="bs-empty">
      <i class="pi pi-check-circle text-3xl mb-2 block text-green-600"></i>
      <p>Queue clear. Nice work.</p>
    </div>
    <div v-else class="space-y-3">
      <RouterLink
        v-for="t in pending"
        :key="t.id"
        :to="{ name: 'AdminApplication', params: { uid: t.id } }"
        class="bs-card p-4 flex items-center gap-3 no-underline text-inherit hover:shadow-md"
      >
        <Avatar
          v-if="t.photoURL"
          :image="t.photoURL"
          size="large"
          shape="circle"
        />
        <Avatar
          v-else
          :label="initialOf(t)"
          size="large"
          shape="circle"
          style="background-color: var(--bs-blue); color: white; font-weight: 600;"
        />
        <div class="min-w-0 flex-1">
          <div class="font-semibold truncate">{{ nameOf(t) }}</div>
          <div v-if="t.companyName" class="text-xs text-[color:var(--bs-muted)] truncate">
            {{ t.companyName }}
          </div>
          <div class="text-xs text-[color:var(--bs-muted)] truncate">
            {{ t.trades.map(tradeLabel).join(" • ") || "—" }} · Submitted {{ relativeTime(t.submittedAt) }}
          </div>
        </div>
        <i class="pi pi-chevron-right text-[color:var(--bs-muted)]"></i>
      </RouterLink>
    </div>
  </section>
</template>
