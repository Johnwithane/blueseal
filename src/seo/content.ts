// ---------------------------------------------------------------------------
// SEO content — the single source of truth for per-page <head> metadata,
// structured data, and the static HTML body baked into prerendered pages.
//
// Imported by BOTH the Vue views (runtime <head> via useSeo) AND the build-time
// prerender script (scripts/prerender.ts, run under Node). So it MUST stay
// framework-free: no Vue, no `@/` alias, relative imports only.
//
// Keeping meta + JSON-LD here (not inline in each view) means the prerendered
// HTML a crawler/LLM sees and the runtime <head> a browser builds are derived
// from the exact same data — they can't drift.
// ---------------------------------------------------------------------------

import { HELP_CONTENT_SEED } from "../data/help";
import { TRADES } from "../data/trades";
import { CITIES, findCity } from "../data/cities";
import {
  SITE_NAME,
  SITE_TAGLINE,
  DEFAULT_DESCRIPTION,
  HOME_RECRUIT_DESCRIPTION,
  COUNTRY,
  IS_ONBOARDING,
} from "./site";
import {
  organizationLd,
  websiteLd,
  breadcrumbLd,
  faqPageLd,
  articleLd,
  serviceLd,
  cityServiceLd,
  type JsonLd,
} from "./jsonld";
import { mdToHtml, mdToText, clampDescription, escapeHtml } from "./markdown";

export interface SeoMeta {
  title?: string; // page title without the brand suffix (omit on home)
  description?: string;
  path?: string; // canonical path
  type?: "website" | "article" | "profile";
  noindex?: boolean;
  jsonLd?: JsonLd[];
}

export interface PrerenderRoute {
  path: string; // exact SPA path, e.g. "/help/get-verified"
  seo: SeoMeta;
  /** Inner HTML baked into the #app shell for crawlers/LLMs (replaced on hydration). */
  body: string;
  priority: number; // sitemap priority 0..1
  changefreq: "daily" | "weekly" | "monthly" | "yearly";
}

const { categories, articles, faqs } = HELP_CONTENT_SEED;

const crumb = (...items: { name: string; path: string }[]) =>
  breadcrumbLd([{ name: "Home", path: "/" }, ...items]);

// --- small HTML builders (escaped; trusted in-repo content only) ------------

const h1 = (t: string) => `<h1>${escapeHtml(t)}</h1>`;
const p = (t: string) => `<p>${escapeHtml(t)}</p>`;
const link = (href: string, t: string) => `<a href="${href}">${escapeHtml(t)}</a>`;
const ul = (items: string[]) => `<ul>${items.map((i) => `<li>${i}</li>`).join("")}</ul>`;
const section = (inner: string) => `<section>${inner}</section>`;

export const TRUST_POINTS = [
  "Government ID checked",
  "Trade certification verified",
  "Insurance on file",
  "WSIB / workers' comp where it applies",
  "Mutual reviews after every job",
];

export const HOW_IT_WORKS = [
  "Post a job and let verified pros come to you, or search and shortlist them yourself.",
  "Chat, get an itemised quote, and pick a time, all in one job thread.",
  "Pay in-app when the job's done and leave a mutual review.",
];

// ===========================================================================
// Per-page SEO builders (also used by views at runtime)
// ===========================================================================

export function homeSeo(): SeoMeta {
  // Supply-first: while onboarding, the homepage recruits tradespeople and is
  // the indexed front door; the client marketplace pages are held noindex.
  if (IS_ONBOARDING) {
    return {
      title: "Get verified, get more work in the Okanagan",
      description: HOME_RECRUIT_DESCRIPTION,
      path: "/",
      type: "website",
      jsonLd: [organizationLd(), websiteLd()],
    };
  }
  return {
    description: DEFAULT_DESCRIPTION,
    path: "/",
    type: "website",
    jsonLd: [organizationLd(), websiteLd(), faqPageLd(faqs.slice(0, 8).map(faqText))],
  };
}

// Onboarding-phase homepage body (crawler/LLM view) — recruits tradespeople.
function homeBodyRecruit(): string {
  return [
    section(h1("Get verified. Get more work.") + p(HOME_RECRUIT_DESCRIPTION)),
    section(
      `<h2>Why join Blue Seal</h2>${ul(
        [
          "A verified badge clients actually trust: government ID and trade ticket, checked by a person.",
          "Win and run the whole job in one place: quotes, chat, scheduling, invoicing and payments.",
          "An AI assistant that drafts quotes, replies and invoices in seconds.",
          "Keep 100% of your invoice. Offline payments are free.",
        ].map(escapeHtml),
      )}`,
    ),
    section(
      `<h2>How to join</h2>${ul(
        [
          "Apply and upload your trade ticket and government ID.",
          "Our team verifies you by hand.",
          "Go live and start winning work across the Okanagan.",
        ].map(escapeHtml),
      )}`,
    ),
    section(p("Ready?") + link("/sign-up?as=tradesperson", "Apply to get verified")),
  ].join("");
}

