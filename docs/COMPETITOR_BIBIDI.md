# Competitor deep dive: bibidi (bibidi.ca) + strategy playbook

> **Status:** Compiled 2026-06-25 from (a) a 25-agent deep-research fan-out (live site, App Store, Play Store, press, accelerator, founder traces) with an adversarial verification pass, and (b) a first-hand logged-in walk of the live product (customer account). Confidence is flagged per claim. Companion to [`COMPETITIVE_ANALYSIS.md`](./COMPETITIVE_ANALYSIS.md) (the broad landscape) and the pitch deck ([`src/views/PitchView.vue`](../src/views/PitchView.vue)).
>
> **Why this doc exists:** bibidi is the first *direct, local, same-thesis* competitor we've found. It post-dates the competitive analysis above. This is the read on who they are, why their arrival is good news, and exactly how a 2-person, zero-burn team turns a funded local rival into an advantage.

---

## 1. Bottom line

bibidi is a **Kelowna-built, broad local-services marketplace** ("trusted local help": cleaning, tutoring, pet care, beauty, photography, light handyman, plus product sellers and business listings). It is genuinely engineered (custom React app, native iOS + Android, Stripe Connect escrow, ~400 onboarded providers) and locally visible ("Best of Kelowna" awards, ambassador street marketing). It launched publicly **May 2026**.

**It validates our market and then walks straight past our niche.** bibidi went **broad and light**: ~100 categories, an *optional paid identity badge* (not a certification check), an **8% fee charged to both sides**, and a *booking* flow rather than a managed *job*. It has **no AI, no whole-job pipeline, and no property-manager / B2B channel.** Those are not features they're missing; they're roads they chose not to take, and can't easily turn onto without abandoning the frictionless free-to-list growth that is their whole current strategy.

Blue Seal is the inverse bet: **trades-deep, hand-verified (cert + government ID), the entire job in-app, a fair capped one-sided fee, AI in every step, and a property-manager dispatch lane.** Same town, opposite strategy. The two roads do not converge.

**For the raise:** a competitor with real local supply and real burn just proved demand is real, and we are the lean, focused, zero-burn team positioned to own the high-trust slice they structurally can't reach. That is a *stronger* story than "no competitors," not a weaker one.

---

## 2. What bibidi is (confirmed, primary-source)

| Dimension | Finding | Confidence |
| --- | --- | --- |
| **Model** | Two-sided local-commerce marketplace: hireable services + physical products + business profiles. Search → message → book → pay in-app → review. | High (FAQ, App Store, live site) |
| **Breadth** | ~100 categories spanning tutoring, pet care, beauty/spa, wellness (chiropractic, massage, yoga), creative (photography, copywriting, DJ), plus home/trade categories. Trades is *one tab among dozens*. | High (live `/categories`, "Page 1 of 34") |
| **Real supply skew** | Seeded providers visible: General Labour & Home Help, Math Tutoring, AI Training, Copywriting, Piano Lessons, Printing, Airbnb Management, French Tutoring, Interior Decorating, Birth Photography, Chiropractic. Gig / creative / wellness, **not** licensed electrical/plumbing/HVAC at any density. | High (live site) |
| **Verification** | "Verified" = an **optional, paid** Veriff *identity* check ($4.99 in-app badge). **No** mandatory trade certification, license, insurance, or background gate to list. The word "trusted/vetted" is marketing. | High (FAQ + App Store) |
| **Fee** | **8% to the provider AND 8% to the customer** (~16% blended take). Confirmed in live prices: every "Book for" figure is base x 1.08 ($45 → $48.60, $20 → $21.60, $750 → $810, $325 → $351). | High (FAQ, App Store, live prices) |
| **Other monetization** | Optional in-app purchases only: "Monthly Classified Listing" **$7.99/mo**, "Identity Verification" **$4.99**. Free to join/list. No required subscription. No fee cap found. | High (App Store) |
| **Payments** | Stripe Connect escrow: funds authorized at booking, released on completion; first payout delayed 7-14 days. | High (FAQ) |
| **Job depth** | A *booking*, not a job. Logged-in dashboard = Active / In progress / Completed **bookings**. No kanban, no quote pipeline, no auto-invoicing, no change-orders, no scheduling depth observed. | High (logged-in walk) + inference |
| **AI** | None advertised at the platform level. The only "AI" is a provider *offering* AI training as a service. | Medium (absence of evidence) |
| **Property managers / B2B** | **Zero** mention across homepage, FAQ, App Store, press, founder interview. A provider sells "Airbnb Management" and there's a "Property Services" category, but there is **no PM-facing dispatch, roster, or commission product.** | High (exhaustive absence) |
| **Surfaces** | Custom React SPA (Rolldown bundler) + owned Node/Express API on Vercel + Cloudinary media + **native iOS (v1.0 Dec 2025) and Android**. Not no-code. | High (header/DOM/network inspection, App Store) |
| **Geography** | Kelowna / Central Okanagan only. "Made in Kelowna, BC." "Expanding across Canada" is aspirational; there's a "Bring bibidi to my city" request form. | High (footer, App Store) |
| **Traction signal** | Public launch May 14 2026 with "500+" providers; ~404 live profiles via their API. **One** 5.0 App Store rating. No Reddit/Trustpilot/BBB/Glassdoor footprint. Supply-heavy, demand essentially unproven. | High (App Store + API + search) |

