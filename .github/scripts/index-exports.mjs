// Print every Cloud Function re-exported by functions/src/index.ts, one per
// line, as "<exportedName>\t<sourceModule>", sorted.
//
// Used by .github/workflows/deploy.yml to answer "what did this push actually
// change in index.ts?" by comparing the output for two revisions with comm(1),
// instead of treating any index.ts edit as "redeploy all ~200 functions".
// Sorted output is what makes the comm comparison valid.
//
// Every export in index.ts is `export { a, b } from "./mod";` — sometimes
// spanning several lines — so one regex over the whole file covers the format.
// `as` aliases are handled (the exported name is what Firebase deploys), even
// though none are used today.
import { readFileSync } from "node:fs";

const file = process.argv[2];
if (!file) {
  console.error("usage: index-exports.mjs <path-to-index.ts>");
  process.exit(2);
}

const src = readFileSync(file, "utf8");
const pairs = new Set();
for (const match of src.matchAll(/export\s*\{([^}]*)\}\s*from\s*["']([^"']+)["']/g)) {
  for (const raw of match[1].split(",")) {
    const name = raw.trim().split(/\s+as\s+/).pop();
    if (name) pairs.add(`${name}\t${match[2]}`);
  }
}

process.stdout.write([...pairs].sort().join("\n") + "\n");
