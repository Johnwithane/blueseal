import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Minimal .env loader (no dotenv dep). Reads e2e/.env.local relative to the repo
// root (cwd when Playwright is invoked from the repo root) and populates
// process.env for any key not already set.
let loaded = false;
export function loadEnv(): void {
  if (loaded) return;
  loaded = true;
  try {
    const txt = readFileSync(resolve(process.cwd(), "e2e/.env.local"), "utf8");
    for (const line of txt.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
    }
  } catch {
    /* env file is optional (e.g. CI) */
  }
}

export function requireEnv(key: string): string {
  loadEnv();
  const v = process.env[key];
  if (!v) throw new Error(`Missing required env var ${key} (set it in e2e/.env.local)`);
  return v;
}