### Company (lower confidence, flagged)
- **Founders:** Tiffani Hardie (Founder/CEO; also runs interiors business "Frame & Furnish", which is the iOS App Store seller) + Kylee Wilson (Co-founder, community partnerships). *(High.)*
- **Age:** ~1 year. Guerrilla marketing mid-2025; app v1.0 Dec 2025; launch May 2026. *(High.)*
- **Accelerator:** Accelerate Okanagan (non-dilutive mentorship; won a Demo Day pitch award). *(High.)*
- **Headcount:** ~5 core paid (2 founders + a few devs) plus a volunteer "ambassador" street team. The **"11 employees"** figure is **unverified** and likely conflates paid staff with ambassadors (LinkedIn was gated). *(Medium/low.)*
- **Funding:** **No disclosed raise.** No Crunchbase round, named investor, or IRAP/SR&ED trace. Inference: **bootstrapped / founder-funded**, possibly cross-subsidized by the founder's interiors business. *(Inference.)*
- **Governance oddity:** iOS seller is a numbered BC company; the Google Play developer is "BIBIDI PTE. LTD." (a Singapore-style entity). Relationship unexplained. Minor diligence flag. *(Unverified.)*
- **Burn read:** a multi-surface native build + small paid team + heavy offline marketing + near-zero revenue implies real monthly burn and a launch clock. We should **not** assert a dollar figure as fact. The defensible point is directional: *they have burn and a clock; we don't.*

---

## 3. Why bibidi's arrival is good news (read this before reacting)

1. **It validates the thesis with money behind it.** Someone else looked at the Okanagan and bet a real team + a native-app build that residents want a trusted local-services marketplace. That de-risks the *market* question every investor asks. Our deck can now say "the market is validated" and point at a live, funded, award-winning local example instead of arguing from first principles.
2. **It chose the easy half and skipped the hard half.** Broad + light verification + an 8% both-sides rake is the *cheap-to-stand-up* play (more categories = faster GMV optics; no vetting = fast onboarding). The hard, defensible half (real credential verification, the whole job, B2B dispatch) is exactly where we already are. They picked breadth; we picked depth. Depth is the moat.
3. **It draws the contrast for us.** "Why are you different?" is now answerable with a concrete local foil, not a hypothetical. Broad vs deep. Optional ID badge vs hand-checked cert + government ID. A booking vs the whole job. 8% on both sides vs a capped fee on one. Their existence makes our positioning *legible*.
4. **It is a supply scout.** Their ~400 providers are public. The ones that are actual licensed trades are pre-qualified leads for *verified* Blue Seal supply (compliantly, via our prospects flow). They are doing some of our top-of-funnel sourcing in our own city.

