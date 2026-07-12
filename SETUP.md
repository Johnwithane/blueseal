# Loadout — Setup Runbook

> Step-by-step setup for the tour-management app, built by forking the Blue Seal scaffolding. Mirrors `TECH_STACK_SETUP.md`'s style: every step is **`HUMAN`** (you, at your computer / in a browser console — this cloud session can't log into your Google account) or **`CLAUDE`** (I do it in the repo).
>
> **Two things gate the very first step and nothing else:** the **GitHub repo name** and the **Firebase project ID**. Both can be a throwaway slug now and rebranded later (GitHub repos rename freely; a Firebase *project ID* is permanent but can differ from your public brand). Everywhere below, `<PROJECT>` = that slug.
>
> **We keep `CLAUDE.md` exactly as-is** — it's the build-discipline doc and carries over unchanged. (Only its one "Project context" paragraph still describes Blue Seal; edit that line whenever you like — it doesn't affect anything.)
>
> Reference: the full design is in `MASTER_TOUR_CLONE_PLAN.md` (esp. §13 KEEP/REPLACE, §16 integrations).

---

## Prerequisites `HUMAN`

You almost certainly have these from Blue Seal:
- **Node 20+**, **git**, and the **Firebase CLI** (`npm i -g firebase-tools`).
- A **Google account** you'll use for Firebase.
- **A billing account (Blaze plan).** Required — Cloud Functions, and the Google/Vertex/FlightAware calls, don't run on the free Spark plan. Set a **budget alert** so there are no surprises (§16.5 in the plan explains the cost-control design: server-side proxy + Firestore caching keeps it cheap).

---

## Stage 1 — GitHub repo (fork the scaffolding) `HUMAN` + `CLAUDE`

We start from the Blue Seal codebase and strip it to the shared scaffolding.

**1a. `HUMAN` — create the empty repo.** On GitHub → New repository → name `<PROJECT>`, **Private**, do **not** add README/gitignore/license.

**1b. `HUMAN` — seed it from Blue Seal** (run on your machine; drops Blue Seal's git history so it's a clean start):
```bash
git clone https://github.com/Johnwithane/blueseal.git <PROJECT>
cd <PROJECT>
rm -rf .git
git init && git add -A && git commit -m "Initial: Blue Seal scaffolding baseline"
git branch -M main
git remote add origin https://github.com/<GH_USER>/<PROJECT>.git
git push -u origin main
```
> Alternatively, tell me the new repo name and I'll do the strip/rebrand (1c) on a branch and open it for you.

**1c. `CLAUDE` — strip Blue Seal domain + rebrand (Phase 0).** Once the repo exists I:
- Delete the Blue Seal domain per plan §13 (jobs/tradies/vetting/invoicing/reviews — collections, services, rules, functions, views, static data).
- Rename the role enum `client/tradesperson/projectManager → crew/artist/tourManager` (keep `admin`/`qa`); update `provisionAccount`, rules helpers, `roleViews.ts`, `auth.ts`.
- Rebrand `manifest`/theme/icons/app name to `<PROJECT>`; keep `CLAUDE.md`.
- Confirm `npm run lint && npm run build && npm run test:run` is green on the emptied shell.

---

## Stage 2 — Firebase project `HUMAN`

