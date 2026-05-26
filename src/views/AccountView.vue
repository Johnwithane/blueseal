<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { RouterLink, useRoute, useRouter } from "vue-router";
import { updateProfile } from "firebase/auth";
import Button from "primevue/button";
import InputText from "primevue/inputtext";
import Message from "primevue/message";
import Avatar from "primevue/avatar";
import Dialog from "primevue/dialog";
import Textarea from "primevue/textarea";
import ToggleSwitch from "primevue/toggleswitch";
import MultiSelect from "primevue/multiselect";
import Accordion from "primevue/accordion";
import AccordionPanel from "primevue/accordionpanel";
import AccordionHeader from "primevue/accordionheader";
import AccordionContent from "primevue/accordioncontent";
import { useAuthStore } from "@/stores/auth";
import {
  exportMyData,
  getUser,
  grantAllRolesForAdminTesting,
  requestAccountDeletion,
  updateNotificationPrefs,
  updateUserProfile,
  updateUserPhoto,
} from "@/firebase/services/users";
import {
  createOrUpdateDraft,
  getTradesperson,
} from "@/firebase/services/tradespeople";
import type { TradespersonDoc, WithId } from "@/firebase/interfaces";
import { uploadFile, makeStoragePath } from "@/firebase/services/storage";
import { compressToWebp } from "@/utils/image";
import { useToast } from "@/composables/useToast";
import { useFormatters } from "@/composables/useFormatters";
import { humanizeError } from "@/utils/errors";
import { COMMON_LANGUAGES } from "@/data/languages";
import PortfolioEditor from "@/components/PortfolioEditor.vue";
import TradieDocsManager from "@/components/TradieDocsManager.vue";
import VouchesPanel from "@/components/VouchesPanel.vue";
import PayoutsPanel from "@/components/PayoutsPanel.vue";

const auth = useAuthStore();
const route = useRoute();
const router = useRouter();
const toast = useToast();
const { date } = useFormatters();

const displayName = ref("");
const phone = ref("");
// "About me" — lives on /users/{uid}.bio. For pre-existing tradies who set
// a bio during onboarding (which historically wrote to /tradespeople/{uid}),
// we seed from the tradesperson doc on first load so they don't see an
// empty field. The first save here writes it to users.bio canonically.
const bio = ref("");
const photoURL = ref<string | null>(null);
const email = ref("");
const createdAt = ref<{ toDate(): Date } | null>(null);
const tradie = ref<WithId<TradespersonDoc> | null>(null);
const saving = ref(false);
const uploading = ref(false);
const sendingReset = ref(false);
const addingTradie = ref(false);
const addingClient = ref(false);
const grantingAdminAllRoles = ref(false);
const error = ref<string | null>(null);
const fileInput = ref<HTMLInputElement | null>(null);

// Tradesperson-only trade fields. Pulled from /tradespeople/{uid}; written
// back via createOrUpdateDraft alongside the same denormalized fields the
// onboarding wizard manages. Bio used to live here too — it's now on the
// user doc (see `bio` above) so it shows on the Profile tab for everyone.
const companyName = ref("");
const languages = ref<string[]>([]);
// Billing-side contact info shown on quotes + invoices. businessAddress
// optionally overrides the primary address; blank falls back to it.
const businessAddress = ref("");
const businessPhone = ref("");
const savingTradieProfile = ref(false);

// Privacy section state (PIPEDA — export + delete)
const showDeleteDialog = ref(false);
const deleteConfirmText = ref("");
const deleteReason = ref("");
const deleting = ref(false);
const exporting = ref(false);
const exportUrl = ref<string | null>(null);

// Notification preference state. Defaults match the notify() helper's
// missing-field behavior so legacy users aren't silently opted out.
const emailEnabled = ref(true);
const whatsappEnabled = ref(true);
const savingPrefs = ref(false);

// Tab navigation. The active tab is persisted in the URL (?tab=) so reloads
// and shared links return to the same place. The Tradesperson tab is only
// shown to users with the tradesperson role; if a non-tradie lands on it via
// a URL, we fall back to Profile. Notifications used to be its own tab —
// it's now a section inside Privacy & account since the two are conceptually
// "settings" rather than profile-editing.
type TabKey = "profile" | "tradesperson" | "payouts" | "account";

interface TabDef {
  key: TabKey;
  label: string;
  icon: string;
  visible: boolean;
}

