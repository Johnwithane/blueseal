/* global importScripts, firebase */
// FCM background-push service worker. The Firebase SDK registers this file
// itself (scope /firebase-cloud-messaging-push-scope), so it coexists with
// the PWA's Workbox service worker at scope / — they never fight.
//
// Messages are sent server-side (functions/src/lib/notify.ts) with a
// `notification` payload + webpush.fcmOptions.link, so the SDK both displays
// the notification and opens the right page on tap — no custom handlers
// needed here. The config below is the PUBLIC web app config (same values
// shipped in every JS bundle), not a secret.
importScripts("https://www.gstatic.com/firebasejs/11.1.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/11.1.0/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: "AIzaSyBAH4g0acwSAvOO7SFE8j5U4q3RptyjUV8",
  authDomain: "blueseal-762af.firebaseapp.com",
  projectId: "blueseal-762af",
  storageBucket: "blueseal-762af.firebasestorage.app",
  messagingSenderId: "281998435067",
  appId: "1:281998435067:web:3bcae4b11de7937368465e",
});

firebase.messaging();
