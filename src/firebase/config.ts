import { initializeApp } from "firebase/app";
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from "firebase/app-check";
import { getAuth, connectAuthEmulator } from "firebase/auth";
import { getFirestore, connectFirestoreEmulator } from "firebase/firestore";
import { getStorage, connectStorageEmulator } from "firebase/storage";
import { getFunctions, connectFunctionsEmulator } from "firebase/functions";
import { getAnalytics, isSupported } from "firebase/analytics";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
};

export const app = initializeApp(firebaseConfig);

// App Check (anti-abuse / bot protection for callables + Firestore + Storage).
// Gated on VITE_RECAPTCHA_SITE_KEY so environments without a key configured
// (local dev, preview builds) don't crash — App Check simply stays off there.
// Turning ENFORCEMENT on is a separate, coordinated step: provision the key,
// ship this init, THEN set ENFORCE_APP_CHECK=true on the Cloud Functions
// runtime (see functions/src/lib/callable.ts). Enforcing before this init is
// live would reject every call.
//
// NOTE: the key must be a reCAPTCHA *Enterprise* site key. If you provision a
// reCAPTCHA v3 key instead, swap ReCaptchaEnterpriseProvider →
// ReCaptchaV3Provider (same import path).
const recaptchaSiteKey: string = import.meta.env.VITE_RECAPTCHA_SITE_KEY ?? "";
if (recaptchaSiteKey) {
  // In dev, let Firebase mint a debug token so App Check works against a
  // local/test build without a real attestation. Register the printed token
  // in the Firebase console under App Check → Apps → Manage debug tokens.
  if (import.meta.env.DEV) {
    (
      self as unknown as { FIREBASE_APPCHECK_DEBUG_TOKEN?: boolean | string }
    ).FIREBASE_APPCHECK_DEBUG_TOKEN = import.meta.env.VITE_APPCHECK_DEBUG_TOKEN ?? true;
  }
  initializeAppCheck(app, {
    provider: new ReCaptchaEnterpriseProvider(recaptchaSiteKey),
    isTokenAutoRefreshEnabled: true,
  });
}

export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);
export const functions = getFunctions(app, "us-central1");

// Analytics is browser-only; safe-guard for SSR / unsupported envs.
export const analyticsPromise = isSupported().then((ok) => (ok ? getAnalytics(app) : null));

// Stripe publishable key for client-side Stripe.js. Safe to ship to the
// browser (it's the public counterpart to the secret key that lives on
// Cloud Functions). Empty in environments where Stripe isn't configured
// yet; the payment view surfaces a clear "Stripe is not configured" error
// in that case instead of crashing.
export const STRIPE_PUBLISHABLE_KEY: string =
  import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY ?? "";

// Only attach to emulators when explicitly opted in.
const useEmulators =
  import.meta.env.DEV && import.meta.env.VITE_USE_EMULATORS === "true";

if (useEmulators) {
  connectAuthEmulator(auth, "http://localhost:9099", { disableWarnings: true });
  connectFirestoreEmulator(db, "localhost", 8080);
  connectStorageEmulator(storage, "localhost", 9199);
  connectFunctionsEmulator(functions, "localhost", 5001);
}
