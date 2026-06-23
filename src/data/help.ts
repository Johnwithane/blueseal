import type { FaqItem, HelpArticle, HelpCategory } from "@/firebase/interfaces";

// ---------------------------------------------------------------------------
// Help Center content — THE single source of truth.
//
// Everything the Help Center, FAQ page, and homepage FAQ teaser render comes
// from here. There's no CMS and no Firestore doc: editing help content is a
// deliberate code change so it goes through review. useHelpContent() reads
// this synchronously, so the Help Center is instant and works offline.
//
// UPKEEP (see CLAUDE.md → "Help Center & FAQ upkeep"): when you ship a change
// users can see or do differently, update the relevant FAQ/article in the same
// commit. Article bodies and FAQ answers are Markdown (rendered with `marked`).
// Keep claims factual — don't promise SLAs, fee figures, or guarantees that
// aren't live (e.g. the fee model in MONETIZATION.md is still proposed; keep
// help copy qualitative until it ships). The integrity test in
// src/utils/helpSearch.test.ts validates this set (unique slugs, real category
// refs) — `npm run test:run` fails if it's malformed.
// ---------------------------------------------------------------------------

export interface HelpContentSeed {
  categories: HelpCategory[];
  articles: HelpArticle[];
  faqs: FaqItem[];
}

const categories: HelpCategory[] = [
  {
    id: "getting-started",
    title: "Getting started",
    description: "Create an account, find your way around, and understand how Blue Seal works.",
    icon: "pi pi-compass",
  },
  {
    id: "for-clients",
    title: "Hiring a tradesperson",
    description: "Search, request quotes, post a job, and manage work from request to review.",
    icon: "pi pi-search",
  },
  {
    id: "for-tradespeople",
    title: "Working as a tradesperson",
    description: "Get verified, win work, quote, schedule, and invoice, all in one place.",
    icon: "pi pi-wrench",
  },
  {
    id: "verification-trust",
    title: "Verification & trust",
    description: "How we verify pros: government ID, trade certification, insurance, and WSIB.",
    icon: "pi pi-verified",
  },
  {
    id: "payments-invoices",
    title: "Quotes, invoices & payments",
    description: "Quotes, auto-invoicing on completion, paying in-app, and receipts.",
    icon: "pi pi-credit-card",
  },
  {
    id: "account-app",
    title: "Account & app",
    description: "Profile, notifications, installing the app, and managing your account.",
    icon: "pi pi-cog",
  },
  {
    id: "safety-disputes",
    title: "Safety & disputes",
    description: "Staying safe, reporting a problem, and how disputes are handled.",
    icon: "pi pi-shield",
  },
];

