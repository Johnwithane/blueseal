<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { RouterLink, useRoute, useRouter } from "vue-router";
import { updateProfile } from "firebase/auth";
import Button from "primevue/button";
import InputText from "primevue/inputtext";
import InputNumber from "primevue/inputnumber";
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
  grantAllTradesForAdminTesting,
  requestAccountDeletion,
  updateNotificationPrefs,
  updateUserProfile,
  updateUserPhoto,
} from "@/firebase/services/users";
import {
  createOrUpdateDraft,
  getTradesperson,
  getTradespersonContact,
  setContactInfo,
  setLocation,
} from "@/firebase/services/tradespeople";
import { setInvoiceNumbering } from "@/firebase/services/billing";
import type { TradespersonDoc, WithId } from "@/firebase/interfaces";
import { uploadFile, makeStoragePath } from "@/firebase/services/storage";
import { compressToWebp } from "@/utils/image";
import { useToast } from "@/composables/useToast";
import { useFormatters } from "@/composables/useFormatters";
import { useGoogleMaps } from "@/composables/useGoogleMaps";
import { humanizeError } from "@/utils/errors";
import { COMMON_LANGUAGES } from "@/data/languages";
import PortfolioEditor from "@/components/PortfolioEditor.vue";
import TradieDocsManager from "@/components/TradieDocsManager.vue";
import VouchesPanel from "@/components/VouchesPanel.vue";
import PayoutsPanel from "@/components/PayoutsPanel.vue";
import GoogleBusinessPanel from "@/components/GoogleBusinessPanel.vue";
import LocationPicker, { type LocationValue } from "@/components/LocationPicker.vue";
import TabBar from "@/components/TabBar.vue";

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
const grantingAllTrades = ref(false);
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
const gstNumber = ref("");
const savingTradieProfile = ref(false);
// Element ref for the businessAddress input — wired to Google Places
// Autocomplete on mount so picking a suggestion fills the formatted address
// in one go. Raw typing still saves (v-model'd), mirroring RequestQuoteView.
const businessAddressEl = ref<HTMLInputElement | null>(null);

// Service area lives on /tradespeople/{uid} (location GeoPoint + geohash +
// serviceRadiusKm + primaryAddressText). Onboarding step 4 sets it; this
// section lets the tradesperson revisit it without re-entering the wizard.
// Hydrated from the tradie doc on mount, saved via createOrUpdateDraft +
// setLocation (the latter recomputes the geohash so BrowseJobs queries
// pick up the move).
const serviceLocation = ref<LocationValue>({
  lat: null,
  lng: null,
  radiusKm: 25,
  label: "",
});
const savingServiceArea = ref(false);

// Company logo — shown at the top of generated invoice + quote PDFs in
// place of the Blue Seal wordmark. Writes the public download URL to
// /tradespeople/{uid}.companyLogoUrl; null when the tradesperson hasn't
// uploaded one (defaults back to the Blue Seal mark on the PDF).
const companyLogoUrl = ref<string | null>(null);
const uploadingLogo = ref(false);
const logoFileInput = ref<HTMLInputElement | null>(null);
const removingLogo = ref(false);

// Invoice / quote numbering customisation. Stamp shape is always
// `${prefix}-${year}-${0001}`; tradies migrating from QuickBooks /
// FreshBooks / etc set the prefix + starting number once. Server-side
// guards reject sequence changes after the first invoice/quote issues.
const invoicePrefix = ref("INV");
const quotePrefix = ref("Q");
const nextInvoiceNumber = ref<number>(1);
const nextQuoteNumber = ref<number>(1);
const initialNextInvoiceNumber = ref<number>(1);
const initialNextQuoteNumber = ref<number>(1);
const savingNumbering = ref(false);

