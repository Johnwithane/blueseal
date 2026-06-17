import { type Page } from "@playwright/test";

// Third-party / known-benign noise we don't want polluting bug discovery.
const NOISE = [
  /google\.com\/(g\/collect|ads|images\/cleardot)/i,
  /google-analytics\.com/i,
  /googletagmanager\.com/i,
  /content security policy/i,
  /favicon/i,
  // Firestore real-time listener long-poll channels get ERR_ABORTED on every
  // navigation/teardown — benign, not a bug.
  /firestore\.googleapis\.com\/.*\/Listen\/channel/i,
  /\/Write\/channel/i,
];
const isNoise = (s: string) => NOISE.some((r) => r.test(s));

export interface Capture {
  consoleErrors: string[];
  pageErrors: string[];
  failedRequests: string[];
}

// Attach console / pageerror / failed-request / 4xx-5xx capture to a page. These
// feed bug discovery — a clean run has empty arrays.
export function attachCapture(page: Page, label: string): Capture {
  const cap: Capture = { consoleErrors: [], pageErrors: [], failedRequests: [] };
  page.on("console", (m) => {
    const t = m.text();
    if (m.type() === "error" && !isNoise(t)) cap.consoleErrors.push(`[${label}] ${t.slice(0, 280)}`);
  });
  page.on("pageerror", (e) => {
    const t = String(e);
    if (!isNoise(t)) cap.pageErrors.push(`[${label}] ${t.slice(0, 280)}`);
  });
  page.on("requestfailed", (r) => {
    const u = r.url();
    if (!isNoise(u)) cap.failedRequests.push(`[${label}] ${r.failure()?.errorText ?? "failed"} ${u.slice(0, 180)}`);
  });
  page.on("response", (r) => {
    const u = r.url();
    if (
      r.status() >= 400 &&
      !isNoise(u) &&
      /cloudfunctions|run\.app|firestore|identitytoolkit|securetoken|firebasestorage|googleapis/.test(u)
    ) {
      cap.failedRequests.push(`[${label}] HTTP ${r.status()} ${u.slice(0, 180)}`);
    }
  });
  return cap;
}

// Dump the current page's visible buttons / headings / fields so a driver can be
// built from ground truth at any point in a flow. Prints a single JSON line.
export async function dumpPage(page: Page, label = ""): Promise<void> {
  const d = await page.evaluate(() => {
    const vis = (el: Element) =>
      !!(el as HTMLElement).offsetParent || (el as HTMLElement).getClientRects().length > 0;
    const t = (el: Element) => (el as HTMLElement).innerText?.trim().replace(/\s+/g, " ").slice(0, 60) || "";
    return {
      url: location.pathname,
      buttons: [...document.querySelectorAll("button")]
        .filter(vis)
        .map((b) => t(b) || b.getAttribute("aria-label") || "")
        .filter(Boolean),
      headings: [...document.querySelectorAll("h1,h2,h3,label,[role=tab]")].filter(vis).map(t).filter(Boolean),
      fields: [...document.querySelectorAll("input,textarea,.p-select,.p-multiselect")]
        .filter(vis)
        .map((i) => ({ tag: i.tagName.toLowerCase(), ph: (i as HTMLInputElement).placeholder || "", id: (i as HTMLElement).id || "" })),
    };
  });
  console.log(`[dump ${label}] ${JSON.stringify(d)}`);
}

// Flatten captures into a list of findings strings (empty = clean).
export function findings(...caps: Capture[]): string[] {
  const out: string[] = [];
  for (const c of caps) {
    c.pageErrors.forEach((e) => out.push(`PAGEERROR ${e}`));
    c.consoleErrors.forEach((e) => out.push(`CONSOLE  ${e}`));
    c.failedRequests.forEach((e) => out.push(`REQFAIL  ${e}`));
  }
  return out;
}
