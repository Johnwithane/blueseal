// ---------------------------------------------------------------------------
// Schema.org JSON-LD builders. These return plain objects that get serialised
// into <script type="application/ld+json"> — both at runtime (useSeo) and baked
// into prerendered HTML (scripts/prerender.ts). Framework-free + Node-safe.
//
// Why JSON-LD specifically: it's Google's preferred structured-data format AND
// the format LLM crawlers parse most reliably to understand what a page is.
// ---------------------------------------------------------------------------

import {
  SITE_NAME,
  SITE_URL,
  SITE_TAGLINE,
  LOGO_URL,
  COUNTRY,
  DEFAULT_DESCRIPTION,
  absoluteUrl,
} from "./site";

export type JsonLd = Record<string, unknown>;

/** Stable @id for the Organization so other nodes can reference it. */
const ORG_ID = `${SITE_URL}/#organization`;
const WEBSITE_ID = `${SITE_URL}/#website`;

/** The Blue Seal Organization — emitted site-wide (homepage carries the canonical copy). */
export function organizationLd(): JsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    "@id": ORG_ID,
    name: SITE_NAME,
    alternateName: "BlueSeal",
    url: SITE_URL,
    logo: LOGO_URL,
    image: LOGO_URL,
    slogan: SITE_TAGLINE,
    description: DEFAULT_DESCRIPTION,
    areaServed: [
      { "@type": "Country", name: COUNTRY },
      { "@type": "AdministrativeArea", name: "British Columbia" },
      { "@type": "City", name: "Kelowna" },
      { "@type": "City", name: "West Kelowna" },
      { "@type": "City", name: "Vernon" },
      { "@type": "City", name: "Penticton" },
      { "@type": "City", name: "Kamloops" },
    ],
  };
}

/** The WebSite node — ties pages to the brand and declares the language. */
export function websiteLd(): JsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": WEBSITE_ID,
    name: SITE_NAME,
    url: SITE_URL,
    inLanguage: "en-CA",
    publisher: { "@id": ORG_ID },
  };
}

/** Breadcrumb trail. Pass [{ name, path }] from home → … → current page. */
export function breadcrumbLd(items: { name: string; path: string }[]): JsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: item.name,
      item: absoluteUrl(item.path),
    })),
  };
}

/** FAQPage — drives the FAQ rich result and feeds LLM Q&A extraction. */
export function faqPageLd(faqs: { question: string; answer: string }[]): JsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((f) => ({
      "@type": "Question",
      name: f.question,
      acceptedAnswer: { "@type": "Answer", text: f.answer },
    })),
  };
}

/** Article — for help-centre pages. `body` is the plain-text article body. */
export function articleLd(input: {
  title: string;
  description: string;
  path: string;
  body: string;
}): JsonLd {
  const url = absoluteUrl(input.path);
  return {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: input.title,
    description: input.description,
    articleBody: input.body,
    inLanguage: "en-CA",
    mainEntityOfPage: { "@type": "WebPage", "@id": url },
    url,
    author: { "@id": ORG_ID },
    publisher: { "@id": ORG_ID },
  };
}

/** Service — for per-trade landing pages (e.g. "Plumber" in Canada). */
export function serviceLd(input: {
  tradeLabel: string;
  description: string;
  path: string;
}): JsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "Service",
    serviceType: input.tradeLabel,
    name: `${input.tradeLabel} services`,
    description: input.description,
    url: absoluteUrl(input.path),
    areaServed: { "@type": "Country", name: COUNTRY },
    provider: { "@id": ORG_ID },
    category: "Home services",
  };
}

/**
 * Person — for a verified tradesperson's public profile. Optional rating +
 * trade are included only when present so we never emit empty/zero values.
 */
export function tradiePersonLd(input: {
  name: string;
  path: string;
  trade?: string;
  city?: string;
  image?: string;
  ratingValue?: number;
  reviewCount?: number;
}): JsonLd {
  const node: JsonLd = {
    "@context": "https://schema.org",
    "@type": "Person",
    name: input.name,
    url: absoluteUrl(input.path),
    worksFor: { "@id": ORG_ID },
  };
  if (input.trade) node.jobTitle = input.trade;
  if (input.image) node.image = input.image;
  if (input.city) node.address = { "@type": "PostalAddress", addressLocality: input.city, addressCountry: "CA" };
  if (typeof input.ratingValue === "number" && input.reviewCount && input.reviewCount > 0) {
    node.aggregateRating = {
      "@type": "AggregateRating",
      ratingValue: input.ratingValue,
      reviewCount: input.reviewCount,
      bestRating: 5,
      worstRating: 1,
    };
  }
  return node;
}