function homeBody(): string {
  if (IS_ONBOARDING) return homeBodyRecruit();
  const tradeLinks = TRADES.slice(0, 12).map((t) =>
    link(`/search?trade=${t.key}`, t.label),
  );
  return [
    section(
      h1("Verified Canadian tradespeople") +
        p(SITE_TAGLINE) +
        p(DEFAULT_DESCRIPTION),
    ),
    section(`<h2>Every pro, verified</h2>${ul(TRUST_POINTS.map(escapeHtml))}`),
    section(`<h2>How Blue Seal works</h2>${ul(HOW_IT_WORKS.map(escapeHtml))}`),
    section(
      `<h2>Popular trades</h2>${ul(tradeLinks)}${p("See all trades:")}${link("/trades", "Browse all trades")}`,
    ),
    section(
      `<h2>Common questions</h2>` +
        faqs
          .slice(0, 5)
          .map((f) => `<h3>${escapeHtml(f.question)}</h3>${mdToHtml(f.answer)}`)
          .join(""),
    ),
  ].join("");
}

export function searchSeo(): SeoMeta {
  return {
    title: "Find a verified tradesperson in Canada",
    description:
      "Search Blue Seal's verified, ID-checked tradespeople across Canada by trade, " +
      "location and rating. Compare certified pros, request quotes and book with confidence.",
    path: "/search",
    type: "website",
    noindex: IS_ONBOARDING,
    jsonLd: [crumb({ name: "Find a tradesperson", path: "/search" })],
  };
}

function searchBody(): string {
  const tradeLinks = TRADES.slice(0, 16).map((t) => link(`/search?trade=${t.key}`, t.label));
  return [
    section(
      h1("Find a verified tradesperson in Canada") +
        p(
          "We check every tradesperson by hand: a government ID and trade ticket, verified " +
            "before they can take work. Plenty add insurance and workers' comp badges too. " +
            "Search by trade and area, compare ratings, and start a job thread in minutes.",
        ),
    ),
    section(`<h2>Browse by trade</h2>${ul(tradeLinks)}${link("/trades", "See all trades")}`),
  ].join("");
}

export function helpCenterSeo(): SeoMeta {
  return {
    title: "Help Center",
    description:
      "Guides and answers for clients and tradespeople using Blue Seal: getting verified, " +
      "finding a pro, posting a job, quotes, invoices, payments, safety and more.",
    path: "/help",
    jsonLd: [crumb({ name: "Help Center", path: "/help" })],
  };
}

function helpCenterBody(): string {
  const cats = categories
    .map(
      (c) =>
        `<h2>${escapeHtml(c.title)}</h2>${p(c.description)}` +
        ul(
          articles
            .filter((a) => a.categoryId === c.id)
            .map((a) => link(`/help/${a.slug}`, a.title)),
        ),
    )
    .join("");
  return section(h1("Blue Seal Help Center") + p("Find answers and step-by-step guides.")) + cats;
}

export function helpArticleSeo(slug: string): SeoMeta | null {
  const a = articles.find((x) => x.slug === slug);
  if (!a) return null;
  const description = clampDescription(a.excerpt || mdToText(a.body));
  const path = `/help/${a.slug}`;
  const cat = categories.find((c) => c.id === a.categoryId);
  return {
    title: a.title,
    description,
    path,
    type: "article",
    jsonLd: [
      articleLd({ title: a.title, description, path, body: mdToText(a.body) }),
      crumb(
        { name: "Help Center", path: "/help" },
        ...(cat ? [{ name: cat.title, path: "/help" }] : []),
        { name: a.title, path },
      ),
    ],
  };
}

function helpArticleBody(slug: string): string {
  const a = articles.find((x) => x.slug === slug);
  if (!a) return "";
  return (
    section(`<nav>${link("/help", "Help Center")} › ${escapeHtml(a.title)}</nav>`) +
    section(h1(a.title) + mdToHtml(a.body))
  );
}

const faqText = (f: { question: string; answer: string }) => ({
  question: f.question,
  answer: mdToText(f.answer),
});

export function faqSeo(): SeoMeta {
  return {
    title: "Frequently asked questions",
    description:
      "Answers to common questions about Blue Seal: how verification works, what it costs, " +
      "the areas we cover, requesting quotes vs posting a job, payments and safety.",
    path: "/faq",
    jsonLd: [faqPageLd(faqs.map(faqText)), crumb({ name: "FAQ", path: "/faq" })],
  };
}