const invoicePrefixError = computed(() => prefixError(invoicePrefix.value));
const quotePrefixError = computed(() => prefixError(quotePrefix.value));
function prefixError(p: string): string | null {
  const v = (p ?? "").trim();
  if (!v) return "Prefix is required.";
  if (v.length > 10) return "Max 10 characters.";
  if (!/^[A-Z0-9](?:[A-Z0-9-]{0,8}[A-Z0-9])?$/.test(v)) {
    return "Use uppercase letters, digits, and dashes only (no leading/trailing dash).";
  }
  return null;
}
// Sequence inputs are read-only once the tradesperson has issued anything
// through Blue Seal — the server-side guard would reject the change anyway
// and we'd rather signal that up front than catch it at submit.
const invoiceSequenceLocked = computed(() => initialNextInvoiceNumber.value > 1);
const quoteSequenceLocked = computed(() => initialNextQuoteNumber.value > 1);

const invoiceSamplePreview = computed(() => {
  const year = new Date().getFullYear();
  const prefix = (invoicePrefix.value ?? "INV").trim() || "INV";
  return `${prefix}-${year}-${String(nextInvoiceNumber.value).padStart(4, "0")}`;
});
const quoteSamplePreview = computed(() => {
  const year = new Date().getFullYear();
  const prefix = (quotePrefix.value ?? "Q").trim() || "Q";
  return `${prefix}-${year}-${String(nextQuoteNumber.value).padStart(4, "0")}`;
});

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

// Controls which Tradesperson accordion panel is open. Normally undefined
// (all closed); we open "google-reviews" when returning from the Google OAuth
// flow so the tradesperson lands right on the freshly-connected panel.
const openTradiePanel = ref<string | undefined>(undefined);

// Handle the return from the Google Business OAuth round-trip. The callback
// function redirects to /account?tab=tradesperson&google=<status>. We toast the
// outcome, open the Google reviews panel, and strip the param so a reload
// doesn't re-fire. Lives here (not in GoogleBusinessPanel) because the panel may
// be collapsed/unmounted when Google redirects back — same split as Payouts.
function handleGoogleReturn() {
  const raw = route.query.google;
  const status = Array.isArray(raw) ? raw[0] : raw;
  if (!status) return;
  switch (status) {
    case "connected":
      toast.success("Google Business connected", "Your Google reviews will appear on your profile.");
      break;
    case "denied":
      toast.info("Connection cancelled", "You didn't grant access to your Google Business Profile.");
      break;
    case "nolocation":
      toast.warn(
        "No business found",
        "That Google account doesn't manage a Business Profile. Connect the account that owns your listing.",
      );
      break;
    default:
      toast.error("Couldn't connect", "Something went wrong connecting Google. Please try again.");
  }
  openTradiePanel.value = "google-reviews";
  const { google: _omit, ...rest } = route.query;
  void _omit;
  void router.replace({ query: rest });
}

onMounted(async () => {
  if (!auth.fbUser) return;
  handleGoogleReturn();
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
      companyLogoUrl.value = t.companyLogoUrl ?? null;
      invoicePrefix.value = t.invoicePrefix ?? "INV";
      quotePrefix.value = t.quotePrefix ?? "Q";
      nextInvoiceNumber.value = t.nextInvoiceNumber ?? 1;
      nextQuoteNumber.value = t.nextQuoteNumber ?? 1;
      initialNextInvoiceNumber.value = t.nextInvoiceNumber ?? 1;
      initialNextQuoteNumber.value = t.nextQuoteNumber ?? 1;
      // Exact location + (home) address + billing contact live in the
      // private contact subdoc, not the public tradesperson doc.
      const contact = await getTradespersonContact(auth.fbUser.uid);
      businessAddress.value = contact?.businessAddress ?? "";
      businessPhone.value = contact?.businessPhone ?? "";
      gstNumber.value = contact?.gstNumber ?? "";
      // Onboarding writes (0,0) into the pin for new drafts; treat that the
      // same as "unset" so the picker opens on the country centroid instead
      // of dropping a pin in the Gulf of Guinea.
      const loc = contact?.location;
      const hasGeo = !!loc && loc.latitude !== 0;
      serviceLocation.value = {
        lat: hasGeo ? loc.latitude : null,
        lng: hasGeo ? loc.longitude : null,
        radiusKm: t.serviceRadiusKm || 25,
        label: contact?.primaryAddressText ?? "",
      };
    }
  }
  // Wire Google Places autocomplete onto the business-address input the
  // same way RequestQuoteView does. Stores the formatted address straight
  // into businessAddress — we don't keep the lat/lng (it's billing copy,
  // not a service-area centre).
  try {
    await useGoogleMaps().load();
    if (businessAddressEl.value) {
      const ac = new google.maps.places.Autocomplete(businessAddressEl.value, {
        fields: ["formatted_address", "name"],
        types: ["geocode"],
        componentRestrictions: { country: "ca" },
      });
      ac.addListener("place_changed", () => {
        const place = ac.getPlace();
        businessAddress.value =
          place?.formatted_address || place?.name || businessAddress.value;
      });
    }
  } catch {
    /* maps failed to load — input still works as a plain text field */
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
    });
    // Billing contact (address override / phone / GST) is private — subdoc.
    await setContactInfo(auth.fbUser.uid, {
      businessAddress: businessAddress.value.trim() || null,
      businessPhone: businessPhone.value.trim() || null,
      gstNumber: gstNumber.value.trim() || null,
    });
    if (tradie.value) {
      tradie.value.companyName = companyName.value.trim() || null;
      tradie.value.languages = [...languages.value];
    }
    toast.success("Tradesperson profile saved");
  } catch (e) {
    error.value = humanizeError(e);
  } finally {
    savingTradieProfile.value = false;
  }
}

