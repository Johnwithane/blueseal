// Supplies marketplace — affiliate partner registry.
//
// The in-job Supplies panel (tradesperson-only, Work Order tab) lets a pro
// search a vetted Canadian supplier for the parts/tools/gear a job needs, then
// log what they bought as a job expense in one tap. We earn affiliate
// commission on the click-throughs; the tradesperson gets a genuine job-prep +
// cost-tracking tool. It is NOT shown to clients.
//
// PLACEHOLDER URLS (mirrors src/data/insurancePartner.ts): every `url` below
// currently points at the supplier's public site so the panel works today.
// Swap the approved affiliate / tracking link in by setting the matching
// VITE_SUPPLY_<ID>_URL env var — no code change. See HUMANTASKS.md for the
// affiliate-program sign-up tasks (Amazon Associates CA, Home Depot CA, etc.).
//
// `searchUrlTemplate` deep-links the supplier's own search for what the tradie
// types — that's the useful bit. When a network supports query-level tracking
// (Amazon appends a tag), wiring that into the template is a fast-follow; for
// v1 the search is the UX and the tile `url` is the attributed affiliate path.

export type SupplyCategory = "materials" | "rental" | "workwear" | "services";

export interface SupplyPartner {
  /** Stable id — used in analytics + env var name. Never rename once shipped. */
  id: string;
  name: string;
  category: SupplyCategory;
  /** Env-swappable affiliate/landing link, with a working public fallback. */
  url: string;
  /** One line on why it's useful — keeps the surface a tool, not an ad. */
  blurb: string;
  /** PrimeIcons class for the tile. */
  icon: string;
  /** Public search deep-link with `{q}` placeholder. Omit if no search. */
  searchUrlTemplate?: string;
  /**
   * Optional trade relevance filter (canonical trade keys from data/trades.ts).
   * Omit = relevant to all trades. Used to order/curate tiles per job.
   */
  trades?: string[];
}

const pickUrl = (v: string | undefined, fallback: string): string =>
  (v ?? "").trim() || fallback;

