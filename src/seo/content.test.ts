import { describe, expect, it } from "vitest";
import { getPrerenderRoutes } from "@/seo/content";
import { RECRUIT_HOMEPAGE } from "@/seo/site";
import { TRADES } from "@/data/trades";
import { HELP_CONTENT_SEED } from "@/data/help";
import { tradiePersonLd } from "@/seo/jsonld";
import { mdToText, clampDescription, escapeHtml } from "@/seo/markdown";

const routes = getPrerenderRoutes();
const byPath = new Map(routes.map((r) => [r.path, r]));
const ld = (path: string) => byPath.get(path)?.seo.jsonLd ?? [];
const hasType = (path: string, type: string) =>
  ld(path).some((node) => node["@type"] === type);

describe("getPrerenderRoutes", () => {
  it("covers the core content pages", () => {
    for (const p of ["/", "/search", "/trades", "/help", "/faq", "/privacy", "/terms"]) {
      expect(byPath.has(p), `missing route ${p}`).toBe(true);
    }
  });

  it("has a landing page for every trade", () => {
    for (const t of TRADES) {
      expect(byPath.has(`/trades/${t.key}`), `missing trade page ${t.key}`).toBe(true);
    }
  });

  it("has a page for every help article", () => {
    for (const a of HELP_CONTENT_SEED.articles) {
      expect(byPath.has(`/help/${a.slug}`), `missing help page ${a.slug}`).toBe(true);
    }
  });

  it("has no duplicate paths", () => {
    expect(byPath.size).toBe(routes.length);
  });

  it("gives every route a canonical path matching its route and a non-empty body", () => {
    for (const r of routes) {
      expect(r.seo.path ?? r.path).toBe(r.path);
      expect(r.body.length).toBeGreaterThan(0);
    }
  });

  it("titles every page (the homepage title is phase-dependent)", () => {
    for (const r of routes) {
      // Homepage: a recruitment title while onboarding, the default brand title
      // (no explicit title) in the public phase — so don't assert on it here.
      if (r.path === "/") continue;
      expect(r.seo.title, `no title for ${r.path}`).toBeTruthy();
    }
  });

  it("marks auth pages noindex and keeps them out of the sitemap set", () => {
    expect(byPath.get("/sign-in")?.seo.noindex).toBe(true);
    expect(byPath.get("/sign-up")?.seo.noindex).toBe(true);
    const indexable = routes.filter((r) => !r.seo.noindex);
    expect(indexable.every((r) => !["/sign-in", "/sign-up", "/forgot-password"].includes(r.path)));
    expect(indexable.length).toBeLessThan(routes.length);
  });

  it("emits the expected structured data", () => {
    expect(hasType("/", "Organization")).toBe(true);
    expect(hasType("/", "WebSite")).toBe(true);
    // The homepage carries FAQ structured data on the client-first homepage; in
    // recruit mode it's the recruitment page (Organization + WebSite only).
    expect(hasType("/", "FAQPage")).toBe(!RECRUIT_HOMEPAGE);
    expect(hasType("/faq", "FAQPage")).toBe(true);
    expect(hasType("/trades/plumber", "Service")).toBe(true);
    expect(hasType("/help/what-is-blue-seal", "Article")).toBe(true);
    // every JSON-LD node declares its schema context + type
    for (const r of routes) {
      for (const node of r.seo.jsonLd ?? []) {
        expect(node["@context"]).toBe("https://schema.org");
        expect(node["@type"]).toBeTruthy();
      }
    }
  });
});

describe("tradiePersonLd", () => {
  it("omits aggregateRating when there are no reviews", () => {
    const node = tradiePersonLd({ name: "Jane Doe", path: "/tradies/x", trade: "Plumber" });
    expect(node.aggregateRating).toBeUndefined();
    expect(node["@type"]).toBe("Person");
  });

  it("includes aggregateRating when reviews exist", () => {
    const node = tradiePersonLd({
      name: "Jane Doe",
      path: "/tradies/x",
      ratingValue: 4.8,
      reviewCount: 12,
    });
    expect(node.aggregateRating).toMatchObject({ ratingValue: 4.8, reviewCount: 12 });
  });
});

describe("markdown helpers", () => {
  it("strips markdown to plain text", () => {
    expect(mdToText("**Bold** and [a link](https://x.com)")).toBe("Bold and a link");
    expect(mdToText("- one\n- two")).toBe("one two");
  });

  it("clamps long descriptions on a word boundary with an ellipsis", () => {
    const long = "word ".repeat(60).trim();
    const out = clampDescription(long, 50);
    expect(out.length).toBeLessThanOrEqual(51);
    expect(out.endsWith("…")).toBe(true);
  });

  it("leaves short descriptions untouched", () => {
    expect(clampDescription("short", 160)).toBe("short");
  });

  it("escapes HTML-significant characters", () => {
    expect(escapeHtml(`<a href="x">&'`)).toBe("&lt;a href=&quot;x&quot;&gt;&amp;&#39;");
  });
});
