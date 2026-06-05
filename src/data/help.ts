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
    description: "Get verified, win work, quote, schedule, and invoice — all in one place.",
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

Every tradesperson on Blue Seal is manually reviewed before they can take work — we check **government ID**, **trade certification**, **insurance**, and **WSIB / workers' comp** where it applies. Look for the verification badges on a profile.

Once you connect with a pro, the job lives in a single thread:

- **Chat** with photos, scoped to that one job — nothing scattered across texts and email.
- A **status board** that moves from requested → quoted → in progress → done.
- **Quotes and invoices** built right in, with receipts you can both refer back to.
- **Mutual reviews** at the end, so both sides build a reputation.

There's nothing to pay to browse or to hire — you create an account, find a pro, and go.`,
  },
  {
    slug: "create-an-account",
    categoryId: "getting-started",
    title: "Creating your account",
    excerpt: "Sign up as a client or a tradesperson — and how roles work.",
    audience: "all",
    popular: true,
    keywords: ["sign up", "register", "join", "role", "client", "tradesperson"],
    body: `Tap **Sign up** and choose how you'll use Blue Seal:

- **Client** — you're hiring. You can search pros, request quotes, and post jobs right away.
- **Tradesperson** — you're offering services. You'll go through verification before your profile goes live and you can take work.

You can hold more than one role on the same account. If you sign up as a client and later want to work as a tradesperson (or vice-versa), you can add the other role and switch between them from the account menu — your data stays on one login.

Forgot your password? Use **Forgot password** on the sign-in screen to get a reset link by email.`,
  },
  {
    slug: "switching-roles",
    categoryId: "account-app",
    title: "Switching between client and tradesperson",
    excerpt: "Hold both roles on one account and switch views in a tap.",
    audience: "all",
    keywords: ["switch role", "two roles", "client and tradesperson", "view"],
    body: `If your account has both a client and a tradesperson role, you can switch which one you're using at any time from the **account menu** (your avatar).

Switching changes what you see — the client view shows hiring tools (search, post a job, your requests), and the tradesperson view shows work tools (browse jobs, your applications, payouts). Notifications and jobs stay tied to the right role.

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

**Not sure which trade you need?** Just describe the job in the **"What do you need done?"** box — type something like *"my sink is leaking"* or *"power keeps tripping"* and we'll suggest the right trade. Tap a suggestion and it sets the filter for you.

A few tips:

- Filter by **trade** to narrow to the right specialty, and set your **location** so you only see pros who cover your area.
- Open a profile to see their verification status, portfolio, reviews, and recommendations before you reach out.
- When you find someone you like, **request a quote** — that opens a job thread with them so everything stays in one place.

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

If you described your job in search first, the title, details and urgency come **pre-filled** from what you typed — just review and tweak before sending.

That creates a **job thread** between you and the tradesperson. From there you can chat, share more photos, and receive a quote. When the quote looks right, you accept it and the job moves forward — schedule, work, invoice, and review all happen in the same thread.

Quotes can include an optional upfront amount for materials or to hold a booking; you'll always see exactly what you're agreeing to before you accept.`,
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

Your posting is shown to **verified tradespeople** in your trade and region. Each one applies with a **full itemized quote** — line items, taxes, and any upfront fee — so you're comparing real numbers, not vague estimates. On your post you can open each applicant's quote, check their profile, verification, and reviews, then **Accept** the one you want. Accepting starts the job with that pro straight away and lets the others know you've chosen someone.

Your exact address stays private until you accept a quote; the public posting only shows your general area.`,
  },
  {
    slug: "the-job-thread",
    categoryId: "getting-started",
    title: "Understanding the job thread",
    excerpt: "Chat, photos, status board, quotes and invoices — all in one place.",
    audience: "all",
    popular: true,
    keywords: ["job thread", "chat", "kanban", "status", "messages", "board"],
    body: `Every job on Blue Seal has its own thread, so nothing gets lost between texts, email, and paper.

Inside a job you'll find:

- **Chat** — message the other party, share photos, and keep a record of what was agreed.
- A **status board** — the job moves through clear stages (requested, quoted, in progress, awaiting approval, complete) so everyone knows where things stand.
- **Quote & invoice** — the numbers live right in the thread, with receipts afterward.
- **Reviews** — when the work is done, both sides can leave a review.

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

- **Government photo ID** — confirms you are who you say you are.
- **Trade certification** — your ticket / licence for the trades you list.
- **Insurance** — proof of liability coverage on file.
- **WSIB / workers' comp** — where it applies to your trade and province.

Upload clear photos or PDFs of each document in the wizard. Once you submit, our team reviews everything; you'll be notified when you're approved and your profile goes live. Until then you can finish setting up your profile, portfolio, and availability.

If something needs another look, we'll let you know what to re-upload — you won't be left guessing.`,
  },
  {
    slug: "win-work",
    categoryId: "for-tradespeople",
    title: "Winning work: requests, browsing, and applications",
    excerpt: "Two ways jobs come in — direct requests and the job board.",
    audience: "tradesperson",
    keywords: ["leads", "browse jobs", "apply", "requests", "applications", "win work"],
    body: `Once you're verified, work reaches you two ways:

1. **Direct requests** — clients find your profile and request a quote. These land as new job threads; respond quickly with a clear quote to win the job.
2. **Browse jobs** — clients post jobs to the board. Browse postings in your trade and area and **apply with a full itemized quote** (line items, taxes, optional upfront fee). The client compares quotes side by side and accepts one — so a clear, well-priced quote wins the job outright. Track everything you've applied to under **My applications**.

A complete, verified profile with a strong portfolio and good reviews wins more work — clients can see your reputation at a glance.`,
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

1. **Quote** — the tradesperson builds a quote with line items and totals. The client reviews and accepts it before any work starts.
2. **Work** — the job runs; time and expenses can be tracked against it.
3. **Invoice** — when the work is marked complete and approved, an invoice is generated from the agreed quote and any extras.
4. **Receipt** — once paid, both sides have a receipt in the job thread.

Everything is itemised, so there are no surprises — the client sees what they're paying for and the tradesperson has a clean record.`,
  },
  {
    slug: "paying-for-a-job",
    categoryId: "payments-invoices",
    title: "Paying for a job",
    excerpt: "How clients pay and where to find receipts.",
    audience: "client",
    keywords: ["pay", "payment", "card", "checkout", "receipt", "invoice"],
    body: `When your tradesperson sends an invoice, you'll see it in the job thread with a clear breakdown. You can pay securely from there, and a **receipt** is saved to the thread for both of you afterward.

Always keep payments and agreements inside the job thread — it's your record if a question ever comes up, and it's what lets us help if something goes wrong.`,
  },
  {
    slug: "getting-paid",
    categoryId: "payments-invoices",
    title: "Getting paid out (tradespeople)",
    excerpt: "Set up payouts so funds reach your account.",
    audience: "tradesperson",
    keywords: ["payout", "payouts", "stripe", "get paid", "bank", "connect"],
    body: `To receive payments through Blue Seal, set up **Payouts** from your account. This connects a secure payouts account so funds from paid invoices reach your bank.

You can return to the **Payouts** screen any time to finish setup or open your payouts dashboard. Once it's set up, paid invoices flow through automatically — no chasing cheques.`,
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

- **ID verified** — we've confirmed their government photo ID.
- **Certified** — their trade certification / licence is on file.
- **Insured** — proof of liability insurance is on file.
- **WSIB / workers' comp** — coverage is on file where their trade and province require it.

Each badge is granted only after our team reviews the actual document — there are no self-serve shortcuts. That's the whole point of Blue Seal: when you see a badge, a real person checked the paperwork behind it.`,
  },
  {
    slug: "mutual-reviews",
    categoryId: "verification-trust",
    title: "Mutual reviews",
    excerpt: "Both sides review each other — and why reviews stay hidden at first.",
    audience: "all",
    keywords: ["reviews", "rating", "stars", "feedback", "reputation", "mutual"],
    body: `When a job wraps up, **both** the client and the tradesperson can leave a review. That two-way accountability is what keeps the bar high on both sides — better clients and better pros.

Reviews are **blind until both are in** (or a short window passes), so neither side can react to the other's rating before writing their own. Once revealed, they appear on the relevant profiles and feed into the overall rating.

Honest, specific reviews help everyone — mention what went well and anything that could've been smoother.`,
  },
  {
    slug: "install-the-app",
    categoryId: "account-app",
    title: "Installing Blue Seal as an app",
    excerpt: "Add Blue Seal to your home screen for a full-screen, app-like experience.",
    audience: "all",
    keywords: ["install", "pwa", "home screen", "app", "add to home", "offline"],
    body: `Blue Seal is a **progressive web app**, so you can install it straight from your browser — no app store needed.

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
    keywords: ["notifications", "alerts", "bell", "email", "updates"],
    body: `The **bell** icon shows your in-app notifications — new messages, quote and application updates, and job status changes. Tap one to jump straight to the job it's about.

You can manage your notification preferences from your **Account** settings.`,
  },
  {
    slug: "report-a-problem",
    categoryId: "safety-disputes",
    title: "Reporting a problem or opening a dispute",
    excerpt: "What to do if a job goes wrong.",
    audience: "all",
    popular: true,
    keywords: ["dispute", "report", "problem", "complaint", "refund", "issue", "help"],
    body: `If something goes wrong on a job, first try to resolve it **in the job thread** — most issues are a miscommunication and a quick message sorts them out. Keeping the conversation in-thread also means there's a clear record.

If you can't resolve it between yourselves, **contact support** (see the Contact section of the Help Center). Our team can look at the job, the messages, and the invoice to help reach a fair outcome.

For anything involving your immediate safety, contact your local emergency services first.`,
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

If a request feels off — someone pushing you off-platform, or asking for payment in an unusual way — pause and contact support.`,
  },
];