const tabs = computed<TabDef[]>(() => [
  { key: "profile", label: "Profile", icon: "pi-user", visible: true },
  {
    key: "tradesperson",
    label: "Tradesperson",
    icon: "pi-wrench",
    visible: auth.hasTradieRole,
  },
  {
    key: "payouts",
    label: "Payouts",
    icon: "pi-credit-card",
    visible: auth.hasTradieRole,
  },
  { key: "account", label: "Privacy & account", icon: "pi-cog", visible: true },
]);

const visibleTabs = computed(() => tabs.value.filter((t) => t.visible));

const activeTab = computed<TabKey>(() => {
  const raw = route.query.tab;
  const candidate = Array.isArray(raw) ? raw[0] : raw;
  const found = visibleTabs.value.find((t) => t.key === candidate);
  return found ? found.key : "profile";
});

function setTab(key: TabKey) {
  if (key === activeTab.value) return;
  router.replace({ query: { ...route.query, tab: key } });
}

// If the URL points at a tab that's not visible (e.g. ?tab=tradesperson for
// a non-tradie), strip the bad value so the URL matches what's rendered.
watch(
  visibleTabs,
  (list) => {
    const raw = route.query.tab;
    const candidate = Array.isArray(raw) ? raw[0] : raw;
    if (candidate && !list.find((t) => t.key === candidate)) {
      const { tab: _omit, ...rest } = route.query;
      void _omit;
      router.replace({ query: rest });
    }
  },
  { immediate: true },
);

onMounted(async () => {
  if (!auth.fbUser) return;
  const u = await getUser(auth.fbUser.uid);
  if (!u) return;
  displayName.value = u.displayName;
  phone.value = u.phone ?? "";
  photoURL.value = u.photoURL;
  email.value = u.email;
  createdAt.value = u.createdAt;
  // Legacy users may not have prefs yet — default to "everything on" so
  // we don't silently change their notification behavior.
  emailEnabled.value = u.notificationPrefs?.emailEnabled ?? true;
  whatsappEnabled.value = u.notificationPrefs?.whatsappEnabled ?? true;
  // Pull the tradesperson doc to seed the tradie-only trade fields
  // (companyName / languages). The vetting-status banner is rendered
  // globally by TradieStatusBanner.vue so we don't recompute it here.
  if (auth.hasTradieRole) {
    const t = await getTradesperson(auth.fbUser.uid);
    tradie.value = t;
    if (t) {
      companyName.value = t.companyName ?? "";
      languages.value = Array.isArray(t.languages) ? [...t.languages] : [];
      businessAddress.value = t.businessAddress ?? "";
      businessPhone.value = t.businessPhone ?? "";
    }
  }
  // About me: canonical home is users.bio. Pre-existing tradies have their
  // bio on /tradespeople/{uid} from onboarding — seed from there so the
  // field isn't empty for them. First save here writes to users.bio.
  bio.value = u.bio ?? tradie.value?.bio ?? "";
});

async function saveProfile() {
  if (!auth.fbUser) return;
  if (displayName.value.trim().length < 2) {
    error.value = "Display name must be at least 2 characters.";
    return;
  }
  // Match the previous tradesperson-bio minimum so the public profile
  // doesn't end up with a one-word "about me". Empty is fine (optional).
  const trimmedBio = bio.value.trim();
  if (trimmedBio.length > 0 && trimmedBio.length < 20) {
    error.value = "About me should be at least 20 characters, or leave it blank.";
    return;
  }
  error.value = null;
  saving.value = true;
  try {
    await updateUserProfile(auth.fbUser.uid, {
      displayName: displayName.value.trim(),
      phone: phone.value.trim() || null,
      bio: trimmedBio || null,
    });
    // Keep Firebase Auth's display name in sync so the header label stays current.
    await updateProfile(auth.fbUser, { displayName: displayName.value.trim() });
    if (auth.user) {
      auth.user.displayName = displayName.value.trim();
      auth.user.phone = phone.value.trim() || null;
      auth.user.bio = trimmedBio || null;
    }
    toast.success("Profile saved");
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    saving.value = false;
  }
}

// Tradesperson trade fields: companyName / languages live on
// /tradespeople/{uid} (the public profile reads them there). Mirrors the
// wizard's Basics step but skipped here for non-tradies. Bio moved to the
// user doc — saved via saveProfile above. We don't touch vettingStatus —
// pending applications stay pending; createOrUpdateDraft only patches
// what's in the object.
async function saveTradieProfile() {
  if (!auth.fbUser || !auth.hasTradieRole) return;
  error.value = null;
  savingTradieProfile.value = true;
  try {
    await createOrUpdateDraft(auth.fbUser.uid, {
      companyName: companyName.value.trim() || null,
      languages: languages.value,
      businessAddress: businessAddress.value.trim() || null,
      businessPhone: businessPhone.value.trim() || null,
    });
    if (tradie.value) {
      tradie.value.companyName = companyName.value.trim() || null;
      tradie.value.languages = [...languages.value];
      tradie.value.businessAddress = businessAddress.value.trim() || null;
      tradie.value.businessPhone = businessPhone.value.trim() || null;
    }
    toast.success("Tradesperson profile saved");
  } catch (e) {
    error.value = humanizeError(e);
  } finally {
    savingTradieProfile.value = false;
  }
}

