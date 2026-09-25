import { expect, test, type Page } from '@playwright/test';
import {
  addLift,
  builder,
  completeSetup,
  goToTab,
  gotoApp,
  openSettings,
  openSettingsView,
  openTool,
  restScreen,
  saveBuilder,
  settingsSheet,
  type TabName,
} from './helpers';

// "412px viewport — is anything clipped?" — the check jsdom structurally cannot
// do, because it has no layout engine and every element measures zero.

const TABS: TabName[] = ['Today', 'Train', 'Plan', 'History', 'Workouts'];

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
      await page.getByRole('button', { name: /^(Start .+|Train anyway)$/ }).click();
      await goToTab(page, 'Train');

      const logSet = page.getByRole('button', { name: 'Log set' });
      const box = await logSet.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x + box!.width).toBeLessThanOrEqual(412);
      expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
    });

    test.describe('the Train height budget', () => {
      // The design's 412×892 phone gives 34px of that to its own status bar,
      // which the app never gets. Below the frame breakpoint the test page
      // has no bar, so it is shrunk by the same 34px to measure what a real
      // phone leaves.
      test.use({ viewport: { width: 412, height: 892 - 34 } });

      /**
       * Everything on Train fits above the Log button with nothing to scroll.
       * Measured three ways, because each alone can pass while the screen is
       * broken: the button is sticky, so it can sit on screen with the page
       * scrolling behind it.
       */
      async function expectTrainFits(page: Page) {
        // A screen rises 8px into place when it opens, and the scroll height
        // counts that offset until it lands. Measured mid-rise, a screen that
        // fits reads a few pixels too tall.
        await page.waitForFunction(() =>
          document.getAnimations().every((a) => !('animationName' in a) || a.animationName !== 'bompaRise' || a.playState === 'finished'),
        );
        const log = page.getByRole('button', { name: /^Log (set|drop|piece|AMRAP set)/ });
        const logBox = (await log.boundingBox())!;
        const nav = (await page.getByRole('navigation', { name: 'Main' }).boundingBox())!;
        expect(Math.round(logBox.y + logBox.height)).toBeLessThanOrEqual(Math.round(nav.y));

        const scroller = await log.evaluate((el) => {
          let node = el.parentElement;
          while (node && getComputedStyle(node).overflowY !== 'auto') node = node.parentElement;
          return node ? { scrollHeight: node.scrollHeight, clientHeight: node.clientHeight } : null;
        });
        expect(scroller).not.toBeNull();
        expect(scroller!.scrollHeight).toBeLessThanOrEqual(scroller!.clientHeight);

        const last = (await page.getByRole('button', { name: 'What do the set types mean?' }).boundingBox())!;
        expect(Math.round(last.y + last.height)).toBeLessThanOrEqual(Math.round(logBox.y));
      }

      test('Train fits without scrolling at 412×892', async ({ page }) => {
        await goToTab(page, 'Today');
        await page.getByRole('button', { name: /^(Start .+|Train anyway)$/ }).click();
        await goToTab(page, 'Train');
        await expectTrainFits(page);

        // A lift left unrated, so the catch-up line shows.
        await page.getByRole('button', { name: 'Log set' }).click();
        await page.getByRole('dialog', { name: 'Resting' }).getByRole('button', { name: 'Skip rest' }).click();
        await page.getByRole('button', { name: /^OHP, / }).click();
        await expect(page.getByRole('status').filter({ hasText: 'unrated' })).toBeVisible();
        await expectTrainFits(page);
      });

      test('Train fits in its heaviest state: a minimised rest after a superset round, a catch-up line and a warm-up', async ({
        page,
      }) => {
        // A warm-up, and Fly and Rope as superset A after Bench.
        await goToTab(page, 'Workouts');
        await page.getByRole('button', { name: /^Edit/ }).first().click();
        const edit = builder(page);
        await expect(edit).toBeVisible();
        await addLift(page, 'Cable Fly');
        await addLift(page, 'Rope Extension');
        const warmup = edit.getByRole('region', { name: 'Warm-up' });
        await warmup.getByRole('button', { name: '+ Add from common moves' }).click();
        await warmup.getByRole('group', { name: 'Common moves' }).getByRole('button', { name: 'Cat-cow', exact: true }).click();
        await warmup.getByRole('button', { name: 'Done adding common moves' }).click();
        const letterA = edit.locator('button', { hasText: /^A$/ });
        await letterA.nth(2).click();
        await letterA.nth(3).click();
        await saveBuilder(page);

        await goToTab(page, 'Today');
        await page.getByRole('button', { name: /^(Start .+|Train anyway)$/ }).click();
        await goToTab(page, 'Train');
        await page.getByRole('region', { name: 'Warm-up' }).getByRole('button', { name: 'Hide warm-up' }).click();

        // One set of Bench, and the rest minimised: later rests start minimised.
        await page.getByRole('button', { name: 'Log set' }).click();
        await restScreen(page).getByRole('button', { name: 'Minimise' }).click();
        await page.getByRole('button', { name: /^Fly · A, / }).click();

        // A full round of the superset, rated nowhere yet: the minimised rest
        // asks about the round on one line, with the rest behind "+1 more".
        await page.getByRole('button', { name: 'Log set' }).click();
        await page.getByRole('button', { name: 'Log set' }).click();
        const asked = page.getByRole('region', { name: 'How did that feel?' });
        await expect(page.getByRole('button', { name: /^Rest, / })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Drop the weight and carry on this set' })).toBeVisible();
        await expect(asked.getByRole('button', { name: /\+1 more to rate/ })).toBeVisible();
        await expectTrainFits(page);

        // Leaving the group puts Fly on the catch-up line, folded into the same line.
        await page.getByRole('button', { name: /^Bench, / }).click();
        await expect(asked).toBeVisible();
        await expectTrainFits(page);

        // Back into the group, where the superset line shows too: Bench is now
        // the lift left unrated, so there are two more to rate.
        await page.getByRole('button', { name: /^Rope · A, / }).click();
        await expect(asked.getByRole('button', { name: /\+2 more to rate/ })).toBeVisible();
        await expect(page.getByText(/^Superset A · round 2 of 3/)).toBeVisible();
        await expectTrainFits(page);
      });
    });

    test('the Settings sheet fits, and its buttons sit side by side inside it', async ({ page }) => {
      await openSettings(page);
      expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
      const sheet = (await settingsSheet(page).boundingBox())!;
      for (const name of ['Export backup', 'Restore']) {
        const box = (await settingsSheet(page).getByRole('button', { name, exact: true }).boundingBox())!;
        expect(box.x).toBeGreaterThanOrEqual(sheet.x);
        expect(box.x + box.width).toBeLessThanOrEqual(sheet.x + sheet.width);
      }
    });

    for (const tool of ['Interval timer', '1RM calculator'] as const) {
      test(`the ${tool} fits`, async ({ page }) => {
        await openTool(page, tool);
        expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
      });
    }

    for (const row of ['Timer alerts', 'Default warm-up', 'Exercise instructions'] as const) {
      test(`${row}, opened from Settings, fits`, async ({ page }) => {
        await openSettingsView(page, row);
        expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
      });
    }

    test('the workout builder fits', async ({ page }) => {
      await goToTab(page, 'Workouts');
      await page.getByRole('button', { name: /^Edit/ }).first().click();
      await expect(page.getByRole('dialog', { name: /^Edit / })).toBeVisible();
      expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
    });
  });
});
