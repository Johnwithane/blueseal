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
6. ✅ Bug pulse: run `npm run bugs -- list open` (local sessions; remote sessions use `gh issue list --label bug --state open`). If anything's open, surface it to Johnny before diving into other work — he decides whether it jumps the queue.

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
8. **Firebase changes deploy before commit.** Any change that touches `firestore.rules`, `storage.rules`, `firestore.indexes.json`, or `functions/` source must be deployed to Firebase *before* the commit that ships the dependent code. Never commit code that calls a function or relies on a rule that isn't live yet — that's the #1 way prod silently breaks. See [Firebase deployment discipline](#firebase-deployment-discipline) below.

---

## Workflow principles

These shape *how* code gets written inside the per-feature loop below.

1. **Plan before coding.** For any non-trivial task, write a short plan first — files you'll touch, approach, success criteria. Reduce ambiguity before writing code, not after. For small edits, a one-line inline plan is enough.
2. **Surgical edits only.** Change only what the task requires. Don't reformat, rename, or "improve" unrelated code or comments while you're in there. Every extra line is review burden and regression risk — minimize churn.
3. **Keep it simple.** Prefer 100 lines over 1000. Avoid speculative abstractions and premature generalization. If you can solve it without a new helper, do. Clean up dead code and cruft as you encounter it (within the task's scope).
4. **Verify relentlessly.** Before declaring something done: check assumptions, edge cases, and tradeoffs; run the quality gates; read your own diff. Don't blindly trust that it worked because there was no error — stay in the loop.
5. **Goal-driven execution.** State success criteria up front. Where it fits the feature, write the test first and then make it pass. Iterate against the criteria, not against vibes.
6. **Parallelize with subagents.** Offload research, exploration, and broad codebase searches to subagents so the main context stays clean. One focused task per subagent. Merge results with judgment — don't just relay them.

Three meta-principles that override the above when in tension:

- **Simplicity first.** Minimal code that solves the problem. Nothing speculative, nothing "in case we need it later."
- **No laziness.** Find root causes. No temporary fixes that paper over the real issue. Senior-developer standards.
- **Minimal impact.** Only touch what's necessary. No side effects beyond the task. No new bugs.

---

## Engineer mindset

How to *carry* the work, not just produce it.

- **Tenacity.** When the test fails or the build breaks, iterate. Read the error, form a hypothesis, try again. Don't bail out to "let me know how you'd like to proceed" on the first red — that's giving up disguised as deference. Bail out when you're genuinely stuck or about to do something risky, not when you're frustrated.
- **Leverage.** Translate vague asks into declarative success criteria, then drive to them. "Make the signup work" → "intake form validates with Zod, writes to `users/{uid}` with role claim set, redirects to dashboard, tested at 375px." Specs multiply leverage; vibes don't.
- **Fun.** Bias toward courage on the creative parts — try the cleaner refactor, the better-named component, the nicer empty state. Automate the drudgery (boilerplate, scaffolding, repetitive test setup). Don't be timid where boldness is cheap.
- **Atrophy.** Johnny is reading the diff, not writing it. When a change is non-obvious — a tricky rule, an unusual pattern, a tradeoff taken — explain *why* in the commit body or a code comment, so he stays sharp on the codebase he owns. Don't over-narrate the obvious.
- **Speedups ≠ just faster.** Use the speed to do *more*, not to rush. More tests, more edge cases handled, more mobile checks, a real verify step. If a task finishes "fast," that's the budget for thoroughness — not a license to ship thinner work.
- **Slopacolypse.** Be allergic to confident-sounding output that isn't actually grounded. Don't invent APIs, file paths, library functions, or Firestore field names — check them. If a fix "looks right" but you didn't verify the failure mode, say so. Signal beats hype.

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
Deploy Firebase changes (IF rules / indexes / storage / functions touched):
  firebase deploy --only firestore:rules,storage,firestore:indexes,functions
  → confirm success in CLI output before continuing
  ↓
Help/FAQ check: did this add/change something users can see or do?
  → if so, update the Help Center / FAQ (src/data/help.ts). See below.
  ↓
QA toolkit check: did this add/change a feature or flow?
  → if so, update the QA happy paths (docs/QA_HAPPY_PATHS.md) + the structured checklist (src/data/qaChecklist.ts). See below.
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
npm run deploy:hosting   # Build + deploy hosting only
npm run deploy:prod      # Build + deploy hosting + firestore rules/indexes + storage (NOT functions)
npm run functions:deploy # Deploy ALL functions at once. Avoid: trips the per-minute quota
npm run rules:deploy     # Deploy firestore:rules + storage rules
# Preferred for functions: firebase deploy --only functions:<name>  (targeted, quota-safe)
```

**Before any commit:** `npm run lint && npm run build && npm run test:run` must pass *and* any Firebase-side changes must be deployed (see below).

---

## Firebase deployment discipline

If a change touches any of the following, it must be deployed to Firebase **before** the commit lands:

| Change | Deploy command |
| --- | --- |
| `firestore.rules` | `firebase deploy --only firestore:rules` |
| `storage.rules` | `firebase deploy --only storage` |
| `firestore.indexes.json` | `firebase deploy --only firestore:indexes` |
| `functions/` (any callable, trigger, scheduled job) | `firebase deploy --only functions` |
| Multiple of the above in one feature | `firebase deploy --only firestore:rules,storage,firestore:indexes,functions` |

**Why deploy-before-commit:**
- Committing a client that calls a non-deployed Cloud Function = the moment Johnny pulls/CI deploys hosting, prod is broken.
- Committing rules that lag behind the data shape = silent permission-denied errors users can't recover from.
- The deployed Firebase state IS the contract the client codes against. The commit should never reference a contract that isn't live.

**Process:**
1. Run the verify gates (`lint && build && test:run`) — including `tests/rules/` so rules changes don't break existing collections.
2. Run the targeted `firebase deploy --only ...` command. Confirm the CLI prints `✔ Deploy complete!` (or per-target ✔ lines). If any target fails, **stop** — do not commit. Fix the failure, redeploy, then commit.
3. After deploy succeeds, commit the code change. Reference the deploy in the commit body when it's non-trivial (e.g. `Deployed: firestore:rules + functions (acceptVouch callable)`).
4. Hosting (`firebase deploy --only hosting` or `npm run deploy:prod`) is separate and happens *after* commit + push — that's the normal release flow and stays unchanged.

**One exception:** while iterating locally against emulators (`npm run dev:full`), you don't deploy on every WIP save — only when you're about to commit the change. The rule is about commit boundaries, not edit boundaries.

**Failure modes and rollback:** see [skills/firebase-deploy.md](skills/firebase-deploy.md) for the full reference — what each `✔` line means, the common failure modes (TS errors in predeploy, index-build delays, missing-function deletion prompts), and how to roll back rules / functions / indexes when a deploy goes bad.

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

### Claude Code tooling (cost routing)

Which Claude model to use when on this repo, plus pre-built cheap subagents so the expensive model isn't doing grunt work:

- [`docs/MODEL_STRATEGY.md`](./docs/MODEL_STRATEGY.md) — the four-tier playbook (Opus 4.8 is the default; reserve Fable; hand off to a cheap subagent for search/tests/QA). The Opus default is set globally at user level, so this repo already inherits it.
- [`.claude/agents/`](./.claude/agents/) — `scout` (Haiku, read-only research), `test-writer` (Sonnet, Vitest + `tests/rules/`), `qa-runner` (Sonnet, Playwright QA). Each pins its own model.
- [`docs/QA_PLAYWRIGHT.md`](./docs/QA_PLAYWRIGHT.md) — the runbook `qa-runner` drives (emulators + seeded roles, per-role route sweeps, mobile 375px).

### Bug triage

In-app bug reports land in `bugReports/{id}` AND are auto-mirrored to GitHub issues (`onBugReportCreated`). When Johnny asks "how are the bugs" (or any variant), follow the **`/bugs` skill** ([`.claude/skills/bugs/SKILL.md`](./.claude/skills/bugs/SKILL.md)): pull the queue (`npm run bugs -- list open` locally; GitHub issues labeled `bug` remotely), read the screenshots, diagnose against recent commits before assuming a report is new, write statuses back with root-cause notes, and fix what's fixable. Closing an issue syncs back to Firestore (`scheduledBugIssueSync`) and queues the reporter's "fixed" notice — so only close/flip to fixed when the fix is actually live.

### Help Center & FAQ upkeep

The Help Center, FAQ, and homepage FAQ teaser are all driven by **one hardcoded source of truth**: [`src/data/help.ts`](./src/data/help.ts) (`HELP_CONTENT_SEED` — categories, articles, FAQs). There is **no CMS / admin editor and no Firestore doc** — editing help content is a deliberate code change, on purpose, so it goes through review like everything else.

**The rule:** whenever you ship a change that a user can *see or do* differently — a new feature, a renamed flow, a changed payment/verification step, a new role capability — **check `src/data/help.ts` and update it in the same feature commit.** Ask: "Would a real user now have a question this doesn't answer, or read an answer that's now wrong?" If yes, add/edit the relevant FAQ entry and/or article.

Guidelines when editing:
- **Stay accurate.** Don't promise SLAs, fee figures, timelines, or guarantees that aren't actually live in the product. (E.g. the fee model in `MONETIZATION.md` is *proposed* — keep help copy qualitative until it ships.)
- **Keep `audience` right** (`all` / `client` / `tradesperson`) and point every article/FAQ at a real `categoryId`.
- **Slugs are URLs** — unique, lowercase, and stable once shipped (a renamed slug breaks existing links). Add a new article rather than renaming if a link is already out there.
- **Bodies/answers are Markdown.** The integrity test (`src/utils/helpSearch.test.ts` → "HELP_CONTENT_SEED integrity") validates the whole set against `helpContentSchema` (unique slugs, valid category refs, length caps) — `npm run test:run` fails if you break it.

When a feature is big enough to warrant its own walkthrough, add a full **article** (not just an FAQ) and mark it `popular: true` if it's a top task.

### QA toolkit upkeep

The self-serve QA toolkit at `/qa` ([`src/views/qa/QaToolkitView.vue`](./src/views/qa/QaToolkitView.vue)) has **two coupled surfaces** a tester (or the `qa-runner` agent) uses:

1. **The prose runbook** — [`docs/QA_HAPPY_PATHS.md`](./docs/QA_HAPPY_PATHS.md), imported `?raw` and rendered as collapsible sections. The deep "how, exactly" reference.
2. **The structured, trackable checklist** — [`src/data/qaChecklist.ts`](./src/data/qaChecklist.ts), rendered per-role by `QaChecklistPanel` with **shared pass/fail progress** (a qa-only `qaChecklist/{itemId}` Firestore collection). The team's "what to test + track."

**The rule (same discipline as the Help Center):** whenever you ship a new feature or change a flow, in the same feature commit **(a) update `docs/QA_HAPPY_PATHS.md`** AND **(b) add/adjust the matching item in `src/data/qaChecklist.ts`** (with a stable `id` — never renumber a shipped id; progress is keyed on it). Ask: "If a tester opened `/qa` right now, is there a trackable path that exercises what I just built, with steps + expected result?" If not, add one.

Guidelines:
- Keep each path **role-scoped** (it lives under that role in `qaChecklist.ts`) and **step-by-step with an expected outcome**, so it's runnable without tribal knowledge.
- Cover the **money / permission-sensitive seams** a unit test can't fully prove (e.g. a rep can only vet their own region, commission accrues on payment, the PM money-path: card-pay → rep + PM commission both accrue → refund reverses both).
- Note the **mobile (375px)** check where the surface is user-facing.
- The runbook is Markdown `?raw` (no gate) — keep headings consistent. `qaChecklist.ts` IS gated by `npm run build` (it's typed) + the `qaChecklist` rules tests.
- The toolkit can also **provision the new roles** (Become a project manager / sales rep) — if you add a role, add its provisioning callable + button there too.

---

## What this project is NOT (sanity check list)

- Not Stripe-based payments between clients and tradies at MVP (offline; v1.1 brings Stripe Connect).
- Not a chat app — chat is scoped to jobs.
- Not a native app — PWA only.
- Not multilingual at launch.
- Not a self-serve marketplace — every tradie passes manual cert + ID vetting before going live.
- Not a lowest-bid race. The job board (`design.md` § 4.6) now lets verified tradies apply to an open post with a **full itemized quote**, and the client compares quotes and accepts one (`acceptApplicationQuote`). It's a curated compare-and-choose between vetted pros — not an anonymous reverse auction on price alone. Coexists with the direct-request flow; both converge on the same `jobs/{jobId}` pipeline.

If you find yourself building any of the above, stop and ask.

---

## After every change, run through this

- [ ] `npm run lint` passes
- [ ] `npm run build` passes (includes type-check)
- [ ] `npm run test:run` passes (including `tests/rules/` if rules changed)
- [ ] If schema changed, `interfaces.ts` + `firestore.rules` + service functions all consistent
- [ ] **If `firestore.rules` / `storage.rules` / `firestore.indexes.json` / `functions/` changed → `firebase deploy --only ...` ran successfully BEFORE this commit** (see [Firebase deployment discipline](#firebase-deployment-discipline))
- [ ] If a new pattern emerged 3+ times, it's been promoted (skill or note here)
- [ ] **If the change affects what users see/do → Help Center / FAQ (`src/data/help.ts`) updated** (see [Help Center & FAQ upkeep](#help-center--faq-upkeep))
- [ ] **If the change added/changed a feature or flow → QA happy paths (`docs/QA_HAPPY_PATHS.md`) AND the structured checklist (`src/data/qaChecklist.ts`) updated** (see [QA toolkit upkeep](#qa-toolkit-upkeep))
- [ ] If an open question got answered, `design.md` § 14 reflects it
- [ ] Mobile (375px) tested
- [ ] Commit message follows convention
