import { expect, test, type Page } from '@playwright/test';
import { C } from '../lib/tokens';
import { completeSetup, dismissSummary, gotoApp, goToTab, restScreen, skipRest } from './helpers';

// An installed app paints the phone's status bar from the theme-color tag, so
// the tag has to follow the screen: a light bar over the ink Train screen reads
// as the app failing to draw.

function themeColor(page: Page) {
  return page.locator('meta[name="theme-color"]');
}

/** Exactly one tag, so the browser cannot pick a stale duplicate. */
async function expectThemeColor(page: Page, color: string) {
  await expect(themeColor(page)).toHaveCount(1);
  await expect(themeColor(page)).toHaveAttribute('content', color);
}

test.describe('status bar colour', () => {
  test.beforeEach(async ({ page }) => {
    await gotoApp(page);
    await completeSetup(page);
  });

  test('is light on Today and ink on Train, and goes back when you leave', async ({ page }) => {
    await expectThemeColor(page, C.screen);

    await page.getByRole('button', { name: /^(Start workout|Train anyway)$/ }).click();
    await goToTab(page, 'Train');
    await expectThemeColor(page, C.ink);

    await goToTab(page, 'Plan');
    await expectThemeColor(page, C.screen);

    await goToTab(page, 'Train');
    await expectThemeColor(page, C.ink);
  });

  test('stays ink under the full-screen rest and the finish summary', async ({ page }) => {
    await page.getByRole('button', { name: /^(Start workout|Train anyway)$/ }).click();
    await goToTab(page, 'Train');
    await page.getByRole('button', { name: /^Log set/ }).click();

    await expect(restScreen(page)).toBeVisible();
    await expectThemeColor(page, C.ink);
    await skipRest(page);

    // The summary opens over Today, but its top is an ink header, so the bar
    // has to stay dark until it is dismissed.
    await page.getByRole('button', { name: 'Finish', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Session summary' })).toBeVisible();
    await expectThemeColor(page, C.ink);

    await dismissSummary(page);
    await expectThemeColor(page, C.screen);
  });
});