In the [Firebase console](https://console.firebase.google.com):
1. **Add project** → name `<PROJECT>` (note the generated **project ID**). Analytics optional.
2. **Upgrade to Blaze** (billing) + set a budget alert.
3. **Build → Authentication → Get started** → enable **Email/Password** and **Google**.
4. **Build → Firestore Database → Create** → production mode, pick a region close to you (e.g. `us-central1`) — **use this same region for Functions + Vertex**.
5. **Build → Storage → Get started.**
6. **Build → Hosting → Get started** (you'll finish from the CLI).
7. **Project Settings → General → Your apps → Web (`</>`)** → register `<PROJECT>-web` → **copy the `firebaseConfig`** (Stage 4).

---

## Stage 3 — Wire the repo to the project `HUMAN` + `CLAUDE`

**3a. `HUMAN`** on your machine, in the repo:
```bash
firebase login
firebase use --add          # pick the <PROJECT> project, alias it "default"
```
This writes `.firebaserc`. Commit it.

**3b. `CLAUDE`** — I update `.env` from your `firebaseConfig` (Blue Seal reads Firebase config from env — no secrets hardcoded). You paste the 6 config values; I fill `.env` (git-ignored) and `.env.example`.

---

## Stage 4 — Google Cloud APIs & keys `HUMAN`

All in the **same GCP project** the Firebase project created. Console → **APIs & Services → Library** → enable each:

| API | Used for (plan ref) |
| --- | --- |
| **Places API (New)** | Venue / hotel / airport autocomplete + details (§5.5, §16.2) |
| **Routes API** (or Directions API) | Ground drive-time / distance / TZ (§5.4) |
| **Maps JavaScript API** | Venue pins + tour route map (§16.2) |
| **Geocoding API** *(optional)* | Fallback lat/lng |
| **Vertex AI API** | The AI assistant + ingestion — same as Blue Seal (§5.13, §16.4) |

**Keys** (APIs & Services → Credentials):
- **Server key** — restrict to *API restrictions* = Places/Routes/Geocoding. Used **only** inside Cloud Functions (never shipped to the client).
- **Browser key** — restrict by *HTTP referrer* to your hosting domain(s), *API restrictions* = Maps JavaScript. This is the one the client uses for the map.

**FlightAware `HUMAN`** — sign up for **AeroAPI**, create a key (flight status; §5.4). Server-side only.

**App Check `HUMAN`** — Firebase console → App Check → register the web app with **reCAPTCHA Enterprise**; copy the site key (Blue Seal already wires App Check via env).

---

## Stage 5 — Secrets & env `HUMAN` + `CLAUDE`

`CLAUDE` — I add these to `.env` / `.env.example` and the functions param/secret config (Blue Seal already uses env-gated config + `functions:secrets`):

- Client (`.env`, safe-to-ship, App Check-protected): the 6 `firebaseConfig` values, the **Maps browser key**, the reCAPTCHA site key.
- Server (`firebase functions:secrets:set ...`, never in client): **Places/Routes server key**, **FlightAware key**. `VERTEX_MODEL`/`VERTEX_LOCATION` default to `gemini-2.5-flash`/your region (same as Blue Seal — no key needed, Vertex uses the project's service account).

`HUMAN` — run the `firebase functions:secrets:set` commands I hand you for the two server keys.

---

## Stage 6 — Trigger Email extension (the email pipeline) `HUMAN`

Blue Seal sends all email by writing to the **`mail` collection**, drained by the Firebase **"Trigger Email" extension**. Install it so notifications actually send:
```bash
firebase ext:install firebase/firestore-send-email
```
Configure when prompted: **collection = `mail`**, and your SMTP connection URI (e.g. a Resend/SendGrid/Mailgun SMTP endpoint) + default From. (Until it's installed, `enqueueMail` just accumulates docs — nothing breaks.)

---

## Stage 7 — CSP + deploy `HUMAN` + `CLAUDE`

**7a. `CLAUDE`** — add the Google hosts to the strict CSP in `firebase.json` (§16.5): `*.googleapis.com`, `maps.googleapis.com`, `*.gstatic.com` in `connect-src`/`img-src`/`script-src` as needed.

**7b. `HUMAN`** — deploy (the CLAUDE.md deploy-before-commit order):
```bash
firebase deploy --only firestore:rules,storage,firestore:indexes,functions
firebase deploy --only hosting        # after the above succeeds
```
Watch for `✔ Deploy complete!`. First `functions` deploy also enables the needed Google service accounts.

---

## Stage 8 — Make yourself admin (one-time bootstrap) `HUMAN`

Blue Seal's `setAdminRole` callable is **admin-only** — so the *first* admin (you) is set once via the Admin SDK, then **every other admin/role change happens in the in-app console** (`/admin` → user search → user detail → role editor, which calls `setAdminRole`/`adminSetUserRoles`).

**8a.** Open the deployed app, **sign up** with your email (you'll be a normal `crew` user). Verify the email.

**8b.** Get your **UID**: Firebase console → Authentication → Users → copy your user's UID.

**8c.** Bootstrap admin **without downloading a key**, using Google Cloud Shell (already authenticated as you):
- Console → the `<PROJECT>` project → open **Cloud Shell** (top-right terminal icon) → run:
```bash
mkdir mkadmin && cd mkadmin && npm init -y >/dev/null && npm i firebase-admin >/dev/null
cat > set-admin.mjs <<'JS'
import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
const uid = process.argv[2];
if (!uid) { console.error("usage: node set-admin.mjs <UID>"); process.exit(1); }
initializeApp({ credential: applicationDefault() });
const auth = getAuth(), db = getFirestore();
const existing = (await auth.getUser(uid)).customClaims ?? {};
const roles = Array.from(new Set([...(existing.roles ?? []), "admin", "crew"]));
await auth.setCustomUserClaims(uid, { ...existing, roles, role: "admin" });
await db.doc(`users/${uid}`).set({ roles, role: "admin" }, { merge: true });
console.log("✔ admin granted to", uid);
JS
node set-admin.mjs <YOUR_UID>
```
> This mirrors exactly what `setAdminRole` does (claims + `users/{uid}` doc, `admin` layered on top of existing roles). It uses Cloud Shell's ambient credentials — **no service-account key file to download or leak.**

**8d.** **Sign out and back in** in the app (custom claims refresh on new token) → you now have the **admin** view. From here, manage every other user in-app: promote/demote roles, verify emails, suspend/restore, view audit — no more CLI.

---

## Stage 9 — Verify `HUMAN` + `CLAUDE`

- `CLAUDE`: `npm run lint && npm run build && npm run test:run` green; rules tests pass.
- `HUMAN`: load the app → sign in → **admin console loads** → create a **Band → Tour** → invite a test crew email → confirm the invite email arrives (Trigger Email working) and a push/notification fires.

---

## What's done when this runbook is complete
A live, deployed `<PROJECT>` app on your Firebase project: same account system, notifications, and admin console as Blue Seal; you as admin; all the Google/Vertex/FlightAware integrations keyed and server-proxied; ready to build the tour features (plan §10, Phase 1 onward).

---

### Quick status tracker
- [ ] 1. GitHub repo created + scaffolding pushed
- [ ] 1c. Domain stripped + rebranded (CLAUDE)
- [ ] 2. Firebase project created + Blaze + services enabled
- [ ] 3. `firebase use` wired + `.env` filled
- [ ] 4. Google APIs enabled + keys created (+ FlightAware + App Check)
- [ ] 5. Secrets set
- [ ] 6. Trigger Email extension installed
- [ ] 7. CSP updated + first deploy succeeded
- [ ] 8. **You are admin**
- [ ] 9. End-to-end verify passed
