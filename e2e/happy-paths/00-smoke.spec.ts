import { test, expect } from "@playwright/test";
import { signIn, holdsRole, settle } from "./helpers/auth";
import { provisionTradie } from "./helpers/provision";
import { requireEnv } from "./helpers/env";

// Phase 0 smoke: prove the harness can sign in both accounts against the
// deployed site and that each carries its expected roles (black-box, via
// role-gated route access). Validates auth + the two-context model before the
// heavier multi-actor drivers are built on top.

test("smoke: both accounts sign in with expected roles", async ({ browser }) => {
  const clientEmail = requireEnv("QA_CLIENT_EMAIL");
  const clientPass = requireEnv("QA_CLIENT_PASSWORD");
  const tradieEmail = requireEnv("QA_TRADIE_EMAIL");
  const tradiePass = requireEnv("QA_TRADIE_PASSWORD");

  const clientCtx = await browser.newContext();
  const tradieCtx = await browser.newContext();
  const client = await clientCtx.newPage();
  const tradie = await tradieCtx.newPage();

  const clientErrors: string[] = [];
  client.on("console", (m) => m.type() === "error" && clientErrors.push(m.text()));
  const tradieErrors: string[] = [];
  tradie.on("console", (m) => m.type() === "error" && tradieErrors.push(m.text()));

  await test.step("sign in client", () => signIn(client, clientEmail, clientPass));
  await test.step("sign in tradie", () => signIn(tradie, tradieEmail, tradiePass));

  await test.step("client holds only client role", async () => {
    expect(await holdsRole(client, "/admin/users"), "client should NOT be admin").toBe(false);
    expect(await holdsRole(client, "/qa"), "client should NOT be qa").toBe(false);
  });

  await test.step("tradie holds tradesperson + admin + qa", async () => {
    // A tradesperson who hasn't finished onboarding is sent to /onboarding (NOT
    // bounced to Home), so landing there confirms the tradesperson role is held.
    await tradie.goto("/dashboard/tradie");
    await settle(tradie);
    const tradieLanded = new URL(tradie.url()).pathname;
    console.log(`[smoke] tradie /dashboard/tradie -> ${tradieLanded}`);
    expect(
      tradieLanded.startsWith("/dashboard/tradie") || tradieLanded.startsWith("/onboarding"),
      "tradie missing tradesperson role",
    ).toBe(true);
    expect(await holdsRole(tradie, "/admin/users"), "tradie missing admin").toBe(true);
    expect(await holdsRole(tradie, "/qa"), "tradie missing qa").toBe(true);
  });

  await test.step("provision tradie as approved tradesperson (Plumber)", async () => {
    await provisionTradie(tradie, "Plumber");
    // After provisioning, the tradie dashboard renders instead of redirecting
    // to onboarding.
    await tradie.goto("/dashboard/tradie");
    await settle(tradie);
    expect(new URL(tradie.url()).pathname).toBe("/dashboard/tradie");
  });

  // Surface (don't fail on) console errors — they feed bug discovery later.
  console.log(`[smoke] client console errors: ${clientErrors.length}`);
  clientErrors.slice(0, 8).forEach((e) => console.log("  client.err:", e));
  console.log(`[smoke] tradie console errors: ${tradieErrors.length}`);
  tradieErrors.slice(0, 8).forEach((e) => console.log("  tradie.err:", e));

  await clientCtx.close();
  await tradieCtx.close();
});
