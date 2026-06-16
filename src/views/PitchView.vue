<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, nextTick } from "vue";
import { useSeo } from "@/composables/useSeo";
import { getPlatformStats } from "@/firebase/services/platformStats";
import type { PlatformStatsDoc } from "@/firebase/interfaces";

useSeo({
  title: "Partner Brief",
  description: "Confidential Blue Seal partner & investor brief.",
  noindex: true,
});

// SHA-256 of the access password. This is a LIGHT gate: the deck text still
// ships in the JS bundle, so it only deters casual access — fine for a targeted
// 1:1 share, not real confidentiality. To change the password: SHA-256 the new
// value (e.g. `echo -n 'newpass' | shasum -a 256`) and replace the hex below.
// Current password: "BlueSeal2026".
const PASSWORD_HASH = "9e36a1e9bf5cd3f93af34dba590f226351b628ad98769aa41d7c8a721773ccb9";
const UNLOCK_KEY = "bs_pitch_unlock";

const unlocked = ref(false);
const pw = ref("");
const pwError = ref("");
const stats = ref<PlatformStatsDoc | null>(null);

async function sha256Hex(s: string): Promise<string> {
  const buf = await window.crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function tryUnlock() {
  const hash = await sha256Hex(pw.value.trim());
  if (hash === PASSWORD_HASH) {
    sessionStorage.setItem(UNLOCK_KEY, "1");
    unlocked.value = true;
    pwError.value = "";
    await nextTick();
    initDeck();
  } else {
    pwError.value = "Incorrect password.";
  }
}

let io: IntersectionObserver | null = null;

function onScroll() {
  const el = document.getElementById("bs-progress");
  if (!el) return;
  const h = document.documentElement.scrollHeight - window.innerHeight;
  el.style.width = (h > 0 ? (window.scrollY / h) * 100 : 0) + "%";
}

function initDeck() {
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();
  io = new IntersectionObserver(
    (entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) {
          e.target.classList.add("is-visible");
          io?.unobserve(e.target);
        }
      });
    },
    { threshold: 0.12 },
  );
  document.querySelectorAll(".pitch-root .reveal").forEach((el) => io?.observe(el));
}

onMounted(async () => {
  if (sessionStorage.getItem(UNLOCK_KEY) === "1") {
    unlocked.value = true;
    await nextTick();
    initDeck();
  }
  stats.value = await getPlatformStats();
});

onBeforeUnmount(() => {
  window.removeEventListener("scroll", onScroll);
  io?.disconnect();
});

// Live-tile values: show the real count when the stats doc is loaded, else a
// sensible placeholder so the deck never renders an empty/broken stat.
function fmt(n: number): string {
  return n.toLocaleString("en-CA");
}
</script>