async function onPhotoChange(e: Event) {
  if (!auth.fbUser) return;
  const target = e.target as HTMLInputElement;
  const file = target.files?.[0];
  if (!file) return;
  uploading.value = true;
  error.value = null;
  try {
    const compressed = await compressToWebp(file, { maxDimension: 512, quality: 0.9 });
    const path = makeStoragePath({
      scope: "users",
      id: auth.fbUser.uid,
      bucket: "profile",
      filename: compressed.name,
    });
    const url = await uploadFile(path, compressed);
    await updateUserPhoto(auth.fbUser.uid, url);
    await updateProfile(auth.fbUser, { photoURL: url });
    photoURL.value = url;
    if (auth.user) auth.user.photoURL = url;
    toast.success("Photo updated");
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    uploading.value = false;
    target.value = "";
  }
}

const initial = () =>
  (displayName.value || email.value || "?").slice(0, 1).toUpperCase();

async function sendPasswordReset() {
  if (!email.value) return;
  sendingReset.value = true;
  error.value = null;
  try {
    await auth.sendPasswordReset(email.value);
    toast.success("Reset link sent — check your inbox");
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    sendingReset.value = false;
  }
}

const ROLE_LABEL: Record<string, string> = {
  client: "Client",
  tradesperson: "Tradesperson",
  admin: "Admin",
};

async function becomeTradesperson() {
  addingTradie.value = true;
  error.value = null;
  try {
    await auth.addRole("tradesperson");
    toast.success("Tradesperson profile created — let's get you set up.");
    router.push("/onboarding");
  } catch (e) {
    error.value = humanizeError(e);
  } finally {
    addingTradie.value = false;
  }
}

async function addClientView() {
  addingClient.value = true;
  error.value = null;
  try {
    await auth.addRole("client");
    toast.success("Client view enabled.");
  } catch (e) {
    error.value = humanizeError(e);
  } finally {
    addingClient.value = false;
  }
}

async function switchView(role: "client" | "tradesperson" | "admin") {
  try {
    await auth.switchActiveRole(role);
    toast.success(`Switched to ${ROLE_LABEL[role]} view`);
    router.push("/dashboard");
  } catch (e) {
    error.value = humanizeError(e);
  }
}

async function savePrefs() {
  if (!auth.fbUser) return;
  savingPrefs.value = true;
  error.value = null;
  try {
    await updateNotificationPrefs(auth.fbUser.uid, {
      emailEnabled: emailEnabled.value,
      whatsappEnabled: whatsappEnabled.value,
    });
    if (auth.user) {
      auth.user.notificationPrefs = {
        emailEnabled: emailEnabled.value,
        whatsappEnabled: whatsappEnabled.value,
      };
    }
    toast.success("Notification preferences saved");
  } catch (e) {
    error.value = humanizeError(e);
  } finally {
    savingPrefs.value = false;
  }
}

async function exportData() {
  exporting.value = true;
  exportUrl.value = null;
  error.value = null;
  try {
    const { url } = await exportMyData();
    exportUrl.value = url;
    toast.success(
      "Export ready",
      "We've emailed you the download link. You can also click below.",
    );
  } catch (e) {
    error.value = humanizeError(e);
  } finally {
    exporting.value = false;
  }
}

function openDeleteDialog() {
  deleteConfirmText.value = "";
  deleteReason.value = "";
  showDeleteDialog.value = true;
}

async function confirmDelete() {
  if (deleteConfirmText.value.trim().toUpperCase() !== "DELETE") {
    toast.warn("Type DELETE to confirm.");
    return;
  }
  deleting.value = true;
  error.value = null;
  try {
    await requestAccountDeletion(deleteReason.value.trim() || undefined);
    toast.success(
      "Account scheduled for deletion",
      "You're being signed out. We'll permanently wipe your data in 30 days.",
    );
    showDeleteDialog.value = false;
    // Brief delay so the toast renders before the auth state flips and
    // routes us away.
    setTimeout(async () => {
      await auth.signOut();
      router.push({ name: "Home" });
    }, 600);
  } catch (e) {
    error.value = humanizeError(e);
  } finally {
    deleting.value = false;
  }
}

