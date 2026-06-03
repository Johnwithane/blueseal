import { describe, it, expect, beforeEach } from "vitest";
import { defineComponent, h, nextTick } from "vue";
import { mount } from "@vue/test-utils";
import { createHead } from "@unhead/vue/client";
import { createRouter, createMemoryHistory, type Router } from "vue-router";
import { useSeo, type SeoInput } from "./useSeo";

// Runtime proof that the @unhead integration works in a DOM and — crucially —
// that on a prerendered page (where the same tags are already baked into
// <head>) hydration UPDATES them in place rather than appending duplicates.
// This is the behaviour the whole prerender strategy relies on.

function makeRouter(): Router {
  return createRouter({
    history: createMemoryHistory(),
    routes: [{ path: "/:p(.*)*", component: { render: () => h("div") } }],
  });
}

async function mountWithSeo(seo: SeoInput) {
  const router = makeRouter();
  await router.push("/find");
  await router.isReady();
  const head = createHead();
  const Comp = defineComponent({
    setup() {
      useSeo(() => seo);
      return () => h("div");
    },
  });
  const wrapper = mount(Comp, { global: { plugins: [router, head] } });
  // Let unhead's debounced DOM patch run.
  await nextTick();
  await new Promise((r) => setTimeout(r, 10));
  await nextTick();
  return wrapper;
}

const countSel = (sel: string) => document.head.querySelectorAll(sel).length;

describe("useSeo runtime <head>", () => {
  beforeEach(() => {
    document.head.innerHTML = "";
    document.title = "";
  });

  it("sets title, description, canonical, OG/Twitter and JSON-LD", async () => {
    await mountWithSeo({
      title: "Find a plumber",
      description: "Hello world description",
      path: "/find",
      jsonLd: [{ "@context": "https://schema.org", "@type": "Service", name: "Plumbing" }],
    });

    expect(document.title).toBe("Find a plumber | Blue Seal");
    expect(
      document.head.querySelector('meta[name="description"]')?.getAttribute("content"),
    ).toBe("Hello world description");
    expect(
      document.head.querySelector('link[rel="canonical"]')?.getAttribute("href"),
    ).toBe("https://blueseal.app/find");
    expect(
      document.head.querySelector('meta[property="og:title"]')?.getAttribute("content"),
    ).toBe("Find a plumber | Blue Seal");
    expect(document.head.querySelector('meta[name="twitter:card"]')?.getAttribute("content")).toBe(
      "summary_large_image",
    );
    expect(countSel('script[type="application/ld+json"]')).toBe(1);
  });

  it("does NOT duplicate tags already baked into <head> by the prerenderer", async () => {
    // Simulate a prerendered page: the exact tags useSeo emits are already
    // present (matching dedupe keys; JSON-LD carries data-hid="ld-0").
    document.head.innerHTML =
      '<title>OLD | Blue Seal</title>' +
      '<meta name="description" content="OLD DESC">' +
      '<link rel="canonical" href="https://blueseal.app/find">' +
      '<meta property="og:title" content="OLD | Blue Seal">' +
      '<meta property="og:url" content="https://blueseal.app/find">' +
      '<meta name="twitter:card" content="summary_large_image">' +
      '<script type="application/ld+json" data-hid="ld-0">{"old":true}</script>';

    await mountWithSeo({
      title: "Find a plumber",
      description: "NEW DESC",
      path: "/find",
      jsonLd: [{ "@context": "https://schema.org", "@type": "Service", name: "Plumbing" }],
    });

    // Exactly one of each — adopted + updated in place, not appended.
    expect(countSel('meta[name="description"]')).toBe(1);
    expect(countSel('link[rel="canonical"]')).toBe(1);
    expect(countSel('meta[property="og:title"]')).toBe(1);
    expect(countSel('meta[property="og:url"]')).toBe(1);
    expect(countSel('meta[name="twitter:card"]')).toBe(1);
    expect(countSel('script[type="application/ld+json"]')).toBe(1);

    // And the values were updated to the live ones.
    expect(
      document.head.querySelector('meta[name="description"]')?.getAttribute("content"),
    ).toBe("NEW DESC");
    expect(document.title).toBe("Find a plumber | Blue Seal");
  });

  it("emits robots noindex when requested", async () => {
    await mountWithSeo({ title: "Sign in", noindex: true });
    expect(
      document.head.querySelector('meta[name="robots"]')?.getAttribute("content"),
    ).toBe("noindex, nofollow");
  });
});
