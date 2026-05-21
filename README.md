# Blue Seal

A two-sided PWA for trades work — clients hire verified tradespeople, tradies manage their book of business + AI tools, admins vet certifications + IDs.

Built per [`design.md`](./design.md). Tech stack and patterns: [`TECH_STACK_SETUP.md`](./TECH_STACK_SETUP.md).

---

## Quickstart

```bash
npm install
npm install --prefix functions
npm run dev
```

Then open <http://localhost:5173>.

### Production deploy

```bash
npm run deploy:prod
```

This builds the SPA, deploys hosting, Cloud Functions, Firestore rules + indexes, and Storage rules. The site goes to `blueseal.app` (configured in `.firebaserc` → project `blueseal-762af`).

---

## Configuration checklist

The MVP runs end-to-end as soon as you:

1. **Promote the first admin.** Sign up as a normal user, then run from a Cloud Function shell:

   ```bash
   firebase functions:shell
   > setAdminRole({ targetUid: "<the-uid-you-just-signed-up-with>" })
   ```

   On the user's next sign-in, the `role: "admin"` claim will be present.

2. **Seed intake form schemas (one time).** From the same shell after promoting yourself admin:

   ```bash
   > seedIntakeSchemas({})
   ```

3. **Install the "Trigger Email" extension** in the Firebase console and point it at `mail` collection. Without it, emails accumulate in Firestore but never send.

4. **(Optional) Wire Stripe.** Set secrets:

   ```bash
   firebase functions:secrets:set STRIPE_SECRET_KEY
   firebase functions:secrets:set STRIPE_WEBHOOK_SECRET
   ```

   Then implement Checkout in `functions/src/payments/stripeStub.ts` and webhook signature verification. Until then, `adminToggleSubscription` callable lets admins manually flip `users/{uid}.hasActiveSubscription` to test the AI gate.

5. **Enable Vertex AI for the AI tools.** No API key needed — Cloud Functions authenticate via the project's service account:

   ```bash
   gcloud services enable aiplatform.googleapis.com --project blueseal-762af
   ```

   Or click "Enable" in Cloud Console → APIs & Services. Without this, AI callables return a friendly error pointing back here.

6. **PWA icons.** Drop `icon-192.png`, `icon-512.png`, and `icon-512-maskable.png` in `public/icons/`. See `public/icons/icon-192.png.placeholder` for sizes.

7. **Custom domain.** In Firebase Hosting console → Add custom domain → `blueseal.app`. Update CSP `connect-src` in `firebase.json` if you add new external services.

---

## Project layout

```
src/
  firebase/        # config.ts, interfaces.ts, services/ (per-collection async fns)
  stores/          # Pinia (auth)
  composables/     # useToast, useFormatters
  router/          # Vue Router + role guards
  data/            # trades canonical list, seeded intake schemas
  validation/      # Zod schemas
  views/           # routes (auth/, admin/, tradie/, dashboards/, etc.)
  components/      # shared SFCs (Kanban, ChatThread, IntakeFormRenderer, etc.)
functions/src/
  auth/            # setRoleOnSignup, setAdminRole
  vetting/         # submit, decisions, triggers, scheduledIdRetention
  reviews/         # aggregation triggers
  chat/            # onMessageCreated
  invoicing/       # onJobCompleted, sendInvoice, scheduledOverdue
  ai/              # Gemini wrappers (gemini-2.5-flash)
  payments/        # Stripe stubs
  seed/            # intake schema seeder, ping
firestore.rules    # default-deny + per-collection allows
storage.rules      # ID admin-only, owner-write per scope
firebase.json      # hosting headers (CSP, HSTS, etc.), emulators
```

---

## Phase status

All 10 product phases from [`design.md` § 10](./design.md) are scaffolded:

| Phase | Status |
|-------|--------|
| 1. Foundation (auth, roles, shell) | ✅ |
| 2. Tradesperson onboarding wizard | ✅ |
| 3. Admin vetting console | ✅ |
| 4. Discovery (list + filters) | ✅ (map view deferred — list ships per chosen scope) |
| 5. Intake forms + request flow | ✅ |
| 6. Kanban + calendar + chat | ✅ |
| 7. Mutual reviews | ✅ |
| 8. AI tools | ✅ (Stripe gate stubbed; Gemini callable wired) |
| 9. Invoicing (PDF gen, send, mark paid) | ✅ |
| 10. PWA + security headers | ✅ |

---

## Things to verify before launch

- [ ] Sign up as both a client and a tradesperson and complete onboarding end-to-end.
- [ ] Promote yourself as admin and walk through the vetting flow.
- [ ] Seed intake schemas; confirm a real request renders the trade-specific form.
- [ ] Walk a job through requested → quoted → scheduled → in_progress → complete and confirm the draft invoice appears.
- [ ] Send an invoice; confirm PDF lands in Storage and email lands in the `mail` collection.
- [ ] Submit a review from both sides; confirm aggregates update on the tradie + user docs.
- [ ] Install Firebase "Trigger Email" extension and verify mail delivery.
- [ ] Drop PWA icons in `public/icons/` and verify install prompt.
- [ ] Add `blueseal.app` as custom domain; verify CSP allows everything you need.

---

## Known scope deferrals (vs. design.md)

- **Map view in discovery** — list view ships now; map can be added by dropping a `GoogleMapLoader` component into `SearchView.vue` (API key is already in `.env`).
- **Stripe subscription** — code paths and gating live in place; flip the flag (`adminToggleSubscription`) to test AI gates until real Stripe is wired.
- **App Check** — `enforceAppCheck: false` on callables for first deploy. Flip to `true` after registering an App Check provider in console.
- **FCM push notifications** — v1.1 per design doc.
