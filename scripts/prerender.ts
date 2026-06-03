// ---------------------------------------------------------------------------
// Post-build prerender. Runs after `vite build` (see package.json "build").
//
// Why this exists: Blue Seal is a client-rendered SPA, and most LLM crawlers
// (and a non-trivial slice of search crawling) do NOT execute JavaScript. This
// script bakes real HTML — title, meta, Open Graph/Twitter, JSON-LD and the
// page's visible text — into static files per content route, so crawlers and
// LLMs get the full content without running the app. Real users still get the
// live SPA, which hydrates over the baked markup (@unhead reconciles its keyed
// <head> tags against the baked ones — see src/composables/useSeo.ts).
//
// It also emits sitemap.xml and llms.txt.
//
// Run under Node via tsx; it imports the framework-free SEO modules directly.
// ---------------------------------------------------------------------------

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { getPrerenderRoutes, type PrerenderRoute } from "../src/seo/content";
import {
  SITE_NAME,
  SITE_TAGLINE,
  OG_LOCALE,
  DEFAULT_OG_IMAGE,
  DEFAULT_DESCRIPTION,
  absoluteUrl,
  pageTitle,
} from "../src/seo/site";

const distDir = fileURLToPath(new URL("../dist", import.meta.url));
const templatePath = join(distDir, "index.html");

const SEO_BLOCK_RE = /<!-- seo:start[\s\S]*?seo:end -->/;
const TITLE_RE = /<title>[\s\S]*?<\/title>/;
const APP_RE = /<div id="app"><\/div>/;

function attr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Build the <head> SEO block for a route. Mirrors what useSeo() emits at
 * runtime so @unhead adopts these exact tags on hydration (dedupe keys: meta by
 * name/property, link by rel=canonical, JSON-LD scripts by data-hid ↔ useSeo's
 * `key: ld-N`) instead of appending duplicates.
 */
function buildSeoBlock(route: PrerenderRoute): string {
  const { seo } = route;
  const title = pageTitle(seo.title);
  const description = (seo.description ?? DEFAULT_DESCRIPTION).trim();
  const url = absoluteUrl(seo.path ?? route.path);
  const image = DEFAULT_OG_IMAGE;
  const type = seo.type ?? "website";

  const tags: string[] = [
    `<meta name="description" content="${attr(description)}" />`,
    `<link rel="canonical" href="${attr(url)}" />`,
  ];
  if (seo.noindex) tags.push(`<meta name="robots" content="noindex, nofollow" />`);
  tags.push(
    `<meta property="og:type" content="${attr(type)}" />`,
    `<meta property="og:site_name" content="${attr(SITE_NAME)}" />`,
    `<meta property="og:locale" content="${OG_LOCALE}" />`,
    `<meta property="og:title" content="${attr(title)}" />`,
    `<meta property="og:description" content="${attr(description)}" />`,
    `<meta property="og:url" content="${attr(url)}" />`,
    `<meta property="og:image" content="${attr(image)}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${attr(title)}" />`,
    `<meta name="twitter:description" content="${attr(description)}" />`,
    `<meta name="twitter:image" content="${attr(image)}" />`,
  );
  (seo.jsonLd ?? []).forEach((node, i) => {
    // </script> inside JSON would break the tag; escape the closing slash.
    const json = JSON.stringify(node).replace(/<\//g, "<\\/");
    tags.push(`<script type="application/ld+json" data-hid="ld-${i}">${json}</script>`);
  });
  return `<!-- seo:start -->\n    ${tags.join("\n    ")}\n    <!-- seo:end -->`;
}

function renderPage(template: string, route: PrerenderRoute): string {
  const title = pageTitle(route.seo.title);
  let html = template;
  if (!SEO_BLOCK_RE.test(html)) {
    throw new Error("Prerender: SEO marker block not found in dist/index.html");
  }
  if (!APP_RE.test(html)) {
    throw new Error('Prerender: <div id="app"></div> mount point not found');
  }
  html = html.replace(SEO_BLOCK_RE, buildSeoBlock(route));
  html = html.replace(TITLE_RE, `<title>${attr(title)}</title>`);
  // Bake the visible content into the mount point. The SPA replaces it on
  // mount; crawlers/LLMs that don't run JS read it as the page body.
  html = html.replace(APP_RE, `<div id="app">${route.body}</div>`);
  return html;
}

function writePage(routePath: string, html: string): void {
  // "/" → dist/index.html; "/foo/bar" → dist/foo/bar/index.html (Firebase
  // Hosting serves <dir>/index.html for a clean URL).
  const rel = routePath === "/" ? "index.html" : join(routePath.replace(/^\//, ""), "index.html");
  const outPath = join(distDir, rel);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, html, "utf8");
}

function buildSitemap(routes: PrerenderRoute[]): string {
  const today = new Date().toISOString().slice(0, 10);
  const urls = routes
    .filter((r) => !r.seo.noindex)
    .map(
      (r) =>
        `  <url>\n    <loc>${absoluteUrl(r.seo.path ?? r.path)}</loc>\n` +
        `    <lastmod>${today}</lastmod>\n` +
        `    <changefreq>${r.changefreq}</changefreq>\n` +
        `    <priority>${r.priority.toFixed(1)}</priority>\n  </url>`,
    )
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

function buildLlmsTxt(routes: PrerenderRoute[]): string {
  const link = (r: PrerenderRoute) => `- [${r.seo.title ?? SITE_NAME}](${absoluteUrl(r.seo.path ?? r.path)})`;
  const isTrade = (r: PrerenderRoute) => r.path.startsWith("/trades/");
  const isHelp = (r: PrerenderRoute) => r.path.startsWith("/help/");
  const core = routes.filter((r) => !r.seo.noindex && !isTrade(r) && !isHelp(r));
  const trades = routes.filter(isTrade);
  const help = routes.filter(isHelp);

  return [
    `# ${SITE_NAME}`,
    "",
    `> ${SITE_TAGLINE} ${DEFAULT_DESCRIPTION}`,
    "",
    "Blue Seal is a Canadian platform that connects homeowners with manually verified " +
      "tradespeople. Every tradesperson is checked for government ID, trade certification, " +
      "insurance and WSIB / workers' comp before they can take work. Each job runs in a single " +
      "thread with chat, an itemised quote, a status board, in-app payment and mutual reviews.",
    "",
    "## Key pages",
    ...core.map(link),
    "",
    "## Trades",
    ...trades.map(link),
    "",
    "## Help & guides",
    ...help.map(link),
    "",
  ].join("\n");
}

// --- run --------------------------------------------------------------------

const template = readFileSync(templatePath, "utf8");
const routes = getPrerenderRoutes();

// Neutral SPA shell for unknown/dynamic routes (Firebase `**` rewrite target).
// Keeps the default <head> + empty mount so dynamic pages aren't served the
// homepage's baked content/canonical.
writeFileSync(join(distDir, "200.html"), template, "utf8");

for (const route of routes) {
  writePage(route.path, renderPage(template, route));
}

writeFileSync(join(distDir, "sitemap.xml"), buildSitemap(routes), "utf8");
writeFileSync(join(distDir, "llms.txt"), buildLlmsTxt(routes), "utf8");

const indexed = routes.filter((r) => !r.seo.noindex).length;
console.log(
  `✔ Prerendered ${routes.length} routes (${indexed} in sitemap) + 200.html, sitemap.xml, llms.txt`,
);
