// Structured QA test checklist — the trackable companion to docs/QA_HAPPY_PATHS.md.
// The markdown runbook is the deep prose ("how, exactly"); this is the per-role list
// of TESTABLE paths that the toolkit renders with shared pass/fail progress.
//
// UPKEEP: when you ship a feature, add/adjust the relevant item here AND the runbook
// section (same discipline as help/FAQ). Item `id`s are stable — never renumber a
// shipped id (progress is keyed on it); only add.

export interface QaCheckItem {
  /** Stable, unique id (progress is keyed on it). e.g. "pm-money-path". */
  id: string;
  title: string;
  /** Optional step-by-step. */
  steps?: string[];
  /** Optional expected outcome. */
  expected?: string;
}

export interface QaCheckGroup {
  title: string;
  items: QaCheckItem[];
}

export interface QaRoleChecklist {
  role: "client" | "tradesperson" | "projectManager" | "sales" | "admin";
  label: string;
  icon: string; // PrimeIcons name (without the "pi " prefix)
  groups: QaCheckGroup[];
}

export const QA_CHECKLIST: QaRoleChecklist[] = [
  {
    role: "projectManager",
    label: "Project manager",
    icon: "pi-briefcase",
    groups: [
      {
        title: "Setup & navigation",
        items: [
          {
            id: "pm-become",
            title: "Become a project manager (QA toolkit)",
            steps: ["In the QA toolkit, tap Become a project manager."],
            expected: "You land on /manage with the project-manager view.",
          },
          {
            id: "pm-nav",
            title: "PM-specific side nav (not the client nav)",
            expected:
              "Side nav = Dashboard, Properties, Jobs, Trades, Earnings, Public profile (not Jobs/Find/Post).",
          },
          {
            id: "pm-dashboard",
            title: "Dashboard overview",
            expected:
              "Stat tiles (properties / active projects / jobs in progress / unpaid earnings), quick actions, payout nudge, recent projects — each routes to its section.",
          },
          {
            id: "pm-getting-started",
            title: "First-run Get started checklist",
            steps: [
              "As a brand-new PM (no roster, no project), open the dashboard.",
              "Add a tradesperson to your roster, then create a project; re-open the dashboard.",
            ],
            expected:
              "An ordered Get started card shows above the tiles with 3 steps (Add trades / Add a property / First project), trades listed first; each step's button routes to its section and the step ticks off (line-through) as you complete it. The card disappears once you have ≥1 roster trade AND ≥1 project.",
          },
        ],
      },
      {
        title: "Roster",
        items: [
          {
            id: "pm-find-trade",
            title: "Add a tradesperson already on Blue Seal to your roster",
            steps: ["Roster → Already on Blue Seal? → search a name → Add to roster."],
            expected:
              "They appear under On your roster instantly; the result flips to an On-your-roster badge; Request re-hires; x removes.",
          },
          {
            id: "pm-find-unverified-trade",
            title: "Search finds unverified + profile-less tradespeople too",
            steps: [
              "Roster → Already on Blue Seal? → search the name of a tradesperson who isn't verified yet, or who has the tradesperson role but never built a profile.",
              "Add them, then look at the On your roster list.",
            ],
            expected:
              "They show up in the search results with a 'Not verified yet' note (verified-only used to hide them). After adding, they appear on the roster with the same status and NO Request button (you can only send jobs once they're live). Removing with x still works.",
          },
          {
            id: "pm-recruit-link",
            title: "Invite link for a tradesperson not on Blue Seal yet",
            steps: [
              "Roster → Or share your invite link → copy the /join?pm= invite link; tap the QR to view it full-screen.",
            ],
            expected:
              "A tradesperson joining through it lands on your roster + gets a free Pro month.",
          },
          {
            id: "pm-email-invite",
            title: "Email invite a tradesperson by name + email",
            steps: [
              "Roster → New to Blue Seal? Email them an invite → enter a name + fresh email → Send invite.",
              "Complete that signup as a tradesperson with the same email; back on Roster, watch the Invites row.",
            ],
            expected:
              "Pending row appears + a compliant email sends; signing up auto-adds them to your roster (referredByPmId set, free Pro month at go-live) and the row flips to Joined. An email that already has an account is rejected; Cancel revokes a pending invite.",
          },
        ],
      },
      {
        title: "Properties → Projects → Jobs",
        items: [
          {
            id: "pm-property-add",
            title: "Add a property (with a photo)",
            steps: ["Properties → Add property → label + address + attach a photo → Save."],
            expected: "It lists with its photo thumbnail and opens to a detail page.",
          },
          {
            id: "pm-project-create",
            title: "Create a project inside a property (with a photo)",
            steps: [
              "Open a property → New project here → name it, add a client name+email, add a job (trade+title+desc), attach a photo → Create & invite client.",
            ],
            expected:
              "The project is scoped to that property (no picker), shows Invite sent, and an invite link is shown.",
          },
          {
            id: "pm-job-photos",
            title: "Attach multiple photos to a job (same as a client posting)",
            steps: [
              "New project (or Edit project / Add jobs) → on a job, use the Photos picker under the description to attach 2–3 images.",
              "Confirm a remove (✕) works and the add button disappears at 8.",
              "Finish dispatch (client accepts), then open the posting as the invited contractor.",
            ],
            expected:
              "Photos upload + thumbnail inline exactly like the client job-post step. After dispatch the same photos show on the posting the invited contractor sees (carried via the job spec → posting). A job with no photos still dispatches fine.",
          },
          {
            id: "pm-coverage-preview",
            title: "Roster-coverage hint while building a project",
            steps: [
              "In the new-project form, pick a trade you HAVE a saved trade for, then one you DON'T.",
            ],
            expected:
              "The covered trade shows a green 'N of your trades will be invited'; the uncovered one shows an amber 'No saved trade for this — it'll go to the public board'. Adding a matching trade to your roster clears the warning live.",
          },
          {
            id: "pm-client-claim-accept",
            title: "Client claims + accepts the project",
            steps: [
              "Open the invite link (or emailed magic link) as the client → confirm email → claim → on the dashboard, Accept and enter the job address.",
            ],
            expected:
              "Each job dispatches to your matching saved trades; the project shows Accepted.",
          },
          {
            id: "pm-resend-link",
            title: "Re-copy a shareable invite link for a pending project",
            steps: ["Open a pending (Invite sent) project → Resend invite."],
            expected:
              "A fresh 'Shareable sign-in link' appears with a Copy button (works for the SAME client email, not only on an email change); the client is also re-emailed. The newest link is the one that works. (Requires the resendProjectInvite function deploy.)",
          },
        ],
      },
      {
        title: "Dispatch & compare-and-choose",
        items: [
          {
            id: "pm-contractor-quote",
            title: "Invited contractor quotes",
            steps: [
              "As the matching (non-Pro) tradesperson, open the 'You've been invited to quote' notification (bell + email CTA), then submit a full quote.",
              "Also confirm the posting is reachable the manual way: Browse jobs → Invited to quote.",
            ],
            expected:
              "The invite deep-links straight to that posting (/jobs/posted/:id), not the generic Browse list. The posting is visible only to invited contractors (not the public radius feed).",
          },
          {
            id: "pm-client-pick",
            title: "Client compares + accepts a quote",
            steps: ["As the client, open the posting → accept the quote (sign)."],
            expected:
              "A job is created carrying projectId + propertyId + drivenByProjectManagerId (preferred-contractor win).",
          },
          {
            id: "pm-public-fallback",
            title: "Public-board fallback (no bids)",
            steps: [
              "On a scoped posting with no quotes, the client opens it to all trades nearby.",
            ],
            expected:
              "It flips to Open, leaves the invited lists, and enters the public radius feed (geocoded).",
          },
          {
            id: "pm-visibility",
            title: "PM read-only project visibility",
            steps: ["Open the project detail from the cockpit."],
            expected:
              "You see posting status + quote AMOUNTS + the won job's status/schedule. You never see the chat or invoice. Another PM can't open it.",
          },
        ],
      },
      {
        title: "Money (verify on Stripe test)",
        items: [
          {
            id: "pm-money-path",
            title: "Commission accrues on a card-paid PM-driven job",
            steps: [
              "Take a PM-driven job (won by a non-Pro preferred contractor) to a paid invoice.",
              "Pay the invoice with test card 4242 4242 4242 4242.",
            ],
            expected:
              "TWO commission ledger entries on that fee — service_fee_<inv> (rep, if any) and service_fee_<inv>_pm_<pmId> (PM), each 10% of the platform portion. The PM's Earnings balance moves. (Pro contractor = waived fee = no commission.)",
          },
          {
            id: "pm-money-reversal",
            title: "Refund reverses both commission entries (proportionally)",
            steps: [
              "Fully refund the invoice: a _reversal entry appears for both rep and PM at 100%.",
              "On a separate paid job, do a PARTIAL refund (e.g. 30% of the charge).",
            ],
            expected:
              "Full refund reverses 100%. A partial refund reverses that same fraction (round(commission × amount_refunded/amount)) for BOTH the rep and PM; a second, larger partial refund escalates the same _reversal doc upward (never double-counts).",
          },
          {
            id: "pm-money-upfront",
            title: "Upfront fee accrues + reverses rep/PM commission",
            steps: [
              "Take a PM-driven job with an upfront fee; pay the upfront by card (test 4242).",
              "Then refund the upfront (Stripe test dashboard).",
            ],
            expected:
              "Paying the upfront accrues rep + PM commission keyed service_fee_upfront_<jobId> (distinct from the final invoice's entry, each 10% of the upfront's platform portion). Refunding it writes the matching _reversal for both, proportional to the refund.",
          },
          {
            id: "pm-payout-setup",
            title: "Earnings: sign agreement → Stripe Connect",
            steps: ["Earnings → Review & sign the agreement → Start Stripe setup (Express)."],
            expected:
              "Once Stripe reports payouts enabled, the panel reads Payouts are live; the agreement gates payout setup only, never the cockpit.",
          },
        ],
      },
      {
        title: "Public profile & featuring",
        items: [
          {
            id: "pm-profile-publish",
            title: "Publish the public profile",
            steps: [
              "Public profile → edit brand/bio, upload logo+cover, claim a /pm/<handle>, toggle Publish on.",
            ],
            expected:
              "Open /pm/<handle> signed-out: the published profile shows. With Publish off, it's Not found to the public (preview banner for the owner).",
          },
          {
            id: "pm-feature-trade",
            title: "Feature a trade (with notify)",
            steps: ["Public profile → Featured trades → toggle a saved trade on."],
            expected:
              "They appear under Trades I recommend on /pm/<handle> (each card → request a quote), and the contractor gets a notification.",
          },
          {
            id: "pm-feature-optout",
            title: "Contractor opt-out",
            steps: ["As that contractor, open /featured-by-pms → Remove me."],
            expected:
              "They drop off the PM's profile and can't be re-featured until they opt back in.",
          },
          {
            id: "pm-business-card",
            title: "Business card (QR to public profile)",
            steps: [
              "Dashboard → My business card (or Public profile → Business card / /manage/card).",
              "Pick a theme, tweak the scan caption, download the 2-sided PDF + a PNG.",
              "Scan the QR with a phone.",
            ],
            expected:
              "The card shows your name/brand + recommended trades; the QR opens your public profile (/pm/<slug>, or /project-managers/<uid> if no slug). A warning shows if your profile isn't published yet.",
          },
        ],
      },
      {
        title: "PM tools expansion (2026-06)",
        items: [
          {
            id: "pm-welcome-email",
            title: "Welcome email on becoming a PM",
            steps: ["Become a PM (new account, or add the role from /welcome / account)."],
            expected:
              "A 'Welcome to Blue Seal' email + in-app notification arrives once, linking to /manage. Re-adding the role doesn't re-send.",
          },
          {
            id: "pm-restore-archive",
            title: "Restore an archived property",
            steps: ["Properties → archive one → open the Archived (N) section → Restore."],
            expected: "It returns to the active list; nothing was lost.",
          },
          {
            id: "pm-multi-unit",
            title: "Multi-unit property + unit-scoped project",
            steps: [
              "Edit a property → add a couple of units (chips) → Save (card shows 'N units').",
              "New project on that property → a Unit picker appears → pick one → create.",
            ],
            expected:
              "The Unit picker only shows for multi-unit properties; the chosen unit shows on the project detail + the property's project list.",
          },
          {
            id: "pm-edit-project",
            title: "Edit a project before it's accepted",
            steps: [
              "Open a pending (Invite sent / Client joined) project → Edit project → change the label / add a job → Save changes.",
            ],
            expected:
              "The detail updates. Editing is offered only pre-accept; an accepted project has no Edit (server rejects it too).",
          },
          {
            id: "pm-add-jobs-accepted",
            title: "Add jobs to a project the client already accepted",
            steps: [
              "Open an ACCEPTED project → tap Add jobs → add a job (trade+title+desc), optionally Draft jobs with AI → Send to client for approval.",
            ],
            expected:
              "An accepted project shows Add jobs (a pending/declined project does not). The new job appears under 'Awaiting your client's approval' as Pending client with NO posting yet, and the client is notified. It does NOT dispatch to your trades until the client approves it.",
          },
          {
            id: "pm-client-approve-added-job",
            title: "Client approves (and declines) an added job",
            steps: [
              "As the client, open the dashboard → 'Projects set up for you' → approve one added job and decline another (no address is re-asked).",
            ],
            expected:
              "Approving dispatches THAT job to the matching saved trades (a new posting appears on the PM's project detail; the PM is notified). Declining marks it Declined on the PM's detail and notifies the PM. The headline job count excludes declined adds.",
          },
          {
            id: "pm-roster-availability",
            title: "Roster shows contractor availability",
            steps: ["Open Roster with at least one saved trade who has set weekly availability."],
            expected:
              "Each card shows 'Available Mon, Tue, …' from their weekly availability (omitted if none set).",
          },
          {
            id: "pm-pro-checkout",
            title: "A PM can start Blue Seal Pro (shared subscription)",
            steps: ["As a non-Pro PM, hit any Pro tool → the paywall → Start free trial."],
            expected:
              "Stripe Checkout opens (test mode) — the PM subscribes to the SAME Pro plan/trial as tradespeople (no 'add the tradesperson role' bounce).",
          },
          {
            id: "pm-clients-pro",
            title: "Clients CRM (Pro)",
            steps: ["Open /manage/clients."],
            expected:
              "Non-Pro: the Blue Seal Pro gate. Pro: every client gathered from your projects (dedup by client/email), searchable, with active/total counts.",
          },
          {
            id: "pm-calendar-pro",
            title: "Global calendar (Pro)",
            steps: ["Open /manage/calendar."],
            expected:
              "Non-Pro: the Pro gate. Pro: every scheduled job across your projects on the shared read-only calendar (week/month).",
          },
          {
            id: "pm-profile-pro-gate",
            title: "Branded profile + business card behind Pro",
            steps: ["As a non-Pro PM, open Public profile and Business card."],
            expected: "Both show the Blue Seal Pro gate; a Pro PM gets the full editor + card.",
          },
          {
            id: "pm-ai-project",
            title: "AI: draft a project from a prompt (Pro)",
            steps: ["New project → in 'Draft the jobs with AI', describe the work → Draft jobs."],
            expected:
              "Pro: the job rows populate with trade + title + description to review/edit before creating. Non-Pro: the Blue Seal Pro paywall.",
          },
          {
            id: "pm-ai-digest",
            title: "AI: 'Catch me up' digest (Pro)",
            steps: ["Dashboard → Catch me up."],
            expected:
              "Pro: a 2-4 sentence plain-language status across your projects + won jobs (never the chat/invoice). Non-Pro: the paywall.",
          },
        ],
      },
      {
        title: "Mobile",
        items: [
          {
            id: "pm-mobile",
            title: "Mobile (375px)",
            expected:
              "Nav, dashboard, property/project forms (incl. photo + accept address), and the public /pm page read cleanly at 375px.",
          },
        ],
      },
    ],
  },
  {
    role: "sales",
    label: "Sales rep",
    icon: "pi-map-marker",
    groups: [
      {
        title: "Setup",
        items: [
          {
            id: "sales-become",
            title: "Become a sales rep (QA toolkit) + agreement gate",
            steps: ["QA toolkit → Become a sales rep → you land on /sales."],
            expected:
              "A blocking agreement dialog appears; you can't act as a rep until you sign it.",
          },
          {
            id: "sales-code",
            title: "Claim a vanity referral code + link",
            expected: "You can claim a unique code and copy the /join?ref= link.",
          },
        ],
      },
      {
        title: "Referrals & vetting",
        items: [
          {
            id: "sales-referral-signup",
            title: "Referral signup via /join?ref=",
            expected:
              "Signup preselects tradesperson with the free-month banner; attribution recorded.",
          },
          {
            id: "sales-review-application",
            title: "Review an owned application (full vetter tooling)",
            steps: [
              "Open an owned application at /sales/applications/<uid>.",
              "Open each cert / ID / insurance / WSIB document.",
            ],
            expected:
              "You see the SAME trust tooling admin has: insurance + WSIB cards, the verify-on-registry helper on certs, and the inline watermarked viewer (REP VIEW ONLY on ID + release signature) instead of raw new-tab links. You can act only in your territory; approving takes the tradie live. (Admin's queue shows the region + rep + 'Approved by' attribution after you approve.)",
          },
        ],
      },
      {
        title: "Money",
        items: [
          {
            id: "sales-commission",
            title: "Commission accrues (10% on a referred tradie)",
            expected:
              "On a card service fee + a Pro subscription payment for your referred tradie; none on a waived fee / comp month.",
          },
          {
            id: "sales-payouts",
            title: "Earnings + Stripe Connect payout onboarding",
            expected:
              "/sales/payouts shows earnings, an 'Earnings by tradesperson' breakdown (lifetime net per tradesperson, refunds netted), and Connect onboarding enables monthly payout ($50 min).",
          },
        ],
      },
    ],
  },
  {
    role: "client",
    label: "Client",
    icon: "pi-user",
    groups: [
      {
        title: "Core flows",
        items: [
          { id: "client-signup", title: "Sign up as a client" },
          { id: "client-post-job", title: "Post a job to the board → get applicants" },
          { id: "client-direct-request", title: "Direct-request a quote from a tradesperson" },
          { id: "client-accept-quote", title: "Compare + accept a quote (sign)" },
          { id: "client-pay-invoice", title: "Pay an invoice by card (service fee applies)" },
          { id: "client-review", title: "Leave a review" },
        ],
      },
    ],
  },
  {
    role: "tradesperson",
    label: "Tradesperson",
    icon: "pi-wrench",
    groups: [
      {
        title: "Core flows",
        items: [
          { id: "tradie-onboarding", title: "Onboarding + vetting (cert + ID → visible)" },
          { id: "tradie-browse-apply", title: "Browse + apply to a job post with a full quote" },
          {
            id: "tradie-uninsured-waiver-clock",
            title: "Uninsured waiver does not auto-start the clock",
            steps: [
              "As a tradesperson with NO insurance on file, open an In progress job.",
              "Tap the header Sign waiver button and sign the uninsured-work waiver.",
            ],
            expected:
              "Signing records the waiver and closes the dialog but the timer stays stopped. The button becomes Clock in; the clock only starts when you tap it yourself (a deliberate second tap).",
          },
          {
            id: "tradie-clock-dropdown-change-order",
            title: "Clock in from header menu + directly on a change order",
            steps: [
              "On an In progress HOURLY job, tap the header Clock in button: it OPENS A MENU listing every option (Labour, Travel, and any approved hourly change orders), each showing its $/hr rate. There is no silent default — you pick one.",
              "Confirm a job with only one option (fixed-price, no hourly extras) shows a plain Clock in button that clocks directly, with the rate ($/hr, or 'Time only') beside it.",
              "Approve an hourly change order (as the client), then as the tradesperson open Work Order → Change orders and clock in via the Clock in button on that order.",
              "While a session is running, confirm the header shows Stop + the kind and rate, and the per-order Clock in button is hidden until you stop.",
            ],
            expected:
              "One clock-in surface (the header). With 2+ options it opens a menu of all of them at the correct rate (nothing hidden behind a caret); with one option it clocks directly. Approved hourly change orders also expose their own Clock in button. The Work Order Time card has no separate clock-in row.",
          },
          {
            id: "tradie-invite-job",
            title: "Create a job for your own client (invite / solo, with photos)",
            steps: [
              "Open /jobs/new. Confirm the Trade field: with one trade on your profile it's a read-only line (no dropdown); with two-plus it's a dropdown defaulted to your primary, changeable.",
              "Enter client name + phone + email (only the name is required), address, and tap Add photo to attach 1-8 images (they compress + preview as thumbnails; × removes one).",
              "Leave 'Quote already agreed — skip straight to the work' OFF for this run. Submit.",
            ],
            expected:
              "A copyable invite link is shown and a branded magic sign-in link is emailed to the client. The job lands in your kanban at 'New job' (client not yet attached) with your attached photos as its intake photos. Flow is free (no Pro). Mobile 375px: single-column form, 3-up photo grid.",
          },
          {
            id: "tradie-invite-job-skip-quote",
            title: "Create a job with 'Quote already agreed' (skip straight to the work)",
            steps: [
              "Open /jobs/new, fill in the job, and turn ON 'Quote already agreed — skip straight to the work'. Submit.",
              "Open the created job and check its status; try the money path (log time / add an expense, then finalize the invoice).",
            ],
            expected:
              "The job opens directly at 'In progress' with NO quote step (billing is fixed, job-line tax 0%). There's nothing to quote or accept; you invoice from logged time + materials, same as a solo job whose acceptance was recorded offline. Leaving the toggle off still enters at 'New job'.",
          },
          {
            id: "tradie-invite-job-onetap-link",
            title: "Copied invite link opens the job in one tap (new email vs existing account)",
            steps: [
              "On a created invite job, copy the shown invite link. Open it in a signed-out browser (or incognito) as the client.",
              "Tap 'View my job'.",
              "Repeat with an invite whose email ALREADY has a Blue Seal account (use a verify-* address you've signed up before).",
            ],
            expected:
              "For a brand-new client email: one tap signs them straight in (no email typing, no inbox detour) and lands them on /jobs/:id with the job claimed (clientId attaches; the copy link then dies). For an email that already has an account: instead of signing in, it shows 'Check your inbox' and emails that inbox a one-tap magic link (account-takeover guard). Revoked/expired links show a uniform 'invalid, expired, or already used' error. Mobile 375px: single centered button. (Requires the redeemJobInvite function deploy.)",
          },
          {
            id: "tradie-invite-job-quote-invoice-email",
            title: "Unclaimed invite client is emailed the quote + invoice (no account needed)",
            steps: [
              "On an invite/solo job the client has NOT claimed yet, send a quote.",
              "Later, send an invoice on that same unclaimed job.",
              "Check the recipient inbox (use a verify-* address you control).",
            ],
            expected:
              "Each send emails the unclaimed client a branded message with the full itemized breakdown and a one-tap magic-link CTA (Review & approve for the quote, View & pay for the invoice). Clicking signs them in, claims the job (clientId backfills on job/quote/invoice), and lands them on it. Gated like the initial invite (suppression / CASL address / email-link enabled) and honours the invite unsubscribe; if it can't send, offline record-acceptance / mark-paid still works. The whole job is runnable from the emails alone, no signup form.",
          },
          {
            id: "tradie-invite-job-no-email",
            title: "Create a job with NO client email (phone booking → solo job)",
            steps: [
              "Open /jobs/new. Enter only the client's name and phone number, leave the email blank, fill in the job + address, and submit.",
              "Open the created job and read the banner at the top, then the Brief tab.",
              "Tap 'Invite client', enter an email, and send.",
            ],
            expected:
              "The form submits with no 'Enter a valid email address' block. The success dialog says you're running it solo and shows NO invite link. On the job, the banner reads 'Solo job — no client email on file' with an Invite client button, and the Brief tab shows a Client contact card with the phone as a tap-to-call link (tradesperson only). Sending the invite mints the first invite, emails it, and flips the banner to 'Waiting for … to join'.",
          },
          {
            id: "tradie-fill-trade-brief",
            title: "Fill in the trade-specific brief on your own job",
            steps: [
              "Open a job you created (invite or solo) and go to the Brief tab.",
              "Fill in the trade-specific fields and tap Save details. Re-open the job.",
              "For contrast, open a marketplace job you won and check the same section.",
            ],
            expected:
              "On your own direct/invite job the fields are EDITABLE (not greyed out) with a Save details button; saving persists the answers and does NOT change the job's status. On a marketplace job (sourcePostId set), and on a closed job (complete / reviewed / cancelled), the fields stay read-only.",
          },
          {
            id: "tradie-quote-style-chooser",
            title: "Prepare quote starts with how-to-quote (time & materials vs itemized)",
            steps: [
              "On a Requested direct job, tap Prepare quote.",
              "Choose Time & materials, set the hours, then tap '← Change how you're quoting' and pick Itemized quote.",
              "On wizard step 1 tap Back. Then check the Scope of work section's layout.",
              "Separately, open Prepare quote on an already-quoted job (resend).",
            ],
            expected:
              "A fresh quote opens on three cards (Time & materials / Itemized quote / Site visit first) with only Cancel in the footer. Time & materials pre-seeds an Hourly line at your profile rate plus a Materials line, and hides discount/upfront/validity/terms behind 'Show every option'. Switching approaches keeps everything you've typed. Back on step 1 returns to the cards, not a dead end. In Scope of work the +Hourly/+Flat rate/+Materials buttons sit ABOVE an 'On this quote (N)' block that holds the rows. A resend skips the chooser and opens the full form. Mobile 375px: cards are full-width, 64px+ tall.",
          },
          {
            id: "tradie-calendar-day-detail",
            title: "Calendar opens on Month; tapping a day shows its hours + jobs",
            steps: [
              "Open /dashboard/tradie?view=calendar with at least one scheduled job.",
              "Tap a day cell that has a job on it.",
              "Tap a job block in the sheet. Re-open the sheet on a future free day and use Block day, then re-open that day.",
              "Also check a multi-day job (scheduledStart Mon, scheduledEnd Wed), and view a tradesperson's public profile calendar as a client.",
            ],
            expected:
              "The calendar opens on Month (Month listed first in the toggle). Cells show job chips prefixed with the start time. Tapping a day opens a sheet with the day's working hours and an hour rail with each job drawn against the hours it occupies; tapping a job opens it. A bare tap no longer blocks the day — Block day lives in the sheet footer, and a blocked day shows an Unblock bar. A multi-day job appears on every day it spans. Read-only viewers get the sheet but NO block/unblock controls. 375px: no horizontal scroll.",
          },
          {
            id: "tradie-calendar-12h",
            title: "Calendar reads in 12-hour am/pm (issue #17)",
            steps: [
              "Open /dashboard/tradie?view=calendar and sweep Month, Week and the day sheet.",
              "Open a day sheet and read the working-hours line, the hour gutter and each job block.",
              "Tap Add time to a job — check the prefilled Start/End.",
              "Type each of 5pm, 5 PM, 5:00 p.m. and 17:00 into Start and save.",
              "Profile → working hours: read the caption under each availability row.",
              "Job → Schedule tab, and the work order's manual time entry dialog.",
            ],
            expected:
              "No 24-hour time is left anywhere on the calendar — gutter reads 7 a.m. / 12 p.m. / 1 p.m., blocks read 9:00 a.m. – 11:30 a.m., working hours reads 8:00 a.m.–5:00 p.m. All four typed forms book 5:00 p.m.; junk gives \"Enter times like 9:00 am\". Availability fields still take 24-hour HH:MM but show a 12-hour read-back. Both date-time pickers are am/pm. Stored times are unchanged across a reload. At 375px nothing clips or scrolls sideways — including an availability row.",
          },
          {
            id: "tradie-calendar-add-time",
            title: "Book time against an existing job from the calendar",
            steps: [
              "Dashboard → Calendar → tap a day → Add time to a job.",
              "Pick a live job, set 09:00–12:00, add a note, then Add to calendar.",
              "Open that job → Schedule tab, and check the job's work order total.",
              "Add a second visit that overlaps an existing booking. Then try End before Start, a junk time (99:99), and saving with no job picked.",
              "Book two short visits on the SAME job on different days.",
              "Check a public profile calendar and /manage/calendar as a read-only viewer.",
            ],
            expected:
              "The picker lists every LIVE job (accepted / requested / quoted / awaiting upfront / in progress / on hold) with its status + client, and start/end default to that day's working hours; finished + cancelled jobs are absent. Saving puts the visit on the calendar at its real hours and it also shows on the job's Schedule tab. It is SCHEDULING, not timesheeting — the work order time total and the invoice do not change. An overlap still saves but warns and names the clash. Bad input is caught inline (end-before-start, HH:MM, no job). Two visits on one job draw as two separate blocks, not one long bar. Read-only calendars show no Add time button. Mobile 375px: dialog fits.",
          },
          {
            id: "tradie-jobs-action-menu",
            title: "Jobs list: per-job action menu (issue #21)",
            steps: [
              "Open /dashboard/tradie (Jobs) and tap the status chip on a Requested job.",
              "Repeat on an In progress job, an Awaiting payment job, and a Complete job.",
              "Tap Complete job on an in-progress job and follow it through.",
              "Tap Cancel job on a Requested job; submit with an empty reason, then with one.",
              "Tap a card body (not the chip) and confirm it opens the job.",
            ],
            expected:
              "The chip keeps its status text and gains a chevron. Requested/Accepted/Quoted offer Quote + Cancel job; In progress offers Complete job and neither Quote nor Cancel; Awaiting-* offer navigation only; terminal jobs offer Open job only. Complete job confirms, then opens the job with the wrap-up sheet already up (and doesn't re-open on reload). Cancel job requires a reason, warns it can't be undone, and notifies the client. At 375px the popup fits with no horizontal scroll and the chip is a 44px target.",
          },
          {
            id: "tradie-quote-optional-tab",
            title: "Quoting is a tab, not a requirement (issues #19 + #22)",
            steps: [
              "Open a Requested direct job as the tradesperson.",
              "Check the bottom of the page and the top-right corner before tapping anything.",
              "Open the Quote tab and read the header.",
              "Tap Skip the quote — invoice directly, then New invoice, and send it.",
              "Open the same job as the client.",
              "Check a job in Awaiting payment still has its sticky Mark as paid bar.",
            ],
            expected:
              "No sticky \"Prepare quote\" bar and no \"Quote needed\" chip. Tabs read Brief · Schedule · Quote · Work order · Invoice, with a badge dot on Quote; the client sees no Quote tab. The tab header says quoting is optional. Skip lands on the Invoice tab and a blank invoice sends with no quote and no tracked time. The money CTAs (upfront received / mark as paid) are untouched. Five tabs fit 375px icon-only with no horizontal scroll.",
          },
          {
            id: "tradie-manual-invoice",
            title: "Write an invoice by hand (no quote, no logged hours)",
            steps: [
              "On a job with no quote and no tracked time (still Requested, or a solo job), open the Invoice tab and tap New invoice.",
              "Add two priced lines with tax, apply a discount, Save, then re-open the tab.",
              "As the CLIENT on that same job, open the Invoice tab and check the dashboard/email.",
              "Back as the tradesperson, tap New invoice again (and double-tap it).",
              "Send the invoice, then reload as the client.",
              "On a separate in-progress job: hand-write two lines, Save, then open the wrap-up sheet (Create invoice → Finished the work?) and send for approval.",
            ],
            expected:
              "New invoice mints a draft with the next number in your sequence and a $0 starter line, editable immediately, with NO job status change. Lines, tax and discount persist across a reload. The CLIENT sees nothing while it's a draft — the tab still reads 'No invoice yet', with no notification or email; a draft is the tradesperson's private copy. Tapping New invoice again returns the SAME draft and burns no second invoice number. Once sent, the client sees and can pay it AND the job moves to Awaiting payment with a 'sent invoice INV-… — $X due' chat line, so Mark as paid is reachable (it used to stay In progress with no way to close the job out). Crucially, the wrap-up sheet pre-loads the hand-written lines as Extras & charges rows (and carries the invoice's discount), so submitting for approval bills each line exactly once instead of silently wiping them. Mobile 375px: the create card + line-item table are reachable.",
          },
          {
            id: "tradie-self-complete-job",
            title: "Close a job out without the client (skip the approval round-trip)",
            steps: [
              "On an in-progress job WITH a claimed client, open the wrap-up sheet (Create invoice → Finished the work?) and reach the wrap-up step.",
              "Tick 'Finish without client approval' and watch the submit button, then submit.",
              "Check the job status, the invoice status and the job chat.",
              "As the CLIENT on that job, check for a notification and whether the invoice is payable.",
              "Back as the tradesperson, tap Mark as paid.",
              "Repeat on another job with the box left UNTICKED (the control), and open the sheet once on a solo job with no client.",
            ],
            expected:
              "The tick-box sits under the note field and is OFF by default, with the button reading 'Send for approval — $X'; ticking it flips the button to 'Finalize invoice — $X'. Submitting sends the job STRAIGHT to Awaiting payment (not Awaiting client approval), leaves the invoice 'sent' (not draft), and shows the Mark as paid card. The chat has ONE line ('… finalized the invoice'), not a duplicate 'Status changed to Awaiting payment'. The client is STILL notified and can still view + pay — they just get no approve / request-changes banner. Mark as paid then closes the loop (invoice paid, job Complete, review prompt) with zero client action. The control job is unchanged: awaiting_client_approval + draft invoice + approve banner. On a solo job the tick-box is absent entirely and the button already reads Finalize invoice. Mobile 375px: tick-box, explainer and button fit.",
          },
          {
            id: "tradie-solo-prework-complete",
            title: "Complete a solo job that never started in the app (issue #28)",
            steps: [
              "As a tradesperson with NO Stripe payouts set up, take a solo job (invited client who hasn't joined, or no client at all) still at Requested or Quoted.",
              "On the jobs list, open the status chip menu and look for Complete job; open the job's Invoice tab and look for the 'Finished the work?' wrap-up card.",
              "Hand-write a draft invoice (New invoice), add a line, Save, and check for a payouts blocker above Send.",
              "Send the invoice, then Mark as paid.",
              "The control: open a job WITH a claimed client at the same pre-work status and re-check the menu and the Send button.",
            ],
            expected:
              "The solo job offers Complete job in the status menu AND shows the wrap-up card on the Invoice tab despite never being In progress; either path finalizes the invoice ('sent') and moves the job straight to Awaiting payment. No 'Set up Stripe payouts' blocker appears on the solo job and Send is enabled without any Connect onboarding; sending advances the job the same way, and Mark as paid closes it out (invoice paid, job Complete). The hand-written lines survive whichever path is used. The clientful control job offers NO Complete job at a pre-work status and still shows the payouts blocker with Send disabled. Mobile 375px: menu + wrap-up card reachable.",
          },
          {
            id: "tradie-solo-status-menu",
            title: "Move a solo job by hand: Start work / Put on hold / Resume (issue #29)",
            steps: [
              "On a solo job at New job (requested), open the jobs-list status chip menu.",
              "Tap Start work, then re-open the menu and tap Put on hold, then Resume.",
              "Hold a job from Quote sent (quoted) and resume it.",
              "The control: open the menu on a job WITH a claimed client at the same statuses.",
            ],
            expected:
              "Start work and Put on hold show on the solo job; each action repaints the row live with a toast and posts ONE chat line (no duplicate generic status line). Resume restores the exact pre-hold status (a hold from quoted resumes to quoted, not in_progress). The clientful control shows neither Start work nor Put on hold (Resume still shows on a clientful hold). Mobile 375px: menu usable, rows repaint in place.",
          },
          {
            id: "tradie-review-link",
            title: "Send a review link after finishing a solo job",
            steps: [
              "Complete a solo job that has an unclaimed invite (client email on file).",
              "On the job, find the invite banner and tap Copy review link; open it in incognito as the client.",
              "Submit the review as the client.",
              "Back as the tradesperson, try Email review invite on another finished solo job.",
              "The firewall control: check a completed job with offline-recorded quote acceptance.",
            ],
            expected:
              "The banner reads 'Job's done. Ask ... for a review' with Copy review link + Email review invite. The link signs the client in with one tap, claims the job, and auto-opens the review dialog; the review saves and follows the mutual-blind reveal. The email variant asks for a review ('How did ... do?'), not 'follow your job'. On an offline-accepted job the banner shows NO review ask and rules still block the review. A no-invite solo job offers 'Invite for a review' instead. Mobile 375px: banner buttons wrap cleanly.",
          },
          {
            id: "tradie-invoice-pdf-size",
            title: "Invoice / quote PDF downloads small and keeps its transparency",
            steps: [
              "On a job with an invoice, tap View PDF (desktop) or Download PDF (mobile) and save the file.",
              "Check the file size on disk, then open it and zoom to 200%.",
              "Repeat on a quote PDF, and on a Pro account with a custom logo, brand colour and letterhead banner set.",
            ],
            expected:
              "The file is well under 1 MB (a one-page invoice lands in the low hundreds of KB) — tens of MB is the bug this guards: the Blue Seal lockup is a 6250x1718 RGBA PNG and jsPDF was embedding it raw and uncompressed. The navy band shows the lockup crisply with NO black box behind it (transparency survived the re-encode), and text stays sharp at 200%. A photo-heavy Pro banner does not blow the size up. Mobile 375px: the download opens in the OS viewer.",
          },
          {
            id: "tradie-get-paid",
            title: "Get paid: invoice → card payment → Stripe payout",
            expected:
              "The invoice flips to paid on the webhook and the tradesperson nets the full invoice total (the client covered the service fee on top). In Stripe, the charge's statement descriptor reads BLUESEAL* <business name> (not a bare BLUESEAL), and the connected account's payout schedule reads a 7-day rolling delay set at account creation that the tradesperson cannot shorten from their Express dashboard.",
          },
          {
            id: "tradie-payout-setup-recovers",
            title: "Payout setup recovers from an orphaned Stripe account id",
            steps: [
              "Account → Payouts → Start Stripe setup. You should reach Stripe's hosted form.",
              "In Firestore, set tradespeople/{uid}.payouts.stripeAccountId to a made-up acct_xxx (leave the rest of the block alone), reload, and click Start Stripe setup again.",
              "Check the tradesperson doc after a fresh account is created.",
              "Repeat on the PM panel (/manage → Earnings) and the rep panel (/sales/payouts).",
            ],
            expected:
              "You are never dead-ended. The server notices the stored id does not resolve against the live Stripe key, discards it, creates a fresh account, and you land on Stripe's form. Any error toast reads a real sentence (\"Your payout account couldn't be found at Stripe…\"), NEVER a bare INTERNAL, and a second click gets through; the Cloud Functions log carries Stripe's own code + requestId. A freshly created tradesperson account records payouts.payoutHoldDays: 7 — null means the 7-day chargeback hold did not apply (onboarding still continues by design, but it is logged at error level and needs fixing in Stripe). PM + rep accounts are undelayed by design and always read null. Mobile 375px: panel + toast fit without scroll.",
          },
          {
            id: "tradie-refund-invoice",
            title: "Refund a card payment (full and partial)",
            steps: [
              "As the tradesperson on a card-PAID job, open the Invoice tab. A \"Refund this payment\" card is there.",
              "Refund part of it — try an amount ABOVE your share of the payment first (the invoice total, not what the client paid), then a valid smaller amount.",
              "Wait for the charge.refunded webhook, then check the invoice doc and the Stripe dashboard.",
              "On a second paid job, refund in full.",
              "Check Stripe's balance for BOTH: the connected account and the platform.",
            ],
            expected:
              "Over-share partial is refused with a sentence naming the limit, not a bare error. A valid PARTIAL comes entirely out of the tradesperson's balance — Blue Seal's application fee is untouched and the platform is not out of pocket (this is why the partial path reverses the transfer explicitly instead of using Stripe's proportional reverse_transfer). A FULL refund returns the service fee to the client too, and unwinds the transfer proportionally. Invoice flips to partially_refunded / refunded via the webhook (never written by the callable), and any rep/PM commission reverses in the same proportion. Mobile 375px: the dialog fits and the amount field is usable.",
          },
          {
            id: "tradie-card-payment-ceiling",
            title: "Card-payment ceiling (new vs established tradesperson)",
            steps: [
              "As a tradesperson with fewer than 3 paid jobs (or approved under 30 days ago), send an invoice over $2,500 and have the client try to pay by card.",
              "Repeat with an established tradesperson at over $10,000.",
              "Then pay each of those jobs offline (e-transfer) and confirm the flow completes.",
            ],
            expected:
              "Card payment is refused with a sentence that names the limit AND points at the fee-free e-transfer path — never a dead end, and never a bare INTERNAL. The offline path completes normally and the job closes out. An established tradesperson under $10,000 is unaffected.",
          },
          {
            id: "tradie-card-payments-paused",
            title: "Admin can pause a tradesperson's card payments",
            steps: [
              "As admin: user detail → Trades, Blue Seal Pro & payments → Pause card payments (add a reason).",
              "As a client on that tradesperson's job, try to pay an invoice by card.",
              "Confirm the tradesperson can still use the rest of the app (edit profile, chat, get marked paid offline).",
              "As the tradesperson, try to clear tradespeople/{uid}.payments from the client (browser console / rules test).",
              "Resume from the same admin panel.",
            ],
            expected:
              "Card payment is refused with a neutral message — the client never sees the internal reason. Everything else about the account keeps working, including offline payment: this is a payments control, not an account suspension. The tradesperson CANNOT clear the pause themselves (payments is server-only in rules). Resuming restores card payment immediately.",
          },
          { id: "tradie-pro", title: "Blue Seal Pro (toggle free vs Pro features)" },
          { id: "tradie-profile", title: "Profile + branding + vanity /u/<slug>" },
          {
            id: "tradie-vanity-url-resolves",
            title: "My page → /u/<handle> actually renders (not 'Profile not found')",
            steps: [
              "As a Pro tradesperson with a claimed handle, tap My page (side panel) or open /tradies/<your-uid>.",
              "Repeat signed-out in a private window with the same /tradies/<uid> URL.",
              "From another tradesperson's profile, tap a recommendation (vouch) chip that links to a different profile.",
            ],
            expected:
              "The URL swaps to /u/<handle> and the profile renders in full. It must never show 'Profile not found'. Navigating profile-to-profile loads the NEW person's profile rather than leaving the previous one on screen. (Both routes render the same component, so the page has to re-resolve on route change, not only on mount.)",
          },
        ],
      },
    ],
  },
  {
    role: "admin",
    label: "Admin",
    icon: "pi-shield",
    groups: [
      {
        title: "Console",
        items: [
          {
            id: "admin-avatar-menu-narrow",
            title: "Avatar dropdown fits 375px / 402px on a multi-role account",
            steps: [
              "Sign in as an account holding several roles (admin + tradesperson + sales + PM).",
              "At 375px and again at 402px, open the avatar dropdown in the header.",
              "Read every item end to end, including each \"Switch to ... view\".",
              "Repeat with the browser font size increased.",
            ],
            expected:
              "The popup stays inside the viewport with a gutter on both sides — never edge-to-edge. Long labels wrap to a second line with the icon aligned to the first; nothing is truncated or pushed off-screen, and the page never scrolls sideways (body is overflow-x: clip, so an over-wide popup would be clipped silently).",
          },
          { id: "admin-vetting", title: "Vetting queue: approve cert/ID/insurance" },
          { id: "admin-disputes", title: "Disputes handling" },
          {
            id: "admin-dispute-recovery-evidence",
            title: "Dispute holds back the payout and drafts evidence",
            steps: [
              "Trigger a dispute on a card-paid job — pay with Stripe's disputed test card 4000 0000 0000 0259, which charges normally then opens a fraudulent dispute.",
              "Open /admin/disputes/{id} and read the Funds panel.",
              "In Stripe, check the connected account's balance and the dispute's evidence tab.",
              "Use Rebuild draft, then Submit evidence (confirm the warning appears first).",
              "Close the dispute as WON in Stripe and re-check the Funds panel and the connected account.",
            ],
            expected:
              "On open: the tradesperson's transfer is reversed for the disputed amount (capped at what they actually received, since the client also paid the service fee), the Funds panel says how much was held back, and Stripe's evidence tab already holds a DRAFT built from the job — signed quote acceptance, chat transcript, timeline, invoice lines. It is NOT auto-submitted. Submit is behind a confirm that says it's one-shot. The tradesperson's notification says action IS needed (not the old \"no action needed\") and that the payout is held. On WON: the held amount is transferred back and the panel flips to restored. If the reversal FAILED (tradesperson already paid out), the panel says so in red and frames it as a debt to recover — never a silent Blue Seal loss.",
          },
          { id: "admin-users", title: "User 360 / support" },
          { id: "admin-jobs-browse", title: "Jobs & postings browse (all regions)" },
          {
            id: "admin-bug-fix-digest",
            title: "Batched \"your bug report is fixed\" notice",
            steps: [
              "File two bugs from the floating Report a bug button.",
              "In /admin/bug-reports flip both to Fixed, and a third report to Wontfix.",
              "Run scheduledBugFixNotices (Cloud Scheduler console, or wait for 09:00 America/Vancouver).",
              "Run the sweep a second time without changing anything.",
              "Flip a fourth report to Fixed and run the sweep again.",
            ],
            expected:
              "One notification + email naming both fixed titles and linking to /admin/bug-reports; the wontfix report is never mentioned. The second sweep sends nothing (fixNotifiedAt is stamped). The third sweep names only the newly-fixed report. Bell row wraps cleanly at 375px.",
          },
        ],
      },
    ],
  },
];

export const QA_CHECKLIST_TOTAL = QA_CHECKLIST.reduce(
  (sum, r) => sum + r.groups.reduce((s, g) => s + g.items.length, 0),
  0,
);