function faqBody(): string {
  const items = faqs
    .map((f) => `<h2>${escapeHtml(f.question)}</h2>${mdToHtml(f.answer)}`)
    .join("");
  return section(h1("Frequently asked questions")) + section(items);
}

export function privacySeo(): SeoMeta {
  return {
    title: "Privacy Policy",
    description: `How ${SITE_NAME} collects, uses and protects your personal information.`,
    path: "/privacy",
    jsonLd: [crumb({ name: "Privacy Policy", path: "/privacy" })],
  };
}

export function termsSeo(): SeoMeta {
  return {
    title: "Terms of Service",
    description: `The terms that govern your use of ${SITE_NAME}.`,
    path: "/terms",
    jsonLd: [crumb({ name: "Terms of Service", path: "/terms" })],
  };
}

// --- Trade landing pages ----------------------------------------------------

export function tradesIndexSeo(): SeoMeta {
  return {
    title: "Find a tradesperson by trade",
    description:
      "Browse every trade on Blue Seal, from plumbers and electricians to roofers, HVAC " +
      "techs and 50+ more. Find a verified, ID-checked pro near you across Canada.",
    path: "/trades",
    noindex: IS_ONBOARDING,
    jsonLd: [crumb({ name: "Trades", path: "/trades" })],
  };
}

function tradesIndexBody(): string {
  const links = TRADES.map((t) => link(`/trades/${t.key}`, t.label));
  return (
    section(
      h1("Find a verified tradesperson by trade") +
        p(
          "Every trade on Blue Seal is staffed by verified pros. We check a government ID and " +
            "trade ticket by hand, and plenty add insurance and workers' comp badges too. " +
            "Pick a trade to find one near you.",
        ),
    ) + section(`<h2>All trades</h2>${ul(links)}`)
  );
}

function tradeDescription(label: string): string {
  return (
    `Find a verified, ID-checked ${label.toLowerCase()} on Blue Seal. Compare certified ` +
    `${label.toLowerCase()} pros across ${COUNTRY}, request quotes, schedule and pay, all in ` +
    `one trusted job thread, with mutual reviews after every job.`
  );
}

export function tradePageSeo(key: string): SeoMeta | null {
  const trade = TRADES.find((t) => t.key === key);
  if (!trade) return null;
  const path = `/trades/${trade.key}`;
  const description = tradeDescription(trade.label);
  return {
    title: `Hire a verified ${trade.label} in ${COUNTRY}`,
    description,
    path,
    type: "website",
    noindex: IS_ONBOARDING,
    jsonLd: [
      serviceLd({ tradeLabel: trade.label, description, path }),
      crumb({ name: "Trades", path: "/trades" }, { name: trade.label, path }),
    ],
  };
}

function tradePageBody(key: string): string {
  const trade = TRADES.find((t) => t.key === key);
  if (!trade) return "";
  const label = trade.label;
  return [
    section(
      `<nav>${link("/trades", "Trades")} › ${escapeHtml(label)}</nav>` +
        h1(`Hire a verified ${label} in ${COUNTRY}`) +
        p(tradeDescription(label)),
    ),
    section(`<h2>Why hire a ${escapeHtml(label)} through Blue Seal</h2>${ul(TRUST_POINTS.map(escapeHtml))}`),
    section(`<h2>How it works</h2>${ul(HOW_IT_WORKS.map(escapeHtml))}`),
    section(
      p(`Ready to start?`) +
        link(`/search?trade=${trade.key}`, `Find a ${label} near you`) +
        " · " +
        link("/jobs/post", "Post a job and get quotes"),
    ),
  ].join("");
}

// --- City landing pages (local SEO) -----------------------------------------

function cityDescription(name: string, region: string): string {
  return (
    `Looking for a tradesperson in ${name}, ${region}? Blue Seal verifies every pro's ` +
    `government ID and trade ticket by hand. Post a job and compare quotes, or search local ` +
    `pros, then run the whole job in one place: quote, schedule, pay and review.`
  );
}

export function citySeo(slug: string): SeoMeta | null {
  const c = findCity(slug);
  if (!c) return null;
  const path = `/cities/${c.slug}`;
  const description = cityDescription(c.name, c.region);
  return {
    title: `Verified tradespeople in ${c.name}, ${c.region}`,
    description,
    path,
    type: "website",
    noindex: IS_ONBOARDING,
    jsonLd: [
      cityServiceLd({ city: c.name, region: c.region, description, path }),
      crumb({ name: "Areas", path: "/cities" }, { name: c.name, path }),
    ],
  };
}