const articles: HelpArticle[] = [
  {
    slug: "what-is-blue-seal",
    categoryId: "getting-started",
    title: "What is Blue Seal?",
    excerpt: "A verified-trades platform that keeps every job in one trusted thread.",
    audience: "all",
    popular: true,
    keywords: ["about", "overview", "how it works", "platform", "verified trades"],
    body: `Blue Seal connects homeowners with **verified Canadian tradespeople** and keeps the whole job in one place.

Every tradesperson on Blue Seal is manually reviewed before they can take work. We check **government ID**, **trade certification**, **insurance**, and **WSIB / workers' comp** where it applies. Look for the verification badges on a profile.

Once you connect with a pro, the job lives in a single thread:

- **Chat** with photos, scoped to that one job, so nothing's scattered across texts and email.
- A **status board** that moves from requested → quoted → in progress → done.
- **Quotes and invoices** built right in, with receipts you can both refer back to.
- **Mutual reviews** at the end, so both sides build a reputation.

There's nothing to pay to browse or to hire. You create an account, find a pro, and go.`,
  },
  {
    slug: "create-an-account",
    categoryId: "getting-started",
    title: "Creating your account",
    excerpt: "Sign up as a client or a tradesperson, and how roles work.",
    audience: "all",
    popular: true,
    keywords: ["sign up", "register", "join", "role", "client", "tradesperson"],
    body: `Tap **Sign up** and choose how you'll use Blue Seal:

- **Client:** you're hiring. You can search pros, request quotes, and post jobs right away.
- **Tradesperson:** you're offering services. You'll go through verification before your profile goes live and you can take work. You can also hire, since the client role is included automatically, so you can post jobs and request quotes too.

Both roles live on one login. If you signed up as a client and later want to work as a tradesperson, apply for the tradesperson role from your account (it goes through the same cert + ID verification). Switch between your roles any time from the account menu; your data stays on one account.

Forgot your password? Use **Forgot password** on the sign-in screen to get a reset link by email.`,
  },
  {
    slug: "switching-roles",
    categoryId: "account-app",
    title: "Switching between client and tradesperson",
    excerpt: "Hold both roles on one account and switch views in a tap.",
    audience: "all",
    keywords: ["switch role", "two roles", "client and tradesperson", "view"],
    body: `Tradespeople can hire too. Every tradesperson account includes the client role automatically, so you can switch which one you're using at any time from the **account menu** (your avatar). (Signed up as a client and want to offer services? Apply to become a verified tradesperson from your account.)

Switching changes what you see. The client view shows hiring tools (search, post a job, your requests), and the tradesperson view shows work tools (browse jobs, your applications, payouts). Notifications and jobs stay tied to the right role.

If you open a link that belongs to the other role, Blue Seal switches you to it automatically so the page makes sense.`,
  },
  {
    slug: "find-a-tradesperson",
    categoryId: "for-clients",
    title: "Finding and shortlisting a tradesperson",
    excerpt: "Search by trade and location, then compare verified profiles.",
    audience: "client",
    popular: true,
    keywords: ["search", "find pro", "filter", "distance", "rating", "shortlist", "which trade", "describe"],
    body: `Use **Find a tradesperson** to search by location and trade. Results show pros near you with their verification badges, rating, and distance.

**Not sure which trade you need?** Just describe the job in the **"What do you need done?"** box: type something like *"my sink is leaking"* or *"power keeps tripping"* and we'll suggest the right trade. Tap a suggestion and it sets the filter for you.

A few tips:

- Filter by **trade** to narrow to the right specialty, and set your **location** so you only see pros who cover your area.
- Open a profile to see their verification status, portfolio, reviews, and recommendations before you reach out.
- When you find someone you like, **request a quote**. That opens a job thread with them so everything stays in one place.

Not sure who's the right fit, or want pros to come to you? **Post a job** instead (see "Posting a job and getting quotes").`,
  },
  {
    slug: "request-a-quote",
    categoryId: "for-clients",
    title: "Requesting a quote",
    excerpt: "Send job details and photos, and get a clear quote back.",
    audience: "client",
    keywords: ["quote", "estimate", "request", "photos", "details"],
    body: `From a tradesperson's profile, tap **Request a quote**. You'll answer a few trade-specific questions and can attach **photos** so the pro understands the job before quoting.

If you described your job in search first, the title, details and urgency come **pre-filled** from what you typed, so just review and tweak before sending.

That creates a **job thread** between you and the tradesperson. From there you can chat, share more photos, and receive a quote. When the quote looks right, you accept it and the job moves forward: schedule, work, invoice, and review all happen in the same thread.

Quotes can include an optional upfront amount for materials or to hold a booking; you'll always see exactly what you're agreeing to before you accept.

Some jobs are hard to price without seeing them. A tradesperson may ask to do a **site visit first**, either free or with a small visit fee you agree to with **one tap** (no signature). After the visit, they send your full quote.`,
  },
  {
    slug: "post-a-job",
    categoryId: "for-clients",
    title: "Posting a job and getting quotes",
    excerpt: "Describe the work once and let verified pros come to you.",
    audience: "client",
    popular: true,
    keywords: ["post a job", "job board", "bids", "applications", "marketplace"],
    body: `Prefer to have pros reach out to you? **Post a job**. Describe the work, set a budget range, and add your area and photos.

**Not sure which trade you need?** Start in the **"What do you need done?"** box at the top: describe the job in plain words, or just name the room (e.g. *"bathroom"* or *"kitchen"*). We'll suggest the trades that usually handle it; tap one and we set the trade and pre-fill your title, description and urgency. Everything stays editable, so just review and tweak before posting.

When you pick a trade, we'll ask a few **trade-specific questions** (for tiling, say, the area, square footage, tile type, and whether materials are on-site). Answering them up front means tradespeople can quote accurately the first time, with fewer back-and-forth messages and fewer surprises once work starts. Your answers appear on the posting and carry through to the job.

Your posting is shown to **verified tradespeople** in your trade and region. Each one applies with a **full itemized quote** (line items, taxes, and any upfront fee) so you're comparing real numbers, not vague estimates. On your post you can open each applicant's quote, check their profile, verification, and reviews, then **Accept** the one you want, signing off with a quick finger signature to confirm. Accepting starts the job with that pro straight away and lets the others know you've chosen someone.

Applicants on **Blue Seal Pro** are marked **Featured** and listed first. That's a paid placement affecting the order only. It never changes a tradesperson's verification, ratings, or reviews, and you always compare the actual quotes side by side.

Some applicants may ask to do a **site visit first** instead of quoting blind, shown as "Site visit first" with the visit fee (or "Free site visit"). Agreeing is one tap (no signature); that pro then visits and sends a full quote you accept the usual way.

Others may want to **chat first**, shown as "Wants to chat first". They have questions before pricing the job; tap **Message** on their card to talk it through, and they'll send a full quote when they have what they need. If you accept someone you've been chatting with, the conversation **carries over into the job chat**.

Your exact address stays private until you accept a quote; the public posting only shows your general area.`,
  },
  {
    slug: "rebates-and-grants",
    categoryId: "for-clients",
    title: "Rebates and grants on energy work",
    excerpt: "Posting energy work? We surface programs that may help, but always confirm at the source.",
    audience: "client",
    keywords: [
      "rebate",
      "rebates",
      "grant",
      "grants",
      "incentive",
      "heat pump",
      "solar",
      "insulation",
      "windows",
      "energy",
    ],
    body: `When you post a job for energy-related work, like a **heat pump, solar panels, insulation, or new windows**, Blue Seal may show a **"Rebates & grants you may qualify for"** panel as you fill out the form.

These are government and utility programs that *might* help offset the cost of that kind of work in your province. The panel is **informational only**:

- We **don't run these programs and can't confirm whether you qualify**. Eligibility, amounts, and deadlines are set by each program and change often.
- Each listing shows roughly what it offers, the key eligibility conditions, and when we last checked it, then links you to the **official program page**.
- **Always confirm the current details and apply through that official link.** Many programs require steps like a pre-retrofit energy assessment, specific certified equipment, or a registered contractor *before* work begins, so it's worth checking early.

If you don't see a panel, it just means we don't have an active program on file matching that trade and province. It doesn't mean none exists, so it's always worth a quick look at your provincial and utility websites.`,
  },
  {
    slug: "the-job-thread",
    categoryId: "getting-started",
    title: "Understanding the job thread",
    excerpt: "Chat, photos, status board, quotes and invoices, all in one place.",
    audience: "all",
    popular: true,
    keywords: ["job thread", "chat", "kanban", "status", "messages", "board"],
    body: `Every job on Blue Seal has its own thread, so nothing gets lost between texts, email, and paper.

Inside a job you'll find:

- **Chat:** message the other party, share photos, and keep a record of what was agreed.
- A **status board:** the job moves through clear stages (requested, quoted, in progress, awaiting approval, complete) so everyone knows where things stand.
- **Quote & invoice:** the numbers live right in the thread, with receipts afterward.
- **Reviews:** when the work is done, both sides can leave a review.

Because it's all scoped to one job, you can come back months later and see exactly what happened.`,
  },
  {
    slug: "get-verified",
    categoryId: "for-tradespeople",
    title: "Getting verified as a tradesperson",
    excerpt: "What we check, how to submit documents, and going live.",
    audience: "tradesperson",
    popular: true,
    keywords: ["verification", "apply", "onboarding", "id", "certificate", "insurance", "wsib", "vetting"],
    body: `To take work on Blue Seal, your profile is **manually reviewed by our team**. The onboarding wizard walks you through it. We look at:

- **Government photo ID:** confirms you are who you say you are.
- **Trade certification:** your ticket / licence for the trades you list.
- **Insurance:** proof of liability coverage on file.
- **WSIB / workers' comp:** where it applies to your trade and province.

Upload clear photos or PDFs of each document in the wizard. Once you submit, our team reviews everything; you'll be notified when you're approved and your profile goes live. Until then you can finish setting up your profile, portfolio, and availability.

If something needs another look, we'll let you know what to re-upload, so you won't be left guessing.`,
  },
  {
    slug: "insurance-and-getting-covered",
    categoryId: "for-tradespeople",
    title: "Insurance: getting covered & staying covered",
    excerpt: "Why insured pros win more work, how to get covered, and renewal reminders.",
    audience: "tradesperson",
    keywords: ["insurance", "liability", "coverage", "insured badge", "renew", "renewal", "get covered"],
    body: `General-liability insurance is **optional** on Blue Seal, but it's one of the strongest trust signals you can carry. When you upload proof and our team verifies it, a verified **Insured** badge appears on your public profile, and most clients look for it.

**Getting covered.** If you don't have a policy yet, you can get a quote and buy online in minutes. Look for **"Get covered in minutes"** in your onboarding insurance step, on your dashboard, and whenever you go to send a quote without proof of insurance on file. It opens our insurance partner in a new tab; come back and finish your bid when you're done.

**Adding your proof.** In the onboarding wizard (or your Trust Badges), open the insurance card and enter your insurer, policy number, coverage amount, and expiry date, then upload the certificate (PDF or image). Our team reviews it and your **Insured** badge goes live once it's approved.

**Before you bid.** If you go to apply for a job or send a quote and we don't have current proof of insurance on file, you'll see a quick reminder. It's only a nudge; you can get covered or continue without it.

**Before you start work.** If you're not insured when it's time to begin a job, you'll be asked to **sign a short waiver** first, confirming you're choosing to work uninsured and that you take sole responsibility for the work. You can't clock in until it's signed. It's a one-time step per job, it's kept on file, and it doesn't replace insurance: getting covered removes the step and earns your **Insured** badge.

**Staying covered.** We track your policy's expiry date and remind you by email and in-app **before it lapses**, so your badge doesn't quietly disappear. When you renew, upload the new certificate with **Replace** on your insurance card.`,
  },
  {
    slug: "win-work",
    categoryId: "for-tradespeople",
    title: "Winning work: requests, browsing, and applications",
    excerpt: "Two ways jobs come in: direct requests and the job board.",
    audience: "tradesperson",
    keywords: ["leads", "browse jobs", "apply", "requests", "applications", "win work"],
    body: `Once you're verified, work reaches you two ways:

1. **Direct requests:** clients find your profile and request a quote. These land as new job threads; respond quickly with a clear quote to win the job.
2. **Browse jobs:** clients post jobs to the board. Browse postings in your trade and area and **apply with a full itemized quote** (line items, taxes, optional upfront fee). The client compares quotes side by side and accepts one, so a clear, well-priced quote wins the job outright. Track everything you've applied to under **My applications**.

Can't price a job without seeing it? On either path, toggle **Site visit first** instead of quoting blind. Add a single visit fee (or leave it at $0 for a free visit). The client agrees with one tap, you do the visit, and the fee is **pre-filled into your real quote**, which you can keep to charge on top or delete to waive.

Need answers before you can price it? On the job board you can also apply with **Chat first**: your opening message starts a conversation on the post, and you send your full quote from your application when you're ready (**Send quote**). If the client picks you, the conversation **carries over into the job chat**, so nothing gets repeated.

Browsing with the **Any trade** filter and spot a job outside your trade? Use the **share icon** on the card (or **Refer this job** on the post) to send it to a verified tradesperson in that trade. They're notified and can apply directly.

A complete, verified profile with a strong portfolio and good reviews wins more work, since clients can see your reputation at a glance.

Want an edge? **Blue Seal Pro** features your applications at the top of clients' job posts (clearly marked "Featured"), and adds the AI assistant, a service-fee waiver for your clients, business reports, and a client book with recurring billing. See "Blue Seal Pro" below or the Pricing page.`,
  },
  {
    slug: "blue-seal-pro",
    categoryId: "for-tradespeople",
    title: "Blue Seal Pro",
    excerpt: "The optional upgrade: AI assistant, fee waiver, featured placement, reports, clients and recurring billing.",
    audience: "tradesperson",
    popular: true,
    keywords: ["pro", "subscription", "upgrade", "ai", "trial", "billing", "cancel", "clients", "recurring"],
    body: `Blue Seal Pro is the optional upgrade for tradespeople. The core app (quoting, invoicing, scheduling, chat, the job board) stays free. Pro adds:

- **AI assistant:** diagnose problems, draft quotes and invoice notes, and summarize jobs. (Receipt scanning stays free for everyone.)
- **Your clients pay no service fee:** the Blue Seal service fee on card payments is waived for your jobs, so you're cheaper to hire.
- **Featured placement:** your applications appear first on clients' job posts, marked "Featured".
- **Business reports + CSV export:** revenue and tax-collected summaries plus an accountant-ready export.
- **Clients & recurring billing:** keep a client book (add or import your existing clients) and put your regulars on a standing charge Blue Seal drafts for you to review and send each period.
- **Branded quotes & invoices:** put your logo, a letterhead banner, and your brand colour on every quote and invoice, on the PDF and on screen.

**Price:** $29 CAD/month or $290 CAD/year (two months free on annual). Every new subscription starts with a **30-day free trial**. A card is required, but you won't be charged until the trial ends, and you can cancel anytime before then for $0.

**Manage it** under **Account → Blue Seal Pro**: see your status, switch monthly/annual, update your card, or cancel (you keep Pro until the end of the period you've paid for). Cancelling, switching, and payment updates all go through Stripe's secure customer portal.`,
  },
  {
    slug: "clients-and-recurring-billing",
    categoryId: "for-tradespeople",
    title: "Your client book & recurring billing",
    excerpt: "Keep your clients in one place and bill your regulars on repeat.",
    audience: "tradesperson",
    popular: true,
    keywords: [
      "clients",
      "client book",
      "crm",
      "recurring",
      "recurring billing",
      "import clients",
      "regulars",
      "standing charge",
    ],
    body: `**Clients** is your own contact book, on the **Clients** tab of your dashboard (and in the side panel). It's part of **Blue Seal Pro**.

**Add or import your clients.** Add a client by hand, or **import a CSV** with a Name column (Email, Phone, Company and Notes are optional). We skip duplicates and anyone already in your book. Each client gets a page with their contact details, your private notes, and a history of the jobs you've done together.

**Recurring billing.** Open a client and tap **Add recurring charge**: give it a name (e.g. "Monthly pool maintenance"), pick weekly, monthly, or quarterly, and list what you charge. Blue Seal then **drafts that invoice for you each period**.

**Nothing is ever sent automatically.** Each draft waits for you to review and send, so an amount is never charged to a client without you. You can **pause or resume** a recurring charge any time, and edit the amount whenever it changes.

Your clients here are yours: adding a client or setting up recurring billing doesn't notify them or change anything on their side until you choose to send an invoice.`,
  },
  {
    slug: "quotes-and-invoices",
    categoryId: "payments-invoices",
    title: "Quotes, invoices and receipts",
    excerpt: "How quoting, auto-invoicing, and receipts work on a job.",
    audience: "all",
    popular: true,
    keywords: ["quote", "invoice", "receipt", "billing", "total", "tax", "line items"],
    body: `Money on a job follows a simple path:

1. **Quote:** the tradesperson builds a quote with line items and totals. The client reviews and accepts it before any work starts.
2. **Work:** the job runs; time and expenses can be tracked against it.
3. **Invoice:** when the work is done, the invoice is built from the agreed quote plus tracked time, materials, and any extra charges (travel, callout, tool rental, or changes that came up along the way). The client reviews and approves it, extras included, before paying.
4. **Receipt:** once paid, both sides have a receipt in the job thread.

Everything is itemised, so there are no surprises: the client sees what they're paying for and the tradesperson has a clean record.`,
  },
  {
    slug: "paying-for-a-job",
    categoryId: "payments-invoices",
    title: "Paying for a job",
    excerpt: "How clients pay and where to find receipts.",
    audience: "client",
    keywords: ["pay", "payment", "card", "checkout", "receipt", "invoice"],
    body: `When your tradesperson sends an invoice, you'll see it in the job thread with a clear breakdown. You can pay securely from there, and a **receipt** is saved to the thread for both of you afterward.

Always keep payments and agreements inside the job thread. It's your record if a question ever comes up, and it's what lets us help if something goes wrong.`,
  },
  {
    slug: "getting-paid",
    categoryId: "payments-invoices",
    title: "Getting paid out (tradespeople)",
    excerpt: "Set up payouts so funds reach your account.",
    audience: "tradesperson",
    keywords: ["payout", "payouts", "stripe", "get paid", "bank", "connect"],
    body: `To receive payments through Blue Seal, set up **Payouts** from your account. This connects a secure payouts account so funds from paid invoices reach your bank.

You can return to the **Payouts** screen any time to finish setup or open your payouts dashboard. Once it's set up, paid invoices flow through automatically, with no chasing cheques.`,
  },
  {
    slug: "work-order-time-and-change-orders",
    categoryId: "payments-invoices",
    title: "Tracking time and change orders (the Work Order tab)",
    excerpt: "Clock in on a job, track travel, and add client-approved change orders.",
    audience: "all",
    popular: true,
    keywords: [
      "clock in",
      "clock out",
      "time tracking",
      "timer",
      "travel",
      "change order",
      "extra",
      "work order",
      "hourly",
      "fixed price",
      "receipt",
      "expenses",
      "materials",
    ],
    body: `Every active job has a **Work order** tab, the home for the actual work: time, travel, receipts, and any change orders.

**Charges so far.** At the top of the tab is a running, pre-tax total of what's been added to the job (tracked time, billable materials, and any approved change orders) so both sides can see the charges adding up at a glance. Tax and anything from the original quote are settled when the invoice is built, so the final total can differ. The tradesperson sees a **Create invoice** button here too, the same wrap-up as the Invoice tab, reachable from where the work is tracked.

**Clocking time.** The tradesperson taps **Clock in** when they start and **Stop** when they finish. The timer runs live and the client sees it too, so the hours are never a surprise. You can clock in straight from the **Jobs** tab as well. While the clock is running, a bar pinned to the top of the app shows the live timer and the job name from any screen; tap **Clock out** there to stop and jump back to the job. Clocking in on a new job automatically stops a session still running on another, so only one clock runs at a time. Forgot to start the timer? Tap **Add time manually** on the Work order tab to log a past session: set the start and end and it bills just like clocked time.

**Hourly vs fixed-price jobs.** How time is billed depends on the job:
- On an **hourly** job, the hours on the quote are an **estimate**: the final invoice bills the **actual clocked time** at the agreed hourly rate, not the quoted hours. **Travel** can be clocked separately at the tradesperson's travel rate.
- On a **fixed-price** job, time is still tracked as a record, but it shows **no charge**, since the agreed price stands.

**Change orders.** When a job picks up extra work that wasn't in the original quote, the tradesperson proposes a **change order**: a flat fee, or an hourly rate they then clock against. The client **approves it first**; nothing extra is billed without that sign-off. Approved change orders flow onto the final invoice alongside the agreed price, so the breakdown stays clear and above board.

**Receipts & expenses.** The tradesperson can upload receipts (materials, fuel, disposal) on the Work order tab. We auto-read the total, vendor and date, and the receipt itself stays private to the tradesperson. Materials supplied from the tradesperson's own stock can be **added manually too, no receipt needed**, and bill the same way. On an **hourly** job each expense becomes a billable line with an optional markup. On a **fixed-price** job expenses are **for the tradesperson's records only and aren't billed**, since the agreed price already covers materials. To charge for a material that was genuinely outside the original scope, the tradesperson proposes a **change order** the client approves, rather than adding it as an expense.`,
  },
  {
    slug: "bring-your-own-client",
    categoryId: "for-tradespeople",
    title: "Jobs for your own clients (invite them, or run it solo)",
    excerpt: "Create a job for a client who isn't on Blue Seal: invite them with one link, or manage the whole job yourself.",
    audience: "tradesperson",
    popular: true,
    keywords: [
      "own client",
      "invite client",
      "invite link",
      "new job",
      "solo job",
      "off platform",
      "existing customer",
      "project tracker",
      "record offline",
    ],
    body: `Most of your customers aren't on Blue Seal, and they don't need to be. **New job** (on your dashboard) lets you set up a job for your own client, so you get the full toolkit (quote, schedule, time tracking, receipts, invoice) for every job you do, not just the ones that come through the platform.

**Creating the job.** Tap **New job**, describe the work, and enter your client's name and email. The job lands in your pipeline like any other, and you get an **invite link** for your client.

**Inviting your client.** We email your client a sign-in link when we can, and you can always **copy the link** and text it yourself. One tap signs them in, with **no password, no signup form**. Once they join, they see the job like any Blue Seal client: they can chat with you, accept your quote with a signature, approve change orders, and review and pay the invoice. From the job page you can **resend** the invite, **fix a typo'd email**, or **revoke** it (revoking kills the link immediately).

**Running it solo.** If your client never joins, nothing is blocked:

- Send your quote, then tap **Record client acceptance** once they've agreed outside the app (verbally, by text). It's logged as recorded **by you**, and no signature is created on their behalf.
- Track time, sessions, and receipts as usual.
- When the work's done, **Finalize invoice** (there's no approval round-trip without a client) and **mark it paid** when the money arrives.

**What's different on a solo job:** change orders and site-visit requests are off (there's no client to approve them, so bill extra work as an invoice line item instead), and a job whose quote acceptance was **recorded offline doesn't produce Blue Seal reviews** in either direction. The review system only counts work a verified client accepted in-app, and that's what keeps the badges and ratings meaningful, including yours.

If your client joins **later**, everything you recorded is visible to them in the job log, clearly marked as recorded by you before they joined.`,
  },
  {
    slug: "how-verification-works",
    categoryId: "verification-trust",
    title: "How the verification badges work",
    excerpt: "What each badge means and why it matters.",
    audience: "all",
    popular: true,
    keywords: ["badge", "verified", "id verified", "certified", "insured", "trust"],
    body: `Badges on a tradesperson's profile tell you, at a glance, what's been checked:

- **ID verified:** we've confirmed their government photo ID.
- **Certified:** their trade certification / licence is on file.
- **Insured:** proof of liability insurance is on file.
- **WSIB / workers' comp:** coverage is on file where their trade and province require it.

Each badge is granted only after our team reviews the actual document; there are no self-serve shortcuts. That's the whole point of Blue Seal: when you see a badge, a real person checked the paperwork behind it.`,
  },
  {
    slug: "mutual-reviews",
    categoryId: "verification-trust",
    title: "Mutual reviews",
    excerpt: "Both sides review each other, and why reviews stay hidden at first.",
    audience: "all",
    keywords: ["reviews", "rating", "stars", "feedback", "reputation", "mutual"],
    body: `When a job wraps up, **both** the client and the tradesperson can leave a review. That two-way accountability is what keeps the bar high on both sides: better clients and better pros.

Reviews are **blind until both are in** (or a short window passes), so neither side can react to the other's rating before writing their own. Once revealed, they appear on the relevant profiles and feed into the overall rating.

Honest, specific reviews help everyone, so mention what went well and anything that could've been smoother.`,
  },
  {
    slug: "install-the-app",
    categoryId: "account-app",
    title: "Installing Blue Seal as an app",
    excerpt: "Add Blue Seal to your home screen for a full-screen, app-like experience.",
    audience: "all",
    keywords: ["install", "pwa", "home screen", "app", "add to home", "offline"],
    body: `Blue Seal is a **progressive web app**, so you can install it straight from your browser, no app store needed.

- **iPhone / iPad (Safari):** tap the **Share** button, then **Add to Home Screen**.
- **Android (Chrome):** tap the **⋮** menu, then **Install app** (or **Add to Home screen**).
- **Desktop (Chrome/Edge):** look for the **install** icon in the address bar.

Once installed, Blue Seal opens full-screen like a normal app and updates itself automatically.`,
  },
  {
    slug: "notifications",
    categoryId: "account-app",
    title: "Notifications",
    excerpt: "Stay on top of messages, quotes, and job updates.",
    audience: "all",
    keywords: ["notifications", "alerts", "bell", "email", "push", "updates"],
    body: `The **bell** icon shows your in-app notifications: new messages, quote and application updates, and job status changes. Tap one to jump straight to the job it's about.

**When you're not in the app, email is how we reach you.** We'll email you about anything that needs your attention: a **new message**, a **quote sent or accepted**, an **invoice sent or paid**, a **job status change**, **application updates**, **verification decisions**, and **job invites**. (For a busy back-and-forth chat we send one "new message" email per lull, not one per line.) There's nothing to set up; just add Blue Seal to your contacts so our emails land in your inbox, not spam.

For instant, on-device alerts on those same updates, turn on **push notifications**: they reach you even when Blue Seal is closed. We'll offer to switch push on when you create your account and again when you come back until it's on for the device you're using; you stay in control and can toggle it any time per device from **Account → Notifications**. Your browser asks permission once. On iPhone, add Blue Seal to your home screen first (see "Install Blue Seal"), then enable push from inside the installed app. (We also use **WhatsApp** for a few time-critical events if you've added your phone number.)

Manage email, push, and WhatsApp any time from **Account → Notifications**.`,
  },
  {
    slug: "report-a-problem",
    categoryId: "safety-disputes",
    title: "Reporting a problem or opening a dispute",
    excerpt: "What to do if a job goes wrong.",
    audience: "all",
    popular: true,
    keywords: ["dispute", "report", "problem", "complaint", "refund", "issue", "help"],
    body: `If something goes wrong on a job, first try to resolve it **in the job thread**. Most issues are a miscommunication and a quick message sorts them out. Keeping the conversation in-thread also means there's a clear record.

If you can't resolve it between yourselves, **contact support** (see the Contact section of the Help Center). Our team can look at the job, the messages, and the invoice to help reach a fair outcome.

For anything involving your immediate safety, contact your local emergency services first.`,
  },
  {
    slug: "connect-google-reviews",
    categoryId: "for-tradespeople",
    title: "Showing your Google reviews on your profile",
    excerpt: "Connect your Google Business Profile to display your Google reviews on Blue Seal.",
    audience: "tradesperson",
    keywords: ["google", "google reviews", "google business", "business profile", "reviews", "reputation", "connect"],
    body: `If you already have a **Google Business Profile** with reviews, you can show those reviews on your Blue Seal profile too. It's handy when you're newer to Blue Seal and still building up reviews here.

**How to connect**

1. Go to **Account → Tradesperson → Google reviews**.
2. Tap **Connect Google Business** and sign in with the Google account that *manages your business listing*.
3. Grant read access to your reviews. That's it: your Google rating and recent reviews will appear on your public profile shortly after.

We refresh your Google reviews automatically each day, and you can tap **Sync now** anytime to pull your latest ones right away.

**Good to know**

- Your **Google reviews are shown in their own section**, clearly labelled. They're kept separate from your Blue Seal rating, and the two never get mixed together, because Blue Seal reviews come from completed, verified Blue Seal jobs.
- You can only connect a business *you* manage on Google, so you'll sign in and approve the access yourself.
- You can **disconnect anytime** from the same screen. Your Google reviews come off your Blue Seal profile right away.

Don't have a Google Business Profile yet? You don't need one; it's an optional extra. Your Blue Seal reviews stand on their own.`,
  },
  {
    slug: "staying-safe",
    categoryId: "safety-disputes",
    title: "Staying safe",
    excerpt: "Simple habits that keep clients and pros protected.",
    audience: "all",
    keywords: ["safety", "scam", "secure", "protect", "tips"],
    body: `A few habits keep everyone protected:

- **Keep it on Blue Seal.** Chat, quotes, invoices, and payments all in the job thread give you a record if a question comes up.
- **Check the badges.** Hire verified pros and look at their reviews and recommendations.
- **Be specific in writing.** Agree on scope, price, and timing in the thread before work starts.
- **Don't share more than you need to.** Your exact address stays private on public job posts until you choose to share it.

If a request feels off (someone pushing you off-platform, or asking for payment in an unusual way) pause and contact support.`,
  },
];

