import { expect, test } from '@playwright/test';
import { completeSetup, goToTab, gotoApp, type TabName } from './helpers';

// "412px viewport — is anything clipped?" — the check jsdom structurally cannot
// do, because it has no layout engine and every element measures zero.

const TABS: TabName[] = ['Today', 'Train', 'Plan', 'History', 'Tools'];

/** How far the page can be scrolled sideways. Anything above zero is a bug. */
async function horizontalOverflow(page: import('@playwright/test').Page) {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

test.describe('at 412px', () => {
  test('setup does not scroll sideways on any step', async ({ page }) => {
    await gotoApp(page);
    for (let step = 0; step < 2; step++) {
      expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
      await page.getByRole('button', { name: 'Next', exact: true }).click();
    }
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
  });

  test.describe('with a plan running', () => {
    test.beforeEach(async ({ page }) => {
      await gotoApp(page);
      await completeSetup(page, { workouts: [['Bench Press', 'Overhead Press']], names: ['Push A'] });
    });

    for (const tab of TABS) {
      test(`${tab} does not scroll sideways`, async ({ page }) => {
        await goToTab(page, tab);
        expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
      });
    }

    test('the tab bar stays reachable and fully on screen', async ({ page }) => {
      const nav = page.getByRole('navigation', { name: 'Main' });
      const box = await nav.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(412);
    });

    test('the logger fits, including the entry pad', async ({ page }) => {
      await goToTab(page, 'Today');
      await page.getByRole('button', { name: /^(Start workout|Train anyway)$/ }).click();
      await goToTab(page, 'Train');

      const logSet = page.getByRole('button', { name: 'Log set' });
      const box = await logSet.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x + box!.width).toBeLessThanOrEqual(412);
      expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
    });

    test('the workout builder fits', async ({ page }) => {
      await goToTab(page, 'Today');
      await page.getByRole('button', { name: 'Open workout library' }).click();
      await page.getByRole('button', { name: /^Edit/ }).first().click();
      await expect(page.getByRole('dialog', { name: /^Edit / })).toBeVisible();
      expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
    });
  });
});
