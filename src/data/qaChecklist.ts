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
            id: "pm-client-claim-accept",
            title: "Client claims + accepts the project",
            steps: [
              "Open the invite link (or emailed magic link) as the client → confirm email → claim → on the dashboard, Accept and enter the job address.",
            ],
            expected: "Each job dispatches to your matching saved trades; the project shows Accepted.",
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
              "As the matching (non-Pro) tradesperson, Browse jobs → Invited to quote → submit a full quote.",
            ],
            expected: "The posting is visible only to invited contractors (not the public radius feed).",
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
            title: "Refund reverses both commission entries",
            steps: ["Refund the invoice (Stripe test dashboard or in-app)."],
            expected: "A matching _reversal entry appears for both the rep and PM commissions.",
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
            title: "Review an owned application",
            expected:
              "You can see + act on applications in your territory (docs visible) and the tradie goes live; you can't act outside your territory.",
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
            expected: "/sales/payouts shows earnings; Connect onboarding enables monthly payout ($50 min).",
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