// Keep this list broad and current. When a major feature ships, add or update
// the FAQ entries it affects (see CLAUDE.md → "Help Center & FAQ upkeep").
const faqs: FaqItem[] = [
  // ── Getting started ──────────────────────────────────────────────────────
  {
    question: "What is Blue Seal?",
    answer:
      "Blue Seal connects homeowners with **verified Canadian tradespeople** and keeps the whole job — chat, photos, quote, invoice, and reviews — in one thread. Every pro is manually checked before they can take work.",
    categoryId: "getting-started",
    audience: "all",
  },
  {
    question: "Is Blue Seal free to use?",
    answer:
      "Creating an account, searching for tradespeople, and posting a job are free. You pay for the work itself through the job thread.",
    categoryId: "getting-started",
    audience: "all",
  },
  {
    question: "Which areas does Blue Seal cover?",
    answer:
      "Blue Seal serves communities across Canada and is growing. Search by your location to see verified pros who cover your area — if there aren't many yet near you, posting a job is the best way to reach the ones who do.",
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
    question: "How is Blue Seal different from other directories?",
    answer:
      "Most sites just hand you a phone number. Blue Seal **verifies** every pro four ways (ID, certification, insurance, WSIB) and runs the **whole job** in one place — chat with photos, a status board, quotes, invoices, an AI assistant, and mutual reviews.",
    categoryId: "getting-started",
    audience: "all",
  },

  // ── Hiring a tradesperson (clients) ───────────────────────────────────────
  {
    question: "I don't know which trade I need — how do I search?",
    answer:
      "On **Find a tradesperson**, use the **\"What do you need done?\"** box and describe the job in plain words — e.g. *\"my sink is leaking\"* or *\"power keeps tripping\"*. We'll suggest the right trade; tap one to set the filter. Still unsure? **Post a job** and let verified pros tell you what's involved.",
    categoryId: "for-clients",
    audience: "client",
  },
  {
    question: "What's the difference between requesting a quote and posting a job?",
    answer:
      "Requesting a quote reaches out to one specific pro you've chosen. Posting a job lists the work so multiple verified pros in your area each apply with a full itemized quote — you compare them side by side and accept one.",
    categoryId: "for-clients",
    audience: "client",
  },
  {
    question: "How do I get the most accurate quote?",
    answer:
      "Add clear **photos** and answer the trade-specific questions in detail — the more a pro understands up front, the tighter the quote. You can always ask follow-up questions in the job thread before accepting.",
    categoryId: "for-clients",
    audience: "client",
  },
  {
    question: "Can I message a tradesperson before I commit?",
    answer:
      "Yes. Requesting a quote opens a job thread where you can chat, share more photos, and ask questions. Nothing is locked in until you accept a quote.",
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
      "Yes — each job is its own thread, so you can run several jobs (and several pros) at once and keep them cleanly separated.",
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
      "Yes — before work starts you can cancel from the job thread. If a quote has already been accepted or work has begun, talk to your tradesperson in the thread so any costs already incurred are settled fairly.",
    categoryId: "for-clients",
    audience: "client",
  },

  // ── Working as a tradesperson ─────────────────────────────────────────────
  {
    question: "How do I become a verified tradesperson?",
    answer:
      "Sign up as a tradesperson and complete the onboarding wizard — it walks you through uploading your **government ID**, **trade certification**, **insurance**, and **WSIB/workers' comp** where it applies. Our team reviews it and you're notified when you go live.",
    categoryId: "for-tradespeople",
    audience: "tradesperson",
  },
  {
    question: "How long does verification take?",
    answer:
      "Your documents are reviewed by our team. You'll be notified as soon as you're approved; if anything needs another look, we'll tell you exactly what to re-upload.",
    categoryId: "for-tradespeople",
    audience: "tradesperson",
  },
  {
    question: "Can I work before I'm verified?",
    answer:
      "You can finish setting up your profile, portfolio, and availability while you wait, but you can't take jobs or appear in search until your verification is approved. That gate is what makes the badges mean something.",
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
    question: "How many trades can I list?",
    answer:
      "You can list a primary trade plus a few secondary trades you're qualified for. List the ones you actually hold certification for — they affect which jobs you're matched to.",
    categoryId: "for-tradespeople",
    audience: "tradesperson",
  },
  {
    question: "What makes a strong profile?",
    answer:
      "Complete verification, a clear bio, a portfolio of past work, your service area and availability, and good reviews. Clients can see all of this at a glance — a complete profile wins more work.",
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
    question: "Can I track my time and expenses on a job?",
    answer:
      "Yes. You can clock time against a job and add expenses (including receipts), so the invoice reflects the real work — no separate spreadsheet needed.",
    categoryId: "for-tradespeople",
    audience: "tradesperson",
  },

  // ── Verification & trust ──────────────────────────────────────────────────
  {
    question: "How do I know a tradesperson is legit?",
    answer:
      "Every pro is manually reviewed before going live — we check government ID, trade certification, insurance, and WSIB/workers' comp where it applies. The badges on a profile show what's been verified.",
    categoryId: "verification-trust",
    audience: "all",
  },
  {
    question: "What do the verification badges mean?",
    answer:
      "**ID verified** = government photo ID confirmed. **Certified** = trade certification/licence on file. **Insured** = liability insurance on file. **WSIB** = workers' comp coverage on file where required. Each is granted only after our team reviews the actual document.",
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
      "Reviews are tied to real completed jobs between verified accounts, and they're mutual — both sides are accountable. That makes them far harder to game than open, anonymous ratings.",
    categoryId: "verification-trust",
    audience: "all",
  },

  // ── Quotes, invoices & payments ───────────────────────────────────────────
  {
    question: "How does paying for a job work?",
    answer:
      "Your tradesperson sends an invoice in the job thread with a clear breakdown. You pay securely from there, and a receipt is saved to the thread for both of you.",
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
      "Itemised line items from the agreed quote, plus any approved extras (such as tracked time or materials), with totals and any applicable tax. Nothing should appear that you haven't seen and agreed to.",
    categoryId: "payments-invoices",
    audience: "all",
  },
  {
    question: "Can a quote include an upfront amount?",
    answer:
      "Yes — a quote can include an optional upfront amount (for materials or to hold a booking). You'll always see exactly what you're agreeing to before you accept.",
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
      "Keeping the quote, invoice, and payment in the job thread gives you a clear record if a question ever comes up — and it's what lets our team help if something goes wrong.",
    categoryId: "payments-invoices",
    audience: "all",
  },

  // ── Account & app ─────────────────────────────────────────────────────────
  {
    question: "Can I be both a client and a tradesperson?",
    answer:
      "Yes. You can hold both roles on one account and switch between them from the account menu — your data stays on one login.",
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
    question: "Can I install Blue Seal as an app?",
    answer:
      "Yes — it's a progressive web app. On iPhone use Share → Add to Home Screen; on Android use the menu → Install app; on desktop use the install icon in the address bar.",
    categoryId: "account-app",
    audience: "all",
  },
  {
    question: "How do notifications work?",
    answer:
      "The bell icon shows new messages, quote and application updates, and job status changes — tap one to jump to the job. You can manage your preferences in Account settings.",
    categoryId: "account-app",
    audience: "all",
  },
  {
    question: "I forgot my password — what do I do?",
    answer:
      "Use **Forgot password** on the sign-in screen and we'll email you a reset link.",
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
      "Try to sort it out in the job thread first — most issues are a quick miscommunication. If you can't, contact support and our team can review the job, messages, and invoice to help reach a fair outcome.",
    categoryId: "safety-disputes",
    audience: "all",
  },
  {
    question: "How do I report a tradesperson or a client?",
    answer:
      "Contact support with the job link and a short description. We can review the thread and take action — keeping the conversation on Blue Seal means there's always a record.",
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
      "We only share what a job needs — for example, your exact address stays private on public job posts until you choose to share it. See our Privacy Policy for the full details.",
    categoryId: "safety-disputes",
    audience: "all",
  },
];

export const HELP_CONTENT_SEED: HelpContentSeed = { categories, articles, faqs };