<template>
  <div class="pitch-root">
    <!-- GATE -->
    <div v-if="!unlocked" class="gate">
      <div class="box">
        <img src="/branding/Vertical/BlueSeal_Logo_Vert_DarkBlue.png" alt="Blue Seal" />
        <p class="gate-copy">Confidential partner brief.<br />Enter the access password.</p>
        <input
          v-model="pw"
          type="password"
          placeholder="Password"
          autocomplete="off"
          @keyup.enter="tryUnlock"
        />
        <div class="err">{{ pwError }}</div>
        <button class="btn btn--primary gate-btn" @click="tryUnlock">Unlock</button>
      </div>
    </div>

    <!-- DECK -->
    <div v-else>
      <div id="bs-progress" class="progress"></div>

      <!-- TITLE CARD -->
      <section class="band titlecard">
        <div class="container">
          <img
            class="title-logo"
            src="/branding/Vertical/BlueSeal_Logo_Vert_Full(noborder)_Small.png"
            alt="Blue Seal"
          />
          <p class="title-tag">Partner &amp; Investor Brief</p>
          <p class="title-sub">Confidential · June 2026</p>
          <div class="scrollcue">↓</div>
        </div>
      </section>

      <!-- TOP BAR -->
      <div class="topbar">
        <img src="/branding/Horizontal/BlueSeal_Logo_Hor_White.png" alt="Blue Seal" />
        <div class="tag">Confidential · Partner Brief · June 2026</div>
      </div>

      <!-- COVER -->
      <section class="band band--deep">
        <div class="container">
          <div class="grid split">
            <div>
              <div class="kicker">Partner &amp; Investor Brief</div>
              <h1 class="h-xl">Hire a tradesperson<br />you can actually trust.</h1>
              <p class="lead lead-top">
                Blue Seal hand-checks every tradesperson's certification and ID, then runs the
                whole job — quote, chat, schedule, invoice, pay — with AI built in. Live and
                validated in the Okanagan.
              </p>
              <div class="chips">
                <span class="chip"><span class="live-dot"></span><b>{{ stats ? fmt(stats.verifiedPros) : "~100" }}</b> verified pros</span>
                <span class="chip"><b>Full app</b> shipped &amp; live</span>
                <span class="chip"><b>~$0</b> to acquire a pro</span>
              </div>
              <div class="cta-row">
                <a class="btn btn--primary" href="#ask">The ask: $150K for a third →</a>
                <a class="btn btn--ghost" href="https://blueseal.app/search" target="_blank" rel="noopener">Browse the live directory</a>
              </div>
            </div>
            <div class="charwrap">
              <img class="char hero-char" src="/characters/seal-pose-toolbelt.webp" alt="Blue Seal tradesperson" />
            </div>
          </div>
          <p class="note">
            Live counts read from the platform. Other traction figures are illustrative
            placeholders for the founding-cohort milestone; projections are modelled estimates on
            stated assumptions.
          </p>
        </div>
      </section>

      <!-- PROBLEM -->
      <section class="band band--paper">
        <div class="container reveal">
          <div class="kicker">The problem</div>
          <h2 class="h-lg">Good local tradespeople are hard to find — and hard to be.</h2>
          <div class="grid g3 grid-top">
            <div class="card"><h3>Trust is a guess</h3><p>Anyone can claim a trade. Almost no one checks the certification or the ID.</p></div>
            <div class="card"><h3>Ad budgets win</h3><p>The biggest marketing spend gets the job — not the best tradesperson.</p></div>
            <div class="card"><h3>Pros run on paper</h3><p>Skilled trades juggle texts, sticky notes and spreadsheets to run a business.</p></div>
          </div>
          <div class="card quote-card">
            <img class="char quote-char" src="/characters/seal-pose-question.webp" alt="" />
            <p class="quote-text">
              <span class="hand">From the founder:</span> “Building my own home, finding a
              verifiable, genuinely good local pro was the hardest part.”
              <span class="attrib"><strong>— James Jansen, Red Seal tradesperson, 20+ years</strong></span>
            </p>
          </div>
        </div>
      </section>

      <!-- SOLUTION -->
      <section class="band band--navy">
        <div class="container reveal">
          <div class="kicker">The solution</div>
          <h2 class="h-lg">We verify the pro. Then we run the job.</h2>
          <div class="grid g3 grid-top">
            <div class="card center"><img class="char pillar-char" src="/characters/seal-scene-verified.webp" alt="" /><h3>Verified by hand</h3><p>Cert + government ID, reviewed by a person before a profile goes live.</p></div>
            <div class="card center"><img class="char pillar-char" src="/characters/seal-scene-chat.webp" alt="" /><h3>Mutual reputation</h3><p>Clients rate pros. Pros rate clients. Both build a real record.</p></div>
            <div class="card center"><img class="char pillar-char" src="/characters/seal-scene-ai.webp" alt="" /><h3>AI in every job</h3><p>Diagnose, draft replies, quote and invoice — in seconds.</p></div>
          </div>
        </div>
      </section>

      <!-- BRAND NOD -->
      <section class="band band--slim band--beige">
        <div class="container reveal">
          <div class="grid split">
            <div>
              <div class="kicker">The name is the promise</div>
              <h2 class="h-lg tight">Red Seal proves the craft. Blue Seal proves the business.</h2>
              <p class="m0">
                In the trades, a <strong>Red Seal</strong> is the national standard for your skill.
                A <strong>Blue Seal</strong> is the real certification for running the business
                behind it. Our app is that second seal, in software — helping a great tradesperson
                win and manage work like a pro. <span class="hand">James earns his Blue Seal this year.</span>
              </p>
            </div>
            <div class="charwrap"><img class="char brand-char" src="/characters/seal-scene-verified.webp" alt="" /></div>
          </div>
        </div>
      </section>

      <!-- WHY NOW -->
      <section class="band band--paper">
        <div class="container reveal">
          <div class="kicker">Why now</div>
          <h2 class="h-lg">Three things just lined up.</h2>
          <div class="grid g3 grid-top">
            <div class="card"><h3>A trades shortage</h3><p>BC needs ~52,600 more tradespeople this decade. Winning work matters more than ever to a pro.</p></div>
            <div class="card"><h3>Directory fatigue</h3><p>Homeowners distrust lead-sellers and pay-to-rank directories. They want proof, not ads.</p></div>
            <div class="card"><h3>AI is finally useful</h3><p>A solo tradesperson can now quote and handle admin in minutes, not evenings.</p></div>
          </div>
          <p class="note">Source: BC Construction Association / SkilledTradesBC, 2024.</p>
        </div>
      </section>

      <!-- PRODUCT -->
      <section id="product" class="band band--beige">
        <div class="container reveal">
          <div class="kicker">The product</div>
          <h2 class="h-lg">The whole job, from find to paid.</h2>
          <p class="lead">Not a concept — the full app is shipped and running. Four steps, one pipeline.</p>
          <div class="grid g4 grid-top">
            <div class="card center"><img class="char step-char" src="/characters/seal-scene-search.webp" alt="" /><div class="si">1</div><h3>Find</h3><p>Search verified pros, or post a job and compare quotes.</p></div>
            <div class="card center"><img class="char step-char" src="/characters/seal-scene-quote.webp" alt="" /><div class="si">2</div><h3>Quote</h3><p>Itemized quote, drafted with AI in seconds.</p></div>
            <div class="card center"><img class="char step-char" src="/characters/seal-scene-chat.webp" alt="" /><div class="si">3</div><h3>Do</h3><p>Chat, photos and scheduling on a job kanban board.</p></div>
            <div class="card center"><img class="char step-char" src="/characters/seal-scene-payout.webp" alt="" /><div class="si">4</div><h3>Get paid</h3><p>Auto-invoice, pay by card, mutual review.</p></div>
          </div>
          <!-- TODO(real assets): swap each .shot-ph for a real <img> of the app. -->
          <div class="shot-grid cols-3">
            <figure class="shot"><div class="shot-ph">📱 App screenshot — Search &amp; map of verified pros</div><figcaption>Discovery: map + list, filtered by trade &amp; location.</figcaption></figure>
            <figure class="shot"><div class="shot-ph">📱 App screenshot — Job kanban + per-job chat</div><figcaption>The live pipeline a tradesperson works each job from.</figcaption></figure>
            <figure class="shot"><div class="shot-ph">📱 App screenshot — Itemized invoice + card payment</div><figcaption>Auto-generated invoice; pay in-app by card.</figcaption></figure>
          </div>
          <h3 class="sub-h">What's built</h3>
          <div class="grid g2 eqh">
            <div class="card">
              <h4>For clients</h4>
              <ul class="clean">
                <li>Map + list search of verified pros</li>
                <li>Post a job · compare itemized quotes</li>
                <li>Per-job chat, photos, scheduling</li>
                <li>Card payment · public reviews</li>
              </ul>
            </div>
            <div class="card">
              <h4>For tradespeople</h4>
              <ul class="clean">
                <li>Verified profile · direct requests · job board</li>
                <li>Kanban + calendar · auto-invoicing · payouts</li>
                <li>Time + expense tracking · receipt scanning</li>
                <li>Bring your own clients (invite link)</li>
                <li><strong>Pro:</strong> client CRM + recurring billing</li>
              </ul>
            </div>
          </div>
          <div class="badges">
            <span><span class="pill pill--live">LIVE</span> everything above</span>
            <span><span class="pill pill--test">SWITCHING ON</span> live card payouts, push, Google reviews, insurance placement</span>
            <span><span class="pill pill--next">NEXT</span> ID automation, financing, app stores</span>
          </div>
        </div>
      </section>

      <!-- AI -->
      <section class="band band--navy">
        <div class="container reveal">
          <div class="kicker">AI — built in, not bolted on</div>
          <h2 class="h-lg">An AI partner inside every job.</h2>
          <p class="lead">It reads the job — the intake, the chat, the photos — so the help is specific, not generic.</p>
          <div class="grid g3 grid-top">
            <div class="card"><h3>Context-aware assistant <span class="pill pill--pro">PRO</span></h3><p>Ask anything about the job. It can set your schedule, clock you in, and keep private notes.</p></div>
            <div class="card"><h3>Reply for me <span class="pill pill--pro">PRO</span></h3><p>One tap drafts a reply to the client's last message, in your voice.</p></div>
            <div class="card"><h3>Draft the quote <span class="pill pill--pro">PRO</span></h3><p>Turns a job thread into an itemized, editable quote.</p></div>
            <div class="card"><h3>Write the invoice note <span class="pill pill--pro">PRO</span></h3><p>Numbers fill in from tracked time + expenses; AI writes the wrap-up.</p></div>
            <div class="card"><h3>Auto job-log <span class="pill pill--pro">PRO</span></h3><p>Catches scope changes in the chat so nothing slips before billing.</p></div>
            <div class="card"><h3>Snap a receipt <span class="pill pill--free">FREE</span></h3><p>Reads vendor, total, date, category — expenses ready for tax time.</p></div>
          </div>
          <figure class="shot" style="max-width: 780px; margin: 1.4rem auto 0;"><div class="shot-ph">📱 App screenshot — the AI assistant inside a job (diagnose · draft a reply · quote)</div><figcaption>Replace with a real capture of the in-job AI chat.</figcaption></figure>
          <p class="note">Most AI is part of Blue Seal Pro. Receipt scanning is free for every tradesperson — the on-ramp to a paid subscription.</p>
        </div>
      </section>

      <!-- LIVE STATUS / TRACTION -->
      <section class="band band--deep">
        <div class="container reveal">
          <div class="kicker"><span class="live-dot"></span> Live platform status</div>
          <h2 class="h-lg">The supply side is already built.</h2>
          <p class="lead">Most marketplaces launch empty and die at cold-start. We loaded the shelf first: verified Okanagan pros, ready before a single client arrives.</p>
          <div class="tiles grid-top">
            <div class="tile"><div class="n">{{ stats ? fmt(stats.verifiedPros) : "~100" }}</div><div class="l"><span class="live-dot"></span>verified pros</div></div>
            <div class="tile"><div class="n">{{ stats ? fmt(stats.jobs) : "—" }}</div><div class="l"><span class="live-dot"></span>jobs posted</div></div>
            <div class="tile"><div class="n">{{ stats ? fmt(stats.jobsCompleted) : "—" }}</div><div class="l"><span class="live-dot"></span>jobs completed</div></div>
            <div class="tile"><div class="n">134</div><div class="l"><span class="live-dot"></span>trades supported</div></div>
          </div>
          <div class="trade-row">
            <img class="char trade-char" src="/characters/seal-trade-plumber.webp" alt="" />
            <img class="char trade-char" src="/characters/seal-trade-electrician.webp" alt="" />
            <img class="char trade-char" src="/characters/seal-trade-carpenter.webp" alt="" />
            <img class="char trade-char" src="/characters/seal-trade-hvac.webp" alt="" />
            <img class="char trade-char" src="/characters/seal-trade-painter.webp" alt="" />
            <img class="char trade-char" src="/characters/seal-trade-roofer.webp" alt="" />
            <img class="char trade-char" src="/characters/seal-trade-mason.webp" alt="" />
            <img class="char trade-char" src="/characters/seal-trade-landscaper.webp" alt="" />
          </div>
          <p class="note">Counts read live from the platform and update as Blue Seal grows.</p>
        </div>
      </section>

      <!-- ROADMAP -->
      <section class="band band--paper">
        <div class="container reveal">
          <div class="kicker">Where we are</div>
          <h2 class="h-lg">Past the hard part — built, and validating.</h2>
          <p class="lead">The typical path from idea to scale. We've shipped the whole product and we're at validation. The raise funds the next three steps.</p>
          <div class="roadmap">
            <div class="rm-line">
              <div class="rm-node rm-done"><div class="rm-dot">✓</div><h4>Idea</h4><p>20 years in the trades; a real, lived problem.</p></div>
              <div class="rm-node rm-done"><div class="rm-dot">✓</div><h4>Design</h4><p>Architecture, brand, and flows.</p></div>
              <div class="rm-node rm-done"><div class="rm-dot">✓</div><h4>Build — full MVP</h4><p>Vetting, marketplace, AI, invoicing, payments.</p></div>
              <div class="rm-node rm-now"><div class="rm-dot">◉</div><h4>Validate</h4><p>~100 verified Okanagan pros · real paid jobs.</p><div class="rm-here">You are here</div></div>
              <div class="rm-node"><div class="rm-dot">5</div><h4>Launch &amp; grow</h4><p>Incorporate · payments live · insurance partner · Okanagan marketing.</p></div>
              <div class="rm-node"><div class="rm-dot">6</div><h4>Scale</h4><p>Kamloops → all of BC.</p></div>
              <div class="rm-node"><div class="rm-dot">7</div><h4>Expand</h4><p>Alberta · enterprise · new verticals.</p></div>
            </div>
          </div>
          <p class="note">Steps 5–7 are what the $150K funds. The product risk is behind us — this is a go-to-market raise, not a build raise.</p>
        </div>
      </section>

      <!-- MARKET (light blue) -->
      <section class="band band--sky">
        <div class="container reveal">
          <div class="kicker">The market</div>
          <h2 class="h-lg">~15,000 tradespeople in the Okanagan alone.</h2>
          <p class="lead">Big, fragmented, mostly offline — and we've barely touched it. Penetration today is under 1%.</p>
          <div class="grid g4 grid-top">
            <div class="tile tile--light"><div class="n">~15,000</div><div class="l">tradespeople in the Okanagan (SOM, est.)</div></div>
            <div class="tile tile--light"><div class="n">~23,000</div><div class="l">Thompson-Okanagan, +Kamloops</div></div>
            <div class="tile tile--light"><div class="n">~185,600</div><div class="l">tradespeople in BC (SAM, 2024)</div></div>
            <div class="tile tile--light"><div class="n">&lt;1%</div><div class="l">of the Okanagan onboarded so far</div></div>
          </div>
          <p class="note">~900 plumbers in the Okanagan — one of 134 trades we serve. BC pool: ~185,600 tradespeople in construction (BC Construction Association / StatCan, 2024); Thompson-Okanagan ≈ 12.6% of provincial construction employment (Job Bank). Okanagan figure estimated bottom-up — verify before sharing.</p>
        </div>
      </section>

      <!-- BUSINESS MODEL -->
      <section class="band band--beige">
        <div class="container reveal">
          <div class="kicker">How we make money</div>
          <h2 class="h-lg">Two simple lines of revenue.</h2>
          <div class="grid g2 eqh grid-top">
            <div class="card card--mid">
              <h3>1 · Service fee</h3>
              <p class="mb-s">A <strong>5% fee on card payments</strong>, paid by the client, <strong>capped at $99</strong>.</p>
              <div class="tablewrap flat">
                <table>
                  <thead><tr><th>Job</th><th class="num">Fee</th><th class="num">Effective</th></tr></thead>
                  <tbody>
                    <tr><td>$300 repair</td><td class="num">$15</td><td class="num">5.0%</td></tr>
                    <tr><td>$2,000 job</td><td class="num">$99</td><td class="num">capped</td></tr>
                    <tr><td>$10,000 reno</td><td class="num">$99</td><td class="num">0.99%</td></tr>
                  </tbody>
                </table>
              </div>
              <ul class="clean clean-s">
                <li>Tradesperson keeps 100% of their invoice</li>
                <li>Offline payments (cash / e-transfer) are free</li>
                <li>Pro pros: their clients pay <strong>$0</strong></li>
              </ul>
            </div>
            <div class="card card--red">
              <h3>2 · Blue Seal Pro</h3>
              <p class="mb-s"><strong>$29/mo</strong> or <strong>$290/yr</strong>, paid by the tradesperson.</p>
              <ul class="clean">
                <li>All the AI tools</li>
                <li>Waives the client service fee</li>
                <li>Featured placement on the job board</li>
                <li>Client CRM + recurring billing</li>
                <li>Business reports + CSV for tax time</li>
              </ul>
              <p class="note note-tight">The cap is deliberate: a flat 12% would cost $1,200 on a $10k job, so pros take it offline. Capping at $99 keeps big jobs on the platform. Pro turns lumpy fees into predictable MRR.</p>
            </div>
          </div>
        </div>
      </section>

      <!-- UNIT ECONOMICS -->
      <section class="band band--navy">
        <div class="container reveal">
          <div class="kicker">Unit economics</div>
          <h2 class="h-lg">Profitable per pro, at ~$0 to acquire one.</h2>
          <div class="tiles grid-top">
            <div class="tile"><div class="n">$348</div><div class="l">revenue / yr (Pro at $29/mo)</div></div>
            <div class="tile"><div class="n">~$50</div><div class="l">cost / yr (Stripe + Firebase)</div></div>
            <div class="tile"><div class="n">~$300</div><div class="l">contribution / pro / yr</div></div>
            <div class="tile"><div class="n">~$0</div><div class="l">cash CAC today</div></div>
          </div>
          <div class="card quote-card">
            <img class="char quote-char" src="/characters/seal-pose-perfect.webp" alt="" />
            <p class="quote-text">
              Pros come from word-of-mouth plus a <strong>free professional headshot</strong> (James
              is a photographer). That headshot is both the gift that wins the pro and the content
              that fills our social feed and homepage. Acquisition and marketing in one move.
            </p>
          </div>
          <!-- TODO(real assets): drop real founder/tradesperson headshots + a social-feed grab here. -->
          <div class="shot-grid cols-3">
            <figure class="shot"><div class="shot-ph">📷 Photo — founding tradesperson headshot</div><figcaption>James-shot portrait — drop a real founder headshot here.</figcaption></figure>
            <figure class="shot"><div class="shot-ph">📷 Photo — headshot + their trade</div><figcaption>The same set that seeds the social feed.</figcaption></figure>
            <figure class="shot"><div class="shot-ph">📷 Photo — social post / feed grid</div><figcaption>A real Instagram/feed grab once posts are live.</figcaption></figure>
          </div>
        </div>
      </section>

      <!-- COMPETITION -->
      <section class="band band--paper">
        <div class="container reveal">
          <div class="kicker">Competition</div>
          <h2 class="h-lg">Tools, or leads, or reviews. Nobody does all three — verified.</h2>
          <p class="lead">Everyone owns one slice of the job. None of them verify the pro, run the work, and price it fairly.</p>
          <div class="tablewrap grid-top">
            <table>
              <thead><tr><th>Who</th><th>Model</th><th>What's missing</th></tr></thead>
              <tbody>
                <tr><td><strong>Word of mouth / DIY</strong></td><td>The status quo</td><td>No verification, no record, no recourse</td></tr>
                <tr><td><strong>Jobber / Housecall Pro</strong></td><td>Pro SaaS, $39–599/mo</td><td>No client marketplace, no verification</td></tr>
                <tr><td><strong>Angi / Thumbtack</strong></td><td>Sells leads, $15–150 each</td><td>Sells leads, not trust</td></tr>
                <tr><td><strong>Jiffy</strong></td><td>12–18% commission</td><td>Low-ticket only; leaks on big jobs</td></tr>
                <tr><td><strong>HomeStars</strong></td><td>Reviews directory</td><td>No real cert/ID check; no job tools</td></tr>
                <tr class="tstrong"><td>Blue Seal</td><td>Capped fee + Pro</td><td>Verified · AI · high-ticket-friendly · both sides rated</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <!-- GO TO MARKET -->
      <section class="band band--beige">
        <div class="container reveal">
          <div class="kicker">Go-to-market</div>
          <h2 class="h-lg">Win one city. Then copy-paste.</h2>
          <div class="grid split grid-top">
            <div>
              <div class="step"><span class="si">1</span><p class="m0"><strong>Build verified supply first</strong> — the marketplace is full before we spend on demand.</p></div>
              <div class="step"><span class="si">2</span><p class="m0"><strong>Pour in demand</strong> — paid client acquisition onto a stocked shelf.</p></div>
              <div class="step"><span class="si">3</span><p class="m0"><strong>Saturate the Okanagan</strong>, prove the playbook, then repeat.</p></div>
              <div class="region-pills">
                <span class="pill pill--next">Okanagan</span><span class="pill pill--next">Kamloops</span><span class="pill pill--next">BC</span><span class="pill pill--next">Alberta</span><span class="pill pill--next">Canada</span>
              </div>
            </div>
            <div class="grid loops">
              <div class="card"><h4>Free loop 1 — bring your own client</h4><p class="m0">A pro invites their existing customer by link. A real client, acquired at $0.</p></div>
              <div class="card"><h4>Free loop 2 — Pro waives the fee</h4><p class="m0">A Pro pro is cheaper to hire. That's a built-in referral engine.</p></div>
            </div>
          </div>
        </div>
      </section>

      <!-- WHERE IT GROWS -->
      <section class="band band--paper">
        <div class="container reveal">
          <div class="kicker">Where it grows</div>
          <h2 class="h-lg">Three more revenue lines on a base we already own.</h2>
          <p class="lead">Each turns the verified audience we've earned into new revenue, with a real benchmark behind it. We're building the first — insurance — right now.</p>
          <div class="grid g3 eqh grid-top">
            <div class="card">
              <div class="bignum">~$135 / pro / yr</div>
              <h3 class="mt-s">Insurance <span class="pill pill--test">IN BUILD NOW</span></h3>
              <p>Solo trades pay ~$900/yr for liability cover. We already verify it — and we're setting up placement right now, earning ~15% commission (or a ~$45 flat affiliate fee). 10% of 15,000 Okanagan pros ≈ a six-figure line locally; BC is ~12× larger.</p>
              <p class="src">Live this year. Run in Canada today by Zensurance, Foxquilt, APOLLO.</p>
            </div>
            <div class="card">
              <div class="bignum">$40 / seat / mo</div>
              <h3 class="mt-s">Enterprise &amp; dispatch <span class="pill pill--next">NEXT</span></h3>
              <p>Team accounts billed per seat — a 5-person shop is ~$2,400/yr. We bill in CAD and undercut the incumbents' US-dollar pricing.</p>
              <p class="src">ServiceTitan: ~$245–398/tech/mo · $961M revenue · 70% margin (public).</p>
            </div>
            <div class="card">
              <div class="bignum">52,600 needed</div>
              <h3 class="mt-s">Apprenticeship pathway <span class="pill pill--pro">MISSION</span></h3>
              <p>BC needs ~52,600 more tradespeople this decade. We pair journeymen with apprentices toward their Red &amp; Blue Seal — our future supply, and a moat.</p>
              <p class="src">SkilledTradesBC: ~47,000 apprentices registered.</p>
            </div>
          </div>
          <p class="note"><strong>Insurance is in build now</strong> (live this year) and is modelled into the projection below alongside enterprise; apprenticeship is a supply/mission play (revenue later). Sources: BC Construction Association / SkilledTradesBC 2024; ServiceTitan FY26 filing; Canadian insurtech affiliate benchmarks.</p>
        </div>
      </section>

      <!-- PROJECTIONS -->
      <section class="band band--beige">
        <div class="container reveal">
          <div class="kicker">Projections <span class="kicker-sub">· illustrative, 5-year</span></div>
          <h2 class="h-lg">Modest today. The model compounds.</h2>
          <p class="lead">The marketplace alone gets us to ~$2M. Insurance and per-seat enterprise take it toward eight figures.</p>
          <div class="schart grid-top">
            <div class="sbar"><div class="val">~$225K</div><div class="stack"><div class="seg seg-mkt" style="height:32px"></div></div><div class="lab">Y1<br />Okanagan</div></div>
            <div class="sbar"><div class="val">~$785K</div><div class="stack"><div class="seg seg-mkt" style="height:54px"></div><div class="seg seg-ins" style="height:6px"></div></div><div class="lab">Y2<br />+Kamloops</div></div>
            <div class="sbar"><div class="val">~$2.7M</div><div class="stack"><div class="seg seg-mkt" style="height:89px"></div><div class="seg seg-ins" style="height:6px"></div><div class="seg seg-ent" style="height:16px"></div></div><div class="lab">Y3<br />+BC</div></div>
            <div class="sbar"><div class="val">~$6.5M</div><div class="stack"><div class="seg seg-mkt" style="height:132px"></div><div class="seg seg-ins" style="height:9px"></div><div class="seg seg-ent" style="height:32px"></div></div><div class="lab">Y4<br />BC+AB</div></div>
            <div class="sbar"><div class="val">~$13.8M</div><div class="stack"><div class="seg seg-mkt" style="height:183px"></div><div class="seg seg-ins" style="height:14px"></div><div class="seg seg-ent" style="height:53px"></div></div><div class="lab">Y5<br />BC+AB</div></div>
          </div>
          <div class="legend">
            <span><i class="i-mkt"></i>Marketplace</span><span><i class="i-ins"></i>Insurance</span><span><i class="i-ent"></i>Enterprise (per-seat)</span>
          </div>
          <div class="tablewrap mt-m">
            <table>
              <thead><tr><th>Metric</th><th class="num">Today</th><th class="num">Y1</th><th class="num">Y2</th><th class="num">Y3</th><th class="num">Y4</th><th class="num">Y5</th></tr></thead>
              <tbody>
                <tr><td>Active tradespeople</td><td class="num">100</td><td class="num">1,000</td><td class="num">3,000</td><td class="num">8,000</td><td class="num">18,000</td><td class="num">35,000</td></tr>
                <tr><td>Marketplace ARR (Pro + fees)</td><td class="num">~$25K</td><td class="num">~$225K</td><td class="num">~$750K</td><td class="num">~$2.2M</td><td class="num">~$5.0M</td><td class="num">~$10.1M</td></tr>
                <tr><td>Insurance referral ARR</td><td class="num">—</td><td class="num">—</td><td class="num">~$35K</td><td class="num">~$125K</td><td class="num">~$330K</td><td class="num">~$790K</td></tr>
                <tr><td>Enterprise per-seat ARR</td><td class="num">—</td><td class="num">—</td><td class="num">—</td><td class="num">~$385K</td><td class="num">~$1.2M</td><td class="num">~$2.9M</td></tr>
                <tr class="tstrong"><td>Total ARR</td><td class="num">~$25K</td><td class="num">~$225K</td><td class="num">~$785K</td><td class="num">~$2.7M</td><td class="num">~$6.5M</td><td class="num">~$13.8M</td></tr>
              </tbody>
            </table>
          </div>
          <p class="note">For scale: ServiceTitan does ~$961M revenue at ~70% margin (public, ~$6.6B market cap); Housecall Pro ~$600M ARR; Thumbtack ~$400M — the category supports eight–nine figures, and this is a fraction of that ceiling. Assumptions (illustrative): 30% Pro conversion; insurance in build now, modelled conservatively from Y2 (~10% of pros, ~$120/insured/yr, affiliate → embedded, needs a brokerage licence); enterprise per-seat from Y3 (~$40/seat/mo, teams a minority of accounts); ~70% gross margin. Swap in live figures before any meeting.</p>
        </div>
      </section>

      <!-- TEAM -->
      <section class="band band--navy">
        <div class="container reveal">
          <div class="kicker">Team</div>
          <h2 class="h-lg">Two brothers, co-CEOs, with the skills this needs.</h2>
          <div class="grid g2 grid-start grid-top">
            <div class="card member">
              <img class="avatar" src="/pitch/jamesjansen.jpg" alt="James Jansen" />
              <div>
                <h3 class="member-name">James Jansen</h3>
                <p class="member-role">Co-CEO · Product, Sales &amp; Marketing</p>
                <p class="m0">Red Seal tradesperson, 20+ years; earning his Blue Seal this year. Lived the problem building his own home. Leads product, sales and marketing — and shoots the founding headshots (he's a professional photographer).</p>
              </div>
            </div>
            <div class="card member">
              <img class="avatar" src="/pitch/johnnyjansen.jpg" alt="Johnny Jansen" />
              <div>
                <h3 class="member-name">Johnny Jansen</h3>
                <p class="member-role">Co-CEO · Technology &amp; Brand</p>
                <p class="m0">Builds and maintains the platform, and owns the brand. Award-winning creative director — work with Disney, LEGO and Ocean Wise. Prism Prize winner, Juno nominee.</p>
              </div>
            </div>
          </div>
          <div class="card seat-card">
            <h3>The seat we're filling — you</h3>
            <p class="m0">An equal third partner to incorporate the company and own <strong>legal + finance</strong>: structure, the tax / FINTRAC questions, and the books. Trade + growth + finance = a complete founding team.</p>
          </div>
        </div>
      </section>

      <!-- THE ASK -->
      <section id="ask" class="band band--deep">
        <div class="container reveal">
          <div class="kicker">The ask</div>
          <h2 class="h-lg">$150,000 for an equal third.</h2>
          <div class="grid split eqh grid-top">
            <div class="card">
              <ul class="clean">
                <li><strong>$150,000</strong> for a <strong>33% stake</strong></li>
                <li>Values Blue Seal at <strong>~$450K post-money</strong></li>
                <li>Three equal owner-operators</li>
                <li>You incorporate + run legal &amp; finance</li>
              </ul>
              <p class="ask-note">A founder round, not a priced raise — deliberately accessible. The product is already six figures of built software. The valuation step-up comes at the next round, once the Okanagan is proven. That's your upside.</p>
            </div>
            <div class="card">
              <h4 class="funds-h">Where it goes</h4>
              <div class="fund"><div class="top"><span>Okanagan demand marketing</span><strong>$80K</strong></div><div class="track"><div class="meter" style="width:53%"></div></div></div>
              <div class="fund"><div class="top"><span>Incorporation + legal / tax</span><strong>$20K</strong></div><div class="track"><div class="meter" style="width:13%"></div></div></div>
              <div class="fund"><div class="top"><span>Security + QA pass</span><strong>$20K</strong></div><div class="track"><div class="meter" style="width:13%"></div></div></div>
              <div class="fund"><div class="top"><span>Accounting setup</span><strong>$8K</strong></div><div class="track"><div class="meter" style="width:5%"></div></div></div>
              <div class="fund"><div class="top"><span>App-store presence</span><strong>$7K</strong></div><div class="track"><div class="meter" style="width:5%"></div></div></div>
              <div class="fund"><div class="top"><span>Buffer / contingency</span><strong>$15K</strong></div><div class="track"><div class="meter" style="width:10%"></div></div></div>
              <p class="note runway-note">~12–18 months of runway.</p>
            </div>
          </div>
        </div>
      </section>

      <!-- VISION -->
      <section class="band band--sky">
        <div class="container reveal center">
          <div class="kicker kicker-center">The vision</div>
          <img class="char vision-char" src="/characters/seal-pose-success.webp" alt="" />
          <h2 class="h-lg vision-h">The trusted name for verified trades in Canada.</h2>
          <p class="lead vision-lead">Okanagan → BC → Alberta → Canada. Same playbook every market: verify the best local pros, hand them the tools, earn the homeowner's trust.</p>
          <div class="cta-row cta-center">
            <a class="btn btn--primary" href="#ask">Join as the third partner →</a>
            <a class="btn btn--outline" href="https://blueseal.app/search" target="_blank" rel="noopener">See the live app yourself</a>
          </div>
          <p class="vision-foot">Browse the verified directory at <strong>blueseal.app/search</strong> — or create an account and look around.</p>
        </div>
      </section>

      <!-- FOOTER -->
      <footer class="deck-footer">
        <div class="container">
          <img src="/branding/Vertical/BlueSeal_Logo_Vert_White.png" alt="Blue Seal" />
          <p><strong>Johnny Jansen &amp; James Jansen</strong> · Kelowna, BC<br />contact@blueseal.app · blueseal.app</p>
          <p class="fine">Confidential. Prepared for a prospective partner; not for distribution. Live counts read from the platform; other traction figures are illustrative placeholders and projections are modelled estimates on stated assumptions — not guarantees. © Blue Seal 2026.</p>
        </div>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.pitch-root {
  --bs-dark-blue: #374c76;
  --bs-mid-blue: #5e81c9;
  --bs-light-blue: #b3dcff;
  --bs-beige: #fcecc9;
  --bs-red: #b2373d;
  --bs-dark-grey: #494c4f;
  --bs-bg: #faf9f6;
  --bs-muted: #6b6862;
  --bs-border: #eae7df;
  --bs-deep: #22314e;
  --r: 12px;
  --r-lg: 16px;
  --r-pill: 999px;
  --sh-sm: 0 1px 2px rgba(34, 49, 78, 0.08);
  --sh-md: 0 8px 24px -12px rgba(34, 49, 78, 0.25);
  --sh-lg: 0 24px 60px -24px rgba(34, 49, 78, 0.35);
  --display: "Poltawski Nowy", Georgia, serif;
  --body: "Roboto", -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
  --hand: "Gloria Hallelujah", cursive;

  font-family: var(--body);
  color: var(--bs-dark-grey);
  background: var(--bs-bg);
  line-height: 1.55;
  -webkit-font-smoothing: antialiased;
}
/* Bare (scoped) element selectors on purpose: keeping these low-specificity so
   component classes like .note / .fine / .vision-h / .lead-top can override
   margins (incl. margin-inline:auto for centering). A higher-specificity
   .pitch-root prefix here silently clobbered those margins. */
h1,
h2,
h3,
h4 {
  font-family: var(--display);
  color: var(--bs-dark-blue);
  line-height: 1.1;
  margin: 0 0 0.35em;
  font-weight: 600;
  text-wrap: balance;
}
p {
  margin: 0 0 0.9rem;
}
.m0 {
  margin: 0;
}

.progress {
  position: fixed;
  top: 0;
  left: 0;
  height: 3px;
  background: var(--bs-red);
  width: 0;
  z-index: 60;
  transition: width 0.1s linear;
}

.titlecard {
  min-height: 92vh;
  display: flex;
  align-items: center;
  justify-content: center;
  text-align: center;
  background: linear-gradient(165deg, #eaf6ff 0%, var(--bs-light-blue) 56%, #8fc0ee 100%);
}
.title-logo {
  width: min(440px, 76vw);
  height: auto;
  margin: 0 auto 1.4rem;
  display: block;
  filter: drop-shadow(0 20px 44px rgba(34, 49, 78, 0.2));
}
.title-tag {
  font-family: var(--display);
  color: var(--bs-dark-blue);
  font-size: clamp(1.1rem, 3vw, 1.45rem);
  margin: 0;
}
.title-sub {
  color: var(--bs-dark-blue);
  opacity: 0.6;
  font-size: 0.8rem;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  margin-top: 0.5rem;
}
.scrollcue {
  margin-top: 2.4rem;
  color: var(--bs-dark-blue);
  opacity: 0.45;
  font-size: 1.5rem;
  animation: bob 1.8s infinite;
}
@keyframes bob {
  0%,
  100% {
    transform: translateY(0);
  }
  50% {
    transform: translateY(7px);
  }
}

.topbar {
  position: sticky;
  top: 0;
  z-index: 50;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.6rem clamp(1rem, 4vw, 2.5rem);
  background: rgba(34, 49, 78, 0.82);
  backdrop-filter: blur(10px);
  border-bottom: 1px solid rgba(255, 255, 255, 0.12);
}
.topbar img {
  height: 28px;
  width: auto;
  display: block;
}
.topbar .tag {
  font-size: 0.68rem;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.62);
  text-align: right;
}

.container {
  max-width: 1080px;
  margin: 0 auto;
  padding: 0 clamp(1.1rem, 4vw, 2.5rem);
}
.band {
  padding: clamp(2.75rem, 5.5vw, 4.25rem) 0 clamp(2rem, 4vw, 3rem);
}
.band--slim {
  padding: clamp(1.75rem, 3.5vw, 2.5rem) 0 clamp(1.5rem, 3vw, 2rem);
}
.band--paper {
  background: #fff;
}
.band--beige {
  background: var(--bs-beige);
}
.band--sky {
  background: linear-gradient(165deg, #eaf6ff 0%, #cde7ff 60%, #b3dcff 100%);
}
.band--navy {
  background: linear-gradient(135deg, var(--bs-dark-blue), var(--bs-mid-blue));
  color: #eaf1ff;
}
.band--deep {
  background: linear-gradient(180deg, var(--bs-dark-blue), var(--bs-deep));
  color: #eaf1ff;
}
.band--navy :is(h1, h2, h3, h4),
.band--deep :is(h1, h2, h3, h4) {
  color: #fff;
}

.kicker {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--bs-red);
  margin-bottom: 0.9rem;
}
.kicker::before {
  content: "";
  width: 24px;
  height: 2px;
  background: var(--bs-red);
}
.kicker-center {
  justify-content: center;
}
.kicker-sub {
  color: var(--bs-muted);
  font-weight: 400;
  text-transform: none;
  letter-spacing: 0;
}
.band--navy .kicker,
.band--deep .kicker {
  color: var(--bs-light-blue);
}
.band--navy .kicker::before,
.band--deep .kicker::before {
  background: var(--bs-light-blue);
}

.h-xl {
  font-size: clamp(2.1rem, 6vw, 3.4rem);
}
.h-lg {
  font-size: clamp(1.7rem, 4.5vw, 2.5rem);
  max-width: 26ch;
}
.h-lg.tight {
  margin-bottom: 0.5rem;
}
.lead {
  font-size: clamp(1.02rem, 2vw, 1.2rem);
  color: var(--bs-muted);
  max-width: 48ch;
}
.lead-top {
  margin-top: 1rem;
}
.band--navy .lead,
.band--deep .lead {
  color: #cdd9f1;
}
.hand {
  font-family: var(--hand);
  color: var(--bs-mid-blue);
}

.grid {
  display: grid;
  gap: 1.2rem;
}
.grid-top {
  margin-top: 1.4rem;
}
.grid-start {
  align-items: start;
}
/* Equal-height card rows: stretch + flex column so card bottoms align and a
   trailing .src pins to a shared baseline. */
.grid.eqh {
  align-items: stretch;
}
.eqh > .card {
  display: flex;
  flex-direction: column;
}
.eqh > .card .src {
  margin-top: auto;
  padding-top: 0.6rem;
}
@media (min-width: 740px) {
  .g2 {
    grid-template-columns: repeat(2, 1fr);
  }
  .g3 {
    grid-template-columns: repeat(3, 1fr);
  }
  .g4 {
    grid-template-columns: repeat(4, 1fr);
  }
  .split {
    grid-template-columns: 1.05fr 0.95fr;
    align-items: center;
    gap: 2.4rem;
  }
}

.card {
  background: #fff;
  border: 1px solid var(--bs-border);
  border-radius: var(--r-lg);
  padding: 1.3rem;
  box-shadow: var(--sh-sm);
}
.card h3 {
  font-size: 1.1rem;
  margin-bottom: 0.25rem;
}
.card--mid {
  border-top: 4px solid var(--bs-mid-blue);
}
.card--red {
  border-top: 4px solid var(--bs-red);
}
.band--navy .card {
  background: rgba(255, 255, 255, 0.08);
  border-color: rgba(255, 255, 255, 0.16);
  color: #eaf1ff;
}
.band--navy .card :is(h3, h4) {
  color: #fff;
}
.band--navy .card p {
  color: #cdd9f1;
}
.band--deep .card {
  background: rgba(255, 255, 255, 0.07);
  border-color: rgba(255, 255, 255, 0.16);
  color: #eaf1ff;
}
.band--deep .card :is(h3, h4) {
  color: #fff;
}
.band--deep .card p {
  color: #cdd9f1;
}
.center {
  text-align: center;
}

.char {
  display: block;
  width: auto;
  height: auto;
}
.charwrap {
  display: flex;
  justify-content: center;
}
.hero-char {
  height: clamp(220px, 40vw, 360px);
  filter: drop-shadow(0 24px 40px rgba(0, 0, 0, 0.35));
}
.pillar-char {
  height: 120px;
  margin: 0 auto 0.6rem;
}
.step-char {
  height: 110px;
  margin: 0 auto 0.5rem;
}
.brand-char {
  height: clamp(150px, 20vw, 220px);
}
.quote-char {
  height: 112px;
  flex: 0 0 auto;
}
.vision-char {
  height: 150px;
  margin: 0 auto 1rem;
}

.pill {
  display: inline-block;
  font-size: 0.68rem;
  font-weight: 700;
  letter-spacing: 0.03em;
  padding: 0.22rem 0.6rem;
  border-radius: var(--r-pill);
}
.pill--live {
  background: #e6f4ea;
  color: #1f7a3d;
}
.pill--test {
  background: #fff3df;
  color: #9a6212;
}
.pill--next {
  background: #eef1f9;
  color: var(--bs-mid-blue);
}
.pill--free {
  background: #e6f4ea;
  color: #1f7a3d;
}
.pill--pro {
  background: #eceefb;
  color: #4250a8;
}

.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.6rem;
  margin-top: 1.6rem;
}
.chip {
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: var(--r-pill);
  padding: 0.5rem 0.95rem;
  font-size: 0.86rem;
  color: #eaf1ff;
}
.chip b {
  font-family: var(--display);
}
.cta-row {
  margin-top: 1.8rem;
  display: flex;
  gap: 0.7rem;
  flex-wrap: wrap;
}
.cta-center {
  justify-content: center;
}