// Service area save. Mirrors the wizard's location-save path:
// `createOrUpdateDraft` patches primaryAddressText/serviceRadiusKm/location,
// then `setLocation` rewrites geohash so the BrowseJobs geo query picks up
// the move. Requires lat+lng — without them we tell the tradesperson to
// pick a point on the map (the LocationPicker emits null lat/lng if they
// only adjusted the radius).
async function saveServiceArea() {
  if (!auth.fbUser || !auth.hasTradieRole) return;
  const { lat, lng, radiusKm, label } = serviceLocation.value;
  if (lat == null || lng == null) {
    toast.warn("Pick a point on the map (or use 'My location') before saving.");
    return;
  }
  error.value = null;
  savingServiceArea.value = true;
  try {
    await createOrUpdateDraft(auth.fbUser.uid, {
      serviceRadiusKm: radiusKm,
    });
    // Exact pin + address label go to the private subdoc; setLocation also
    // writes the coarse locationApprox + geohashPublic to the public doc.
    await setLocation(auth.fbUser.uid, lat, lng, label ?? "");
    if (tradie.value) {
      tradie.value.serviceRadiusKm = radiusKm;
    }
    toast.success("Service area saved");
  } catch (e) {
    error.value = humanizeError(e);
  } finally {
    savingServiceArea.value = false;
  }
}