// Keep this list broad and current. When a major feature ships, add or update
// the FAQ entries it affects (see CLAUDE.md → "Help Center & FAQ upkeep").
const faqs: FaqItem[] = [
  // ── Getting started ──────────────────────────────────────────────────────
  {
    question: "What is Blue Seal?",
    answer:
      "Blue Seal connects homeowners with **verified Canadian tradespeople** and keeps the whole job (chat, photos, quote, invoice, and reviews) in one thread. Every pro is manually checked before they can take work.",
    categoryId: "getting-started",
    audience: "all",
  },
  {
    question: "Is Blue Seal free to use?",
    answer:
      "Yes. Creating an account, searching for tradespeople, posting a job, quoting, invoicing, and scheduling are all free, for clients and tradespeople alike. You pay for the work itself through the job thread. Tradespeople can optionally subscribe to **Blue Seal Pro** for the AI assistant, featured placement, and more, but the core app stays free.",
    categoryId: "getting-started",
    audience: "all",
  },
  {
    question: "What is Blue Seal Pro and how much does it cost?",
    answer:
      "Blue Seal Pro is an optional upgrade for tradespeople ($29 CAD/month or $290 CAD/year) with a 30-day free trial. It adds the AI assistant, waives the Blue Seal service fee for your clients on card payments, features your applications at the top of clients' job posts, includes business reports with a CSV export, gives you a client book with recurring billing for your regulars, and lets you brand your quotes and invoices with your own logo, banner, and colour. The core app stays free.",
    categoryId: "for-tradespeople",
    audience: "tradesperson",
  },
  {
    question: "I got an email saying Blue Seal set up a free profile for me. Is it real?",
    answer:
      "Yes, that's us. We build draft profiles for local tradespeople from publicly listed business information, then reach out to invite you to claim yours. The profile stays **private** until you claim it, so it isn't shown publicly in the meantime. Claiming is free: the link in the email signs you in without a password, shows you the profile we drafted, and lets you edit anything or add your trade ticket and ID to earn the verified badge. If you'd rather not be on Blue Seal at all, the same link lets you remove the listing for good. We never charge to be listed. Blue Seal makes money from payment service fees and optional Pro tools, not from directory fees.",
    categoryId: "for-tradespeople",
    audience: "tradesperson",
  },
  {
    question: "Do I need insurance to work on Blue Seal?",
    answer:
      "No. General-liability insurance is **optional**. But insured pros win more work: uploading proof earns a verified **Insured** badge on your profile, which most clients look for. If you try to bid or quote without proof of insurance on file, we'll show a gentle reminder. And if you're still not insured when it's time to start a job, you'll be asked to **sign a one-time waiver** before you can clock in, confirming you're choosing to work uninsured. Getting covered removes that step.",
    categoryId: "for-tradespeople",
    audience: "tradesperson",
  },
  {
    question: "What happens when I start a job without insurance?",
    answer:
      "Before you can clock in on a job where you're not insured, you'll sign a short in-app waiver: you confirm you're choosing to work uninsured, that you take sole responsibility and liability for the work, and that you release Blue Seal from any claim about your lack of insurance. The client is also told you're not insured and signs off on it when they accept. It's one waiver per job, kept on file, and it isn't insurance. Getting covered removes the waiver step and earns your Insured badge.",
    categoryId: "for-tradespeople",
    audience: "tradesperson",
  },
  {
    question: "What if the tradesperson I'm hiring isn't insured?",
    answer:
      "Blue Seal doesn't require tradespeople to carry insurance, so some aren't insured through us. When that's the case, we tell you up front and ask you to acknowledge it: when you request the tradesperson, and again when you accept their quote (your signature on the quote is that acknowledgment). Going ahead is your choice. If something goes wrong, an uninsured tradesperson may have no insurance to claim against, so you can always ask them for proof of coverage before any work begins.",
    categoryId: "for-clients",
    audience: "client",
  },
  {
    question: "Why am I asked if Blue Seal is an additional insured on my policy?",
    answer:
      "When you upload your own liability policy, we ask whether Blue Seal is named as an **additional insured**. That's what actually extends your coverage to Blue Seal (being a \"certificate holder\" doesn't). It's automatic on a Blue Seal partner policy. If Blue Seal **is** named, an admin confirms it against your certificate. If it **isn't**, you sign a short liability release so everyone's clear that your policy doesn't cover Blue Seal and you're accepting responsibility for your work. You can skip the release any time by adding Blue Seal as an additional insured and uploading the updated certificate.",
    categoryId: "for-tradespeople",
    audience: "tradesperson",
  },
  {
    question: "Will Blue Seal remind me when my insurance is about to expire?",
    answer:
      "Yes. We track the expiry date on your verified insurance and remind you by email and in-app before it lapses, so your **Insured** badge doesn't quietly disappear. When you renew, upload the new certificate with **Replace** on your insurance card.",
    categoryId: "for-tradespeople",
    audience: "tradesperson",
  },
  {
    question: "Will my client be charged automatically with recurring billing?",
    answer:
      "No. Recurring billing **drafts** the invoice for you each period; nothing is sent or charged without you. You review each draft and send it when you're ready, and you can pause or resume a recurring charge any time. Recurring billing is part of Blue Seal Pro.",
    categoryId: "for-tradespeople",
    audience: "tradesperson",
  },
  {
    question: "How do I cancel or change my Blue Seal Pro plan?",
    answer:
      "Go to **Account → Blue Seal Pro** and open **Manage subscription**. That takes you to Stripe's secure portal where you can cancel, switch between monthly and annual, or update your card. If you cancel, you keep Pro until the end of the period you've already paid for. Cancelling during your free trial means no charge at all.",
    categoryId: "for-tradespeople",
    audience: "tradesperson",
  },
  {
    question: "Which areas does Blue Seal cover?",
    answer:
      "Blue Seal serves communities across Canada and is growing. Search by your location to see verified pros who cover your area. If there aren't many yet near you, posting a job is the best way to reach the ones who do.",
    categoryId: "getting-started",
    audience: "all",
  },
  {
    question: "Do I need an account to look around?",
    answer:
      "You can browse and search without signing in. You'll need a free account to request a quote, post a job, message a tradesperson, or apply to work.",
    categoryId: "getting-started",
    audience: "all",
  },
  {
    question: "My tradesperson sent me a Blue Seal invite link, what is it?",
    answer:
      "Your tradesperson set up your job on Blue Seal so you can both track it in one place: the quote, schedule, messages, and invoice. The link signs you in with just your email (**no password, nothing to install**), and it only works for the email address they invited. Once you're in, you can chat, accept the quote, and review and pay the invoice. If you weren't expecting it, check with your tradesperson before tapping, and nothing is linked to you until you confirm it's your job.",
    categoryId: "getting-started",
    audience: "client",
  },
  {
    question: "How is Blue Seal different from other directories?",
    answer:
      "Most sites just hand you a phone number. Blue Seal **verifies** every pro by hand (government ID and trade certification before they can take work, with insurance and workers'-comp badges on top) and runs the **whole job** in one place: chat with photos, a status board, quotes, invoices, an AI assistant, and mutual reviews.",
    categoryId: "getting-started",
    audience: "all",
  },

  // ── Hiring a tradesperson (clients) ───────────────────────────────────────
  {
    question: "I don't know which trade I need, how do I search?",
    answer:
      "On **Find a tradesperson**, use the **\"What do you need done?\"** box and describe the job in plain words, e.g. *\"my sink is leaking\"* or *\"power keeps tripping\"*. We'll suggest the right trade; tap one to set the filter. Still unsure? **Post a job** and let verified pros tell you what's involved.",
    categoryId: "for-clients",
    audience: "client",
  },
  {
    question: "What's the difference between requesting a quote and posting a job?",
    answer:
      "Requesting a quote reaches out to one specific pro you've chosen. Posting a job lists the work so multiple verified pros in your area each apply with a full itemized quote, and you compare them side by side and accept one.",
    categoryId: "for-clients",
    audience: "client",
  },
  {
    question: 'What does the "Featured" tag on an applicant mean?',
    answer:
      "It means that tradesperson subscribes to **Blue Seal Pro**. Pro applicants are listed first and marked *Featured*, a paid placement that affects the **order only**. It never changes their verification, ID/insurance badges, ratings, or reviews, and you always compare the actual itemized quotes before choosing. Pick whoever's right for your job.",
    categoryId: "for-clients",
    audience: "client",
  },
  {
    question: "Can I save tradespeople I like for later?",
    answer:
      "Yes. Tap the **heart** on any search result or on a tradesperson's profile to add them to your saved list. Your saved tradespeople appear at the top of the **Find a tradesperson** page so you can jump straight back to them when the next job comes up. Your list is private, so tradespeople can't see who saved them.",
    categoryId: "for-clients",
    audience: "client",
  },
  {
    question: "Does Blue Seal offer rebates or grants?",
    answer:
      "Blue Seal doesn't fund or administer any rebates. When you post energy-related work (heat pumps, solar, insulation, windows), we may surface **government or utility programs that could apply** so you don't miss them, but we can't confirm your eligibility. Always check the details and apply on the official program page we link to.",
    categoryId: "for-clients",
    audience: "client",
  },
  {
    question: "How do I get the most accurate quote?",
    answer:
      "Add clear **photos** and answer the trade-specific questions in detail. The more a pro understands up front, the tighter the quote. You can always ask follow-up questions in the job thread before accepting.",
    categoryId: "for-clients",
    audience: "client",
  },
  {
    question: "Do I need to sign to accept a quote?",
    answer:
      "Yes. When you accept a quote, you'll draw a quick signature with your finger (or mouse on a computer) to confirm. It's saved with the quote as your record of agreement before any work starts, and your tradesperson can see it too.",
    categoryId: "for-clients",
    audience: "client",
  },
  {
    question: "Why is a tradesperson asking for a site visit before quoting?",
    answer:
      "Some jobs can't be priced accurately without seeing them. Instead of quoting blind, a tradesperson can ask to do a **site visit first**, sometimes free, sometimes with a small visit fee they set. You'll see the fee (or that it's free) before agreeing, and you agree with **one tap, no signature**, since it's just an agreement to a visit, not the job itself. After the visit they send your full quote, which you accept the usual way. The visit fee may appear on that quote, or they may waive it; that's up to the tradesperson.",
    categoryId: "for-clients",
    audience: "client",
  },
  {
    question: "Can I message a tradesperson before I commit?",
    answer:
      "Yes. Requesting a quote opens a job thread where you can chat, share more photos, and ask questions. And on a **posted job**, you can message any applicant about their quote before accepting; tap **Message** on their card. Nothing is locked in until you accept and sign a quote.",
    categoryId: "for-clients",
    audience: "client",
  },
  {
    question: "Can I ask an applicant questions before accepting their quote?",
    answer:
      "Yes. On your posted job, each applicant's card has a **Message** button that opens a private conversation with just that tradesperson. Ask whether they're flexible on price, if they can start sooner, or what's driving a line item. They're notified and can reply, and revise their quote if it helps.",
    categoryId: "for-clients",
    audience: "client",
  },
  {
    question: "How do I decline an applicant?",
    answer:
      "Tap **Decline** on their card and add a short reason. Their card leaves your active applicants list, and the tradesperson is told why, so if it was about the price or scope, they can revise their quote and put it back in front of you.",
    categoryId: "for-clients",
    audience: "client",
  },
  {
    question: "An applicant updated their quote, how can I tell?",
    answer:
      "Their card shows a **Revised** tag with the new total and an \"Updated\" timestamp. Open the full quote to see exactly what changed before you accept.",
    categoryId: "for-clients",
    audience: "client",
  },
  {
    question: "Is my address shared publicly when I post a job?",
    answer:
      "No. A public job post only shows your general area. Your exact address stays private until you choose to share it with a pro you're moving forward with.",
    categoryId: "for-clients",
    audience: "client",
  },
  {
    question: "Can I hire more than one tradesperson?",
    answer:
      "Yes. Each job is its own thread, so you can run several jobs (and several pros) at once and keep them cleanly separated.",
    categoryId: "for-clients",
    audience: "client",
  },
  {
    question: "What if no one applies to my job?",
    answer:
      "Try widening your area or budget range, and make sure your description and photos are clear. You can also search directly and request a quote from specific pros in your trade.",
    categoryId: "for-clients",
    audience: "client",
  },
  {
    question: "Can I cancel a request or job?",
    answer:
      "Yes. Before you've accepted a quote, you can cancel a request instantly from the job thread. Once a quote is accepted or work is under way, cancelling sends your tradesperson a request to accept first, so any costs already incurred get settled fairly. You can add a reason, and you can withdraw the request while it's still pending.",
    categoryId: "for-clients",
    audience: "client",
  },
  {
    question: "Can I put a job on hold instead of cancelling?",
    answer:
      "Yes. On an active job you can ask to **put it on hold** from the Schedule tab, handy if you're waiting on a part, away for a while, or sorting out access. You can suggest a resume date, and your tradesperson accepts the hold. While a job is on hold, either of you can resume it any time and it picks up right where it left off.",
    categoryId: "for-clients",
    audience: "client",
  },
  {
    question: "How do I see when my tradesperson is coming?",
    answer:
      "Open the job and check the **Schedule tab**: it shows a calendar with every visit your tradesperson has booked, with the date and time of each. A job can have more than one visit when the work spans a few days. You can't change the visits yourself, but you'll always see the current plan, and the top of the job highlights your next booked visit.",
    categoryId: "for-clients",
    audience: "client",
  },

  // ── Working as a tradesperson ─────────────────────────────────────────────
  {
    question: "How do I become a verified tradesperson?",
    answer:
      "Sign up as a tradesperson and complete the onboarding wizard. It walks you through uploading your **government ID**, **trade certification**, **insurance**, and **WSIB/workers' comp** where it applies. **Confirm your email** first (we send a link when you sign up), since your profile can't be submitted for review until it's verified. Our team reviews it and you're notified when you go live.",
    categoryId: "for-tradespeople",
    audience: "tradesperson",
  },
  {
    question: "How long does verification take?",
    answer:
      "Your documents are reviewed by our team. You'll be notified as soon as you're approved, and if anything needs another look, we'll tell you exactly what to re-upload.",
    categoryId: "for-tradespeople",
    audience: "tradesperson",
  },
  {
    question: "Can I work before I'm verified?",
    answer:
      "You can finish setting up your profile, portfolio, and availability while you wait, but you can't take jobs or appear in search until your verification is approved. You'll also need to **confirm your email** before you can submit your profile for review. We send a verification link when you sign up, and there's a Resend button in the banner if it didn't arrive. That gate is what makes the badges mean something.",
    categoryId: "for-tradespeople",
    audience: "tradesperson",
  },
  {
    question: "Can I hide my profile or take myself out of search?",
    answer:
      "Yes. Go to **Account → Privacy & account → Profile visibility** and turn off **Show my profile in search**. While it's off, clients won't find you in the Find a tradesperson search or browse, and your profile won't be indexed by Google. Your current jobs, invoices, and any direct profile link you've already shared keep working normally, and your verification is untouched, so you're not sent back for review. Switch it back on anytime to be listed again. Your profile is public by default.",
    categoryId: "for-tradespeople",
    audience: "tradesperson",
  },
  {
    question: "How do jobs reach me?",
    answer:
      "Two ways: **direct requests** from clients who find your profile, and the **job board**, where you browse postings in your trade and area and apply. Track everything you've applied to under My applications.",
    categoryId: "for-tradespeople",
    audience: "tradesperson",
  },
  {
    question: "Can I manage jobs for clients who aren't on Blue Seal?",
    answer:
      "Yes. Tap **New job** on your dashboard. You get the full toolkit (quote, schedule, time tracking, invoice) and your client gets an **invite link**: one tap signs them in, no password or signup form. If they never join, you can run the whole job solo: record their acceptance, finalize the invoice, and mark it paid.",
    categoryId: "for-tradespeople",
    audience: "tradesperson",
  },
  {
    question: "Why doesn't my solo job earn reviews?",
    answer:
      "Reviews only count for work a **verified client accepted in-app**. On a solo job (or one where you recorded the quote acceptance on your client's behalf), there's no verified counterparty, so no review is created in either direction. That gate is what keeps Blue Seal ratings meaningful, including yours.",
    categoryId: "for-tradespeople",
    audience: "tradesperson",
  },
  {
    question: "A client asked about my quote, where do I answer?",
    answer:
      "Open the job post from **My applications**. Your application shows a **Messages** panel with the client's questions and a reply box; answer right there. You'll get a notification whenever they send a new message.",
    categoryId: "for-tradespeople",
    audience: "tradesperson",
  },
  {
    question: "Can I revise my quote after applying?",
    answer:
      "Yes. Open the job post and tap **Revise quote** on your application: it reopens your quote prefilled, so you can adjust line items, pricing, or timing and re-send. The client sees the updated bid right away. If they declined your quote with a reason, that reason is shown so you know what to change, and revising puts you back in the running.",
    categoryId: "for-tradespeople",
    audience: "tradesperson",
  },
  {
    question: "Can I require a site visit before I quote?",
    answer:
      "Yes. On a direct request, open **Prepare quote** and switch to **Site visit first**; when applying to a posted job, toggle **Site visit first** on the apply form. Add a single visit fee, or leave it at **$0 for a free visit**, plus an optional proposed date and note. The client agrees with one tap (no signature). Once they agree (or, on a posted job, pick you) you do the visit, then send your full quote: the agreed visit fee is **pre-filled as a line item**, so you can keep it to charge on top or delete it to waive or credit it.",
    categoryId: "for-tradespeople",
    audience: "tradesperson",
  },
  {
    question: "Can I reuse a quote instead of rebuilding it every time?",
    answer:
      "Yes, with quote templates. In the quote composer, build your line items once and tap **Save as template** (e.g. \"Full bathroom reno\"). Next time, pick it from **Load a template…** under the line items and it fills the scope of work in, rates included. Give the rates a quick once-over before sending, since templates keep the prices from when you saved them. Templates are private to you; delete one any time from the same dropdown.",
    categoryId: "for-tradespeople",
    audience: "tradesperson",
  },
  {
    question: "How many trades can I list?",
    answer:
      "You can list a primary trade plus a few secondary trades you're qualified for. List the ones you actually hold certification for, since they affect which jobs you're matched to.",
    categoryId: "for-tradespeople",
    audience: "tradesperson",
  },
  {
    question: "Can the assistant help with the actual trade work, not just the app?",
    answer:
      "Yes. The in-app **AI assistant** knows the trade(s) on your profile and answers as a specialist in them: walk-throughs for installing, setting up, commissioning and diagnosing the systems you work on, with materials, sizing, Canadian code and metric units, and a clear heads-up when a job needs a permit, an inspection, or a different licensed trade. Open it from the assistant button on your dashboard for general questions, or inside a job to ground its answers in that job's details. Treat it as an experienced second opinion, and always lean on your own judgement and local code.",
    categoryId: "for-tradespeople",
    audience: "tradesperson",
  },
  {
    question: "What makes a strong profile?",
    answer:
      "Complete verification, a clear bio, the specific services you offer, a portfolio of past work, your service area and availability, and good reviews. Clients can see all of this at a glance, and a complete profile wins more work.",
    categoryId: "for-tradespeople",
    audience: "tradesperson",
  },
  {
    question: "Can I list the specific services I offer?",
    answer:
      "Yes. Alongside your trades, you can add a free-text list of the specific jobs you take on, like \"Boiler installation\" or \"Emergency callout\". Add them on the **Trades** step of the onboarding wizard, or anytime from the **Tradesperson** tab in your account. They show as a clear checklist on your public profile so clients can tell at a glance whether you do the job they need.",
    categoryId: "for-tradespeople",
    audience: "tradesperson",
  },
  {
    question: "How do I know when there are new jobs near me?",
    answer:
      "A number appears on **Browse open jobs** in the top bar whenever clients post new jobs in your trade and service area; open the board and it clears. We keep this off the notification bell on purpose: the bell stays for things that need you personally (messages, quotes, application updates), while the job feed lives right where you go to act on it.",
    categoryId: "for-tradespeople",
    audience: "tradesperson",
  },
  {
    question: "Can I refer a job to another tradesperson?",
    answer:
      "Yes. When you browse the job board with the **Any trade** filter, you'll see open jobs outside your own trade too. Tap the **share icon** on a job card (or **Refer this job** on the post itself) and pick a verified tradesperson in that trade who covers the job's area. They get a notification with your note and a **Referred to you by** banner on the post, and can apply like any other applicant. If they apply, you're notified too.",
    categoryId: "for-tradespeople",
    audience: "tradesperson",
  },
  {
    question: "What are recommendations / vouches?",
    answer:
      "You can invite people who know your work to vouch for you. These recommendations appear on your profile alongside client reviews and help build trust, especially when you're new.",
    categoryId: "for-tradespeople",
    audience: "tradesperson",
  },
  {
    question: "How do I schedule visits for a job?",
    answer:
      "Open the job and go to the **Schedule tab**: it's a week/month calendar like your dashboard. Tap any day to book a visit (set a start and end time, plus an optional note like \"first fix\"), and add as many visits as the job needs, so multi-day work is easy to lay out. Tap a visit to edit or remove it. If one clashes with a block-off or another booked job we'll warn you first. Your booked visits show on your dashboard calendar, and the client sees them on their side too.",
    categoryId: "for-tradespeople",
    audience: "tradesperson",
  },
  {
    question: "Can I track my time and expenses on a job?",
    answer:
      "Yes, it all lives on the job's **Work order** tab. Clock time, and upload receipts (materials, fuel, disposal) that we auto-read for total, vendor and date, or tap **Add material** to log a material you supplied yourself, no receipt needed. On an **hourly** job each expense becomes a billable line with an optional markup; on a **fixed-price** job expenses are for your own records and aren't billed (the agreed price already covers materials, so charge an out-of-scope material with a change order instead).",
    categoryId: "for-tradespeople",
    audience: "tradesperson",
  },
  {
    question: "A client asked to cancel or pause a job, what happens?",
    answer:
      "Once you're committed to a job (the client has accepted a quote or work is under way), the client can't cancel or pause it on their own; they send you a request instead. You'll get a notification and an **Accept / Decline** banner on the job. Accepting a cancellation closes the job; accepting a hold pauses it, and either of you can resume it later. Declining keeps the job going as normal.",
    categoryId: "for-tradespeople",
    audience: "tradesperson",
  },
  {
    question: "Can I show my Google reviews on Blue Seal?",
    answer:
      "Yes. If you have a Google Business Profile, go to **Account → Tradesperson → Google reviews** and connect it. Your Google rating and recent reviews appear in their own section on your profile, kept separate from your Blue Seal rating. You can disconnect anytime.",
    categoryId: "for-tradespeople",
    audience: "tradesperson",
  },

  // ── Verification & trust ──────────────────────────────────────────────────
  {
    question: "How do I know a tradesperson is legit?",
    answer:
      "Every pro is manually reviewed before going live: we check government ID, trade certification, insurance, and WSIB/workers' comp where it applies. The badges on a profile show what's been verified.",
    categoryId: "verification-trust",
    audience: "all",
  },
  {
    question: "What do the verification badges mean?",
    answer:
      "**Red Seal** = a Red Seal trade certificate is on file (see below). **ID verified** = government photo ID confirmed. **Certified** = trade certification/licence on file. **Insured** = liability insurance on file. **WSIB** = workers' comp coverage on file where required. Each is granted only after our team reviews the actual document. A profile's **Verified credentials** section lists exactly which ones a tradesperson holds.",
    categoryId: "verification-trust",
    audience: "all",
  },
  {
    question: "What does the Red Seal badge mean?",
    answer:
      "The **Red Seal** is Canada's interprovincial standard of trade qualification: a tradesperson who's passed the Red Seal exam can work in their trade across the country. When you see the red badge, it means our team reviewed a Red Seal certificate for that tradesperson before they went live; their profile's **Verified credentials** section shows which trade it covers. Like every badge, it confirms we checked the document. It isn't a guarantee the credential is currently in force or that it covers your specific job, so it's always worth asking to see current proof before work begins.",
    categoryId: "verification-trust",
    audience: "all",
  },
  {
    question: "How do reviews work?",
    answer:
      "When a job wraps up, **both** sides can review each other. Reviews stay hidden until both are in (or a short window passes), so neither side can react to the other's rating before writing their own.",
    categoryId: "verification-trust",
    audience: "all",
  },
  {
    question: "Can reviews be faked or bought?",
    answer:
      "Reviews are tied to real completed jobs between verified accounts, and they're mutual, so both sides are accountable. That makes them far harder to game than open, anonymous ratings.",
    categoryId: "verification-trust",
    audience: "all",
  },

  // ── Quotes, invoices & payments ───────────────────────────────────────────
  {
    question: "How does paying for a job work?",
    answer:
      "Your tradesperson sends an invoice in the job thread with a clear breakdown. You can pay securely by card from there, or pay by e-transfer or cash and have your tradesperson mark it paid. Either way a receipt is saved to the thread for both of you.",
    categoryId: "payments-invoices",
    audience: "client",
  },
  {
    question: "What is the Blue Seal service fee?",
    answer:
      "When you pay an invoice **by card**, a small **Blue Seal service fee** is added at checkout: 5% of the invoice (minimum $2), **capped at $99 per job**. It covers secure card processing and payment protection through Blue Seal. You see the exact amount before you pay. If your tradesperson is on **Blue Seal Pro**, the platform portion is waived.",
    categoryId: "payments-invoices",
    audience: "client",
  },
  {
    question: "Do I pay a fee if I use e-transfer or cash?",
    answer:
      "No. The service fee only applies to **card payments through Blue Seal**. Paying by e-transfer or cash is always fee-free: just arrange it with your tradesperson and they'll mark the invoice as paid. You'll still get a receipt in the job thread.",
    categoryId: "payments-invoices",
    audience: "client",
  },
  {
    question: "Is the Blue Seal service fee refundable?",
    answer:
      "If a job is fully refunded, the service fee is returned to you as well. For a partial refund (say an adjustment for part of the work), the refund comes from your tradesperson's side and the service fee isn't returned. Refunds go back to your original card.",
    categoryId: "payments-invoices",
    audience: "client",
  },
  {
    question: "Where do I find my invoice and receipt?",
    answer:
      "Both live in the job thread. The invoice is generated from the agreed quote when the work is complete, and a receipt is saved once it's paid.",
    categoryId: "payments-invoices",
    audience: "all",
  },
  {
    question: "What does an invoice include?",
    answer:
      "Itemised line items from the agreed quote, plus tracked time, materials, and any extra charges (travel, callout, tool rental, disposal, or changes that came up on the job), with totals and any applicable tax. You review and approve the whole invoice, extras included, before you pay, so nothing appears that you haven't agreed to.",
    categoryId: "payments-invoices",
    audience: "all",
  },
  {
    question: "Can a quote include an upfront amount?",
    answer:
      "Yes. A quote can include an optional upfront amount (for materials or to hold a booking). You'll always see exactly what you're agreeing to before you accept.",
    categoryId: "payments-invoices",
    audience: "client",
  },
  {
    question: "How do I get paid as a tradesperson?",
    answer:
      "Set up **Payouts** from your account to connect a secure payouts account. Once it's set up, funds from paid invoices flow to your bank automatically.",
    categoryId: "payments-invoices",
    audience: "tradesperson",
  },
  {
    question: "Why should I keep payments on Blue Seal?",
    answer:
      "Keeping the quote, invoice, and payment in the job thread gives you a clear record if a question ever comes up, and it's what lets our team help if something goes wrong.",
    categoryId: "payments-invoices",
    audience: "all",
  },
  {
    question: "How do I clock in on a job?",
    answer:
      "Open the job's **Work order** tab and tap **Clock in** (you can also clock in straight from the **Jobs** tab). The timer runs live and the client sees it too. Once you're on the clock, a bar at the top of the app shows the running timer on every screen; tap **Clock out** there (or **Stop** on the job) when you're done and you'll land back on the job. Clocking in on a new job automatically stops any session still running on another, so only one clock runs at a time.",
    categoryId: "payments-invoices",
    audience: "tradesperson",
  },
  {
    question: "Will I be billed for time on a fixed-price job?",
    answer:
      "No. On a fixed-price job the agreed price stands. The tradesperson may still track time as a record, but it shows no charge. Extra hourly work only ever appears if you approve a **change order** for it first.",
    categoryId: "payments-invoices",
    audience: "client",
  },
  {
    question: "What is a change order?",
    answer:
      "A change order is extra work beyond the original quote, added after the job starts. The tradesperson proposes it as a flat fee or an hourly rate, and **you approve it before it's billed**. Approved change orders appear on the final invoice alongside the agreed price, so the breakdown stays clear.",
    categoryId: "payments-invoices",
    audience: "all",
  },
  {
    question: "How do I charge for travel?",
    answer:
      "Set a **travel rate** in your pricing (it can differ from your hourly rate). On an hourly job you can clock travel time separately and it bills at that rate. On a fixed-price job, travel can only be billed by proposing a change order the client approves.",
    categoryId: "payments-invoices",
    audience: "tradesperson",
  },
  {
    question: "How do I close out a finished job?",
    answer:
      "Nothing to tap: finished jobs file themselves. When a job reaches **Complete**, **Reviewed** or **Cancelled** it automatically moves off your active list into **View completed** on your dashboard. Nothing is lost: the invoice, receipt and reviews stay on the job, and you can open it from there anytime.",
    categoryId: "payments-invoices",
    audience: "all",
  },

  // ── Account & app ─────────────────────────────────────────────────────────
  {
    question: "Can I be both a client and a tradesperson?",
    answer:
      "Yes. Every tradesperson account can also hire: the client role is included automatically, so you can post a job or request a quote without setting anything up, and switch views from the account menu. If you signed up as a client and want to offer your own services, you can apply to become a verified tradesperson (cert + ID review) from your account.",
    categoryId: "account-app",
    audience: "all",
  },
  {
    question: "How do I switch between client and tradesperson views?",
    answer:
      "Use the account menu (your avatar) to switch roles. If you open a link that belongs to the other role, Blue Seal switches you to it automatically so the page makes sense.",
    categoryId: "account-app",
    audience: "all",
  },
  {
    question: "Can I get notifications on my phone?",
    answer:
      "Yes. Turn on **push notifications** from **Account → Notifications**. We'll also offer to switch it on when you create your account, and again when you come back until it's on. It's per device: your browser asks permission once, and from then on you get instant alerts (new messages, quotes, job updates) even when Blue Seal is closed. On iPhone, add Blue Seal to your home screen first, then enable push from inside the installed app. Turn it off any time from the same toggle.",
    categoryId: "account-app",
    audience: "all",
  },
  {
    question: "Can I install Blue Seal as an app?",
    answer:
      "Yes, it's a progressive web app. On iPhone use Share → Add to Home Screen; on Android use the menu → Install app; on desktop use the install icon in the address bar.",
    categoryId: "account-app",
    audience: "all",
  },
  {
    question: 'Why do I sometimes see an "Update available" banner?',
    answer:
      "When we ship an improvement or a fix, Blue Seal checks for it in the background and shows a small **Update** banner at the bottom of the screen. Tap **Update** and the app reloads onto the latest version in a second, with no need to clear your cache, hard-refresh, or reinstall. Installed apps usually update themselves quietly; the banner is there for browser tabs and for whenever you'd rather pick the moment. If a fix is important, you may see a full-screen **Update required** prompt instead; just tap **Update now** to continue.",
    categoryId: "account-app",
    audience: "all",
  },
  {
    question: "How do notifications work?",
    answer:
      "The bell shows new messages, quotes, applications, and job status changes inside the app. When you're away, we **email** you about the important stuff (new messages, quotes, invoices, job status changes, verification decisions, and invites) so you don't miss anything even without the app installed. (Busy chat threads are batched: you get one new-message email per lull, not one per line.) You can also turn on **push notifications** in Account settings for instant on-device alerts, and we use WhatsApp for a few time-critical events.",
    categoryId: "account-app",
    audience: "all",
  },
  {
    question: "I forgot my password, what do I do?",
    answer:
      "Use **Forgot password** on the sign-in screen and we'll email you a reset link from **noreply@blueseal.app**. If it doesn't arrive in a minute, check your spam or junk folder.",
    categoryId: "account-app",
    audience: "all",
  },
  {
    question: "I didn't get my verification (or reset) email, what now?",
    answer:
      "Our emails come from **noreply@blueseal.app**, so first check your spam or junk folder and mark it as **Not spam** to make sure future ones land in your inbox. Verification emails are re-sent if you trigger the action again, and you can always request a fresh password-reset link from **Forgot password**. Still nothing after a few minutes? Double-check the address you used and contact support.",
    categoryId: "account-app",
    audience: "all",
  },
  {
    question: "How do I change my account email?",
    answer:
      "Open **Account** from the menu and tap **Change email** under your email address. Enter the new address and we'll send a confirmation link to it. Your email only changes once you open that link, so the old address keeps working until then. If the new address is already tied to a Blue Seal account, you'll be told so you can use a different one.",
    categoryId: "account-app",
    audience: "all",
  },
  {
    question: "How do I update my profile or service area?",
    answer:
      "Open Account from the menu. Tradespeople can edit their bio, trades, portfolio, availability, and service area there; clients can manage their details and notification preferences.",
    categoryId: "account-app",
    audience: "all",
  },

  // ── Safety & disputes ─────────────────────────────────────────────────────
  {
    question: "What if I have a problem with a job?",
    answer:
      "Try to sort it out in the job thread first; most issues are a quick miscommunication. If you can't, contact support and our team can review the job, messages, and invoice to help reach a fair outcome.",
    categoryId: "safety-disputes",
    audience: "all",
  },
  {
    question: "How do I report a tradesperson or a client?",
    answer:
      "Contact support with the job link and a short description. We can review the thread and take action, and keeping the conversation on Blue Seal means there's always a record.",
    categoryId: "safety-disputes",
    audience: "all",
  },
  {
    question: "What should I do if someone asks me to pay off-platform?",
    answer:
      "Be cautious. Keeping payment in the job thread protects you with a clear record and lets us help if there's a dispute. If someone pushes you off-platform or asks for payment in an unusual way, pause and contact support.",
    categoryId: "safety-disputes",
    audience: "all",
  },
  {
    question: "Is my personal information safe?",
    answer:
      "We only share what a job needs. For example, your exact address stays private on public job posts until you choose to share it. See our Privacy Policy for the full details.",
    categoryId: "safety-disputes",
    audience: "all",
  },
];

export const HELP_CONTENT_SEED: HelpContentSeed = { categories, articles, faqs };
