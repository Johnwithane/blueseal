# Loadout — Setup & Operations Runbook

> A complete, self-contained runbook for standing up the tour-management app by forking the Blue Seal scaffolding. It is written so you can **start a remote Claude Code session, point it at this file, walk away, and only come back to (a) answer a few one-word questions and (b) do simple, guided clicks in GitHub and Firebase.**
>
> The full product design lives in `MASTER_TOUR_CLONE_PLAN.md` (esp. §13 KEEP/REPLACE, §16 integrations, §17 design system). **`CLAUDE.md` is kept exactly as-is.**

---

## 0. How to use this document

### 0.1 The two actors

| | **YOU** (Johnny) | **AGENT** (the remote Claude session) |
| --- | --- | --- |
| Where | Your phone/laptop browser + a terminal | The cloud session, in the repo |
| Does | GitHub clicks, Firebase console, `firebase login`/deploys, pasting values back, answering questions | All code: strip/rebrand, roles, features, tests, docs, commits/pushes |
| Can't | write the code | log into *your* Google/Firebase account or click *your* console |

Every step below is tagged **`YOU`** or **`AGENT`**. Anything tagged `YOU` is a short, spelled-out action. Anything tagged `AGENT` the remote session does on its own.

### 0.2 How to run this as a remote session (the "walk away" flow)

1. **Create the new repo first** (Stage 1 — needs a name; a throwaway slug is fine).
2. **Start a remote Claude Code session on that repo** (code.claude.com/… → new session → pick the repo).
3. **Give it this one-line kickoff:**
   > "Read `SETUP.md` and `MASTER_TOUR_CLONE_PLAN.md`. Execute Stage 1c (strip Blue Seal domain + rename roles + stand up the §17 design tokens + rebrand) and get `npm run lint && build && test:run` green. Then build the phases in `MASTER_TOUR_CLONE_PLAN.md §10` in order, and **for every phase follow the §18 QA gate: write its numbered `e2e/happy-paths/NN-*.spec.ts`, run `npm run test:e2e:happy` green against the emulators, and update `qaChecklist.ts` + `QA_HAPPY_PATHS.md` before advancing.** Commit and push after each working sub-step. **Pause and list what you need from me** before any step that needs my account. Keep `CLAUDE.md` unchanged."
4. **Walk away.** The agent builds each phase *with its Playwright test*, keeps the spec suite green, commits/pushes, and stops when it hits a `YOU` step — leaving you a short list of what to provide.

### 0.2a The per-phase QA gate (why you can trust the walk-away)

The agent doesn't just write code — **at every phase it writes and runs a Playwright happy-path spec that proves the phase works**, against the local Firebase emulators (no deploy, no paid APIs — external calls return test fixtures, plan §18.2). A phase only closes when:
- `npm run lint && build && test:run && test:rules` pass (unit + security rules, incl. "crew is denied money/hidden items"), **and**
- `QA_BASE_URL=http://localhost:5173 npm run test:e2e:happy` is **green** (the numbered spec for that phase + `00-smoke`), **and**
- `qaChecklist.ts` + `QA_HAPPY_PATHS.md` are updated so you can re-run the same checks yourself at `/qa`.

If a spec goes red, the agent fixes forward before moving on — so the suite is always green when you come back. (Full spec-per-phase map: plan §18.3.)
5. **Come back**, do the guided Firebase/GitHub clicks in the stages below, and **paste the requested values back into the session**. It resumes.

### 0.3 Checkpoint discipline (why the agent commits often)

The remote container is **ephemeral** — anything not committed + pushed is lost when it recycles. So the agent must **commit and push after every working sub-step**, and never leave finished work uncommitted. If a session ends mid-way, a new session resumes from the last push. (This is also just the `CLAUDE.md` rule.)

### 0.4 Decisions cheat-sheet — how to answer the agent fast

When the agent pauses with a question, here are the defaults (say the **bold** word and it proceeds):

