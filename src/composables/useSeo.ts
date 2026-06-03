import { computed, toValue, type MaybeRefOrGetter } from "vue";
import { useHead } from "@unhead/vue";
import { useRoute } from "vue-router";
import {
  DEFAULT_DESCRIPTION,
  DEFAULT_OG_IMAGE,
  OG_LOCALE,
  SITE_NAME,
  absoluteUrl,
  pageTitle,
} from "@/seo/site";
import type { JsonLd } from "@/seo/jsonld";

export interface SeoInput {
  /** Page title without the brand suffix. Omit on the homepage. */
  title?: string;
  /** Meta description. Falls back to the site default. */
  description?: string;
  /** Canonical path (no query). Defaults to the current route path. */
  path?: string;
  /** Absolute or root-relative social-share image. */
  image?: string;
  /** Open Graph object type. */
  type?: "website" | "article" | "profile";
  /** Emit robots noindex (auth pages, 404, etc.). */
  noindex?: boolean;
  /** One or more JSON-LD nodes to embed. */
  jsonLd?: JsonLd | JsonLd[];
}

/**
 * Drives the document <head> for a route: title, description, canonical, Open
 * Graph, Twitter cards and JSON-LD. Accepts a plain object or a getter so
 * dynamic pages (profiles, search) can update the head once data loads.
 *
 * Static content pages are ALSO prerendered with the same metadata baked in
 * (scripts/prerender.ts) so crawlers and LLMs that don't run JS still get it;
 * @unhead reconciles its keyed tags against those on hydration.
 */
export function useSeo(input: MaybeRefOrGetter<SeoInput>) {
  const route = useRoute();

  const resolved = computed(() => {
    const seo = toValue(input);
    const description = seo.description?.trim() || DEFAULT_DESCRIPTION;
    const canonicalPath = seo.path ?? route.path;
    const url = absoluteUrl(canonicalPath);
    const image = seo.image ? absoluteUrl(seo.image) : DEFAULT_OG_IMAGE;
    const title = pageTitle(seo.title);
    const type = seo.type ?? "website";
    const nodes = !seo.jsonLd ? [] : Array.isArray(seo.jsonLd) ? seo.jsonLd : [seo.jsonLd];
    return { title, description, url, image, type, noindex: !!seo.noindex, nodes };
  });

  useHead(() => {
    const r = resolved.value;
    return {
      title: r.title,
      link: [{ rel: "canonical", href: r.url }],
      meta: [
        { name: "description", content: r.description },
        ...(r.noindex ? [{ name: "robots", content: "noindex, nofollow" }] : []),
        // Open Graph
        { property: "og:type", content: r.type },
        { property: "og:site_name", content: SITE_NAME },
        { property: "og:locale", content: OG_LOCALE },
        { property: "og:title", content: r.title },
        { property: "og:description", content: r.description },
        { property: "og:url", content: r.url },
        { property: "og:image", content: r.image },
        // Twitter
        { name: "twitter:card", content: "summary_large_image" },
        { name: "twitter:title", content: r.title },
        { name: "twitter:description", content: r.description },
        { name: "twitter:image", content: r.image },
      ],
      script: r.nodes.map((node, i) => ({
        type: "application/ld+json",
        innerHTML: JSON.stringify(node),
        key: `ld-${i}`,
      })),
    };
  });
}
