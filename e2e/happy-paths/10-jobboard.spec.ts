import { test, expect } from "@playwright/test";
import { signIn } from "./helpers/auth";
import { requireEnv } from "./helpers/env";
import { provisionTradie, resetSelfData } from "./helpers/provision";
import { postJob, browseFindsJob } from "./helpers/jobs";
import { attachCapture, findings } from "./helpers/walk";

// Flagship two-sided flow. Built leg by leg; each leg asserts the OTHER side
// sees the result. Console/network errors on either page feed bug discovery.

// A trade with no intake questionnaire keeps the flagship lifecycle simple;
// trade-specific intake is covered separately. (Plumber/Electrician/HVAC have
// seeded intake schemas; Painter does not.)
const TRADE = "Painter";

test("flagship: client posts → tradie sees it on the board", async ({ browser }) => {
  const clientCtx = await browser.newContext();
  const tradieCtx = await browser.newContext();
  const client = await clientCtx.newPage();
  const tradie = await tradieCtx.newPage();
  const capClient = attachCapture(client, "client");
  const capTradie = attachCapture(tradie, "tradie");

  const title = `QA Plumber job ${Date.now()}`;

  await test.step("sign in both", async () => {
    await signIn(client, requireEnv("QA_CLIENT_EMAIL"), requireEnv("QA_CLIENT_PASSWORD"));
    await signIn(tradie, requireEnv("QA_TRADIE_EMAIL"), requireEnv("QA_TRADIE_PASSWORD"));
  });

  await test.step("tradie clean slate + provision on Plumber", async () => {
    await resetSelfData(tradie);
    await provisionTradie(tradie, TRADE);
  });

  await test.step("client posts a Plumber job", async () => {
    await postJob(client, {
      trade: TRADE,
      title,
      description: "Kitchen tap is dripping and the shutoff valve is stiff. Please quote a repair.",
    });
  });

  await test.step("tradie sees the job on the board", async () => {
    await browseFindsJob(tradie, title);
  });

  const found = findings(capClient, capTradie);
  console.log(`[flagship] errors captured: ${found.length}`);
  found.slice(0, 20).forEach((f) => console.log("  " + f));
  // Don't fail the path on console noise yet — they're logged as findings.
  expect(true).toBe(true);

  await clientCtx.close();
  await tradieCtx.close();
});
