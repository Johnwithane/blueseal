// Okanagan / Thompson-Okanagan city landing pages — the local-SEO surface.
//
// These let Blue Seal rank for "tradesperson in Kelowna / Vernon / Penticton"
// instead of only the national "...in Canada" trade pages, which is the axis
// the local scrape-and-list directories compete on.
//
// Each city has a HAND-WRITTEN, genuinely local intro (named neighbourhoods,
// real local character) so the pages aren't thin or duplicate — the thing that
// gets auto-generated directory pages penalised. Coordinates are approximate
// city centres, used to centre the search CTA on the city.
//
// This module is framework-free: it's imported by src/seo/content.ts, which
// runs under plain Node during prerender. No Vue, no `@/` alias.

export interface City {
  /** URL segment. Stable once shipped — a renamed slug breaks live links. */
  slug: string;
  name: string;
  /** Province abbreviation, e.g. "BC". */
  region: string;
  lat: number;
  lng: number;
  /** Human, city-specific intro paragraph. Keep it real, not boilerplate. */
  intro: string;
}

export const CITIES: City[] = [
  {
    slug: "kelowna",
    name: "Kelowna",
    region: "BC",
    lat: 49.888,
    lng: -119.496,
    intro:
      "Kelowna is the Okanagan's biggest city, and the building never really slows down. " +
      "Whether you're renovating a place in Glenmore, sorting out a dock on the lake, or " +
      "wiring a new build up in the Upper Mission, every pro you find here has had their " +
      "government ID and trade ticket checked by a real person before they could take a job.",
  },
  {
    slug: "west-kelowna",
    name: "West Kelowna",
    region: "BC",
    lat: 49.863,
    lng: -119.583,
    intro:
      "Across the bridge in West Kelowna, from Westbank to Smith Creek to Lakeview Heights, " +
      "homeowners want the same thing everyone does: a tradesperson they can actually trust. " +
      "Every West Kelowna pro on Blue Seal is verified by hand before they show up in search.",
  },
  {
    slug: "lake-country",
    name: "Lake Country",
    region: "BC",
    lat: 50.05,
    lng: -119.41,
    intro:
      "From Oyama to Carr's Landing, Lake Country mixes orchards, lakefront homes and brand-new " +
      "subdivisions, and that keeps local trades busy. Find a verified pro near you and keep the " +
      "whole job, from the first quote to the final payment, in one place.",
  },
  {
    slug: "peachland",
    name: "Peachland",
    region: "BC",
    lat: 49.773,
    lng: -119.737,
    intro:
      "Peachland's lakeside homes and steep hillside lots come with their own quirks, so it pays " +
      "to hire someone who can prove their credentials and knows the area. Every Peachland pro " +
      "here has had their ID and trade ticket checked first.",
  },
  {
    slug: "vernon",
    name: "Vernon",
    region: "BC",
    lat: 50.267,
    lng: -119.272,
    intro:
      "From the Okanagan Landing to the BX, Vernon homeowners use Blue Seal to find a tradesperson " +
      "without the usual guesswork. We check each pro's government ID and trade ticket by hand " +
      "before they're listed, so you know who you're hiring.",
  },
  {
    slug: "penticton",
    name: "Penticton",
    region: "BC",
    lat: 49.49,
    lng: -119.589,
    intro:
      "Sitting between two lakes, Penticton sees plenty of repair and renovation work, from older " +
      "downtown homes to new builds out on the benches. Every Penticton pro on Blue Seal is " +
      "verified before they can take a job.",
  },
  {
    slug: "summerland",
    name: "Summerland",
    region: "BC",
    lat: 49.6,
    lng: -119.677,
    intro:
      "Summerland's orchards, acreages and heritage homes each ask something different from a " +
      "tradesperson. Find a verified local pro, get an itemised quote, and run the whole job in " +
      "one place.",
  },
  {
    slug: "kamloops",
    name: "Kamloops",
    region: "BC",
    lat: 50.676,
    lng: -120.34,
    intro:
      "Up in the Thompson Valley, Kamloops homeowners get the same Blue Seal promise as the " +
      "Okanagan: every tradesperson's government ID and trade ticket checked by a real person " +
      "before they can work, then the whole job handled in one place.",
  },
];

export function findCity(slug: string): City | null {
  return CITIES.find((c) => c.slug === slug) ?? null;
}
