# Admin-editable site content

Where admin-editable content lives in the codebase, and how to add a new editable block (e.g. a homepage banner, a featured tradesperson, a FAQ entry) without duplicating the wheel.

---

## Architecture (one paragraph)

All admin-editable site content lives in the **`siteContent/{docId}`** Firestore collection — world-readable, admin-only-write per [firestore.rules](../firestore.rules). One doc per logical page (`siteContent/home` for the home page; future docs would be `siteContent/about`, `siteContent/banner`, etc.). The corresponding TypeScript interfaces live in [src/firebase/interfaces.ts](../src/firebase/interfaces.ts). Each interface has its own service file under [src/firebase/services/](../src/firebase/services/) with `get*` and `save*` helpers. The admin edits via [src/views/admin/AdminSiteContentView.vue](../src/views/admin/AdminSiteContentView.vue), accessed from the admin dashboard. The public-facing view (e.g. `HomeView.vue`) reads the doc at mount and renders only if data exists — empty docs gracefully hide their sections so we never ship fake content.

---

## Current editable blocks

| Doc | Field | Editor | Public consumer |
|---|---|---|---|
| `siteContent/home` | `testimonials: Testimonial[]` | [AdminSiteContentView.vue](../src/views/admin/AdminSiteContentView.vue) | [HomeView.vue](../src/views/HomeView.vue) testimonials section |

---

## Adding a new editable block

Two patterns depending on scope:

### Pattern A: New field on an existing page doc

Best when the new field belongs to a page you already have a doc for (most cases).

1. **Add the field to the interface** in [src/firebase/interfaces.ts](../src/firebase/interfaces.ts). Example: `heroBannerCopy: string` on `HomeContentDoc`.
2. **Extend the service save function** in the corresponding service file. Add a parameter to the save helper or split into a smaller, field-scoped helper if the editing UX warrants it.
3. **Add a new section to the AdminSiteContentView** with appropriate form controls.
4. **Read from `getHomeContent()` in the public view** and render conditionally.
5. **No new rules** needed — they're scoped to the whole `siteContent/` collection.

### Pattern B: New page doc

Best when you're adding a new editable page (an About page, a Pricing page, etc.).

1. **Add the interface** `XyzContentDoc` in [src/firebase/interfaces.ts](../src/firebase/interfaces.ts).
2. **Add `getXyz` + `saveXyz` to [src/firebase/services/siteContent.ts](../src/firebase/services/siteContent.ts).** Keep all `siteContent/` helpers in one file so the pattern stays discoverable.
3. **Either:**
   - Extend `AdminSiteContentView.vue` with a tabbed/sectioned layout, OR
   - Create a new admin view per page (`AdminAboutContentView.vue`) and link from the admin dashboard.
4. **Add the public-facing render** in the corresponding page view.
5. **No new rules** needed.

---

## Why one collection, not many

Could have done `testimonials/{id}` as its own collection. Reasons not to:

- **Rules consolidation.** One `match /siteContent/{docId}` rule covers all editable content. No rule sprawl.
- **Edit UX.** Admin edits all home-page content in one view; one save commits everything. No partial-save bugs.
- **Read efficiency.** Home page reads one doc, not N docs from N collections.
- **Schema flexibility.** Adding a new field is trivial; adding a new collection requires rules updates.

The downside is doc-size limits (1MB max per Firestore doc). At ~1KB per testimonial, that's room for 1000+ testimonials before we'd need to migrate.

---

## Security model

- **Read:** `if true` — anonymous reads are allowed. The home page renders for logged-out visitors.
- **Create/Update/Delete:** `if isAdmin()` — only the admin role.
- The save service writes `updatedBy: uid` so the audit trail is in the doc itself; admin actions also flow through `auditLog/` if you want a chronological view (extend `saveHomeTestimonials` to call `logAdminAction` for that).

---

## When NOT to put it here

`siteContent/` is for **content the admin curates**. It's not the place for:

- **User-generated content** (reviews, chat messages, applications) — those have their own collections with party-based read rules.
- **Configuration that should be code** (route definitions, brand color tokens) — keep in source so it's versioned with the deploy.
- **Per-user preferences** (notification settings, saved searches) — those belong on the user doc or a per-user subcollection.
- **High-volume editable lists** (>1000 entries) — split into a dedicated collection with proper indexing.

---

## Common pitfalls

- **Forgetting to handle the empty doc.** New `siteContent/home` doesn't exist until the admin saves it for the first time. `getHomeContent()` returns null in that case. Public views must check + render conditionally — don't assume the doc exists.
- **Letting fake content ship.** When the section is empty, *hide* the section. Don't fall back to placeholder quotes — that defeats the entire purpose of moving testimonials to admin-editable content. The home page section uses `v-if="testimonials.length"` for exactly this.
- **Skipping the trim.** User-pasted content commonly has trailing whitespace. The save service trims each field — keep that pattern when adding new fields.
- **Not validating before save.** The admin UI rejects empty fields with a toast rather than silently dropping them. Bad data caught at write time is much easier to debug than at render time.
