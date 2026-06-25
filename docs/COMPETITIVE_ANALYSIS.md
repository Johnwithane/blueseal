# Blue Seal — Competitive & Pricing Analysis (2025–2026)

> **Status:** Research deliverable, compiled 2026-06-20. Companion to [`MONETIZATION.md`](../MONETIZATION.md) (which defines the as-built model) and the funding narrative bank (`docs/funding/00-narrative-bank.md`, §6 Competition).
>
> **Purpose:** Answer two questions — *who are our closest competitors*, and *how do we stay competitive on price and feature parity*. Hard figures are cited to the source the claim came from; where a vendor doesn't publish list prices, the number is a third-party estimate and is flagged as such.
>
> **Currency note:** Most US/SaaS competitors price in **USD**; Blue Seal prices in **CAD**. At ~1.36 USD/CAD this *widens* Blue Seal's price advantage for Canadian tradies — a "$59 USD" plan is ~$80 CAD. Don't compare the raw numbers without this in mind.
>
> **Verification caveat:** Vendor pricing pages (Jobber, Housecall Pro, Angi, FTC, Stripe, Bark) largely returned HTTP 403 to automated fetch. Figures below come from search snippets of those pages plus reputable 2025/2026 comparison/review sites and primary press releases. Treat quote-only vendors (ServiceTitan, FieldEdge) and lead-fee ranges as directional. A human should confirm any number before it lands in pricing copy or a pitch deck.

---

## 1. TL;DR

- **No single competitor does what Blue Seal does** (hand-verify the pro **and** run the whole job **and** price it without a percentage rake). The market splits into three lanes; Blue Seal straddles all three, which is the differentiation *and* the go-to-market challenge.
- **Closest hybrid competitor: HomeStars** (Canada, Angi-owned) — verified-pro directory + leads, national incl. Kelowna. But it's a **reviews/lead-gen directory, not a job-running tool**, and its "verified" badge is optional and self-attest-heavy.
- **Closest tool competitor: Jobber** (Canadian-founded, Edmonton) — the pro SaaS most tradies already know, with free AI Copilot. But **no client marketplace and no verification.**
- **Blue Seal's pricing is structurally sound and, if anything, *underpriced* on the subscription.** $29 CAD/mo Pro is the cheapest serious trades tool in the market, and the 5%/$99-capped client fee is far below every lead-gen and on-demand model. The capped fee is directly supported by marketplace-leakage research (Hagiu & Wright, *Management Science* 2023).
- **The real risks are not price — they're (a) AI becoming free table-stakes** (Jobber Copilot, Housecall Pro AI both bundled free), **(b) the "verified" claim being legally radioactive if overstated** (Angi's Oct-2025 settlement + the 2023 FTC HomeAdvisor case), and **(c) feature depth** vs. incumbents with 10-year head starts.
- **New (2026): a direct local competitor — bibidi (Kelowna) — has launched.** A broad local-services marketplace (~100 categories), an 8% fee on *both* sides, an *optional paid* identity badge (not cert/ID vetting), a *booking* flow (not the whole job), no AI, and no property-manager channel. It **validates** the market and sharpens our contrast (deep + verified vs broad + light) rather than threatening the niche. Full deep dive + strategy playbook: [`COMPETITOR_BIBIDI.md`](./COMPETITOR_BIBIDI.md).

---

## 2. The three competitive lanes

Blue Seal is a hybrid. Each lane has a different leader, a different business model, and a different reason it *doesn't* fully overlap with us.

| Lane | What it is | Leaders | Why it's not us |
| --- | --- | --- | --- |
| **A. Pro SaaS** (field-service / business mgmt) | Tools the tradie pays for to run their business | **Jobber, Housecall Pro, ServiceTitan**, Workiz, FieldEdge, Service Fusion | No client marketplace; **no verification**; tradie brings their own leads |
| **B. Lead-gen / reviews marketplaces** | Sell homeowner leads or reviews to pros | **Angi/HomeAdvisor, Thumbtack, HomeStars (CA), Houzz Pro, Bark, Networx, TrustedPros** | Sell *leads/visibility*, not trust or job-running; per-lead fees, shared leads, weak vetting |
| **C. On-demand task apps** | Book a vetted worker by the hour, platform takes a cut | **TaskRabbit, Handy, Jiffy (CA)** | Low-ticket odd-jobs; **percentage commission** that leaks on big jobs; ID-check not credential-verification |