async function signOut() {
  try {
    await auth.signOut();
    router.push({ name: "Home" });
  } catch (e) {
    error.value = humanizeError(e);
  }
}

async function grantAdminAllRoles() {
  grantingAdminAllRoles.value = true;
  error.value = null;
  try {
    await grantAllRolesForAdminTesting();
    // Refresh the token so the new roles claim is visible to rules; then
    // refresh local state by re-running the auth store init pathway.
    await auth.fbUser?.getIdToken(true);
    await auth.refreshClaims();
    if (auth.fbUser) auth.user = await getUser(auth.fbUser.uid);
    auth.roles = auth.user?.roles ?? auth.roles;
    auth.activeRole = auth.user?.activeRole ?? auth.activeRole;
    toast.success("All roles enabled for testing — try switching views!");
  } catch (e) {
    error.value = humanizeError(e);
  } finally {
    grantingAdminAllRoles.value = false;
  }
}
</script>

<template>
  <section class="bs-container max-w-2xl py-6">
    <!-- Sticky tab bar. Mirrors JobTabBar's pattern: icons-only on mobile,
         icon+label on desktop, blue underline for the active tab. Tab state
         is reflected in ?tab= so reloads and deep links stay put. The tab
         row sticks to the top of the AppShell content column (no AppHeader
         above it anymore), so the offset is 0. -->
    <div role="tablist" aria-label="Account sections" class="account-tab-row">
      <button
        v-for="t in visibleTabs"
        :key="t.key"
        type="button"
        role="tab"
        :aria-selected="activeTab === t.key"
        :aria-label="t.label"
        :tabindex="activeTab === t.key ? 0 : -1"
        class="account-tab"
        :class="{ 'account-tab--active': activeTab === t.key }"
        @click="setTab(t.key)"
      >
        <i :class="['pi', t.icon, 'account-tab-icon']" aria-hidden="true"></i>
        <span class="account-tab-label">{{ t.label }}</span>
      </button>
    </div>

    <Message v-if="error" severity="error" :closable="false" class="mb-4">{{ error }}</Message>

    <!-- PROFILE TAB ----------------------------------------------------- -->
    <div v-show="activeTab === 'profile'">
      <div class="bs-card p-5">
        <div class="flex items-center gap-4">
          <div class="relative">
            <Avatar
              v-if="photoURL"
              :image="photoURL"
              size="xlarge"
              shape="circle"
            />
            <Avatar
              v-else
              :label="initial()"
              size="xlarge"
              shape="circle"
              style="background-color: var(--bs-blue); color: white;"
            />
          </div>
          <div>
            <Button
              :label="uploading ? 'Uploading…' : 'Change photo'"
              icon="pi pi-camera"
              outlined
              :loading="uploading"
              @click="fileInput?.click()"
            />
            <p class="mt-1 text-xs text-[color:var(--bs-muted)]">
              JPG/PNG/HEIC — we'll compress to WebP under 512px.
            </p>
            <input
              ref="fileInput"
              type="file"
              accept="image/*"
              class="hidden"
              @change="onPhotoChange"
            />
          </div>
        </div>
      </div>

      <form class="bs-card bs-form mt-4 space-y-4 p-5" @submit.prevent="saveProfile">
        <div>
          <label class="text-sm font-medium">Display name</label>
          <InputText v-model="displayName" class="mt-1 w-full" autocomplete="name" />
        </div>
        <div>
          <label class="text-sm font-medium">Phone (optional)</label>
          <InputText v-model="phone" class="mt-1 w-full" autocomplete="tel" type="tel" />
        </div>
        <div>
          <label class="text-sm font-medium">Email</label>
          <InputText :model-value="email" disabled class="mt-1 w-full" />
          <small class="text-[color:var(--bs-muted)]">
            Email changes aren't supported in MVP. Contact support.
          </small>
        </div>
        <div>
          <label class="text-sm font-medium">
            About me
            <span class="text-xs text-[color:var(--bs-muted)] font-normal">Optional</span>
          </label>
          <Textarea
            v-model="bio"
            rows="5"
            class="mt-1 w-full"
            placeholder="A few sentences about you. Tradespeople: this is what clients read first on your public profile."
          />
          <p class="mt-1 text-xs text-[color:var(--bs-muted)]">
            Leave blank, or write at least 20 characters.
          </p>
        </div>
        <div class="flex justify-end">
          <Button type="submit" label="Save changes" icon="pi pi-save" :loading="saving" />
        </div>
      </form>
    </div>

    <!-- TRADESPERSON TAB ------------------------------------------------ -->
    <div v-if="auth.hasTradieRole" v-show="activeTab === 'tradesperson'">
      <!-- View-my-profile shortcut stays as a non-collapsible card at the
           top — it's a quick link, not a section. Owner read always passes
           regardless of isVisible, so the tradesperson can preview their
           page even pre-vetting; TradieProfileView shows a banner in that
           state. -->
      <div v-if="auth.fbUser" class="bs-card p-5 flex items-start gap-3">
        <i
          class="pi pi-user text-2xl mt-0.5 text-[color:var(--bs-blue)]"
          aria-hidden="true"
        ></i>
        <div class="flex-1 min-w-0">
          <h2 class="text-lg font-semibold">Your public profile</h2>
          <p class="mt-1 text-sm text-[color:var(--bs-muted)]">
            Preview the page clients see when they land on your profile.
          </p>
        </div>
        <RouterLink
          :to="{ name: 'TradieProfile', params: { uid: auth.fbUser.uid } }"
          class="shrink-0"
        >
          <Button
            label="View my profile"
            icon="pi pi-arrow-right"
            icon-pos="right"
            outlined
          />
        </RouterLink>
      </div>

      <!-- Accordion of trade-specific sections. All closed by default
           (no `value` set) and `:multiple="false"` (default) so only one
           panel opens at a time — reduces visual noise for tradies who
           rarely touch most of these. -->
      <Accordion class="mt-4">
        <AccordionPanel value="trade-profile">
          <AccordionHeader>
            <span class="flex items-center gap-2">
              <i class="pi pi-wrench"></i>
              Trade profile
            </span>
          </AccordionHeader>
          <AccordionContent>
            <form class="bs-form space-y-4 pt-3" @submit.prevent="saveTradieProfile">
              <p class="text-sm text-[color:var(--bs-muted)]">
                What clients see on your public profile. You can also edit
                these during onboarding.
              </p>
              <div>
                <label class="text-sm font-medium">
                  Company / business name
                  <span class="text-xs text-[color:var(--bs-muted)] font-normal">Optional</span>
                </label>
                <InputText
                  v-model="companyName"
                  class="mt-1 w-full"
                  placeholder="e.g. ABC Mechanical Ltd."
                />
                <p class="mt-1 text-xs text-[color:var(--bs-muted)]">
                  Leave blank if you operate as a sole proprietor.
                </p>
              </div>
              <div>
                <label class="text-sm font-medium">
                  Languages you work in
                  <span class="text-xs text-[color:var(--bs-muted)] font-normal">Optional</span>
                </label>
                <MultiSelect
                  v-model="languages"
                  :options="COMMON_LANGUAGES"
                  placeholder="Select all that apply"
                  class="mt-1 w-full"
                  filter
                  :max-selected-labels="6"
                />
                <p class="mt-1 text-xs text-[color:var(--bs-muted)]">
                  Helps clients who'd prefer to be served in a specific language.
                </p>
              </div>

              <!-- Billing info block. The text on quotes and invoices uses
                   these fields so clients see a real business address +
                   phone number on the paperwork. -->
              <div class="rounded-lg border border-[color:var(--bs-border)] bg-[color:var(--bs-surface-alt,#f9fafb)] p-3 space-y-3">
                <div class="flex items-center gap-2">
                  <i class="pi pi-receipt text-[color:var(--bs-blue)]"></i>
                  <h4 class="text-sm font-semibold m-0">Billing info on invoices</h4>
                </div>
                <p class="text-xs text-[color:var(--bs-muted)] -mt-2">
                  Shown on every quote and invoice you send. Clients use this
                  to mail payment or reach you with billing questions.
                </p>
                <div>
                  <label class="text-sm font-medium">
                    Business address
                    <span class="text-xs text-red-600 font-normal ml-1">Required for invoices</span>
                  </label>
                  <InputText
                    v-model="businessAddress"
                    class="mt-1 w-full"
                    placeholder="123 Main St, Suite 4, Toronto ON M5V 2T6"
                  />
                  <p class="mt-1 text-xs text-[color:var(--bs-muted)]">
                    Where you're registered for business. Leave blank to fall
                    back to your primary service address from onboarding.
                  </p>
                </div>
                <div>
                  <label class="text-sm font-medium">
                    Business phone
                    <span class="text-xs text-[color:var(--bs-muted)] font-normal">Optional</span>
                  </label>
                  <InputText
                    v-model="businessPhone"
                    class="mt-1 w-full"
                    placeholder="(416) 555-0199"
                  />
                  <p class="mt-1 text-xs text-[color:var(--bs-muted)]">
                    A direct billing number. Different from your personal
                    profile phone — leave blank to skip.
                  </p>
                </div>
              </div>

              <div class="flex justify-end">
                <Button
                  type="submit"
                  label="Save trade profile"
                  icon="pi pi-save"
                  :loading="savingTradieProfile"
                />
              </div>
            </form>
          </AccordionContent>
        </AccordionPanel>

        <AccordionPanel value="portfolio">
          <AccordionHeader>
            <span class="flex items-center gap-2">
              <i class="pi pi-images"></i>
              Portfolio
            </span>
          </AccordionHeader>
          <AccordionContent>
            <PortfolioEditor
              v-if="auth.fbUser"
              :tradie-uid="auth.fbUser.uid"
            />
          </AccordionContent>
        </AccordionPanel>

        <AccordionPanel value="documents">
          <AccordionHeader>
            <span class="flex items-center gap-2">
              <i class="pi pi-id-card"></i>
              Documents
            </span>
          </AccordionHeader>
          <AccordionContent>
            <TradieDocsManager
              v-if="auth.fbUser"
              :tradie-uid="auth.fbUser.uid"
            />
          </AccordionContent>
        </AccordionPanel>

        <AccordionPanel value="recommendations">
          <AccordionHeader>
            <span class="flex items-center gap-2">
              <i class="pi pi-thumbs-up"></i>
              Recommendations
            </span>
          </AccordionHeader>
          <AccordionContent>
            <p class="mb-3 text-sm text-[color:var(--bs-muted)]">
              Endorse tradespeople you've worked with. Once accepted, the
              recommendation appears on both your profile and theirs.
            </p>
            <VouchesPanel />
          </AccordionContent>
        </AccordionPanel>
      </Accordion>
    </div>

    <!-- PAYOUTS TAB ----------------------------------------------------- -->
    <div v-if="auth.hasTradieRole" v-show="activeTab === 'payouts'">
      <PayoutsPanel />
    </div>

    <!-- PRIVACY & ACCOUNT TAB ------------------------------------------ -->
    <!-- Holds: roles, password, notifications, privacy/PIPEDA, account
         meta, sign out. Notifications used to be its own tab — it's
         settings-shaped so it lives alongside the other account settings. -->
    <div v-show="activeTab === 'account'">
      <!-- Roles / view-switching -->
      <div class="bs-card p-5">
        <h2 class="text-lg font-semibold">Your roles</h2>
        <p class="mt-1 text-sm text-[color:var(--bs-muted)]">
          You can hold both views on one account. Switch between them anytime.
        </p>

        <ul class="mt-3 space-y-2">
          <li
            v-for="r in auth.roles"
            :key="r"
            class="flex items-center justify-between rounded-lg border border-[color:var(--bs-border)] px-3 py-2"
          >
            <span class="flex items-center gap-2 text-sm font-medium">
              <i
                :class="r === 'tradesperson' ? 'pi pi-wrench' : r === 'admin' ? 'pi pi-shield' : 'pi pi-user'"
              ></i>
              {{ ROLE_LABEL[r] }}
              <span
                v-if="auth.activeRole === r"
                class="ml-1 rounded-full bg-[color:var(--bs-blue-light)] px-2 py-0.5 text-xs text-[color:var(--bs-blue-dark)]"
              >
                Active
              </span>
            </span>
            <Button
              v-if="auth.activeRole !== r"
              label="Switch to this view"
              size="small"
              text
              @click="switchView(r as 'client' | 'tradesperson' | 'admin')"
            />
          </li>
        </ul>

        <div v-if="!auth.hasTradieRole" class="mt-4 rounded-lg bg-[color:var(--bs-surface-alt)] p-4">
          <div class="flex items-start gap-3">
            <i class="pi pi-verified text-2xl text-[color:var(--bs-blue)]"></i>
            <div class="flex-1">
              <h3 class="font-semibold">Become a tradesperson</h3>
              <p class="mt-1 text-sm text-[color:var(--bs-muted)]">
                Add a verified tradesperson profile to your account. You'll need
                to upload a trade certification and government-issued ID for our
                vetting team to review.
              </p>
              <div class="mt-3">
                <Button
                  label="Get started"
                  icon="pi pi-arrow-right"
                  icon-pos="right"
                  :loading="addingTradie"
                  @click="becomeTradesperson"
                />
              </div>
            </div>
          </div>
        </div>

        <div v-if="!auth.hasClientRole" class="mt-4 rounded-lg bg-[color:var(--bs-surface-alt)] p-4">
          <div class="flex items-start gap-3">
            <i class="pi pi-user-plus text-2xl text-[color:var(--bs-blue)]"></i>
            <div class="flex-1">
              <h3 class="font-semibold">Hire a tradesperson too</h3>
              <p class="mt-1 text-sm text-[color:var(--bs-muted)]">
                Need work done at your own place? Add a client view to request
                quotes and chat with verified tradespeople.
              </p>
              <div class="mt-3">
                <Button
                  label="Add client view"
                  icon="pi pi-plus"
                  outlined
                  :loading="addingClient"
                  @click="addClientView"
                />
              </div>
            </div>
          </div>
        </div>

        <div
          v-if="auth.hasAdminRole && !(auth.hasClientRole && auth.hasTradieRole)"
          class="mt-4 rounded-lg border border-dashed border-[color:var(--bs-border)] p-4"
        >
          <div class="flex items-start gap-3">
            <i class="pi pi-shield text-2xl text-[color:var(--bs-blue)]"></i>
            <div class="flex-1">
              <h3 class="font-semibold">Admin testing</h3>
              <p class="mt-1 text-sm text-[color:var(--bs-muted)]">
                Grant yourself all three roles and a visible tradesperson profile
                so you can dogfood the full client + tradesperson surface
                (post jobs, browse the marketplace, submit applications).
              </p>
              <div class="mt-3">
                <Button
                  label="Enable all roles for testing"
                  icon="pi pi-bolt"
                  :loading="grantingAdminAllRoles"
                  @click="grantAdminAllRoles"
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Password -->
      <div class="bs-card mt-4 p-5">
        <h2 class="text-lg font-semibold">Password</h2>
        <p class="mt-1 text-sm text-[color:var(--bs-muted)]">
          We'll email you a secure link to change your password.
        </p>
        <div class="mt-3 flex justify-end">
          <Button
            label="Send password reset email"
            icon="pi pi-envelope"
            outlined
            :loading="sendingReset"
            :disabled="!email"
            @click="sendPasswordReset"
          />
        </div>
      </div>

      <!-- Notifications (folded in from its old standalone tab) -->
      <div class="bs-card mt-4 p-5">
        <h2 class="text-lg font-semibold">Notifications</h2>
        <p class="mt-1 text-sm text-[color:var(--bs-muted)]">
          The in-app inbox always shows new activity. Choose how you'd like
          to be reached for important events outside the app.
        </p>

        <div class="mt-4 space-y-3">
          <div
            class="flex items-start justify-between gap-3 rounded-lg border border-[color:var(--bs-border)] p-3"
          >
            <div>
              <div class="font-medium">Email</div>
              <p class="text-xs text-[color:var(--bs-muted)] mt-0.5">
                For most events. Time-critical ones also send WhatsApp if enabled.
              </p>
            </div>
            <ToggleSwitch v-model="emailEnabled" />
          </div>

          <div
            class="flex items-start justify-between gap-3 rounded-lg border border-[color:var(--bs-border)] p-3"
          >
            <div>
              <div class="font-medium">WhatsApp</div>
              <p class="text-xs text-[color:var(--bs-muted)] mt-0.5">
                For time-critical events (new job request, vetting decision,
                accepted application). Uses the phone number on your profile.
              </p>
            </div>
            <ToggleSwitch v-model="whatsappEnabled" />
          </div>
        </div>

        <div class="mt-4 flex justify-end">
          <Button
            label="Save preferences"
            icon="pi pi-save"
            :loading="savingPrefs"
            @click="savePrefs"
          />
        </div>
      </div>

      <!-- Privacy / data -->
      <div class="bs-card mt-4 p-5">
        <h2 class="text-lg font-semibold">Privacy &amp; your data</h2>
        <p class="mt-1 text-sm text-[color:var(--bs-muted)]">
          Under Canada's PIPEDA you can download your personal data or delete
          your account at any time.
        </p>

        <div class="mt-4 rounded-lg border border-[color:var(--bs-border)] p-4">
          <div class="flex items-start justify-between gap-3">
            <div>
              <h3 class="font-semibold">Download your data</h3>
              <p class="mt-1 text-sm text-[color:var(--bs-muted)]">
                We'll bundle every Firestore record you're a party to into a
                single JSON file and email you a private 30-day download link.
                Chat messages are excluded for size; you can still read them
                while signed in.
              </p>
            </div>
            <Button
              label="Export my data"
              icon="pi pi-download"
              outlined
              :loading="exporting"
              @click="exportData"
            />
          </div>
          <a
            v-if="exportUrl"
            :href="exportUrl"
            target="_blank"
            rel="noopener"
            class="mt-3 inline-block text-sm text-[color:var(--bs-blue)]"
          >
            Download now →
          </a>
        </div>

        <div class="mt-4 rounded-lg border border-red-200 bg-red-50/30 p-4">
          <div class="flex items-start justify-between gap-3">
            <div>
              <h3 class="font-semibold text-red-700">Delete my account</h3>
              <p class="mt-1 text-sm text-[color:var(--bs-muted)]">
                Marks your account for deletion. You'll be signed out, your
                profile will be hidden from search immediately, and we'll wipe
                your data permanently after 30 days. Reply to the confirmation
                email within that window to recover.
              </p>
            </div>
            <Button
              label="Delete account"
              icon="pi pi-trash"
              severity="danger"
              outlined
              @click="openDeleteDialog"
            />
          </div>
        </div>
      </div>

      <!-- Member meta -->
      <div class="bs-card mt-4 p-5 text-sm text-[color:var(--bs-muted)]">
        <div><strong>Member since:</strong> {{ date(createdAt) }}</div>
        <div class="mt-2 break-all"><strong>UID:</strong> <code>{{ auth.fbUser?.uid }}</code></div>
      </div>

      <!-- Sign out lives at the very bottom of the tab so it's a deliberate
           action — you scroll past your roles, password, data, and meta to
           get to it. Avoids accidental taps that used to be a risk with the
           one-click avatar dropdown. -->
      <div class="mt-6 flex justify-center">
        <Button
          label="Sign out"
          icon="pi pi-sign-out"
          severity="secondary"
          outlined
          @click="signOut"
        />
      </div>
    </div>

    <Dialog
      v-model:visible="showDeleteDialog"
      modal
      header="Delete this account?"
      :style="{ width: '32rem', maxWidth: '92vw' }"
    >
      <p class="text-sm text-[color:var(--bs-text)] mb-3">
        Your profile will be hidden immediately and your data will be wiped
        permanently in 30 days. Reply to the confirmation email within that
        window to recover.
      </p>
      <p class="text-sm font-medium mt-3 mb-1">
        Type <code>DELETE</code> to confirm:
      </p>
      <InputText
        v-model="deleteConfirmText"
        class="w-full"
        placeholder="DELETE"
        autofocus
      />
      <p class="text-sm font-medium mt-4 mb-1">Reason (optional)</p>
      <Textarea
        v-model="deleteReason"
        rows="3"
        class="w-full"
        placeholder="Helps us improve. Not required."
        :maxlength="2000"
      />
      <template #footer>
        <Button label="Keep account" text @click="showDeleteDialog = false" />
        <Button
          label="Delete my account"
          icon="pi pi-trash"
          severity="danger"
          :loading="deleting"
          :disabled="deleteConfirmText.trim().toUpperCase() !== 'DELETE'"
          @click="confirmDelete"
        />
      </template>
    </Dialog>
  </section>