.tiles {
  display: grid;
  gap: 0.9rem;
  grid-template-columns: repeat(2, 1fr);
}
@media (min-width: 740px) {
  .tiles {
    grid-template-columns: repeat(4, 1fr);
  }
}
.tile {
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.16);
  border-radius: var(--r);
  padding: 1rem 1.1rem;
}
.tile .n {
  font-family: var(--display);
  font-size: clamp(1.5rem, 3.5vw, 2rem);
  color: #fff;
  line-height: 1;
}
.tile .l {
  font-size: 0.78rem;
  color: #b7c6e6;
  margin-top: 0.4rem;
}
.tile--light {
  background: var(--bs-bg);
  border: 1px solid var(--bs-border);
}
.tile--light .n {
  color: var(--bs-dark-blue);
}
.tile--light .l {
  color: var(--bs-muted);
}

.live-dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #37d67a;
  margin-right: 0.4rem;
  box-shadow: 0 0 0 0 rgba(55, 214, 122, 0.7);
  animation: pulse 2s infinite;
}
@keyframes pulse {
  0% {
    box-shadow: 0 0 0 0 rgba(55, 214, 122, 0.6);
  }
  70% {
    box-shadow: 0 0 0 8px rgba(55, 214, 122, 0);
  }
  100% {
    box-shadow: 0 0 0 0 rgba(55, 214, 122, 0);
  }
}

