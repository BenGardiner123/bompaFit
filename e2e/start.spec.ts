import { expect, test } from '@playwright/test';
import { completeSetup, gotoApp, goToTab } from './helpers';

// Opening the app should look like one thing arriving, not several: the phone
// shows the icon on its own splash screen, so the page must not show a second
// logo, and the first screen must already be in place rather than rising into it.

test('the page loads with no logo of its own, only the shape of the screen to come', async ({ page }) => {
  const html = await (await page.request.get('/')).text();
  expect(html).toContain('data-booting');
  expect(html).not.toContain('>BOMPA<');
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