</template>

<style scoped>
/* Tab bar — mirrors src/features/jobDetail/JobTabBar.vue. AppShell renders
   the page title above this view but doesn't sit between us and the
   viewport edge on scroll, so the sticky offset is 0. */
.account-tab-row {
  position: sticky;
  top: 0;
  z-index: 10;
  display: flex;
  gap: 0;
  margin-inline: -1rem;
  margin-bottom: 1.5rem;
  padding-inline: 1rem;
  background: white;
  border-bottom: 1px solid var(--bs-border);
  overflow-x: auto;
  -ms-overflow-style: none;
  scrollbar-width: none;
}
.account-tab-row::-webkit-scrollbar {
  display: none;
}

.account-tab {
  position: relative;
  flex: 1 1 0;
  min-width: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  padding: 0.75rem 0.5rem;
  background: transparent;
  border: 0;
  border-bottom: 2px solid transparent;
  color: var(--bs-muted);
  font-size: 0.875rem;
  font-weight: 500;
  letter-spacing: -0.01em;
  cursor: pointer;
  white-space: nowrap;
  transition: color 120ms ease, border-color 120ms ease;
  min-height: 44px;
}

.account-tab:hover {
  color: var(--bs-text);
}

.account-tab--active {
  color: var(--bs-blue);
  border-bottom-color: var(--bs-blue);
  font-weight: 600;
}

.account-tab:focus-visible {
  outline: 2px solid var(--bs-blue);
  outline-offset: -2px;
}

.account-tab-icon {
  font-size: 1.05rem;
  line-height: 1;
}

/* Mobile: icons only (label still in DOM for screen readers via aria-label
   on the button itself). */
.account-tab-label {
  display: none;
}

@media (min-width: 640px) {
  .account-tab-label {
    display: inline;
  }
  .account-tab-icon {
    font-size: 0.95rem;
  }
}
</style>
