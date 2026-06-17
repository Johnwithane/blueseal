# Support-ticket triage with Claude Code

The Help Center **contact form** writes docs to `supportTickets/{id}` — name,
email, topic, message, status, plus admin `internalNotes` and a `replies`
subcollection of anything sent back (`SupportTicketDoc` / `SupportReplyDoc` in
`src/firebase/interfaces.ts`). Humans work the queue at `/admin/support` (where
they can also draft an AI reply, send a branded reply, and leave notes). This
doc is the **Claude Code** path: pull the queue, read each ticket, investigate,
and triage. Sibling of [BUG_TRIAGE.md](./BUG_TRIAGE.md).

## Two ways to work a ticket

1. **`/admin/support`** — for a human at the console. Per ticket: "Draft with
   AI" (Vertex), an in-app composer that emails the customer through the branded
   pipeline (Reply-To → the monitored inbox, or no-reply), the history of
   replies sent, a status control, and private internal notes.

2. **`scripts/support-triage.mjs`** (this script) — for when you're in a CC
   session. Pulls tickets from prod Firestore so Claude can read them and triage
   (no screenshots — support tickets have no attachments).

## Prereqs

- ADC: `gcloud auth application-default login` against `blueseal-762af` (already
  set up on Johnny's box). Uses the Firebase Admin SDK over ADC — no emulator,
  **real prod data**.
- `firebase-admin` is resolved from `functions/node_modules`, so `functions/`
  must have had `npm ci`/`npm install`.

## Commands

```bash
npm run support list             # open tickets (default), newest first
npm run support list all         # every status
npm run support list in_progress # open | in_progress | resolved | closed
npm run support show <id>        # one ticket, full detail + replies
# write-back — only after Johnny OKs the triage:
npm run support triage <id> <status> "internal note here"
```

`list`/`show` write a digest to `c:\tmp\support-triage\digest.md` (or
`…\<id>\ticket.md`). The output dir is wiped at the start of each `list` run.

## The triage loop (how Claude should use it)

1. `npm run support list` → read the digest.
2. For each ticket: understand the ask (topic + message), check the relevant
   account/job in the codebase or the User 360 page if needed, and decide the
   resolution + a suggested reply.
3. Produce a write-up: what the customer needs, the suggested status, and a
   draft reply. **Report first** — don't write back or send email yet.
4. Once Johnny OKs:
   - To **send a reply**, do it from `/admin/support` (the `sendSupportTicketReply`
     callable emails the customer + records it). The script does NOT send email.
   - To just **triage** (status + a note), `npm run support triage <id> <status>
     "<note>"` — it stamps `handledBy: "claude-code"`, sets `status`/`updatedAt`,
     and writes the note to `internalNotes`.

The `triage` write-back only touches `status`, `handledBy`, `updatedAt`, and
`internalNotes` — within the field set the `supportTickets` update rule allows.
