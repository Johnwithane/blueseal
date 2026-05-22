# Trust badges

How verification badges (Insurance, WSIB, future Background Check) plug into the codebase, and how to add a new one without duplicating the wheel.

---

## Architecture (one paragraph)

Each trust badge is a **single doc per tradesperson** in a dedicated top-level collection (e.g. `insuranceVerifications/{tradieId}`, `wsibVerifications/{tradieId}`) — same shape as `idVerifications/{tradieId}`. The tradesperson uploads + submits via [src/components/TrustBadgesSection.vue](../src/components/TrustBadgesSection.vue) in their account page; the admin reviews via [src/views/admin/ApplicationReviewView.vue](../src/views/admin/ApplicationReviewView.vue) (approve / reject with reason). Status flip to `approved` fires a Cloud Function trigger (under `functions/src/vetting/`) that mirrors a boolean flag + expiry timestamp onto the public `tradespeople/{uid}` doc so the badge can render on cards + profiles without an extra read. The badge auto-hides client-side once `expiresAt` passes, so an admin doesn't need to revoke when a policy lapses — the tradesperson just re-uploads.

---

## Why mirror the badge onto the tradesperson doc

Search results and profile cards are heavy reads — many cards rendered at once. Reading the full `insuranceVerifications` doc for every card would 2x the read count. By mirroring just two fields (`insuranceVerified: boolean`, `insuranceExpiresAt: Timestamp | null`) onto the existing `TradespersonDoc` (which the card already reads), the badge displays for free. The verification doc stays as the source of truth for the audit trail + the upload itself.

Rules pin those mirrored fields as immutable to the owner — only the Cloud Function trigger (admin SDK, bypasses rules) can set them. A tradesperson can't grant themselves a badge by editing their own doc.

---

## Adding a new badge type

The five places you touch (in order). Reference: see [functions/src/vetting/onInsuranceApproved.ts](../functions/src/vetting/onInsuranceApproved.ts) for the canonical example.

1. **Schema in [src/firebase/interfaces.ts](../src/firebase/interfaces.ts):**
   - Define `XyzVerificationDoc` with the type-specific fields + the standard review fields (`status: DocStatus`, `submittedAt`, `reviewedBy`, `reviewedAt`, `rejectionReason`).
   - Add `xyzVerified: boolean` and `xyzExpiresAt: Timestamp | null` to `TradespersonDoc`.

2. **Firestore rules ([firestore.rules](../firestore.rules)):**
   - Add the new collection rule following the insurance/WSIB pattern: owner + admin read; owner create/update while pending; admin update; admin delete.
   - Add the new field pin to the `tradespeople` update rule:
     ```
     && request.resource.data.xyzVerified == resource.data.xyzVerified
     && request.resource.data.xyzExpiresAt == resource.data.xyzExpiresAt
     ```

3. **Storage rules ([storage.rules](../storage.rules)):**
   - Add `match /tradespeople/{tradieId}/xyz/{file=**}` — owner + admin read, owner write WebP-or-PDF. Mirror insurance/wsib.

4. **Service ([src/firebase/services/xyzVerifications.ts](../src/firebase/services/)):**
   - `submitXyz`, `getXyz`, `approveXyz`, `rejectXyz` — copy-paste shape from `insuranceVerifications.ts`.

5. **Cloud Function trigger ([functions/src/vetting/onXyzApproved.ts](../functions/src/vetting/)):**
   - `onDocumentUpdated` on `xyzVerifications/{tradieId}`.
   - Filter: `if (before.status === after.status) return;` + `if (after.status !== "approved") return;`
   - Update tradesperson doc: `{ xyzVerified: true, xyzExpiresAt: after.expiresAt ?? null }`.
   - Call `notify({ type: "xyz_approved", priority: "normal", ... })`.
   - Register in [functions/src/index.ts](../functions/src/index.ts).

Then the UI:

6. **Notification type** in both `NotificationType` unions ([src/firebase/interfaces.ts](../src/firebase/interfaces.ts) AND [functions/src/lib/notify.ts](../functions/src/lib/notify.ts)) + an icon entry in [NotificationsPanel.vue](../src/components/NotificationsPanel.vue).
7. **Upload UI** — extend [TrustBadgesSection.vue](../src/components/TrustBadgesSection.vue) with a new card. The component already loads all badges via `Promise.all`; just add the third.
8. **Admin review UI** — extend [ApplicationReviewView.vue](../src/views/admin/ApplicationReviewView.vue) with a new section in the trust-badges grid + a new reject Dialog.
9. **Public display** — add a `xyzLive` computed (mirror `insuranceLive`) + a `<Tag>` in both [TradieCard.vue](../src/components/TradieCard.vue) and [TradieProfileView.vue](../src/views/TradieProfileView.vue).
10. **Skill doc** — add a row to the table below + update [skills/notifications.md](./notifications.md) inventory.

---

## Current badges

| Badge | Source collection | Mirrored field | Expires | UI affordance |
|---|---|---|---|---|
| **ID verified** | `idVerifications/{uid}` | `tradesperson.idVerified` | Never | `OnboardingWizard.vue` (required to go live) |
| **Insured** | `insuranceVerifications/{uid}` | `tradesperson.insuranceVerified` + `insuranceExpiresAt` | Yes (1 year typical) | `TrustBadgesSection.vue` (optional) |
| **WSIB verified** | `wsibVerifications/{uid}` | `tradesperson.wsibVerified` + `wsibExpiresAt` | Yes (60–90 days typical) | `TrustBadgesSection.vue` (optional) |

---

## Public-display gating

Badges only render in `TradieCard.vue` and `TradieProfileView.vue` when:

```ts
const live = computed(() => {
  if (!tradie.value?.xyzVerified) return false;
  const exp = tradie.value.xyzExpiresAt?.toDate?.().getTime();
  return exp == null || exp > Date.now();
});
```

The expiry check is client-side. For audit-grade enforcement, an admin can also flip `xyzVerified: false` via the admin SDK if a policy lapses materially before expiry (we don't have a UI for this yet — it's a future P1 item alongside account suspension).

---

## Cost / abuse considerations

- **Storage paths** are owner-only-readable (plus admin) per [storage.rules](../storage.rules). Insurance and WSIB docs commonly include the tradesperson's name, address, and policy details — treating them like ID-level sensitivity is the safer default.
- **Upload size cap** is `docSizeOk()` = 10MB. Insurance PDFs from CA insurers run 1–4MB typically.
- **Per-tradie quota** is implicit: one doc per badge type. Re-uploading replaces the prior submission. If you ever want to keep history, switch to a subcollection (`/insuranceVerifications/{uid}/submissions/{submissionId}`) and treat the parent doc as the "current" one — but the current single-doc model is simpler and audit-log records every approve/reject.

---

## Common pitfalls

- **Forgetting to pin the new mirrored field in the `tradespeople` update rule.** Without that pin, a tradesperson could grant themselves a badge by editing their own doc directly. The CI deploy logs will not catch this — only an audit will. Always add the pin when you add the field.
- **Setting badge expiry on the verification doc but not mirroring it.** The card's expiry check reads from `tradespeople.xyzExpiresAt`, not from the verification doc. If the trigger forgets to copy it, the badge never auto-hides.
- **Using `priority: "high"` for the approval notification.** Approvals are positive but not urgent. `normal` is right — the tradesperson will see it in their inbox + email when they next check.
- **Allowing rejected docs to remain "pending" forever.** The current pattern lets the owner re-upload over a rejected doc. Make sure the new card UI shows the rejection reason + a fresh upload form, not a locked-out state.
