import { expect, test, type Page } from '@playwright/test';
import { completeSetup, goToTab, gotoApp, restScreen, skipRest } from './helpers';

// The week shapes what Train asks for. A workout's written weight is the
// weight for the block's last hard week; earlier weeks work down from it and
// ask for fewer sets, and the deload is lighter still. The Monday review adds
// on top of that, and never drags a lift under what the plan already asks.
//
// Setup builds a 4-week strength block starting this week, with one lift
// written as 3 × 8 at 40 kg.

const MONDAY_WEEK_1 = new Date('2026-10-12T07:00:00');
const WEEKS = 7 * 24 * 60 * 60 * 1000;

test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: MONDAY_WEEK_1 });
  await gotoApp(page);
  await completeSetup(page, { workouts: [['Bench Press']], names: ['Push A'] });
});

const targetLine = (page: Page) => page.getByText(/^(Set \d+ of \d+|Extra set) · /);

async function startPushA(page: Page) {
  await goToTab(page, 'Today');
  await page.getByRole('button', { name: 'Start Push A' }).click();
  await expect(targetLine(page)).toBeVisible();
}

/** Move the clock on by whole weeks and reopen the app, so the week rolls over as it would overnight. */
async function weeksLater(page: Page, weeks: number) {
  await page.clock.setSystemTime(new Date(MONDAY_WEEK_1.getTime() + weeks * WEEKS));
  await gotoApp(page);
}

test('the week shapes what Train asks for: lighter and fewer sets early, the written weight in the last week, light again in the deload', async ({ page }) => {
  // Week 1: 85% of 40 is 34, which is not a weight anyone can load; 35 is. 62% of 3 sets is 2.
  await startPushA(page);
  await expect(targetLine(page)).toHaveText('Set 1 of 2 · 8 reps @ 35 kg · aim RPE 8');

  // Week 4, the block's last working week: the workout as written.
  await weeksLater(page, 3);
  await startPushA(page);
  await expect(targetLine(page)).toHaveText('Set 1 of 3 · 8 reps @ 40 kg · aim RPE 8');

  // Week 5, the deload: 70% of 40 is 28, so 27.5; 38% of 3 sets rounds to 1.
  await weeksLater(page, 4);
  await startPushA(page);
  await expect(targetLine(page)).toHaveText('Set 1 of 1 · 8 reps @ 27.5 kg · aim RPE 8');
});

test("Today's preview agrees with Train", async ({ page }) => {
  await goToTab(page, 'Today');
  await expect(page.getByText(/^2 × 8 @ 35$/)).toBeVisible();
  await startPushA(page);
  await expect(targetLine(page)).toHaveText(/^Set 1 of 2 · 8 reps @ 35 kg/);
});

test('lifting light once does not drag next week under the plan', async ({ page }) => {
  await startPushA(page);
  // Four taps down from 35: 25 kg, and every set is easy.
  for (let i = 0; i < 4; i++) await page.getByRole('button', { name: 'Decrease weight' }).click();
  await expect(page.getByRole('button', { name: /^Log set/ })).toContainText('25 × 8');
  for (let i = 0; i < 3; i++) {
    await page.getByRole('button', { name: /^Log set/ }).click();
    await restScreen(page).getByRole('button', { name: 'RPE 6', exact: true }).click();
    await skipRest(page);
  }

  // Monday: the review sees an easy week at 25 kg. The old rule would have
  // prescribed 27.5; the plan asks 36 for week 2 (90% of 40), so that is where
  // it goes, shown to the plate step as 35.
  await weeksLater(page, 1);
  await goToTab(page, 'Today');
  await page.getByRole('button', { name: /^Notifications/ }).click();
  await expect(page.getByRole('dialog', { name: 'Notifications' })).toContainText('Bench Press keeps landing under target. Next week: 36 kg.');
  await page.keyboard.press('Escape');

  await startPushA(page);
  await expect(targetLine(page)).toHaveText('Set 1 of 2 · 8 reps @ 35 kg · aim RPE 8');
});