**Blue Seal is the only player combining A (job-running tools) + B (a verified marketplace) + a deliberately non-percentage fee model.** That's the wedge. The flip side: we're fighting on three fronts at once.

---

## 3. Ranked closest competitors

Ranked by how much they overlap Blue Seal's *hybrid verified-marketplace-plus-tools* model.

1. **HomeStars (Canada)** — closest on paper. Angi-owned, Toronto-founded reviews + lead marketplace, **national incl. Kelowna/Okanagan**, has a "HomeStars Verified" badge (background + credit check, HST reg, license proof). *But:* badge is optional and HomeStars disclaims credential accuracy; it's a directory, not a job pipeline; monetizes pros via **pay-per-lead (~$10–$100/lead)** + a reported **~$300/mo advertising membership** (contractor-reported, not an official rate card). [HomeStars/Angi](https://go.homestars.com/angi) · [Verified badge](https://www.homestars.com/blog/introducing-homestars-verified)
2. **Jobber** — closest *tool* and the one Okanagan tradies most likely already pay for. Canadian (Edmonton), 100k+ customers, free AI "Copilot." *But:* pure SaaS, **no marketplace, no verification.** Tiers $39–$599/mo USD (annual from ~$29). [pricing](https://www.getonecrew.com/post/jobber-prices)
3. **Angi / HomeAdvisor** — the 800-lb gorilla of home-services leads; parent of HomeStars + Handy; aggressive on AI (AI Helper, Angi-in-ChatGPT). *But:* US-core (reaches Canada via HomeStars), per-lead model under heavy backlash, and **legally singed on verification** (FTC $7.2M 2023; Oct-2025 misleading-vetting settlement). [FTC order](https://www.ftc.gov/news-events/news/press-releases/2023/01/ftc-order-requires-homeadvisor-pay-72-million-stop-deceptively-marketing-its-leads-home-improvement) · [Angi settlement](https://www.consumeraffairs.com/news/angi-settles-complaints-over-misleading-marketing-101425.html)
4. **Housecall Pro** — Jobber's main pro-SaaS rival; strong AI push (CSR AI, Marketing AI, Analyst AI, fall 2025). *But:* USD pricing higher than Jobber ($59–$299+/mo), no marketplace, no verification. [pricing](https://www.housecallpro.com/pricing/)
5. **Thumbtack** — big consumer marketplace, AI-forward (in ChatGPT + Alexa), mandatory background checks. *But:* **US-only**, pure pay-per-lead with steep, rising lead costs ($35–$60 common, up to $100+), pay-even-if-no-job backlash. [lead costs](https://7ten.marketing/how-much-does-thumbtack-charge-for-leads/)
6. **Houzz Pro** — closest *blend* of SaaS + leads + strong AI (AutoMate AI: estimates, scheduling, takeoff). Operates in Canada. *But:* reno/design-skewed, lead quality complaints, ~$55–$399/mo USD. [AutoMate AI](https://www.constructionowners.com/press-release/houzz-pro-launches-automate-ai-tools-to-simplify-admin-work)
7. **TaskRabbit (CA)** — IKEA-owned, in Vancouver + 90 CA cities, ID-verified Taskers, client pays ~12–22% in fees. *But:* odd-jobs/handyman, not licensed trades; no credential vetting.
8. **Jiffy (CA)** — Intact-owned on-demand, "Jiffy Certified" (license + background + ratings). *But:* **30% (hourly) / 20% (quoted) commission** — the exact high-ticket-leakage model Blue Seal rejects; **GTA/Ottawa/Calgary only, no BC presence.** [terms](https://urbantasker.com/blog/is-jiffy-on-demand-app-good-for-contractors)
9. **TrustedPros (CA)** — flat **$49/$69/$89/mo** subscription (no per-lead), national incl. Kelowna. *But:* explicitly **does not vet pros** (screens reviews instead); a listing/bidding directory, no job tools.
10. **Bark (CA)**, **Networx (US)**, **Workiz / FieldEdge / Service Fusion / Kickserv / BuildOps** — secondary. Bark = credit-based leads, minimal vetting, runs in Canada. Networx = US per-lead. The rest = pure pro-SaaS, no marketplace/verification.

**Okanagan-specific signal:** *No BC-native, region-specific verified-trades app surfaced.* Kelowna is served only by national directories (HomeStars, TrustedPros, Houzz, Bark) + FortisBC's licensed-contractor directory. **There is no entrenched local incumbent to displace** — a real opening for a saturate-one-region playbook.

---

## 4. Pricing comparison table

> USD unless marked. Blue Seal row in **CAD**. "Take rate" = platform's cut of job value. "Verifies pro?" = real credential/ID check before going live (not a self-attested badge).

| Platform | Pro pays | Client/job fee | Take rate of job value | AI | Free trial | Verifies pro? | Canada / BC |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **Blue Seal** | **$29 CAD/mo** or $290/yr | **5% capped $99 CAD** (client; waived on Pro) | **0%** (capped fee only) | Bundled in Pro | 30-day, card req. | **Yes — cert + gov ID, manual** | **BC/Okanagan native** |
| Jobber | $39–$599/mo (annual fr. $29) | — (own payments 2.9%+$0.30) | 0% | **Copilot free**; AI Receptionist ~$99/mo | 14-day, no card | No | Yes (Edmonton) |
| Housecall Pro | $59–$299+/mo | — (2.59–2.9%+$0.30) | 0% | Marketing AI free; **CSR AI paid add-on** | 14-day | No | Yes |
| ServiceTitan | ~$245–$398/tech/mo (quote) | — | 0% | Titan Intelligence/Atlas, **paid** | None (demo) | No | Yes (enterprise) |
| Workiz | Free / $187–$270/mo | — | 0% | "Genius" paid add-ons (~$200/mo) | 7-day | No | Yes |
| Houzz Pro | ~$55–$399/mo | — (leads bundled) | 0% | **AutoMate AI bundled** | 30-day | License badge (limited) | Yes |
| Angi / HomeAdvisor | ~$250–$600/mo + **$15–$120/lead** | — | 0% (lead model) | AI Helper, Angi-in-ChatGPT | n/a | Background check; **license self-attested** | Via HomeStars |
| Thumbtack | **$35–$60/lead** (to $100+) | — | 0% (lead model) | AI search, in ChatGPT/Alexa | n/a | Background check | **US only** |
| HomeStars (CA) | ~$10–$100/lead + ~$300/mo ad tier | — | 0% (lead model) | Via Angi | n/a | **Optional** "Verified" badge | **Yes incl. Kelowna** |
| TrustedPros (CA) | **$49/$69/$89/mo** flat | — | 0% (sub model) | — | varies | **No** (screens reviews) | **Yes incl. Kelowna** |
| Bark (CA) | ~$2.35/credit, leads vary | — | 0% (lead model) | — | n/a | Minimal/self-attest | **Yes** |
| TaskRabbit (CA) | $25 CAD one-time | **~12–22%** (client) | **~12–22%** | — | n/a | ID check only | Yes (Vancouver+) |
| Jiffy (CA) | — | client pays set rate | **30% hourly / 20% quoted** | — | n/a | License + background | **No BC** (GTA/Ott/Cal) |
| Handy (CA) | — | bundled service fee | platform cut | — | n/a | "background-checked" (disputed) | Yes (Vancouver, TO) |

*Estimates flagged in §8. ServiceTitan, FieldEdge, Workiz Pay rates, HomeStars/Angi/Thumbtack lead prices, Jiffy's 30/20 split, and TaskRabbit's 12–22% are third-party-reported, not official rate cards.*

---

## 5. Where Blue Seal's price sits

**Subscription (Blue Seal Pro $29 CAD/mo):**
- **The cheapest serious trades tool in the market**, before the FX gap even counts. Jobber's cheapest is $39 USD (~$53 CAD) for a stripped Core tier; Housecall Pro starts ~$59 USD (~$80 CAD); everyone serious is $150–$600+ USD for full features. $29 CAD reads as *generous*, not cheap-and-nasty — it sits right at the ChatGPT Plus ($20 USD) / new Microsoft Copilot SMB (~$18–21 USD) anchor, which is exactly where solo-operator AI willingness-to-pay lives. [Copilot SMB](https://www.eesel.ai/blog/copilot-pricing)
- **Risk: we may be leaving money on the table.** The fee-waiver flywheel (a tradie doing ~$600/mo card volume earns the $29 back) is great for retention, but $29 is low enough that a 2027 increase to $39 (already contemplated in `MONETIZATION.md`) is defensible. Founding-rate-locked-for-life is a fine acquisition hook *if* the list price climbs behind it.

**Client service fee (5% capped $99 CAD):**
- **Far below every alternative model.** On a $3,000 job: Blue Seal $99 (3.3%) vs. TaskRabbit ~$360–$660 (12–22%) vs. Jiffy ~$600 (20%). On a $10,000 reno: Blue Seal $99 (0.99%) vs. Jiffy $2,000. The cap makes the take **regressive** — it shrinks as job value grows, which is precisely what keeps high-ticket jobs on-platform.
- **Academically the right call.** Hagiu & Wright (*Marketplace Leakage*, *Management Science* 70(3), 2023) find percentage fees *induce disintermediation in equilibrium*, and that **credence goods — they name plumbing explicitly — are the worst-hit**. Gurley's *A Rake Too Far* notes rakes above ~20% rarely survive; home-services norms sit at single digits to low-teens. Blue Seal's effective rake (~1–5%, capped) is **at the low-friction end of the entire marketplace universe.** [Gurley](https://abovethecrowd.com/2013/04/18/a-rake-too-far-optimal-platformpricing-strategy/) · [Hagiu & Wright](https://pubsonline.informs.org/doi/10.1287/mnsc.2023.4757)
- **Verification is a monetizable lever, not just cost.** A 2025 Trua consumer survey found ~60% willing to pay extra for enhanced background checks and 86% rating platform safety reputation as important (vendor-sponsored — treat as sentiment, not a controlled conversion lift). This supports charging a fee *justified by trust* rather than apologizing for it. [Trua](https://chainstoreage.com/survey-data-safety-security-online-platforms-key-consumers)

**Verdict:** Price is **not** where Blue Seal is exposed. The subscription is competitive-to-underpriced; the fee model is best-in-class on friction and is the single most defensible part of the monetization story. **Compete on price by *keeping* it this way and *saying so loudly* — not by cutting further.**

---

## 6. Where the real risk is

1. **AI is going free at the SMB tier.** Jobber's Copilot is bundled free; Housecall Pro's Marketing AI is free on all plans; both reserve *telephony/receptionist* AI as the paid up-sell. **AI-assistant-alone is no longer a differentiator** — `MONETIZATION.md` already flags this. The defensible pairing is **AI + fee-waiver + verification**, none of which the pure-SaaS players can match. Don't let Pro's pitch lead with "AI"; lead with "waive your client's fee + the trust badge that wins you the job."
2. **"Verified" is legally load-bearing — and a minefield if overstated.** Angi was penalized **twice** (FTC 2023, regulators Oct 2025) for *overstating* vetting. This is a gift: it validates genuine manual cert+ID verification as a real wedge **and** a compliance-safe one — *provided Blue Seal never overclaims.* Every "verified" surface must be precise about what was checked (cert + gov ID, by a person) and what wasn't (e.g. live insurance status, ongoing license validity). This is a help-copy + ToS discipline, not just marketing.
3. **Feature depth vs. 10-year incumbents.** Jobber/Housecall/ServiceTitan have a decade of scheduling, dispatch, payroll, QuickBooks-sync, route optimization. Blue Seal can't and shouldn't match all of it. Compete on the **verified-marketplace + job-pipeline + fair-fee** combination they structurally can't copy, not on field-service feature parity.
4. **Incumbent reach into Canada.** Angi (via HomeStars), Houzz, Bark, TaskRabbit, Handy all reach BC. None is Okanagan-*native* or runs the full job — but they have brand and SEO. The defense is regional saturation + the supply-side verification moat, executed before they notice the Okanagan.
5. **Lead-gen undercutting on acquisition, not price.** Thumbtack/Angi/HomeStars can flood a homeowner's search with cheaper-looking "free to start" options. Blue Seal's answer is *quality of match + verification + no pay-per-lead gamble for the tradie*, which is a better tradie-acquisition story than a homeowner-acquisition one. Lean into tradie-side word-of-mouth (already the $0-CAC plan).

---

## 7. Action plan — staying competitive on price & features

Prioritized. **P0 = do now / cheap & high-leverage. P1 = next quarter. P2 = watch/validate.**

### P0 — Positioning & messaging (low cost, high leverage)
- **Reframe Pro around the waiver + verification, not AI.** Update the Pro paywall, pricing page, and `src/data/help.ts` so the headline benefit is "your clients pay $0 fee + you carry the verified badge that wins the job," with AI as the third bullet. Mirrors the `MONETIZATION.md` "AI-alone is a weak sell" finding.
- **Publish a precise "What "verified" means" page** (cert + government ID, manually reviewed by a person; state what is *not* guaranteed). Turns the Angi/FTC liability into our trust asset and inoculates us against the same overclaiming charge. Add to Help Center + link from every verified badge.
- **Put the fee comparison on the pricing page.** A simple "$3,000 job: Blue Seal $99 vs. on-demand apps $360–$600" table makes the capped-fee advantage legible. This *is* the price-competitiveness story — show it.
- **State the founding-rate-locked-for-life clearly** and signal a future $39 list price, so early adopters feel the urgency and we preserve room to raise.

### P1 — Feature parity that matters (scoped, not a field-service arms race)
- **Keep AI bundled in Pro** (don't unbundle into a paid add-on the way Housecall did) — it's now table-stakes and our cost structure (receipt OCR already free for all) supports it. Parity, not premium.
- **Close the two highest-value tool gaps tradies expect from Jobber/Housecall:** (1) calendar/scheduling polish, (2) QuickBooks/accounting export. Business reports + CSV already shipped (per `MONETIZATION.md`); accounting-sync is the common switching objection.
- **Lead-quality as the anti-Thumbtack pitch:** because tradies *apply with itemized quotes* (no pay-per-lead, no shared leads, no pay-if-no-job), market this explicitly against Thumbtack/Angi's per-lead backlash. It's a feature we already have — name it.

### P1 — Pricing structure hardening
- **Resolve the open `MONETIZATION.md` questions** that affect competitiveness: annual Pro price ($290/yr is set — confirm it's marketed as "2 months free"), and whether to let tradies pass card processing to the client (true 100% net) as a toggle — a differentiator no pure-SaaS competitor frames this way.
- **Don't cut price to compete.** The data says our price is already the low-friction leader; further cuts erode the MRR that makes regional expansion legible to funders. Compete on *value shown*, not *number lowered*.

### P2 — Watch & validate
- **Monitor Angi's "Fixed Price"/pre-priced booking and Angi-in-ChatGPT** — if they push managed book-and-pay into Canada via HomeStars, that's the closest model convergence. Re-check quarterly.
- **Watch AI-native entrants** (NearU in Montreal, Block Renovation/BuildZoom in US) — pay-per-appointment + AI-qualification models could reset acquisition-cost expectations.
- **Track the BC marketplace-facilitator / GST-PST question** (`MONETIZATION.md` §8) — it directly affects whether the 5% fee can stay "5%" net or needs a tax gross-up that changes the competitive number a client sees.
- **Re-survey competitor pricing every 2 quarters** — lead costs (Thumbtack, Angi) and AI bundling shift fast; this doc's figures should be refreshed against live rate cards (several couldn't be fetched directly — see §8).

---

## 8. Confidence & what couldn't be verified

**High confidence:** the three-lane structure; that no pro-SaaS vendor verifies tradies or runs a consumer marketplace; that no BC-native verified-trades app exists; Jobber's Canadian origin + free Copilot; the FTC HomeAdvisor $7.2M (2023) and Angi Oct-2025 vetting settlements; ServiceTitan's Dec-2024 IPO; Stripe CA 2.9%+C$0.30; the Hagiu/Wright and Gurley pricing theory.

**Estimates / third-party (not official rate cards):** ServiceTitan ($245–$398/tech/mo) and FieldEdge prices (quote-only); Workiz Pay & ServiceTitan Payments processing %; Angi/HomeAdvisor and Thumbtack and HomeStars per-lead prices (none publish fixed rates); HomeStars ~$300/mo ad tier; Jiffy's 30%/20% split (one review source, conflicts with a 12–18% consumer-side figure); TaskRabbit's 12–22% combined fee; Housecall Pro CSR-AI add-on price (~$200–500+/mo, no public list price).

**Could not fully verify:** Hagiu/Wright's *quantified* leakage % (paper is theoretical; abstract + secondary summaries only — full PDF 403'd); the Trua verification-WTP survey is vendor-sponsored (sentiment, not a controlled conversion lift); whether Jiffy/TaskRabbit/Handy reach the Okanagan specifically (Vancouver confirmed; Kelowna not); exact current Jobber/Housecall/Angi/Bark prices (vendor pages 403'd to automated fetch — taken from search snippets + reputable comparison sites).

**Recommendation:** before any of these numbers go into pricing copy or a funder deck, a human should confirm the load-bearing ones against the live vendor pages.

---

## 9. The local directory landscape (Okanagan)

A scan of the Okanagan surfaces a *cluster* of local "trades directory" sites — okanagantradedirectory.ca, **okanagantradesdirectory.com**, okanagantrades.ca, okanaganlist.ca, okanaganthrive.com, theokanaganmarket.com, okanagan-local.ca — most following the identical pattern: **scrape business listings from Google/public sources → display them → let a business "claim" the listing and pay for a featured spot or ads.** A couple also run a "claim your profile" flow (the same mechanic as Blue Seal's prospects system).

**Read this correctly — it is two signals, not one threat:**

1. **The directory lane is saturated and commoditized.** Half a dozen near-identical sites exist *because the model is trivially cheap to stand up* (scrape Places, list, sell claims/ads). They compete on SEO and listing volume, not on doing anything hard. A seventh changes nothing.
2. **The lane Blue Seal actually occupies is empty.** Not one of these directories verifies cert + government ID by a person, runs the job (quote → chat → schedule → invoice → paid), does mutual reviews, or gives the pro real tools. They hand over a phone number and stop. Confirmed against the earlier finding: **no BC-native verified, *transactional* trades platform exists.**

So the crowding is entirely at the **bottom of the value stack** (discovery), where barriers are low — not where Blue Seal plays (trust + the whole transaction), which is hard and uncontested. The proliferation is actually validation that Okanagan homeowners search for "find a trade locally," plus a pile of low-quality noise Blue Seal can visibly rise above.

**The trap to avoid:** marketing Blue Seal as "another site where you claim your listing" drops it *into* the saturated pile. The scrape-and-claim mechanic (our prospects system) is fine as a *sourcing* tactic, but it cannot be the headline — every directory already does it. The headline must be **everything that happens after the claim.**

**Separation playbook (what they structurally can't copy):**
- **Real verification** — "verified" elsewhere means "paid / claimed"; here it means a person checked a ticket + government ID.
- **Run the whole job** — directories end at the intro; Blue Seal goes quote → chat → schedule → invoice → paid. This is real software, not a scrape.
- **Mutual reviews**, **no pay-per-lead / capped fee**, and **AI + business tools** on top.
- One-liner: **"A directory helps you get found. Blue Seal gets you hired, gets the job done, and gets you paid."**
- **Don't fight them on directory SEO** (low-value, contested terms) — win on trust, outcome, and word-of-mouth (a Red Seal founder vouching beats any scraper site).
- **They're a supply source, not just a rival** — their public listings are businesses the prospects system can compliantly invite into *verified* supply.

---

### Sources

Vendor pricing & comparison: getonecrew, myquoteiq, g2, housecallpro.com, schedulingkit, projul, fieldcamp.ai, softwaresuggest, serviceagent.ai, kickserv.com, itqlick, softwareconnect. Marketplaces: angi.com/faq, ftc.gov (HomeAdvisor orders 2023), consumeraffairs (Angi 2025 settlement), 7ten.marketing, pipelineon, sidehustles, help.bark.com, networx.com, homestars.com/go.homestars.com, trustedpros.ca, taskrabbit.ca, urbantasker, intact/newswire (Jiffy), handy.com. Trends/M&A: prnewswire (Jobber Copilot/AI; Housecall Pro fall-2025 AI), servicetitan.com/press (Titan Intelligence/Atlas/Pantheon 2025), cnbc/iposcoop (ServiceTitan IPO), hightechinvesting (Angi IAC spinoff), sacra (Jobber/ServiceTitan financials), marketsandmarkets/mordorintelligence/businessresearchinsights (FSM market size). Benchmarks: abovethecrowd.com (Gurley), pubsonline.informs.org (Hagiu & Wright 2023; Trust & Disintermediation), sharetribe, a16z 13 Metrics, openai.com/microsoft (AI anchors), stripe.com/en-ca, canada.ca Dept. of Finance (2024 interchange cut), chainstoreage/businesswire (Trua survey).

*Compiled by deep-research fan-out (5 angles, ~110 sources surveyed). Figures load-bearing for pricing decisions are flagged §8; refresh every two quarters.*
