// Minimal static file server for E2E tests — mirrors the parts of Firebase
// Hosting's resolution that matter for our prerender + SPA setup:
//   1. exact static file (e.g. /assets/x.js, /sitemap.xml)
//   2. <path>/index.html  (clean URLs → prerendered pages, e.g. /trades/plumber)
//   3. fall back to /200.html  (the SPA shell, per firebase.json's `**` rewrite)
//
// Used as Playwright's webServer (see playwright.config.ts). Serves the built
// dist/ — run `npm run build` first. Intentionally tiny + dependency-free.

import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join, normalize, extname } from "node:path";

const distDir = fileURLToPath(new URL("../dist", import.meta.url));
const port = Number(process.env.PORT ?? 4173);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

async function readIfFile(absPath) {
  try {
    const s = await stat(absPath);
    if (s.isFile()) return await readFile(absPath);
  } catch {
    /* not found */
  }
  return null;
}

async function resolve(pathname) {
  // Block traversal: normalise and keep within distDir.
  const rel = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, "");
  const base = join(distDir, rel);
  if (!base.startsWith(distDir)) return null;

  if (pathname.endsWith("/")) {
    return readIfFile(join(base, "index.html"));
  }
  return (await readIfFile(base)) ?? (await readIfFile(join(base, "index.html")));
}

const server = createServer(async (req, res) => {
  const pathname = new URL(req.url ?? "/", `http://localhost:${port}`).pathname;
  let body = await resolve(pathname);
  let status = 200;
  if (!body) {
    // SPA fallback — exactly what firebase.json `**` → /200.html does.
    body = await readIfFile(join(distDir, "200.html"));
    if (!body) {
      res.writeHead(500).end("dist/200.html missing — run `npm run build` first");
      return;
    }
    status = 200;
  }
  const ext = pathname.endsWith("/") ? ".html" : extname(pathname) || ".html";
  res.writeHead(status, { "Content-Type": MIME[ext] ?? "application/octet-stream" });
  res.end(body);
});

server.listen(port, () => {
  console.log(`serve-dist: http://localhost:${port} → ${distDir}`);
});
