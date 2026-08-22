// Resolve changed function sources to the Cloud Functions that actually use
// them, by walking the import graph out from functions/src/index.ts.
//
// WHY: deploy.yml maps a changed file to a deploy target by assuming the file's
// path matches an `export { … } from "./path"` line in index.ts. That holds for
// callables (one file, one export) but not for the modules they share — a
// webhook handler, a helper like payments/serviceFee.ts. Those have no export
// entry, so the workflow fell back to deploying ALL ~200 functions, which its
// own comments record as reliably failing (Functions mutation quota, then the
// us-central1 Cloud Run CPU quota). In practice that meant no change to a
// webhook handler could ship cleanly.
//
// This resolves the real answer instead: functions/src/payments/handlers/
// chargeDispute.ts is imported only by stripeWebhook.ts, so it deploys as
// `functions:stripeWebhook` — one target, no quota risk.
//
// Usage:  dependents.mjs <index.ts> <changed.ts> [changed.ts …]
//   stdout : sorted export names to deploy, one per line
//   exit 0 : every changed file resolved
//   exit 3 : at least one file is not reachable from index.ts — the caller
//            must fall back to a full deploy rather than silently skipping it.
//   exit 2 : bad usage / unreadable input (caller also falls back)
//
// Fails SAFE in every ambiguous case: an unresolvable import, a file outside
// the graph, or a parse problem all widen to a full deploy. Deploying too much
// is a slow release; deploying too little ships a client calling a function
// that isn't live.

import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve, relative } from "node:path";

const [indexPath, ...changed] = process.argv.slice(2);
if (!indexPath || changed.length === 0) {
  console.error("usage: dependents.mjs <index.ts> <changed.ts> [changed.ts …]");
  process.exit(2);
}

const SRC_ROOT = resolve(dirname(indexPath));

/** Resolve a relative import specifier to a real .ts file, or null. */
function resolveImport(fromFile, spec) {
  if (!spec.startsWith(".")) return null; // package import — not our graph
  const base = resolve(dirname(fromFile), spec);
  for (const candidate of [`${base}.ts`, `${base}/index.ts`]) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/** Every relative import in a file, resolved to absolute paths. */
function importsOf(file) {
  let src;
  try {
    src = readFileSync(file, "utf8");
  } catch {
    return null; // unreadable — caller widens to a full deploy
  }
  const out = [];
  // Covers `import … from "x"`, `export … from "x"`, and `import("x")`.
  const patterns = [
    /(?:import|export)[\s\S]*?from\s*["']([^"']+)["']/g,
    /import\s*\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const re of patterns) {
    for (const m of src.matchAll(re)) {
      const resolved = resolveImport(file, m[1]);
      if (resolved) out.push(resolved);
    }
  }
  return out;
}

// 1. index.ts → [{ exportName, entryFile }]
let indexSrc;
try {
  indexSrc = readFileSync(indexPath, "utf8");
} catch {
  console.error(`cannot read ${indexPath}`);
  process.exit(2);
}

const entries = [];
for (const match of indexSrc.matchAll(/export\s*\{([^}]*)\}\s*from\s*["']([^"']+)["']/g)) {
  const entryFile = resolveImport(resolve(indexPath), match[2]);
  if (!entryFile) {
    console.error(`unresolvable index.ts import: ${match[2]}`);
    process.exit(2);
  }
  for (const raw of match[1].split(",")) {
    const name = raw.trim().split(/\s+as\s+/).pop();
    if (name) entries.push({ name, entryFile });
  }
}
if (entries.length === 0) {
  console.error("no exports parsed from index.ts");
  process.exit(2);
}

// 2. For each export, the transitive closure of files it pulls in.
//    Memoized per entry file: many exports share one module subtree.
const closureCache = new Map();
function closureOf(entryFile) {
  const cached = closureCache.get(entryFile);
  if (cached) return cached;
  const seen = new Set();
  const stack = [entryFile];
  while (stack.length > 0) {
    const file = stack.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    const deps = importsOf(file);
    if (deps === null) return null; // unreadable file → widen
    stack.push(...deps);
  }
  closureCache.set(entryFile, seen);
  return seen;
}

// 3. Invert: changed file → the exports whose closure contains it.
const targets = new Set();
let unresolved = false;

for (const rawPath of changed) {
  const file = resolve(rawPath);
  let matched = false;
  for (const { name, entryFile } of entries) {
    const closure = closureOf(entryFile);
    if (closure === null) {
      unresolved = true;
      break;
    }
    if (closure.has(file)) {
      targets.add(name);
      matched = true;
    }
  }
  if (unresolved) break;
  if (!matched) {
    // Reachable by nothing we deploy: a genuinely orphaned file, or one this
    // parser can't follow. Either way, don't guess.
    console.error(`no deployed function imports ${relative(SRC_ROOT, file)}`);
    unresolved = true;
    break;
  }
}

if (unresolved) process.exit(3);

process.stdout.write([...targets].sort().join("\n") + "\n");
