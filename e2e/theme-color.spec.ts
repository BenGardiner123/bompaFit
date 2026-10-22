import { expect, test, type Page } from '@playwright/test';
import { C } from '../lib/tokens';
import { completeSetup, dismissSummary, finishToSummary, gotoApp, goToTab, restScreen, skipRest } from './helpers';

// An installed app paints the phone's status bar from the theme-color tag, so
// the tag has to follow the screen: a light bar over an ink header reads as a
// strip the app forgot to paint, and an ink one over a light header the same.

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

  test('is ink on every screen that opens with an ink header', async ({ page }) => {
    await expectThemeColor(page, C.ink);

    await page.getByRole('button', { name: /^(Start .+|Train anyway)$/ }).click();
    await goToTab(page, 'Train');
    await expectThemeColor(page, C.ink);

    await goToTab(page, 'Plan');
    await expectThemeColor(page, C.ink);

    await goToTab(page, 'History');
    await expectThemeColor(page, C.ink);

    await goToTab(page, 'Today');
    await expectThemeColor(page, C.ink);
  });

  test('is light on Workouts and its tools, whose headers are light', async ({ page }) => {
    await page.getByRole('button', { name: /^(Start .+|Train anyway)$/ }).click();
    await goToTab(page, 'Workouts');
    await expectThemeColor(page, C.screen);
    await page.getByRole('button', { name: /^Interval timer/ }).click();
    await expectThemeColor(page, C.screen);
  });

  test('stays ink under the full-screen rest and the finish summary', async ({ page }) => {
    await page.getByRole('button', { name: /^(Start .+|Train anyway)$/ }).click();
    await goToTab(page, 'Train');
    await page.getByRole('button', { name: /^Log set/ }).click();

    await expect(restScreen(page)).toBeVisible();
    await expectThemeColor(page, C.ink);
    await skipRest(page);

    // The summary opens over Today, but its top is an ink header, so the bar
    // has to stay dark until it is dismissed.
    await finishToSummary(page);
    await expectThemeColor(page, C.ink);

    // Back on Today, whose header is ink as well.
    await dismissSummary(page);
    await expectThemeColor(page, C.ink);
  });
});

test('is light during setup, whose header is light', async ({ page }) => {
  await gotoApp(page);
  await expectThemeColor(page, C.screen);
});
