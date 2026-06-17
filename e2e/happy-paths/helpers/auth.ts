import { type Page } from "@playwright/test";

// The app removes the #bs-splash boot overlay once auth init + mount completes.
// Waiting for it to detach is a reliable "the SPA is booted and the router guard
// has run" signal — far more robust than networkidle (Firestore websockets keep
// the network busy forever).
export async function settle(page: Page): Promise<void> {
  await page
    .locator("#bs-splash")
    .waitFor({ state: "detached", timeout: 30_000 })
    .catch(() => {
      /* splash may already be gone on a client-side nav */
    });
  // Let any client-side router-guard redirect resolve.
  await page.waitForTimeout(900);
}

export async function signIn(page: Page, email: string, password: string): Promise<void> {
  await page.goto("/sign-in");
  await settle(page);
  await page.locator('input[type="email"]').first().fill(email);
  // PrimeVue <Password> wraps the input in .p-password and doesn't forward the
  // autocomplete attr, so target the inner input directly.
  await page.locator(".p-password input").first().fill(password);
  // The page chrome also has a "Sign in" link, so scope to the form's submit.
  await page.locator('form button[type="submit"]').click();
  // Sign-in redirects to /dashboard (or a role dashboard). Wait until we leave
  // /sign-in; throws on failure so a bad password surfaces as a clear error.
  await page.waitForURL((url) => !url.pathname.startsWith("/sign-in"), { timeout: 30_000 });
  await settle(page);
}

// Black-box role check: navigate to a role-gated route. If the user holds the
// role the route renders; if not, the router guard bounces them to Home ("/").
// Returns true when we land on (or under) the requested path.
export async function holdsRole(page: Page, route: string): Promise<boolean> {
  const target = route.split("?")[0];
  await page.goto(route);
  await settle(page);
  return new URL(page.url()).pathname.startsWith(target);
}
