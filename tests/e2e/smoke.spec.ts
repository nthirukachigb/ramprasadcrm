import { expect, test } from "@playwright/test";

/**
 * Smoke test. Requires DEMO_MODE=true, a reachable Supabase project, the
 * foundation migration applied and demo users seeded.
 *
 *   npm run seed:users
 *   npm run test:e2e
 */
test.describe("Phase 0 smoke", () => {
  test("admin demo login shows dashboard and admin nav, then signs out", async ({
    page,
  }) => {
    await page.goto("/login");

    await expect(
      page.getByText("Demo environment — synthetic data only"),
    ).toBeVisible();

    await page.getByRole("button", { name: "Admin", exact: true }).click();

    await expect(page).toHaveURL(/\/dashboard/);
    await expect(
      page.getByRole("heading", { name: "Dashboard" }),
    ).toBeVisible();

    // Admin role can see the Admin navigation item.
    await expect(
      page.getByRole("link", { name: "Admin" }).first(),
    ).toBeVisible();

    // Sign out via the user menu.
    await page.getByRole("button", { name: /Demo Admin|admin@demo.local/ }).click();
    await page.getByRole("menuitem", { name: "Sign out" }).click();

    await expect(page).toHaveURL(/\/login/);
  });

  test("owner demo login hides the admin nav", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("button", { name: "Owner", exact: true }).click();
    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.getByRole("link", { name: "Admin" })).toHaveCount(0);
  });
});
