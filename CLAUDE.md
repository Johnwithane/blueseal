# CLAUDE.md

> **Read this first every session.** This file defines *how* we build. `design.md` defines *what* we build. `TECH_STACK_SETUP.md` defines *how to set up*.
>
> If anything below contradicts those docs, those docs win — flag it.

---

## Session start checklist

Before writing any code in a new session:

1. ✅ Read this file end-to-end
2. ✅ Skim `design.md` § 10 (Build Phases) to confirm where we are
3. ✅ Check `git log -10` to see what's been done recently
4. ✅ Confirm which build phase + which feature you're working on
5. ✅ If a relevant `skills/*.md` exists for what you're about to do, read it first

If any of those reveal that context has shifted from what the user just said, ask — don't assume.

---

## Project context

**Blue Seal** — verified trades PWA. Three roles (`client`, `tradesperson`, `admin`), trade-specific intake forms, per-job kanban with chat + AI tools, mutual reviews, auto-invoicing.

Full spec: `design.md`. Setup + architecture: `TECH_STACK_SETUP.md`.

---

## Core principles

These override everything else when in conflict:

1. **One feature at a time, fully shipped.** Don't start the next thing until the current thing is tested, type-checking, linting clean, and committed.
2. **Consistency > cleverness.** If there's an existing pattern in the codebase, match it. Only deviate with explicit justification.
3. **Default deny on security.** Every new Firestore collection needs an explicit rule. No collection ships without allow + deny tests.
4. **Validate at the boundary.** Every Cloud Function input gets a Zod schema. Every form gets a Zod schema. Never trust raw payloads.
5. **Mobile first.** 375px width is the design target. Everything must work there before it's "done."
6. **No `any`.** Use `unknown` and narrow. Strict TS throughout.
7. **Push back when needed.** If the user asks for something that contradicts these docs or introduces real risk, say so — don't silently accept.

---

## Working pattern per feature

Every feature follows this loop:

```
Read context (design.md section + relevant skills)
  ↓
Plan: list the files you'll touch
  ↓
Build:
  - Define interfaces in src/firebase/interfaces.ts (if schema change)
  - Add Zod schemas in src/validation/
  - Write the firebase/services/ async functions
  - Write the Cloud Functions (if needed)
  - Write the Firestore + Storage security rules
  - Write the Vue components / views
  - Write tests (unit + rules)
  ↓
Verify: npm run lint && npm run build && npm run test:run
  ↓
Commit: "Phase N: short feature description"
  ↓
Pattern check: did anything repeat 3+ times? Extract to skills/
```

---

## Architecture conventions

