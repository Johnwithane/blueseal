# Project Setup Prompt — Vue 3 + Firebase Platform

> **What this is:** A step-by-step prompt for setting up a full-stack Vue 3 + TypeScript + Firebase platform from scratch. Each step is labeled as a **HUMAN STEP** (requires manual action in a browser, GUI, or account setup) or a **CLAUDE STEP** (can be done by Claude Code in the terminal/editor).

---

## Phase 1: Prerequisites & Accounts

### Step 1 — Install Node.js `HUMAN STEP`

1. Download and install **Node.js 20+** (LTS) from https://nodejs.org
2. Verify installation by opening a terminal and running:
   ```bash
   node -v
   npm -v
   ```

### Step 2 — Install VS Code `HUMAN STEP`

1. Download and install **VS Code** from https://code.visualstudio.com
2. Install the following extensions (search in the Extensions panel):
   - **Vue - Official** (formerly Volar) — Vue 3 language support
   - **TypeScript Vue Plugin** — TS support in Vue SFCs
   - **Tailwind CSS IntelliSense** — autocomplete for Tailwind classes
   - **ESLint** — inline linting
   - **Prettier - Code formatter** — auto-formatting
   - **Firebase Explorer** *(optional)* — browse Firestore from VS Code
   - **Claude Code** *(optional)* — AI-assisted development

### Step 3 — Install Git `HUMAN STEP`

1. Download and install **Git** from https://git-scm.com
2. Configure your identity:
   ```bash
   git config --global user.name "Your Name"
   git config --global user.email "your@email.com"
   ```

### Step 4 — Create a GitHub Repository `HUMAN STEP`

