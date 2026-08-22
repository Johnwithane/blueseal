# Disaster recovery: backups, restore, and what to do when data is wrong

> **Status: ENABLED 2026-08-21.** PITR (7-day), daily scheduled backups (14-week
> retention), database delete protection, and 30-day Storage soft delete are all
> live on `blueseal-762af`. The rest of this file is the restore runbook.
> Re-verify with the commands under [What's enabled](#whats-enabled).

## Why this exists

Before 2026-08-21 this project had **no** Firestore backup and **no** point-in-time
recovery. The version retention window was Firestore's floor of 1 hour. Nothing
covered:

- a Cloud Function writing bad data across a whole collection (there are 15 scheduled
  sweeps, two of which delete data outright),
- an accidental mass delete from `/admin`,
- a bad `firestore.rules` deploy that lets something destructive through,
- credential compromise on an owner account.

Firestore has no undo. Without backups those are unrecoverable, permanently.

---

## Running these commands

**Run gcloud from PowerShell, not bash.** Backslash line continuations (`\`) are a
bash-ism and a parse error in PowerShell, so keep each command on one line.

**Always pass `--project=blueseal-762af --account=johnnyajansen@gmail.com` explicitly.**
This machine has two gcloud accounts and the active configuration is `[wishbone]` with
its project set to `bettertour`, so a bare command will silently act on the wrong
project. Johnny holds `roles/owner` on `blueseal-762af`.

> **Historical note, in case you find a stale reference to it.** Until 2026-08-21 the
> gcloud credential stored as `johnnyajansen@gmail.com` was actually a
> `marketing@wishboneltd.com` token, so *every* call against this project returned
> PERMISSION_DENIED regardless of the `--account` flag. Re-authenticated and fixed. That
> artifact produced at least one wrong conclusion in `HUMANTASKS.md` (a Secret Manager
> grant recorded as "needs whoever holds Owner" when Johnny *is* Owner), so treat any
> older "we don't have permission for that" note on this project as suspect until
> re-tested.

Two alternates, both correctly authenticated as Johnny, useful if gcloud ever drifts
again:

- **Firebase CLI**, which wraps all of Firestore backup/restore
  (`firebase firestore:databases:get`, `:backups:schedules:list`, `:databases:restore`).
- **ADC** for raw REST:
  `$t = gcloud auth application-default print-access-token`, then
  `Invoke-RestMethod -Headers @{Authorization="Bearer $t"} <url>`. ADC reads its own
  credential file and bypasses the gcloud account store entirely.

---

## What's enabled

Four mechanisms, covering different failure shapes. All enabled 2026-08-21.

| Protection | Setting | Covers |
|---|---|---|
| Firestore PITR | 7-day continuous window (`604800s`) | "we broke it in the last few hours" |
| Firestore scheduled backups | daily, 14-week retention (`8467200s`) | "we only noticed a week later" |
| Firestore delete protection | `DELETE_PROTECTION_ENABLED` | someone deletes the database itself |
| Storage soft delete | 30 days on the media bucket | an overwritten or deleted job photo / receipt / ID |

Verify the whole posture (one line each):

```powershell
# PITR + delete protection. Expect: nam5, ENABLED, ENABLED, 604800s.
gcloud firestore databases describe --database='(default)' --project=blueseal-762af --account=johnnyajansen@gmail.com --format='value(locationId,deleteProtectionState,pointInTimeRecoveryEnablement,versionRetentionPeriod)'

# Daily schedule. Expect one entry, dailyRecurrence, retention 8467200s = 14w.
gcloud firestore backups schedules list --database='(default)' --project=blueseal-762af --account=johnnyajansen@gmail.com

# Actual backups. NOTE the location is the DATABASE's location, nam5, NOT us-central1
# and NOT the media bucket's US-EAST1. First snapshot appears within 24h of the
# schedule being created, so "Listed 0 items" on day one is expected.
gcloud firestore backups list --location=nam5 --project=blueseal-762af --account=johnnyajansen@gmail.com

# Storage soft delete. Expect 2592000.
gcloud storage buckets describe gs://blueseal-762af.firebasestorage.app --project=blueseal-762af --account=johnnyajansen@gmail.com --format='value(soft_delete_policy.retentionDurationSeconds)'
```

**Bucket coverage.** Only the media bucket (`blueseal-762af.firebasestorage.app`, the one
`VITE_FIREBASE_STORAGE_BUCKET` points at) was raised to 30 days. The other four buckets
in the project keep GCS's 7-day default on purpose: `gcf-v2-sources-*` and
`gcf-v2-uploads-*` are function build artifacts, and `blueseal-762af.appspot.com` /
`staging.blueseal-762af.appspot.com` are legacy App Engine buckets holding no user data.
If anything ever starts writing user data to one of those, raise it too.

**Why soft delete and not Object Versioning:** soft delete retains overwritten objects as
well as deleted ones and expires them automatically, so the bill is bounded. Versioning
keeps every historical version forever unless you pair it with a lifecycle rule expiring
noncurrent versions. For a bucket taking user uploads on every job, bounded is the right
default.

---

## Restore

⚠️ A Firestore restore creates a **NEW database**. It does not overwrite `(default)` in
place. That is a feature: it lets you inspect before cutting over, and it means restoring
is never itself destructive.

```powershell
# 1. Find the backup (nam5, not us-central1)
gcloud firestore backups list --location=nam5 --project=blueseal-762af --account=johnnyajansen@gmail.com

# 2. Restore it into a NEW database id
gcloud firestore databases restore --source-backup=projects/blueseal-762af/locations/nam5/backups/<BACKUP_ID> --destination-database='restore-YYYYMMDD' --project=blueseal-762af --account=johnnyajansen@gmail.com

# 3. Inspect the restored copy BEFORE any cutover.
```

Then choose:

- **Targeted repair (usual case).** Only some docs are wrong. Read the good docs out of
  the restored database with the Admin SDK under ADC and write them back into `(default)`
  with a one-off script in `scripts/`. Dry-run first, dump what you are about to
  overwrite to a local JSON file, then write. This is almost always the right answer: it
  keeps every legitimate write that happened after the incident.
- **Full cutover (rare).** The whole database is unusable. Repoint the app and the
  functions at the restored database id. Every write since the backup is lost, so this is
  a last resort, and read both warnings below first.

PITR reads work the same way but with a timestamp instead of a backup id
(`--snapshot-time`), within the 7-day window. Firestore also supports cloning a database
as of a PITR timestamp, which is the cheapest way to get a "what did this look like at
14:05" copy without waiting on a nightly snapshot.

### ⚠️ Warning 1: a restore can resurrect data we are legally required to have deleted

`scheduledHardDelete` is the PIPEDA right-to-erasure sweep. Daily at 03:00 it finds users
whose `deletedAt` is more than 30 days old and wipes `users/{uid}`, `tradespeople/{uid}`,
their certifications, ID / insurance / WSIB verifications, bookings, notifications, their
Storage prefixes, **and their Firebase Auth account**.

A restore rewinds Firestore to a point where that personal data still existed. Restoring
wholesale therefore **undoes a completed erasure request**, which is a compliance
incident, not just a data-quality one. After any restore touching `users` or
`tradespeople`:

- Re-check for docs with `deletedAt` set and let the sweep re-run, or re-delete by hand.
- The restored copy also contains the personal data of people who have since exercised
  erasure. Delete the temporary `restore-*` database once you are done with it. Do not
  leave it sitting around as a convenience copy.

See [skills/pipeda.md](../skills/pipeda.md) for the erasure contract itself.

### ⚠️ Warning 2: Stripe is live and a restore does not roll it back

Stripe has been live since 2026-08-19. A Firestore restore rewinds **our** record of
invoices, payments, Connect payouts and Pro subscriptions. It does not rewind a single
thing on Stripe's side. After any restore touching `invoices`, `payments`, `jobs`,
subscriptions or the commission collections:

- **Stripe is the system of record for money, not Firestore.** Reconcile our docs against
  the Stripe dashboard, not the other way around.
- A restored-away `paymentIntent` still charged the client's card. A restored-away payout
  still moved money.
- Rewinding a doc a Stripe webhook already processed can make that webhook's work
  invisible while Stripe considers the event delivered. Re-drive it from the Stripe
  dashboard (Developers → Events → resend) rather than hand-patching Firestore.

If money-path or personal-data collections are in the blast radius, do targeted repair,
never a cutover.

---

## When data looks wrong: triage order

1. **Stop the bleeding.** If a scheduled function is writing bad data, pause it before
   anything else or it will overwrite your repair. All 15 live in `us-central1` and are
   named `firebase-schedule-<functionName>-us-central1`:

   ```powershell
   gcloud scheduler jobs list --location=us-central1 --project=blueseal-762af --account=johnnyajansen@gmail.com
   gcloud scheduler jobs pause firebase-schedule-<functionName>-us-central1 --location=us-central1 --project=blueseal-762af --account=johnnyajansen@gmail.com
   # and afterwards
   gcloud scheduler jobs resume firebase-schedule-<functionName>-us-central1 --location=us-central1 --project=blueseal-762af --account=johnnyajansen@gmail.com
   ```

   The ones worth knowing about, in rough order of destructiveness:

   | Function | When | What it touches |
   |---|---|---|
   | `scheduledHardDelete` | 03:00 | **irreversible.** PIPEDA erasure: deletes user + tradesperson docs, verifications, bookings, notifications, Storage prefixes **and the Firebase Auth account**, 30 days after a deletion request. Not recoverable from any backup we hold. |
   | `scheduledIdRetention` | 03:00 America/Toronto | **deletes** ID files from Storage and clears `idVerifications/{uid}` for tradespeople approved 90+ days ago |
   | `scheduledRepCommissionPayouts` | 03:30 on the 1st | moves real money via Stripe Connect |
   | `scheduledRecurringInvoices` | 04:00 | creates real invoices from recurring templates |
   | `scheduledGoogleReviewsSync` | 04:00 | overwrites synced review data on tradesperson docs |
   | `scheduledProCompExpiry`, `scheduledProspectExpiry`, `scheduledJobPostExpiry` | 03:00-03:30 | bulk status flips across their collections |
   | `markInvoiceOverdue`, `scheduledInsuranceExpiry`, `nudgeReviewPairs`, `scheduledBugFixNotices` | 09:00 | status flips plus outbound notifications, so a bad run emails real users |
   | `scheduledBugIssueSync`, `recomputePlatformStats` | every 6h | writes triage state back from GitHub; recomputes aggregate stats |

   Stripe webhooks and Firestore triggers are **not** pausable this way. If a trigger is
   the culprit, the lever is redeploying it as a no-op or deleting it.
2. **Establish the blast radius.** How many docs, which collections, since when? Check
   the function's structured logs in Cloud Logging for the run that did it.
3. **Check the cheap sources first.** If a one-off script caused this, its own dry-run
   dump may already hold exactly what you need, and it is far faster than a restore.
4. **Restore + targeted repair** per above.
5. **Write down what happened** here or in the relevant doc, so the next person inherits
   the lesson rather than the surprise.

---

## What is NOT covered

- **Firebase Authentication users: covered manually, not automatically.** Auth is not
  included in a Firestore backup. Losing the auth store means every user re-registers and
  their uid-keyed data (jobs, quotes, invoices, reviews, Stripe Connect links) orphans.
  A first export was taken 2026-08-21 (31 accounts, 25 with password hashes) and lives
  **outside this repo** at `C:\Users\Johnny\blueseal-backups\`, alongside a
  `README-RESTORE.md` with the import command.

  Three things to know, because the naive version of this does not work:
  1. **The export alone cannot restore passwords.** `auth:import` also needs the
     project's SCRYPT hash parameters (signer key, salt separator, rounds, memory cost),
     which are *not* in the export file. They are captured in that README, and can be
     re-fetched from the Identity Platform admin API or the Firebase console
     (Authentication → Users → three-dot menu → "Password hash parameters").
  2. **The whole folder is a secret** — every user's email plus password hashes plus the
     signer key. Never commit it, never sync it unencrypted. It belongs in a password
     manager vault or an encrypted drive.
  3. **Never replay it blind (PIPEDA).** An old export restored wholesale resurrects auth
     accounts `scheduledHardDelete` erased on request. Filter out any `localId` whose
     `users/{uid}` doc carries `deletedAt` before importing.

  It is a point-in-time dump, not a schedule, so it is worth roughly the day it was
  taken. Re-export periodically. Tracked in [HUMANTASKS.md](../HUMANTASKS.md).

  Worth knowing for a restore: `customAttributes` in the export carries the **role
  claims** that drive every Firestore rule. A user restored without their claim silently
  loses access to their own data, so verify roles after any import.
- **Cloud Storage objects older than 30 days.** Soft delete covers deletes and overwrites
  for 30 days only. There is no long-tail media backup. This interacts with
  `scheduledIdRetention` and `scheduledHardDelete` by design: deleted ID documents
  becoming permanently unrecoverable is the compliance outcome we want, not a gap.
- **Secret Manager values.** Keep the recovery values in a password manager. A deleted
  secret version is not recoverable from Firestore.
- **Stripe-side state.** Covered by Stripe, not by us. See Warning 2.

## Related

- [CLAUDE.md](../CLAUDE.md) → Firebase deployment discipline.
- [skills/firebase-deploy.md](../skills/firebase-deploy.md) → deploy failure modes and rollback.
- [skills/pipeda.md](../skills/pipeda.md) → the erasure contract a restore can violate.
