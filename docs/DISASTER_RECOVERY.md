# Disaster recovery: backups, restore, and what to do when data is wrong

> **Status: ENABLED 2026-08-21.** PITR (7-day), daily scheduled backups (14-week
> retention), database delete protection, and 30-day Storage soft delete are all
> live on `blueseal-762af`. The rest of this file is the restore runbook.
> Re-verify with the commands under [What's enabled](#whats-enabled).

## Why this exists

Before 2026-08-21 this project had **no** Firestore backup and **no** point-in-time
recovery. The version retention window was Firestore's floor of 1 hour. Nothing
covered:

- a Cloud Function writing bad data across a whole collection (`scheduledIdRetention`
  deletes Storage objects and clears `idVerifications/{uid}` every night;
  `scheduledRecurringInvoices` creates real invoices every night),
- an accidental mass delete from `/admin`,
- a bad `firestore.rules` deploy that lets something destructive through,
- credential compromise on an owner account.

Firestore has no undo. Without backups those are unrecoverable, permanently.

---

## ⚠️ gcloud does not work on this project from Johnny's machine

This bit is load-bearing, so read it before you copy a command out of the Firestore
docs.

`gcloud` on this machine has two stored accounts, and the credential filed under
`johnnyajansen@gmail.com` **is actually a `marketing@wishboneltd.com` token**. You can
see it in the error text: asking for `blueseal-762af` as `johnnyajansen@gmail.com`
returns *"marketing@wishboneltd.com does not have storage.buckets.get access"*.
`gcloud projects list` for that account returns Wishbone's projects, not Johnny's.

So **every `gcloud ... --project=blueseal-762af` command fails with PERMISSION_DENIED**,
and that failure means nothing about the account's real access. Two working paths:

1. **Firebase CLI** (logged in as `johnnyajansen@gmail.com`, and it genuinely is that
   account). This covers all of Firestore backup/restore. Preferred.
2. **Application Default Credentials** for anything the Firebase CLI does not wrap
   (Cloud Storage policies, Cloud Scheduler, Secret Manager). ADC on this machine
   *is* correctly `johnnyajansen@gmail.com` and has real access. Use it to mint a
   token and call the REST API directly:

   ```powershell
   $t = gcloud auth application-default print-access-token
   Invoke-RestMethod -Headers @{Authorization="Bearer $t"} "https://storage.googleapis.com/storage/v1/b/blueseal-762af.firebasestorage.app"
   ```

   (`gcloud auth application-default print-access-token` reads the ADC file directly
   and does not go through the broken account store, which is why it works.)

Fixing gcloud properly is a `gcloud auth login` for the real `johnnyajansen@gmail.com`.
Tracked in [HUMANTASKS.md](../HUMANTASKS.md).

---

## What's enabled

Four mechanisms, covering different failure shapes. All enabled 2026-08-21.

| Protection | Setting | Covers |
|---|---|---|
| Firestore PITR | 7-day continuous window (`604800s`) | "we broke it in the last few hours" |
| Firestore scheduled backups | daily, 14-week retention (`8467200s`) | "we only noticed a week later" |
| Firestore delete protection | `DELETE_PROTECTION_ENABLED` | someone deletes the database itself |
| Storage soft delete | 30 days on the media bucket | an overwritten or deleted job photo / receipt / ID |

Verify the whole posture (PowerShell, one line each):

```powershell
# PITR + delete protection. Expect ENABLED, ENABLED, 604800s.
firebase firestore:databases:get "(default)" --project blueseal-762af

# Daily schedule. Expect one entry, DAILY, retention 8467200s.
firebase firestore:backups:schedules:list --project blueseal-762af

# Actual backups. NOTE the location is the DATABASE's location, nam5.
# The first snapshot appears within 24h of the schedule being created.
firebase firestore:backups:list --location nam5 --project blueseal-762af

# Storage soft delete. Expect 2592000.
$t = gcloud auth application-default print-access-token
(Invoke-RestMethod -Headers @{Authorization="Bearer $t"} "https://storage.googleapis.com/storage/v1/b/blueseal-762af.firebasestorage.app").softDeletePolicy
```

**Bucket coverage.** Only the media bucket (`blueseal-762af.firebasestorage.app`, the
one `VITE_FIREBASE_STORAGE_BUCKET` points at) was raised to 30 days. The other four
buckets in the project keep GCS's 7-day default on purpose: `gcf-v2-sources-*` and
`gcf-v2-uploads-*` are function build artifacts, and `blueseal-762af.appspot.com` /
`staging.blueseal-762af.appspot.com` are legacy App Engine buckets that hold no user
data. If anything ever starts writing user data to one of those, raise it too.

**Why soft delete and not Object Versioning:** soft delete retains overwritten objects
as well as deleted ones, and expires them automatically, so the bill is bounded.
Versioning keeps every historical version forever unless you pair it with a lifecycle
rule. For a bucket that takes user uploads on every job, bounded is the right default.

---

## Restore

⚠️ A Firestore restore creates a **NEW database**. It does not overwrite `(default)`
in place. That is a feature: it lets you inspect before cutting over, and it means
restoring is never itself destructive.

```powershell
# 1. Find the backup (nam5, not us-central1)
firebase firestore:backups:list --location nam5 --project blueseal-762af

# 2. Restore it into a NEW database id
firebase firestore:databases:restore --backup projects/blueseal-762af/locations/nam5/backups/<BACKUP_ID> --database restore-YYYYMMDD --project blueseal-762af

# 3. Inspect the restored copy BEFORE any cutover.
```

Then choose:

- **Targeted repair (usual case).** Only some docs are wrong. Read the good docs out of
  the restored database with the Admin SDK under ADC and write them back into
  `(default)` with a one-off script in `scripts/`. Dry-run first, dump what you are
  about to overwrite to a local JSON file, then write. This is almost always the right
  answer: it keeps every legitimate write that happened after the incident.
- **Full cutover (rare).** The whole database is unusable. Repoint the app and the
  functions at the restored database id. Every write since the backup is lost, so this
  is a last resort, and see the Stripe warning below before you even consider it.

PITR reads work the same way but with a timestamp instead of a backup id, within the
7-day window. Firestore also supports cloning a database as of a PITR timestamp
(`firebase firestore:databases:clone`), which is the cheapest way to get a "what did
this look like at 14:05" copy without waiting on a nightly snapshot.

### ⚠️ Stripe is live and a restore does not roll it back

This is the blueseal-specific trap. Stripe has been live since 2026-08-19. A Firestore
restore rewinds **our** record of invoices, payments, Connect payouts and Pro
subscriptions. It does not rewind a single thing on Stripe's side. After any restore
touching `invoices`, `payments`, `jobs`, `subscriptions` or the commission collections:

- **Stripe is the system of record for money, not Firestore.** Reconcile our docs
  against the Stripe dashboard, not the other way around.
- A restored-away `paymentIntent` still charged the client's card. A restored-away
  payout still moved money.
- Rewinding a doc that a Stripe webhook already processed can make that webhook's work
  invisible while Stripe considers the event delivered. Re-drive it from the Stripe
  dashboard (Developers → Events → resend) rather than hand-patching Firestore.

If money-path collections are in the blast radius, do targeted repair, never a cutover.

---

## When data looks wrong: triage order

1. **Stop the bleeding.** If a scheduled function is writing bad data, pause it before
   anything else or it will overwrite your repair. `gcloud scheduler jobs pause` will
   not work here (see the gcloud section), so use the Cloud Scheduler REST API under
   ADC. Firebase names v2 scheduler jobs `firebase-schedule-<functionName>-<region>`:

   ```powershell
   $t = gcloud auth application-default print-access-token
   # list them
   Invoke-RestMethod -Headers @{Authorization="Bearer $t"} "https://cloudscheduler.googleapis.com/v1/projects/blueseal-762af/locations/us-central1/jobs" | % jobs | % name
   # pause one
   Invoke-RestMethod -Method Post -Headers @{Authorization="Bearer $t"} "https://cloudscheduler.googleapis.com/v1/projects/blueseal-762af/locations/us-central1/jobs/firebase-schedule-<NAME>-us-central1:pause"
   ```

   The nightly sweeps worth knowing about, in rough order of destructiveness:

   | Function | When | What it touches |
   |---|---|---|
   | `scheduledIdRetention` | 03:00 America/Toronto | **deletes** ID files from Storage and clears `idVerifications/{uid}` for tradespeople approved 90+ days ago |
   | `scheduledRecurringInvoices` | 04:00 | creates real invoices from recurring templates |
   | `scheduledRepCommissionPayouts` | 03:30 on the 1st | moves money via Stripe Connect |
   | `scheduledProCompExpiry`, `scheduledProspectExpiry`, `scheduledJobPostExpiry` | 03:00-03:30 | bulk status flips across their collections |
   | `scheduledGoogleReviewsSync` | 04:00 | overwrites synced review data on tradesperson docs |
   | `scheduledBugIssueSync` | every 6h | writes triage state back from GitHub |

   Stripe webhooks and Firestore triggers are *not* pausable this way. If a trigger is
   the culprit, the lever is redeploying it as a no-op or deleting it.
2. **Establish the blast radius.** How many docs, which collections, since when? Check
   the function's structured logs in Cloud Logging for the run that did it.
3. **Check the cheap sources first.** If a one-off script caused this, its own dry-run
   dump may already hold exactly what you need, and it is far faster than a restore.
4. **Restore + targeted repair** per above.
5. **Write down what happened** here or in the relevant doc, so the next person
   inherits the lesson rather than the surprise.

---

## What is NOT covered

- **Firebase Authentication users.** Not included in a Firestore backup, and still
  uncovered. Losing the auth store means everyone re-registers and their uid-keyed
  data (jobs, quotes, invoices, reviews, Stripe Connect account links) orphans. Export
  with `firebase auth:export users.json --project blueseal-762af`. The file contains
  password hashes and every user's email, so treat it as a secret: keep it out of the
  repo, store it somewhere encrypted, and re-export periodically since it is a
  point-in-time dump, not a schedule. Tracked in [HUMANTASKS.md](../HUMANTASKS.md).
- **Cloud Storage objects older than 30 days.** Soft delete covers deletes and
  overwrites for 30 days only. There is no long-tail media backup. Note this interacts
  with `scheduledIdRetention` by design: deleted ID documents becoming permanently
  unrecoverable after 30 days is the compliance outcome we want, not a gap.
- **Secret Manager values.** Keep the recovery values in a password manager. A deleted
  secret version is not recoverable from Firestore.
- **Stripe-side state.** Covered by Stripe, not by us. See the warning above.

## Related

- [CLAUDE.md](../CLAUDE.md) → Firebase deployment discipline.
- [skills/firebase-deploy.md](../skills/firebase-deploy.md) → deploy failure modes and rollback.