1. Go to https://github.com/new
2. Create a new repository:
   - **Name:** `my-platform` (or your project name)
   - **Visibility:** Private (recommended)
   - **Do NOT** initialize with README, .gitignore, or license (we'll create these locally)
3. Copy the repository URL (e.g., `https://github.com/yourname/my-platform.git`)

### Step 5 — Create a Firebase Project `HUMAN STEP`

1. Go to https://console.firebase.google.com
2. Click **Add project**
3. Name it (e.g., `my-platform`)
4. Enable or disable Google Analytics (your choice)
5. Once the project is created, enable these services:

   **Authentication:**
   - Go to **Build > Authentication > Get started**
   - Enable **Email/Password** sign-in provider
   - *(Optional)* Enable **Google** sign-in provider

   **Cloud Firestore:**
   - Go to **Build > Firestore Database > Create database**
   - Choose **Start in test mode** (you'll lock it down with rules later)
   - Select a region close to your users

   **Cloud Storage:**
   - Go to **Build > Storage > Get started**
   - Accept the default rules for now (you'll update them later)

   **Hosting:**
   - Go to **Build > Hosting > Get started**
   - Follow the prompt (you'll finish setup from the CLI later)

6. **Register a web app:**
   - In Project Settings (gear icon) > **General** > scroll to **Your apps**
   - Click the web icon (`</>`) to add a web app
   - Name it (e.g., `my-platform-web`)
   - **Copy the firebaseConfig object** — you'll need it in Step 9

### Step 6 — Get API Keys for External Services `HUMAN STEP`

*Only do these if your project needs them. Skip any you don't need.*

- **Google Maps:** Go to https://console.cloud.google.com/apis — enable Maps JavaScript API, get an API key
- **Sentry:** Create a project at https://sentry.io — get your DSN
- **Any AI APIs** (OpenAI, Anthropic, etc.): Get your API keys from the respective dashboards

---

## Phase 2: Project Scaffolding

### Step 7 — Scaffold the Vue + TypeScript Project `CLAUDE STEP`

```bash
npm create vite@latest my-platform -- --template vue-ts
cd my-platform
npm install
```

### Step 8 — Initialize Git & Connect to GitHub `CLAUDE STEP`

```bash
git init
git add -A
git commit -m "Initial commit: Vite + Vue 3 + TypeScript scaffold"
git branch -M main
git remote add origin https://github.com/yourname/my-platform.git
git push -u origin main
```

> **Note:** Replace the remote URL with the one you copied in Step 4.

### Step 9 — Create the Project Structure `CLAUDE STEP`

Create the following directory structure inside `src/`:

```
src/
├── api/               # External API integrations
├── assets/            # Static assets (images, fonts)
├── components/        # Shared Vue components
│   └── admin/         # Reusable admin components
├── composables/       # Vue composables (barrel-exported via index.ts)
│   └── index.ts       # Barrel export file
├── data/              # Static data/constants
├── features/          # Feature-specific modules
├── firebase/
│   ├── config.ts      # Firebase initialization
│   ├── interfaces.ts  # Firestore document type definitions
│   └── services/      # Async service functions per collection
├── router/
│   └── index.ts       # Vue Router config
├── stores/            # Pinia stores
├── utils/             # Utility/helper functions
├── validation/        # Zod schemas
├── views/
│   └── admin/         # Admin views (self-contained SFCs, no Pinia)
├── App.vue
└── main.ts
```

Create all the necessary directories and placeholder files (`index.ts` barrel exports, etc.).

---

## Phase 3: Core Dependencies

### Step 10 — Install Core Dependencies `CLAUDE STEP`

```bash
# UI & Styling
npm i primevue @primevue/themes primeicons
npm i -D tailwindcss @tailwindcss/vite

# State & Routing
npm i pinia vue-router

# Firebase
npm i firebase

# Validation
npm i zod
```

### Step 11 — Install Dev Tooling `CLAUDE STEP`

```bash
# Linting & Formatting
npm i -D eslint eslint-plugin-vue typescript-eslint eslint-config-prettier
npm i -D prettier

# Git Hooks
npm i -D husky lint-staged
npx husky init

# Testing
npm i -D vitest @vue/test-utils happy-dom

# Type Checking
npm i -D vue-tsc

# Dev Convenience
npm i -D concurrently
```

### Step 12 — Install Firebase CLI `CLAUDE STEP`

```bash
npm i -g firebase-tools
```

### Step 13 — Login to Firebase CLI `HUMAN STEP`

```bash
firebase login
```

> This opens a browser window for Google authentication. You must complete this manually.

---

## Phase 4: Configuration Files

### Step 14 — Configure Vite `CLAUDE STEP`

Update `vite.config.ts`:

```ts
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  plugins: [vue(), tailwindcss()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
});
```

### Step 15 — Configure Tailwind CSS `CLAUDE STEP`

Create `src/assets/main.css`:

```css
@import "tailwindcss";
```

Import it in `src/main.ts`.

### Step 16 — Configure Firebase `CLAUDE STEP`

Create `src/firebase/config.ts` using the firebaseConfig from Step 5:

```ts
import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";
import { getFunctions } from "firebase/functions";

const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID",
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);
export const functions = getFunctions(app);
```

> **HUMAN ACTION REQUIRED:** Paste your actual Firebase config values from Step 5 into this file.

### Step 17 — Configure PrimeVue `CLAUDE STEP`

Update `src/main.ts` to register PrimeVue:

```ts
import { createApp } from "vue";
import { createPinia } from "pinia";
import PrimeVue from "primevue/config";
import Aura from "@primevue/themes/aura";
import "primeicons/primeicons.css";
import App from "./App.vue";
import router from "./router";
import "./assets/main.css";

const app = createApp(App);

app.use(createPinia());
app.use(router);
app.use(PrimeVue, {
  theme: {
    preset: Aura,
  },
});

app.mount("#app");
```

### Step 18 — Configure Vue Router `CLAUDE STEP`

Create `src/router/index.ts`:

```ts
import { createRouter, createWebHistory } from "vue-router";

const routes = [
  {
    path: "/",
    name: "Home",
    component: () => import("@/views/HomeView.vue"),
  },
];

const router = createRouter({
  history: createWebHistory(),
  routes,
});

export default router;
```

Create a placeholder `src/views/HomeView.vue`.

### Step 19 — Configure ESLint (Flat Config) `CLAUDE STEP`

Create `eslint.config.js`:

```js
import pluginVue from "eslint-plugin-vue";
import tseslint from "typescript-eslint";
import eslintConfigPrettier from "eslint-config-prettier";

export default [
  ...pluginVue.configs["flat/recommended"],
  ...tseslint.configs.recommended,
  eslintConfigPrettier,
  {
    files: ["*.vue", "**/*.vue"],
    languageOptions: {
      parserOptions: {
        parser: tseslint.parser,
      },
    },
  },
  {
    ignores: ["dist/", "node_modules/", "functions/"],
  },
];
```

### Step 20 — Configure Prettier `CLAUDE STEP`

Create `.prettierrc`:

```json
{
  "semi": true,
  "singleQuote": false,
  "tabWidth": 2,
  "trailingComma": "all",
  "printWidth": 100
}
```

### Step 21 — Configure Husky & lint-staged `CLAUDE STEP`

Update `package.json` to add lint-staged config:

```json
{
  "lint-staged": {
    "*.{ts,vue}": ["eslint --fix", "prettier --write"],
    "*.{json,css,md}": ["prettier --write"]
  }
}
```

Update `.husky/pre-commit`:

```bash
npx lint-staged
```

### Step 22 — Configure Vitest `CLAUDE STEP`

Add to `vite.config.ts`:

```ts
export default defineConfig({
  // ... existing config
  test: {
    environment: "happy-dom",
    globals: true,
  },
});
```

### Step 23 — Add Package Scripts `CLAUDE STEP`

Update `package.json` scripts:

```json
{
  "scripts": {
    "dev": "vite",
    "build": "vue-tsc -b && vite build",
    "preview": "vite preview",
    "lint": "eslint .",
    "lint:fix": "eslint . --fix",
    "format": "prettier --write src/",
    "test": "vitest",
    "test:run": "vitest run",
    "deploy:prod": "npm run build && firebase deploy --only hosting",
    "deploy": "npm run build && firebase deploy"
  }
}
```

### Step 24 — Create .gitignore `CLAUDE STEP`

Ensure `.gitignore` includes:

```
node_modules/
dist/
.env
.env.local
.firebase/
firebase-debug.log
firestore-debug.log
ui-debug.log
*.local
```

---

## Phase 5: Firebase Backend Setup

### Step 25 — Initialize Firebase in the Project `CLAUDE STEP`

```bash
firebase init
```

Select the following (use spacebar to toggle, enter to confirm):

- **Firestore** — rules and indexes
- **Storage** — storage rules
- **Hosting** — configure as single-page app, do NOT set up GitHub Actions
- **Functions** — TypeScript, ESLint yes, install dependencies yes
- **Emulators** — Auth, Firestore, Storage, Functions emulators

> **Note:** When prompted for the public directory, enter `dist` (Vite's output folder).
> When asked "Configure as a single-page app?", answer **Yes**.

### Step 26 — Configure Firebase Emulators `CLAUDE STEP`

Verify `firebase.json` has emulator config. Add a dev script to run the app + emulators together:

```json
{
  "scripts": {
    "dev:full": "concurrently \"vite\" \"firebase emulators:start\""
  }
}
```

Update `src/firebase/config.ts` to connect to emulators in development:

```ts
import { connectAuthEmulator } from "firebase/auth";
import { connectFirestoreEmulator } from "firebase/firestore";
import { connectStorageEmulator } from "firebase/storage";
import { connectFunctionsEmulator } from "firebase/functions";

if (import.meta.env.DEV) {
  connectAuthEmulator(auth, "http://localhost:9099");
  connectFirestoreEmulator(db, "localhost", 8080);
  connectStorageEmulator(storage, "localhost", 9199);
  connectFunctionsEmulator(functions, "localhost", 5001);
}
```

### Step 27 — Set Up Cloud Functions `CLAUDE STEP`

The `functions/` directory was created by `firebase init`. Verify the structure:

```
functions/
├── src/
│   ├── index.ts       # Function exports
│   └── lib/           # Shared server utilities
├── package.json
└── tsconfig.json
```

Install the Firebase Admin SDK in the functions directory:

```bash
cd functions
npm i firebase-admin firebase-functions
cd ..
```

### Step 28 — Write Initial Firestore Security Rules `CLAUDE STEP`

Update `firestore.rules`:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Lock down by default
    match /{document=**} {
      allow read, write: if false;
    }

    // Example: authenticated users can read
    match /public/{docId} {
      allow read: if request.auth != null;
    }
  }
}
```

### Step 29 — Write Initial Storage Security Rules `CLAUDE STEP`

Update `storage.rules`:

```
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /{allPaths=**} {
      allow read: if request.auth != null;
      allow write: if request.auth != null
                   && request.resource.size < 10 * 1024 * 1024;
    }
  }
}
```

---

## Phase 6: Security & Hosting Headers

### Step 30 — Configure Security Headers `CLAUDE STEP`

Add hosting headers to `firebase.json`:

```json
{
  "hosting": {
    "public": "dist",
    "ignore": ["firebase.json", "**/.*", "**/node_modules/**"],
    "rewrites": [{ "source": "**", "destination": "/index.html" }],
    "headers": [
      {
        "source": "**",
        "headers": [
          { "key": "X-Frame-Options", "value": "DENY" },
          { "key": "X-Content-Type-Options", "value": "nosniff" },
          { "key": "Referrer-Policy", "value": "strict-origin-when-cross-origin" },
          { "key": "Permissions-Policy", "value": "camera=(), microphone=(), geolocation=()" },
          {
            "key": "Strict-Transport-Security",
            "value": "max-age=63072000; includeSubDomains; preload"
          },
          {
            "key": "Content-Security-Policy",
            "value": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self' https://*.googleapis.com https://*.firebaseio.com; font-src 'self' https://fonts.gstatic.com;"
          }
        ]
      }
    ]
  }
}
```

> **Note:** You'll need to expand the CSP as you add external services (maps, Sentry, model-viewer, etc.).

---

## Phase 7: First Commit & Verify

### Step 31 — Commit the Fully Configured Project `CLAUDE STEP`

```bash
git add -A
git commit -m "Project setup: Vue 3 + TypeScript + Firebase + PrimeVue + Tailwind"
git push
```

### Step 32 — Verify Everything Works `HUMAN STEP` + `CLAUDE STEP`

**CLAUDE:** Run these checks:

```bash
npm run dev          # Dev server starts without errors
npm run lint         # No lint errors
npm run build        # Type-check + build succeeds
npm run test:run     # Tests pass (even if there are none yet)
```

**HUMAN:** Open `http://localhost:5173` in a browser and verify the app loads.

### Step 33 — Deploy to Firebase Hosting `HUMAN STEP`

```bash
npm run deploy:prod
```

> Verify the deployed URL works in a browser. Firebase will print the URL after deploy.

---

## Phase 8: Optional Features (Add As Needed)

*These are installed later when the feature is actually needed. Each is a `CLAUDE STEP`.*

### Rich Text Editor

```bash
npm i @tiptap/vue-3 @tiptap/starter-kit @tiptap/extension-table @tiptap/extension-task-list @tiptap/extension-task-item @tiptap/extension-link @tiptap/extension-image @tiptap/extension-text-align @tiptap/extension-color @tiptap/extension-text-style @tiptap/extension-highlight @tiptap/extension-code-block @tiptap/extension-underline @tiptap/extension-placeholder
```

### 3D & Model Viewing

```bash
npm i three @google/model-viewer cannon-es
npm i -D @types/three
```

### Google Maps

```bash
npm i @googlemaps/js-api-loader @googlemaps/markerclusterer
```

> **HUMAN:** Ensure your Google Maps API key is set up (Step 6).

### PDF, Excel & Export

```bash
npm i jspdf jspdf-autotable pdfjs-dist exceljs html2canvas-pro jszip file-saver qrcode
npm i -D @types/file-saver
```

### Error Monitoring (Sentry)

```bash
npm i @sentry/vue
```

> **HUMAN:** Create a Sentry project and get your DSN (Step 6).

**CLAUDE:** Create `src/sentry.ts` and initialize Sentry in `main.ts`.

### Advanced Tables

```bash
npm i @tanstack/vue-table
```

---

## Architecture Principles

Follow these patterns throughout development:

- **Firebase services as pure async functions** — no classes, just exported functions returning typed data (`WithId<T>[]`)
- **Firestore interfaces in a single file** — all document types defined in `interfaces.ts`
- **Admin views are self-contained** — local state only, no Pinia stores for admin
- **PrimeVue imported per-component** — not globally registered, keeps bundle lean
- **Composables with barrel export** — `composables/index.ts` re-exports everything
- **Strict type-checking** — `vue-tsc -b` runs before every production build
- **Security headers on hosting** — CSP, HSTS, X-Frame-Options configured in `firebase.json`

---

## Quick Reference: Full Tech Stack

| Category | Technologies |
|----------|-------------|
| **Frontend** | Vue 3, TypeScript, Vite, Vue Router, Pinia |
| **UI** | PrimeVue, Tailwind CSS, PrimeIcons |
| **Backend** | Firebase (Auth, Firestore, Storage, Hosting, Functions) |
| **Validation** | Zod |
| **Rich Text** | Tiptap |
| **3D/Maps** | Three.js, Google Model Viewer, cannon-es, Google Maps |
| **Export** | jsPDF, ExcelJS, html2canvas-pro, JSZip, FileSaver, QRCode |
| **Tables** | PrimeVue DataTable, TanStack Table |
| **Monitoring** | Sentry |
| **Dev Tools** | ESLint, Prettier, Husky, lint-staged, Vitest, vue-tsc |