(Recap from `TECH_STACK_SETUP.md` — duplicated here so Claude Code doesn't have to context-switch.)

**Folder structure (must match):**
```
src/
├── api/                  # External API integrations
├── components/           # Shared Vue components
│   └── admin/            # Reusable admin components
├── composables/          # Vue composables (barrel-exported via index.ts)
├── data/                 # Static data/constants
├── features/             # Feature-specific modules
├── firebase/
│   ├── config.ts         # Firebase init
│   ├── interfaces.ts     # ALL Firestore doc types
│   └── services/         # Async service functions per collection
├── router/index.ts
├── stores/               # Pinia stores (NOT for admin)
├── utils/
├── validation/           # Zod schemas
└── views/
    └── admin/            # Self-contained, no Pinia
```

**Firebase services pattern (pure async functions):**
```ts
// src/firebase/services/jobsService.ts
import { db } from "@/firebase/config";
import type { Job, WithId } from "@/firebase/interfaces";
import { addDoc, collection, getDocs, query, where, serverTimestamp } from "firebase/firestore";

export async function createJob(input: Omit<Job, "id" | "createdAt" | "status">): Promise<string> {
  const ref = await addDoc(collection(db, "jobs"), {
    ...input,
    status: "requested",
    createdAt: serverTimestamp(),
  });
  return ref.id;
}

export async function listJobsForTradie(tradespersonId: string): Promise<WithId<Job>[]> {
  const snap = await getDocs(
    query(collection(db, "jobs"), where("tradespersonId", "==", tradespersonId))
  );
  return snap.docs.map(d => ({ id: d.id, ...d.data() } as WithId<Job>));
}
```

**Rules:**
- No classes — exported functions only.
- Always return typed data (`WithId<T>[]` for lists, `WithId<T>` or `null` for single docs).
- `serverTimestamp()` for time fields. Never `Date.now()` or `new Date()`.
- Components never call Firestore directly. They call services (or composables that wrap services).

**Vue component pattern:**
```vue
<script setup lang="ts">
// 1. Imports: vue → external libs → @ aliases → relative
import { ref, computed } from "vue";
import Button from "primevue/button";
import { createJob } from "@/firebase/services/jobsService";

// 2. Typed props
const props = defineProps<{
  tradespersonId: string;
}>();

// 3. Typed emits
const emit = defineEmits<{
  created: [jobId: string];
}>();

// 4. Logic
async function handleSubmit() {
  const id = await createJob({ tradespersonId: props.tradespersonId, /* ... */ });
  emit("created", id);
}
</script>

<template>
  <Button label="Submit" @click="handleSubmit" />
</template>
```

**Rules:**
- `<script setup lang="ts">` only. No Options API.
- PrimeVue components imported per-file, not globally registered.
- Tailwind for layout/spacing. Design tokens (CSS vars) for theme-sensitive values.
- One component per file. Under 200 lines — if longer, extract logic to composables.

**Cloud Function callable pattern (lock this in early — every callable looks like this):**
```ts
// functions/src/<domain>/<functionName>.ts
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { z } from "zod";
import { logger } from "firebase-functions/v2";

const Input = z.object({ /* ... */ });

export const functionName = onCall(
  { enforceAppCheck: true, region: "us-central1" },
  async (request) => {
    // 1. Auth
    if (!request.auth) throw new HttpsError("unauthenticated", "Sign in required");

    // 2. Role check (if applicable)
    const role = request.auth.token.role;
    if (role !== "tradesperson") throw new HttpsError("permission-denied", "Tradesperson only");

    // 3. Validate input
    const input = Input.parse(request.data);

    // 4. Do the work
    const ctx = { fn: "functionName", uid: request.auth.uid };
    logger.info("starting", ctx);
    try {
      const result = await doWork(request.auth.uid, input);
      logger.info("success", { ...ctx, resultId: result.id });
      return result;
    } catch (err) {
      logger.error("failed", { ...ctx, err });
      if (err instanceof HttpsError) throw err;
      throw new HttpsError("internal", "Something went wrong");
    }
  }
);
```

**Rules:**
- Always `enforceAppCheck: true`.
- Always validate with Zod.
- Always structured logging (no `console.log`).
- Always convert errors to `HttpsError` — never expose raw error messages to clients.

**Security rules pattern:**
```js
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    // Helpers at the top
    function isSignedIn() { return request.auth != null; }
    function uid() { return request.auth.uid; }
    function hasRole(role) { return isSignedIn() && request.auth.token.role == role; }
    function isAdmin() { return hasRole('admin'); }
    function isSelf(userId) { return isSignedIn() && uid() == userId; }

    // Then collections, each with all four operations explicit
    match /jobs/{jobId} {
      function isParty() {
        return isSignedIn() && (
          resource.data.clientId == uid() ||
          resource.data.tradespersonId == uid()
        );
      }
      allow read: if isParty() || isAdmin();
      allow create: if hasRole('client') && request.resource.data.clientId == uid();
      allow update: if isParty() || isAdmin();
      allow delete: if isAdmin();
    }
  }
}
```

**Rules:**
- Default deny. Never leave a collection unlisted.
- Read + Create + Update + Delete each get an explicit rule.
- Role checks via custom claims (`request.auth.token.role`) — never doc lookups.
- Every rule has at least one allow test AND one deny test in `tests/rules/`.

---

## Commands

```bash
# Local dev (two terminals)
npm run dev              # Vite, http://localhost:5173
npm run dev:full         # Vite + Firebase emulators together (preferred)

# Quality gates
npm run typecheck        # vue-tsc -b
npm run lint             # ESLint
npm run lint:fix         # ESLint with autofix
npm run format           # Prettier
npm run test             # Vitest watch mode
npm run test:run         # Vitest single run

# Build & deploy
npm run build            # Type-check + Vite build → dist/
npm run deploy:prod      # Build + deploy hosting
npm run deploy           # Build + deploy everything
```

**Before any commit:** `npm run lint && npm run build && npm run test:run` must pass.

---

## When patterns repeat

If you write the same pattern 3+ times, **stop and extract**:

- **3 service functions with the same shape** → confirm `firebase/services/` pattern is documented here, then move on. Don't extract a generic wrapper — explicit > clever.
- **3 components with the same layout shell** → extract to a base component in `src/components/`.
- **3 forms with similar validation flow** → extract to a `useForm` composable in `src/composables/`.
- **3 callables with similar wrapper logic** → make sure the callable pattern above is followed exactly. Don't abstract the wrapper itself — the explicitness is the point.
- **3 places doing the same domain calculation** → extract to `src/utils/`.

**When extracting,** also write a one-paragraph note in this CLAUDE.md (or a new `skills/<pattern>.md`) so future sessions don't re-invent it.

---

## Working with the user (Johnny)

- Johnny is a marketer with Vue 3 + Firebase experience but isn't writing the code himself — Claude Code is. Explain *what* you're doing and *why* when it matters; skip the obvious narration.
- He cares about clean architecture and consistent patterns. Bias toward the safer, more conventional choice.
- He'll review commits in GitHub — write clear commit messages.
- He's mobile-first in his own life — expect short messages, sometimes voice-transcribed (so word substitutions). Read for intent, ask if ambiguous.
- When something is out-of-scope or risky, say so. He'll respect a "this is a bigger change than you might think" more than silent acceptance.

---

## Commit conventions

- One commit per logical change (not per file, not per phase — per feature increment).
- Format: `Phase N: short description` (e.g. `Phase 2: tradesperson signup wizard - step 3 (trades & experience)`)
- Body explains *why* if it's not obvious from the title.
- Reference open questions or decisions that were made: `Decided: tradies must verify ID before going live (per design.md § 4.1)`.

---

## Documentation hygiene

- **`design.md` schema changes** → also update `firestore.rules` and any affected service function in the same commit.
- **New conventions or patterns** → update this CLAUDE.md or add a `skills/<name>.md`.
- **Open questions answered** → strike through in `design.md` § 14 with the resolution noted.
- **Architectural decisions** (non-obvious choices) → add a comment in the relevant code file explaining why, AND note in commit body.
- **Setup work that requires human access** (third-party extensions, accounts, secrets, DNS) → append a checkbox section to [`HUMANTASKS.md`](./HUMANTASKS.md) at the repo root in the same commit that adds the feature depending on it. Group by phase so the user can see *why* each task exists.

We're keeping it lightweight at the start — no separate ADR folder until we actually have decisions worth tracking formally.

---

## What this project is NOT (sanity check list)

- Not Stripe-based payments between clients and tradies at MVP (offline; v1.1 brings Stripe Connect).
- Not a chat app — chat is scoped to jobs.
- Not a native app — PWA only.
- Not multilingual at launch.
- Not a self-serve marketplace — every tradie passes manual cert + ID vetting before going live.
- Not a job-board / bid marketplace — that's deferred (see `design.md` § 12 backlog).

If you find yourself building any of the above, stop and ask.

---

## After every change, run through this

- [ ] `npm run lint` passes
- [ ] `npm run build` passes (includes type-check)
- [ ] `npm run test:run` passes
- [ ] If schema changed, `interfaces.ts` + `firestore.rules` + service functions all consistent
- [ ] If a new pattern emerged 3+ times, it's been promoted (skill or note here)
- [ ] If an open question got answered, `design.md` § 14 reflects it
- [ ] Mobile (375px) tested
- [ ] Commit message follows convention
