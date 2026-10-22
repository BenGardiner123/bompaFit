import { expect, test } from '@playwright/test';
import { C } from '../lib/tokens';
import { completeSetup, gotoApp, goToTab } from './helpers';

// Opening the app should look like one thing arriving, not several: the
// phone's splash screen shows the icon on black, the page carries that on
// unchanged, and then the app fades in once, already in place.

test.describe('before the app has run', () => {
  test.use({ javaScriptEnabled: false });

  test('the page is the black splash with the icon, and no other logo', async ({ page }) => {
    await page.goto('/');
    const splash = page.locator('[data-booting]');
    await expect(splash).toBeVisible();
    await expect(splash).toHaveCSS('background-color', 'rgb(0, 0, 0)');
    await expect(splash.locator('svg')).toBeVisible();
    await expect(page.getByText('BOMPA', { exact: true })).toHaveCount(0);
    // It covers the whole screen, the tab bar and the strip under it included.
    const box = (await splash.boundingBox())!;
    expect(box.height).toBe(page.viewportSize()!.height);
  });

  test('the status bar starts black, to match', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', C.black);
  });
});

test("the phone's own splash screen is black too", async ({ page }) => {
  const manifest = await (await page.request.get('/manifest.webmanifest')).json();
  expect(manifest.background_color).toBe(C.black);
  expect(manifest.theme_color).toBe(C.black);
});

test('the splash is gone once the app is ready, so nothing sits over it', async ({ page }) => {
  await gotoApp(page);
  await expect(page.locator('[data-splash]')).toHaveCount(0, { timeout: 2_000 });
});

test.describe('after setup', () => {
  test.beforeEach(async ({ page }) => {
    await gotoApp(page);
    await completeSetup(page);
    await page.reload();
    await expect(page.locator('[data-booting]')).toBeHidden({ timeout: 15_000 });
  });

  test('the first screen does not rise into place', async ({ page }) => {
    await expect(page.getByText('Next up', { exact: true })).toBeVisible();
    expect(await page.locator('.rise').count()).toBe(0);
  });

  test('moving to another tab still rises, which marks the move', async ({ page }) => {
    await goToTab(page, 'Plan');
    await expect(page.getByRole('heading', { name: 'Plan', level: 1 }).locator('xpath=ancestor::*[contains(@class, "rise")]')).toHaveCount(1);
  });
});