// Share the tradie's public profile link. Uses the native share sheet
// on mobile (iOS/Android picker) and falls back to clipboard on desktop
// where the Web Share API isn't available. Guarded against sharing a
// profile that isn't publicly viewable yet — pre-vetting links 404 for
// recipients and would be confusing to share.
async function shareProfile() {
  if (!auth.fbUser) return;
  if (tradie.value && !tradie.value.isVisible) {
    toast.info(
      "Profile not public yet",
      "Finish verification before sharing your link with clients.",
    );
    return;
  }
  const href = router.resolve({
    name: "TradieProfile",
    params: { uid: auth.fbUser.uid },
  }).href;
  const url =
    typeof window !== "undefined" ? window.location.origin + href : href;
  const title = displayName.value
    ? `${displayName.value} on Blue Seal`
    : "My Blue Seal profile";
  if (typeof navigator !== "undefined" && "share" in navigator) {
    try {
      await navigator.share({ url, title });
      return;
    } catch {
      /* user cancelled — fall through to clipboard */
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    toast.success("Link copied to clipboard");
  } catch {
    toast.error("Couldn't copy link");
  }
}

async function onLogoChange(e: Event) {
  if (!auth.fbUser) return;
  const target = e.target as HTMLInputElement;
  const file = target.files?.[0];
  if (!file) return;
  uploadingLogo.value = true;
  error.value = null;
  try {
    // Bigger max dimension than the profile avatar — invoice headers
    // render the logo at ~38pt on letter-size paper so we want enough
    // resolution to stay crisp on high-DPI screens / printing.
    const compressed = await compressToWebp(file, { maxDimension: 1024, quality: 0.92 });
    const path = makeStoragePath({
      scope: "tradespeople",
      id: auth.fbUser.uid,
      bucket: "logo",
      filename: compressed.name,
    });
    const url = await uploadFile(path, compressed);
    await createOrUpdateDraft(auth.fbUser.uid, { companyLogoUrl: url });
    companyLogoUrl.value = url;
    if (tradie.value) tradie.value.companyLogoUrl = url;
    toast.success("Company logo updated");
  } catch (e) {
    error.value = humanizeError(e);
  } finally {
    uploadingLogo.value = false;
    target.value = "";
  }
}

async function removeLogo() {
  if (!auth.fbUser) return;
  removingLogo.value = true;
  error.value = null;
  try {
    await createOrUpdateDraft(auth.fbUser.uid, { companyLogoUrl: null });
    companyLogoUrl.value = null;
    if (tradie.value) tradie.value.companyLogoUrl = null;
    toast.success("Company logo removed");
  } catch (e) {
    error.value = humanizeError(e);
  } finally {
    removingLogo.value = false;
  }
}

async function saveNumbering() {
  if (!auth.fbUser) return;
  if (invoicePrefixError.value || quotePrefixError.value) {
    toast.warn("Fix the prefix errors before saving.");
    return;
  }
  // Build a partial input — only send fields the user actually changed,
  // and skip the locked starting-number fields so we don't 412 on the
  // server-side guard for tradies who've already issued an invoice.
  const input: {
    invoicePrefix?: string;
    quotePrefix?: string;
    nextInvoiceNumber?: number;
    nextQuoteNumber?: number;
  } = {};
  const trimmedInv = invoicePrefix.value.trim();
  const trimmedQ = quotePrefix.value.trim();
  const currentInv = (tradie.value?.invoicePrefix ?? "INV").trim();
  const currentQ = (tradie.value?.quotePrefix ?? "Q").trim();
  if (trimmedInv && trimmedInv !== currentInv) input.invoicePrefix = trimmedInv;
  if (trimmedQ && trimmedQ !== currentQ) input.quotePrefix = trimmedQ;
  if (
    !invoiceSequenceLocked.value &&
    nextInvoiceNumber.value !== initialNextInvoiceNumber.value
  ) {
    input.nextInvoiceNumber = Math.floor(nextInvoiceNumber.value);
  }
  if (
    !quoteSequenceLocked.value &&
    nextQuoteNumber.value !== initialNextQuoteNumber.value
  ) {
    input.nextQuoteNumber = Math.floor(nextQuoteNumber.value);
  }
  if (Object.keys(input).length === 0) {
    toast.info("Nothing to save", "No numbering changes detected.");
    return;
  }
  savingNumbering.value = true;
  try {
    await setInvoiceNumbering(input);
    if (input.invoicePrefix != null && tradie.value) tradie.value.invoicePrefix = input.invoicePrefix;
    if (input.quotePrefix != null && tradie.value) tradie.value.quotePrefix = input.quotePrefix;
    if (input.nextInvoiceNumber != null) {
      initialNextInvoiceNumber.value = input.nextInvoiceNumber;
      if (tradie.value) tradie.value.nextInvoiceNumber = input.nextInvoiceNumber;
    }
    if (input.nextQuoteNumber != null) {
      initialNextQuoteNumber.value = input.nextQuoteNumber;
      if (tradie.value) tradie.value.nextQuoteNumber = input.nextQuoteNumber;
    }
    toast.success("Invoice numbering saved");
  } catch (e) {
    error.value = humanizeError(e);
  } finally {
    savingNumbering.value = false;
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

async function grantAllTrades() {
  grantingAllTrades.value = true;
  error.value = null;
  try {
    const { count } = await grantAllTradesForAdminTesting();
    // The callable also ensures all roles + an approved tradesperson profile,
    // so refresh claims/roles (same as grantAdminAllRoles) and reload the
    // tradie doc to pick up the new trades + visibility.
    await auth.fbUser?.getIdToken(true);
    await auth.refreshClaims();
    if (auth.fbUser) {
      auth.user = await getUser(auth.fbUser.uid);
      auth.roles = auth.user?.roles ?? auth.roles;
      auth.activeRole = auth.user?.activeRole ?? auth.activeRole;
      tradie.value = await getTradesperson(auth.fbUser.uid);
    }
    toast.success(`All ${count} trades enabled on your testing profile.`);
  } catch (e) {
    error.value = humanizeError(e);
  } finally {
    grantingAllTrades.value = false;
  }
}
</script>

<template>
  <section class="bs-container max-w-2xl pb-6 pt-3">
    <!-- Tradesperson quick-actions. Lives above the tab bar so the public
         profile is always one tap away regardless of which tab is open —
         View + Share are the two things tradies most often need from this
         page. Slim by design (single row, small buttons) so it doesn't
         dominate above the tab nav. -->
    <div
      v-if="auth.hasTradieRole && auth.fbUser"
      class="bs-card mb-3 flex items-center gap-2 p-3 sm:p-4"
    >
      <div class="flex-1 min-w-0">
        <div class="text-sm font-semibold leading-tight">Your public profile</div>
        <div class="mt-0.5 hidden text-xs text-[color:var(--bs-muted)] sm:block">
          What clients see — preview the page or share the link.
        </div>
      </div>
      <RouterLink
        :to="{ name: 'TradieProfile', params: { uid: auth.fbUser.uid } }"
        aria-label="View your public profile"
      >
        <Button label="View" icon="pi pi-eye" size="small" outlined />
      </RouterLink>
      <Button
        label="Share"
        icon="pi pi-share-alt"
        size="small"
        outlined
        severity="secondary"
        aria-label="Share your public profile link"
        @click="shareProfile"
      />
    </div>

    <!-- Sticky tab bar. Mirrors JobTabBar's pattern: icons-only on mobile,
         icon+label on desktop, blue underline for the active tab. Tab state
         is reflected in ?tab= so reloads and deep links stay put. The tab
         row sticks to the top of the AppShell content column (no AppHeader
         above it anymore), so the offset is 0. -->
    <div class="account-tab-bar">
      <TabBar
        :tabs="visibleTabs"
        :model-value="activeTab"
        aria-label="Account sections"
        @update:model-value="setTab($event as TabKey)"
      />
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
      <!-- The "View / Share public profile" quick-action lives above the
           tab row so it's reachable from every tab, not just this one. -->

      <!-- Accordion of trade-specific sections. All closed by default
           (no `value` set) and `:multiple="false"` (default) so only one
           panel opens at a time — reduces visual noise for tradies who
           rarely touch most of these. -->
      <Accordion v-model:value="openTradiePanel">
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
                  <!-- Raw <input> (not InputText) so we can attach Google
                       Places Autocomplete to the DOM node — same pattern as
                       RequestQuoteView. Picking a suggestion fills the
                       formatted address; typing freely still saves. -->
                  <input
                    ref="businessAddressEl"
                    v-model="businessAddress"
                    type="text"
                    class="p-inputtext p-component mt-1 w-full"
                    placeholder="123 Main St, Suite 4, Toronto ON M5V 2T6"
                    autocomplete="off"
                    maxlength="200"
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
                <div>
                  <label class="text-sm font-medium">
                    GST / HST number
                    <span class="text-xs text-[color:var(--bs-muted)] font-normal">Strongly recommended</span>
                  </label>
                  <InputText
                    v-model="gstNumber"
                    class="mt-1 w-full"
                    placeholder="123456789 RT 0001"
                  />
                  <p class="mt-1 text-xs text-[color:var(--bs-muted)]">
                    Your CRA registration number. Required on invoices for
                    clients to claim input tax credits. Leave blank only if
                    you're a small supplier (under $30k/yr) and not registered.
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

            <!-- Company logo. Lives outside the form because it auto-saves
                 on file pick (matches the profile photo pattern). -->
            <div class="mt-4 rounded-lg border border-[color:var(--bs-border)] bg-[color:var(--bs-surface-alt,#f9fafb)] p-3 space-y-3">
              <div class="flex items-center gap-2">
                <i class="pi pi-image text-[color:var(--bs-blue)]"></i>
                <h4 class="text-sm font-semibold m-0">Company logo on invoices</h4>
              </div>
              <p class="text-xs text-[color:var(--bs-muted)] -mt-2">
                Replaces the Blue Seal mark at the top of your invoices and
                quotes. Square images work best — we'll compress to WebP
                under 1024px.
              </p>
              <div class="flex items-center gap-3">
                <img
                  v-if="companyLogoUrl"
                  :src="companyLogoUrl"
                  alt="Company logo"
                  class="h-16 w-16 rounded border border-[color:var(--bs-border)] bg-white object-contain"
                />
                <div
                  v-else
                  class="h-16 w-16 rounded border border-dashed border-[color:var(--bs-border)] flex items-center justify-center text-[color:var(--bs-muted)] bg-white"
                >
                  <i class="pi pi-image text-xl" aria-hidden="true"></i>
                </div>
                <div class="flex flex-col gap-2">
                  <Button
                    :label="companyLogoUrl ? 'Replace logo' : 'Upload logo'"
                    icon="pi pi-upload"
                    outlined
                    size="small"
                    :loading="uploadingLogo"
                    @click="logoFileInput?.click()"
                  />
                  <Button
                    v-if="companyLogoUrl"
                    label="Remove"
                    icon="pi pi-times"
                    severity="danger"
                    text
                    size="small"
                    :loading="removingLogo"
                    @click="removeLogo"
                  />
                  <input
                    ref="logoFileInput"
                    type="file"
                    accept="image/*"
                    class="hidden"
                    @change="onLogoChange"
                  />
                </div>
              </div>
            </div>

            <!-- Invoice / quote numbering. Separate save button since
                 it routes through a Cloud Function callable (validates +
                 guards starting-number on server). -->
            <div class="mt-4 rounded-lg border border-[color:var(--bs-border)] bg-[color:var(--bs-surface-alt,#f9fafb)] p-3 space-y-3">
              <div class="flex items-center gap-2">
                <i class="pi pi-hashtag text-[color:var(--bs-blue)]"></i>
                <h4 class="text-sm font-semibold m-0">Invoice &amp; quote numbering</h4>
              </div>
              <p class="text-xs text-[color:var(--bs-muted)] -mt-2">
                Customise the prefix on generated numbers. Migrating from
                another tracker? Set your starting number once before you
                issue your first invoice or quote through Blue Seal.
              </p>

              <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label class="text-sm font-medium">Invoice prefix</label>
                  <InputText
                    v-model="invoicePrefix"
                    class="mt-1 w-full uppercase"
                    maxlength="10"
                    placeholder="INV"
                  />
                  <p
                    v-if="invoicePrefixError"
                    class="mt-1 text-xs text-red-600"
                  >
                    {{ invoicePrefixError }}
                  </p>
                  <p v-else class="mt-1 text-xs text-[color:var(--bs-muted)]">
                    Sample: <code>{{ invoiceSamplePreview }}</code>
                  </p>
                </div>
                <div>
                  <label class="text-sm font-medium">
                    Next invoice number
                    <span
                      v-if="invoiceSequenceLocked"
                      class="text-xs text-[color:var(--bs-muted)] font-normal ml-1"
                    >Locked</span>
                  </label>
                  <InputNumber
                    v-model="nextInvoiceNumber"
                    :min="1"
                    :max="999999"
                    :use-grouping="false"
                    class="mt-1 w-full"
                    :input-class="'w-full'"
                    :disabled="invoiceSequenceLocked"
                  />
                  <p class="mt-1 text-xs text-[color:var(--bs-muted)]">
                    <template v-if="invoiceSequenceLocked">
                      You've already issued an invoice — contact support to
                      renumber.
                    </template>
                    <template v-else>
                      First invoice gets this number; it increments from there.
                    </template>
                  </p>
                </div>

                <div>
                  <label class="text-sm font-medium">Quote prefix</label>
                  <InputText
                    v-model="quotePrefix"
                    class="mt-1 w-full uppercase"
                    maxlength="10"
                    placeholder="Q"
                  />
                  <p
                    v-if="quotePrefixError"
                    class="mt-1 text-xs text-red-600"
                  >
                    {{ quotePrefixError }}
                  </p>
                  <p v-else class="mt-1 text-xs text-[color:var(--bs-muted)]">
                    Sample: <code>{{ quoteSamplePreview }}</code>
                  </p>
                </div>
                <div>
                  <label class="text-sm font-medium">
                    Next quote number
                    <span
                      v-if="quoteSequenceLocked"
                      class="text-xs text-[color:var(--bs-muted)] font-normal ml-1"
                    >Locked</span>
                  </label>
                  <InputNumber
                    v-model="nextQuoteNumber"
                    :min="1"
                    :max="999999"
                    :use-grouping="false"
                    class="mt-1 w-full"
                    :input-class="'w-full'"
                    :disabled="quoteSequenceLocked"
                  />
                  <p class="mt-1 text-xs text-[color:var(--bs-muted)]">
                    <template v-if="quoteSequenceLocked">
                      You've already issued a quote — contact support to
                      renumber.
                    </template>
                    <template v-else>
                      First quote gets this number; it increments from there.
                    </template>
                  </p>
                </div>
              </div>

              <div class="flex justify-end">
                <Button
                  label="Save numbering"
                  icon="pi pi-save"
                  :loading="savingNumbering"
                  :disabled="!!invoicePrefixError || !!quotePrefixError"
                  @click="saveNumbering"
                />
              </div>
            </div>
          </AccordionContent>
        </AccordionPanel>

        <AccordionPanel value="service-area">
          <AccordionHeader>
            <span class="flex items-center gap-2">
              <i class="pi pi-map-marker"></i>
              Service area
            </span>
          </AccordionHeader>
          <AccordionContent>
            <div class="space-y-3 pt-3">
              <p class="text-sm text-[color:var(--bs-muted)]">
                Set the centre and radius of the area you'll travel to for
                jobs. Clients see your area on your public profile and the
                Browse jobs feed uses it to surface nearby leads.
              </p>
              <LocationPicker v-model="serviceLocation" />
              <div class="flex justify-end">
                <Button
                  label="Save service area"
                  icon="pi pi-save"
                  :loading="savingServiceArea"
                  @click="saveServiceArea"
                />
              </div>
            </div>
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

        <AccordionPanel value="google-reviews">
          <AccordionHeader>
            <span class="flex items-center gap-2">
              <i class="pi pi-google"></i>
              Google reviews
            </span>
          </AccordionHeader>
          <AccordionContent>
            <GoogleBusinessPanel />
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
          v-if="auth.hasAdminRole"
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
              <div class="mt-3 flex flex-wrap gap-2">
                <Button
                  v-if="!(auth.hasClientRole && auth.hasTradieRole)"
                  label="Enable all roles for testing"
                  icon="pi pi-bolt"
                  :loading="grantingAdminAllRoles"
                  @click="grantAdminAllRoles"
                />
                <Button
                  label="Enable all trades (testing)"
                  icon="pi pi-list"
                  severity="secondary"
                  outlined
                  :loading="grantingAllTrades"
                  @click="grantAllTrades"
                />
              </div>
              <p class="mt-2 text-xs text-[color:var(--bs-muted)]">
                "Enable all trades" attaches every trade to your tradesperson
                profile (marked verified) so you can test trade-specific flows.
                To trim them later, edit your trades from
                <RouterLink to="/admin/users" class="underline">Admin → User Search</RouterLink>.
              </p>
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
          <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
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
          <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
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
/* Sticky positioning wrapper; the tab row itself is the shared <TabBar>.
   AppShell renders the page title above this view but doesn't sit between us
   and the viewport edge on scroll, so the sticky offset is 0. */
.account-tab-bar {
  position: sticky;
  top: 0;
  z-index: 10;
  margin-inline: -1rem;
  margin-bottom: 1.5rem;
  padding-inline: 1rem;
  background: white;
  border-bottom: 1px solid var(--bs-border);
}
</style>