---

## 4. Edge cases where we are structurally more competitive (ranked)

These are the seams to press in marketing, in the deck, and in product. Each is grounded in a confirmed bibidi fact.

1. **Trust rigor (highest leverage).** bibidi's "verified" is an optional, paid identity badge. Ours is **mandatory, hand-checked trade certification + government ID before a profile goes live.** In a market whose entire pain is "can I trust this stranger in my home on a $10k job," a paid identity sticker is not the same product. Press this relentlessly, and (per the Angi/FTC lesson in `COMPETITIVE_ANALYSIS.md` §6) keep our own "verified" claim precise so it stays a trust asset, not a liability.
2. **The whole job vs a booking.** They orchestrate a transaction (book, hold funds, release). We run quote → chat → kanban → schedule → change-orders → auto-invoice → mutual review. For multi-visit, multi-stage, licensed-trade work, a booking app is thin. This is real software depth they'd have to build on top of a consumer-one-off architecture.
3. **Fee fairness.** Their customer pays a visible **+8% markup** and their provider eats **8%** (~16% blended). Ours is **5%, capped at $99, on one side, waived entirely on Pro.** On a $3,000 job: bibidi customer pays ~$240 more *and* the pro loses ~$240; Blue Seal is $99, or $0 on Pro. Cheaper, one-sided, capped, honest.
4. **Property-manager B2B lane (the moat they can't reach).** bibidi has no PM channel and no path to one without abandoning frictionless free-to-list supply. Our Property Manager mode (trusted-trades recruitment, magic-link brokered dispatch, residual commission, future multi-property paid tier) is a two-sided acquisition engine *and* a B2B product on a base we already own. See [`.claude/plans/ok-so-we-have-valiant-kazoo.md`](../.claude/plans/ok-so-we-have-valiant-kazoo.md).
5. **AI in the job.** They advertise none. We have context-aware drafting, quoting, invoice notes, receipt OCR. Same job surface, more leverage per pro.
6. **Vertical focus vs horizontal dilution.** A piano teacher, a dog walker, and a Red Seal electrician have nothing in common except a transaction. Serving all of them means serving none of them deeply. We are built for the regulated-trades trust bar; they are a handyman-and-helpers app wearing "trades" as one of a hundred tabs.
7. **Capital structure (the one money can't copy).** They carry a multi-surface build, a paid team, marketing spend, and a launch clock against near-zero revenue. We carry ~$0 burn and a finished product. They must convert demand fast or raise; we can iterate indefinitely and pick the profitable niche. **Agility and zero burn are the advantage their funding can't neutralize.**

---

## 5. The white space we own

Across every Canadian player surveyed, the intersection of three axes is **empty**:

- **(a) Hand-verified cert + government-ID identity** — nobody does it (HomeStars is closest but no government ID; Jiffy gates on insurance/background, not cert+ID; bibidi gates on nothing mandatory).
- **(b) Full in-platform job orchestration** — only Jiffy and partly Angi run the job; SaaS tools just sell software; directories hand off and disclaim.
- **(c) A property-manager-facing verified-supply channel** — PM software does work orders against the PM's *own* unvetted vendors; consumer marketplaces target homeowners, not PMs.

**Blue Seal is the only Canadian platform sitting in all three at once.** That triple intersection is the durable position. bibidi can't enter it without two strategic U-turns (mandatory vetting kills their onboarding velocity; a B2B product is a different architecture). That makes it a moat, not a feature gap.

**One-liner for any audience:**
> bibidi is the Okanagan's "book any local help" app: broad, lightly vetted, one-off bookings. Blue Seal is the verified-trades operating system: hand-checked pros, the whole job managed, and the only platform built to let property managers dispatch trades they trust. They optimized for supply velocity. We optimized for trust and job ownership.

---

## 6. How to exercise agility + zero burn (concrete plays)

The user's instinct is right: agility and ~$0 burn are our sharpest weapons. Ways to actually spend that advantage rather than just hold it.

- **Out-iterate, don't out-spend.** We can ship a feature in days that a 5-person, three-surface team needs a sprint and a release cycle for. Pick the seams they can't quickly match (Property Manager mode, AI job tools, the precise "what verified means" trust page) and ship them while they're managing app-store review queues.
- **Let them pay to educate the market, then convert the high-value tail.** Their street marketing and "Yellow Man" campaign teach Kelowna that a local services app exists. We don't need to outspend that. We need to be the obvious upgrade for the *trust-sensitive, high-ticket* jobs (licensed trades, renos, anything where a homeowner is scared) that a both-sides-8% booking app under-serves.
- **Own the B2B flank they're not even looking at.** Property managers, realtors, and landlords are a supply-and-demand acquisition channel bibidi has no product for. Land a handful of PMs and each one brings their trusted trades (supply) and emails jobs to their clients (demand). That's a growth loop with no ad spend, on ground they've ceded.
- **Weaponize zero burn in the raise narrative.** "A funded local competitor exists and is burning to buy demand; we have the finished product and no burn clock, so the same $150K buys us *demand* directly instead of *survival*." Their burn is our talking point.
- **Recruit from their verified-trade providers, compliantly.** Their licensed-trade listings are public and pre-interested in a local app. Our prospects system can invite them into *real* verified supply, where they get the whole-job toolkit and a fair fee instead of an 8% both-sides rake.
- **Stay precise and senior, not reactive.** Don't chase their 100 categories. Don't drop our fee to "beat" their 8% (we already win on structure). Don't overclaim "verified." The discipline is the moat: depth, honesty, focus.

---

## 7. Watch list (re-check quarterly, or on any signal)

1. **A bibidi raise or grant.** A seed round or IRAP/SR&ED resets the burn-clock asymmetry. Highest-impact thing to watch.
2. **A pivot toward verification or trades-depth.** If they start mandating cert/license checks or building job-management depth, the contrast narrows. Watch their changelog / App Store release notes.
3. **A B2B / property-manager move.** The only adjacent signal is a podcast framing them as "the Uber of home management." Confirm whether that's host hyperbole or a roadmap leak.
4. **Real consumer traction** beyond "500+ providers / 1 rating": downloads, bookings, GMV, retention. Supply-first only matters if demand follows.
5. **Geographic expansion** out of Kelowna (their "Bring bibidi to my city" mechanism).

---

## 8. What to hand investors (and what not to)

**Safe to state (confirmed):** Kelowna-built local-services marketplace; ~100 categories; 8% to both sides; optional paid ID badge, not a certification check; native apps; launched 2026; a booking flow, not a managed job; no AI; no property-manager channel.

**Keep soft / do NOT assert as fact in the deck:** their exact headcount ("11" is unverified), any specific burn or runway figure, the Singapore-entity implication, and any claim about their finances. Make the agility/burn argument about **our** hard numbers (2 people, ~$0 burn, product shipped) and characterize them only via confirmed structural facts. That is both fairer and stronger.

The deck change (this session) names bibidi as the validating local competitor, adds the broad-vs-deep contrast, adds an "unfair advantage" beat (lean + zero burn + focus), and surfaces Property Manager mode as a growth line and a go-to-market moat.

---

## 9. Sources & method

Live `bibidi.ca` (home, `/categories`, `/login`, logged-in `/dashboard`), `bibidi.ca/api/profiles`, FAQ, support/terms, Apple App Store (id6755289614) and Google Play (com.bibidilocal.app) listings, Accelerate Okanagan, local press, and founder traces. Gathered by a 25-agent research fan-out (55 raw findings, 18 adversarially verified) plus a first-hand logged-in walk on 2026-06-25. Dollar/headcount/burn figures for bibidi are estimates or unverified and are flagged as such; structural and pricing facts are primary-source confirmed.