// Static `import.meta.env.VITE_*` access (not dynamic) so Vite inlines each
// value at build, exactly like insurancePartner.ts.
export const SUPPLY_PARTNERS: readonly SupplyPartner[] = [
  // ── Materials & tools ───────────────────────────────────────────────────
  {
    id: "homedepot_ca",
    name: "The Home Depot Canada",
    category: "materials",
    url: pickUrl(import.meta.env.VITE_SUPPLY_HOMEDEPOT_CA_URL, "https://www.homedepot.ca/"),
    blurb: "Lumber, fixtures, hardware and tools — pickup or next-day delivery.",
    icon: "pi pi-home",
    searchUrlTemplate: "https://www.homedepot.ca/search?q={q}",
  },
  {
    id: "rona",
    name: "RONA",
    category: "materials",
    url: pickUrl(import.meta.env.VITE_SUPPLY_RONA_URL, "https://www.rona.ca/en"),
    blurb: "Building materials and trade supplies across Canada.",
    icon: "pi pi-building",
    searchUrlTemplate: "https://www.rona.ca/en/search?query={q}",
  },
  {
    id: "amazon_ca",
    name: "Amazon.ca",
    category: "materials",
    url: pickUrl(import.meta.env.VITE_SUPPLY_AMAZON_CA_URL, "https://www.amazon.ca/"),
    blurb: "Tools, consumables and hard-to-find parts, fast.",
    icon: "pi pi-box",
    searchUrlTemplate: "https://www.amazon.ca/s?k={q}",
  },
  {
    id: "canadian_tire",
    name: "Canadian Tire",
    category: "materials",
    url: pickUrl(import.meta.env.VITE_SUPPLY_CANADIAN_TIRE_URL, "https://www.canadiantire.ca/"),
    blurb: "Tools, automotive and general supplies — nationwide pickup.",
    icon: "pi pi-wrench",
    searchUrlTemplate: "https://www.canadiantire.ca/en/search-results.html?q={q}",
  },

  // ── Tool & equipment rental ─────────────────────────────────────────────
  {
    id: "homedepot_rental",
    name: "Home Depot Tool Rental",
    category: "rental",
    url: pickUrl(
      import.meta.env.VITE_SUPPLY_HOMEDEPOT_RENTAL_URL,
      "https://www.homedepot.ca/tool-and-truck-rental.html",
    ),
    blurb: "Rent the big gear you don't own — by the hour, day or week.",
    icon: "pi pi-truck",
  },
  {
    id: "sunbelt_rentals",
    name: "Sunbelt Rentals Canada",
    category: "rental",
    url: pickUrl(import.meta.env.VITE_SUPPLY_SUNBELT_URL, "https://www.sunbeltrentals.com/en-ca/"),
    blurb: "Lifts, compaction, power and specialty equipment rental.",
    icon: "pi pi-cog",
  },

  // ── Workwear, PPE & safety ──────────────────────────────────────────────
  {
    id: "marks",
    name: "Mark's",
    category: "workwear",
    url: pickUrl(import.meta.env.VITE_SUPPLY_MARKS_URL, "https://www.marks.com/en/"),
    blurb: "CSA boots, workwear and hi-vis built for the trades.",
    icon: "pi pi-shield",
    searchUrlTemplate: "https://www.marks.com/en/search?q={q}",
  },
  {
    id: "work_authority",
    name: "Work Authority",
    category: "workwear",
    url: pickUrl(import.meta.env.VITE_SUPPLY_WORK_AUTHORITY_URL, "https://www.workauthority.ca/"),
    blurb: "Safety footwear and PPE — Canadian work-gear specialist.",
    icon: "pi pi-verified",
    searchUrlTemplate: "https://www.workauthority.ca/search?q={q}",
  },

  // ── Business services ───────────────────────────────────────────────────
  {
    id: "quickbooks_ca",
    name: "QuickBooks Canada",
    category: "services",
    url: pickUrl(import.meta.env.VITE_SUPPLY_QUICKBOOKS_URL, "https://quickbooks.intuit.com/ca/"),
    blurb: "Bookkeeping and GST/HST tracking for self-employed trades.",
    icon: "pi pi-calculator",
  },
  {
    id: "freshbooks",
    name: "FreshBooks",
    category: "services",
    url: pickUrl(import.meta.env.VITE_SUPPLY_FRESHBOOKS_URL, "https://www.freshbooks.com/"),
    blurb: "Simple accounting and expense tracking for small contractors.",
    icon: "pi pi-chart-line",
  },
] as const;

export const SUPPLY_CATEGORY_LABELS: Record<SupplyCategory, string> = {
  materials: "Materials & tools",
  rental: "Equipment rental",
  workwear: "Workwear & safety",
  services: "Business services",
};

/** Display order for the category chips. */
export const SUPPLY_CATEGORY_ORDER: SupplyCategory[] = [
  "materials",
  "rental",
  "workwear",
  "services",
];

export function partnersForCategory(category: SupplyCategory): SupplyPartner[] {
  return SUPPLY_PARTNERS.filter((p) => p.category === category);
}

/**
 * Partners relevant to a trade: a partner with no `trades` filter is relevant
 * to every trade. Order is preserved from the registry.
 */
export function partnersForTrade(tradeKey: string): SupplyPartner[] {
  return SUPPLY_PARTNERS.filter((p) => !p.trades || p.trades.includes(tradeKey));
}

export function getPartner(id: string): SupplyPartner | undefined {
  return SUPPLY_PARTNERS.find((p) => p.id === id);
}

/**
 * Build the outbound link for a search query. Uses the partner's search
 * template when it has one (the useful path); otherwise falls back to its
 * landing `url`. Query is URL-encoded.
 */
export function buildSearchUrl(partner: SupplyPartner, query: string): string {
  const q = query.trim();
  if (partner.searchUrlTemplate && q) {
    return partner.searchUrlTemplate.replace("{q}", encodeURIComponent(q));
  }
  return partner.url;
}

/** The default supplier to deep-link a search to — first materials partner. */
export function defaultSearchPartner(): SupplyPartner {
  return partnersForCategory("materials")[0] ?? SUPPLY_PARTNERS[0];
}
