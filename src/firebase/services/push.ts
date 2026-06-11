import { app, db } from "@/firebase/config";
import { deleteDoc, doc, serverTimestamp, setDoc } from "firebase/firestore";
import { deleteToken, getMessaging, getToken, isSupported } from "firebase/messaging";

// Web push (FCM) registration for this device. Opt-in is per-device: enabling
// stores the FCM token at users/{uid}/devices/{token} (doc id = token, so
// notify()'s dead-token cleanup can delete by id); disabling revokes the
// token and removes the doc. notify() fans out to every registered device.
//
// The VAPID key is the public Web Push certificate from Firebase Console →
// Cloud Messaging → Web configuration. Until it's set in the env, the whole
// feature reports unsupported and the UI stays hidden (see HUMANTASKS.md).

const VAPID_KEY = (import.meta.env.VITE_FIREBASE_VAPID_KEY as string | undefined) ?? "";
const LOCAL_KEY = "bs-push-token";

export function pushConfigured(): boolean {
  return VAPID_KEY.length > 0;
}

/** Browser + config support. iOS Safari only supports push once the PWA is
 *  installed to the home screen (16.4+), so this is genuinely dynamic. */
export async function pushSupported(): Promise<boolean> {
  if (!pushConfigured()) return false;
  if (typeof window === "undefined" || typeof Notification === "undefined") return false;
  try {
    return await isSupported();
  } catch {
    return false;
  }
}

/** Whether THIS device finished the opt-in (permission can still be revoked
 *  browser-side; callers should also check Notification.permission). */
export function pushEnabledLocally(): boolean {
  try {
    return !!localStorage.getItem(LOCAL_KEY);
  } catch {
    return false;
  }
}

export async function enablePush(uid: string): Promise<void> {
  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    throw new Error(
      "Notifications are blocked for Blue Seal — allow them in your browser settings, then try again.",
    );
  }
  const token = await getToken(getMessaging(app), { vapidKey: VAPID_KEY });
  if (!token) throw new Error("Couldn't register this device for notifications.");
  await setDoc(doc(db, "users", uid, "devices", token), {
    token,
    userAgent: (navigator.userAgent || "").slice(0, 300),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  try {
    localStorage.setItem(LOCAL_KEY, token);
  } catch {
    /* private mode — server-side registration still worked */
  }
}

export async function disablePush(uid: string): Promise<void> {
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(LOCAL_KEY);
  } catch {
    /* ignore */
  }
  try {
    await deleteToken(getMessaging(app));
  } catch {
    /* token already invalid/gone — deleting the doc below still stops sends */
  }
  if (stored) {
    await deleteDoc(doc(db, "users", uid, "devices", stored)).catch(() => {});
  }
  try {
    localStorage.removeItem(LOCAL_KEY);
  } catch {
    /* ignore */
  }
}