table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.9rem;
}
th,
td {
  text-align: left;
  padding: 0.6rem 0.7rem;
  border-bottom: 1px solid var(--bs-border);
}
th {
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--bs-muted);
  font-weight: 700;
}
tbody tr:last-child td {
  border-bottom: none;
}
.num {
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.tstrong td {
  font-weight: 700;
  color: var(--bs-dark-blue);
  background: #f4f7fd;
}
.tablewrap {
  overflow-x: auto;
  border: 1px solid var(--bs-border);
  border-radius: var(--r-lg);
  background: #fff;
  padding: 0.3rem 0.5rem;
  box-shadow: var(--sh-sm);
}
.tablewrap.flat {
  box-shadow: none;
  border: 1px solid var(--bs-border);
}
.mt-m {
  margin-top: 1.4rem;
}

.schart {
  display: flex;
  align-items: flex-end;
  gap: clamp(0.7rem, 3vw, 1.6rem);
  height: 300px;
  padding-top: 1.6rem;
}
.sbar {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-end;
  height: 100%;
}
.sbar .stack {
  width: 100%;
  max-width: 110px;
  display: flex;
  flex-direction: column-reverse;
  border-radius: 8px 8px 0 0;
  overflow: hidden;
}
.sbar .seg {
  width: 100%;
  min-height: 6px;
}
.seg-mkt {
  background: var(--bs-dark-blue);
}
.seg-ins {
  background: var(--bs-mid-blue);
}
.seg-ent {
  background: var(--bs-light-blue);
}
.sbar .val {
  font-family: var(--display);
  font-weight: 600;
  color: var(--bs-dark-blue);
  margin-bottom: 0.3rem;
  font-size: 0.86rem;
}
.sbar .lab {
  margin-top: 0.5rem;
  font-size: 0.72rem;
  color: var(--bs-muted);
  text-align: center;
}
.legend {
  display: flex;
  gap: 1.2rem;
  flex-wrap: wrap;
  justify-content: center;
  margin-top: 1rem;
  font-size: 0.8rem;
  color: var(--bs-muted);
}
.legend span {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
}
.legend i {
  width: 12px;
  height: 12px;
  border-radius: 3px;
  display: inline-block;
}
.i-mkt {
  background: var(--bs-dark-blue);
}
.i-ins {
  background: var(--bs-mid-blue);
}
.i-ent {
  background: var(--bs-light-blue);
}

.fund {
  margin: 0.55rem 0;
}
.fund .top {
  display: flex;
  justify-content: space-between;
  font-size: 0.88rem;
  margin-bottom: 0.25rem;
}
.fund .track {
  height: 11px;
  background: rgba(255, 255, 255, 0.18);
  border-radius: var(--r-pill);
  overflow: hidden;
}
.fund .meter {
  height: 100%;
  border-radius: var(--r-pill);
  background: linear-gradient(90deg, var(--bs-light-blue), #fff);
}
.funds-h {
  margin-bottom: 0.7rem;
}
.runway-note {
  margin-bottom: 0;
}
.ask-note {
  margin-top: auto;
  padding-top: 0.9rem;
  font-size: 0.9rem;
}

ul.clean {
  list-style: none;
  padding: 0;
  margin: 0.4rem 0 0;
}
ul.clean li {
  position: relative;
  padding-left: 1.4rem;
  margin-bottom: 0.45rem;
  font-size: 0.95rem;
}
ul.clean li::before {
  content: "✓";
  position: absolute;
  left: 0;
  color: var(--bs-red);
  font-weight: 700;
}
.clean-s {
  margin-top: 0.7rem;
}
.band--navy ul.clean li::before,
.band--deep ul.clean li::before {
  color: var(--bs-light-blue);
}

.note {
  font-size: 0.78rem;
  color: var(--bs-muted);
  border-left: 3px solid var(--bs-border);
  padding: 0.15rem 0 0.15rem 0.9rem;
  margin: 1.25rem 0 0;
}
.note-tight {
  margin-top: 0.9rem;
}
.band--navy .note,
.band--deep .note {
  color: #b7c6e6;
  border-color: rgba(255, 255, 255, 0.25);
}
.src {
  font-size: 0.78rem;
  color: var(--bs-muted);
  margin: 0;
}
.bignum {
  font-family: var(--display);
  color: var(--bs-red);
  font-size: 1.7rem;
  font-weight: 600;
  line-height: 1;
}
.mt-s {
  margin-top: 0.4rem;
}
.mb-s {
  margin-bottom: 0.6rem;
}
.sub-h {
  margin-top: clamp(2.5rem, 5vw, 3.5rem);
  padding-top: 1.6rem;
  border-top: 1px solid var(--bs-border);
}
.badges {
  margin-top: 1.4rem;
  font-size: 0.9rem;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.badges span {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.btn {
  display: inline-block;
  font-weight: 600;
  font-size: 0.96rem;
  padding: 0.8rem 1.5rem;
  border-radius: var(--r-pill);
  text-decoration: none;
  transition: transform 0.15s ease;
  border: 1px solid transparent;
  cursor: pointer;
}
.btn--primary {
  background: var(--bs-red);
  color: #fff;
  box-shadow: var(--sh-md);
}
.btn--primary:hover {
  transform: translateY(-2px);
}
.btn--ghost {
  background: transparent;
  border-color: rgba(255, 255, 255, 0.5);
  color: #fff;
}
.btn--outline {
  background: transparent;
  border-color: var(--bs-dark-blue);
  color: var(--bs-dark-blue);
}

.si {
  font-family: var(--display);
  font-size: 1.3rem;
  color: var(--bs-red);
  font-weight: 700;
}
.step {
  display: flex;
  gap: 0.9rem;
  align-items: flex-start;
  margin-bottom: 0.7rem;
}
.region-pills {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  margin-top: 1rem;
}
.loops {
  gap: 1rem;
}

.quote-card {
  margin-top: 1.4rem;
  display: flex;
  gap: 1.1rem;
  align-items: flex-start;
}
@media (max-width: 639px) {
  .quote-card {
    flex-direction: column;
    align-items: flex-start;
  }
}
.quote-text {
  margin: 0;
}
.band--paper .quote-card {
  border-left: 4px solid var(--bs-red);
}

.member {
  display: flex;
  gap: 1rem;
  align-items: flex-start;
}
.member-name {
  margin-bottom: 0.15rem;
}
.member-role {
  font-size: 0.82rem;
  color: var(--bs-light-blue);
  margin: 0 0 0.5rem;
}
.avatar {
  width: 104px;
  height: 104px;
  border-radius: 50%;
  object-fit: cover;
  border: 3px solid rgba(255, 255, 255, 0.35);
  flex: 0 0 auto;
}
.seat-card {
  margin-top: 1.1rem;
  padding: 1.6rem;
  border-left: 4px solid var(--bs-light-blue);
}
@media (max-width: 639px) {
  .member {
    flex-direction: column;
    align-items: center;
    text-align: center;
  }
}

.trade-row {
  margin: 1.6rem auto 1.4rem;
  max-width: 760px;
  display: flex;
  flex-wrap: wrap;
  gap: 0.9rem;
  justify-content: center;
  align-items: flex-end;
  opacity: 0.95;
}
.trade-char {
  height: 64px;
  width: 64px;
  object-fit: contain;
}

.vision-h {
  max-width: 24ch;
  margin: 0 auto;
}
.vision-lead {
  margin: 1.1rem auto 0;
  max-width: 38ch;
}
.vision-foot {
  margin-top: 1rem;
  font-size: 0.85rem;
  color: var(--bs-muted);
}

.roadmap {
  margin-top: 1.8rem;
}
.rm-line {
  display: grid;
  gap: 1.4rem;
}
@media (min-width: 860px) {
  .rm-line {
    grid-template-columns: repeat(7, 1fr);
    gap: 0.4rem;
    position: relative;
  }
  .rm-line::before {
    content: "";
    position: absolute;
    top: 19px;
    left: 7%;
    right: 7%;
    height: 3px;
    background: var(--bs-border);
    z-index: 0;
  }
}
.rm-node {
  position: relative;
  text-align: center;
  padding: 0 0.3rem;
}
.rm-dot {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  margin: 0 auto 0.55rem;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  font-family: var(--display);
  font-size: 1.05rem;
  position: relative;
  z-index: 1;
  border: 3px solid var(--bs-border);
  background: #fff;
  color: var(--bs-muted);
}
.rm-done .rm-dot {
  background: var(--bs-dark-blue);
  border-color: var(--bs-dark-blue);
  color: #fff;
}
.rm-now .rm-dot {
  background: var(--bs-red);
  border-color: var(--bs-red);
  color: #fff;
  animation: pulse-red 2s infinite;
}
@keyframes pulse-red {
  0% {
    box-shadow: 0 0 0 0 rgba(178, 55, 61, 0.55);
  }
  70% {
    box-shadow: 0 0 0 12px rgba(178, 55, 61, 0);
  }
  100% {
    box-shadow: 0 0 0 0 rgba(178, 55, 61, 0);
  }
}
.rm-node h4 {
  font-size: 0.98rem;
  margin-bottom: 0.15rem;
}
.rm-node p {
  font-size: 0.8rem;
  color: var(--bs-muted);
  margin: 0;
  min-height: 3.2em;
}
.rm-here {
  display: inline-block;
  font-size: 0.64rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--bs-red);
  margin-top: 0.5rem;
}

.reveal {
  opacity: 0;
  transform: translateY(20px);
  transition:
    opacity 0.6s ease,
    transform 0.6s ease;
}
.reveal.is-visible {
  opacity: 1;
  transform: none;
}

.deck-footer {
  background: var(--bs-deep);
  color: #c7d4ec;
  padding: clamp(3rem, 5vw, 4rem) 0 clamp(2.5rem, 4vw, 3rem);
  text-align: center;
  font-size: 0.88rem;
  line-height: 1.7;
}
.deck-footer img {
  height: 52px;
  margin: 0 auto 1.5rem;
}
.deck-footer strong {
  color: #fff;
}
.fine {
  margin: 2rem auto 0;
  padding-top: 1.5rem;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
  font-size: 0.72rem;
  line-height: 1.65;
  opacity: 0.6;
  max-width: 56ch;
}

.gate {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1.5rem;
  background: linear-gradient(135deg, #374c76, #22314e);
}
.gate .box {
  background: #fff;
  border-radius: 16px;
  padding: 2.2rem;
  max-width: 380px;
  width: 100%;
  box-shadow: 0 24px 60px -24px rgba(34, 49, 78, 0.35);
  text-align: center;
}
.gate img {
  height: 72px;
  margin: 0 auto 1rem;
}
.gate-copy {
  color: #6b6862;
  font-size: 0.9rem;
}
.gate input {
  width: 100%;
  padding: 0.8rem 1rem;
  border: 1px solid #eae7df;
  border-radius: 12px;
  font-size: 1rem;
  margin: 0.7rem 0;
  font-family: var(--body);
}
.gate .err {
  color: #b2373d;
  font-size: 0.85rem;
  min-height: 1.2em;
}
.gate-btn {
  width: 100%;
}

/* Roadmap connector spine on the stacked (mobile) layout */
@media (max-width: 859px) {
  .rm-line {
    position: relative;
  }
  .rm-line::before {
    content: "";
    position: absolute;
    top: 20px;
    bottom: 20px;
    left: 50%;
    width: 3px;
    background: var(--bs-border);
    transform: translateX(-50%);
    z-index: 0;
  }
}

/* Centered pillar/step card body — tidy the measure so centered text doesn't rag */
.card.center p {
  max-width: 26ch;
  margin-left: auto;
  margin-right: auto;
}

/* Founder-quote attribution on its own line */
.attrib {
  display: block;
  margin-top: 0.4rem;
}

/* Screenshot / photo placeholder slots — replace .shot-ph with a real <img>. */
.shot {
  margin: 0;
}
.shot-ph {
  border: 2px dashed var(--bs-border);
  border-radius: var(--r-lg);
  background: repeating-linear-gradient(45deg, #fff, #fff 12px, #f3f1ec 12px, #f3f1ec 24px);
  display: flex;
  align-items: center;
  justify-content: center;
  text-align: center;
  color: var(--bs-muted);
  font-size: 0.85rem;
  font-weight: 600;
  padding: 1.2rem;
  aspect-ratio: 16 / 10;
}
.shot figcaption {
  font-size: 0.72rem;
  color: var(--bs-muted);
  margin-top: 0.5rem;
  text-align: center;
}
.band--navy .shot-ph,
.band--deep .shot-ph {
  border-color: rgba(255, 255, 255, 0.28);
  background: rgba(255, 255, 255, 0.05);
  color: #b7c6e6;
}
.band--navy .shot figcaption,
.band--deep .shot figcaption {
  color: #b7c6e6;
}
.shot-grid {
  display: grid;
  gap: 1rem;
  margin-top: 1.4rem;
}
@media (min-width: 740px) {
  .shot-grid.cols-3 {
    grid-template-columns: repeat(3, 1fr);
  }
}
</style>