| The agent asks… | Say | Why |
| --- | --- | --- |
| Repo / project slug? | **any slug** (e.g. `loadout` or `tourapp-dev`) | Rebrandable later; only the Firebase *project ID* is permanent. |
| Region for Firestore/Functions/Vertex? | **`us-central1`** (or nearest to you) | Keep all three the same. |
| Role enum names? | **`crew` / `artist` / `tourManager`** (+ `admin`/`qa`) | Mirrors Blue Seal `client`/`tradesperson`/`projectManager`. |
| Tenancy: add an Org layer above Band now? | **No — Band-level** | It's the PM→properties pattern; add Org later only if agencies need it. |
| AI provider? | **Vertex Gemini (Blue Seal's)** | Copy `functions/src/ai/` verbatim. No new stack. |
| Flight data provider? | **FlightAware AeroAPI** | Master Tour's own choice. |
| Ship a real brand now or placeholder? | **Placeholder** | Neutral tokens now; drop real brand into §17's two files later. |
| Keep Stripe/billing in MVP? | **No** | Turn on later; out of MVP scope. |
| Run the per-phase Playwright gate against emulators or the deployed site? | **Emulators** | Local, free, hermetic — no deploy per phase (§18). |
| Mock Places/flight/Vertex in tests? | **Yes (fixtures)** | Keeps the QA gate free + deterministic (§18.2). |

If a question isn't here, the agent should propose a recommended default and proceed unless you object.

### 0.5 Optional: let the agent deploy too (fully hands-off)

By default **you** run deploys (Stage 7) because they need your Google login. If you'd rather the agent deploy so you truly never touch a terminal, see **Appendix A** — it uses a CI service-account credential stored in the remote environment. It's more convenient but hands a deploy credential to the session, so it's opt-in.

---

## 1. Prerequisites `YOU`

You have most of these from Blue Seal. Verify each:

| Need | Check / get it | Verify |
| --- | --- | --- |
| Node 20+ | nodejs.org (LTS) | `node -v` → v20+ |
| git | git-scm.com | `git --version` |
| Firebase CLI | `npm i -g firebase-tools` | `firebase --version` |
| Google account | the one for Firebase | can log into console.firebase.google.com |
| **Blaze plan (billing)** | Firebase console → upgrade | **required** — Functions + Google/Vertex/FlightAware need it |
| Budget alert | GCP console → Billing → Budgets | set e.g. $50/mo alert so there are no surprises |

> Cost note: the plan (§16.5) keeps spend low by proxying every paid API through a Cloud Function and **caching results in Firestore**, so repeat lookups are free. A budget alert is still the safety net.

---

## 2. Stage 1 — GitHub repo (fork the scaffolding)

**Goal:** a new private repo seeded from the Blue Seal codebase, with Blue Seal's git history dropped for a clean start.

### 2a. `YOU` — create the empty repo
GitHub → **New repository** → Name: `<PROJECT>` → **Private** → **do NOT** add README/.gitignore/license → **Create**.

### 2b. `YOU` — seed it from Blue Seal (run in a terminal)
```bash
git clone https://github.com/Johnwithane/blueseal.git <PROJECT>
cd <PROJECT>
rm -rf .git                                   # drop Blue Seal history — clean slate
git init && git add -A && git commit -m "Initial: Blue Seal scaffolding baseline"
git branch -M main
git remote add origin https://github.com/<GH_USER>/<PROJECT>.git
git push -u origin main
```
> Don't want to touch a terminal at all? Tell **this** session a slug and I'll create the repo for you via the GitHub integration and push the baseline, then you skip 2a/2b.

### 2c. `AGENT` — strip Blue Seal domain + rebrand + design tokens (Phase 0)
Once the repo exists, the remote session (started on it) does all of this autonomously, committing after each part:
- Delete the Blue Seal domain per plan **§13** (jobs/tradies/vetting/insurance/invoicing/reviews/quotes/prospects/sales/PM — their collections, services, rules, functions, views, static data, tests).
- Rename the role enum `client/tradesperson/projectManager → crew/artist/tourManager` (keep `admin`/`qa`); update `provisionAccount.ts`, `firestore.rules` helpers, `roleViews.ts`, `stores/auth.ts`.
- Add the **Band** entity + **Tour** shells and the membership access-arrays (plan §3, §6).
- Stand up the **§17 design system**: `theme/preset.ts` + `assets/main.css` with a **neutral placeholder brand** (swap real brand later).
- Rebrand: `manifest`, app name, icons, titles → `<PROJECT>`. **Leave `CLAUDE.md` unchanged** (optionally update only its one "Project context" paragraph if you tell it to).
- Green-gate: `npm run lint && npm run build && npm run test:run` all pass on the emptied shell.
- **Then pause** and list the Firebase values it needs (Stage 3b/5).

---

## 3. Stage 2 — Firebase project `YOU`

In [console.firebase.google.com](https://console.firebase.google.com):

1. **Add project** → name `<PROJECT>` → (Analytics optional) → Create. **Write down the generated Project ID** (e.g. `loadout-4f9c2`) — it's permanent and the agent needs it.
2. **Upgrade to Blaze:** gear/■ → **Usage and billing** → **Modify plan** → Blaze → link a billing account.
3. **Authentication:** left nav **Build → Authentication → Get started** → **Sign-in method** → enable **Email/Password** and **Google**.
4. **Firestore:** **Build → Firestore Database → Create database** → **Production mode** → location = **`us-central1`** (or nearest; keep it consistent for Functions + Vertex) → Enable.
5. **Storage:** **Build → Storage → Get started** → keep default rules for now → same region.
6. **Hosting:** **Build → Hosting → Get started** → click through (you finish from the CLI later).
7. **Register the web app:** gear → **Project settings** → **General** → scroll to **Your apps** → click **`</>`** (Web) → nickname `<PROJECT>-web` → Register → **copy the `firebaseConfig` object** (6 values). Keep this tab open for Stage 3b.

**Paste back to the agent:** the **Project ID** and the **6 firebaseConfig values** (apiKey, authDomain, projectId, storageBucket, messagingSenderId, appId).

---

## 4. Stage 3 — Connect repo ↔ project

### 3a. `YOU` — point the CLI at the project (in the repo, in a terminal)
```bash
firebase login          # opens a browser; log in with the Firebase Google account
firebase use --add      # pick <PROJECT>, alias it "default"
```
This writes `.firebaserc`.

### 3b. `AGENT` — fill env from your config
Paste the 6 `firebaseConfig` values into the session; the agent writes them into `.env` (git-ignored) and updates `.env.example`, then commits `.firebaserc` + `.env.example`. (Blue Seal reads all Firebase config from env — nothing is hardcoded.)

---

## 5. Stage 4 — Google Cloud APIs & keys `YOU`

Same GCP project the Firebase project created. Go to [console.cloud.google.com](https://console.cloud.google.com), make sure `<PROJECT>` is selected in the top project picker.

### 4a. Enable the APIs
**APIs & Services → Library** → search each name → **Enable**:

| Enable this API | For (plan ref) |
| --- | --- |
| **Places API (New)** | venue/hotel/airport autocomplete + details (§5.5, §16.2) |
| **Routes API** *(or Directions API)* | ground drive-time/distance/TZ (§5.4) |
| **Maps JavaScript API** | venue pins + tour map (§16.2) |
| **Geocoding API** *(optional)* | lat/lng fallback |
| **Vertex AI API** | AI assistant + ingestion (§5.13, §16.4) |

### 4b. Create two API keys
**APIs & Services → Credentials → Create credentials → API key** (do this twice):

1. **Server key** (used only inside Cloud Functions):
   - Rename it "server-google".
   - **API restrictions** → Restrict key → check **Places API (New)**, **Routes API**, **Geocoding API**.
   - **Application restrictions** → None (it lives server-side).
2. **Browser key** (used by the client map):
   - Rename it "browser-maps".
   - **API restrictions** → **Maps JavaScript API** only.
   - **Application restrictions** → **HTTP referrers** → add your hosting domains (`https://<PROJECT>.web.app/*`, `https://<PROJECT>.firebaseapp.com/*`, and later your custom domain, plus `http://localhost:5173/*` for dev).

### 4c. Grant Vertex to the Functions service account
**IAM & Admin → IAM** → find the service account the Functions runtime uses (usually `<PROJECT>@appspot.gserviceaccount.com` or the Compute default) → **Edit** → **Add role → "Vertex AI User"** → Save. (This is what lets `functions/src/ai/*` call Gemini without a key.)

### 4d. FlightAware
Sign up at [flightaware.com/aeroapi](https://www.flightaware.com/commercial/aeroapi/) → create an **API key** (Personal tier is fine to start). Server-side only.

### 4e. App Check (reCAPTCHA Enterprise)
- Firebase console → **Build → App Check** → register the **web app** → provider **reCAPTCHA Enterprise** → follow the link to create a reCAPTCHA Enterprise **key** in Cloud console → paste the **site key** back into App Check → Save.
- Copy the **site key** for the client env.

**Paste back to the agent:** the **browser-maps key**, the **reCAPTCHA site key** (both client-side), and confirm the **server key** + **FlightAware key** are ready for Stage 5 secrets.

---

## 6. Stage 5 — Secrets & environment

### 5a. `AGENT` — client env (`.env`, safe to ship, App Check-protected)
The agent fills these from what you pasted:

| Var | Value from | Notes |
| --- | --- | --- |
| `VITE_FIREBASE_API_KEY` … (`AUTH_DOMAIN`, `PROJECT_ID`, `STORAGE_BUCKET`, `MESSAGING_SENDER_ID`, `APP_ID`) | Stage 2 firebaseConfig | 6 values |
| `VITE_GOOGLE_MAPS_BROWSER_KEY` | Stage 4b browser key | domain-restricted |
| `VITE_RECAPTCHA_SITE_KEY` | Stage 4e | App Check |
| `VITE_USE_EMULATORS` | `false` (prod) / `true` (local) | Blue Seal's emulator toggle |

### 5b. `YOU` — server secrets (never in the client; run in the repo terminal)
The agent will hand you the exact lines; they look like:
```bash
firebase functions:secrets:set GOOGLE_SERVER_KEY      # paste the Stage 4b server key
firebase functions:secrets:set FLIGHTAWARE_API_KEY    # paste the Stage 4d key
```
`VERTEX_MODEL` / `VERTEX_LOCATION` default to `gemini-2.5-flash` / your region — no key needed (Vertex uses the service account from 4c). Same as Blue Seal.

---

## 7. Stage 6 — Trigger Email extension `YOU`

Blue Seal sends **all** email by writing to the **`mail` collection**, drained by the Firebase **"Trigger Email" extension**. Install + configure it so notification emails actually send.

1. Get an SMTP provider (Resend is simplest). Example with **Resend**: create an account → **API Keys → Create** → copy the key. Resend SMTP connection is:
   - host `smtp.resend.com`, port `465` (SSL), username `resend`, password = your API key.
   - → connection URI: `smtps://resend:YOUR_RESEND_KEY@smtp.resend.com:465`
   - *(Confirm the exact host/port on your provider's dashboard — SendGrid/Mailgun differ.)*
2. Install:
   ```bash
   firebase ext:install firebase/firestore-send-email
   ```
   When prompted: **Email documents collection = `mail`**, **SMTP connection URI** = the one above, **Default FROM** = e.g. `Loadout <noreply@yourdomain>`. (Verify your sending domain in the provider first, or use their onboarding/sandbox sender.)
3. Until installed, `enqueueMail` just accumulates docs in `mail/` — nothing breaks; they flush once it's live.

---

## 8. Stage 7 — CSP + deploy

### 7a. `AGENT` — widen the CSP for Google hosts
The agent adds to the strict CSP in `firebase.json` (§16.5): `*.googleapis.com`, `maps.googleapis.com`, `*.gstatic.com` in `connect-src`/`img-src`/`script-src` as needed, then commits.

### 7b. `YOU` — deploy (in the repo terminal, in this order — the `CLAUDE.md` deploy-before-commit rule)
```bash
firebase deploy --only firestore:rules,storage,firestore:indexes,functions
# wait for "✔ Deploy complete!", then:
firebase deploy --only hosting
```
- First `functions` deploy may prompt to enable APIs / create service accounts — accept.
- If a function fails to build, the agent fixes it and you re-run. **Success = `✔ Deploy complete!`** and a live URL printed (`https://<PROJECT>.web.app`).

> Want the agent to run these for you? See **Appendix A**.

---

## 9. Stage 8 — Make yourself admin (one-time bootstrap) `YOU`

Blue Seal's `setAdminRole` callable is **admin-only**, so the *first* admin (you) is set once via the Admin SDK; after that you manage everyone **inside the app** at `/admin` (user search → user detail → role editor / verify email / suspend — it calls `setAdminRole` / `adminSetUserRoles`).

1. **Sign up** in the deployed app with your email → you're a normal `crew` user → verify the email.
2. **Get your UID:** Firebase console → **Authentication → Users** → find your row → copy the **User UID**.
3. **Bootstrap admin without a key file**, using **Google Cloud Shell** (already logged in as you):
   - Cloud console → your `<PROJECT>` project → click the **Cloud Shell** icon (terminal, top-right) → run:
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
   This does exactly what `setAdminRole` does (claims + `users/{uid}` doc, `admin` layered on top), using Cloud Shell's ambient login — **no key file to download or leak.**
4. **Sign out and back in** in the app (claims refresh on a new token) → you now see the **admin** area. From here, manage all other users in-app — no more CLI.

---

## 10. Stage 9 — Verify end-to-end `YOU` + `AGENT`

- `AGENT`: `npm run lint && npm run build && npm run test:run` green; rules tests pass.
- `YOU`: open the app → sign in → **admin area loads** → create a **Band → Tour** → invite a test crew email → confirm the invite **email arrives** (Trigger Email works) and an in-app notification fires.

---

## 11. Environment variables — master reference

| Name | Side | Source | Secret? |
| --- | --- | --- | --- |
| `VITE_FIREBASE_*` (6) | client | Stage 2 firebaseConfig | no (public, App Check-guarded) |
| `VITE_GOOGLE_MAPS_BROWSER_KEY` | client | Stage 4b browser key | no (referrer-restricted) |
| `VITE_RECAPTCHA_SITE_KEY` | client | Stage 4e | no |
| `VITE_USE_EMULATORS` | client | you set `true`/`false` | no |
| `GOOGLE_SERVER_KEY` | server | Stage 4b server key | **yes** (`functions:secrets`) |
| `FLIGHTAWARE_API_KEY` | server | Stage 4d | **yes** |
| `VERTEX_MODEL` / `VERTEX_LOCATION` | server | defaults `gemini-2.5-flash` / region | no (no key; uses SA) |
| SMTP URI | extension | Stage 6 provider | configured in the extension |

---

## 12. Troubleshooting

| Symptom | Likely cause → fix |
| --- | --- |
| `functions` deploy fails "billing" | Not on Blaze → Stage 1 upgrade. |
| Vertex/AI call → permission denied | Functions SA missing **Vertex AI User** → Stage 4c. |
| Map blank / `RefererNotAllowed` | Browser key referrer list missing your domain/localhost → Stage 4b. |
| Places/Routes call fails server-side | Server key not restricted to those APIs, or secret not set → Stage 4b / 5b. |
| No emails arriving | Trigger Email not installed, wrong `mail` collection name, or unverified sending domain → Stage 6. |
| App Check blocks all calls | reCAPTCHA site key wrong, or App Check enforced before the key is registered → Stage 4e; use a debug token locally. |
| Admin area not showing after bootstrap | Didn't sign out/in to refresh claims → Stage 8.4. |
| Remote session "lost" work | It wasn't pushed — enforce §0.3 checkpoint discipline; resume from last push. |
| CSP console errors on Google hosts | CSP not widened → Stage 7a. |

---

## 13. Status tracker

- [ ] 1. Repo created + scaffolding pushed
- [ ] 1c. **AGENT**: domain stripped, roles renamed, design tokens up, rebranded, green build
- [ ] Build phases (plan §10) — each closes with its green Playwright spec (§18): `01-auth-roles` → `11-import`
- [ ] 2. Firebase project + Blaze + Auth/Firestore/Storage/Hosting + web app registered
- [ ] 3. `firebase use` wired + `.env` filled
- [ ] 4. Google APIs enabled + 2 keys created + Vertex SA role + FlightAware + App Check
- [ ] 5. Client env + server secrets set
- [ ] 6. Trigger Email extension installed
- [ ] 7. CSP widened + first deploy succeeded (live URL)
- [ ] 8. **You are admin**
- [ ] 9. End-to-end verify passed

---

## Appendix A — Optional: let the agent run deploys (fully hands-off)

By default deploys are a `YOU` step (they need your Google login). To let the **remote session** deploy so you never touch a terminal:

1. `YOU`: create a **service account** (Cloud console → IAM → Service Accounts → Create) with roles **Firebase Admin**, **Cloud Functions Admin**, **Service Account User**, **Cloud Datastore User**. Create a **JSON key** and download it.
2. `YOU`: in the remote environment's settings, add it as an env var / secret (e.g. `GOOGLE_APPLICATION_CREDENTIALS` pointing to the file, or paste the JSON into a secret the session writes to a file).
3. The agent then runs `firebase deploy --only ... --project <PROJECT>` itself and reports the result.

**Caveat:** this hands a privileged deploy credential to the session. Prefer it only if you trust the environment; rotate/delete the key when done. For most people, doing the two `firebase deploy` lines yourself (Stage 7b) is simpler and safer.
