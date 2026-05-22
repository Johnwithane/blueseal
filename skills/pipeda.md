# PIPEDA compliance

How account deletion and data export are wired so future sessions don't have to reverse-engineer it.

---

## What PIPEDA actually requires (the short version)

Canada's *Personal Information Protection and Electronic Documents Act* gives users three rights this codebase needs to support:

1. **Access** — the user can request a copy of every piece of personal data we hold about them.
2. **Deletion** — the user can request that we delete their personal data, with a reasonable timeframe for compliance.
3. **Breach notification** — if a security incident exposes personal data, we have to notify affected users + the Office of the Privacy Commissioner. (Not user-facing; lives in the incident-response runbook, not in code.)

This skill doc covers #1 and #2.

---

## Architecture (one paragraph)

The user clicks "Export my data" in AccountView → the [`exportMyData`](../functions/src/auth/exportMyData.ts) callable assembles a JSON snapshot of every Firestore record they're a party to, uploads it to `users/{uid}/exports/<ts>.json`, and emails a 30-day signed URL. The user clicks "Delete my account" → [`requestAccountDeletion`](../functions/src/auth/requestAccountDeletion.ts) sets `users/{uid}.deletedAt` to a server timestamp, hides their tradesperson profile from search immediately, emails a confirmation with recovery instructions, and signs them out. The Pinia auth store ([src/stores/auth.ts](../src/stores/auth.ts)) refuses to seat a session for any user with `deletedAt != null` — so subsequent sign-ins fail until either an admin clears the field (recovery) or [`scheduledHardDelete`](../functions/src/auth/scheduledHardDelete.ts) wipes the account permanently after a 30-day grace period.

---

## The grace period — why 30 days, why no self-serve un-delete

- **30 days** is the standard reasonable timeframe for online services + matches the SLA Apple/Google/Microsoft use. Long enough to cover most "wait, I didn't mean to" recoveries; short enough to be defensible against "you're holding my data forever" complaints.
- **No self-serve un-delete** is deliberate. Recovery has to be deliberate to defend against malicious actors who briefly compromise an account, request deletion, then un-delete to cover tracks. Forcing recovery through the support inbox creates a paper trail.

---

## What gets deleted vs. what's kept

The `hardDeleteOne` function in `scheduledHardDelete.ts` makes deliberate choices:

**Hard-deleted (personal data the user owns alone):**
- `users/{uid}` doc
- `tradespeople/{uid}` doc
- `certifications/{*}` where `tradespersonId === uid`
- `idVerifications/{uid}`, `insuranceVerifications/{uid}`, `wsibVerifications/{uid}`
- `bookings/{*}` where `tradespersonId === uid`
- `notifications/{*}` where `userId === uid`
- Storage trees: `/tradespeople/{uid}/*`, `/users/{uid}/*`
- Firebase Auth user

**Intentionally kept (shared records with another party):**
- `jobs/{*}` — both client and tradesperson are parties; deleting would erase the counterparty's history.
- `chats/{*}` and their `messages` — same reasoning. Also potentially needed for dispute resolution.
- `reviews/{*}` — public reviews stay attached to the tradesperson; deleting them would let a banned user reset their reputation by deleting + re-signing-up.
- `clientReviews/{*}` — same.
- `invoices/{*}` — tax records on both sides.
- `applications/{*}` — historical record of who applied to what; kept for both the client's audit and the tradesperson's ban-recovery defense.
- `auditLog/{*}` — regulatory record.

**Anonymization strategy for the kept records:**
We don't actively rewrite displayName fields. Once `users/{uid}` is gone, frontend reads of the deleted user's name return null and the UI falls back to "(unknown user)" or similar. Denormalized displayName fields on jobs/chats become stale but no longer link to live PII. Good enough for MVP; revisit if regulators push back.

---

## When to extend this

**You'll need to update `scheduledHardDelete.hardDeleteOne()` if you:**
1. **Add a new top-level collection that stores user-personal data.** Add a `deleteWhere(collectionName, fieldName, uid)` call. Examples this would catch in future phases: `subscriptions/`, `disputes/`, `reports/`.
2. **Add a new Storage tree.** Add a `bucket().deleteFiles({ prefix: ... })` call.
3. **Add a new sensitive field on the `users` doc that other queries might index.** Make sure the `deleteWhere` calls cover any collection that filters by that field.

**You'll need to update `exportMyData()` if you:**
1. **Add a new top-level collection the user is a party to.** Add a parallel `getDocs(where(...))` call. The JSON blob includes everything the user could reasonably want.
2. **Add a new per-user single doc.** Add a `db.doc(...).get()` and include in the export.

**You'll need to update the AccountView UI if you:**
1. **Add a new privacy control** (e.g. download messages in addition to metadata; choose what to include in the export). Currently the export is all-or-nothing for simplicity.

---

## Recovery flow (manual, until admin UI lands)

A user replies to their deletion confirmation email saying "I didn't mean to". The on-call admin:

1. Opens Firebase console → Firestore → `users/{uid}`.
2. Sets `deletedAt = null` (use the "delete field" action, not "set to null" — both work but null is more explicit).
3. If they were a tradesperson: opens `tradespeople/{uid}` and sets `isVisible = true` (assuming `vettingStatus === "approved"`).
4. Replies to the email confirming restoration.
5. Ideally logs the action in `auditLog/` manually (the future admin UI would automate this).

Recovery only works *before* `scheduledHardDelete` fires. Once the grace period passes, the account is gone and the user has to sign up fresh.

---

## Testing the flow end-to-end

The full flow takes 30 days, but you can fast-forward by adjusting `GRACE_PERIOD_MS` locally:

1. Create a test user with a few jobs/reviews/notifications.
2. Click "Export my data" — check email + click the download link, verify the JSON is complete.
3. Click "Delete my account", type DELETE, submit.
4. Confirm:
   - User is signed out
   - User doc has `deletedAt` set
   - Tradesperson doc (if any) has `isVisible: false`
   - Confirmation email arrived
   - Sign-in is blocked (auth store check)
5. Reduce `GRACE_PERIOD_MS` to 60 seconds in `scheduledHardDelete.ts`, deploy, manually trigger the scheduled function via the Cloud Scheduler UI.
6. Verify hard delete completed:
   - User doc gone
   - Tradesperson doc gone
   - Cert/ID/insurance/WSIB docs gone
   - Bookings gone
   - Notifications gone
   - Storage prefixes empty
   - Firebase Auth user gone (try signing in — refuses)
   - Jobs/chats/reviews/invoices STILL EXIST (intentional)
   - `auditLog/` has both the deletion request + the hard delete entry
7. Restore the 30-day value before merging.

---

## Common pitfalls

- **Forgetting to add a new collection to `hardDeleteOne`.** A future-added `subscriptions/` collection would otherwise outlive the user. Use this skill doc's "when to extend" section as a pre-merge checklist.
- **Forgetting to add a new collection to `exportMyData`.** Less load-bearing than the deletion side (user loses access at signout anyway), but legally weaker — PIPEDA expects everything to be in the export.
- **Hard-deleting shared records by accident.** Don't add `db.collection("jobs").where("clientId", "==", uid).delete()` — the counterparty depends on those.
- **Sending the deletion confirmation email without verifying recovery instructions.** The email is the only recovery path. Test the email template after any change to `requestAccountDeletion.ts`.
- **Letting `scheduledHardDelete` fail silently.** The per-user try/catch is intentional (one bad user shouldn't block the sweep) but it means failed deletions only surface in Cloud Functions logs. Monitor the logs after the first month in production.
