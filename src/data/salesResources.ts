// The sales-rep resource hub content (rendered at /sales/resources). Hardcoded
// like the Help Center seed: editing it is a deliberate code change that goes
// through review. Markdown bodies, rendered by MarkdownProse. Keep copy
// qualitative and accurate to what's actually live; no em dashes (house style).

export interface SalesResource {
  /** Stable, unique, kebab-case. */
  slug: string;
  title: string;
  /** One-line summary shown under the title. */
  summary: string;
  /** Markdown body. */
  body: string;
}

export const SALES_RESOURCES: SalesResource[] = [
  {
    slug: "how-it-works",
    title: "How the rep program works",
    summary: "Referral and region ownership, and the 10% you earn for the life of every tradesperson.",
    body: `
Every rep gets a personal **referral code and link**. You can also be assigned one or more **regions** (a set of postal areas).

**Who you own.** A tradesperson belongs to the rep whose code they used at signup. If they did not use a code, they belong to the rep who owns their region. Referral beats region.

**What you earn.** A flat **10%** of the Blue Seal revenue your tradespeople generate, for the life of the tradesperson while you are active. That means 10% of their Blue Seal Pro subscription, plus 10% of the platform portion of the service fee on every job they get paid for.

**Getting paid.** Your balance pays out automatically on the 1st of each month to your connected bank account, once it clears the $50 minimum. A smaller balance rolls over. Refunds and chargebacks are netted out of your balance.
`.trim(),
  },
  {
    slug: "signing-people-up",
    title: "Signing tradespeople up",
    summary: "Share your link, what the tradesperson gets, and how they become yours.",
    body: `
Share your referral link from your dashboard. Anyone who signs up through it is attributed to you automatically and permanently.

**The incentive.** A tradesperson who signs up with your code gets their **first month of Blue Seal Pro free, with no card required**, starting the day they go live. Direct signups (no code) get the normal card trial instead. So your link is a genuinely better offer.

**What to tell them.** They are joining a verified marketplace of trades. They will need to pass certification and ID vetting before they go live (you can help vet them). Once live, clients can find them, send them jobs, and pay by card.
`.trim(),
  },
  {
    slug: "vetting",
    title: "Vetting your tradespeople",
    summary: "Review and approve the people in your territory before they go live.",
    body: `
Open **Applications** from your dashboard to see the tradespeople waiting for review in your territory or who used your code.

For each one you can see their certifications and ID. Approve them to take them live, or reject with a reason. An admin can always step in and override a decision.

Vetting well protects the marketplace and your own earnings. A tradesperson who is properly verified wins more work, and you earn on all of it.
`.trim(),
  },
  {
    slug: "getting-paid",
    title: "How you get paid",
    summary: "Connect your bank once, then the monthly payout handles the rest.",
    body: `
Go to **Earnings & payouts** and connect a bank account through Stripe. Onboarding takes about 5 minutes. You will need your bank details, address, and either your SIN or a piece of ID. You only do this once.

After that, your commission accrues automatically as your tradespeople generate revenue, and pays out on the 1st of each month once your balance reaches $50. You can see your unpaid balance and your paid history any time on the Earnings page, and open the Stripe dashboard from there for statements and tax docs.
`.trim(),
  },
  {
    slug: "pitching",
    title: "Pitching Blue Seal to a tradesperson",
    summary: "The talking points that land.",
    body: `
Lead with what is in it for them:

- **A free month of Pro, no card.** Your link gives them their first month free.
- **They keep their full invoice.** The Blue Seal service fee is paid by the client at checkout, capped per job, and waived entirely for Pro. Tradespeople net the full amount they bill.
- **They get paid fast.** Card payments settle to their bank on Stripe's standard schedule.
- **It is a verified marketplace, not a lead farm.** Every pro is ID and certification checked, so clients trust the people they find.
- **Real tools.** Per-job chat, quotes and invoices, a job board, reviews, and AI helpers for the busywork.

Then make it personal: you are their point of contact. You vet them, you are reachable, and you have a stake in their success.
`.trim(),
  },
  {
    slug: "faq",
    title: "Rep FAQ",
    summary: "Quick answers to the questions reps ask most.",
    body: `
**Do I earn on tradespeople in my region who did not use my code?**
Yes, as long as no other rep's code attributed them. Region ownership covers everyone in your territory who signed up directly.

**What happens if I am deactivated?**
Your referred tradespeople fall back to the region's rep for commission. Anything already paid to you stays yours.

**When exactly do I get paid?**
The 1st of each month, for the prior balance, once it is at least $50. Below that it rolls into the next month.

**What if a job is refunded?**
The commission on that revenue is reversed and netted out of your balance, so your earnings always reflect real, settled revenue.

**Who do I contact for help?**
Use the in-app support from your account. For anything about a specific tradesperson's vetting, start from their application.
`.trim(),
  },
];
