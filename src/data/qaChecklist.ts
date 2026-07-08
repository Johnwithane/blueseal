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
            expected: "Each job dispatches to your matching saved trades; the project shows Accepted.",
          },
          {
            id: "pm-resend-link",
            title: "Re-copy a shareable invite link for a pending project",
            steps: [
              "Open a pending (Invite sent) project → Resend invite.",
            ],
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
            steps: ["On a scoped posting with no quotes, the client opens it to all trades nearby."],
            expected: "It flips to Open, leaves the invited lists, and enters the public radius feed (geocoded).",
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
            expected: "They drop off the PM's profile and can't be re-featured until they opt back in.",
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
            steps: ["Open a pending (Invite sent / Client joined) project → Edit project → change the label / add a job → Save changes."],
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
            expected: "Each card shows 'Available Mon, Tue, …' from their weekly availability (omitted if none set).",
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
            steps: [
              "New project → in 'Draft the jobs with AI', describe the work → Draft jobs.",
            ],
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
            expected: "A blocking agreement dialog appears; you can't act as a rep until you sign it.",
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
            expected: "Signup preselects tradesperson with the free-month banner; attribution recorded.",
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
              "Enter client name + email, address, and tap Add photo to attach 1-8 images (they compress + preview as thumbnails; × removes one).",
              "Leave 'Quote already agreed — skip straight to the work' OFF for this run. Submit.",
            ],
            expected:
              "A copyable invite link is shown and a branded magic sign-in link is emailed to the client. The job lands in your kanban at 'Quote needed' (client not yet attached) with your attached photos as its intake photos. Flow is free (no Pro). Mobile 375px: single-column form, 3-up photo grid.",
          },
          {
            id: "tradie-invite-job-skip-quote",
            title: "Create a job with 'Quote already agreed' (skip straight to the work)",
            steps: [
              "Open /jobs/new, fill in the job, and turn ON 'Quote already agreed — skip straight to the work'. Submit.",
              "Open the created job and check its status; try the money path (log time / add an expense, then finalize the invoice).",
            ],
            expected:
              "The job opens directly at 'In progress' with NO quote step (billing is fixed, job-line tax 0%). There's nothing to quote or accept; you invoice from logged time + materials, same as a solo job whose acceptance was recorded offline. Leaving the toggle off still enters at 'Quote needed'.",
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
          { id: "tradie-get-paid", title: "Get paid: invoice → card payment → Stripe payout" },
          { id: "tradie-pro", title: "Blue Seal Pro (toggle free vs Pro features)" },
          { id: "tradie-profile", title: "Profile + branding + vanity /u/<slug>" },
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
          { id: "admin-vetting", title: "Vetting queue: approve cert/ID/insurance" },
          { id: "admin-disputes", title: "Disputes handling" },
          { id: "admin-users", title: "User 360 / support" },
          { id: "admin-jobs-browse", title: "Jobs & postings browse (all regions)" },
        ],
      },
    ],
  },
];

export const QA_CHECKLIST_TOTAL = QA_CHECKLIST.reduce(
  (sum, r) => sum + r.groups.reduce((s, g) => s + g.items.length, 0),
  0,
);
