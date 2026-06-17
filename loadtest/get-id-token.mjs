#!/usr/bin/env node
// Mint a Firebase ID token for a test user so JMeter can authenticate the
// callable sampler. Prints ONLY the token to stdout (diagnostics go to stderr),
// so it pipes straight into JMeter:
//
//   TOKEN=$(node loadtest/get-id-token.mjs) \
//     jmeter -n -t loadtest/blueseal.jmx -Jtoken="$TOKEN" -l loadtest/out/results.jtl
//
// Credentials are read from (in order): CLI args, env vars, then e2e/.env.local
// (the same file the e2e harness uses). The token is valid ~1 hour.
//
// Usage:
//   node loadtest/get-id-token.mjs [email] [password]
// Env:
//   QA_CLIENT_EMAIL / QA_CLIENT_PASSWORD   (or QA_TRADIE_* — pass via args/env)
//   FB_API_KEY   Firebase Web API key (defaults to the blueseal-762af web key,
//                which is public — it ships in the client bundle)

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function fromEnvFile(key) {
  try {
    const txt = readFileSync(resolve(process.cwd(), "e2e/.env.local"), "utf8");
    const m = txt.match(new RegExp(`^\\s*${key}\\s*=\\s*(.*)\\s*$`, "m"));
    return m ? m[1].trim() : undefined;
  } catch {
    return undefined;
  }
}

const API_KEY =
  process.env.FB_API_KEY || "AIzaSyBAH4g0acwSAvOO7SFE8j5U4q3RptyjUV8";
const email =
  process.argv[2] || process.env.QA_CLIENT_EMAIL || fromEnvFile("QA_CLIENT_EMAIL");
const password =
  process.argv[3] || process.env.QA_CLIENT_PASSWORD || fromEnvFile("QA_CLIENT_PASSWORD");

if (!email || !password) {
  console.error(
    "Missing credentials. Pass `node loadtest/get-id-token.mjs <email> <password>`,\n" +
      "or set QA_CLIENT_EMAIL / QA_CLIENT_PASSWORD (env or e2e/.env.local).",
  );
  process.exit(1);
}

const url = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`;
const res = await fetch(url, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email, password, returnSecureToken: true }),
});
const data = await res.json();

if (!res.ok || !data.idToken) {
  console.error(`Sign-in failed (${res.status}): ${data?.error?.message ?? "unknown error"}`);
  process.exit(1);
}

console.error(`Token minted for ${email} (expires in ${data.expiresIn ?? "3600"}s).`);
process.stdout.write(data.idToken);