function cityBody(slug: string): string {
  const c = findCity(slug);
  if (!c) return "";
  const tradeLinks = TRADES.slice(0, 12).map((t) => link(`/search?trade=${t.key}`, t.label));
  const otherCities = CITIES.filter((x) => x.slug !== c.slug).map((x) =>
    link(`/cities/${x.slug}`, `${x.name}, ${x.region}`),
  );
  return [
    section(
      `<nav>${link("/cities", "Areas")} › ${escapeHtml(c.name)}</nav>` +
        h1(`Verified tradespeople in ${c.name}, ${c.region}`) +
        p(c.intro),
    ),
    section(`<h2>Every ${escapeHtml(c.name)} pro, verified</h2>${ul(TRUST_POINTS.map(escapeHtml))}`),
    section(`<h2>How Blue Seal works in ${escapeHtml(c.name)}</h2>${ul(HOW_IT_WORKS.map(escapeHtml))}`),
    section(
      `<h2>Popular trades in ${escapeHtml(c.name)}</h2>${ul(tradeLinks)}${link("/trades", "See all trades")}`,
    ),
    section(
      p("Ready to start?") +
        link("/jobs/post", "Post a job and get quotes") +
        " · " +
        link("/search", "Search verified pros"),
    ),
    section(`<h2>Other areas we cover</h2>${ul(otherCities)}`),
  ].join("");
}

export function citiesIndexSeo(): SeoMeta {
  return {
    title: "Areas we cover in the Okanagan",
    description:
      "Find verified, ID-checked tradespeople across the Okanagan and Thompson-Okanagan: " +
      "Kelowna, West Kelowna, Vernon, Penticton, Kamloops and more.",
    path: "/cities",
    noindex: IS_ONBOARDING,
    jsonLd: [crumb({ name: "Areas", path: "/cities" })],
  };
}

function citiesIndexBody(): string {
  const links = CITIES.map((c) => link(`/cities/${c.slug}`, `${c.name}, ${c.region}`));
  return section(
    h1("Areas we cover") +
      p(
        "Blue Seal is built in the Okanagan. Find verified tradespeople in your town, post a job " +
          "and compare quotes, and run the whole job in one place.",
      ) +
      `<h2>Towns and cities</h2>${ul(links)}`,
  );
}

// ===========================================================================
// The full set of prerendered routes (drives scripts/prerender.ts + sitemap)
// ===========================================================================

export function getPrerenderRoutes(): PrerenderRoute[] {
  const routes: PrerenderRoute[] = [
    { path: "/", seo: homeSeo(), body: homeBody(), priority: 1.0, changefreq: "weekly" },
    { path: "/search", seo: searchSeo(), body: searchBody(), priority: 0.9, changefreq: "daily" },
    { path: "/trades", seo: tradesIndexSeo(), body: tradesIndexBody(), priority: 0.8, changefreq: "monthly" },
    { path: "/help", seo: helpCenterSeo(), body: helpCenterBody(), priority: 0.6, changefreq: "monthly" },
    { path: "/faq", seo: faqSeo(), body: faqBody(), priority: 0.6, changefreq: "monthly" },
    { path: "/privacy", seo: privacySeo(), body: section(h1("Privacy Policy")), priority: 0.3, changefreq: "yearly" },
    { path: "/terms", seo: termsSeo(), body: section(h1("Terms of Service")), priority: 0.3, changefreq: "yearly" },
  ];

  for (const t of TRADES) {
    const seo = tradePageSeo(t.key);
    if (seo) {
      routes.push({
        path: `/trades/${t.key}`,
        seo,
        body: tradePageBody(t.key),
        priority: 0.7,
        changefreq: "monthly",
      });
    }
  }

  routes.push({
    path: "/cities",
    seo: citiesIndexSeo(),
    body: citiesIndexBody(),
    priority: 0.7,
    changefreq: "monthly",
  });
  for (const c of CITIES) {
    const seo = citySeo(c.slug);
    if (seo) {
      routes.push({
        path: `/cities/${c.slug}`,
        seo,
        body: cityBody(c.slug),
        priority: 0.7,
        changefreq: "monthly",
      });
    }
  }

  for (const a of articles) {
    const seo = helpArticleSeo(a.slug);
    if (seo) {
      routes.push({
        path: `/help/${a.slug}`,
        seo,
        body: helpArticleBody(a.slug),
        priority: 0.5,
        changefreq: "monthly",
      });
    }
  }

  // Auth pages: prerendered only to bake an explicit noindex (honoured by
  // crawlers that don't run JS). Excluded from the sitemap + llms.txt by the
  // noindex filter, so they add no crawl noise.
  const authPages: { path: string; title: string }[] = [
    { path: "/sign-in", title: "Sign in" },
    { path: "/sign-up", title: "Create your account" },
    { path: "/forgot-password", title: "Reset your password" },
  ];
  for (const a of authPages) {
    routes.push({
      path: a.path,
      seo: { title: a.title, path: a.path, noindex: true },
      body: section(h1(a.title)),
      priority: 0.0,
      changefreq: "yearly",
    });
  }

  return routes;
}
