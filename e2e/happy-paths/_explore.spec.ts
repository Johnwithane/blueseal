import { test } from "@playwright/test";
import { signIn, settle } from "./helpers/auth";
import { requireEnv } from "./helpers/env";

// Dev tool (not a real path test): point it at a route to dump the rendered
// interactable elements so drivers can be built from ground truth.
//   EXPLORE_ROUTE=/jobs/post EXPLORE_AS=client npx playwright test ... _explore
test("explore a route", async ({ browser }) => {
  const route = process.env.EXPLORE_ROUTE || "/jobs/post";
  const as = process.env.EXPLORE_AS || "client";
  const email = requireEnv(as === "tradie" ? "QA_TRADIE_EMAIL" : "QA_CLIENT_EMAIL");
  const pass = requireEnv(as === "tradie" ? "QA_TRADIE_PASSWORD" : "QA_CLIENT_PASSWORD");

  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await signIn(page, email, pass);
  await page.goto(route);
  await settle(page);

  if (process.env.EXPLORE_CLICK) {
    await page.getByRole("button", { name: new RegExp(process.env.EXPLORE_CLICK, "i") }).first().click();
    await page.waitForTimeout(800);
  }

  const dump = await page.evaluate(() => {
    const visible = (el: Element) => !!(el as HTMLElement).offsetParent || (el as HTMLElement).getClientRects().length > 0;
    const t = (el: Element) => (el as HTMLElement).innerText?.trim().replace(/\s+/g, " ").slice(0, 70) || "";
    const buttons = [...document.querySelectorAll("button")]
      .filter(visible)
      .map((b) => t(b) || b.getAttribute("aria-label") || "")
      .filter(Boolean);
    const fields = [...document.querySelectorAll("input,textarea,select,.p-multiselect,.p-select")].filter(visible).map((i) => {
      const e = i as HTMLInputElement;
      return {
        tag: i.tagName.toLowerCase() + (i.className.includes("p-multiselect") ? ".p-multiselect" : i.className.includes("p-select") ? ".p-select" : ""),
        type: e.type || "",
        placeholder: e.placeholder || "",
        ariaLabel: i.getAttribute("aria-label") || "",
        id: e.id || "",
      };
    });
    const headings = [...document.querySelectorAll("h1,h2,h3,label")].filter(visible).map(t).filter(Boolean);
    const links = [...document.querySelectorAll("a[href]")]
      .filter(visible)
      .map((a) => (a as HTMLAnchorElement).getAttribute("href") || "")
      .filter((h) => /\/jobs\/|\/request|\/invoices/.test(h));
    return { url: location.pathname, buttons, fields, headings, links: [...new Set(links)].slice(0, 20) };
  });
  console.log("EXPLORE_DUMP_START");
  console.log(JSON.stringify(dump, null, 2));
  console.log("EXPLORE_DUMP_END");
  await ctx.close();
});
